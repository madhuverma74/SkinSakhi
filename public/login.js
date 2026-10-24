document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = document.getElementById('loginMessage');
  const button = e.target.querySelector('button[type="submit"]');
  message.style.color = '#d13c65';
  message.textContent = '';
  button.disabled = true;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        email: document.getElementById('loginEmail').value.trim(),
        password: document.getElementById('loginPassword').value,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Login failed. Please try again.');
    window.location.href = 'index.html';
  } catch (err) {
    message.textContent = err instanceof TypeError ? 'Cannot reach the server. Is it running?' : err.message;
    button.disabled = false;
  }
});
