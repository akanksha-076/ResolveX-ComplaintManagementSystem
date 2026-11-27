require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.log('MongoDB error:', err.message));

// 1. Document Store: Complaint Comments (indexed by complaint_id + created_at)
const commentSchema = new mongoose.Schema({
  complaint_id: { type: Number, required: true, index: true },
  user_id: { type: Number, required: true },
  user_name: { type: String, required: true },
  role: { type: String, required: true },
  comment: { type: String, required: true },
  created_at: { type: Date, default: Date.now }
});
commentSchema.index({ complaint_id: 1, created_at: 1 });

const Comment = mongoose.model('Comment', commentSchema, 'complaint_comments');

// 2. Document Store: Complaint Feedback (unique per complaint_id)
const feedbackSchema = new mongoose.Schema({
  complaint_id: { type: Number, required: true, unique: true },
  user_id: { type: Number, required: true },
  user_name: { type: String, required: true },
  rating: { type: Number, min: 1, max: 5, required: true },
  feedback: { type: String, required: true },
  created_at: { type: Date, default: Date.now }
});

const Feedback = mongoose.model('Feedback', feedbackSchema, 'complaint_feedback');

// 3. Document Store: Activity Logs (indexed timeline)
const activitySchema = new mongoose.Schema({
  complaint_id: { type: Number, required: true, index: true },
  user_name: { type: String, required: true },
  role: { type: String, required: true },
  action: { type: String, required: true },
  created_at: { type: Date, default: Date.now }
});
activitySchema.index({ complaint_id: 1, created_at: 1 });

const Activity = mongoose.model('Activity', activitySchema, 'activity_logs');

// 4. Key-Value Store (MongoDB-backed TTL cache collection)
const kvStoreSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
  expires_at: { type: Date, required: true }
});
kvStoreSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

const KVStore = mongoose.model('KVStore', kvStoreSchema, 'kv_store');

// 5. Data Lake Snapshot Collection (raw semi-structured JSON archive for ETL)
const dataLakeSchema = new mongoose.Schema({
  batch_id: { type: String, required: true, index: true },
  source: { type: String, default: 'ResolveX-Hybrid-ETL' },
  extracted_at: { type: Date, default: Date.now },
  record_count: { type: Number, required: true },
  raw_payload: { type: mongoose.Schema.Types.Mixed, required: true }
});

const DataLakeSnapshot = mongoose.model('DataLakeSnapshot', dataLakeSchema, 'data_lake_snapshots');

module.exports = { Comment, Feedback, Activity, KVStore, DataLakeSnapshot };
