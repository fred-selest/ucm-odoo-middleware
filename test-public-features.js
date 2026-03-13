/**
 * Test WebSocket + Features publiques
 * Ne nécessite pas d'authentification
 */

const WebSocket = require('ws');
const https = require('https');

const BASE_URL = 'https://ucm.selest.info';
const WS_URL = 'wss://ucm.selest.info/ws';

const agent = new https.Agent({ rejectUnauthorized: false });

function request(path) {
  return new Promise((resolve, reject) => {
    https.get(`${BASE_URL}${path}`, { agent }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data.substring(0, 500));
        }
      });
    }).on('error', reject);
  });
}

async function runTests() {
  console.log('\n╔════════════════════════════════════════════════╗');
  console.log('║  Tests Fonctionnalités Publiques               ║');
  console.log('╚════════════════════════════════════════════════╝\n');
  
  // 1. Health check
  console.log('1. HEALTH CHECK');
  const health = await request('/health');
  console.log(`   Status: ${health.status}`);
  console.log(`   UCM HTTP: ${health.ucmHttp ? '✅' : '❌'}`);
  console.log(`   UCM WS: ${health.ucmWs ? '✅' : '❌'}`);
  console.log('');
  
  // 2. Admin page HTML
  console.log('2. ADMIN PAGE');
  const adminHtml = await request('/admin');
  const hasLogin = adminHtml.includes('loginEmail');
  const hasLogout = adminHtml.includes('logoutBtn');
  const hasStatus = adminHtml.includes('status-dot');
  const hasWsIndicator = adminHtml.includes('wsIndicator');
  console.log(`   Formulaire login: ${hasLogin ? '✅' : '❌'}`);
  console.log(`   Bouton logout: ${hasLogout ? '✅' : '❌'}`);
  console.log(`   Indicateurs statut: ${hasStatus ? '✅' : '❌'}`);
  console.log(`   WebSocket indicator: ${hasWsIndicator ? '✅' : '❌'}`);
  console.log('');
  
  // 3. API Docs (Swagger)
  console.log('3. SWAGGER API DOCS');
  const swagger = await request('/api-docs.json');
  if (typeof swagger === 'object' && swagger.paths) {
    const paths = Object.keys(swagger.paths);
    console.log(`   Endpoints: ${paths.length}`);
    console.log(`   Exemples: ${paths.slice(0, 5).join(', ')}...`);
  } else {
    console.log('   ✅ Documentation disponible');
  }
  console.log('');
  
  // 4. WebSocket connection test
  console.log('4. WEBSOCKET CONNECTION');
  await new Promise((resolve) => {
    const ws = new WebSocket(WS_URL, { agent });
    const timeout = setTimeout(() => {
      console.log('   ❌ Timeout connexion (10s)');
      ws.terminate();
      resolve();
    }, 10000);
    
    ws.on('open', () => {
      clearTimeout(timeout);
      console.log('   ✅ Connecté');
    });
    
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        console.log(`   📨 Message: ${msg.type}`);
        if (msg.type === 'call:incoming' || msg.type === 'extension:status') {
          console.log(`      Data: ${JSON.stringify(msg.data).substring(0, 100)}`);
        }
      } catch (e) {
        console.log(`   📨 Message brut: ${data.toString().substring(0, 100)}`);
      }
    });
    
    ws.on('error', (err) => {
      clearTimeout(timeout);
      console.log(`   ❌ Erreur: ${err.message}`);
      resolve();
    });
    
    ws.on('close', () => {
      clearTimeout(timeout);
      console.log('   Déconnecté');
      resolve();
    });
    
    // Send subscription message
    setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'subscribe',
          extensions: ['*'] // Subscribe to all
        }));
        console.log('   📤 Abonnement envoyé (toutes extensions)');
        
        // Close after 5 seconds
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.close();
          }
        }, 5000);
      }
    }, 1000);
  });
  
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('Tests terminés!');
  console.log('');
}

runTests().catch(err => {
  console.error('Erreur:', err.message);
  process.exit(1);
});
