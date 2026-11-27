const db = require('./db');

async function columnExists(tableName, columnName) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );
  return rows[0].cnt > 0;
}

async function indexExists(tableName, indexName) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [tableName, indexName]
  );
  return rows[0].cnt > 0;
}

async function initializeDatabase() {
  // 1. Ensure Users supports department_staff role and created_at
  await db.query(
    `ALTER TABLE Users MODIFY COLUMN role ENUM('student', 'department_staff', 'admin') DEFAULT 'student'`
  );
  if (!(await columnExists('Users', 'created_at'))) {
    await db.query(`ALTER TABLE Users ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
  }

  // 2. Ensure Complaints has optimistic-locking version & updated_at columns
  if (!(await columnExists('Complaints', 'version'))) {
    await db.query(`ALTER TABLE Complaints ADD COLUMN version INT NOT NULL DEFAULT 1`);
  }
  if (!(await columnExists('Complaints', 'updated_at'))) {
    await db.query(
      `ALTER TABLE Complaints ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`
    );
  }

  // 3. Ensure Status_History tracks changed_by
  if (!(await columnExists('Status_History', 'changed_by'))) {
    await db.query(`ALTER TABLE Status_History ADD COLUMN changed_by VARCHAR(100) DEFAULT 'System'`);
  }

  // 4. Create Unit 3 & Unit 4 tables (RBAC, Audit Logs, Hash Index Lookup, Data Warehouse Facts)
  await db.query(`
    CREATE TABLE IF NOT EXISTS RBAC_Permissions (
      permission_id INT PRIMARY KEY AUTO_INCREMENT,
      role ENUM('student', 'department_staff', 'admin') NOT NULL,
      resource VARCHAR(50) NOT NULL,
      can_read BOOLEAN DEFAULT FALSE,
      can_create BOOLEAN DEFAULT FALSE,
      can_update BOOLEAN DEFAULT FALSE,
      can_delete BOOLEAN DEFAULT FALSE,
      UNIQUE KEY uq_role_resource (role, resource)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS Audit_Security_Logs (
      audit_id INT PRIMARY KEY AUTO_INCREMENT,
      actor_user_id INT NULL,
      actor_role VARCHAR(30) DEFAULT 'system',
      action VARCHAR(80) NOT NULL,
      resource VARCHAR(60) NOT NULL,
      details VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS SLA_Policy_Hash (
      priority VARCHAR(20) PRIMARY KEY,
      target_minutes INT NOT NULL,
      escalation_label VARCHAR(40) NOT NULL,
      INDEX idx_priority_hash (priority) USING HASH
    ) ENGINE=MEMORY
  `);

  await db.query(`
    INSERT IGNORE INTO SLA_Policy_Hash (priority, target_minutes, escalation_label) VALUES
    ('High', 120, 'Critical (2h SLA)'),
    ('Medium', 1440, 'Standard (24h SLA)'),
    ('Low', 4320, 'Routine (72h SLA)')
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS dw_complaint_facts (
      fact_id INT PRIMARY KEY AUTO_INCREMENT,
      complaint_id INT NOT NULL UNIQUE,
      department_name VARCHAR(100) NOT NULL,
      category VARCHAR(50) NOT NULL,
      priority VARCHAR(20) NOT NULL,
      status VARCHAR(20) NOT NULL,
      resolution_minutes INT NULL,
      sla_met BOOLEAN DEFAULT FALSE,
      comment_count INT DEFAULT 0,
      feedback_rating INT NULL,
      complaint_date DATE NOT NULL,
      etl_loaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  // 5. Seed RBAC permissions matrix
  const rbacSeeds = [
    ['student', 'complaints', 1, 1, 0, 0],
    ['student', 'comments', 1, 1, 0, 0],
    ['student', 'feedback', 1, 1, 0, 0],
    ['student', 'analytics', 0, 0, 0, 0],
    ['student', 'dbms_lab', 0, 0, 0, 0],
    ['student', 'users_rbac', 0, 0, 0, 0],
    ['department_staff', 'complaints', 1, 0, 1, 0],
    ['department_staff', 'comments', 1, 1, 0, 0],
    ['department_staff', 'feedback', 1, 0, 0, 0],
    ['department_staff', 'analytics', 1, 0, 0, 0],
    ['department_staff', 'dbms_lab', 0, 0, 0, 0],
    ['department_staff', 'users_rbac', 0, 0, 0, 0],
    ['admin', 'complaints', 1, 1, 1, 1],
    ['admin', 'comments', 1, 1, 1, 1],
    ['admin', 'feedback', 1, 0, 0, 0],
    ['admin', 'analytics', 1, 1, 1, 0],
    ['admin', 'dbms_lab', 1, 1, 1, 0],
    ['admin', 'users_rbac', 1, 1, 1, 0]
  ];

  for (const row of rbacSeeds) {
    await db.query(
      `INSERT IGNORE INTO RBAC_Permissions (role, resource, can_read, can_create, can_update, can_delete)
       VALUES (?, ?, ?, ?, ?, ?)`,
      row
    );
  }

  // 6. Create B-Tree Composite Indexes if missing
  const indexes = [
    ['Complaints', 'idx_complaints_user_created', 'CREATE INDEX idx_complaints_user_created ON Complaints (user_id, created_at)'],
    ['Complaints', 'idx_complaints_status_priority', 'CREATE INDEX idx_complaints_status_priority ON Complaints (status, priority)'],
    ['Complaints', 'idx_complaints_dept_status', 'CREATE INDEX idx_complaints_dept_status ON Complaints (department_id, status)'],
    ['Complaints', 'idx_complaints_category', 'CREATE INDEX idx_complaints_category ON Complaints (category)'],
    ['Status_History', 'idx_status_history_comp_status', 'CREATE INDEX idx_status_history_comp_status ON Status_History (complaint_id, new_status)']
  ];

  for (const [table, idxName, sql] of indexes) {
    if (!(await indexExists(table, idxName))) {
      await db.query(sql);
    }
  }

  // 7. Recreate stored routines & triggers cleanly
  await db.query('DROP TRIGGER IF EXISTS trg_status_history');
  await db.query('DROP TRIGGER IF EXISTS trg_user_audit');
  await db.query('DROP PROCEDURE IF EXISTS sp_update_complaint');
  await db.query('DROP PROCEDURE IF EXISTS sp_update_complaint_optimistic');
  await db.query('DROP PROCEDURE IF EXISTS sp_escalate_overdue_complaints');
  await db.query('DROP FUNCTION IF EXISTS fn_resolution_minutes');
  await db.query('DROP FUNCTION IF EXISTS fn_sla_status');

  await db.query(`
    CREATE TRIGGER trg_status_history
    AFTER UPDATE ON Complaints
    FOR EACH ROW
    BEGIN
      IF NOT (OLD.status <=> NEW.status) THEN
        INSERT INTO Status_History (complaint_id, old_status, new_status, changed_by)
        VALUES (OLD.complaint_id, OLD.status, NEW.status, 'Workflow');
      END IF;
    END
  `);

  await db.query(`
    CREATE TRIGGER trg_user_audit
    AFTER INSERT ON Users
    FOR EACH ROW
    BEGIN
      INSERT INTO Audit_Security_Logs (actor_user_id, actor_role, action, resource, details)
      VALUES (NEW.user_id, NEW.role, 'USER_REGISTERED', 'Users', CONCAT('Registered email: ', NEW.email));
    END
  `);

  await db.query(`
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
    END
  `);

  await db.query(`
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
    END
  `);

  await db.query(`
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
    END
  `);

  await db.query(`
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
    END
  `);

  await db.query(`
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
    END
  `);

  console.log('MySQL schema, indexes, RBAC, and routines initialized');
}

module.exports = { initializeDatabase };
