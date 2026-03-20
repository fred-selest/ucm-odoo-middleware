'use strict';

const logger = require('../logger');

/**
 * Service de synchronisation des contacts Odoo/UCM
 * Gère le cache et la mise à jour des contacts dans l'historique des appels
 */
class ContactSyncService {
  /**
   * @param {CrmClientInterface} crmClient
   * @param {CallHistory} callHistory
   */
  constructor(crmClient, callHistory) {
    this._crm = crmClient;
    this._callHistory = callHistory;
    
    // Cache contacts: phone → { contact, timestamp }
    this._cache = new Map();
    this._cacheTTL = 300 * 1000; // 5 minutes
  }

  /**
   * Recherche un contact par téléphone et met à jour l'historique
   * @param {string} uniqueId - ID unique de l'appel
   * @param {string} phone - Numéro de téléphone
   * @returns {Promise<object|null>}
   */
  async syncContactForCall(uniqueId, phone) {
    if (!phone || !uniqueId) {
      return null;
    }

    try {
      // Vérifier le cache
      const cached = this._getFromCache(phone);
      if (cached) {
        await this._updateCallHistory(uniqueId, cached);
        return cached;
      }

      // Recherche dans Odoo
      const contact = await this._crm.findContactByPhone(phone);
      
      if (contact) {
        this._addToCache(phone, contact);
        await this._updateCallHistory(uniqueId, contact);
        logger.info('Contact synchronisé', { uniqueId, phone, name: contact.name });
        return contact;
      }

      return null;
    } catch (err) {
      logger.error('Erreur synchro contact', { error: err.message, uniqueId, phone });
      return null;
    }
  }

  /**
   * Met à jour TOUS les appels pour un numéro de téléphone donné
   * (quand la fiche contact est modifiée dans Odoo)
   * @param {string} phone
   * @param {object} contact
   * @returns {Promise<number>} Nombre d'appels mis à jour
   */
  async updateCallsForPhone(phone, contact) {
    if (!phone) {
      return 0;
    }

    try {
      // Récupérer tous les appels pour ce numéro
      const calls = await this._callHistory.getCalls({ 
        callerIdNum: phone,
        limit: 1000 
      });

      let updated = 0;
      for (const call of calls) {
        await this._updateCallHistory(call.unique_id, contact);
        updated++;
      }

      // Mettre à jour le cache
      if (contact) {
        this._addToCache(phone, contact);
      } else {
        this._cache.delete(phone);
      }

      logger.info('Appels mis à jour pour contact', { phone, updated, contactName: contact?.name });
      return updated;
    } catch (err) {
      logger.error('Erreur mise à jour appels', { error: err.message, phone });
      return 0;
    }
  }

  /**
   * Invalide le cache pour un numéro
   * @param {string} phone
   */
  invalidateCache(phone) {
    if (phone) {
      this._cache.delete(phone);
      logger.debug('Cache invalidé', { phone });
    }
  }

  /**
   * Vider tout le cache
   */
  clearCache() {
    this._cache.clear();
    logger.info('Cache contacts vidé');
  }

  /**
   * Récupère un contact du cache
   * @private
   */
  _getFromCache(phone) {
    const entry = this._cache.get(phone);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > this._cacheTTL) {
      this._cache.delete(phone);
      return null;
    }

    return entry.contact;
  }

  /**
   * Ajoute un contact au cache
   * @private
   */
  _addToCache(phone, contact) {
    this._cache.set(phone, {
      contact,
      timestamp: Date.now()
    });
  }

  /**
   * Met à jour l'historique d'appel avec les infos contact
   * @private
   */
  async _updateCallHistory(uniqueId, contact) {
    if (!this._callHistory || !contact) {
      return;
    }

    await this._callHistory.updateCallContact(uniqueId, {
      id: contact.id,
      name: contact.name,
      phone: contact.phone,
      email: contact.email,
      odooUrl: contact.odooUrl,
      partnerId: contact.partnerId,
      avatar: contact.avatar,
      street: contact.street,
      city: contact.city,
      company: contact.company,
      zip: contact.zip,
      country: contact.country,
      website: contact.website,
      function: contact.function,
      mobile: contact.mobile,
    });
  }

  /**
   * Synchronise un contact spécifique depuis Odoo
   * @param {number} partnerId - ID du contact Odoo
   * @returns {Promise<object|null>}
   */
  async syncContactFromOdoo(partnerId) {
    try {
      const contact = await this._crm.getPartner(partnerId);
      if (contact) {
        // Mettre à jour le cache pour les numéros de téléphone
        if (contact.phone) {
          this._addToCache(contact.phone, contact);
        }
        if (contact.mobile) {
          this._addToCache(contact.mobile, contact);
        }
        
        // Mettre à jour tous les appels pour ces numéros
        if (contact.phone) {
          await this.updateCallsForPhone(contact.phone, contact);
        }
        if (contact.mobile) {
          await this.updateCallsForPhone(contact.mobile, contact);
        }
        
        logger.info('Contact synchronisé depuis Odoo', { partnerId, name: contact.name });
        return contact;
      }
      return null;
    } catch (err) {
      logger.error('Erreur synchro contact Odoo', { error: err.message, partnerId });
      return null;
    }
  }
}

module.exports = ContactSyncService;
