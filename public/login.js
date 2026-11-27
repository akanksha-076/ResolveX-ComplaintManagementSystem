document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const btn = document.getElementById('loginBtn');
  btn.disabled = true;
  btn.textContent = 'Signing in...';

  try {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();

    if (res.ok) {
      ResolveX.saveSession(data);
      ResolveX.showToast('Signed in as ' + data.name, 'success');
      setTimeout(() => {
        if (data.role === 'admin' || data.role === 'department_staff') {
          window.location.href = 'admin.html';
        } else {
          window.location.href = 'dashboard.html';
        }
      }, 300);
    } else {
      ResolveX.showToast(data.error || 'Login failed', 'error');
    }
  } catch (err) {
    ResolveX.showToast('Network error while signing in', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
});
