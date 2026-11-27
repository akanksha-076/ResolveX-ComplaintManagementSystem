# ResolveX — Campus Complaint Management System

A scalable hybrid **MySQL + MongoDB** web application implementing core **DBMS Unit 3 & Unit 4** concepts alongside a modern, responsive UI.

## Key Features & Syllabus Alignment

### Unit 3: Transactions, PL/SQL & Database Security
- **ACID Transactions & Savepoints:** Multi-step complaint submission and interactive ACID transaction demos using `START TRANSACTION`, `SAVEPOINT`, `ROLLBACK TO SAVEPOINT`, `COMMIT`, and `ROLLBACK`.
- **Locking & Concurrency Control:** Optimistic locking (`version` column + `sp_update_complaint_optimistic` returning `409 Conflict` on stale updates) and Pessimistic locking (`SELECT ... FOR UPDATE` under `REPEATABLE READ`).
- **PL/SQL Programming:** Stored procedures (`sp_update_complaint`, `sp_update_complaint_optimistic`, `sp_escalate_overdue_complaints` with SQL `CURSOR`), stored functions (`fn_resolution_minutes`, `fn_sla_status`), and triggers (`trg_status_history`, `trg_user_audit`).
- **Database Security & RBAC:** Signed HMAC-SHA256 JWT tokens, `bcryptjs` password hashing, `RBAC_Permissions` matrix (`student`, `department_staff`, `admin`), `Audit_Security_Logs`, and parameterized `mysql2` queries to prevent SQL injection.

### Unit 4: Performance, NoSQL, Cloud & Data Warehousing
- **Query Optimization & Indexing:** Composite B-Tree indexes on `Complaints` and `Status_History`, an explicit `USING HASH` MEMORY lookup table (`SLA_Policy_Hash`), and a live `EXPLAIN` execution plan analyzer.
- **NoSQL Document & Key-Value Stores:** Indexed MongoDB collections (`complaint_comments`, `complaint_feedback`, `activity_logs`) plus a TTL Key-Value cache (`kvCache.js` + MongoDB `kv_store`).
- **Data Warehousing & ETL:** Integrated ETL pipeline (`etl.js`) extracting from MySQL + MongoDB, transforming SLA/interaction metrics, and loading star-schema facts into `dw_complaint_facts` alongside raw JSON `data_lake_snapshots` in MongoDB.

## How to Run
1. Install Node.js, MySQL, and MongoDB.
2. Run `schema.sql` and `routines.sql` in MySQL Workbench (or let `node server.js` auto-initialize schema upgrades, indexes, RBAC seeds, and routines on an existing `resolvex` database).
3. Copy `.env.example` to `.env` and configure `DB_PASSWORD`, `MONGO_URI`, and `JWT_SECRET`.
4. Run `npm install` and then `node server.js`.
5. Open `http://localhost:3000`.
