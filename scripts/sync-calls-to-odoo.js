#!/usr/bin/env node
'use strict';

/**
 * Script de synchronisation des appels vers Odoo
 * 
 * Usage:
 *   node scripts/sync-calls-to-odoo.js              # Depuis hier 00:00
 *   node scripts/sync-calls-to-odoo.js --days 7     # Depuis 7 jours
 *   node scripts/sync-calls-to-odoo.js --start 2026-03-25  # Depuis une date
 *   node scripts/sync-calls-to-odoo.js --all        # Tous les appels en base
 */

const path = require('path');
process.chdir(path.join(__dirname, '..'));

const CallHistory = require('../src/infrastructure/database/CallHistory');
const OdooClient = require('../src/infrastructure/odoo/OdooClient');

// Parse arguments
const args = process.argv.slice(2);
const daysArg = args.indexOf('--days');
const startArg = args.indexOf('--start');
const allArg = args.includes('--all');

let startDate = null;
let days = 1;

if (allArg) {
  startDate = null; // Tous les appels
} else if (startArg > -1 && args[startArg + 1]) {
  startDate = args[startArg + 1] + ' 00:00:00';
} else if (daysArg > -1 && args[daysArg + 1]) {
  days = parseInt(args[daysArg + 1], 10);
  const d = new Date();
  d.setDate(d.getDate() - days);
  startDate = d.toISOString().split('T')[0] + ' 00:00:00';
} else {
  // Par défaut: depuis hier 00:00
  const d = new Date();
  d.setDate(d.getDate() - 1);
  startDate = d.toISOString().split('T')[0] + ' 00:00:00';
}

(async () => {
  console.log('═══════════════════════════════════════════');
  console.log(' Synchronisation des appels vers Odoo');
  console.log('═══════════════════════════════════════════\n');
  
  const callHistory = new CallHistory();
  await callHistory.init();
  
  const odoo = new OdooClient();
  await odoo.authenticate();
  
  console.log('Période:', startDate || 'Tous les appels');
  console.log('Connexion Odoo: OK ✓\n');
  
  // Récupérer les appels
  const calls = await callHistory.getCalls({
    startDate: startDate,
    limit: 1000
  });
  
  console.log('Appels trouvés:', calls.length);
  
  // Filtrer les appels avec contact
  const callsWithContact = calls.filter(c => c.contact_id && c.odoo_partner_id);
  console.log('Appels avec contact:', callsWithContact.length);
  
  // Déjà loggés (on vérifie dans Odoo si l'appel existe déjà)
  // Pour simplifier, on loggue tout avec une note "Importé rétroactivement"
  
  // Logger dans Odoo
  let logged = 0;
  let errors = 0;
  const skippedNoContact = calls.length - callsWithContact.length;
  
  console.log('\nSynchronisation en cours...\n');
  
  for (const call of callsWithContact) {
    try {
      const callStatus = call.status === 'hangup' || call.status === 'answered' ? 'answered' : 'missed';
      
      await odoo.logCallActivity(call.odoo_partner_id, {
        direction: call.direction || 'inbound',
        status: callStatus,
        duration: call.duration || 0,
        callerIdNum: call.caller_id_num,
        exten: call.exten || call.agent_exten || '—',
        timestamp: call.started_at,
        retroImport: true, // Marqueur pour note spéciale
      });
      
      logged++;
      const icon = callStatus === 'answered' ? '✅' : '❌';
      console.log(`  ${icon} ${call.caller_id_num} → ${call.contact_name || 'Inconnu'} (${callStatus}, ${call.duration || 0}s)`);
    } catch (err) {
      errors++;
      console.log(`  ❌ Erreur: ${call.caller_id_num} → ${err.message}`);
    }
  }
  
  console.log('\n═══════════════════════════════════════════');
  console.log(' Résumé');
  console.log('═══════════════════════════════════════════');
  console.log('Appels trouvés:', calls.length);
  console.log('Avec contact:', callsWithContact.length);
  console.log('Loggés avec succès:', logged, '✓');
  console.log('Erreurs:', errors, errors > 0 ? '⚠️' : '');
  console.log('Sans contact (ignorés):', skippedNoContact);
  console.log('═══════════════════════════════════════════\n');
  
  process.exit(errors > 0 ? 1 : 0);
})();
