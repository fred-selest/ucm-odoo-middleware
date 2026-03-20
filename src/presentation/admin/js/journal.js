// ═══════════════════════════════════════════════════════════════════════════
// ══ JOURNAL DES APPELS ══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════

let jPage = 1;
const jLimit = 50;
let jData = [];

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
  document.getElementById('jAvgDur').textContent   = avgDur ? (avgDur >= 60 ? Math.floor(avgDur / 60) + 'min' : avgDur + 's') : '—';
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
      ? (c.duration >= 60 ? Math.floor(c.duration / 60) + 'min ' + (c.duration % 60) + 's' : c.duration + 's')
      : '—';
    return `<tr>
      <td class="text-muted small" style="white-space:nowrap">${dateStr} <strong>${timeStr}</strong></td>
      <td>${dir}</td>
      <td>${phoneLink(c.caller_id_num)}</td>
      <td><span class="badge bg-primary bg-opacity-10 text-primary">${esc(exten)}</span></td>
      <td>${contact}</td>
      <td class="small text-nowrap">${dur}</td>
      <td><span class="badge ${J_STATUS_BADGES[c.status] || 'bg-secondary'}">${J_STATUS_LABELS[c.status] || c.status || '—'}</span></td>
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
  if (currentPage > 1) pages.push(`<button class="btn btn-sm btn-outline-secondary" onclick="loadFullJournal(${currentPage - 1})"><i class="bi bi-chevron-left"></i></button>`);
  let start = Math.max(1, currentPage - 2), end = Math.min(totalPages, start + 4);
  if (end - start < 4) start = Math.max(1, end - 4);
  for (let p = start; p <= end; p++)
    pages.push(`<button class="btn btn-sm ${p === currentPage ? 'btn-primary' : 'btn-outline-secondary'}" onclick="loadFullJournal(${p})">${p}</button>`);
  if (currentPage < totalPages) pages.push(`<button class="btn btn-sm btn-outline-secondary" onclick="loadFullJournal(${currentPage + 1})"><i class="bi bi-chevron-right"></i></button>`);
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
      dt.toLocaleTimeString('fr-FR', { hour:'2-digit',minute:'2-digit' }),
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
