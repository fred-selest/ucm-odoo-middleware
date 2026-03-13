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
    <td><span class="badge bg-primary bg-opacity-10 text-primary">${esc(call.exten||call.agentExten||'—')}</span></td>
    <td class="td-contact">${contactBadge}</td>
    <td><span class="badge ${badges[status]}">${labels[status]}</span></td>`;
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
          const dt = new Date(c.started_at.replace(' ','T')+'Z');
          const ts = dt.toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'}) + ' ' +
                     dt.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
          return `<div class="d-flex justify-content-between border-bottom py-1" style="font-size:.78rem">
            <span class="text-muted">${ts}</span>
            <span class="${statClass[c.status]||'text-muted'}">${statLabels[c.status]||c.status}</span>
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

// ── Transfert d'appel ────────────────────────────────────────────────────────
let _extensionsList = [];

async function loadExtensionsList() {
  try {
    const r = await apiFetch('/api/extensions');
    if (!r.ok) return;
    const d = await r.json();
    _extensionsList = d.data || [];
    const sel = document.getElementById('transferExtSelect');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Choisir une extension —</option>' +
      _extensionsList.map(e => {
        const num  = e.extension || e.exten || e.number || '';
        const name = e.name || e.fullname || e.callerid || '';
        return `<option value="${esc(num)}">${esc(num)}${name ? ' — ' + esc(name) : ''}</option>`;
      }).join('');
  } catch { }
}

async function transferCurrentCall() {
  const sel = document.getElementById('transferExtSelect');
  const extension = sel?.value?.trim();
  if (!extension) { showToast('Choisissez une extension', 'warning'); return; }
  if (!currentIncomingCall?.uniqueId) { showToast('Aucun appel actif', 'warning'); return; }
  try {
    const r = await apiFetch(`/api/calls/${currentIncomingCall.uniqueId}/transfer`, {
      method: 'POST', body: JSON.stringify({ extension }),
    });
    const d = await r.json();
    if (d.ok) {
      showToast(`Transféré vers ${extension}`, 'success');
      closeIncomingCallModal();
    } else {
      showToast('Erreur : ' + d.error, 'danger');
    }
  } catch (err) {
    showToast('Erreur réseau : ' + err.message, 'danger');
  }
}

// ── Blacklist ────────────────────────────────────────────────────────────────
async function loadBlacklist() {
  try {
    const r = await apiFetch('/api/blacklist');
    if (!r.ok) return;
    const d = await r.json();
    const tbody = document.getElementById('blacklistBody');
    if (!tbody) return;
    const list = d.data || [];
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3 small">Aucun numéro bloqué</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(b => `<tr>
      <td><code class="small">${esc(b.phone_number)}</code></td>
      <td class="small text-muted">${esc(b.reason || '—')}</td>
      <td class="small text-muted">${b.blocked_at ? new Date(b.blocked_at).toLocaleDateString('fr-FR') : '—'}</td>
      <td class="small text-muted">${esc(b.blocked_by || '—')}</td>
      <td><button class="btn btn-sm btn-outline-danger" onclick="removeFromBlacklist('${esc(b.phone_number)}')">
        <i class="bi bi-trash"></i></button></td>
    </tr>`).join('');
  } catch { }
}

async function addToBlacklist(phoneNumber, reason) {
  try {
    const r = await apiFetch('/api/blacklist', {
      method: 'POST',
      body: JSON.stringify({ phoneNumber, reason }),
    });
    const d = await r.json();
    if (d.ok) { loadBlacklist(); showToast(`${phoneNumber} bloqué`); }
    else showToast('Erreur : ' + d.error, 'danger');
  } catch (err) { showToast('Erreur : ' + err.message, 'danger'); }
}

async function removeFromBlacklist(phoneNumber) {
  if (!confirm(`Retirer ${phoneNumber} de la blacklist ?`)) return;
  try {
    await apiFetch(`/api/blacklist/${encodeURIComponent(phoneNumber)}`, { method: 'DELETE' });
    loadBlacklist();
    showToast(`${phoneNumber} retiré`);
  } catch { }
}

function blockCurrentCaller() {
  if (!currentIncomingCall?.callerIdNum) return;
  const phone  = currentIncomingCall.callerIdNum;
  const reason = prompt(`Raison du blocage de ${phone} ?`, 'Bloqué depuis appel entrant');
  if (reason === null) return;
  addToBlacklist(phone, reason);
  closeIncomingCallModal();
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
  return `<td class="text-muted small">${t}</td>
    <td class="text-center">${dir}</td>
    <td>${phoneLink(call.caller_id_num)}${callbackBtn}</td>
    <td><span class="badge bg-primary bg-opacity-10 text-primary">${esc(exten)}</span></td>
    <td class="td-contact">${contactHtml}</td>
    <td><span class="badge ${statusBadges[call.status] || 'bg-secondary'}">${statusLabels[call.status] || call.status || '—'}</span></td>`;
}
