'use strict';

const config = require('../src/config');
const logger = require('../src/logger');
const OdooClient = require('../src/infrastructure/odoo/OdooClient');
const db = require('../src/infrastructure/database/Database');

async function refreshAvatars() {
  logger.info('RefreshAvatars: démarrage');
  
  await db.connect();
  const odoo = new OdooClient();
  
  // Get all unique contacts that have contact_id but no avatar
  const contacts = await db.all(`
    SELECT DISTINCT contact_id, contact_name 
    FROM calls 
    WHERE contact_id IS NOT NULL 
      AND (contact_avatar IS NULL OR contact_avatar = '')
  `);
  
  logger.info(`RefreshAvatars: ${contacts.length} contacts à mettre à jour`);
  
  let updated = 0;
  let errors = 0;
  
  for (const contact of contacts) {
    try {
      // Get full contact data from Odoo including image
      const partnerData = await odoo.getPartner(contact.contact_id);
      
      if (partnerData && partnerData.image_128) {
        const avatar = `data:image/png;base64,${partnerData.image_128}`;
        await db.run(`
          UPDATE calls 
          SET contact_avatar = ?
          WHERE contact_id = ?
        `, [avatar, contact.contact_id]);
        logger.info(`RefreshAvatars: avatar mis à jour pour ${contact.contact_name}`);
        updated++;
      } else {
        logger.debug(`RefreshAvatars: pas d'avatar pour ${contact.contact_name}`);
      }
    } catch (err) {
      logger.error(`RefreshAvatars: erreur pour ${contact.contact_name}`, { error: err.message });
      errors++;
    }
  }
  
  logger.info(`RefreshAvatars: terminé - ${updated} mis à jour, ${errors} erreurs`);
  process.exit(0);
}

refreshAvatars().catch(err => {
  logger.error('RefreshAvatars: erreur fatale', { error: err.message });
  process.exit(1);
});
