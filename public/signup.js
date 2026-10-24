document.getElementById('signupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = document.getElementById('signupMessage');
  const button = e.target.querySelector('button[type="submit"]');
  message.style.color = '#d13c65';
  message.textContent = '';
  button.disabled = true;

  try {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        name: document.getElementById('signupName').value.trim(),
        email: document.getElementById('signupEmail').value.trim(),
        password: document.getElementById('signupPassword').value,
        language: document.getElementById('signupLanguage').value,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not create the account. Please try again.');

    message.style.color = '#3b9a67';
    message.textContent = 'Account created! Taking you to SkinSakhi...';
    setTimeout(() => { window.location.href = 'index.html'; }, 900);
  } catch (err) {
    message.textContent = err instanceof TypeError ? 'Cannot reach the server. Is it running?' : err.message;
    button.disabled = false;
  }
});
