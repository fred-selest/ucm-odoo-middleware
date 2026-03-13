'use strict';

const config = require('../src/config');
const logger = require('../src/logger');
const OdooClient = require('../src/infrastructure/odoo/OdooClient');
const db = require('../src/infrastructure/database/Database');

async function refreshContacts() {
  logger.info('RefreshContacts: démarrage');
  
  await db.connect();
  const odoo = new OdooClient();
  
  // Get calls without contact info
  const calls = await db.all(`
    SELECT id, unique_id, caller_id_num, direction 
    FROM calls 
    WHERE contact_name IS NULL 
      AND (caller_id_num LIKE '+%' OR caller_id_num LIKE '0%')
      AND length(caller_id_num) >= 10
    ORDER BY started_at DESC
    LIMIT 50
  `);
  
  logger.info(`RefreshContacts: ${calls.length} appels à traiter`);
  
  let updated = 0;
  let notFound = 0;
  let errors = 0;
  
  for (const call of calls) {
    try {
      const contact = await odoo.findContactByPhone(call.caller_id_num);
      
      if (contact) {
        await db.run(`
          UPDATE calls 
          SET contact_id = ?, contact_name = ?, contact_phone = ?, 
              contact_email = ?, contact_odoo_url = ?, odoo_partner_id = ?, contact_avatar = ?
          WHERE unique_id = ?
        `, [
          contact.id,
          contact.name,
          contact.phone,
          contact.email,
          contact.odooUrl,
          contact.partnerId,
          contact.avatar,
          call.unique_id
        ]);
        logger.info(`RefreshContacts: appel ${call.id} mis à jour avec ${contact.name}`);
        updated++;
      } else {
        logger.debug(`RefreshContacts: contact non trouvé pour ${call.caller_id_num}`);
        notFound++;
      }
    } catch (err) {
      logger.error(`RefreshContacts: erreur pour ${call.caller_id_num}`, { error: err.message });
      errors++;
    }
  }
  
  logger.info(`RefreshContacts: terminé - ${updated} mis à jour, ${notFound} non trouvés, ${errors} erreurs`);
  process.exit(0);
}

refreshContacts().catch(err => {
  logger.error('RefreshContacts: erreur fatale', { error: err.message });
  process.exit(1);
});
