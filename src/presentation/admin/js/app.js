// ═══════════════════════════════════════════════════════════════════════════
// ══ MAIN APP INITIALIZATION ════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════

let appStarted = false;

function startApp() {
  if (appStarted) return;
  appStarted = true;
  connectWs();
  fetchStatus();
  fetchLogs();
  fetchWebhooks();
  fetchAgentStatus();
  fetchWsClients();
  fetchMissedCallsToday();
  loadCallHistory();
  loadFullJournal(1);
  loadBlacklist();
  loadStatsTab();
  loadExtensionsList();
  setInterval(fetchStatus,          5000);
  setInterval(fetchLogs,            3000);
  setInterval(fetchWebhooks,        30000);
  setInterval(fetchAgentStatus,     10000);
  setInterval(fetchWsClients,       5000);
  setInterval(fetchMissedCallsToday,60000);
  setInterval(loadStatsTab,         60000);
  // Mémorisation extension click-to-call
  const dialExtenEl = document.getElementById('dialExten');
  dialExtenEl.value = localStorage.getItem('ucm_dial_exten') || '';
  dialExtenEl.addEventListener('change', () => localStorage.setItem('ucm_dial_exten', dialExtenEl.value.trim()));
  // Afficher bouton permission notifications si nécessaire
  if ('Notification' in window && Notification.permission === 'default') {
    const btn = document.getElementById('notifPermBtn');
    if (btn) btn.style.display = '';
  }
  // Initialiser l'onglet Annuaire
  initPhonebookTab();
  // Initialiser l'onglet Annuaire au clic (refresh info au premier affichage)
  document.querySelector('[data-bs-target="#tabPhonebook"]')?.addEventListener('shown.bs.tab', () => {
    const el = document.getElementById('phonebookInfo');
    if (el && el.textContent.includes('Cliquez')) refreshPhonebookInfo();
  });
}

// ── Status polling ─────────────────────────────────────────────────────────
async function fetchStatus() {
  try {
    const r = await fetch('/status');
    const d = await r.json();
    if (!d?.ucm) return;

    const isWebhook = d.ucm.mode === 'webhook';
    let ucmStatusDot = '';
    if (isWebhook) {
      ucmStatusDot = d.websocket?.clients > 0 ? 'dot-green' : 'dot-gray';
    } else {
      ucmStatusDot = d.ucm.wsConnected ? 'dot-green' : 'dot-red';
    }
    document.getElementById('statUcm').innerHTML = `<span class="status-dot ${ucmStatusDot}"></span>`;
    document.getElementById('statUcmMode').textContent = isWebhook ? 'UCM Webhook' : 'UCM WebSocket';
    document.getElementById('statUcmHost').textContent = `${d.ucm.host}:${d.ucm.port}`;

    const odooOk = d.odoo?.authenticated;
    document.getElementById('statOdoo').innerHTML = `<span class="status-dot ${odooOk ? 'dot-green' : 'dot-red'}"></span>`;
    document.getElementById('statOdooUrl').textContent = d.odoo.url;

    document.getElementById('statCalls').textContent = d.calls?.active || 0;
    document.getElementById('statWsClients').textContent = d.websocket?.clients || 0;

    document.getElementById('ucmModeBadge').textContent = isWebhook ? 'Webhook' : 'WebSocket';
    document.getElementById('uptime').textContent = d.uptime ? formatUptime(d.uptime) : '—';

    const w = d.whisper;
    if (w) {
      const dot = w.enabled ? 'dot-green' : 'dot-gray';
      document.getElementById('statWhisper').innerHTML = `<span class="status-dot ${dot}"></span>`;
      if (w.enabled) {
        document.getElementById('statWhisperDetail').textContent = `${w.mode} · ${w.model} · ${w.language}`;
      } else {
        document.getElementById('statWhisperDetail').textContent = 'Désactivé';
      }
    }
  } catch { }
}

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

// ── Logs ───────────────────────────────────────────────────────────────────
let logPaused = false, logFilterVal = 'all', logLines = [];
const MAX_LOG_LINES = 200;

async function fetchLogs() {
  try {
    const r = await apiFetch('/api/logs');
    if (!r.ok) return;
    logLines = (await r.json()).slice(-MAX_LOG_LINES);
    if (!logPaused) renderLogs();
  } catch { }
}

function renderLogs() {
  const box = document.getElementById('logBox');
  const filtered = logLines.filter(l => logFilterVal === 'all' || l.level === logFilterVal);
  box.innerHTML = filtered.map(l =>
    `<div class="log-${l.level}"><span style="color:#475569">${l.ts.slice(11,19)}</span> [${l.level.toUpperCase()}] ${esc(l.msg)}</div>`
  ).join('') || '<span style="color:#475569">Aucun log.</span>';
  box.scrollTop = box.scrollHeight;
}

// ── Webhooks ───────────────────────────────────────────────────────────────
async function fetchWebhooks() {
  try {
    const r = await apiFetch('/api/webhooks');
    const d = await r.json();
    const tbody = document.getElementById('webhookBody');
    if (!d.ok || !d.data?.length) {
      tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted py-3 small">Aucun client webhook</td></tr>';
      return;
    }
    tbody.innerHTML = d.data.map(c =>
      `<tr><td><code class="small">${esc(c.name)}</code></td>
        <td class="small text-muted">${esc(c.webhookUrl || '—')}</td>
        <td><span class="badge bg-success bg-opacity-10 text-success">Actif</span></td></tr>`
    ).join('');
  } catch { }
}

// ── Appels manqués aujourd'hui ──────────────────────────────────────────────
async function fetchMissedCallsToday() {
  try {
    const today = new Date().toISOString().slice(0,10);
    const r = await apiFetch(`/api/calls/history?startDate=${today}&status=missed&limit=1`);
    if (!r.ok) return;
    const d = await r.json();
    if (!d.ok) return;
    const count = d.pagination?.total || 0;
    const el = document.getElementById('statMissedToday');
    if (el) el.textContent = count;
    const badge = document.getElementById('missedCallsBadge');
    if (badge) {
      if (count > 0) {
        badge.textContent = count > 99 ? '99+' : count;
        badge.classList.remove('d-none');
      } else {
        badge.classList.add('d-none');
      }
    }
  } catch { }
}

// ── Active Call Banner ──────────────────────────────────────────────────────
let activeCallTimerInterval = null;
let activeCallStartTime = null;

function showActiveCallBanner(call) {
  activeCallStartTime = Date.now();
  const banner = document.getElementById('activeCallBanner');
  const phoneEl = document.getElementById('activeCallPhone');
  const extenEl = document.getElementById('activeCallExten');
  if (!banner) return;
  if (phoneEl) phoneEl.textContent = call.callerIdNum || '—';
  if (extenEl) extenEl.textContent = call.exten || call.agentExten || '—';
  banner.classList.remove('d-none');
  if (activeCallTimerInterval) clearInterval(activeCallTimerInterval);
  activeCallTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - activeCallStartTime) / 1000);
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    const el = document.getElementById('activeCallTimer');
    if (el) el.textContent = `${m}:${s.toString().padStart(2,'0')}`;
  }, 1000);
}

function hideActiveCallBanner() {
  activeCallStartTime = null;
  if (activeCallTimerInterval) { clearInterval(activeCallTimerInterval); activeCallTimerInterval = null; }
  const banner = document.getElementById('activeCallBanner');
  if (banner) banner.classList.add('d-none');
  const el = document.getElementById('activeCallTimer');
  if (el) el.textContent = '0:00';
}

// ── WS Clients ─────────────────────────────────────────────────────────────
async function fetchWsClients() {
  try {
    const r = await apiFetch('/api/ws/clients');
    if (!r.ok) return;
    const d = await r.json();
    const tbody = document.getElementById('wsBody');
    const subs = d.subscriptions || {};
    const entries = Object.entries(subs);
    if (!entries.length) {
      tbody.innerHTML = '<tr><td colspan="2" class="text-center text-muted py-3 small">Aucun agent connecté</td></tr>';
      return;
    }
    tbody.innerHTML = entries.map(([id, exts]) =>
      `<tr>
        <td><code class="small">${esc(id)}</code></td>
        <td><span class="badge bg-success bg-opacity-10 text-success border border-success border-opacity-25">${exts.length ? exts.map(e => esc(e)).join(', ') : '—'}</span></td>
      </tr>`
    ).join('');
  } catch { }
}

// ── Agent Status ───────────────────────────────────────────────────────────
const AGENT_STATUS_LABELS = {
  available: { label: 'Disponible', class: 'bg-success' },
  busy: { label: 'Occupé', class: 'bg-warning' },
  on_call: { label: 'En appel', class: 'bg-danger' },
  pause: { label: 'Pause', class: 'bg-secondary' },
  offline: { label: 'Hors ligne', class: 'bg-dark' }
};

async function fetchAgentStatus() {
  try {
    const r = await apiFetch('/api/agents/status');
    if (!r.ok) return;
    const d = await r.json();
    const tbody = document.getElementById('agentStatusBody');
    if (!d.data || d.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3 small">Aucun agent enregistré</td></tr>';
      return;
    }
    tbody.innerHTML = d.data.map(a => {
      const s = AGENT_STATUS_LABELS[a.status] || { label: a.status, class: 'bg-secondary' };
      const dndOn = !!a.dnd;
      return `<tr>
        <td><code>${esc(a.id)}</code></td>
        <td><span class="badge ${s.class}">${s.label}</span></td>
        <td class="small text-muted">${a.activeCalls || 0}</td>
        <td>
          <button class="btn btn-xs btn-sm ${dndOn ? 'btn-warning' : 'btn-outline-secondary'}"
                  onclick="toggleDnd('${esc(a.id)}', ${!dndOn})"
                  title="${dndOn ? 'Désactiver DND' : 'Activer DND'}">
            <i class="bi bi-moon${dndOn ? '-fill' : ''}"></i>
          </button>
        </td>
      </tr>`;
    }).join('');
  } catch { }
}

// UI Event handlers
document.getElementById('clearCalls').onclick = () => {
  document.getElementById('callBody').innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4 small">Journal vidé.</td></tr>';
};
document.getElementById('clearLogs').onclick  = () => { logLines = []; renderLogs(); };
document.getElementById('pauseLogs').onclick  = function() {
  logPaused = !logPaused;
  this.innerHTML = logPaused ? '<i class="bi bi-play-fill"></i>' : '<i class="bi bi-pause-fill"></i>';
  if (!logPaused) renderLogs();
};
document.getElementById('logFilter').onchange = function() { logFilterVal = this.value; renderLogs(); };

// ── Recherche de contact (unifiée) ──────────────────────────────────────────
async function searchByPhone(phoneOverride) {
  const phone = phoneOverride || document.getElementById('unifiedSearch')?.value.trim();
  const result = document.getElementById('testOdooResult');
  if (!phone || !result) return;
  result.innerHTML = '<span class="text-muted">Recherche…</span>';
  try {
    const r = await apiFetch('/api/odoo/test', { method: 'POST', body: JSON.stringify({ phone }) });
    const d = await r.json();
    if (d.ok && d.contact) {
      result.innerHTML = `<span class="text-success">Trouvé : <strong>${esc(d.contact.name)}</strong></span>`;
      showQuickContact(d.contact);
    } else {
      result.innerHTML = '<span class="text-warning">Aucun contact trouvé</span>';
    }
  } catch(e) { result.innerHTML = `<span class="text-danger">${esc(e.message)}</span>`; }
}

async function searchByName(queryOverride) {
  const query = queryOverride || document.getElementById('unifiedSearch')?.value.trim();
  const result = document.getElementById('testOdooResult');
  if (!query || !result) return;
  result.innerHTML = '<span class="text-muted">Recherche…</span>';
  try {
    const r = await apiFetch(`/api/odoo/search?q=${encodeURIComponent(query)}`);
    const d = await r.json();
    if (d.ok && d.data?.length) {
      result.innerHTML = d.data.map(c =>
        `<div class="py-1 border-bottom" style="cursor:pointer" onclick='showQuickContact(${JSON.stringify(c)})'>
          <strong>${esc(c.name)}</strong>${c.phone ? ' — ' + esc(c.phone) : ''}
        </div>`
      ).join('');
    } else {
      result.innerHTML = '<span class="text-warning">Aucun résultat</span>';
    }
  } catch(e) { result.innerHTML = `<span class="text-danger">${esc(e.message)}</span>`; }
}

async function unifiedSearch() {
  const q = document.getElementById('unifiedSearch')?.value.trim();
  if (!q) return;
  // Numéro si contient surtout des chiffres / séparateurs téléphoniques
  const isPhone = /^[\d\s\+\-\.\/\(\)]+$/.test(q);
  if (isPhone) await searchByPhone(q);
  else await searchByName(q);
}

document.getElementById('unifiedSearchBtn').addEventListener('click', unifiedSearch);
document.getElementById('unifiedSearch').addEventListener('keydown', e => { if (e.key === 'Enter') unifiedSearch(); });

// ── Click-to-call ───────────────────────────────────────────────────────────
document.getElementById('dialBtn').addEventListener('click', async () => {
  const phone  = document.getElementById('dialPhone').value.trim();
  const exten  = document.getElementById('dialExten').value.trim();
  const result = document.getElementById('dialResult');
  if (!phone || !exten) {
    result.innerHTML = '<span class="text-warning">Extension et numéro requis</span>';
    return;
  }
  result.innerHTML = '<span class="text-muted">Appel en cours…</span>';
  try {
    const r = await apiFetch('/api/calls/dial', {
      method: 'POST',
      body: JSON.stringify({ phone, exten })
    });
    const d = await r.json();
    result.innerHTML = d.ok
      ? `<span class="text-success">Appel initié vers ${esc(phone)}</span>`
      : `<span class="text-danger">${esc(d.error)}</span>`;
  } catch(e) { result.innerHTML = `<span class="text-danger">${esc(e.message)}</span>`; }
});

// ── Configuration modal ─────────────────────────────────────────────────────
document.getElementById('modalConfig').addEventListener('show.bs.modal', async () => {
  try {
    const r = await apiFetch('/api/config');
    const d = await r.json();

    // UCM
    if (d.ucm) {
      document.querySelectorAll('input[name="ucmMode"]').forEach(radio => {
        radio.checked = radio.value === d.ucm.mode;
      });
      document.getElementById('cfgUcmHost').value    = d.ucm.host    || '';
      document.getElementById('cfgUcmWebPort').value = d.ucm.webPort || '';
      document.getElementById('cfgUcmWebUser').value = d.ucm.username || '';
      document.getElementById('cfgUcmExten').value   = Array.isArray(d.ucm.watchExtensions)
        ? d.ucm.watchExtensions.join(', ') : (d.ucm.watchExtensions || '');
      onUcmModeChange();
    }

    // Odoo
    if (d.odoo) {
      document.getElementById('cfgOdooUrl').value  = d.odoo.url      || '';
      document.getElementById('cfgOdooDb').value   = d.odoo.db       || '';
      document.getElementById('cfgOdooUser').value = d.odoo.username  || '';
    }

    // Whisper
    if (d.whisper) {
      document.getElementById('cfgWhisperEnabled').checked = !!d.whisper.enabled;
      document.getElementById('cfgWhisperMode').value      = d.whisper.mode || 'local';
      document.getElementById('cfgWhisperModel').value     = d.whisper.model || 'tiny';
      document.getElementById('cfgWhisperLanguage').value  = d.whisper.language || 'fr';
      document.getElementById('cfgWhisperCommand').value   = d.whisper.command || '';
      document.getElementById('cfgWhisperMaxDuration').value = d.whisper.maxDurationSec || 600;
      const apiUrl = d.whisper.apiUrl || '';
      const sel = document.getElementById('cfgWhisperApiUrlSelect');
      const knownUrls = Array.from(sel.options).map(o => o.value).filter(v => v !== 'custom');
      if (knownUrls.includes(apiUrl)) {
        sel.value = apiUrl;
        document.getElementById('cfgWhisperApiUrl').style.display = 'none';
      } else if (apiUrl) {
        sel.value = 'custom';
        document.getElementById('cfgWhisperApiUrl').value = apiUrl;
        document.getElementById('cfgWhisperApiUrl').style.display = '';
      }
      document.getElementById('cfgWhisperApiKeyStatus').textContent = d.whisper.hasApiKey ? '✓ Clé API enregistrée' : '';
      onWhisperModeChange();
    }
  } catch(e) { console.error('Chargement config échoué:', e); }
});

function onUcmModeChange() {
  const mode = document.querySelector('input[name="ucmMode"]:checked')?.value;
  const isWs = mode === 'websocket';
  ['wsPortField','wsUserField','wsPasswordField'].forEach(id => {
    document.getElementById(id).style.display = isWs ? '' : 'none';
  });
}

async function saveUcmConfig() {
  const result = document.getElementById('cfgUcmResult');
  const mode   = document.querySelector('input[name="ucmMode"]:checked')?.value;
  const body   = {
    mode,
    host:           document.getElementById('cfgUcmHost').value.trim(),
    webPort:        document.getElementById('cfgUcmWebPort').value.trim(),
    webUser:        document.getElementById('cfgUcmWebUser').value.trim(),
    webPassword:    document.getElementById('cfgUcmWebPwd').value,
    watchExtensions: document.getElementById('cfgUcmExten').value.trim(),
  };
  try {
    const r = await apiFetch('/api/config/ucm', { method: 'POST', body: JSON.stringify(body) });
    const d = await r.json();
    result.innerHTML = `<span class="${d.ok ? 'text-success' : 'text-danger'}">${esc(d.message || d.error)}</span>`;
  } catch(e) {
    result.innerHTML = `<span class="text-danger">${esc(e.message)}</span>`;
  }
}

async function testUcmConnection() {
  const result = document.getElementById('cfgUcmResult');
  result.innerHTML = '<span class="text-muted">Test en cours…</span>';
  try {
    const r = await apiFetch('/api/health');
    const d = await r.json();
    const ucmOk = d.ucm?.httpConnected || d.ucm?.wsConnected;
    result.innerHTML = ucmOk
      ? '<span class="text-success">Connexion UCM OK</span>'
      : '<span class="text-danger">UCM non connecté</span>';
  } catch(e) {
    result.innerHTML = `<span class="text-danger">${esc(e.message)}</span>`;
  }
}

// ── DND toggle ──────────────────────────────────────────────────────────────
async function toggleDnd(exten, enable) {
  try {
    await apiFetch(`/api/agents/${exten}/dnd`, {
      method: 'POST', body: JSON.stringify({ enable }),
    });
    fetchAgentStatus();
    showToast(enable ? `DND activé pour ${exten}` : `DND désactivé pour ${exten}`);
  } catch { }
}

function onWhisperModeChange() {
  const mode = document.getElementById('cfgWhisperMode').value;
  document.getElementById('whisperLocalFields').style.display = mode === 'local' ? '' : 'none';
  document.getElementById('whisperApiFields').style.display   = mode === 'api'   ? '' : 'none';
}

function onWhisperApiUrlChange() {
  const val = document.getElementById('cfgWhisperApiUrlSelect').value;
  document.getElementById('cfgWhisperApiUrl').style.display = val === 'custom' ? '' : 'none';
}

async function saveWhisperConfig() {
  const result  = document.getElementById('cfgWhisperResult');
  const mode    = document.getElementById('cfgWhisperMode').value;
  const selUrl  = document.getElementById('cfgWhisperApiUrlSelect').value;
  const apiUrl  = selUrl === 'custom'
    ? document.getElementById('cfgWhisperApiUrl').value.trim()
    : selUrl;
  const body = {
    enabled:        document.getElementById('cfgWhisperEnabled').checked,
    mode,
    model:          document.getElementById('cfgWhisperModel').value,
    language:       document.getElementById('cfgWhisperLanguage').value,
    command:        document.getElementById('cfgWhisperCommand').value.trim(),
    maxDurationSec: parseInt(document.getElementById('cfgWhisperMaxDuration').value || '600', 10),
    apiKey:         document.getElementById('cfgWhisperApiKey').value,
    apiUrl,
  };
  try {
    const r = await apiFetch('/api/config/whisper', { method: 'POST', body: JSON.stringify(body) });
    const d = await r.json();
    result.innerHTML = `<span class="${d.ok ? 'text-success' : 'text-danger'}">${esc(d.message || d.error)}</span>`;
    if (d.ok && body.apiKey) {
      document.getElementById('cfgWhisperApiKeyStatus').textContent = '✓ Clé API enregistrée';
      document.getElementById('cfgWhisperApiKey').value = '';
    }
  } catch(e) {
    result.innerHTML = `<span class="text-danger">${esc(e.message)}</span>`;
  }
}

async function testWhisper() {
  const result = document.getElementById('cfgWhisperResult');
  result.innerHTML = '<i class="bi bi-hourglass-split text-muted me-1"></i>Test en cours…';
  try {
    const r = await apiFetch('/api/config/whisper/test');
    const d = await r.json();
    const icon = d.ok ? 'bi-check-circle-fill text-success' : 'bi-x-circle-fill text-danger';
    result.innerHTML = `<i class="bi ${icon} me-1"></i>${esc(d.message)}`;
  } catch(e) {
    result.innerHTML = `<span class="text-danger"><i class="bi bi-x-circle-fill me-1"></i>${esc(e.message)}</span>`;
  }
}

async function runWhisper() {
  const result = document.getElementById('cfgWhisperResult');
  result.innerHTML = '<i class="bi bi-hourglass-split text-muted me-1"></i>Lancement…';
  try {
    const r = await apiFetch('/api/config/whisper/run', { method: 'POST' });
    const d = await r.json();
    const icon = d.ok ? 'bi-check-circle-fill text-success' : 'bi-x-circle-fill text-danger';
    result.innerHTML = `<i class="bi ${icon} me-1"></i>${esc(d.message)}`;
  } catch(e) {
    result.innerHTML = `<span class="text-danger"><i class="bi bi-x-circle-fill me-1"></i>${esc(e.message)}</span>`;
  }
}

async function loadWhisperLogs() {
  const box = document.getElementById('whisperLogsBox');
  const list = document.getElementById('whisperLogsList');
  box.style.display = '';
  list.innerHTML = '<span class="text-muted">Chargement…</span>';
  try {
    const r = await apiFetch('/api/config/whisper/logs?limit=50');
    const entries = await r.json();
    if (!entries.length) {
      list.innerHTML = '<span class="text-muted">Aucun log Whisper trouvé</span>';
      return;
    }
    const levelColor = { error: 'text-danger', warn: 'text-warning', info: 'text-info', debug: 'text-muted' };
    list.innerHTML = entries.map(e =>
      `<div><span class="text-muted">${esc(e.ts || '')}</span> <span class="${levelColor[e.level] || ''}">[${esc(e.level || '')}]</span> ${esc(e.msg || '')}</div>`
    ).join('');
    list.scrollTop = list.scrollHeight;
  } catch(e) {
    list.innerHTML = `<span class="text-danger">${esc(e.message)}</span>`;
  }
}

async function saveOdooConfig() {
  const result = document.getElementById('cfgOdooResult');
  const body = {
    url:      document.getElementById('cfgOdooUrl').value.trim(),
    db:       document.getElementById('cfgOdooDb').value.trim(),
    username: document.getElementById('cfgOdooUser').value.trim(),
    apiKey:   document.getElementById('cfgOdooKey').value.trim(),
  };
  try {
    const r = await apiFetch('/api/config/odoo', { method: 'POST', body: JSON.stringify(body) });
    const d = await r.json();
    result.innerHTML = `<span class="${d.ok ? 'text-success' : 'text-warning'}">${esc(d.message || d.error)}</span>`;
  } catch(e) {
    result.innerHTML = `<span class="text-danger">${esc(e.message)}</span>`;
  }
}

// ── Annuaire UCM (Remote Phonebook) ─────────────────────────────────────────

function initPhonebookTab() {
  const url = `${location.protocol}//${location.host}/api/phonebook/ucm.xml`;
  const input = document.getElementById('phonebookUrl');
  const link  = document.getElementById('phonebookTestLink');
  if (input) input.value = url;
  if (link)  link.href = url;
}

async function refreshPhonebookInfo() {
  const el = document.getElementById('phonebookInfo');
  if (!el) return;
  el.innerHTML = '<span class="text-muted">Chargement…</span>';
  try {
    const r = await apiFetch('/api/phonebook/info');
    const d = await r.json();
    if (d.ok) {
      el.innerHTML = `<i class="bi bi-check-circle text-success me-1"></i><strong>${d.count}</strong> contact(s) avec numéro de téléphone prêts à synchroniser.`;
    } else {
      el.innerHTML = `<span class="text-danger">${esc(d.error)}</span>`;
    }
  } catch(e) {
    el.innerHTML = `<span class="text-danger">${esc(e.message)}</span>`;
  }
}

function copyPhonebookUrl() {
  const input = document.getElementById('phonebookUrl');
  if (!input) return;
  navigator.clipboard.writeText(input.value).then(() => {
    showToast('URL copiée dans le presse-papiers', 'success');
  }).catch(() => {
    input.select();
    document.execCommand('copy');
    showToast('URL copiée', 'success');
  });
}

// ── Onglet Contacts ─────────────────────────────────────────────────────────

async function loadContactsTab() {
  const tbody = document.getElementById('contactsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">Chargement...</td></tr>';
  
  try {
    const r = await apiFetch('/api/odoo/search?q=&limit=100');
    const d = await r.json();
    
    if (d.ok && d.data && d.data.length > 0) {
      tbody.innerHTML = d.data.map(c => `
        <tr>
          <td><strong>${esc(c.name || '—')}</strong></td>
          <td>${esc(c.phone || '—')}</td>
          <td>${esc(c.mobile || '—')}</td>
          <td>${esc(c.email || '—')}</td>
          <td>${esc(c.company || '—')}</td>
          <td>
            <button class="btn btn-sm btn-outline-primary" onclick="viewContact('${c.id}')">
              <i class="bi bi-eye"></i>
            </button>
            <button class="btn btn-sm btn-outline-secondary" onclick="callNumber('${esc(c.phone || c.mobile || '')}')">
              <i class="bi bi-telephone"></i>
            </button>
          </td>
        </tr>
      `).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">Aucun contact trouvé</td></tr>';
    }
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-4">Erreur: ${esc(e.message)}</td></tr>`;
  }
}

function searchContacts() {
  const query = document.getElementById('contactSearch').value.trim();
  if (query.length < 2) {
    loadContactsTab();
    return;
  }
  
  apiFetch(`/api/odoo/search?q=${encodeURIComponent(query)}&limit=50`)
    .then(r => r.json())
    .then(d => {
      const tbody = document.getElementById('contactsTableBody');
      if (!tbody) return;
      
      if (d.ok && d.data && d.data.length > 0) {
        tbody.innerHTML = d.data.map(c => `
          <tr>
            <td><strong>${esc(c.name || '—')}</strong></td>
            <td>${esc(c.phone || '—')}</td>
            <td>${esc(c.mobile || '—')}</td>
            <td>${esc(c.email || '—')}</td>
            <td>${esc(c.company || '—')}</td>
            <td>
              <button class="btn btn-sm btn-outline-primary" onclick="viewContact('${c.id}')">
                <i class="bi bi-eye"></i>
              </button>
              <button class="btn btn-sm btn-outline-secondary" onclick="callNumber('${esc(c.phone || c.mobile || '')}')">
                <i class="bi bi-telephone"></i>
              </button>
            </td>
          </tr>
        `).join('');
      } else {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">Aucun contact trouvé</td></tr>';
      }
    })
    .catch(e => {
      const tbody = document.getElementById('contactsTableBody');
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-4">Erreur: ${esc(e.message)}</td></tr>`;
    });
}

function viewContact(id) {
  window.open(`https://selest-informatique.odoo.com/web#model=res.partner&id=${id}`, '_blank');
}

// ── Lecture audio enregistrements ────────────────────────────────────────────
let _currentAudio = null;

/**
 * Joue un enregistrement audio
 * @param {string} url - URL de l'enregistrement (ex: /api/recordings/download/fichier.wav)
 */
function playRecording(url) {
  if (typeof window.playRecordingBar === 'function') {
    window.playRecordingBar(url);
    return;
  }

  // Stopper la lecture en cours si existe
  if (_currentAudio) {
    _currentAudio.pause();
    _currentAudio = null;
  }
  
  // Créer un nouvel élément audio
  _currentAudio = new Audio(url);
  _currentAudio.play().catch(err => {
    console.error('Erreur lecture audio:', err);
    showToast('Erreur lors de la lecture', 'danger');
  });
  
  // Feedback visuel optionnel
  console.log('Lecture audio:', url);
}

// ── Notifications Configuration ──────────────────────────────────────────────
const DEFAULT_SMTP_PORT = 587;

async function loadNotificationsConfig(){try{const r = await apiFetch('/api/config/notifications');const d = await r.json();if(d.ok && d.telegram){document.getElementById('notifTelegramToken').value = d.telegram.token || '';document.getElementById('notifTelegramChatIds').value = JSON.stringify(d.telegram.chatIds || []);}if(d.ok && d.smtp){document.getElementById('notifSmtpHost').value = d.smtp.host || '';document.getElementById('notifSmtpPort').value = d.smtp.port || DEFAULT_SMTP_PORT;document.getElementById('notifSmtpFrom').value = d.smtp.from || '';}if(d.ok && d.missedCallThreshold){document.getElementById('notifMissedCount').value = d.missedCallThreshold.count || 3;document.getElementById('notifMissedMinutes').value = d.missedCallThreshold.minutes || 15;}if(d.ok && d.dailySummary){document.getElementById('notifDailyEnabled').checked = d.dailySummary.enabled || false;document.getElementById('notifDailyTime').value = d.dailySummary.time || '18:00';}}catch(e){console.error('Erreur chargement notifications:',e);}}
async function saveNotifications(){const c = { telegram:{ token:document.getElementById('notifTelegramToken').value.trim(),chatIds:JSON.parse(document.getElementById('notifTelegramChatIds').value || '[]') },smtp:{ host:document.getElementById('notifSmtpHost').value.trim(),port:parseInt(document.getElementById('notifSmtpPort').value || DEFAULT_SMTP_PORT),from:document.getElementById('notifSmtpFrom').value.trim(),user:document.getElementById('notifSmtpUser').value.trim(),password:document.getElementById('notifSmtpPassword').value.trim() || undefined },missedCallThreshold:{ count:parseInt(document.getElementById('notifMissedCount').value || '3'),minutes:parseInt(document.getElementById('notifMissedMinutes').value || '15') },dailySummary:{ enabled:document.getElementById('notifDailyEnabled').checked,time:document.getElementById('notifDailyTime').value || '18:00' } };try{const r = await apiFetch('/api/config/notifications',{ method:'POST',body:JSON.stringify(c) });const d = await r.json();showToast(d.ok ? 'Configuration sauvegardée' : (d.error || 'Erreur'),d.ok ? 'success' : 'danger');}catch(e){showToast('Erreur: ' + e.message,'danger');}}
async function testNotification(t){try{const r = await apiFetch('/api/config/notifications/test',{ method:'POST',body:JSON.stringify({ type:t }) });const d = await r.json();showToast(d.ok ? 'Test réussi !' : (d.message || 'Échec'),d.ok ? 'success' : 'danger');}catch(e){showToast('Erreur: ' + e.message,'danger');}}
document.querySelector('[data-bs-target="#tabNotifications"]')?.addEventListener('shown.bs.tab',loadNotificationsConfig);
