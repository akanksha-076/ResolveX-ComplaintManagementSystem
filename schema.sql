CREATE DATABASE IF NOT EXISTS resolvex;
USE resolvex;

CREATE TABLE IF NOT EXISTS Users (
  user_id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('student', 'department_staff', 'admin') DEFAULT 'student',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Departments (
  department_id INT PRIMARY KEY AUTO_INCREMENT,
  department_name VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS Complaints (
  complaint_id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  department_id INT,
  title VARCHAR(150) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(50) NOT NULL,
  location VARCHAR(100) NOT NULL,
  priority ENUM('Low', 'Medium', 'High') NOT NULL,
  status ENUM('Pending', 'In Progress', 'Resolved', 'Rejected') DEFAULT 'Pending',
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES Users(user_id),
  FOREIGN KEY (department_id) REFERENCES Departments(department_id)
);

CREATE TABLE IF NOT EXISTS Status_History (
  history_id INT PRIMARY KEY AUTO_INCREMENT,
  complaint_id INT NOT NULL,
  old_status VARCHAR(20),
  new_status VARCHAR(20) NOT NULL,
  changed_by VARCHAR(100) DEFAULT 'System',
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (complaint_id) REFERENCES Complaints(complaint_id)
);

-- Unit 3: Role-Based Access Control (RBAC) Matrix
CREATE TABLE IF NOT EXISTS RBAC_Permissions (
  permission_id INT PRIMARY KEY AUTO_INCREMENT,
  role ENUM('student', 'department_staff', 'admin') NOT NULL,
  resource VARCHAR(50) NOT NULL,
  can_read BOOLEAN DEFAULT FALSE,
  can_create BOOLEAN DEFAULT FALSE,
  can_update BOOLEAN DEFAULT FALSE,
  can_delete BOOLEAN DEFAULT FALSE,
  UNIQUE KEY uq_role_resource (role, resource)
);

-- Unit 3: Security & Trigger Audit Log
CREATE TABLE IF NOT EXISTS Audit_Security_Logs (
  audit_id INT PRIMARY KEY AUTO_INCREMENT,
  actor_user_id INT NULL,
  actor_role VARCHAR(30) DEFAULT 'system',
  action VARCHAR(80) NOT NULL,
  resource VARCHAR(60) NOT NULL,
  details VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Unit 4: Explicit HASH Index Lookup Table (MEMORY engine) for SLA Policy Thresholds
CREATE TABLE IF NOT EXISTS SLA_Policy_Hash (
  priority VARCHAR(20) PRIMARY KEY,
  target_minutes INT NOT NULL,
  escalation_label VARCHAR(40) NOT NULL,
  INDEX idx_priority_hash (priority) USING HASH
) ENGINE=MEMORY;

-- Unit 4: Star-Schema Data Warehouse Fact Table (populated by ETL)
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
);

-- Unit 4: B-Tree Composite Indexes for Query Optimization
CREATE INDEX idx_complaints_user_created ON Complaints (user_id, created_at);
CREATE INDEX idx_complaints_status_priority ON Complaints (status, priority);
CREATE INDEX idx_complaints_dept_status ON Complaints (department_id, status);
CREATE INDEX idx_complaints_category ON Complaints (category);
CREATE INDEX idx_status_history_comp_status ON Status_History (complaint_id, new_status);

INSERT IGNORE INTO Departments (department_name) VALUES
('Maintenance'),
('Hostel Office'),
('Academic Office'),
('Library');

INSERT IGNORE INTO SLA_Policy_Hash (priority, target_minutes, escalation_label) VALUES
('High', 120, 'Critical (2h SLA)'),
('Medium', 1440, 'Standard (24h SLA)'),
('Low', 4320, 'Routine (72h SLA)');
