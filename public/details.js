const user = ResolveX.requireLogin(['student', 'admin', 'department_staff']);
if (user) {
  ResolveX.mountNavbarUser();
  document.getElementById('backLink').href =
    user.role === 'admin' || user.role === 'department_staff' ? 'admin.html' : 'dashboard.html';
}

const id = new URLSearchParams(window.location.search).get('id');
let complaint = null;

async function loadComplaint() {
  const res = await ResolveX.apiFetch('/api/complaints/' + id);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    document.getElementById('cSubtitle').textContent = err.error || 'Complaint not found.';
    ResolveX.showToast(err.error || 'Complaint not found', 'error');
    return false;
  }

  complaint = await res.json();
  const e = ResolveX.escapeHtml;

  document.getElementById('cId').textContent = complaint.complaint_id;
  document.getElementById('cTitle').textContent = complaint.title;
  document.getElementById('cSubtitle').textContent = `Submitted by ${complaint.student_name}`;
  document.getElementById('cStatusBadge').innerHTML =
    `<span class="status ${ResolveX.statusClass(complaint.status)}">${e(complaint.status)}</span>`;
  document.getElementById('cSlaBadge').innerHTML =
    `<span class="status ${ResolveX.slaClass(complaint.sla_status)}">${e(complaint.sla_status)}</span>`;

  document.getElementById('cCategory').textContent = complaint.category;
  document.getElementById('cDepartment').textContent = complaint.department_name || 'Not assigned';
  document.getElementById('cLocation').textContent = complaint.location;
  document.getElementById('cPriority').textContent =
    complaint.priority + (complaint.sla_policy ? ' (' + complaint.sla_policy + ')' : '');
  document.getElementById('cResolution').textContent =
    complaint.resolution_minutes !== null && complaint.resolution_minutes !== undefined
      ? complaint.resolution_minutes + ' min'
      : 'Pending resolution';
  document.getElementById('cCreated').textContent = new Date(complaint.created_at).toLocaleDateString();
  document.getElementById('cDescription').textContent = complaint.description;

  const histBox = document.getElementById('historyBox');
  histBox.innerHTML = '';
  const history = complaint.status_history || [];
  if (history.length === 0) {
    histBox.textContent = 'No status updates recorded yet.';
  } else {
    history.forEach((h) => {
      const div = document.createElement('div');
      div.className = 'timeline-item';
      div.innerHTML =
        `<strong>${e(h.old_status || 'New')} &rarr; ${e(h.new_status)}</strong>` +
        `<p>By ${e(h.changed_by || 'System')} &bull; ${new Date(h.changed_at).toLocaleString()}</p>`;
      histBox.appendChild(div);
    });
  }

  return true;
}

async function loadComments() {
  const res = await ResolveX.apiFetch('/api/comments/' + id);
  const comments = await res.json();
  const box = document.getElementById('commentList');
  box.innerHTML = '';

  if (!Array.isArray(comments) || comments.length === 0) {
    box.innerHTML = '<p style="color:#64748b;margin:0;">No comments yet. Start the discussion below.</p>';
    return;
  }

  comments.forEach((c) => {
    const div = document.createElement('div');
    div.className = 'comment';
    div.innerHTML =
      `<strong>${ResolveX.escapeHtml(c.user_name)}</strong> ` +
      `<span class="role-chip">${ResolveX.escapeHtml(c.role.replace('_', ' '))}</span>` +
      `<small>${new Date(c.created_at).toLocaleString()}</small>` +
      `<p>${ResolveX.escapeHtml(c.comment)}</p>`;
    box.appendChild(div);
  });
}

async function loadFeedback() {
  const box = document.getElementById('feedbackBox');
  box.innerHTML = '';

  const res = await ResolveX.apiFetch('/api/feedback/' + id);
  const feedback = await res.json();

  if (feedback) {
    const stars = '★'.repeat(feedback.rating) + '☆'.repeat(5 - feedback.rating);
    box.innerHTML =
      `<p style="margin:0 0 6px;font-size:18px;color:#d97706;">${stars} <span style="font-size:14px;color:#0f172a;font-weight:700;">(${feedback.rating}/5)</span></p>` +
      `<p style="margin:0;color:#475569;">${ResolveX.escapeHtml(feedback.feedback)}</p>`;
    return;
  }

  const isOwner = complaint && complaint.user_id === user.user_id;
  if (isOwner && complaint.status === 'Resolved') {
    box.innerHTML =
      `<form id="feedbackForm">
        <label for="rating">Rating</label>
        <select id="rating">
          <option value="5">5 — Excellent</option>
          <option value="4">4 — Good</option>
          <option value="3">3 — Average</option>
          <option value="2">2 — Poor</option>
          <option value="1">1 — Very Poor</option>
        </select>
        <label for="feedbackText">Feedback</label>
        <textarea id="feedbackText" rows="3" placeholder="Share how well the issue was resolved" required></textarea>
        <button type="submit" class="btn btn-sm" style="margin-top:10px;">Submit Feedback</button>
      </form>`;

    document.getElementById('feedbackForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const saveRes = await ResolveX.apiFetch('/api/feedback', {
        method: 'POST',
        body: JSON.stringify({
          complaint_id: Number(id),
          rating: Number(document.getElementById('rating').value),
          feedback: document.getElementById('feedbackText').value.trim()
        })
      });
      const data = await saveRes.json();
      if (saveRes.ok) {
        ResolveX.showToast('Thank you! Your feedback has been submitted.', 'success');
        loadFeedback();
        loadActivity();
      } else {
        ResolveX.showToast(data.error || 'Could not save feedback', 'error');
      }
    });
  } else {
    box.innerHTML = '<p style="color:#64748b;margin:0;">Feedback can be submitted once the complaint is resolved.</p>';
  }
}

async function loadActivity() {
  const res = await ResolveX.apiFetch('/api/activity/' + id);
  const logs = await res.json();
  const box = document.getElementById('timelineBox');
  box.innerHTML = '';

  if (!Array.isArray(logs) || logs.length === 0) {
    box.textContent = 'No activity recorded yet.';
    return;
  }

  logs.forEach((l) => {
    const div = document.createElement('div');
    div.className = 'timeline-item';
    div.innerHTML =
      `<strong>${ResolveX.escapeHtml(l.action)}</strong>` +
      `<p>by ${ResolveX.escapeHtml(l.user_name)} (${ResolveX.escapeHtml(l.role.replace('_', ' '))}) &bull; ${new Date(l.created_at).toLocaleString()}</p>`;
    box.appendChild(div);
  });
}

document.getElementById('commentForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const textBox = document.getElementById('commentText');
  const res = await ResolveX.apiFetch('/api/comments', {
    method: 'POST',
    body: JSON.stringify({
      complaint_id: Number(id),
      comment: textBox.value.trim()
    })
  });
  const data = await res.json();
  if (res.ok) {
    textBox.value = '';
    ResolveX.showToast('Comment posted', 'success');
    loadComments();
    loadActivity();
  } else {
    ResolveX.showToast(data.error || 'Error adding comment', 'error');
  }
});

async function start() {
  if (!id || !user) return;
  const found = await loadComplaint();
  if (found) {
    loadComments();
    loadFeedback();
    loadActivity();
  }
}

start();
