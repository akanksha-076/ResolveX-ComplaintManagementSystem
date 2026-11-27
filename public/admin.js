const user = ResolveX.requireLogin(['admin', 'department_staff']);
if (user) {
  ResolveX.mountNavbarUser();
  if (user.role !== 'admin') {
    const usersLink = document.getElementById('usersNav');
    if (usersLink) usersLink.style.display = 'none';
  }
}

const statuses = ['Pending', 'In Progress', 'Resolved', 'Rejected'];
let currentPage = 1;
let totalPages = 1;
let cachedDepartments = null;

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

async function getDepartments() {
  if (cachedDepartments) return cachedDepartments;
  const depRes = await ResolveX.apiFetch('/api/departments');
  cachedDepartments = await depRes.json();
  return cachedDepartments;
}

async function loadAdmin() {
  if (!user) return;
  try {
    const departments = await getDepartments();
    const params = new URLSearchParams({
      page: String(currentPage),
      limit: '10',
      q: document.getElementById('searchInput').value.trim(),
      status: document.getElementById('statusFilter').value,
      priority: document.getElementById('priorityFilter').value,
      category: document.getElementById('categoryFilter').value
    });

    const res = await ResolveX.apiFetch('/api/complaints?' + params.toString());
    const payload = await res.json();
    if (!res.ok) {
      ResolveX.showToast(payload.error || 'Failed to load complaints', 'error');
      return;
    }

    const stats = payload.stats || {};
    document.getElementById('totalCount').textContent = stats.total || 0;
    document.getElementById('pendingCount').textContent = stats.pending || 0;
    document.getElementById('progressCount').textContent = stats.in_progress || 0;
    document.getElementById('resolvedCount').textContent = stats.resolved || 0;

    const shown = payload.data || [];
    totalPages = payload.pagination ? payload.pagination.totalPages : 1;
    document.getElementById('pageInfo').textContent =
      `Page ${currentPage} of ${totalPages} (${payload.pagination?.total ?? shown.length} matching)`;
    document.getElementById('prevPage').disabled = currentPage <= 1;
    document.getElementById('nextPage').disabled = currentPage >= totalPages;

    const list = document.getElementById('adminList');
    list.innerHTML = '';

    if (shown.length === 0) {
      list.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#64748b;">No complaints match the current filter.</td></tr>';
      return;
    }

    const depOptions = [{ value: '', label: 'Not assigned' }].concat(
      departments.map((d) => ({ value: d.department_id, label: d.department_name }))
    );
    const statusOptions = statuses.map((s) => ({ value: s, label: s }));
    const e = ResolveX.escapeHtml;

    shown.forEach((c) => {
      const row = document.createElement('tr');

      const idTd = document.createElement('td');
      idTd.innerHTML = `<a href="details.html?id=${c.complaint_id}">#${c.complaint_id}</a>`;
      row.appendChild(idTd);

      const titleTd = document.createElement('td');
      titleTd.innerHTML =
        `<strong>${e(c.title)}</strong><br>` +
        `<small style="color:#64748b">${e(c.student_name || 'Student')} &bull; ${e(c.location)}</small>`;
      row.appendChild(titleTd);

      const catTd = document.createElement('td');
      catTd.textContent = c.category;
      row.appendChild(catTd);

      const priTd = document.createElement('td');
      priTd.innerHTML =
        `<span class="status priority-${e(c.priority)}">${e(c.priority)}</span><br>` +
        `<small><span class="status ${ResolveX.slaClass(c.sla_status)}" style="margin-top:4px;">${e(c.sla_status)}</span></small>`;
      row.appendChild(priTd);

      const depTd = document.createElement('td');
      const depSel = makeSelect(depOptions, c.department_id || '');
      depTd.appendChild(depSel);
      row.appendChild(depTd);

      const statusTd = document.createElement('td');
      const statusSel = makeSelect(statusOptions, c.status);
      statusTd.appendChild(statusSel);
      row.appendChild(statusTd);

      const actionTd = document.createElement('td');
      const button = document.createElement('button');
      button.className = 'btn btn-sm';
      button.textContent = 'Update';

      button.addEventListener('click', async () => {
        button.disabled = true;
        button.textContent = 'Saving...';
        try {
          const updRes = await ResolveX.apiFetch('/api/complaints/' + c.complaint_id, {
            method: 'PUT',
            body: JSON.stringify({
              department_id: depSel.value,
              status: statusSel.value,
              version: c.version
            })
          });
          const data = await updRes.json();
          if (updRes.ok) {
            ResolveX.showToast(`Complaint #${c.complaint_id} updated`, 'success');
          } else {
            ResolveX.showToast(data.error || 'Update failed', updRes.status === 409 ? 'warning' : 'error');
          }
          loadAdmin();
        } catch (err) {
          ResolveX.showToast('Network error updating complaint', 'error');
        } finally {
          button.disabled = false;
          button.textContent = 'Update';
        }
      });

      actionTd.appendChild(button);
      row.appendChild(actionTd);
      list.appendChild(row);
    });
  } catch (err) {
    ResolveX.showToast('Failed to fetch dashboard data', 'error');
  }
}

document.getElementById('escalateBtn').addEventListener('click', async () => {
  const btn = document.getElementById('escalateBtn');
  btn.disabled = true;
  try {
    const res = await ResolveX.apiFetch('/api/complaints/escalate', {
      method: 'POST',
      body: JSON.stringify({ hours: 24 })
    });
    const data = await res.json();
    if (res.ok) {
      ResolveX.showToast(data.message, 'info');
      loadAdmin();
    } else {
      ResolveX.showToast(data.error || 'Escalation failed', 'error');
    }
  } finally {
    btn.disabled = false;
  }
});

['searchInput', 'statusFilter', 'priorityFilter', 'categoryFilter'].forEach((id) => {
  const el = document.getElementById(id);
  const evt = id === 'searchInput' ? 'input' : 'change';
  el.addEventListener(evt, () => {
    currentPage = 1;
    loadAdmin();
  });
});

document.getElementById('prevPage').addEventListener('click', () => {
  if (currentPage > 1) {
    currentPage -= 1;
    loadAdmin();
  }
});

document.getElementById('nextPage').addEventListener('click', () => {
  if (currentPage < totalPages) {
    currentPage += 1;
    loadAdmin();
  }
});

loadAdmin();
