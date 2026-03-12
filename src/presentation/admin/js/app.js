// ═══════════════════════════════════════════════════════════════════════════
// ══ MAIN APP INITIALIZATION ════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════

let appStarted = false;
let jPage = 1;
const jLimit = 50;
let jData = [];

function startApp() {
  if (appStarted) return;
  appStarted = true;
  connectWs();
  fetchStatus();
  fetchLogs();
  fetchWebhooks();
  fetchAgentStatus();
  fetchMissedCallsToday();
  loadCallHistory();
  loadFullJournal(1);
  setInterval(fetchStatus,         5000);
  setInterval(fetchLogs,           3000);
  setInterval(fetchWebhooks,       30000);
  setInterval(fetchMissedCallsToday, 60000);
  // Mémorisation extension click-to-call
  const dialExtenEl = document.getElementById('dialExten');
  dialExtenEl.value = localStorage.getItem('ucm_dial_exten') || '';
  dialExtenEl.addEventListener('change', () => localStorage.setItem('ucm_dial_exten', dialExtenEl.value.trim()));
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
      return `<tr>
        <td><code>${esc(a.id)}</code></td>
        <td><span class="badge ${s.class}">${s.label}</span></td>
        <td class="small text-muted">${a.activeCalls || 0}</td>
        <td><button class="btn btn-xs btn-sm btn-outline-primary" onclick="alert('Fonction à implémenter')">📞</button></td>
      </tr>`;
    }).join('');
  } catch { }
}

// ── Full Journal ───────────────────────────────────────────────────────────
const J_STATUS_BADGES = { ringing:'bg-primary', answered:'bg-success', missed:'bg-danger', hangup:'bg-secondary' };
const J_STATUS_LABELS = { ringing:'Sonnerie', answered:'Décroché', missed:'Manqué', hangup:'Raccroché' };

async function loadFullJournal(page = 1) {
  jPage = page;
  const params = new URLSearchParams({ limit: jLimit, offset: (page - 1) * jLimit });
  const v = id => document.getElementById(id).value;
  if (v('jDateFrom')) params.set('startDate', v('jDateFrom'));
  if (v('jDateTo'))   params.set('endDate',   v('jDateTo') + 'T23:59:59');
  if (v('jStatus'))   params.set('status',    v('jStatus'));
  if (v('jExten').trim())  params.set('exten',  v('jExten').trim());
  if (v('jSearch').trim()) params.set('search', v('jSearch').trim());

  const tbody = document.getElementById('journalBody');
  tbody.innerHTML = '<tr><td colspan="7" class="text-center py-3"><span class="spinner-border spinner-border-sm me-2"></span>Chargement…</td></tr>';

  try {
    const r = await apiFetch('/api/calls/history?' + params.toString());
    const d = await r.json();
    if (!d.ok) { tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-3">${esc(d.error)}</td></tr>`; return; }
    jData = d.data;
    renderJournalStats(d.data, d.pagination.total);
    renderJournalTable(d.data, tbody);
    renderJournalPagination(d.pagination);
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-3">${esc(e.message)}</td></tr>`;
  }
}

function renderJournalStats(calls, total) {
  const answered = calls.filter(c => c.status === 'answered' || c.status === 'hangup').length;
  const missed   = calls.filter(c => c.status === 'missed').length;
  const withDur  = calls.filter(c => c.duration > 0);
  const avgDur   = withDur.length ? Math.round(withDur.reduce((s, c) => s + c.duration, 0) / withDur.length) : 0;
  const pct      = calls.length ? Math.round(answered / calls.length * 100) : 0;
  document.getElementById('jTotal').textContent    = total;
  document.getElementById('jAnswered').textContent = answered + (calls.length ? ' (' + pct + '%)' : '');
  document.getElementById('jMissed').textContent   = missed;
  document.getElementById('jAvgDur').textContent   = avgDur ? (avgDur >= 60 ? Math.floor(avgDur/60) + 'min' : avgDur + 's') : '—';
}

function renderJournalTable(calls, tbody) {
  if (!calls.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4 small">Aucun appel trouvé.</td></tr>';
    return;
  }
  tbody.innerHTML = calls.map(c => {
    if (c.contact_id) {
      historyContactMap[c.unique_id] = { id: c.contact_id, name: c.contact_name || '—',
        phone: c.contact_phone || '—', email: c.contact_email || '—', company: '',
        odooUrl: c.contact_odoo_url || '#', avatar: c.contact_avatar || null };
    }
    const dt  = new Date(c.started_at.replace(' ', 'T') + 'Z');
    const dateStr = dt.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'2-digit' });
    const timeStr = dt.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
    const dir = c.direction === 'outbound'
      ? '<i class="bi bi-telephone-outbound text-warning" title="Sortant"></i>'
      : '<i class="bi bi-telephone-inbound text-info"    title="Entrant"></i>';
    const exten = c.exten || c.agent_exten || '—';
    const avatarHtml = c.contact_avatar 
      ? `<img src="${c.contact_avatar}" style="width:24px;height:24px;border-radius:50%;vertical-align:middle;margin-right:6px;object-fit:cover">`
      : '';
    const contact = c.contact_name
      ? `<span class="badge bg-success bg-opacity-10 text-success border border-success border-opacity-25 contact-badge-clickable" data-uid="${esc(c.unique_id)}" style="cursor:pointer;display:flex;align-items:center">${avatarHtml}${esc(c.contact_name)}</span>`
      : (c.caller_id_name ? `<span class="text-muted small">${esc(c.caller_id_name)}</span>` : '<span class="text-muted">—</span>');
    const dur = c.duration != null && c.duration > 0
      ? (c.duration >= 60 ? Math.floor(c.duration/60) + 'min ' + (c.duration % 60) + 's' : c.duration + 's')
      : '—';
    return `<tr>
      <td class="text-muted small" style="white-space:nowrap">${dateStr} <strong>${timeStr}</strong></td>
      <td>${dir}</td>
      <td>${phoneLink(c.caller_id_num)}</td>
      <td><span class="badge bg-primary bg-opacity-10 text-primary">${esc(exten)}</span></td>
      <td>${contact}</td>
      <td class="small text-nowrap">${dur}</td>
      <td><span class="badge ${J_STATUS_BADGES[c.status]||'bg-secondary'}">${J_STATUS_LABELS[c.status]||c.status||'—'}</span></td>
    </tr>`;
  }).join('');
}

function renderJournalPagination(pagination) {
  const { total, limit, offset } = pagination;
  const totalPages  = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;
  document.getElementById('jPaginationInfo').textContent =
    total ? `${offset + 1}–${Math.min(offset + limit, total)} sur ${total} appels` : 'Aucun appel';
  const pag = document.getElementById('jPagination');
  if (totalPages <= 1) { pag.innerHTML = ''; return; }
  const pages = [];
  if (currentPage > 1) pages.push(`<button class="btn btn-sm btn-outline-secondary" onclick="loadFullJournal(${currentPage-1})"><i class="bi bi-chevron-left"></i></button>`);
  let start = Math.max(1, currentPage - 2), end = Math.min(totalPages, start + 4);
  if (end - start < 4) start = Math.max(1, end - 4);
  for (let p = start; p <= end; p++)
    pages.push(`<button class="btn btn-sm ${p===currentPage?'btn-primary':'btn-outline-secondary'}" onclick="loadFullJournal(${p})">${p}</button>`);
  if (currentPage < totalPages) pages.push(`<button class="btn btn-sm btn-outline-secondary" onclick="loadFullJournal(${currentPage+1})"><i class="bi bi-chevron-right"></i></button>`);
  pag.innerHTML = pages.join('');
}

// Sync CDR UCM
document.getElementById('syncCdrBtn').onclick = async () => {
  const btn = document.getElementById('syncCdrBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Sync...';
  try {
    const r = await apiFetch('/api/calls/sync-cdr', { method: 'POST' });
    const d = await r.json();
    if (d.ok) {
      alert(`Sync terminée : ${d.inserted} appel(s) importé(s), ${d.skipped} déjà présent(s)\n(${d.startTime} → ${d.endTime})`);
      loadFullJournal(1);
      loadCallHistory();
    } else {
      alert('Erreur sync CDR : ' + (d.error || 'inconnue'));
    }
  } catch (e) {
    alert('Erreur sync CDR : ' + e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-cloud-download me-1"></i>Sync UCM';
  }
};

// Export CSV
document.getElementById('exportCsvBtn').onclick = () => {
  if (!jData.length) { alert('Aucune donnée à exporter.'); return; }
  const rows = [['Date','Heure','Direction','De','Extension','Contact','Durée(s)','Statut']];
  jData.forEach(c => {
    const dt = new Date(c.started_at.replace(' ', 'T') + 'Z');
    rows.push([
      dt.toLocaleDateString('fr-FR'),
      dt.toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'}),
      c.direction === 'outbound' ? 'Sortant' : 'Entrant',
      c.caller_id_num || '',
      c.exten || c.agent_exten || '',
      c.contact_name || '',
      c.duration || '',
      J_STATUS_LABELS[c.status] || c.status || '',
    ]);
  });
  const csv = rows.map(r => r.map(v => '"' + String(v).replace(/"/g,'""') + '"').join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(csv);
  a.download = 'journal_appels_' + new Date().toISOString().slice(0,10) + '.csv';
  a.click();
};

// Filter enter keys
['jDateFrom','jDateTo','jStatus','jExten','jSearch'].forEach(id =>
  document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') loadFullJournal(1); })
);

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
