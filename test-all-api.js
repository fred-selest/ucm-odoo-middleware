/**
 * Script de test complet - UCM ↔ Odoo Middleware
 * Teste toutes les fonctionnalités de l'API
 */

const axios = require('axios');

const BASE_URL = 'https://ucm.selest.info';

// Configuration de test
const TEST_CONFIG = {
  odooEmail: process.env.ODOO_EMAIL || 'contact@selest.info',
  odooPassword: process.env.ODOO_PASSWORD || '',
};

let sessionToken = null;

// Helper pour les requêtes authentifiées
function api() {
  return axios.create({
    baseURL: BASE_URL,
    headers: {
      'X-Session-Token': sessionToken,
      'Content-Type': 'application/json',
    },
    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
  });
}

// Helper pour les requêtes publiques
function publicApi() {
  return axios.create({
    baseURL: BASE_URL,
    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
  });
}

function log(title, success = true) {
  const icon = success ? '✅' : '❌';
  console.log(`${icon} ${title}`);
}

function section(title) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'═'.repeat(60)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
async function testHealth() {
  section('1. HEALTH CHECK (public)');
  
  try {
    const r = await publicApi().get('/health');
    log(`Health: ${r.data.status}`);
    log(`  UCM HTTP: ${r.data.ucmHttp ? 'OK' : 'KO'}`);
    log(`  UCM WebSocket: ${r.data.ucmWs ? 'OK' : 'KO'}`);
    return true;
  } catch (err) {
    log('Health check échoué', false);
    console.error(err.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
async function testLogin() {
  section('2. AUTHENTICATION');
  
  if (!TEST_CONFIG.odooPassword) {
    console.log('⚠️  ODOO_PASSWORD non défini - skip login tests');
    console.log('   Définir la variable d\'environnement pour tester');
    return false;
  }
  
  try {
    const r = await publicApi().post('/api/auth/login', {
      username: TEST_CONFIG.odooEmail,
      password: TEST_CONFIG.odooPassword,
    });
    
    sessionToken = r.data.token;
    log(`Login: ${r.data.username} (uid: ${r.data.uid})`);
    log(`  Token: ${sessionToken.substring(0, 8)}...`);
    return true;
  } catch (err) {
    log('Login échoué', false);
    console.error(err.response?.data || err.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
async function testAuthMe() {
  section('3. SESSION VERIFICATION');
  
  try {
    const r = await api().get('/api/auth/me');
    log(`Session valide: ${r.data.username} (uid: ${r.data.uid})`);
    return true;
  } catch (err) {
    log('Session invalide', false);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
async function testStatus() {
  section('4. GLOBAL STATUS');
  
  try {
    const r = await api().get('/api/status');
    const d = r.data;
    
    log('UCM:');
    log(`  Mode: ${d.ucm.mode}`);
    log(`  Host: ${d.ucm.host}:${d.ucm.port}`);
    log(`  HTTP: ${d.ucm.httpConnected ? 'Connecté' : 'Déconnecté'}`);
    log(`  WebSocket: ${d.ucm.wsConnected ? 'Connecté' : 'Déconnecté'}`);
    
    log('Odoo:');
    log(`  URL: ${d.odoo.url}`);
    log(`  DB: ${d.odoo.db}`);
    
    log('WebSocket Server:');
    log(`  Clients: ${d.websocket.clients}`);
    log(`  Subscriptions: ${d.websocket.subscriptions}`);
    
    log('Calls:');
    log(`  Actifs: ${d.calls.active}`);
    
    log('Server:');
    log(`  Uptime: ${Math.round(d.uptime / 60)} min`);
    log(`  Memory: ${Math.round(d.memory.heapUsed / 1024 / 1024)} MB`);
    
    return true;
  } catch (err) {
    log('Status check échoué', false);
    console.error(err.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
async function testConfig() {
  section('5. CONFIGURATION');
  
  try {
    const r = await api().get('/api/config');
    
    log('UCM Config:');
    log(`  Mode: ${r.data.ucm.mode}`);
    log(`  Host: ${r.data.ucm.host}`);
    log(`  Username: ${r.data.ucm.username}`);
    log(`  Extensions: ${r.data.ucm.watchExtensions.join(', ')}`);
    
    log('Odoo Config:');
    log(`  URL: ${r.data.odoo.url}`);
    log(`  DB: ${r.data.odoo.db}`);
    log(`  Username: ${r.data.odoo.username}`);
    
    return true;
  } catch (err) {
    log('Config check échoué', false);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
async function testOdooSearch() {
  section('6. ODOO CONTACT SEARCH');
  
  try {
    const r = await api().get('/api/odoo/search', {
      params: { q: 'Selest', limit: 5 }
    });
    
    log(`Recherche "Selest": ${r.data.count} résultats`);
    if (r.data.data.length > 0) {
      const c = r.data.data[0];
      log(`  1er: ${c.name} (${c.phone || 'no phone'})`);
    }
    return true;
  } catch (err) {
    log('Recherche Odoo échouée', false);
    console.error(err.response?.data || err.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
async function testCallHistory() {
  section('7. CALL HISTORY');
  
  try {
    const r = await api().get('/api/calls/history', {
      params: { limit: 5 }
    });
    
    log(`Historique: ${r.data.pagination.total} appels`);
    if (r.data.data.length > 0) {
      const c = r.data.data[0];
      log(`  Dernier: ${c.direction} - ${c.caller_id_num || 'inconnu'} → ${c.exten}`);
      log(`  Status: ${c.status}, Duration: ${c.duration || 0}s`);
    }
    return true;
  } catch (err) {
    log('Historique échoué', false);
    console.error(err.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
async function testStats() {
  section('8. STATISTICS');
  
  try {
    const r = await api().get('/api/stats', { params: { period: 'today' } });
    const d = r.data.data;
    
    log('Stats (aujourd\'hui):');
    log(`  Total appels: ${d.totalCalls || 0}`);
    log(`  Appels répondus: ${d.answeredCalls || 0}`);
    log(`  Appels manqués: ${d.missedCalls || 0}`);
    log(`  Durée totale: ${Math.round(d.totalDuration || 0)}s`);
    
    return true;
  } catch (err) {
    log('Stats échouées', false);
    console.error(err.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
async function testBlacklist() {
  section('9. BLACKLIST');
  
  try {
    const r = await api().get('/api/blacklist', { params: { limit: 10 } });
    log(`Blacklist: ${r.data.data.length} numéros`);
    if (r.data.data.length > 0) {
      log(`  1er: ${r.data.data[0].phone_number}`);
    }
    return true;
  } catch (err) {
    log('Blacklist échouée', false);
    console.error(err.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
async function testWebhooks() {
  section('10. WEBHOOKS');
  
  try {
    const r = await api().get('/api/webhooks');
    log(`Webhooks: ${r.data.length} token(s)`);
    if (r.data.length > 0) {
      const w = r.data[0];
      log(`  1er: ${w.name} - ${w.token.substring(0, 8)}...`);
      log(`  Actif: ${w.active ? 'Oui' : 'Non'}`);
    }
    return true;
  } catch (err) {
    log('Webhooks échoués', false);
    console.error(err.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
async function testActiveCalls() {
  section('11. ACTIVE CALLS');
  
  try {
    const r = await api().get('/api/calls/active');
    log(`Appels en cours: ${r.data.count}`);
    if (r.data.calls && r.data.calls.length > 0) {
      r.data.calls.forEach(c => {
        log(`  ${c.callerIdNum} → ${c.exten} (${c.uniqueId.substring(0, 12)}...)`);
      });
    }
    return true;
  } catch (err) {
    log('Active calls échoué', false);
    console.error(err.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
async function testWSClients() {
  section('12. WEBSOCKET CLIENTS');
  
  try {
    const r = await api().get('/api/ws/clients');
    log(`Clients WS: ${r.data.count}`);
    log(`Subscriptions: ${JSON.stringify(r.data.subscriptions)}`);
    return true;
  } catch (err) {
    log('WS Clients échoué', false);
    console.error(err.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
async function testLogs() {
  section('13. LOGS (last 10)');
  
  try {
    const r = await api().get('/api/logs', { params: { limit: 10 } });
    log(`Logs récupérés: ${r.data.length}`);
    r.data.slice(-5).forEach(l => {
      console.log(`  [${l.ts.split('T')[1].split('.')[0]}] ${l.level}: ${l.msg}`);
    });
    return true;
  } catch (err) {
    log('Logs échoués', false);
    console.error(err.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
async function testMissedCalls() {
  section('14. MISSED CALLS');
  
  try {
    const r = await api().get('/api/calls/missed', { params: { limit: 5 } });
    log(`Appels manqués: ${r.data.data.length}`);
    if (r.data.data.length > 0) {
      const c = r.data.data[0];
      log(`  1er: ${c.caller_id_num} à ${new Date(c.started_at).toLocaleString()}`);
    }
    return true;
  } catch (err) {
    log('Missed calls échoué', false);
    console.error(err.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
async function testAgentsStatus() {
  section('15. AGENTS STATUS');
  
  try {
    const r = await api().get('/api/agents/status');
    log(`Agents: ${r.data.data.length}`);
    if (r.data.data.length > 0) {
      r.data.data.slice(0, 5).forEach(a => {
        log(`  ${a.exten}: ${a.status}`);
      });
    }
    return true;
  } catch (err) {
    log('Agents status échoué', false);
    console.error(err.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
async function testRecordings() {
  section('16. RECORDINGS');
  
  try {
    const r = await api().get('/api/recordings');
    log(`Enregistrements: ${r.data.data.length}`);
    if (r.data.data.length > 0) {
      const rec = r.data.data[0];
      log(`  1er: ${rec.callerIdNum} - ${rec.duration || '?'}s`);
      log(`  URL: ${rec.recordingUrl ? 'Disponible' : 'N/A'}`);
    }
    return true;
  } catch (err) {
    log('Recordings échoué', false);
    console.error(err.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
async function testLogout() {
  section('17. LOGOUT');
  
  try {
    await api().post('/api/auth/logout');
    log('Logout: OK');
    sessionToken = null;
    return true;
  } catch (err) {
    log('Logout échoué', false);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
async function runAllTests() {
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║  UCM ↔ Odoo Middleware - Test Suite Complète             ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log(`\nBase URL: ${BASE_URL}`);
  console.log(`Date: ${new Date().toLocaleString('fr-FR')}`);
  
  const results = [];
  
  // Tests publics
  results.push(await testHealth());
  
  // Tests authentifiés
  const loggedIn = await testLogin();
  if (loggedIn) {
    results.push(await testAuthMe());
    results.push(await testStatus());
    results.push(await testConfig());
    results.push(await testOdooSearch());
    results.push(await testCallHistory());
    results.push(await testStats());
    results.push(await testBlacklist());
    results.push(await testWebhooks());
    results.push(await testActiveCalls());
    results.push(await testWSClients());
    results.push(await testLogs());
    results.push(await testMissedCalls());
    results.push(await testAgentsStatus());
    results.push(await testRecordings());
    results.push(await testLogout());
  }
  
  // Résumé
  section('RÉSUMÉ');
  const passed = results.filter(r => r).length;
  const total = results.length;
  const percent = Math.round((passed / total) * 100);
  
  console.log(`\n  Tests réussis: ${passed}/${total} (${percent}%)`);
  
  if (percent === 100) {
    console.log('\n  🎉 Tous les tests sont au vert!');
  } else if (percent >= 80) {
    console.log('\n  ✅ La majorité des tests passent');
  } else {
    console.log('\n  ⚠️  Plusieurs tests ont échoué');
  }
  
  console.log('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
runAllTests().catch(err => {
  console.error('\n❌ Erreur fatale:', err.message);
  process.exit(1);
});
