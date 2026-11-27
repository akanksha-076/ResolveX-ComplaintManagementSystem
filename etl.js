const db = require('./db');
const { Comment, Feedback, DataLakeSnapshot } = require('./mongo');

async function runETLPipeline() {
  const startMs = Date.now();
  const batchId = 'ETL-' + new Date().toISOString().replace(/[:.]/g, '-');

  // 1. EXTRACT: Relational MySQL + Document MongoDB
  const [mysqlRows] = await db.query(
    `SELECT c.complaint_id,
            COALESCE(d.department_name, 'Unassigned') AS department_name,
            c.category,
            c.priority,
            c.status,
            DATE(c.created_at) AS complaint_date,
            fn_resolution_minutes(c.complaint_id) AS resolution_minutes,
            fn_sla_status(c.complaint_id) AS sla_status,
            c.created_at
     FROM Complaints c
     LEFT JOIN Departments d ON c.department_id = d.department_id
     ORDER BY c.complaint_id ASC`
  );

  const commentCounts = await Comment.aggregate([
    { $group: { _id: '$complaint_id', count: { $sum: 1 } } }
  ]);
  const commentMap = new Map(commentCounts.map((c) => [Number(c._id), c.count]));

  const feedbacks = await Feedback.find({}, { complaint_id: 1, rating: 1 }).lean();
  const feedbackMap = new Map(feedbacks.map((f) => [Number(f.complaint_id), f.rating]));

  // 2. TRANSFORM: Merge & standardize into analytical fact records
  const transformedFacts = mysqlRows.map((row) => {
    const compId = Number(row.complaint_id);
    const slaMet = row.sla_status === 'On Time' || row.sla_status === 'Within SLA' ? 1 : 0;
    return {
      complaint_id: compId,
      department_name: row.department_name,
      category: row.category,
      priority: row.priority,
      status: row.status,
      resolution_minutes: row.resolution_minutes,
      sla_met: slaMet,
      comment_count: commentMap.get(compId) || 0,
      feedback_rating: feedbackMap.get(compId) || null,
      complaint_date: row.complaint_date
    };
  });

  // 3a. LOAD (Data Lake): Archive raw semi-structured snapshot into MongoDB
  const lakeDoc = await DataLakeSnapshot.create({
    batch_id: batchId,
    source: 'ResolveX-MySQL+MongoDB-ETL',
    record_count: transformedFacts.length,
    raw_payload: {
      mysql_extracted: mysqlRows.length,
      mongo_comment_groups: commentCounts.length,
      mongo_feedbacks: feedbacks.length,
      records: transformedFacts
    }
  });

  // 3b. LOAD (Data Warehouse): Upsert star-schema facts into MySQL dw_complaint_facts
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    for (const fact of transformedFacts) {
      await conn.query(
        `INSERT INTO dw_complaint_facts
           (complaint_id, department_name, category, priority, status,
            resolution_minutes, sla_met, comment_count, feedback_rating, complaint_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           department_name = VALUES(department_name),
           category = VALUES(category),
           priority = VALUES(priority),
           status = VALUES(status),
           resolution_minutes = VALUES(resolution_minutes),
           sla_met = VALUES(sla_met),
           comment_count = VALUES(comment_count),
           feedback_rating = VALUES(feedback_rating),
           complaint_date = VALUES(complaint_date)`,
        [
          fact.complaint_id,
          fact.department_name,
          fact.category,
          fact.priority,
          fact.status,
          fact.resolution_minutes,
          fact.sla_met,
          fact.comment_count,
          fact.feedback_rating,
          fact.complaint_date
        ]
      );
    }

    await conn.query(
      `INSERT INTO Audit_Security_Logs (actor_user_id, actor_role, action, resource, details)
       VALUES (NULL, 'etl_pipeline', 'ETL_COMPLETED', 'dw_complaint_facts', ?)`,
      [`Batch ${batchId}: loaded ${transformedFacts.length} facts`]
    );

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  return {
    batch_id: batchId,
    extracted_count: mysqlRows.length,
    loaded_warehouse_rows: transformedFacts.length,
    data_lake_snapshot_id: String(lakeDoc._id),
    duration_ms: Date.now() - startMs
  };
}

module.exports = { runETLPipeline };
