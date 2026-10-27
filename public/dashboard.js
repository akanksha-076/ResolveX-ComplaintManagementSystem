const user = JSON.parse(localStorage.getItem('user'));

// If nobody is logged in, send them to the login page
if (!user) {
  window.location.href = 'login.html';
}

// Logout: remove the saved user
document.getElementById('logout').addEventListener('click', () => {
  localStorage.removeItem('user');
});

async function loadComplaints() {
  const res = await fetch('/api/complaints/user/' + user.user_id);
  const complaints = await res.json();

  const list = document.getElementById('complaintList');
  list.innerHTML = '';

  if (complaints.length === 0) {
    list.innerHTML = '<tr><td colspan="6">No complaints yet.</td></tr>';
    return;
  }

  complaints.forEach((c) => {
    const row = document.createElement('tr');

    // "In Progress" becomes the CSS class "progress"
    let statusClass = 'pending';
    if (c.status === 'In Progress') statusClass = 'progress';
    if (c.status === 'Resolved') statusClass = 'resolved';
    if (c.status === 'Rejected') statusClass = 'rejected';

    const date = new Date(c.created_at).toLocaleDateString();

    const values = [c.complaint_id, c.title, c.category, c.priority];
    values.forEach((v) => {
      const td = document.createElement('td');
      td.textContent = v;
      row.appendChild(td);
    });

    
    // Make the ID a link to the details page
    row.firstChild.innerHTML = '<a href="details.html?id=' + c.complaint_id + '">' + c.complaint_id + '</a>';

    const statusTd = document.createElement('td');
    statusTd.innerHTML = '<span class="status ' + statusClass + '">' + c.status + '</span>';
    row.appendChild(statusTd);

    const dateTd = document.createElement('td');
    dateTd.textContent = date;
    row.appendChild(dateTd);

    list.appendChild(row);
  });
}

loadComplaints();