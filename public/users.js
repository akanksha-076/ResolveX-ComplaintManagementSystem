const user = ResolveX.requireLogin(['admin']);
if (user) {
  ResolveX.mountNavbarUser();
}

function renderTable(boxId, headers, rows) {
  const box = document.getElementById(boxId);
  box.innerHTML = '';
  if (!rows || rows.length === 0) {
    box.innerHTML = '<p style="color:#64748b;margin:0;">No records found.</p>';
    return;
  }

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  headers.forEach((h) => {
    const th = document.createElement('th');
    th.textContent = h;
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  rows.forEach((r) => {
    const tr = document.createElement('tr');
    r.forEach((v) => {
      const td = document.createElement('td');
      if (v instanceof HTMLElement) td.appendChild(v);
      else td.textContent = v;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  box.appendChild(table);
}

async function loadUsers() {
  try {
    const res = await ResolveX.apiFetch('/api/users');
    const data = await res.json();
    if (!res.ok) {
      ResolveX.showToast(data.error || 'Failed to load users', 'error');
      return;
    }

    const users = data.users || [];
    renderTable(
      'usersBox',
      ['ID', 'Name', 'Email', 'Role', 'Joined', 'Action'],
      users.map((u) => {
        const sel = document.createElement('select');
        [
          { value: 'student', label: 'Student' },
          { value: 'department_staff', label: 'Department Staff' },
          { value: 'admin', label: 'Admin' }
        ].forEach((r) => {
          const opt = document.createElement('option');
          opt.value = r.value;
          opt.textContent = r.label;
          if (u.role === r.value) opt.selected = true;
          sel.appendChild(opt);
        });

        const btn = document.createElement('button');
        btn.className = 'btn btn-sm';
        btn.textContent = 'Save Role';
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            const upd = await ResolveX.apiFetch(`/api/users/${u.user_id}/role`, {
              method: 'PUT',
              body: JSON.stringify({ role: sel.value })
            });
            const msg = await upd.json();
            ResolveX.showToast(msg.message || msg.error, upd.ok ? 'success' : 'error');
            loadUsers();
          } finally {
            btn.disabled = false;
          }
        });

        return [
          '#' + u.user_id,
          u.name,
          u.email,
          sel,
          u.created_at ? new Date(u.created_at).toLocaleDateString() : '-',
          btn
        ];
      })
    );

    const logs = data.auditLogs || [];
    renderTable(
      'auditLogBox',
      ['Time', 'Role', 'Action', 'Details'],
      logs.map((l) => [
        new Date(l.created_at).toLocaleString(),
        l.actor_role,
        l.action,
        l.details || '-'
      ])
    );
  } catch (err) {
    ResolveX.showToast('Unable to load user accounts', 'error');
  }
}

loadUsers();
