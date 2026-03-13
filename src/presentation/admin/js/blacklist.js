// ═══════════════════════════════════════════════════════════════════════════
// ══ BLACKLIST ════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════

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
