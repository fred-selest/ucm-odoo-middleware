// ═══════════════════════════════════════════════════════════════════════════
// ══ CONTACT MANAGEMENT ═════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════

let _quickContactData = {};
let currentContactId = null;
let contactPopupModal;

async function showQuickContact(contact) {
  _quickContactData = contact;
  currentContactId = contact.id;
  
  if (!contactPopupModal) {
    contactPopupModal = new bootstrap.Modal(document.getElementById('modalContactPopup'));
  }
  
  let fullContact = contact;
  if (contact.id) {
    try {
      const r = await apiFetch(`/api/odoo/contacts/${contact.id}`);
      const d = await r.json();
      if (d.ok && d.data) {
        fullContact = { ...contact, ...d.data };
        _quickContactData = fullContact;
      }
    } catch (e) {
      console.log('Could not fetch full contact data:', e);
    }
  }
  
  document.getElementById('popupContactId').value = fullContact.id;
  document.getElementById('popupContactName').textContent = fullContact.name;
  document.getElementById('popupContactFunction').textContent = fullContact.function || '—';
  document.getElementById('popupContactPhone').textContent = fullContact.phone || '—';
  document.getElementById('popupContactMobile').textContent = '—';
  document.getElementById('popupContactEmail').textContent = fullContact.email || '—';
  document.getElementById('popupContactStreet').textContent = fullContact.street || '—';
  document.getElementById('popupContactCity').textContent = (fullContact.zip || '') + ' ' + (fullContact.city || '') || '—';
  document.getElementById('popupContactCountry').textContent = fullContact.country || '—';
  document.getElementById('popupContactCompany').textContent = fullContact.company || '—';
  document.getElementById('popupContactSiret').textContent = fullContact.companyRegistry || '—';
  document.getElementById('popupContactVat').textContent = fullContact.vat || '—';

  const websiteEl = document.getElementById('popupContactWebsite');
  if (fullContact.website) {
    websiteEl.textContent = fullContact.website;
    websiteEl.href = fullContact.website.startsWith('http') ? fullContact.website : 'https://' + fullContact.website;
  } else {
    websiteEl.textContent = '—';
    websiteEl.href = '#';
  }
  
  document.getElementById('popupContactOdooLink').href = fullContact.odooUrl || '#';

  document.getElementById('popupContactNote').value = fullContact.comment || '';
  document.getElementById('popupNoteResult').innerHTML = '';
  
  const editBtn = document.getElementById('popupEditBtn');
  if (fullContact.id) {
    editBtn.style.display = '';
    editBtn.onclick = () => openQuickEditContact(fullContact);
  } else {
    editBtn.style.display = 'none';
  }
  
  const avatarEl = document.getElementById('popupContactAvatar');
  if (fullContact.avatar) {
    avatarEl.innerHTML = `<img src="${fullContact.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  } else {
    const initials = (fullContact.name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    avatarEl.innerHTML = `<span style="font-size:2rem;font-weight:700;color:#22c55e">${initials}</span>`;
  }
  
  document.getElementById('popupContactHistory').textContent = 'Chargement…';
  loadQuickHistory(fullContact);
  contactPopupModal.show();
}

document.getElementById('popupNoteSaveBtn').addEventListener('click', async () => {
  const contactId = document.getElementById('popupContactId').value;
  const note      = document.getElementById('popupContactNote').value;
  const result    = document.getElementById('popupNoteResult');
  if (!contactId) { result.innerHTML = '<span class="text-warning">Aucun contact</span>'; return; }
  result.innerHTML = '<span class="text-muted">Enregistrement…</span>';
  try {
    const r = await apiFetch(`/api/odoo/contacts/${contactId}`, {
      method: 'PUT',
      body: JSON.stringify({ comment: note })
    });
    const d = await r.json();
    if (d.ok) {
      // Poster aussi dans le chatter pour conserver l'historique horodaté
      if (note.trim()) {
        await apiFetch(`/api/odoo/contacts/${contactId}/notes`, {
          method: 'POST',
          body: JSON.stringify({ note: `📝 ${note.trim()}` })
        }).catch(() => {});
      }
      result.innerHTML = '<span class="text-success">Note enregistrée ✓</span>';
      if (_quickContactData) _quickContactData.comment = note;
      // Recharger l'historique pour afficher la nouvelle note
      loadQuickHistory(_quickContactData);
      setTimeout(() => { result.innerHTML = ''; }, 3000);
    } else {
      result.innerHTML = `<span class="text-danger">${esc(d.error || 'Erreur')}</span>`;
    }
  } catch (e) {
    result.innerHTML = '<span class="text-danger">Erreur réseau</span>';
  }
});

async function loadQuickHistory(contact) {
  const el = document.getElementById('popupContactHistory');
  el.textContent = 'Chargement…';
  try {
    const requests = [
      contact.id ? apiFetch(`/api/odoo/contacts/${contact.id}/messages`).then(r => r.json()).catch(() => ({ ok: false })) : Promise.resolve({ ok: false }),
      contact.phone ? apiFetch(`/api/calls/history?caller=${encodeURIComponent(contact.phone)}&limit=10`).then(r => r.json()).catch(() => ({ ok: false })) : Promise.resolve({ ok: false }),
    ];
    const [msgResult, callResult] = await Promise.all(requests);
    const items = [];

    if (callResult.ok && callResult.data) {
      const icons  = { answered:'📞', missed:'📵', hangup:'📴', ringing:'🔔' };
      const labels = { answered:'Décroché', missed:'Manqué', hangup:'Raccroché', ringing:'Sonnerie' };
      callResult.data.forEach(c => {
        const dt  = new Date(c.started_at.replace(' ', 'T') + 'Z');
        const dur = c.duration > 0 ? ` · ${c.duration >= 60 ? Math.floor(c.duration / 60) + 'min ' : ''}${c.duration % 60}s` : '';
        items.push({ dt, html:
          `<div class="d-flex justify-content-between py-1 border-bottom">
            <span>${icons[c.status] || '📞'} ${labels[c.status] || c.status}${dur}</span>
            <span class="text-muted">${dt.toLocaleDateString('fr-FR',{ day:'2-digit',month:'2-digit' })}</span>
          </div>` });
      });
    }

    if (msgResult.ok && msgResult.data) {
      msgResult.data.forEach(m => {
        const dt = new Date((m.date || '').replace(' ', 'T') + 'Z');
        const preview = m.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
        const isNote = preview.startsWith('📝');
        const icon = isNote ? '' : '💬 ';
        const style = isNote ? 'color:#92400e;font-weight:500' : '';
        items.push({ dt, html:
          `<div class="d-flex justify-content-between align-items-start py-1 border-bottom">
            <span class="me-1" style="${style}">${icon}${esc(preview)}</span>
            <span class="text-muted flex-shrink-0">${dt.toLocaleDateString('fr-FR',{ day:'2-digit',month:'2-digit' })}</span>
          </div>` });
      });
    }

    if (!items.length) { el.innerHTML = '<span class="text-muted">Aucun historique</span>'; return; }
    items.sort((a, b) => b.dt - a.dt);
    el.innerHTML = items.slice(0, 10).map(i => i.html).join('');
  } catch { el.innerHTML = '<span class="text-muted text-danger">Erreur chargement</span>'; }
}

// ── Quick Edit Modal ────────────────────────────────────────────────────────
let quickEditModal;

function openQuickEditContact(contact) {
  if (!quickEditModal) {
    quickEditModal = new bootstrap.Modal(document.getElementById('modalQuickEdit'));
  }
  closeIncomingCallModal();
  
  document.getElementById('quickEditId').value = contact.id;
  document.getElementById('quickEditName').value = contact.name || '';
  document.getElementById('quickEditPhone').value = contact.phone || '';
  document.getElementById('quickEditEmail').value = contact.email || '';
  document.getElementById('quickEditFunction').value = contact.function || '';
  document.getElementById('quickEditStreet').value = contact.street || '';
  document.getElementById('quickEditZip').value = contact.zip || '';
  document.getElementById('quickEditCity').value = contact.city || '';
  document.getElementById('quickEditCountry').value = contact.country || '';
  document.getElementById('quickEditCompany').value = contact.company || '';
  document.getElementById('quickEditWebsite').value = contact.website || '';
  document.getElementById('quickEditComment').value = contact.comment || '';
  
  document.getElementById('quickEditError').classList.add('d-none');
  document.getElementById('quickEditSuccess').classList.add('d-none');
  quickEditModal.show();
}

document.getElementById('saveQuickEditBtn').onclick = async () => {
  const contactId = document.getElementById('quickEditId').value;
  const body = {
    name: document.getElementById('quickEditName').value.trim(),
    phone: document.getElementById('quickEditPhone').value.trim(),
    email: document.getElementById('quickEditEmail').value.trim(),
    function: document.getElementById('quickEditFunction').value.trim(),
    street: document.getElementById('quickEditStreet').value.trim(),
    zip: document.getElementById('quickEditZip').value.trim(),
    city: document.getElementById('quickEditCity').value.trim(),
    country: document.getElementById('quickEditCountry').value.trim(),
    company: document.getElementById('quickEditCompany').value.trim(),
    website: document.getElementById('quickEditWebsite').value.trim(),
    comment: document.getElementById('quickEditComment').value.trim(),
  };
  
  if (!body.name) {
    document.getElementById('quickEditError').textContent = 'Nom requis';
    document.getElementById('quickEditError').classList.remove('d-none');
    return;
  }
  
  const btn = document.getElementById('saveQuickEditBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Enregistrement…';
  
  try {
    const r = await apiFetch(`/api/odoo/contacts/${contactId}`, {
      method: 'PUT',
      body: JSON.stringify(body)
    });
    const d = await r.json();
    if (d.ok) {
      document.getElementById('quickEditSuccess').textContent = '✓ Modifications enregistrées !';
      document.getElementById('quickEditSuccess').classList.remove('d-none');
      setTimeout(() => {
        quickEditModal.hide();
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-check-lg me-1"></i>Enregistrer les modifications';
      }, 1000);
    } else {
      document.getElementById('quickEditError').textContent = d.error;
      document.getElementById('quickEditError').classList.remove('d-none');
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-check-lg me-1"></i>Enregistrer les modifications';
    }
  } catch(e) {
    document.getElementById('quickEditError').textContent = e.message;
    document.getElementById('quickEditError').classList.remove('d-none');
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-check-lg me-1"></i>Enregistrer les modifications';
  }
};

// ── Créer un contact ────────────────────────────────────────────────────────
let createContactModal;

function openCreateContactModal() {
  if (!createContactModal) {
    createContactModal = new bootstrap.Modal(document.getElementById('modalCreateContact'));
  }
  ['newContactName','newContactPhone','newContactEmail','newContactCompany','newContactFunction'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('createContactError').classList.add('d-none');
  createContactModal.show();
}

document.getElementById('createContactBtn').addEventListener('click', async () => {
  const name = document.getElementById('newContactName').value.trim();
  const errEl = document.getElementById('createContactError');
  if (!name) {
    errEl.textContent = 'Nom requis';
    errEl.classList.remove('d-none');
    return;
  }
  const body = {
    name,
    phone:    document.getElementById('newContactPhone').value.trim(),
    email:    document.getElementById('newContactEmail').value.trim(),
    company:  document.getElementById('newContactCompany').value.trim(),
    function: document.getElementById('newContactFunction').value.trim(),
  };
  const btn = document.getElementById('createContactBtn');
  btn.disabled = true;
  try {
    const r = await apiFetch('/api/odoo/contacts', { method: 'POST', body: JSON.stringify(body) });
    const d = await r.json();
    if (d.ok) {
      createContactModal.hide();
      if (d.data) showQuickContact(d.data);
    } else {
      errEl.textContent = d.error || 'Erreur lors de la création';
      errEl.classList.remove('d-none');
    }
  } catch(e) {
    errEl.textContent = e.message;
    errEl.classList.remove('d-none');
  } finally {
    btn.disabled = false;
  }
});

// ── Modifier contact (modal simple depuis popup) ────────────────────────────
let editContactModal;

function openEditContactModal() {
  const contact = _quickContactData;
  if (!contact?.id) return;
  if (!editContactModal) {
    editContactModal = new bootstrap.Modal(document.getElementById('modalEditContact'));
  }
  document.getElementById('editContactId').value       = contact.id;
  document.getElementById('editContactName').value     = contact.name || '';
  document.getElementById('editContactPhone').value    = contact.phone || '';
  document.getElementById('editContactEmail').value    = contact.email || '';
  document.getElementById('editContactFunction').value = contact.function || '';
  document.getElementById('editContactError').classList.add('d-none');
  editContactModal.show();
}

document.getElementById('saveEditContactBtn').addEventListener('click', async () => {
  const contactId = document.getElementById('editContactId').value;
  const name = document.getElementById('editContactName').value.trim();
  const errEl = document.getElementById('editContactError');
  if (!name) { errEl.textContent = 'Nom requis'; errEl.classList.remove('d-none'); return; }
  const body = {
    name,
    phone:    document.getElementById('editContactPhone').value.trim(),
    email:    document.getElementById('editContactEmail').value.trim(),
    function: document.getElementById('editContactFunction').value.trim(),
  };
  const btn = document.getElementById('saveEditContactBtn');
  btn.disabled = true;
  try {
    const r = await apiFetch(`/api/odoo/contacts/${contactId}`, { method: 'PUT', body: JSON.stringify(body) });
    const d = await r.json();
    if (d.ok) {
      editContactModal.hide();
      if (d.data) showQuickContact(d.data);
    } else {
      errEl.textContent = d.error || 'Erreur';
      errEl.classList.remove('d-none');
    }
  } catch(e) {
    errEl.textContent = e.message;
    errEl.classList.remove('d-none');
  } finally {
    btn.disabled = false;
  }
});

// ── Enrichissement SIRENE ────────────────────────────────────────────────────
async function enrichContactSirene() {
  const contactId = document.getElementById('popupContactId').value;
  const resultEl = document.getElementById('popupSireneResult');
  const btn = document.getElementById('popupSireneBtn');
  if (!contactId) { resultEl.innerHTML = '<span class="text-warning">Aucun contact</span>'; return; }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Recherche…';
  resultEl.innerHTML = '';

  try {
    const r = await apiFetch('/api/sirene/enrich', {
      method: 'POST',
      body: JSON.stringify({ partnerId: parseInt(contactId) })
    });
    const d = await r.json();
    if (d.ok) {
      resultEl.innerHTML = '<span class="text-success">Fiche enrichie via SIRENE INSEE</span>';
      // Recharger les données du contact
      const cr = await apiFetch(`/api/odoo/contacts/${contactId}`);
      const cd = await cr.json();
      if (cd.ok && cd.data) {
        _quickContactData = { ..._quickContactData, ...cd.data };
        document.getElementById('popupContactSiret').textContent = cd.data.companyRegistry || '—';
        document.getElementById('popupContactVat').textContent = cd.data.vat || '—';
        document.getElementById('popupContactStreet').textContent = cd.data.street || '—';
        document.getElementById('popupContactCity').textContent = (cd.data.zip || '') + ' ' + (cd.data.city || '') || '—';
        document.getElementById('popupContactCompany').textContent = cd.data.company || '—';
      }
      setTimeout(() => { resultEl.innerHTML = ''; }, 5000);
    } else {
      resultEl.innerHTML = `<span class="text-danger">${esc(d.error)}</span>`;
    }
  } catch (e) {
    resultEl.innerHTML = `<span class="text-danger">${esc(e.message)}</span>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-search me-1"></i>SIRENE';
  }
}

// ── Historique contact ──────────────────────────────────────────────────────
let contactHistoryModal;

async function openContactHistory() {
  const contact = _quickContactData;
  if (!contact?.id) return;
  if (!contactHistoryModal) {
    contactHistoryModal = new bootstrap.Modal(document.getElementById('modalContactHistory'));
  }
  document.getElementById('historyContactName').textContent = contact.name || '';
  document.getElementById('contactHistoryBody').innerHTML =
    '<tr><td colspan="5" class="text-center text-muted py-3">Chargement…</td></tr>';
  document.getElementById('statTotalCalls').textContent   = '…';
  document.getElementById('statAnsweredCalls').textContent = '…';
  document.getElementById('statMissedCalls').textContent  = '…';
  document.getElementById('statTotalDuration').textContent = '…';
  contactHistoryModal.show();

  try {
    const r = await apiFetch(`/api/calls/history?caller=${encodeURIComponent(contact.phone || '')}&limit=100`);
    const d = await r.json();
    const calls = d.data || [];
    const answered = calls.filter(c => c.status === 'answered');
    const missed   = calls.filter(c => c.status === 'missed');
    const totalDur = Math.round(calls.reduce((s, c) => s + (c.duration || 0), 0) / 60);
    document.getElementById('statTotalCalls').textContent    = calls.length;
    document.getElementById('statAnsweredCalls').textContent = answered.length;
    document.getElementById('statMissedCalls').textContent   = missed.length;
    document.getElementById('statTotalDuration').textContent = totalDur;
    if (!calls.length) {
      document.getElementById('contactHistoryBody').innerHTML =
        '<tr><td colspan="5" class="text-center text-muted py-3">Aucun appel trouvé</td></tr>';
      return;
    }
    const STATUS = { answered: '<span class="badge bg-success">Décroché</span>', missed: '<span class="badge bg-danger">Manqué</span>', hangup: '<span class="badge bg-secondary">Raccroché</span>' };
    document.getElementById('contactHistoryBody').innerHTML = calls.map(c => {
      const dt = new Date(c.timestamp || c.startTime).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
      const dur = c.duration > 0 ? (c.duration >= 60 ? Math.floor(c.duration / 60) + 'min ' + c.duration % 60 + 's' : c.duration + 's') : '—';
      return `<tr>
        <td class="small">${esc(dt)}</td>
        <td class="small">${c.direction === 'outbound' ? '↗ Sortant' : '↘ Entrant'}</td>
        <td class="small">${esc(c.exten || '—')}</td>
        <td class="small">${dur}</td>
        <td>${STATUS[c.status] || esc(c.status || '—')}</td>
      </tr>`;
    }).join('');
  } catch(e) {
    document.getElementById('contactHistoryBody').innerHTML =
      `<tr><td colspan="5" class="text-center text-danger py-3">${esc(e.message)}</td></tr>`;
  }
}
