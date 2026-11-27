const user = ResolveX.requireLogin(['admin', 'department_staff']);
if (user) {
  ResolveX.mountNavbarUser();
  if (user.role !== 'admin') {
    const labLink = document.getElementById('dbmsLabNav');
    if (labLink) labLink.style.display = 'none';
  }
}

function showTable(boxId, headers, rows) {
  const box = document.getElementById(boxId);
  box.innerHTML = '';

  if (!rows || rows.length === 0) {
    box.innerHTML = '<p style="color:#64748b;margin:0;">No records available yet.</p>';
    return;
  }

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headers.forEach((h) => {
    const th = document.createElement('th');
    th.textContent = h;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  rows.forEach((r) => {
    const tr = document.createElement('tr');
    r.forEach((v) => {
      const td = document.createElement('td');
      td.textContent = v;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  box.appendChild(table);
}

function renderBarChart(containerId, items, labelKey, valueKey) {
  const box = document.getElementById(containerId);
  box.innerHTML = '';
  if (!items || items.length === 0) return;

  const maxVal = Math.max(...items.map((i) => Number(i[valueKey]) || 0), 1);
  items.forEach((item) => {
    const val = Number(item[valueKey]) || 0;
    const pct = Math.round((val / maxVal) * 100);
    const row = document.createElement('div');
    row.className = 'bar-row';
    row.innerHTML =
      `<strong>${ResolveX.escapeHtml(item[labelKey])}</strong>` +
      `<div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>` +
      `<span style="text-align:right;font-weight:700;">${val}</span>`;
    box.appendChild(row);
  });
}

function formatTime(minutes) {
  if (minutes === null || minutes === undefined) return 'N/A';
  const m = Number(minutes);
  if (m < 60) return Math.round(m) + ' min';
  return (m / 60).toFixed(1) + ' hrs';
}

async function loadReports() {
  try {
    const res = await ResolveX.apiFetch('/api/analytics');
    const data = await res.json();
    if (!res.ok) {
      ResolveX.showToast(data.error || 'Failed to load analytics', 'error');
      return;
    }

    document.getElementById('cacheBadge').textContent = 'KV Cache: ' + (data.cache_status || 'Active');

    const resStats = data.resolution || {};
    const nosql = data.nosqlMetrics || {};
    document.getElementById('resolvedMetric').textContent = resStats.resolved_count || 0;
    document.getElementById('avgTimeMetric').textContent = formatTime(resStats.avg_minutes);
    document.getElementById('avgRatingMetric').textContent =
      nosql.avg_rating !== null && nosql.avg_rating !== undefined ? `${nosql.avg_rating} / 5` : 'No ratings';
    document.getElementById('mongoMetric').textContent =
      (nosql.total_comments || 0) + (nosql.total_activities || 0);

    renderBarChart('categoryChart', data.byCategory, 'category', 'total');
    renderBarChart('statusChart', data.byStatus, 'status', 'total');

    showTable(
      'categoryBox',
      ['Category', 'Total'],
      (data.byCategory || []).map((r) => [r.category, r.total])
    );

    showTable(
      'statusBox',
      ['Status', 'Total'],
      (data.byStatus || []).map((r) => [r.status, r.total])
    );

    showTable(
      'departmentBox',
      ['Department', 'Pending', 'In Progress', 'Resolved'],
      (data.byDepartment || []).map((r) => [r.department_name, r.pending, r.in_progress, r.resolved])
    );

    showTable(
      'slaBox',
      ['SLA State', 'Complaints'],
      (data.slaBreakdown || []).map((r) => [r.sla_status || 'Unknown', r.total])
    );
  } catch (err) {
    ResolveX.showToast('Error loading analytics', 'error');
  }
}

async function loadEtlStatus() {
  try {
    const res = await ResolveX.apiFetch('/api/etl/status');
    const data = await res.json();
    if (!res.ok) return;

    const facts = data.warehouse_facts || [];
    const snaps = data.data_lake_snapshots || [];
    document.getElementById('etlSummary').textContent =
      `Data Warehouse facts loaded: ${facts.length} row(s) | MongoDB Data Lake archive batches: ${snaps.length}`;

    showTable(
      'warehouseBox',
      ['Complaint ID', 'Department', 'Category', 'Priority', 'Status', 'Res (min)', 'SLA Met', 'Comments', 'Rating'],
      facts.map((f) => [
        '#' + f.complaint_id,
        f.department_name,
        f.category,
        f.priority,
        f.status,
        f.resolution_minutes ?? 'NULL',
        f.sla_met ? 'Yes' : 'No',
        f.comment_count,
        f.feedback_rating ?? '-'
      ])
    );

    showTable(
      'dataLakeBox',
      ['Batch ID', 'Source', 'Records', 'Extracted At'],
      snaps.map((s) => [
        s.batch_id,
        s.source,
        s.record_count,
        new Date(s.extracted_at).toLocaleString()
      ])
    );
  } catch (err) {
    // Non-fatal
  }
}

document.getElementById('runEtlBtn').addEventListener('click', async () => {
  const btn = document.getElementById('runEtlBtn');
  btn.disabled = true;
  btn.textContent = 'Running ETL...';
  try {
    const res = await ResolveX.apiFetch('/api/etl/run', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      ResolveX.showToast(
        `ETL Batch ${data.batch_id}: loaded ${data.loaded_warehouse_rows} facts in ${data.duration_ms}ms`,
        'success'
      );
      loadEtlStatus();
    } else {
      ResolveX.showToast(data.error || 'ETL run failed', 'error');
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run ETL Pipeline (MySQL + MongoDB)';
  }
});

loadReports();
loadEtlStatus();
