'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// ══ DASHBOARD — statistiques du jour, agents, appels récents ══════════════
// Utilise apiFetch() défini dans auth.js (gère X-Session-Token automatique)
// ═══════════════════════════════════════════════════════════════════════════

let _dashChart = null;

async function loadDashboard() {
  await Promise.allSettled([
    loadDashKpi(),
    loadDashAgents(),
    loadDashRecentCalls(),
    loadDashChart(),
    loadDashRecordings(),
  ]);
}

// ── KPI du jour ─────────────────────────────────────────────────────────────
async function loadDashKpi() {
  try {
    const r = await apiFetch('/api/stats/today');
    const d = await r.json();
    if (!d.ok) return;
    const s = d.stats;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('dashKpiTotal',    s.total_calls    || 0);
    set('dashKpiAnswered', s.answered_calls || 0);
    set('dashKpiMissed',   s.missed_calls   || 0);
    set('dashKpiRate',     (s.answer_rate   || 0) + '%');
    set('dashKpiAvgDur',   fmtDur(s.avg_duration || 0));
    set('dashKpiDurTotal', fmtDur(s.total_duration || 0));
  } catch { /* ignore */ }
}

// ── Statuts agents ──────────────────────────────────────────────────────────
async function loadDashAgents() {
  try {
    const r = await apiFetch('/api/agents/status');
    const d = await r.json();
    const agents = d.data || [];
    const counts = { available: 0, on_call: 0, pause: 0, offline: 0 };
    agents.forEach(a => { if (counts[a.status] !== undefined) counts[a.status]++; else counts.offline++; });
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('dashAgentsAvailable', counts.available);
    set('dashAgentsOnCall',    counts.on_call);
    set('dashAgentsPaused',    counts.pause);
    set('dashAgentsOffline',   counts.offline);

    const list = document.getElementById('dashAgentsList');
    if (!list) return;
    if (!agents.length) {
      list.innerHTML = '<div class="text-muted small text-center py-3">Aucun agent enregistré</div>';
      return;
    }
    const STATUS = { available: ['success', 'Disponible'], on_call: ['danger', 'En appel'], busy: ['warning', 'Occupé'], pause: ['secondary', 'Pause'], offline: ['dark', 'Hors ligne'] };
    list.innerHTML = agents.map(a => {
      const [cls, lbl] = STATUS[a.status] || ['secondary', a.status];
      return `<div class="d-flex align-items-center gap-2 py-1 border-bottom">
        <i class="bi bi-person-circle text-${cls}"></i>
        <div class="flex-grow-1 small"><strong>${esc(a.exten)}</strong></div>
        <span class="badge bg-${cls}">${lbl}</span>
      </div>`;
    }).join('');
  } catch { /* ignore */ }
}

// ── Appels récents (DB) ──────────────────────────────────────────────────────
async function loadDashRecentCalls() {
  try {
    const r = await apiFetch('/api/calls?limit=8');
    const d = await r.json();
    const calls = d.data || [];
    const el = document.getElementById('dashRecentCalls');
    if (!el) return;
    if (!calls.length) {
      el.innerHTML = '<div class="text-muted small text-center py-3">Aucun appel enregistré</div>';
      return;
    }
    el.innerHTML = calls.map(c => {
      const dir   = c.direction === 'outbound' ? 'outbound' : 'inbound';
      const dirCls = dir === 'inbound' ? 'success' : 'primary';
      const statCls = c.status === 'answered' || c.status === 'hangup' ? 'success' : c.status === 'missed' ? 'danger' : 'secondary';
      const statLbl = c.status === 'answered' || c.status === 'hangup' ? 'Décroché' : c.status === 'missed' ? 'Manqué' : c.status || '—';
      return `<div class="d-flex align-items-center gap-2 py-1 border-bottom">
        <i class="bi bi-telephone-${dir} text-${dirCls}"></i>
        <div class="flex-grow-1 small">
          <span class="fw-semibold">${esc(c.caller_id_num || c.callerIdNum || '—')}</span>
          ${c.contact_name || c.contactName ? `<span class="text-muted ms-1">(${esc(c.contact_name || c.contactName)})</span>` : ''}
        </div>
        <span class="badge bg-${statCls} bg-opacity-75">${statLbl}</span>
        <span class="text-muted small">${fmtDur(c.duration || 0)}</span>
      </div>`;
    }).join('');
  } catch { /* ignore */ }
}

// ── Graphique horaire ────────────────────────────────────────────────────────
async function loadDashChart() {
  const ctx = document.getElementById('dashChartHourly');
  if (!ctx || typeof Chart === 'undefined') return;
  try {
    const [hRes, sRes] = await Promise.all([
      apiFetch('/api/stats/hourly').then(r => r.json()).catch(() => ({})),
      apiFetch('/api/stats/today').then(r => r.json()).catch(() => ({})),
    ]);
    const hourlyData = Array.from({ length: 24 }, (_, h) => {
      const found = (hRes.data || []).find(d => parseInt(d.hour) === h);
      return found ? (found.count || found.total || 0) : 0;
    });
    const stats = sRes.stats || {};
    const missed  = stats.missed_calls || 0;
    const answered = stats.answered_calls || 0;

    if (_dashChart) {
      _dashChart.data.datasets[0].data = hourlyData;
      _dashChart.update();
    } else {
      _dashChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: Array.from({ length: 24 }, (_, h) => h + 'h'),
          datasets: [{ label: 'Appels', data: hourlyData, backgroundColor: 'rgba(37,99,235,0.65)', borderRadius: 4 }],
        },
        options: { responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } },
      });
    }

    // Donut décroché/manqué
    const ctx2 = document.getElementById('dashChartStatus');
    if (ctx2 && (answered + missed) > 0) {
      if (window._dashChartStatus) {
        window._dashChartStatus.data.datasets[0].data = [answered, missed];
        window._dashChartStatus.update();
      } else {
        window._dashChartStatus = new Chart(ctx2, {
          type: 'doughnut',
          data: {
            labels: ['Décroché', 'Manqué'],
            datasets: [{ data: [answered, missed], backgroundColor: ['rgba(22,163,74,0.8)', 'rgba(220,38,38,0.8)'], borderWidth: 0 }],
          },
          options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } },
        });
      }
    }
  } catch { /* ignore */ }
}

// ── Enregistrements récents ──────────────────────────────────────────────────
async function loadDashRecordings() {
  try {
    const r = await apiFetch('/api/recordings?limit=5');
    const d = await r.json();
    const recs = d.data || [];
    const el = document.getElementById('dashRecordingsList');
    if (!el) return;
    if (!recs.length) {
      el.innerHTML = '<div class="text-muted small text-center py-3">Aucun enregistrement</div>';
      return;
    }
    el.innerHTML = recs.map(rec => {
      const dt = rec.started_at ? new Date(rec.started_at.replace(' ', 'T') + 'Z') : null;
      const time = dt ? dt.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit' }) + ' ' + dt.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' }) : '';
      return `
      <div class="d-flex align-items-center gap-2 py-1 border-bottom">
        <button class="btn btn-sm btn-outline-danger py-0 px-1" onclick="playRecording('${esc(rec.recording_url)}')" title="Écouter">
          <i class="bi bi-play-fill"></i>
        </button>
        <div class="flex-grow-1 small text-truncate">
          <span class="fw-semibold">${esc(rec.contact_name || rec.caller_id_num || '—')}</span>
          ${rec.contact_name && rec.caller_id_num ? `<span class="text-muted ms-1">${esc(rec.caller_id_num)}</span>` : ''}
        </div>
        <div class="text-end small text-nowrap">
          <span class="text-muted">${fmtDur(rec.duration || 0)}</span>
          <div class="text-muted" style="font-size:.7rem">${time}</div>
        </div>
      </div>${rec.transcription ? `<div class="small text-muted ps-4 pb-1" style="font-size:.75rem;margin-top:-4px"><i class="bi bi-chat-left-text me-1"></i>${esc(rec.transcription.slice(0, 100))}${rec.transcription.length > 100 ? '…' : ''}</div>` : ''}`;
    }).join('');
  } catch { /* ignore */ }
}

// ── Utilitaires ──────────────────────────────────────────────────────────────
function fmtDur(s) {
  if (!s) return '0s';
  const m = Math.floor(s / 60), sec = s % 60;
  return m > 0 ? `${m}min ${sec}s` : `${sec}s`;
}
