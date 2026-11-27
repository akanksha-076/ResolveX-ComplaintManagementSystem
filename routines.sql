USE resolvex;

DROP TRIGGER IF EXISTS trg_status_history;
DROP PROCEDURE IF EXISTS sp_update_complaint;
DROP FUNCTION IF EXISTS fn_resolution_minutes;

DELIMITER //

-- TRIGGER: status badalte hi history apne aap save hoti hai
CREATE TRIGGER trg_status_history
AFTER UPDATE ON Complaints
FOR EACH ROW
BEGIN
  IF OLD.status <> NEW.status THEN
    INSERT INTO Status_History (complaint_id, old_status, new_status)
    VALUES (OLD.complaint_id, OLD.status, NEW.status);
  END IF;
END//

-- STORED PROCEDURE: complaint ka department aur status update karta hai
CREATE PROCEDURE sp_update_complaint(
  IN p_id INT,
  IN p_department_id INT,
  IN p_status VARCHAR(20)
)
BEGIN
  UPDATE Complaints
  SET department_id = p_department_id, status = p_status
  WHERE complaint_id = p_id;
END//

-- FUNCTION: resolve hone mein kitne minute lage (resolve nahi hui to NULL)
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

DELIMITER ;

USE resolvex;
SHOW TRIGGERS;

USE resolvex;
CALL sp_update_complaint(1, 2, 'Resolved');
SELECT * FROM Status_History;
SELECT complaint_id, status, fn_resolution_minutes(complaint_id) AS minutes FROM Complaints;