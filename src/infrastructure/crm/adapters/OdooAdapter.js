'use strict';

const CrmClientInterface = require('../CrmClientInterface');
const OdooClient         = require('../../odoo/OdooClient');
const config             = require('../../../config');

/**
 * Adaptateur CRM pour Odoo (XML-RPC).
 *
 * Délègue toutes les opérations à l'OdooClient existant et normalise
 * les retours selon le format CrmClientInterface.
 */
class OdooAdapter extends CrmClientInterface {
  constructor() {
    super();
    this._client = new OdooClient();
  }

  // ── Meta ───────────────────────────────────────────────────────────────────

  get crmType() { return 'odoo'; }

  getCrmUrl(contactId, isCompany = false) {
    return `${config.odoo.url}/web#model=res.partner&id=${contactId}`;
  }

  // ── Phonebook ──────────────────────────────────────────────────────────────

  async getAllContactsWithPhone(limit = 2000) {
    return this._client.getAllContactsWithPhone(limit);
  }

  // ── Authentification ───────────────────────────────────────────────────────

  async authenticate()        { return this._client.authenticate(); }
  async ensureAuthenticated() { return this._client.ensureAuthenticated(); }
  isAuthenticated()           { return this._client.isAuthenticated(); }

  // ── Recherche ──────────────────────────────────────────────────────────────

  async findContactByPhone(phone) {
    return this._client.findContactByPhone(phone);
  }

  async searchContacts(query, limit = 20) {
    return this._client.searchContactsByNameOrCompany(query, limit);
  }

  async getContactById(id) {
    return this._client.getContactById(id);
  }

  async getContactFull(id) {
    return this._client.getContactFull(id);
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  async createContact(data) {
    return this._client.createContact(data);
  }

  async updateContact(id, data) {
    return this._client.updateContact(id, data);
  }

  async getAllContactsWithPhone(limit = 2000) {
    return this._client.getAllContactsWithPhone(limit);
  }

  async enrichFromSirene(partnerId, sireneData) {
    return this._client.enrichFromSirene(partnerId, sireneData);
  }

  // ── Activités ─────────────────────────────────────────────────────────────

  async logCallActivity(contactId, callData) {
    return this._client.logCallActivity(contactId, callData);
  }

  async getContactMessages(contactId, limit = 15) {
    return this._client.getContactMessages(contactId, limit);
  }

  async addContactNote(contactId, note) {
    return this._client.addContactNote(contactId, note);
  }

  // ── Cache ──────────────────────────────────────────────────────────────────

  invalidateCache(phone) { this._client.invalidateCache(phone); }
  get cacheSize()        { return this._client.cacheSize; }
}

module.exports = OdooAdapter;
