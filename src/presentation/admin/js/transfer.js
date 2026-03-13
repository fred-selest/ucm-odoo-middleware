// ═══════════════════════════════════════════════════════════════════════════
// ══ TRANSFERT D'APPEL ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════

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
