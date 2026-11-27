# ResolveX — Campus Complaint Management System

A full-stack campus complaint management web application built with **HTML, CSS, JavaScript, Node.js, Express, MySQL, and MongoDB**.

## Features
- **Student Portal:** Register, sign in, submit complaints with category/location/priority, search and filter submissions, and rate resolved complaints.
- **Admin & Staff Dashboard:** Filterable and paginated complaint queue, department assignment, status updates, overdue escalation, user role management, and security audit logs.
- **Reports & Analytics:** Category, status, department workload, SLA compliance, average resolution time, student rating summary, and report summary snapshots.
- **Database Engineering:** MySQL transactions with savepoints, optimistic concurrency control, stored procedures, SQL cursor escalation, triggers, functions, RBAC permissions, composite B-Tree & Hash indexes, MongoDB document collections, TTL caching, and summary ETL sync.

## How to Run
1. Install Node.js, MySQL, and MongoDB.
2. Copy `.env.example` to `.env` and set your MySQL password and MongoDB URI.
3. Run `npm install`.
4. Run `node server.js` and open `http://localhost:3000`.
