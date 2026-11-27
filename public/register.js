document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const btn = document.getElementById('regBtn');
  btn.disabled = true;
  btn.textContent = 'Creating account...';

  try {
    const name = document.getElementById('name').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    });

    const data = await res.json();

    if (res.ok) {
      ResolveX.showToast('Account registered! Redirecting to login...', 'success');
      setTimeout(() => {
        window.location.href = 'login.html';
      }, 600);
    } else {
      ResolveX.showToast(data.error || 'Registration failed', 'error');
    }
  } catch (err) {
    ResolveX.showToast('Network error during registration', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Account';
  }
});
