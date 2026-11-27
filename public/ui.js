// Shared ResolveX UI, JWT Session & Toast Utilities
(function () {
  function getSession() {
    try {
      return JSON.parse(localStorage.getItem('user'));
    } catch {
      return null;
    }
  }

  function saveSession(data) {
    localStorage.setItem('user', JSON.stringify(data));
  }

  function clearSession() {
    localStorage.removeItem('user');
  }

  function requireLogin(allowedRoles) {
    const session = getSession();
    if (!session || !session.token) {
      window.location.href = 'login.html';
      return null;
    }
    if (allowedRoles && !allowedRoles.includes(session.role)) {
      window.location.href = session.role === 'admin' ? 'admin.html' : 'dashboard.html';
      return null;
    }
    return session;
  }

  async function apiFetch(url, options = {}) {
    const session = getSession();
    const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    if (session && session.token) {
      headers['Authorization'] = 'Bearer ' + session.token;
    }
    const res = await fetch(url, Object.assign({}, options, { headers }));
    if (res.status === 401) {
      clearSession();
      window.location.href = 'login.html';
      throw new Error('Session expired');
    }
    return res;
  }

  function showToast(message, type = 'info') {
    let container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 3600);
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function statusClass(status) {
    if (status === 'In Progress') return 'progress';
    if (status === 'Resolved') return 'resolved';
    if (status === 'Rejected') return 'rejected';
    return 'pending';
  }

  function slaClass(sla) {
    if (sla === 'On Time') return 'sla-ontime';
    if (sla === 'SLA Breached') return 'sla-breached';
    return 'sla-within';
  }

  function mountNavbarUser() {
    const session = getSession();
    const badge = document.getElementById('navUserBadge');
    if (badge && session) {
      badge.innerHTML =
        escapeHtml(session.name) +
        ' <span class="role-chip">' +
        escapeHtml(session.role.replace('_', ' ')) +
        '</span>';
    }
    const logoutBtn = document.getElementById('logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        clearSession();
      });
    }
  }

  window.ResolveX = {
    getSession,
    saveSession,
    clearSession,
    requireLogin,
    apiFetch,
    showToast,
    escapeHtml,
    statusClass,
    slaClass,
    mountNavbarUser
  };
})();
