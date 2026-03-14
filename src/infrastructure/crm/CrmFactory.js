'use strict';

const config = require('../../config');
const logger = require('../../logger');

/**
 * Factory CRM — crée l'adaptateur selon config.crm.type.
 *
 * Types supportés :
 *   'odoo'      → OdooAdapter  (XML-RPC, défaut)
 *   'dolibarr'  → DolibarrAdapter (REST)
 *
 * Utilisation dans src/index.js :
 *   const CrmFactory = require('./infrastructure/crm/CrmFactory');
 *   const crmClient  = CrmFactory.create();
 *
 * Variable d'environnement : CRM_TYPE=odoo|dolibarr
 */
class CrmFactory {
  /**
   * Crée et retourne l'adaptateur CRM configuré.
   * @returns {import('./CrmClientInterface')}
   */
  static create() {
    const type = (config.crm?.type || 'odoo').toLowerCase();

    switch (type) {
      case 'dolibarr': {
        const DolibarrAdapter = require('./adapters/DolibarrAdapter');
        logger.info('CRM: adaptateur Dolibarr chargé', {
          url: config.dolibarr?.url || '(non configuré)',
        });
        return new DolibarrAdapter();
      }

      case 'odoo':
      default: {
        const OdooAdapter = require('./adapters/OdooAdapter');
        logger.info('CRM: adaptateur Odoo chargé', {
          url:      config.odoo?.url || '(non configuré)',
          database: config.odoo?.db  || '(non configuré)',
        });
        return new OdooAdapter();
      }
    }
  }

  /**
   * Retourne le type CRM actuel.
   * @returns {string}
   */
  static currentType() {
    return (config.crm?.type || 'odoo').toLowerCase();
  }
}

module.exports = CrmFactory;
