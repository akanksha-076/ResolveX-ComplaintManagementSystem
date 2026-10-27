const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { Comment, Feedback, Activity } = require('./mongo');
const app = express();

app.use(express.json());
app.use(express.static('public'));

app.get('/api/test', (req, res) => {
  res.json({ message: 'ResolveX server is running' });
});

app.get('/api/departments', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM Departments');
    res.json(rows);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Register a new user
app.post('/api/register', async (req, res) => {
  const { name, email, password } = req.body;

  try {
    const [existing] = await db.query('SELECT user_id FROM Users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const hash = await bcrypt.hash(password, 10);

    await db.query(
      'INSERT INTO Users (name, email, password_hash) VALUES (?, ?, ?)',
      [name, email, hash]
    );

    res.json({ message: 'Registered successfully' });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const [rows] = await db.query('SELECT * FROM Users WHERE email = ?', [email]);

    if (rows.length === 0) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    res.json({
      user_id: user.user_id,
      name: user.name,
      role: user.role
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Submit a new complaint
app.post('/api/complaints', async (req, res) => {
  const { user_id, title, category, location, priority, description } = req.body;

  try {
    const [result] = await db.query(
      'INSERT INTO Complaints (user_id, title, category, location, priority, description) VALUES (?, ?, ?, ?, ?, ?)',
      [user_id, title, category, location, priority, description]
    );

    res.json({ message: 'Complaint submitted', complaint_id: result.insertId });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get all complaints of one student
app.get('/api/complaints/user/:id', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT complaint_id, title, category, priority, status, created_at FROM Complaints WHERE user_id = ? ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get all complaints (for admin)
app.get('/api/complaints', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT complaint_id, title, category, priority, department_id, status, created_at FROM Complaints ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Update department and status of a complaint (admin)
app.put('/api/complaints/:id', async (req, res) => {
  const { department_id, status } = req.body;
  const id = req.params.id;

  try {
    const [rows] = await db.query('SELECT status FROM Complaints WHERE complaint_id = ?', [id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Complaint not found' });
    }

    const oldStatus = rows[0].status;

    await db.query(
      'UPDATE Complaints SET department_id = ?, status = ? WHERE complaint_id = ?',
      [department_id || null, status, id]
    );

    // Save the change in Status_History only if the status changed
    if (oldStatus !== status) {
      await db.query(
        'INSERT INTO Status_History (complaint_id, old_status, new_status) VALUES (?, ?, ?)',
        [id, oldStatus, status]
      );
    }

    res.json({ message: 'Complaint updated' });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get one complaint with its department name (MySQL join)
app.get('/api/complaints/:id', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT c.*, d.department_name
       FROM Complaints c
       LEFT JOIN Departments d ON c.department_id = d.department_id
       WHERE c.complaint_id = ?`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Complaint not found' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get all comments of one complaint (MongoDB)
app.get('/api/comments/:complaintId', async (req, res) => {
  try {
    const comments = await Comment.find({ complaint_id: req.params.complaintId }).sort({ created_at: 1 });
    res.json(comments);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: 'MongoDB error' });
  }
});

// Add a comment (MongoDB)
app.post('/api/comments', async (req, res) => {
  const { complaint_id, user_id, user_name, role, comment } = req.body;

  try {
    await Comment.create({ complaint_id, user_id, user_name, role, comment });
    res.json({ message: 'Comment added' });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: 'MongoDB error' });
  }
});

// Get the feedback of one complaint (MongoDB)
app.get('/api/feedback/:complaintId', async (req, res) => {
  try {
    const feedback = await Feedback.findOne({ complaint_id: req.params.complaintId });
    res.json(feedback);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: 'MongoDB error' });
  }
});

// Save feedback (MongoDB), after checking the complaint in MySQL
app.post('/api/feedback', async (req, res) => {
  const { complaint_id, user_id, user_name, rating, feedback } = req.body;

  try {
    const [rows] = await db.query(
      'SELECT user_id, status FROM Complaints WHERE complaint_id = ?',
      [complaint_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Complaint not found' });
    }

    if (rows[0].user_id !== Number(user_id)) {
      return res.status(403).json({ error: 'Only the student who made the complaint can give feedback' });
    }

    if (rows[0].status !== 'Resolved') {
      return res.status(400).json({ error: 'Feedback can be given only after the complaint is resolved' });
    }

    const existing = await Feedback.findOne({ complaint_id });
    if (existing) {
      return res.status(400).json({ error: 'Feedback already given' });
    }

    await Feedback.create({ complaint_id, user_id, user_name, rating, feedback });
    res.json({ message: 'Feedback saved' });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Reports and analytics (admin)
app.get('/api/analytics', async (req, res) => {
  try {
    const [byCategory] = await db.query(
      'SELECT category, COUNT(*) AS total FROM Complaints GROUP BY category'
    );

    const [byStatus] = await db.query(
      'SELECT status, COUNT(*) AS total FROM Complaints GROUP BY status'
    );

    const [byDepartment] = await db.query(
      `SELECT d.department_name,
              IFNULL(SUM(c.status = 'Pending'), 0) AS pending,
              IFNULL(SUM(c.status = 'In Progress'), 0) AS in_progress
       FROM Departments d
       LEFT JOIN Complaints c ON c.department_id = d.department_id
       GROUP BY d.department_id, d.department_name`
    );

    // Resolved complaints and the average time from submission to resolution
    const [resolution] = await db.query(
      `SELECT COUNT(*) AS resolved_count,
              AVG(TIMESTAMPDIFF(MINUTE, c.created_at, r.resolved_at)) AS avg_minutes
       FROM Complaints c
       JOIN (SELECT complaint_id, MAX(changed_at) AS resolved_at
             FROM Status_History
             WHERE new_status = 'Resolved'
             GROUP BY complaint_id) r
         ON c.complaint_id = r.complaint_id
       WHERE c.status = 'Resolved'`
    );

    res.json({ byCategory, byStatus, byDepartment, resolution: resolution[0] });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.listen(3000, () => {
  console.log('Server running at http://localhost:3000');
});