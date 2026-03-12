// ═══════════════════════════════════════════════════════════════════════════
// ══ WEBSOCKET MANAGEMENT ═══════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════

let ws;

function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen  = () => {
    setWsStatus(true);
    subscribeToExtensions();
  };
  ws.onclose = () => { setWsStatus(false); setTimeout(connectWs, 3000); };
  ws.onmessage = ({ data }) => {
    let msg; try { msg = JSON.parse(data); } catch { return; }
    if (msg.type === 'call:incoming') {
      addCallRow(msg.data, 'incoming');
      showIncomingCallPopup(msg.data);
    }
    if (msg.type === 'call:answered') updateCallRow(msg.data, 'answered');
    if (msg.type === 'call:hangup') {
      updateCallRow(msg.data, 'hangup');
      setTimeout(() => { loadCallHistory(); loadFullJournal(jPage); }, 500);
    }
    if (msg.type === 'contact') updateCallContact(msg.data);
    if (msg.type === 'agent:status_changed') fetchAgentStatus();
  };
}

async function subscribeToExtensions() {
  try {
    const r = await fetch('/status');
    if (!r.ok) return;
    const d = await r.json();
    const extensions = d.ucm?.watchExtensions || [];
    
    if (extensions.length > 0) {
      for (const exten of extensions) {
        ws.send(JSON.stringify({ type: 'subscribe', extension: exten }));
      }
      console.log('Subscribed to extensions:', extensions);
    } else {
      ws.send(JSON.stringify({ type: 'subscribe', extension: '*' }));
      console.log('Subscribed to all extensions');
    }
  } catch (e) {
    console.error('Failed to subscribe to extensions:', e);
  }
}

function setWsStatus(ok) {
  document.getElementById('wsIndicator').className = 'status-dot ' + (ok ? 'dot-green' : 'dot-red');
  const lbl = document.getElementById('wsLabel');
  lbl.textContent = ok ? 'Connecté' : 'Déconnecté';
  lbl.className = ok ? 'text-success small' : 'text-danger small';
}
