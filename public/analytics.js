const user = ResolveX.requireLogin(['admin', 'department_staff']);
if (user) {
  ResolveX.mountNavbarUser();
  if (user.role !== 'admin') {
    const usersLink = document.getElementById('usersNav');
    if (usersLink) usersLink.style.display = 'none';
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

    const resStats = data.resolution || {};
    const fb = data.feedbackMetrics || {};
    document.getElementById('resolvedMetric').textContent = resStats.resolved_count || 0;
    document.getElementById('avgTimeMetric').textContent = formatTime(resStats.avg_minutes);
    document.getElementById('avgRatingMetric').textContent =
      fb.avg_rating !== null && fb.avg_rating !== undefined ? `${fb.avg_rating} / 5` : 'No ratings';
    document.getElementById('commentsMetric').textContent = fb.total_comments || 0;

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
      ['SLA Status', 'Complaints'],
      (data.slaBreakdown || []).map((r) => [r.sla_status || 'Unknown', r.total])
    );
  } catch (err) {
    ResolveX.showToast('Error loading analytics', 'error');
  }
}

async function loadSummaryTable() {
  try {
    const res = await ResolveX.apiFetch('/api/reports/summary');
    const facts = await res.json();
    if (!res.ok) return;

    showTable(
      'summaryTableBox',
      ['Complaint ID', 'Department', 'Category', 'Priority', 'Status', 'Resolution (min)', 'On Time', 'Comments', 'Rating'],
      facts.map((f) => [
        '#' + f.complaint_id,
        f.department_name,
        f.category,
        f.priority,
        f.status,
        f.resolution_minutes ?? '-',
        f.sla_met ? 'Yes' : 'No',
        f.comment_count,
        f.feedback_rating ? f.feedback_rating + '/5' : '-'
      ])
    );
  } catch (err) {
    // Non-fatal
  }
}

document.getElementById('syncReportBtn').addEventListener('click', async () => {
  const btn = document.getElementById('syncReportBtn');
  btn.disabled = true;
  btn.textContent = 'Refreshing...';
  try {
    const res = await ResolveX.apiFetch('/api/reports/sync', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      ResolveX.showToast(data.message || 'Summary refreshed', 'success');
      await loadReports();
      await loadSummaryTable();
    } else {
      ResolveX.showToast(data.error || 'Could not refresh summary', 'error');
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Refresh Summary';
  }
});

loadReports();
loadSummaryTable();
