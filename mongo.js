require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.log('MongoDB error:', err.message));

// Structure of one comment
const commentSchema = new mongoose.Schema({
  complaint_id: Number,
  user_id: Number,
  user_name: String,
  role: String,
  comment: String,
  created_at: { type: Date, default: Date.now }
});

const Comment = mongoose.model('Comment', commentSchema, 'complaint_comments');

// Structure of one feedback
const feedbackSchema = new mongoose.Schema({
  complaint_id: Number,
  user_id: Number,
  user_name: String,
  rating: Number,
  feedback: String,
  created_at: { type: Date, default: Date.now }
});

const Feedback = mongoose.model('Feedback', feedbackSchema, 'complaint_feedback');

// Structure of one activity log entry
const activitySchema = new mongoose.Schema({
  complaint_id: Number,
  user_name: String,
  role: String,
  action: String,
  created_at: { type: Date, default: Date.now }
});

const Activity = mongoose.model('Activity', activitySchema, 'activity_logs');

module.exports = { Comment, Feedback, Activity };