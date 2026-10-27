const user = JSON.parse(localStorage.getItem('user'));

// Only admins can open this page
if (!user || user.role !== 'admin') {
  window.location.href = 'login.html';
}

document.getElementById('logout').addEventListener('click', () => {
  localStorage.removeItem('user');
});

const statuses = ['Pending', 'In Progress', 'Resolved', 'Rejected'];

// Makes a dropdown with one option selected
function makeSelect(options, selected) {
  const select = document.createElement('select');

  options.forEach((o) => {
    const option = document.createElement('option');
    option.value = o.value;
    option.textContent = o.label;
    if (String(o.value) === String(selected)) option.selected = true;
    select.appendChild(option);
  });

  return select;
}

async function loadAdmin() {
  const depRes = await fetch('/api/departments');
  const departments = await depRes.json();

  const res = await fetch('/api/complaints');
  const complaints = await res.json();

  // Number cards (always count all complaints)
  document.getElementById('totalCount').textContent = complaints.length;
  document.getElementById('pendingCount').textContent =
    complaints.filter((c) => c.status === 'Pending').length;
  document.getElementById('progressCount').textContent =
    complaints.filter((c) => c.status === 'In Progress').length;
  document.getElementById('resolvedCount').textContent =
    complaints.filter((c) => c.status === 'Resolved').length;

  // Apply the status filter to the table
  const filter = document.getElementById('statusFilter').value;
  const shown = filter === 'All'
    ? complaints
    : complaints.filter((c) => c.status === filter);

  const list = document.getElementById('adminList');
  list.innerHTML = '';

  if (shown.length === 0) {
    list.innerHTML = '<tr><td colspan="7">No complaints found.</td></tr>';
    return;
  }

  // Department options: "Not assigned" + all departments
  const depOptions = [{ value: '', label: 'Not assigned' }];
  departments.forEach((d) => {
    depOptions.push({ value: d.department_id, label: d.department_name });
  });

  const statusOptions = statuses.map((s) => ({ value: s, label: s }));

  shown.forEach((c) => {
    const row = document.createElement('tr');

    [c.complaint_id, c.title, c.category, c.priority].forEach((v) => {
      const td = document.createElement('td');
      td.textContent = v;
      row.appendChild(td);
    });

    
    // Make the ID a link to the details page
    row.firstChild.innerHTML = '<a href="details.html?id=' + c.complaint_id + '">' + c.complaint_id + '</a>';

    const depTd = document.createElement('td');
    depTd.appendChild(makeSelect(depOptions, c.department_id || ''));
    row.appendChild(depTd);

    const statusTd = document.createElement('td');
    statusTd.appendChild(makeSelect(statusOptions, c.status));
    row.appendChild(statusTd);

    const actionTd = document.createElement('td');
    const button = document.createElement('button');
    button.className = 'btn';
    button.textContent = 'Update';

    // Save the department and status of this complaint
    button.addEventListener('click', async () => {
      const selects = row.querySelectorAll('select');

      const res = await fetch('/api/complaints/' + c.complaint_id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          department_id: selects[0].value,
          status: selects[1].value
        })
      });

      const data = await res.json();
      alert(data.message || data.error);
      loadAdmin();
    });

    actionTd.appendChild(button);
    row.appendChild(actionTd);

    list.appendChild(row);
  });
}

// Reload the table when the filter changes
document.getElementById('statusFilter').addEventListener('change', loadAdmin);

loadAdmin();