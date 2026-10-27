const user = JSON.parse(localStorage.getItem('user'));

// If nobody is logged in, send them to the login page
if (!user) {
  window.location.href = 'login.html';
}

document.getElementById('complaintForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const complaint = {
    user_id: user.user_id,
    title: document.getElementById('title').value,
    category: document.getElementById('category').value,
    location: document.getElementById('location').value,
    priority: document.getElementById('priority').value,
    description: document.getElementById('description').value
  };

  const res = await fetch('/api/complaints', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(complaint)
  });

  const data = await res.json();

  if (res.ok) {
    alert('Complaint submitted. Your complaint ID is ' + data.complaint_id);
    window.location.href = 'dashboard.html';
  } else {
    alert(data.error);
  }
});