require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { initializeDatabase } = require('./dbInit');
const { Comment, Feedback, Activity } = require('./mongo');
const { signToken, requireAuth, requirePermission } = require('./middleware/auth');
const { getCache, setCache, invalidatePrefix } = require('./kvCache');
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
  res.json({ message: 'ResolveX server is running' });
});

// Get all departments (cached)
app.get('/api/departments', async (req, res) => {
  try {
    const cached = await getCache('departments:all');
    if (cached) {
      return res.json(cached.value);
    }

    const [rows] = await db.query('SELECT * FROM Departments ORDER BY department_id ASC');
    await setCache('departments:all', rows, 300);
    return res.json(rows);
  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// Register a new student account
app.post('/api/register', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (!name || !email || password.length < 4) {
    return res.status(400).json({ error: 'Name, valid email, and password (min 4 characters) are required' });
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

// Login with JWT + RBAC role
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

    const token = signToken({
      user_id: user.user_id,
      name: user.name,
      email: user.email,
      role: user.role
    });

    await logSecurityAudit(user.user_id, user.role, 'LOGIN_SUCCESS', 'Users', `Signed in: ${email}`);

    return res.json({
      token,
      user_id: user.user_id,
      name: user.name,
      email: user.email,
      role: user.role
    });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// Submit a new complaint (MySQL transaction with savepoint)
app.post('/api/complaints', requireAuth, requirePermission('complaints', 'create'), async (req, res) => {
  const title = String(req.body.title || '').trim();
  const category = String(req.body.category || '').trim();
  const location = String(req.body.location || '').trim();
  const priority = String(req.body.priority || '').trim();
  const description = String(req.body.description || '').trim();
  const user_id = req.user.user_id;

  if (!title || !category || !location || !priority || !description) {
    return res.status(400).json({ error: 'Please fill in all complaint fields' });
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
    return res.status(500).json({ error: 'Could not save complaint. Please try again.' });
  } finally {
    conn.release();
  }
});

// Get paginated complaints for one student
app.get('/api/complaints/user/:id', requireAuth, requirePermission('complaints', 'read'), async (req, res) => {
  const targetUserId = Number(req.params.id);
  if (req.user.role !== 'admin' && req.user.user_id !== targetUserId) {
    return res.status(403).json({ error: 'You can view only your own complaints.' });
  }

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 8));
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
              IFNULL(SUM(status = 'Resolved'), 0) AS resolved
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

// Get paginated complaints for admin / department staff
app.get('/api/complaints', requireAuth, requirePermission('complaints', 'read'), async (req, res) => {
  if (req.user.role === 'student') {
    return res.status(403).json({ error: 'Access denied.' });
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
              fn_sla_status(c.complaint_id) AS sla_status
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
              IFNULL(SUM(status = 'Resolved'), 0) AS resolved
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

// Get one complaint with department, SLA policy & status history
app.get('/api/complaints/:id', requireAuth, requirePermission('complaints', 'read'), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT c.*, u.name AS student_name,
              d.department_name,
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
      return res.status(403).json({ error: 'You can view only your own complaints.' });
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

// Update complaint department & status (with optimistic concurrency check)
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
          error: 'Someone else updated this complaint just now. Refreshing latest data.'
        });
      }
      if (outRow.affected < 0) {
        return res.status(500).json({ error: 'Update failed. Changes were rolled back.' });
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

    return res.json({ message: 'Complaint updated' });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// Escalate overdue pending complaints (uses MySQL cursor stored procedure)
app.post('/api/complaints/escalate', requireAuth, requirePermission('complaints', 'update'), async (req, res) => {
  const hours = Math.max(0, Number(req.body.hours ?? 24));
  try {
    await db.query('CALL sp_escalate_overdue_complaints(?, @escalated)', [hours]);
    const [[result]] = await db.query('SELECT @escalated AS escalated');
    await invalidatePrefix('analytics:');
    return res.json({
      message:
        result.escalated > 0
          ? `${result.escalated} overdue pending complaint(s) escalated to High priority.`
          : 'No overdue pending complaints found.',
      escalated_count: result.escalated
    });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: 'Could not escalate complaints' });
  }
});

// Comments (MongoDB)
app.get('/api/comments/:complaintId', requireAuth, requirePermission('comments', 'read'), async (req, res) => {
  try {
    const comments = await Comment.find({ complaint_id: Number(req.params.complaintId) }).sort({ created_at: 1 });
    return res.json(comments);
  } catch (err) {
    return res.status(500).json({ error: 'Database error' });
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
    return res.status(500).json({ error: 'Database error' });
  }
});

// Feedback (MongoDB, validated against MySQL)
app.get('/api/feedback/:complaintId', requireAuth, requirePermission('feedback', 'read'), async (req, res) => {
  try {
    const feedback = await Feedback.findOne({ complaint_id: Number(req.params.complaintId) });
    return res.json(feedback);
  } catch (err) {
    return res.status(500).json({ error: 'Database error' });
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

// Activity timeline (MongoDB)
app.get('/api/activity/:complaintId', requireAuth, requirePermission('complaints', 'read'), async (req, res) => {
  try {
    const logs = await Activity.find({ complaint_id: Number(req.params.complaintId) }).sort({ created_at: 1 });
    return res.json(logs);
  } catch (err) {
    return res.status(500).json({ error: 'Database error' });
  }
});

// Reports & Analytics (cached)
app.get('/api/analytics', requireAuth, requirePermission('analytics', 'read'), async (req, res) => {
  try {
    const cached = await getCache('analytics:summary');
    if (cached) {
      return res.json(cached.value);
    }

    const [byCategory] = await db.query(
      'SELECT category, COUNT(*) AS total FROM Complaints GROUP BY category ORDER BY total DESC'
    );
    const [byStatus] = await db.query(
      'SELECT status, COUNT(*) AS total FROM Complaints GROUP BY status'
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

    const payload = {
      byCategory,
      byStatus,
      byDepartment,
      resolution,
      slaBreakdown,
      feedbackMetrics: {
        avg_rating: mongoFeedbackStats ? Number(mongoFeedbackStats.avg_rating.toFixed(2)) : null,
        total_reviews: mongoFeedbackStats ? mongoFeedbackStats.total_reviews : 0,
        total_comments: totalComments
      }
    };

    await setCache('analytics:summary', payload, 45);
    return res.json(payload);
  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// Refresh report summary table (runs ETL sync in background)
app.post('/api/reports/sync', requireAuth, requirePermission('analytics', 'create'), async (req, res) => {
  try {
    const summary = await runETLPipeline();
    await invalidatePrefix('analytics:');
    return res.json({
      message: `Report summary refreshed (${summary.loaded_warehouse_rows} records).`,
      ...summary
    });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: 'Could not refresh report summary' });
  }
});

app.get('/api/reports/summary', requireAuth, requirePermission('analytics', 'read'), async (req, res) => {
  try {
    const [facts] = await db.query(
      'SELECT * FROM dw_complaint_facts ORDER BY complaint_id DESC LIMIT 50'
    );
    return res.json(facts);
  } catch (err) {
    return res.status(500).json({ error: 'Database error' });
  }
});

// User & Role Management (Admin)
app.get('/api/users', requireAuth, requirePermission('users_rbac', 'read'), async (req, res) => {
  try {
    const [users] = await db.query(
      'SELECT user_id, name, email, role, created_at FROM Users ORDER BY user_id ASC'
    );
    const [auditLogs] = await db.query(
      'SELECT audit_id, actor_role, action, resource, details, created_at FROM Audit_Security_Logs ORDER BY audit_id DESC LIMIT 15'
    );
    return res.json({ users, auditLogs });
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
    return res.status(400).json({ error: 'You cannot remove your own admin role.' });
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
    return res.json({ message: 'User role updated' });
  } catch (err) {
    return res.status(500).json({ error: 'Database error' });
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
