const user = JSON.parse(localStorage.getItem('user'));

// If nobody is logged in, send them to the login page
if (!user) {
  window.location.href = 'login.html';
}

// The complaint id comes from the address: details.html?id=1
const id = new URLSearchParams(window.location.search).get('id');

// The Back link depends on the role
document.getElementById('backLink').href =
  user.role === 'admin' ? 'admin.html' : 'dashboard.html';

document.getElementById('logout').addEventListener('click', () => {
  localStorage.removeItem('user');
});

let complaint = null;

// Show the complaint (MySQL)
async function loadComplaint() {
  const res = await fetch('/api/complaints/' + id);

  if (!res.ok) {
    document.querySelector('.info').textContent = 'Complaint not found.';
    return false;
  }

  complaint = await res.json();

  document.getElementById('cId').textContent = complaint.complaint_id;
  document.getElementById('cTitle').textContent = complaint.title;
  document.getElementById('cCategory').textContent = complaint.category;
  document.getElementById('cLocation').textContent = complaint.location;
  document.getElementById('cPriority').textContent = complaint.priority;
  document.getElementById('cStatus').textContent = complaint.status;
  document.getElementById('cDepartment').textContent = complaint.department_name || 'Not assigned';
  document.getElementById('cDescription').textContent = complaint.description;

  return true;
}

// Show the comments (MongoDB)
async function loadComments() {
  const res = await fetch('/api/comments/' + id);
  const comments = await res.json();

  const box = document.getElementById('commentList');
  box.innerHTML = '';

  if (comments.length === 0) {
    box.textContent = 'No comments yet.';
    return;
  }

  comments.forEach((c) => {
    const div = document.createElement('div');
    div.className = 'comment';

    const who = document.createElement('strong');
    who.textContent = c.user_name + ' (' + c.role + ')';

    const time = document.createElement('small');
    time.textContent = ' ' + new Date(c.created_at).toLocaleString();

    const text = document.createElement('p');
    text.textContent = c.comment;

    div.appendChild(who);
    div.appendChild(time);
    div.appendChild(text);
    box.appendChild(div);
  });
}

// Show the feedback (MongoDB), or the feedback form for the student
async function loadFeedback() {
  const box = document.getElementById('feedbackBox');
  box.innerHTML = '';

  const res = await fetch('/api/feedback/' + id);
  const feedback = await res.json();

  // Feedback already given: show it
  if (feedback) {
    const rating = document.createElement('p');
    rating.textContent = 'Rating: ' + feedback.rating + ' / 5';

    const text = document.createElement('p');
    text.textContent = feedback.feedback;

    box.appendChild(rating);
    box.appendChild(text);
    return;
  }

  // The student who made the complaint can give feedback once it is resolved
  const isOwner = complaint.user_id === user.user_id;

  if (isOwner && complaint.status === 'Resolved') {
    box.innerHTML =
      '<form id="feedbackForm">' +
      '<label>Rating</label>' +
      '<select id="rating">' +
      '<option>5</option><option>4</option><option>3</option><option>2</option><option>1</option>' +
      '</select>' +
      '<textarea id="feedbackText" rows="3" placeholder="Write your feedback" required></textarea>' +
      '<button type="submit" class="btn">Submit Feedback</button>' +
      '</form>';

    document.getElementById('feedbackForm').addEventListener('submit', async (e) => {
      e.preventDefault();

      const saveRes = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          complaint_id: Number(id),
          user_id: user.user_id,
          user_name: user.name,
          rating: Number(document.getElementById('rating').value),
          feedback: document.getElementById('feedbackText').value
        })
      });

      const data = await saveRes.json();

      if (saveRes.ok) {
        loadFeedback();
        loadActivity();
      } else {
        alert(data.error);
      }
    });
  } else {
    box.textContent = 'No feedback yet. The student can give feedback after the complaint is resolved.';
  }
}

// Show the activity timeline (MongoDB)
async function loadActivity() {
  const res = await fetch('/api/activity/' + id);
  const logs = await res.json();

  const box = document.getElementById('timelineBox');
  box.innerHTML = '';

  if (logs.length === 0) {
    box.textContent = 'No activity recorded yet.';
    return;
  }

  logs.forEach((l) => {
    const div = document.createElement('div');
    div.className = 'timeline-item';

    const action = document.createElement('strong');
    action.textContent = l.action;

    const who = document.createElement('p');
    who.textContent = 'by ' + l.user_name + ' (' + l.role + ') on ' + new Date(l.created_at).toLocaleString();

    div.appendChild(action);
    div.appendChild(who);
    box.appendChild(div);
  });
}

// Add a new comment
document.getElementById('commentForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const textBox = document.getElementById('commentText');

  const res = await fetch('/api/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      complaint_id: Number(id),
      user_id: user.user_id,
      user_name: user.name,
      role: user.role,
      comment: textBox.value
    })
  });

  const data = await res.json();

  if (res.ok) {
    textBox.value = '';
    loadComments();
    loadActivity();
  } else {
    alert(data.error);
  }
});

// Start: the complaint must load first, because feedback depends on it
async function start() {
  const found = await loadComplaint();

  if (found) {
    loadComments();
    loadFeedback();
    loadActivity();
  }
}

start();