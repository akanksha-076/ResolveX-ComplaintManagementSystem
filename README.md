# ResolveX - Campus Complaint Management System

Students submit complaints, admins assign departments and update the status, and students track the result.

## Technologies
- Frontend: HTML, CSS, JavaScript
- Backend: Node.js + Express
- MySQL: users, departments, complaints, status history
- MongoDB: comments, feedback, activity logs

## How to run 
1. Install Node.js, MySQL and MongoDB.
2. Run `schema.sql` in MySQL Workbench to create the database.
3. Copy `.env.example` to a new file named `.env` and enter your MySQL password.
4. Run `npm install`.
5. Run `node server.js` and open http://localhost:3000

## Admin account
New users are students by default.
To make an admin, run in MySQL:
UPDATE Users SET role = 'admin' WHERE email = 'your_email';
