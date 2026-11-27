USE resolvex;

DROP TRIGGER IF EXISTS trg_status_history;
DROP TRIGGER IF EXISTS trg_user_audit;
DROP PROCEDURE IF EXISTS sp_update_complaint;
DROP PROCEDURE IF EXISTS sp_update_complaint_optimistic;
DROP PROCEDURE IF EXISTS sp_escalate_overdue_complaints;
DROP FUNCTION IF EXISTS fn_resolution_minutes;
DROP FUNCTION IF EXISTS fn_sla_status;

DELIMITER //

-- TRIGGER 1: Automatically records every complaint status change into Status_History
CREATE TRIGGER trg_status_history
AFTER UPDATE ON Complaints
FOR EACH ROW
BEGIN
  IF NOT (OLD.status <=> NEW.status) THEN
    INSERT INTO Status_History (complaint_id, old_status, new_status, changed_by)
    VALUES (OLD.complaint_id, OLD.status, NEW.status, 'Workflow');
  END IF;
END//

-- TRIGGER 2: Automatically logs new user registrations into Audit_Security_Logs
CREATE TRIGGER trg_user_audit
AFTER INSERT ON Users
FOR EACH ROW
BEGIN
  INSERT INTO Audit_Security_Logs (actor_user_id, actor_role, action, resource, details)
  VALUES (NEW.user_id, NEW.role, 'USER_REGISTERED', 'Users', CONCAT('Registered email: ', NEW.email));
END//

-- STORED PROCEDURE 1: Updates department & status and increments optimistic version
CREATE PROCEDURE sp_update_complaint(
  IN p_id INT,
  IN p_department_id INT,
  IN p_status VARCHAR(20)
)
BEGIN
  UPDATE Complaints
  SET department_id = p_department_id,
      status = p_status,
      version = version + 1
  WHERE complaint_id = p_id;
END//

-- STORED PROCEDURE 2: Transactional Optimistic-Locked Update (ACID + Concurrency Control)
CREATE PROCEDURE sp_update_complaint_optimistic(
  IN p_id INT,
  IN p_department_id INT,
  IN p_status VARCHAR(20),
  IN p_expected_version INT,
  OUT p_affected INT
)
BEGIN
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    SET p_affected = -1;
  END;

  START TRANSACTION;
    UPDATE Complaints
    SET department_id = p_department_id,
        status = p_status,
        version = version + 1
    WHERE complaint_id = p_id
      AND version = p_expected_version;

    SET p_affected = ROW_COUNT();
  COMMIT;
END//

-- STORED PROCEDURE 3 (CURSOR + SAVEPOINT): Escalates overdue Pending complaints to High priority
CREATE PROCEDURE sp_escalate_overdue_complaints(
  IN p_hours INT,
  OUT p_escalated_count INT
)
BEGIN
  DECLARE v_done INT DEFAULT 0;
  DECLARE v_id INT;
  DECLARE v_title VARCHAR(150);
  DECLARE v_priority VARCHAR(20);

  DECLARE cur_overdue CURSOR FOR
    SELECT complaint_id, title, priority
    FROM Complaints
    WHERE status = 'Pending'
      AND priority <> 'High'
      AND TIMESTAMPDIFF(HOUR, created_at, NOW()) >= p_hours
    FOR UPDATE;

  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = 1;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    SET p_escalated_count = 0;
  END;

  SET p_escalated_count = 0;

  START TRANSACTION;
    SAVEPOINT before_escalation_loop;

    OPEN cur_overdue;
    escalation_loop: LOOP
      FETCH cur_overdue INTO v_id, v_title, v_priority;
      IF v_done = 1 THEN
        LEAVE escalation_loop;
      END IF;

      UPDATE Complaints
      SET priority = 'High',
          version = version + 1
      WHERE complaint_id = v_id;

      INSERT INTO Audit_Security_Logs (actor_user_id, actor_role, action, resource, details)
      VALUES (NULL, 'cursor_job', 'PRIORITY_ESCALATED', 'Complaints',
              CONCAT('Complaint #', v_id, ' escalated from ', v_priority, ' to High'));

      SET p_escalated_count = p_escalated_count + 1;
    END LOOP;
    CLOSE cur_overdue;
  COMMIT;
END//

-- FUNCTION 1: Computes resolution duration in minutes (NULL if unresolved)
CREATE FUNCTION fn_resolution_minutes(p_complaint_id INT)
RETURNS INT
READS SQL DATA
BEGIN
  DECLARE v_created TIMESTAMP;
  DECLARE v_resolved TIMESTAMP;

  SELECT created_at INTO v_created
  FROM Complaints
  WHERE complaint_id = p_complaint_id;

  SELECT MAX(changed_at) INTO v_resolved
  FROM Status_History
  WHERE complaint_id = p_complaint_id AND new_status = 'Resolved';

  IF v_resolved IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN TIMESTAMPDIFF(MINUTE, v_created, v_resolved);
END//

-- FUNCTION 2: Evaluates SLA compliance based on priority thresholds
CREATE FUNCTION fn_sla_status(p_complaint_id INT)
RETURNS VARCHAR(30)
READS SQL DATA
BEGIN
  DECLARE v_priority VARCHAR(20);
  DECLARE v_status VARCHAR(20);
  DECLARE v_created TIMESTAMP;
  DECLARE v_minutes INT;
  DECLARE v_target INT;

  SELECT priority, status, created_at
  INTO v_priority, v_status, v_created
  FROM Complaints
  WHERE complaint_id = p_complaint_id;

  SET v_target = CASE v_priority
    WHEN 'High' THEN 120
    WHEN 'Medium' THEN 1440
    ELSE 4320
  END;

  IF v_status = 'Resolved' THEN
    SET v_minutes = fn_resolution_minutes(p_complaint_id);
    IF v_minutes IS NULL OR v_minutes <= v_target THEN
      RETURN 'On Time';
    END IF;
    RETURN 'SLA Breached';
  END IF;

  IF TIMESTAMPDIFF(MINUTE, v_created, NOW()) > v_target THEN
    RETURN 'SLA Breached';
  END IF;

  RETURN 'Within SLA';
END//

DELIMITER ;
