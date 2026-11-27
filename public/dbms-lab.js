const user = ResolveX.requireLogin(['admin']);
if (user) {
  ResolveX.mountNavbarUser();
}

// Tab switching
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

function renderTable(boxId, headers, rows) {
  const box = document.getElementById(boxId);
  box.innerHTML = '';
  if (!rows || rows.length === 0) {
    box.innerHTML = '<p style="color:#64748b;margin:0;">No rows found.</p>';
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

// Unit 3: ACID Demo
async function runAcidDemo(mode) {
  const res = await ResolveX.apiFetch('/api/dbms/acid-demo', {
    method: 'POST',
    body: JSON.stringify({ mode })
  });
  const data = await res.json();
  document.getElementById('acidOutput').textContent = JSON.stringify(data, null, 2);
  ResolveX.showToast(data.outcome || 'Transaction executed', res.ok ? 'success' : 'error');
  loadSecurityData();
}

document.getElementById('acidCommitBtn').addEventListener('click', () => runAcidDemo('commit'));
document.getElementById('acidRollbackBtn').addEventListener('click', () => runAcidDemo('rollback'));

// Unit 3: Locking & Cursor Demo
document.getElementById('lockDemoBtn').addEventListener('click', async () => {
  const res = await ResolveX.apiFetch('/api/dbms/lock-demo', {
    method: 'POST',
    body: JSON.stringify({ complaint_id: 1 })
  });
  const data = await res.json();
  document.getElementById('lockOutput').textContent = JSON.stringify(data, null, 2);
  ResolveX.showToast('Locking verification complete', res.ok ? 'success' : 'error');
});

document.getElementById('cursorDemoBtn').addEventListener('click', async () => {
  const res = await ResolveX.apiFetch('/api/complaints/escalate', {
    method: 'POST',
    body: JSON.stringify({ hours: 24 })
  });
  const data = await res.json();
  document.getElementById('lockOutput').textContent = JSON.stringify(data, null, 2);
  ResolveX.showToast(data.message || 'Cursor procedure executed', res.ok ? 'info' : 'error');
  loadSecurityData();
});

// Unit 3: SQLi Tester
document.getElementById('sqliTestBtn').addEventListener('click', async () => {
  const payload = document.getElementById('sqliPayload').value;
  const res = await ResolveX.apiFetch('/api/dbms/sqli-test', {
    method: 'POST',
    body: JSON.stringify({ payload })
  });
  const data = await res.json();
  document.getElementById('sqliOutput').textContent = JSON.stringify(data, null, 2);
  ResolveX.showToast('SQL Injection payload safely neutralized', 'success');
  loadSecurityData();
});

// Unit 3: Users & RBAC Matrix & Audit Logs
async function loadSecurityData() {
  const [uRes, rRes] = await Promise.all([
    ResolveX.apiFetch('/api/users'),
    ResolveX.apiFetch('/api/rbac/permissions')
  ]);
  if (uRes.ok) {
    const users = await uRes.json();
    renderTable(
      'usersBox',
      ['ID', 'Name', 'Email', 'Role', 'Action'],
      users.map((u) => {
        const sel = document.createElement('select');
        ['student', 'department_staff', 'admin'].forEach((role) => {
          const opt = document.createElement('option');
          opt.value = role;
          opt.textContent = role;
          if (u.role === role) opt.selected = true;
          sel.appendChild(opt);
        });
        const btn = document.createElement('button');
        btn.className = 'btn btn-sm';
        btn.textContent = 'Save Role';
        btn.addEventListener('click', async () => {
          const res = await ResolveX.apiFetch(`/api/users/${u.user_id}/role`, {
            method: 'PUT',
            body: JSON.stringify({ role: sel.value })
          });
          const data = await res.json();
          ResolveX.showToast(data.message || data.error, res.ok ? 'success' : 'error');
          loadSecurityData();
        });
        return [u.user_id, u.name, u.email, sel, btn];
      })
    );
  }

  if (rRes.ok) {
    const rbac = await rRes.json();
    renderTable(
      'rbacMatrixBox',
      ['Role', 'Resource', 'Read', 'Create', 'Update', 'Delete'],
      (rbac.permissions || []).map((p) => [
        p.role,
        p.resource,
        p.can_read ? 'Yes' : '-',
        p.can_create ? 'Yes' : '-',
        p.can_update ? 'Yes' : '-',
        p.can_delete ? 'Yes' : '-'
      ])
    );

    renderTable(
      'auditLogBox',
      ['Audit ID', 'Actor Role', 'Action', 'Resource', 'Details', 'Time'],
      (rbac.auditLogs || []).map((a) => [
        a.audit_id,
        a.actor_role,
        a.action,
        a.resource,
        a.details,
        new Date(a.created_at).toLocaleString()
      ])
    );
  }
}

// Unit 4: EXPLAIN & Indexes
async function loadExplain() {
  const res = await ResolveX.apiFetch('/api/dbms/explain');
  if (!res.ok) return;
  const data = await res.json();

  document.getElementById('isolationChip').textContent = 'Isolation: ' + data.isolation_level;

  const box = document.getElementById('explainPlansBox');
  box.innerHTML = '';
  (data.plans || []).forEach((item) => {
    const wrap = document.createElement('div');
    wrap.style.marginBottom = '16px';
    const e = ResolveX.escapeHtml;
    let rowsHtml = '';
    item.plan.forEach((p) => {
      rowsHtml += `<tr>
        <td>${e(p.id)}</td>
        <td>${e(p.table)}</td>
        <td><strong>${e(p.type)}</strong></td>
        <td>${e(p.possible_keys || '-')}</td>
        <td><code>${e(p.key || 'FULL SCAN')}</code></td>
        <td>${e(p.rows)}</td>
        <td>${e(p.Extra || '-')}</td>
      </tr>`;
    });

    wrap.innerHTML =
      `<h4 style="margin:0 0 4px;">${e(item.name)}</h4>` +
      `<p style="margin:0 0 8px;"><code>${e(item.sql)}</code></p>` +
      `<div class="table-wrap"><table><thead><tr>
        <th>id</th><th>table</th><th>type</th><th>possible_keys</th><th>key</th><th>rows</th><th>Extra</th>
      </tr></thead><tbody>${rowsHtml}</tbody></table></div>`;
    box.appendChild(wrap);
  });

  renderTable(
    'btreeBox',
    ['Key Name', 'Column', 'Type', 'Cardinality'],
    (data.btree_indexes || []).map((i) => [i.key_name, i.column, i.index_type, i.cardinality ?? '-'])
  );

  renderTable(
    'hashBox',
    ['Key Name', 'Column', 'Type'],
    (data.hash_indexes || []).map((i) => [i.key_name, i.column, i.index_type])
  );
}

document.getElementById('refreshExplainBtn').addEventListener('click', loadExplain);

// Unit 4: KV Cache Stats
async function loadCacheStats() {
  const res = await ResolveX.apiFetch('/api/cache/stats');
  if (!res.ok) return;
  const data = await res.json();
  document.getElementById('cacheStatsBox').textContent = JSON.stringify(data, null, 2);
}

document.getElementById('clearCacheBtn').addEventListener('click', async () => {
  const res = await ResolveX.apiFetch('/api/cache/clear', { method: 'POST' });
  const data = await res.json();
  ResolveX.showToast(data.message, 'info');
  loadCacheStats();
});

loadSecurityData();
loadExplain();
loadCacheStats();
