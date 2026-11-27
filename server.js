require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { initializeDatabase } = require('./dbInit');
const { Comment, Feedback, Activity, DataLakeSnapshot } = require('./mongo');
const { signToken, requireAuth, requirePermission } = require('./middleware/auth');
const { getCache, setCache, invalidatePrefix, clearAllCache, getCacheStats } = require('./kvCache');
const { runETLPipeline } = require('./etl');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

async function logActivity(complaint_id, user_name, role, action) {
  try {
    await Activity.create({ complaint_id: Number(complaint_id), user_name, role, action });
  } catch (err) {
    console.log('Activity log error:', err.message);
  }
}

async function logSecurityAudit(actor_user_id, actor_role, action, resource, details) {
  try {
    await db.query(
      `INSERT INTO Audit_Security_Logs (actor_user_id, actor_role, action, resource, details)
       VALUES (?, ?, ?, ?, ?)`,
      [actor_user_id || null, actor_role || 'system', action, resource, details]
    );
  } catch (err) {
    console.log('Audit log error:', err.message);
  }
}

app.get('/api/test', (req, res) => {
  res.json({ message: 'ResolveX server is running', status: 'healthy' });
});

// ==================== DEPARTMENTS (CACHED VIA KV STORE) ====================
app.get('/api/departments', async (req, res) => {
  try {
    const cached = await getCache('departments:all');
    if (cached) {
      res.set('X-Cache', `HIT (${cached.layer})`);
      return res.json(cached.value);
    }

    const [rows] = await db.query('SELECT * FROM Departments ORDER BY department_id ASC');
    await setCache('departments:all', rows, 300);
    res.set('X-Cache', 'MISS');
    return res.json(rows);
  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// ==================== AUTH & RBAC ====================
app.post('/api/register', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (!name || !email || password.length < 4) {
    return res.status(400).json({ error: 'Name, valid email, and password (min 4 chars) are required' });
  }

  try {
    const [existing] = await db.query('SELECT user_id FROM Users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const hash = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      'INSERT INTO Users (name, email, password_hash) VALUES (?, ?, ?)',
      [name, email, hash]
    );

    return res.status(201).json({
      message: 'Registered successfully',
      user_id: result.insertId
    });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  try {
    const [rows] = await db.query('SELECT * FROM Users WHERE email = ?', [email]);
    if (rows.length === 0) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      await logSecurityAudit(user.user_id, user.role, 'LOGIN_FAILED', 'Users', `Failed login for ${email}`);
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    const [perms] = await db.query(
      'SELECT resource, can_read, can_create, can_update, can_delete FROM RBAC_Permissions WHERE role = ?',
      [user.role]
    );

    const token = signToken({
      user_id: user.user_id,
      name: user.name,
      email: user.email,
      role: user.role
    });

    await logSecurityAudit(user.user_id, user.role, 'LOGIN_SUCCESS', 'Users', `Authenticated ${email}`);

    return res.json({
      token,
      user_id: user.user_id,
      name: user.name,
      email: user.email,
      role: user.role,
      permissions: perms
    });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/me', requireAuth, async (req, res) => {
  try {
    const [perms] = await db.query(
      'SELECT resource, can_read, can_create, can_update, can_delete FROM RBAC_Permissions WHERE role = ?',
      [req.user.role]
    );
    return res.json({ ...req.user, permissions: perms });
  } catch (err) {
    return res.status(500).json({ error: 'Database error' });
  }
});

// ==================== COMPLAINTS (ACID TRANSACTIONS + PAGINATION + OPTIMISTIC LOCKING) ====================
app.post('/api/complaints', requireAuth, requirePermission('complaints', 'create'), async (req, res) => {
  const title = String(req.body.title || '').trim();
  const category = String(req.body.category || '').trim();
  const location = String(req.body.location || '').trim();
  const priority = String(req.body.priority || '').trim();
  const description = String(req.body.description || '').trim();
  const user_id = req.user.user_id;

  if (!title || !category || !location || !priority || !description) {
    return res.status(400).json({ error: 'All complaint fields are required' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO Complaints (user_id, title, category, location, priority, description)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [user_id, title, category, location, priority, description]
    );
    const complaintId = result.insertId;

    await conn.query('SAVEPOINT after_complaint_insert');

    await conn.query(
      `INSERT INTO Status_History (complaint_id, old_status, new_status, changed_by)
       VALUES (?, NULL, 'Pending', ?)`,
      [complaintId, req.user.name]
    );

    await conn.query(
      `INSERT INTO Audit_Security_Logs (actor_user_id, actor_role, action, resource, details)
       VALUES (?, ?, 'COMPLAINT_CREATED', 'Complaints', ?)`,
      [user_id, req.user.role, `Created complaint #${complaintId} (${priority})`]
    );

    await conn.commit();

    await logActivity(complaintId, req.user.name, req.user.role, 'Complaint submitted');
    await invalidatePrefix('analytics:');

    return res.status(201).json({
      message: 'Complaint submitted',
      complaint_id: complaintId
    });
  } catch (err) {
    await conn.rollback();
    console.log(err);
    return res.status(500).json({ error: 'Transaction rolled back due to database error' });
  } finally {
    conn.release();
  }
});

// Student dashboard with server-side pagination, search, status filter & summary stats
app.get('/api/complaints/user/:id', requireAuth, requirePermission('complaints', 'read'), async (req, res) => {
  const targetUserId = Number(req.params.id);
  if (req.user.role !== 'admin' && req.user.user_id !== targetUserId) {
    return res.status(403).json({ error: 'Access denied: you can view only your own complaints.' });
  }

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
  const offset = (page - 1) * limit;
  const search = String(req.query.q || '').trim();
  const status = String(req.query.status || '').trim();

  try {
    const conditions = ['c.user_id = ?'];
    const params = [targetUserId];

    if (status && status !== 'All') {
      conditions.push('c.status = ?');
      params.push(status);
    }
    if (search) {
      conditions.push('(c.title LIKE ? OR c.location LIKE ? OR c.category LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    const whereClause = 'WHERE ' + conditions.join(' AND ');

    const [rows] = await db.query(
      `SELECT c.complaint_id, c.title, c.category, c.location, c.priority, c.status,
              c.version, c.created_at, d.department_name,
              fn_sla_status(c.complaint_id) AS sla_status
       FROM Complaints c
       LEFT JOIN Departments d ON c.department_id = d.department_id
       ${whereClause}
       ORDER BY c.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [[countRow]] = await db.query(
      `SELECT COUNT(*) AS total FROM Complaints c ${whereClause}`,
      params
    );

    const [[statsRow]] = await db.query(
      `SELECT COUNT(*) AS total,
              IFNULL(SUM(status = 'Pending'), 0) AS pending,
              IFNULL(SUM(status = 'In Progress'), 0) AS in_progress,
              IFNULL(SUM(status = 'Resolved'), 0) AS resolved,
              IFNULL(SUM(status = 'Rejected'), 0) AS rejected
       FROM Complaints
       WHERE user_id = ?`,
      [targetUserId]
    );

    return res.json({
      data: rows,
      stats: statsRow,
      pagination: {
        page,
        limit,
        total: countRow.total,
        totalPages: Math.max(1, Math.ceil(countRow.total / limit))
      }
    });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// Admin / Staff paginated complaints list with multi-criteria filtering
app.get('/api/complaints', requireAuth, requirePermission('complaints', 'read'), async (req, res) => {
  if (req.user.role === 'student') {
    return res.status(403).json({ error: 'Students cannot list all campus complaints.' });
  }

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
  const offset = (page - 1) * limit;
  const search = String(req.query.q || '').trim();
  const status = String(req.query.status || '').trim();
  const category = String(req.query.category || '').trim();
  const priority = String(req.query.priority || '').trim();

  try {
    const conditions = [];
    const params = [];

    if (status && status !== 'All') {
      conditions.push('c.status = ?');
      params.push(status);
    }
    if (category && category !== 'All') {
      conditions.push('c.category = ?');
      params.push(category);
    }
    if (priority && priority !== 'All') {
      conditions.push('c.priority = ?');
      params.push(priority);
    }
    if (search) {
      conditions.push('(c.title LIKE ? OR c.location LIKE ? OR u.name LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const [rows] = await db.query(
      `SELECT c.complaint_id, c.title, c.category, c.location, c.priority,
              c.department_id, c.status, c.version, c.created_at,
              u.name AS student_name, d.department_name,
              fn_sla_status(c.complaint_id) AS sla_status,
              fn_resolution_minutes(c.complaint_id) AS resolution_minutes
       FROM Complaints c
       JOIN Users u ON c.user_id = u.user_id
       LEFT JOIN Departments d ON c.department_id = d.department_id
       ${whereClause}
       ORDER BY c.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [[countRow]] = await db.query(
      `SELECT COUNT(*) AS total
       FROM Complaints c
       JOIN Users u ON c.user_id = u.user_id
       ${whereClause}`,
      params
    );

    const [[statsRow]] = await db.query(
      `SELECT COUNT(*) AS total,
              IFNULL(SUM(status = 'Pending'), 0) AS pending,
              IFNULL(SUM(status = 'In Progress'), 0) AS in_progress,
              IFNULL(SUM(status = 'Resolved'), 0) AS resolved,
              IFNULL(SUM(status = 'Rejected'), 0) AS rejected
       FROM Complaints`
    );

    return res.json({
      data: rows,
      stats: statsRow,
      pagination: {
        page,
        limit,
        total: countRow.total,
        totalPages: Math.max(1, Math.ceil(countRow.total / limit))
      }
    });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// Complaint details with LEFT JOIN + HASH index SLA policy lookup + Status_History
app.get('/api/complaints/:id', requireAuth, requirePermission('complaints', 'read'), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT c.*, u.name AS student_name, u.email AS student_email,
              d.department_name,
              s.target_minutes AS sla_target_minutes,
              s.escalation_label AS sla_policy,
              fn_resolution_minutes(c.complaint_id) AS resolution_minutes,
              fn_sla_status(c.complaint_id) AS sla_status
       FROM Complaints c
       JOIN Users u ON c.user_id = u.user_id
       LEFT JOIN Departments d ON c.department_id = d.department_id
       LEFT JOIN SLA_Policy_Hash s ON c.priority = s.priority
       WHERE c.complaint_id = ?`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Complaint not found' });
    }

    const complaint = rows[0];
    if (req.user.role === 'student' && complaint.user_id !== req.user.user_id) {
      return res.status(403).json({ error: 'Access denied: you can only view your own complaints.' });
    }

    const [history] = await db.query(
      `SELECT history_id, old_status, new_status, changed_by, changed_at
       FROM Status_History
       WHERE complaint_id = ?
       ORDER BY changed_at ASC`,
      [req.params.id]
    );

    return res.json({ ...complaint, status_history: history });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// Update complaint using Optimistic Locking stored procedure
app.put('/api/complaints/:id', requireAuth, requirePermission('complaints', 'update'), async (req, res) => {
  const { department_id, status, version } = req.body;
  const id = Number(req.params.id);

  try {
    const [rows] = await db.query(
      'SELECT status, department_id, version FROM Complaints WHERE complaint_id = ?',
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Complaint not found' });
    }

    const current = rows[0];
    const newDep = department_id ? Number(department_id) : null;

    if (version !== undefined && version !== null) {
      await db.query('CALL sp_update_complaint_optimistic(?, ?, ?, ?, @affected)', [
        id,
        newDep,
        status,
        Number(version)
      ]);
      const [[outRow]] = await db.query('SELECT @affected AS affected');
      if (outRow.affected === 0) {
        return res.status(409).json({
          error: 'Optimistic lock conflict: complaint was updated by another user. Reloading latest data.'
        });
      }
      if (outRow.affected < 0) {
        return res.status(500).json({ error: 'Transaction rolled back during update' });
      }
    } else {
      await db.query('CALL sp_update_complaint(?, ?, ?)', [id, newDep, status]);
    }

    if (current.status !== status) {
      await logActivity(
        id,
        req.user.name,
        req.user.role,
        `Status changed from ${current.status} to ${status}`
      );
    }

    if (current.department_id !== newDep) {
      if (newDep === null) {
        await logActivity(id, req.user.name, req.user.role, 'Department unassigned');
      } else {
        const [deps] = await db.query('SELECT department_name FROM Departments WHERE department_id = ?', [newDep]);
        const depName = deps.length > 0 ? deps[0].department_name : 'a department';
        await logActivity(id, req.user.name, req.user.role, `Assigned to ${depName}`);
      }
    }

    await logSecurityAudit(
      req.user.user_id,
      req.user.role,
      'COMPLAINT_UPDATED',
      'Complaints',
      `Updated #${id}: status=${status}, dept=${newDep || 'None'}`
    );
    await invalidatePrefix('analytics:');

    return res.json({ message: 'Complaint updated', new_version: current.version + 1 });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// Cursor-based overdue escalation procedure
app.post('/api/complaints/escalate', requireAuth, requirePermission('complaints', 'update'), async (req, res) => {
  const hours = Math.max(0, Number(req.body.hours ?? 24));
  try {
    await db.query('CALL sp_escalate_overdue_complaints(?, @escalated)', [hours]);
    const [[result]] = await db.query('SELECT @escalated AS escalated');
    await invalidatePrefix('analytics:');
    return res.json({
      message: `Cursor job completed: ${result.escalated} overdue pending complaint(s) escalated to High priority.`,
      escalated_count: result.escalated
    });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: 'Cursor procedure execution failed' });
  }
});

// ==================== MONGODB COMMENTS, FEEDBACK, ACTIVITY ====================
app.get('/api/comments/:complaintId', requireAuth, requirePermission('comments', 'read'), async (req, res) => {
  try {
    const comments = await Comment.find({ complaint_id: Number(req.params.complaintId) }).sort({ created_at: 1 });
    return res.json(comments);
  } catch (err) {
    return res.status(500).json({ error: 'MongoDB error' });
  }
});

app.post('/api/comments', requireAuth, requirePermission('comments', 'create'), async (req, res) => {
  const complaint_id = Number(req.body.complaint_id);
  const comment = String(req.body.comment || '').trim();
  if (!complaint_id || !comment) {
    return res.status(400).json({ error: 'Comment text is required' });
  }

  try {
    await Comment.create({
      complaint_id,
      user_id: req.user.user_id,
      user_name: req.user.name,
      role: req.user.role,
      comment
    });
    await logActivity(complaint_id, req.user.name, req.user.role, 'Added a comment');
    await invalidatePrefix('analytics:');
    return res.status(201).json({ message: 'Comment added' });
  } catch (err) {
    return res.status(500).json({ error: 'MongoDB error' });
  }
});

app.get('/api/feedback/:complaintId', requireAuth, requirePermission('feedback', 'read'), async (req, res) => {
  try {
    const feedback = await Feedback.findOne({ complaint_id: Number(req.params.complaintId) });
    return res.json(feedback);
  } catch (err) {
    return res.status(500).json({ error: 'MongoDB error' });
  }
});

app.post('/api/feedback', requireAuth, requirePermission('feedback', 'create'), async (req, res) => {
  const complaint_id = Number(req.body.complaint_id);
  const rating = Number(req.body.rating);
  const feedback = String(req.body.feedback || '').trim();

  if (!complaint_id || !feedback || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Valid rating (1-5) and feedback text are required' });
  }

  try {
    const [rows] = await db.query('SELECT user_id, status FROM Complaints WHERE complaint_id = ?', [complaint_id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Complaint not found' });
    }
    if (rows[0].user_id !== req.user.user_id) {
      return res.status(403).json({ error: 'Only the student who made the complaint can give feedback' });
    }
    if (rows[0].status !== 'Resolved') {
      return res.status(400).json({ error: 'Feedback can be given only after the complaint is resolved' });
    }

    const existing = await Feedback.findOne({ complaint_id });
    if (existing) {
      return res.status(400).json({ error: 'Feedback already given' });
    }

    await Feedback.create({
      complaint_id,
      user_id: req.user.user_id,
      user_name: req.user.name,
      rating,
      feedback
    });
    await logActivity(complaint_id, req.user.name, req.user.role, `Gave feedback (${rating}/5)`);
    await invalidatePrefix('analytics:');
    return res.status(201).json({ message: 'Feedback saved' });
  } catch (err) {
    return res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/activity/:complaintId', requireAuth, requirePermission('complaints', 'read'), async (req, res) => {
  try {
    const logs = await Activity.find({ complaint_id: Number(req.params.complaintId) }).sort({ created_at: 1 });
    return res.json(logs);
  } catch (err) {
    return res.status(500).json({ error: 'MongoDB error' });
  }
});

// ==================== ANALYTICS (HYBRID MYSQL + MONGODB + KV CACHE) ====================
app.get('/api/analytics', requireAuth, requirePermission('analytics', 'read'), async (req, res) => {
  try {
    const cached = await getCache('analytics:summary');
    if (cached) {
      res.set('X-Cache', `HIT (${cached.layer})`);
      return res.json({ ...cached.value, cache_status: `HIT (${cached.layer})` });
    }

    const [byCategory] = await db.query(
      'SELECT category, COUNT(*) AS total FROM Complaints GROUP BY category ORDER BY total DESC'
    );
    const [byStatus] = await db.query(
      'SELECT status, COUNT(*) AS total FROM Complaints GROUP BY status'
    );
    const [byPriority] = await db.query(
      'SELECT priority, COUNT(*) AS total FROM Complaints GROUP BY priority'
    );
    const [byDepartment] = await db.query(
      `SELECT d.department_name,
              IFNULL(SUM(c.status = 'Pending'), 0) AS pending,
              IFNULL(SUM(c.status = 'In Progress'), 0) AS in_progress,
              IFNULL(SUM(c.status = 'Resolved'), 0) AS resolved
       FROM Departments d
       LEFT JOIN Complaints c ON c.department_id = d.department_id
       GROUP BY d.department_id, d.department_name`
    );
    const [[resolution]] = await db.query(
      `SELECT COUNT(*) AS resolved_count,
              AVG(fn_resolution_minutes(complaint_id)) AS avg_minutes
       FROM Complaints
       WHERE status = 'Resolved'`
    );
    const [slaBreakdown] = await db.query(
      `SELECT fn_sla_status(complaint_id) AS sla_status, COUNT(*) AS total
       FROM Complaints
       GROUP BY sla_status`
    );

    const [mongoFeedbackStats] = await Feedback.aggregate([
      {
        $group: {
          _id: null,
          avg_rating: { $avg: '$rating' },
          total_reviews: { $sum: 1 }
        }
      }
    ]);
    const totalComments = await Comment.countDocuments();
    const totalActivities = await Activity.countDocuments();

    const payload = {
      byCategory,
      byStatus,
      byPriority,
      byDepartment,
      resolution,
      slaBreakdown,
      nosqlMetrics: {
        avg_rating: mongoFeedbackStats ? Number(mongoFeedbackStats.avg_rating.toFixed(2)) : null,
        total_reviews: mongoFeedbackStats ? mongoFeedbackStats.total_reviews : 0,
        total_comments: totalComments,
        total_activities: totalActivities
      }
    };

    await setCache('analytics:summary', payload, 45);
    res.set('X-Cache', 'MISS');
    return res.json({ ...payload, cache_status: 'MISS (Freshly computed)' });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// ==================== UNIT 3: USER RBAC MANAGEMENT ====================
app.get('/api/users', requireAuth, requirePermission('users_rbac', 'read'), async (req, res) => {
  try {
    const [users] = await db.query(
      'SELECT user_id, name, email, role, created_at FROM Users ORDER BY user_id ASC'
    );
    return res.json(users);
  } catch (err) {
    return res.status(500).json({ error: 'Database error' });
  }
});

app.put('/api/users/:id/role', requireAuth, requirePermission('users_rbac', 'update'), async (req, res) => {
  const targetId = Number(req.params.id);
  const newRole = String(req.body.role || '');
  if (!['student', 'department_staff', 'admin'].includes(newRole)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  if (targetId === req.user.user_id && newRole !== 'admin') {
    return res.status(400).json({ error: 'You cannot demote your own active admin session.' });
  }

  try {
    await db.query('UPDATE Users SET role = ? WHERE user_id = ?', [newRole, targetId]);
    await logSecurityAudit(
      req.user.user_id,
      req.user.role,
      'ROLE_CHANGED',
      'Users',
      `User #${targetId} role updated to ${newRole}`
    );
    return res.json({ message: `User #${targetId} role updated to ${newRole}` });
  } catch (err) {
    return res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/rbac/permissions', requireAuth, requirePermission('dbms_lab', 'read'), async (req, res) => {
  try {
    const [permissions] = await db.query('SELECT * FROM RBAC_Permissions ORDER BY role, resource');
    const [auditLogs] = await db.query(
      'SELECT * FROM Audit_Security_Logs ORDER BY audit_id DESC LIMIT 20'
    );
    return res.json({ permissions, auditLogs });
  } catch (err) {
    return res.status(500).json({ error: 'Database error' });
  }
});

// ==================== UNIT 3 & 4: DBMS LAB (EXPLAIN, ACID, LOCKING, SQLi, CACHE, ETL) ====================
app.get('/api/dbms/explain', requireAuth, requirePermission('dbms_lab', 'read'), async (req, res) => {
  try {
    const queries = [
      {
        name: 'Student Dashboard Lookup (Composite B-Tree Index)',
        sql: 'SELECT complaint_id, title, status FROM Complaints WHERE user_id = 1 ORDER BY created_at DESC'
      },
      {
        name: 'Status + Priority Filter (Composite B-Tree Index)',
        sql: "SELECT complaint_id, title FROM Complaints WHERE status = 'Pending' AND priority = 'High'"
      },
      {
        name: 'Complaint Details Join + Hash SLA Lookup',
        sql: `SELECT c.complaint_id, d.department_name, s.target_minutes
              FROM Complaints c
              LEFT JOIN Departments d ON c.department_id = d.department_id
              LEFT JOIN SLA_Policy_Hash s ON c.priority = s.priority
              WHERE c.complaint_id = 1`
      }
    ];

    const plans = [];
    for (const q of queries) {
      const [explainRows] = await db.query(`EXPLAIN ${q.sql}`);
      plans.push({ name: q.name, sql: q.sql, plan: explainRows });
    }

    const [complaintsIndexes] = await db.query('SHOW INDEX FROM Complaints');
    const [hashIndexes] = await db.query('SHOW INDEX FROM SLA_Policy_Hash');
    const [[isoRow]] = await db.query('SELECT @@transaction_isolation AS isolation_level');

    return res.json({
      isolation_level: isoRow.isolation_level,
      plans,
      btree_indexes: complaintsIndexes.map((i) => ({
        table: i.Table,
        key_name: i.Key_name,
        column: i.Column_name,
        index_type: i.Index_type,
        cardinality: i.Cardinality
      })),
      hash_indexes: hashIndexes.map((i) => ({
        table: i.Table,
        key_name: i.Key_name,
        column: i.Column_name,
        index_type: i.Index_type
      }))
    });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: 'Failed to inspect execution plans' });
  }
});

app.post('/api/dbms/acid-demo', requireAuth, requirePermission('dbms_lab', 'create'), async (req, res) => {
  const mode = req.body.mode === 'rollback' ? 'rollback' : 'commit_with_savepoint';
  const conn = await db.getConnection();
  const trace = [];

  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    trace.push('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');

    await conn.beginTransaction();
    trace.push('START TRANSACTION');

    await conn.query(
      `INSERT INTO Audit_Security_Logs (actor_user_id, actor_role, action, resource, details)
       VALUES (?, ?, 'ACID_STEP_1', 'Audit_Security_Logs', 'Primary step committed in tx')`,
      [req.user.user_id, req.user.role]
    );
    trace.push('INSERT INTO Audit_Security_Logs (ACID_STEP_1)');

    await conn.query('SAVEPOINT sp_midpoint');
    trace.push('SAVEPOINT sp_midpoint');

    await conn.query(
      `INSERT INTO Audit_Security_Logs (actor_user_id, actor_role, action, resource, details)
       VALUES (?, ?, 'ACID_TEMP_STEP', 'Audit_Security_Logs', 'Temporary step before savepoint rollback')`,
      [req.user.user_id, req.user.role]
    );
    trace.push('INSERT INTO Audit_Security_Logs (ACID_TEMP_STEP)');

    await conn.query('ROLLBACK TO SAVEPOINT sp_midpoint');
    trace.push('ROLLBACK TO SAVEPOINT sp_midpoint (reverted ACID_TEMP_STEP, kept ACID_STEP_1)');

    if (mode === 'rollback') {
      await conn.rollback();
      trace.push('ROLLBACK (entire transaction undone — Atomicity preserved)');
    } else {
      await conn.commit();
      trace.push('COMMIT (ACID_STEP_1 durably persisted)');
    }

    return res.json({
      mode,
      outcome: mode === 'rollback' ? 'Rolled back completely' : 'Committed with partial savepoint rollback',
      trace
    });
  } catch (err) {
    await conn.rollback();
    return res.status(500).json({ error: 'ACID demo failed', trace });
  } finally {
    conn.release();
  }
});

app.post('/api/dbms/lock-demo', requireAuth, requirePermission('dbms_lab', 'update'), async (req, res) => {
  const complaintId = Number(req.body.complaint_id || 1);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [locked] = await conn.query(
      'SELECT complaint_id, status, version FROM Complaints WHERE complaint_id = ? FOR UPDATE',
      [complaintId]
    );
    if (locked.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Complaint not found for lock demo' });
    }
    const row = locked[0];
    await conn.commit();

    // Test stale optimistic lock safely
    await db.query('CALL sp_update_complaint_optimistic(?, NULL, ?, ?, @affected)', [
      row.complaint_id,
      row.status,
      row.version - 1
    ]);
    const [[staleCheck]] = await db.query('SELECT @affected AS affected');

    return res.json({
      pessimistic_lock: `SELECT ... FOR UPDATE acquired exclusive row lock on Complaint #${row.complaint_id} (current version ${row.version}) and released on COMMIT.`,
      optimistic_lock_test: `Simulated stale update with version=${row.version - 1} affected ${staleCheck.affected} row(s) -> conflict prevented!`
    });
  } catch (err) {
    await conn.rollback();
    return res.status(500).json({ error: 'Lock demo error' });
  } finally {
    conn.release();
  }
});

app.post('/api/dbms/sqli-test', requireAuth, requirePermission('dbms_lab', 'read'), async (req, res) => {
  const payload = String(req.body.payload || "' OR '1'='1");
  try {
    const [rows] = await db.query(
      'SELECT user_id, name, email, role FROM Users WHERE email = ?',
      [payload]
    );
    await logSecurityAudit(
      req.user.user_id,
      req.user.role,
      'SQLI_TEST_BLOCKED',
      'Users',
      `Tested payload safely via parameterized query: ${payload.slice(0, 60)}`
    );
    return res.json({
      tested_payload: payload,
      parameterized_sql: 'SELECT user_id, name, email, role FROM Users WHERE email = ?',
      rows_returned: rows.length,
      safe: true,
      explanation: 'Prepared statement treated the entire input as a literal string parameter, neutralizing SQL injection.'
    });
  } catch (err) {
    return res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/cache/stats', requireAuth, requirePermission('dbms_lab', 'read'), async (req, res) => {
  return res.json(await getCacheStats());
});

app.post('/api/cache/clear', requireAuth, requirePermission('dbms_lab', 'update'), async (req, res) => {
  await clearAllCache();
  return res.json({ message: 'Key-Value cache cleared (Memory + MongoDB KV Store)' });
});

app.post('/api/etl/run', requireAuth, requirePermission('analytics', 'create'), async (req, res) => {
  try {
    const summary = await runETLPipeline();
    return res.json(summary);
  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: 'ETL pipeline execution failed' });
  }
});

app.get('/api/etl/status', requireAuth, requirePermission('analytics', 'read'), async (req, res) => {
  try {
    const [facts] = await db.query(
      'SELECT * FROM dw_complaint_facts ORDER BY complaint_id ASC LIMIT 50'
    );
    const snapshots = await DataLakeSnapshot.find(
      {},
      { batch_id: 1, source: 1, extracted_at: 1, record_count: 1 }
    )
      .sort({ extracted_at: -1 })
      .limit(5)
      .lean();
    return res.json({ warehouse_facts: facts, data_lake_snapshots: snapshots });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load ETL status' });
  }
});

const PORT = process.env.PORT || 3000;

initializeDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log('Server running at http://localhost:' + PORT);
    });
  })
  .catch((err) => {
    console.error('Startup initialization failed:', err);
    process.exit(1);
  });
