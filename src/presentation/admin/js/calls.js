// ═══════════════════════════════════════════════════════════════════════════
// ══ CALL HANDLING ══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════

const callRows = {};
const historyContactMap = {};
const MAX_CALL_ROWS = 50;

function addCallRow(call, status) {
  const tbody = document.getElementById('callBody');
  if (tbody.querySelector('[colspan]')) tbody.innerHTML = '';
  if (tbody.querySelectorAll('tr').length >= MAX_CALL_ROWS)
    tbody.lastElementChild?.remove();
  const tr = document.createElement('tr');
  tr.className = 'call-row' + (status === 'incoming' ? ' incoming' : '');
  tr.dataset.id = call.uniqueId;
  tr.dataset.status = status === 'answered' ? 'answered' : (status === 'missed' ? 'missed' : '');
  tr.innerHTML = callHtml(call, status);
  tbody.insertBefore(tr, tbody.firstChild);
  callRows[call.uniqueId] = tr;
}

function updateCallRow(call, status) {
  const tr = callRows[call.uniqueId];
  if (tr) {
    tr.innerHTML = callHtml(call, status);
    tr.dataset.status = status === 'answered' ? 'answered' : (status === 'missed' ? 'missed' : '');
    if (status !== 'incoming') tr.classList.remove('incoming');
  } else {
    addCallRow(call, status);
  }
}

function updateCallContact(data) {
  const tr = callRows[data.uniqueId];
  if (tr && data.contact) {
    const avatarHtml = data.contact.avatar
      ? `<img src="${data.contact.avatar}" style="width:24px;height:24px;border-radius:50%;vertical-align:middle;margin-right:6px;object-fit:cover">`
      : '';
    tr.querySelector('.td-contact').innerHTML =
      `<span class="badge bg-success bg-opacity-10 text-success border border-success border-opacity-25 contact-badge-clickable" data-uid="${data.uniqueId}" style="cursor:pointer;display:flex;align-items:center">
        ${avatarHtml}<span>${data.contact.name}</span>
      </span>`;
  }
}

function phoneLink(phone) {
  if (!phone) return '<span class="text-muted">—</span>';
  return `<code class="small phone-link" data-phone="${esc(phone)}" style="cursor:pointer;text-decoration:underline dotted;color:inherit" title="Cliquer pour rechercher / créer le contact">${esc(phone)}</code>`;
}

function callHtml(call, status) {
  const t = new Date().toTimeString().slice(0,8);
  const badges = { incoming:'bg-primary', answered:'bg-success', hangup:'bg-secondary' };
  const labels = { incoming:'Entrant', answered:'Décroché', hangup:'Raccroché' };
  const dir = (call.direction === 'outbound')
    ? '<i class="bi bi-telephone-outbound text-warning" title="Sortant"></i>'
    : '<i class="bi bi-telephone-inbound text-info" title="Entrant"></i>';
  const avatarHtml = call.contact?.avatar
    ? `<img src="${call.contact.avatar}" style="width:24px;height:24px;border-radius:50%;vertical-align:middle;margin-right:6px;object-fit:cover">`
    : '';
  const contactBadge = call.contact
    ? `<span class="badge bg-success bg-opacity-10 text-success border border-success border-opacity-25 contact-badge-clickable" data-uid="${call.uniqueId}" style="cursor:pointer;display:flex;align-items:center">
        ${avatarHtml}<span>${esc(call.contact.name)}</span>
      </span>`
    : '<span class="text-muted">—</span>';
  return `<td class="text-muted small">${t}</td>
    <td class="text-center">${dir}</td>
    <td>${phoneLink(call.callerIdNum)}</td>
    <td><span class="badge bg-primary bg-opacity-10 text-primary">${esc(call.exten || call.agentExten || '—')}</span></td>
    <td class="td-contact">${contactBadge}</td>
    <td><span class="badge ${badges[status]}">${labels[status]}</span></td>`;
}

// ── Audio Player ─────────────────────────────────────────────────────────────

let _playerContainer = null;
let _playerAudio = null;

function playRecording(url) {
  // Arrêter et fermer le lecteur précédent
  if (_playerAudio) { _playerAudio.pause(); _playerAudio.src = ''; _playerAudio = null; }
  if (_playerContainer) { _playerContainer.remove(); _playerContainer = null; }

  const container = document.createElement('div');
  container.id = 'audioPlayerBar';
  container.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#1e293b;color:#f1f5f9;padding:12px 20px;box-shadow:0 -4px 20px rgba(0,0,0,.4);display:flex;align-items:center;gap:14px;font-size:.85rem';

  const fmtTime = s => { if (!s || !isFinite(s)) return '0:00'; const m = Math.floor(s/60); return m + ':' + String(Math.floor(s%60)).padStart(2,'0'); };

  container.innerHTML = `
    <button id="apPlayBtn" class="btn btn-sm btn-light rounded-circle d-flex align-items-center justify-content-center" style="width:36px;height:36px;flex-shrink:0">
      <i class="bi bi-play-fill" style="font-size:1.1rem"></i>
    </button>
    <span id="apCurrent" style="min-width:38px;text-align:right;font-variant-numeric:tabular-nums">0:00</span>
    <div style="flex:1;position:relative;height:6px;background:#475569;border-radius:3px;cursor:pointer" id="apTrack">
      <div id="apProgress" style="height:100%;background:#3b82f6;border-radius:3px;width:0%;pointer-events:none"></div>
      <div id="apThumb" style="position:absolute;top:50%;transform:translate(-50%,-50%);left:0%;width:14px;height:14px;background:#fff;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.4);pointer-events:none"></div>
    </div>
    <span id="apDuration" style="min-width:38px;font-variant-numeric:tabular-nums">0:00</span>
    <a href="${url}" download title="Télécharger" class="btn btn-sm btn-outline-light rounded-circle d-flex align-items-center justify-content-center" style="width:32px;height:32px;flex-shrink:0">
      <i class="bi bi-download" style="font-size:.8rem"></i>
    </a>
    <button id="apCloseBtn" class="btn btn-sm btn-outline-light rounded-circle d-flex align-items-center justify-content-center" style="width:32px;height:32px;flex-shrink:0">
      <i class="bi bi-x-lg" style="font-size:.8rem"></i>
    </button>
  `;

  document.body.appendChild(container);
  _playerContainer = container;

  const audio = new Audio(url);
  _playerAudio = audio;
  const playBtn = container.querySelector('#apPlayBtn');
  const track   = container.querySelector('#apTrack');
  const prog    = container.querySelector('#apProgress');
  const thumb   = container.querySelector('#apThumb');
  const curEl   = container.querySelector('#apCurrent');
  const durEl   = container.querySelector('#apDuration');

  audio.addEventListener('loadedmetadata', () => { durEl.textContent = fmtTime(audio.duration); });
  audio.addEventListener('timeupdate', () => {
    if (!audio.duration) return;
    const pct = (audio.currentTime / audio.duration) * 100;
    prog.style.width = pct + '%';
    thumb.style.left = pct + '%';
    curEl.textContent = fmtTime(audio.currentTime);
  });
  audio.addEventListener('ended', () => { playBtn.querySelector('i').className = 'bi bi-play-fill'; });

  playBtn.onclick = () => {
    if (audio.paused) { audio.play(); playBtn.querySelector('i').className = 'bi bi-pause-fill'; }
    else { audio.pause(); playBtn.querySelector('i').className = 'bi bi-play-fill'; }
  };

  // Clic / drag sur la barre de progression
  const seek = e => {
    const rect = track.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = pct * audio.duration;
  };
  track.addEventListener('mousedown', e => {
    seek(e);
    const onMove = ev => seek(ev);
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  container.querySelector('#apCloseBtn').onclick = () => { audio.pause(); audio.src = ''; _playerAudio = null; container.remove(); _playerContainer = null; };

  audio.play().then(() => { playBtn.querySelector('i').className = 'bi bi-pause-fill'; }).catch(() => {});
}

// ── Incoming Call Popup ─────────────────────────────────────────────────────
let incomingCallModal;
let currentIncomingCall = null;

function showIncomingCallPopup(call) {
  const contact = call.contact || {};
  currentIncomingCall = { ...call, contact };

  document.getElementById('incomingCallerName').textContent = contact.name || call.callerIdName || 'Numéro inconnu';
  document.getElementById('incomingCallerPhone').textContent = call.callerIdNum || '—';
  document.getElementById('incomingExten').textContent = call.exten || call.agentExten || '—';
  document.getElementById('incomingEmail').textContent = contact.email || '—';
  document.getElementById('incomingCompany').textContent = contact.company || '—';
  document.getElementById('incomingCity').textContent = contact.city || '—';
  document.getElementById('incomingOdooLink').href = contact.odooUrl || '#';

  // Afficher le score spam si disponible
  const spamBadge = document.getElementById('incomingSpamBadge');
  if (call.spamInfo && call.spamInfo.score > 4) {
    const s = call.spamInfo;
    const color = s.score >= 7 ? 'danger' : s.score >= 5 ? 'warning' : 'secondary';
    spamBadge.innerHTML = `<span class="badge bg-${color}"><i class="bi bi-exclamation-triangle me-1"></i>Spam ${s.score}/9${s.callerType ? ' - ' + s.callerType : ''}</span>`;
    spamBadge.style.display = '';
  } else {
    spamBadge.style.display = 'none';
  }

  const editBtn = document.getElementById('incomingEditBtn');
  if (contact.id) {
    editBtn.style.display = '';
    editBtn.onclick = () => openQuickEditContact(contact);
  } else {
    editBtn.style.display = 'none';
  }

  const avatarEl = document.getElementById('incomingAvatar');
  if (contact.avatar) {
    avatarEl.innerHTML = `<img src="${contact.avatar}" style="width:100%;height:100%;object-fit:cover">`;
  } else {
    const initials = (contact.name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    avatarEl.innerHTML = `<span style="font-size:2rem;font-weight:700;color:#3b82f6">${initials}</span>`;
  }

  // Historique récent (3 derniers appels)
  const historyEl = document.getElementById('incomingCallHistory');
  if (contact.id) {
    historyEl.innerHTML = '<span class="text-muted" style="font-size:.75rem">Chargement…</span>';
    apiFetch(`/api/odoo/contacts/${contact.id}/history?limit=3`).then(r => r.json()).then(d => {
      if (d.ok && d.data?.length) {
        const statLabels = { answered:'Décroché', missed:'Manqué', hangup:'Raccroché', ringing:'Sonnerie' };
        const statClass  = { answered:'text-success', missed:'text-danger', hangup:'text-muted', ringing:'text-primary' };
        historyEl.innerHTML = d.data.map(c => {
          const dt = new Date(c.started_at.replace(' ','T') + 'Z');
          const ts = dt.toLocaleDateString('fr-FR',{ day:'2-digit',month:'2-digit' }) + ' ' +
                     dt.toLocaleTimeString('fr-FR',{ hour:'2-digit',minute:'2-digit' });
          return `<div class="d-flex justify-content-between border-bottom py-1" style="font-size:.78rem">
            <span class="text-muted">${ts}</span>
            <span class="${statClass[c.status] || 'text-muted'}">${statLabels[c.status] || c.status}</span>
          </div>`;
        }).join('');
      } else {
        historyEl.innerHTML = '<span class="text-muted" style="font-size:.75rem">Aucun historique</span>';
      }
    }).catch(() => { historyEl.innerHTML = '<span class="text-muted" style="font-size:.75rem">—</span>'; });
  } else {
    historyEl.innerHTML = '<span class="text-muted" style="font-size:.75rem">Contact inconnu</span>';
  }

  if (!incomingCallModal) {
    incomingCallModal = new bootstrap.Modal(document.getElementById('modalIncomingCall'));
  }
  incomingCallModal.show();
  playIncomingCallSound();
}

function closeIncomingCallModal() {
  if (incomingCallModal) incomingCallModal.hide();
  currentIncomingCall = null;
}

// Mise à jour de la popup quand le contact est créé automatiquement côté serveur
function updateIncomingCallPopupContact(contact) {
  const el = id => document.getElementById(id);
  el('incomingCallerName').textContent = contact.name || '—';
  el('incomingEmail').textContent      = contact.email || '—';
  el('incomingCompany').textContent    = contact.company || '—';
  el('incomingCity').textContent       = contact.city || '—';
  if (contact.odooUrl) el('incomingOdooLink').href = contact.odooUrl;
  const editBtn = el('incomingEditBtn');
  if (contact.id && editBtn) {
    editBtn.style.display = '';
    editBtn.onclick = () => openQuickEditContact(contact);
  }
  const avatarEl = el('incomingAvatar');
  if (avatarEl) {
    if (contact.avatar) {
      avatarEl.innerHTML = `<img src="${contact.avatar}" style="width:100%;height:100%;object-fit:cover">`;
    } else {
      const initials = (contact.name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
      avatarEl.innerHTML = `<span style="font-size:2rem;font-weight:700;color:#3b82f6">${initials}</span>`;
    }
  }
}

let callSoundPlayed = false;
function playIncomingCallSound() {
  if (typeof soundEnabled !== 'undefined' && !soundEnabled) return;
  if (callSoundPlayed) return;
  callSoundPlayed = true;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.frequency.value = 800;
    oscillator.type = 'sine';
    gainNode.gain.value = 0.3;
    oscillator.start();
    setTimeout(() => { gainNode.gain.value = 0; }, 200);
    setTimeout(() => { gainNode.gain.value = 0.3; }, 400);
    setTimeout(() => { gainNode.gain.value = 0; }, 600);
    setTimeout(() => { gainNode.gain.value = 0.3; }, 800);
    setTimeout(() => { oscillator.stop(); callSoundPlayed = false; }, 1500);
  } catch (e) { console.log('Audio not supported'); }
}

// ── Call History ────────────────────────────────────────────────────────────
async function loadCallHistory() {
  try {
    const r = await apiFetch('/api/calls/history?limit=50');
    if (!r.ok) return;
    const d = await r.json();
    if (!d.ok || !d.data || d.data.length === 0) return;

    const tbody = document.getElementById('callBody');
    tbody.innerHTML = '';
    d.data.forEach(call => {
      if (call.contact_id) {
        historyContactMap[call.unique_id] = {
          id: call.contact_id, name: call.contact_name || '—',
          phone: call.contact_phone || '—', email: call.contact_email || '—',
          company: '', odooUrl: call.contact_odoo_url || '#'
        };
      }
      const tr = document.createElement('tr');
      tr.className = 'call-row';
      tr.dataset.id = call.unique_id;
      tr.dataset.status = call.status === 'answered' || call.status === 'hangup' ? 'answered' : (call.status === 'missed' ? 'missed' : '');
      tr.innerHTML = callHtmlFromHistory(call);
      tbody.appendChild(tr);
      callRows[call.unique_id] = tr;
    });
  } catch { }
}

function callHtmlFromHistory(call) {
  let t = '—';
  if (call.started_at) {
    const dt = new Date(call.started_at.replace(' ', 'T') + 'Z');
    const today = new Date();
    const isToday = dt.toDateString() === today.toDateString();
    t = isToday
      ? dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : dt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' + dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  const statusBadges = { ringing: 'bg-primary', answered: 'bg-success', missed: 'bg-danger', hangup: 'bg-secondary' };
  const statusLabels = { ringing: 'Sonnerie', answered: 'Décroché', missed: 'Manqué', hangup: 'Raccroché' };
  const exten = call.exten || call.agent_exten || '—';
  const dir = call.direction === 'outbound'
    ? '<i class="bi bi-telephone-outbound text-warning" title="Sortant"></i>'
    : '<i class="bi bi-telephone-inbound text-info" title="Entrant"></i>';
  const avatarHtml = call.contact_avatar
    ? `<img src="${call.contact_avatar}" style="width:20px;height:20px;border-radius:50%;vertical-align:middle;margin-right:6px;object-fit:cover">`
    : '';
  const contactHtml = call.contact_name
    ? `<span class="badge bg-success bg-opacity-10 text-success border border-success border-opacity-25 contact-badge-clickable" data-uid="${esc(call.unique_id)}" style="cursor:pointer;display:flex;align-items:center" title="Voir la fiche contact">${avatarHtml}${esc(call.contact_name)}</span>`
    : '<span class="text-muted">—</span>';
  const callbackBtn = (call.status === 'missed' && call.caller_id_num)
    ? ` <button class="btn btn-callback btn-outline-success" title="Rappeler" onclick="dialNumber('${esc(call.caller_id_num)}')"><i class="bi bi-telephone-outbound"></i></button>`
    : '';
  const recBtn = call.recording_url
    ? ` <button class="btn btn-sm btn-outline-danger py-0 px-1" onclick="playRecording('${esc(call.recording_url)}')" title="Écouter l'enregistrement"><i class="bi bi-play-fill" style="font-size:.7rem"></i></button>`
    : '';
  return `<td class="text-muted small">${t}</td>
    <td class="text-center">${dir}</td>
    <td>${phoneLink(call.caller_id_num)}${callbackBtn}</td>
    <td><span class="badge bg-primary bg-opacity-10 text-primary">${esc(exten)}</span></td>
    <td class="td-contact">${contactHtml}</td>
    <td><span class="badge ${call.status === 'hangup' && call.answered_at ? 'bg-success' : (statusBadges[call.status] || 'bg-secondary')}">${call.status === 'hangup' && call.answered_at ? 'Décroché' : (statusLabels[call.status] || call.status || '—')}</span>${recBtn}</td>`;
}
