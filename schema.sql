CREATE DATABASE resolvex;
USE resolvex;

CREATE TABLE Users (
  user_id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('student', 'admin') DEFAULT 'student'
);

CREATE TABLE Departments (
  department_id INT PRIMARY KEY AUTO_INCREMENT,
  department_name VARCHAR(100) NOT NULL
);

CREATE TABLE Complaints (
  complaint_id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  department_id INT,
  title VARCHAR(150) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(50) NOT NULL,
  location VARCHAR(100) NOT NULL,
  priority ENUM('Low', 'Medium', 'High') NOT NULL,
  status ENUM('Pending', 'In Progress', 'Resolved', 'Rejected') DEFAULT 'Pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES Users(user_id),
  FOREIGN KEY (department_id) REFERENCES Departments(department_id)
);

CREATE TABLE Status_History (
  history_id INT PRIMARY KEY AUTO_INCREMENT,
  complaint_id INT NOT NULL,
  old_status VARCHAR(20),
  new_status VARCHAR(20) NOT NULL,
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (complaint_id) REFERENCES Complaints(complaint_id)
);

INSERT INTO Departments (department_name) VALUES
('Maintenance'),
('Hostel Office'),
('Academic Office'),
('Library');