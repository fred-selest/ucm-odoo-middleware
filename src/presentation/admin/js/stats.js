// ═══════════════════════════════════════════════════════════════════════════
// ══ STATISTIQUES / GRAPHIQUES ═══════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════

let _chartHourly = null;
let _chartStatus = null;

async function loadStatsTab() {
  try {
    const [sRes, hRes, eRes] = await Promise.all([
      apiFetch('/api/stats?period=today').then(r => r.json()).catch(() => ({})),
      apiFetch('/api/stats/hourly').then(r => r.json()).catch(() => ({})),
      apiFetch('/api/stats/extensions?days=7').then(r => r.json()).catch(() => ({})),
    ]);

    // KPIs
    const s = sRes.data || {};
    const setEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setEl('statTotal',      s.total      || 0);
    setEl('statAnswered',   s.answered   || 0);
    setEl('statMissed',     s.missed     || 0);
    setEl('statAnswerRate', s.answerRate != null ? Math.round(s.answerRate) + '%' : '—');
    const avg = s.avgDuration || 0;
    setEl('statAvgDur', avg ? (avg >= 60 ? Math.floor(avg/60) + 'min ' + (avg%60) + 's' : avg + 's') : '—');

    // Chart horaire
    const hourlyData = Array.from({ length: 24 }, (_, h) => {
      const found = (hRes.data || []).find(d => parseInt(d.hour) === h);
      return found ? (found.count || found.total || 0) : 0;
    });
    const ctxH = document.getElementById('chartHourly');
    if (ctxH && typeof Chart !== 'undefined') {
      if (_chartHourly) { _chartHourly.data.datasets[0].data = hourlyData; _chartHourly.update(); }
      else {
        _chartHourly = new Chart(ctxH, {
          type: 'bar',
          data: {
            labels: Array.from({ length: 24 }, (_, h) => h + 'h'),
            datasets: [{ label: 'Appels', data: hourlyData,
              backgroundColor: 'rgba(37,99,235,0.7)', borderRadius: 4 }],
          },
          options: { responsive: true, plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } },
        });
      }
    }

    // Chart donut décroché/manqué
    const answered = s.answered || 0;
    const missed   = s.missed   || 0;
    const ctxS = document.getElementById('chartStatus');
    if (ctxS && typeof Chart !== 'undefined' && (answered + missed) > 0) {
      if (_chartStatus) {
        _chartStatus.data.datasets[0].data = [answered, missed]; _chartStatus.update();
      } else {
        _chartStatus = new Chart(ctxS, {
          type: 'doughnut',
          data: {
            labels: ['Décroché', 'Manqué'],
            datasets: [{ data: [answered, missed],
              backgroundColor: ['rgba(22,163,74,0.8)', 'rgba(220,38,38,0.8)'],
              borderWidth: 0 }],
          },
          options: { responsive: true, cutout: '65%',
            plugins: { legend: { position: 'bottom' } } },
        });
      }
    }

    // Top extensions
    const extData = eRes.data || [];
    const extTbody = document.getElementById('statsExtBody');
    if (extTbody) {
      extTbody.innerHTML = extData.length
        ? extData.slice(0, 10).map(e => `<tr>
            <td><code class="small">${esc(e.exten || e.extension || '—')}</code></td>
            <td class="small">${e.total || 0}</td>
            <td class="small text-success">${e.answered || 0}</td>
            <td class="small text-danger">${e.missed || 0}</td>
          </tr>`).join('')
        : '<tr><td colspan="4" class="text-center text-muted py-3 small">Aucune donnée</td></tr>';
    }
  } catch { }
}
