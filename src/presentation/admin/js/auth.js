// ═══════════════════════════════════════════════════════════════════════════
// ══ AUTHENTIFICATION ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════

let SESSION_TOKEN = sessionStorage.getItem('ucm_token') || '';

async function apiFetch(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (SESSION_TOKEN) headers['X-Session-Token'] = SESSION_TOKEN;
  const r = await fetch(path, { ...opts, headers });
  if (r.status === 401) { doLogout(); throw new Error('401'); }
  return r;
}

// ── Login ────────────────────────────────────────────────────────────────────
async function tryLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass  = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  const btn   = document.getElementById('loginBtn');
  errEl.classList.add('d-none');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Connexion…';
  try {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: email, password: pass }),
    });
    const d = await r.json();
    if (!r.ok || !d.token) throw new Error(d.error || 'Identifiants incorrects');
    SESSION_TOKEN = d.token;
    sessionStorage.setItem('ucm_token', d.token);
    sessionStorage.setItem('ucm_user', d.username);
    showMain(d.username);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('d-none');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-box-arrow-in-right me-1"></i>Se connecter';
  }
}

function doLogout() {
  if (SESSION_TOKEN) fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Session-Token': SESSION_TOKEN } });
  SESSION_TOKEN = '';
  sessionStorage.removeItem('ucm_token');
  sessionStorage.removeItem('ucm_user');
  showLogin();
}

function showLogin() {
  document.getElementById('mainPage').classList.add('d-none');
  document.getElementById('loginPage').classList.remove('d-none');
  document.getElementById('loginPassword').value = '';
}

function showMain(username) {
  document.getElementById('loginPage').classList.add('d-none');
  document.getElementById('mainPage').classList.remove('d-none');
  document.getElementById('navUser').textContent = username || sessionStorage.getItem('ucm_user') || '—';
  startApp();
}

document.getElementById('loginBtn').onclick = tryLogin;
document.getElementById('loginEmail').addEventListener('keydown', e => e.key === 'Enter' && document.getElementById('loginPassword').focus());
document.getElementById('loginPassword').addEventListener('keydown', e => e.key === 'Enter' && tryLogin());
document.getElementById('logoutBtn').onclick = doLogout;

// ── Theme toggle ─────────────────────────────────────────────────────────────
function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-bs-theme') === 'dark';
  html.setAttribute('data-bs-theme', isDark ? 'light' : 'dark');
  const icon = document.querySelector('#themeToggle i');
  icon.className = isDark ? 'bi bi-moon-stars' : 'bi bi-sun';
  localStorage.setItem('ucm_theme', isDark ? 'light' : 'dark');
}
document.getElementById('themeToggle').onclick = toggleTheme;

// Restore theme preference
const savedTheme = localStorage.getItem('ucm_theme') || 'light';
document.documentElement.setAttribute('data-bs-theme', savedTheme);
if (savedTheme === 'dark') {
  const icon = document.querySelector('#themeToggle i');
  icon.className = 'bi bi-sun';
}

// Init : vérifier session existante
(async () => {
  if (SESSION_TOKEN) {
    try {
      const r = await fetch('/api/auth/me', { headers: { 'X-Session-Token': SESSION_TOKEN } });
      if (r.ok) { const d = await r.json(); showMain(d.username); return; }
    } catch { /* ignore */ }
  }
  showLogin();
})();
