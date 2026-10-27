const user = JSON.parse(localStorage.getItem('user'));

// Only admins can open this page
if (!user || user.role !== 'admin') {
  window.location.href = 'login.html';
}

document.getElementById('logout').addEventListener('click', () => {
  localStorage.removeItem('user');
});

// Builds a simple table inside a box
function showTable(boxId, headers, rows) {
  const box = document.getElementById(boxId);
  box.innerHTML = '';

  if (rows.length === 0) {
    box.textContent = 'No data yet.';
    return;
  }

  const table = document.createElement('table');

  const headRow = document.createElement('tr');
  headers.forEach((h) => {
    const th = document.createElement('th');
    th.textContent = h;
    headRow.appendChild(th);
  });
  table.appendChild(headRow);

  rows.forEach((r) => {
    const tr = document.createElement('tr');
    r.forEach((v) => {
      const td = document.createElement('td');
      td.textContent = v;
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });

  box.appendChild(table);
}

// Shows minutes if less than an hour, otherwise hours
function formatTime(minutes) {
  if (minutes === null || minutes === undefined) return 'Not available';
  const m = Number(minutes);
  if (m < 60) return Math.round(m) + ' minutes';
  return (m / 60).toFixed(1) + ' hours';
}

async function loadReports() {
  const res = await fetch('/api/analytics');
  const data = await res.json();

  showTable(
    'categoryBox',
    ['Category', 'Total'],
    data.byCategory.map((r) => [r.category, r.total])
  );

  showTable(
    'statusBox',
    ['Status', 'Total'],
    data.byStatus.map((r) => [r.status, r.total])
  );

  showTable(
    'departmentBox',
    ['Department', 'Pending', 'In Progress'],
    data.byDepartment.map((r) => [r.department_name, r.pending, r.in_progress])
  );

  showTable(
    'resolutionBox',
    ['Resolved Complaints', 'Average Resolution Time'],
    [[data.resolution.resolved_count, formatTime(data.resolution.avg_minutes)]]
  );
}

loadReports();