// ═══════════════════════════════════════════════════════════════════════════
// ══ BLACKLIST ════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════

async function loadBlacklist() {
  try {
    const r = await apiFetch('/api/blacklist?limit=500');
    if (!r.ok) return;
    const d = await r.json();
    const tbody = document.getElementById('blacklistBody');
    if (!tbody) return;
    const list = d.data || [];

    // Compteur
    const counter = document.getElementById('blCount');
    if (counter) counter.textContent = list.length;

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3 small">Aucun numéro bloqué</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(b => {
      const isPrefix = b.phone_number.endsWith('*');
      const badge = isPrefix
        ? '<span class="badge bg-warning bg-opacity-25 text-warning ms-1" style="font-size:.65rem">préfixe</span>'
        : '';
      return `<tr>
      <td><code class="small">${esc(b.phone_number)}</code>${badge}</td>
      <td class="small text-muted">${esc(b.reason || '—')}</td>
      <td class="small text-muted">${b.blocked_at ? new Date(b.blocked_at).toLocaleDateString('fr-FR') : '—'}</td>
      <td class="small text-muted">${esc(b.blocked_by || '—')}</td>
      <td><button class="btn btn-sm btn-outline-danger" onclick="removeFromBlacklist('${esc(b.phone_number)}')">
        <i class="bi bi-trash"></i></button></td>
    </tr>`;
    }).join('');
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

// Bloquer depuis le journal d'appels
function blockFromJournal(phone) {
  const reason = prompt(`Raison du blocage de ${phone} ?`, 'Spam / démarchage');
  if (reason === null) return;
  addToBlacklist(phone, reason);
}

// Bloquer depuis la popup contact
function blockFromContact() {
  const phone = document.getElementById('popupContactPhone')?.textContent?.trim();
  if (!phone || phone === '—') { showToast('Pas de numéro à bloquer', 'warning'); return; }
  const reason = prompt(`Raison du blocage de ${phone} ?`, 'Bloqué depuis fiche contact');
  if (reason === null) return;
  addToBlacklist(phone, reason);
}

function blockCurrentCaller() {
  if (!currentIncomingCall?.callerIdNum) return;
  const phone  = currentIncomingCall.callerIdNum;
  const reason = prompt(`Raison du blocage de ${phone} ?`, 'Bloqué depuis appel entrant');
  if (reason === null) return;
  addToBlacklist(phone, reason);
  closeIncomingCallModal();
}

// Import des préfixes spam français ARCEP
async function importSpamFR() {
  if (!confirm('Importer les 23 préfixes de démarchage/M2M identifiés par l\'ARCEP ?')) return;
  try {
    const r = await apiFetch('/api/blacklist/import-spam-fr', { method: 'POST' });
    const d = await r.json();
    if (d.ok) {
      showToast(`${d.added} préfixes importés`);
      loadBlacklist();
    } else {
      showToast('Erreur : ' + d.error, 'danger');
    }
  } catch (err) { showToast('Erreur : ' + err.message, 'danger'); }
}

// Vérifier le score spam d'un numéro via Tellows
async function checkSpamScore(phoneNumber) {
  const phone = phoneNumber || document.getElementById('blPhone')?.value?.trim();
  if (!phone) { showToast('Entrez un numéro', 'warning'); return; }
  try {
    const r = await apiFetch(`/api/spam/check/${encodeURIComponent(phone)}`);
    const d = await r.json();
    if (!d.ok || !d.data) {
      showToast(`${phone} : aucune donnée Tellows`, 'info');
      return;
    }
    const s = d.data;
    const color = s.score >= 7 ? 'danger' : s.score >= 5 ? 'warning' : 'success';
    const label = s.score >= 7 ? 'SPAM' : s.score >= 5 ? 'Suspect' : 'OK';
    showToast(`${phone} : ${label} (score ${s.score}/9, ${s.searches} recherches${s.callerType ? ', ' + s.callerType : ''})`, color);

    // Proposer de bloquer si score élevé
    if (s.score >= 7) {
      if (confirm(`${phone} a un score de ${s.score}/9 (${s.callerType || 'spam'}). Bloquer ?`)) {
        addToBlacklist(phone, `Tellows score ${s.score}/9 - ${s.callerType || 'spam'}`);
      }
    }
  } catch (err) { showToast('Erreur : ' + err.message, 'danger'); }
}
