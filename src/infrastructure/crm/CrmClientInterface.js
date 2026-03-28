'use strict';

/**
 * Interface abstraite CRM — contrat que tous les adaptateurs doivent respecter.
 *
 * Les adaptateurs disponibles :
 *   - OdooAdapter  (src/infrastructure/crm/adapters/OdooAdapter.js)
 *   - DolibarrAdapter (src/infrastructure/crm/adapters/DolibarrAdapter.js)
 *
 * Sélection via CRM_TYPE (env) : 'odoo' | 'dolibarr'
 *
 * Tous les adaptateurs retournent des objets normalisés selon les types ci-dessous.
 *
 * ─── Contact normalisé ──────────────────────────────────────────────────────
 * {
 *   id:        number          — identifiant CRM
 *   name:      string          — nom complet (prenom + nom pour Dolibarr)
 *   phone:     string|null     — téléphone principal
 *   email:     string|null     — email
 *   company:   string|null     — nom société liée
 *   companyId: number|null     — id société liée
 *   isCompany: boolean         — true si c'est une entreprise
 *   function:  string|null     — poste / fonction
 *   street:    string|null     — adresse
 *   zip:       string|null     — code postal
 *   city:      string|null     — ville
 *   country:   string|null     — pays
 *   website:   string|null     — site web
 *   comment:   string|null     — notes
 *   crmUrl:    string          — lien direct vers la fiche dans le CRM
 *   avatar:    string|null     — URL ou base64 de la photo
 * }
 *
 * ─── CallActivityData ────────────────────────────────────────────────────────
 * {
 *   direction:    'inbound'|'outbound'
 *   status:       'answered'|'missed'|'hangup'
 *   duration:     number  (secondes)
 *   callerIdNum:  string|null
 *   exten:        string|null
 *   timestamp:    string|null  (ISO 8601)
 * }
 */
class CrmClientInterface {

  // ── Authentification ───────────────────────────────────────────────────────

  /**
   * Authentifie le client auprès du CRM.
   * @returns {Promise<any>} uid / userId selon le CRM
   */
  async authenticate() {
    throw new Error(`${this.crmType}: authenticate() non implémenté`);
  }

  /**
   * Garantit l'authentification (s'authentifie si ce n'est pas encore fait).
   * @returns {Promise<any>}
   */
  async ensureAuthenticated() {
    throw new Error(`${this.crmType}: ensureAuthenticated() non implémenté`);
  }

  /**
   * Retourne true si le client est actuellement authentifié.
   * @returns {boolean}
   */
  isAuthenticated() {
    throw new Error(`${this.crmType}: isAuthenticated() non implémenté`);
  }

  // ── Recherche de contacts ──────────────────────────────────────────────────

  /**
   * Recherche un contact par numéro de téléphone (avec cache).
   * @param   {string} phone
   * @returns {Promise<object|null>} Contact normalisé ou null
   */
  async findContactByPhone(phone) {
    throw new Error(`${this.crmType}: findContactByPhone() non implémenté`);
  }

  /**
   * Recherche des contacts par nom ou société (recherche textuelle).
   * @param   {string} query
   * @param   {number} [limit=20]
   * @returns {Promise<object[]>} Tableau de contacts normalisés
   */
  async searchContacts(query, limit = 20) {
    throw new Error(`${this.crmType}: searchContacts() non implémenté`);
  }

  /**
   * Récupère un contact par son ID CRM.
   * @param   {number} id
   * @returns {Promise<object|null>} Contact normalisé ou null
   */
  async getContactById(id) {
    throw new Error(`${this.crmType}: getContactById() non implémenté`);
  }

  /**
   * Récupère la fiche complète d'un contact (tous les champs).
   * @param   {number} id
   * @returns {Promise<object|null>} Contact complet normalisé ou null
   */
  async getContactFull(id) {
    throw new Error(`${this.crmType}: getContactFull() non implémenté`);
  }

  // ── CRUD Contacts ──────────────────────────────────────────────────────────

  /**
   * Crée un contact dans le CRM.
   * @param   {object} data  { name, phone?, email?, isCompany?, companyId?, street?, city?, function?, comment? }
   * @returns {Promise<object>} Contact créé (normalisé)
   */
  async createContact(data) {
    throw new Error(`${this.crmType}: createContact() non implémenté`);
  }

  /**
   * Met à jour un contact existant.
   * @param   {number} id
   * @param   {object} data  Champs à mettre à jour
   * @returns {Promise<object>} Contact mis à jour (normalisé complet)
   */
  async updateContact(id, data) {
    throw new Error(`${this.crmType}: updateContact() non implémenté`);
  }

  // ── Activités / Journal CRM ────────────────────────────────────────────────

  /**
   * Enregistre un appel dans le journal du contact CRM.
   * @param   {number} contactId
   * @param   {object} callData  { direction, status, duration, callerIdNum, exten, timestamp }
   * @returns {Promise<void>}
   */
  async logCallActivity(contactId, callData) {
    throw new Error(`${this.crmType}: logCallActivity() non implémenté`);
  }

  /**
   * Récupère les messages/activités du contact depuis le CRM.
   * @param   {number} contactId
   * @param   {number} [limit=15]
   * @returns {Promise<object[]>}
   */
  async getContactMessages(contactId, limit = 15) {
    throw new Error(`${this.crmType}: getContactMessages() non implémenté`);
  }

  /**
   * Ajoute une note manuelle au contact dans le CRM.
   * @param   {number} contactId
   * @param   {string} note
   * @returns {Promise<void>}
   */
  async addContactNote(contactId, note) {
    throw new Error(`${this.crmType}: addContactNote() non implémenté`);
  }

  // ── Cache ──────────────────────────────────────────────────────────────────

  /**
   * Invalide le cache (tout le cache si phone non fourni, sinon juste cette entrée).
   * @param {string} [phone]
   */
  invalidateCache(phone) { /* optionnel, override dans les sous-classes */ }

  /** @returns {number} Nombre d'entrées en cache */
  get cacheSize() { return 0; }

  // ── Meta ───────────────────────────────────────────────────────────────────

  /**
   * Nom du CRM ('odoo' | 'dolibarr').
   * @returns {string}
   */
  get crmType() {
    throw new Error('crmType getter non implémenté');
  }

  /**
   * Construit l'URL directe vers la fiche contact dans l'interface du CRM.
   * @param   {number} contactId
   * @param   {boolean} [isCompany=false]
   * @returns {string}
   */
  getCrmUrl(contactId, isCompany = false) {
    return '#';
  }

  /**
   * Récupère tous les contacts avec au moins un numéro de téléphone.
   * Utilisé pour l'annuaire UCM (Remote Phonebook).
   * @param   {number} [limit=2000]
   * @returns {Promise<Array>}
   */
  async getAllContactsWithPhone(limit = 2000) {
    return [];
  }
}

module.exports = CrmClientInterface;
