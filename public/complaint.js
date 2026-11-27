const user = ResolveX.requireLogin(['student', 'admin', 'department_staff']);
if (user) {
  ResolveX.mountNavbarUser();
}

document.getElementById('complaintForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.textContent = 'Submitting transaction...';

  const complaint = {
    title: document.getElementById('title').value.trim(),
    category: document.getElementById('category').value,
    location: document.getElementById('location').value.trim(),
    priority: document.getElementById('priority').value,
    description: document.getElementById('description').value.trim()
  };

  try {
    const res = await ResolveX.apiFetch('/api/complaints', {
      method: 'POST',
      body: JSON.stringify(complaint)
    });

    const data = await res.json();
    if (res.ok) {
      ResolveX.showToast('Complaint #' + data.complaint_id + ' submitted cleanly!', 'success');
      setTimeout(() => {
        window.location.href = 'dashboard.html';
      }, 650);
    } else {
      ResolveX.showToast(data.error || 'Submission failed', 'error');
    }
  } catch (err) {
    ResolveX.showToast('Network error submitting complaint', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit Complaint';
  }
});
