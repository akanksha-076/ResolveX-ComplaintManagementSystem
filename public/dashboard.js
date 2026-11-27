const user = ResolveX.requireLogin(['student', 'admin', 'department_staff']);
if (user) {
  ResolveX.mountNavbarUser();
}

let currentPage = 1;
let totalPages = 1;

async function loadComplaints() {
  if (!user) return;
  const q = document.getElementById('searchInput').value.trim();
  const status = document.getElementById('statusFilter').value;

  const params = new URLSearchParams({
    page: String(currentPage),
    limit: '8',
    status,
    q
  });

  try {
    const res = await ResolveX.apiFetch('/api/complaints/user/' + user.user_id + '?' + params.toString());
    const payload = await res.json();

    if (!res.ok) {
      ResolveX.showToast(payload.error || 'Failed to load complaints', 'error');
      return;
    }

    const stats = payload.stats || {};
    document.getElementById('myTotal').textContent = stats.total || 0;
    document.getElementById('myPending').textContent = stats.pending || 0;
    document.getElementById('myProgress').textContent = stats.in_progress || 0;
    document.getElementById('myResolved').textContent = stats.resolved || 0;

    const list = document.getElementById('complaintList');
    list.innerHTML = '';

    const complaints = payload.data || [];
    totalPages = payload.pagination ? payload.pagination.totalPages : 1;
    document.getElementById('pageInfo').textContent =
      `Page ${currentPage} of ${totalPages} (${payload.pagination?.total ?? complaints.length} total)`;
    document.getElementById('prevPage').disabled = currentPage <= 1;
    document.getElementById('nextPage').disabled = currentPage >= totalPages;

    if (complaints.length === 0) {
      list.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#64748b;">No matching complaints found.</td></tr>';
      return;
    }

    complaints.forEach((c) => {
      const row = document.createElement('tr');
      const e = ResolveX.escapeHtml;
      row.innerHTML =
        `<td><a href="details.html?id=${c.complaint_id}">#${c.complaint_id}</a></td>` +
        `<td><strong>${e(c.title)}</strong><br><small style="color:#64748b">${e(c.location)}</small></td>` +
        `<td>${e(c.category)}</td>` +
        `<td>${e(c.department_name || 'Unassigned')}</td>` +
        `<td><span class="status priority-${e(c.priority)}">${e(c.priority)}</span></td>` +
        `<td><span class="status ${ResolveX.statusClass(c.status)}">${e(c.status)}</span></td>` +
        `<td><span class="status ${ResolveX.slaClass(c.sla_status)}">${e(c.sla_status || 'Within SLA')}</span></td>` +
        `<td>${new Date(c.created_at).toLocaleDateString()}</td>`;
      list.appendChild(row);
    });
  } catch (err) {
    ResolveX.showToast('Unable to fetch complaints', 'error');
  }
}

document.getElementById('searchInput').addEventListener('input', () => {
  currentPage = 1;
  loadComplaints();
});

document.getElementById('statusFilter').addEventListener('change', () => {
  currentPage = 1;
  loadComplaints();
});

document.getElementById('prevPage').addEventListener('click', () => {
  if (currentPage > 1) {
    currentPage -= 1;
    loadComplaints();
  }
});

document.getElementById('nextPage').addEventListener('click', () => {
  if (currentPage < totalPages) {
    currentPage += 1;
    loadComplaints();
  }
});

loadComplaints();
