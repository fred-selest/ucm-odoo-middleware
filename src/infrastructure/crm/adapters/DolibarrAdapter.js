'use strict';

const axios            = require('axios');
const CrmClientInterface = require('../CrmClientInterface');
const config           = require('../../../config');
const logger           = require('../../../logger');

/**
 * Adaptateur CRM pour Dolibarr (REST API v1).
 *
 * URL de base    : {DOLIBARR_URL}/api/index.php
 * Auth           : header DOLAPIKEY: {apiKey}
 * Multi-entité   : header DOLAPIENTITY: {entityId}  (si nécessaire)
 *
 * ─── Endpoints utilisés ────────────────────────────────────────────────────
 *
 *  Contacts (llx_socpeople)
 *    GET  /contacts                         — liste (sqlfilters, limit, page)
 *    GET  /contacts/{id}                    — détail
 *    POST /contacts                         — création
 *    PUT  /contacts/{id}                    — mise à jour
 *
 *  Entreprises (llx_societe)
 *    GET  /thirdparties                     — liste (sqlfilters, limit, page)
 *    GET  /thirdparties/{id}               — détail
 *
 *  Activités (llx_actioncomm)
 *    GET  /agendaevents                     — liste (fk_contact, type, limit)
 *    POST /agendaevents                     — création
 *
 *  Health check
 *    GET  /status                           — vérification API key
 *
 * ─── Champs contact Dolibarr → format normalisé ─────────────────────────────
 *   lastname + firstname → name
 *   phone_pro            → phone
 *   phone_mobile         → (inclus dans phone si phone_pro vide)
 *   poste                → function
 *   socid                → companyId
 *   note_public          → comment
 *   town                 → city
 *   contact/card.php?id= → crmUrl
 */
class DolibarrAdapter extends CrmClientInterface {

  constructor() {
    super();
    this._authenticated = false;
    this._cache         = new Map();   // phone → { contact, expiresAt }
    this._axios         = null;
    this._initAxios();
  }

  // ── Initialisation ─────────────────────────────────────────────────────────

  _initAxios() {
    const cfg = config.dolibarr;
    const headers = {
      'Content-Type': 'application/json',
      'Accept':       'application/json',
      'DOLAPIKEY':    cfg.apiKey || '',
    };
    if (cfg.entityId) headers['DOLAPIENTITY'] = String(cfg.entityId);

    this._axios = axios.create({
      baseURL: `${cfg.url.replace(/\/$/, '')}/api/index.php`,
      timeout: cfg.timeout || 8000,
      headers,
    });

    // Réinit si config change dynamiquement (ex: après /api/config/dolibarr)
    if (config.dolibarr.url !== this._lastUrl || config.dolibarr.apiKey !== this._lastKey) {
      this._lastUrl = config.dolibarr.url;
      this._lastKey = config.dolibarr.apiKey;
    }
  }

  // ── Meta ───────────────────────────────────────────────────────────────────

  get crmType() { return 'dolibarr'; }

  getCrmUrl(contactId, isCompany = false) {
    const base = config.dolibarr.url.replace(/\/$/, '');
    if (isCompany) return `${base}/societe/card.php?socid=${contactId}`;
    return `${base}/contact/card.php?id=${contactId}`;
  }

  // ── Authentification ───────────────────────────────────────────────────────

  /**
   * Vérifie la validité de la clé API via GET /status.
   * Dolibarr n'a pas de session — l'API key est stateless.
   */
  async authenticate() {
    this._initAxios(); // Re-sync si config changée
    try {
      const r = await this._axios.get('/status');
      if (r.data && (r.data.success || r.data.version)) {
        this._authenticated = true;
        logger.info('Dolibarr: API key validée', { version: r.data.version || '?' });
        return true;
      }
      throw new Error('Réponse inattendue de /status');
    } catch (err) {
      this._authenticated = false;
      const status = err.response?.status;
      if (status === 401 || status === 403) {
        throw new Error('Dolibarr: API key invalide ou accès refusé');
      }
      throw new Error(`Dolibarr: échec authenticate() — ${err.message}`);
    }
  }

  async ensureAuthenticated() {
    if (!this._authenticated) await this.authenticate();
    return true;
  }

  isAuthenticated() { return this._authenticated; }

  // ── Requête interne ────────────────────────────────────────────────────────

  async _req(method, path, params = {}, data = null) {
    await this.ensureAuthenticated();
    try {
      const opts = { params };
      if (data !== null) opts.data = data;
      const r = await this._axios.request({ method, url: path, ...opts });
      return r.data;
    } catch (err) {
      const status  = err.response?.status;
      const message = err.response?.data?.error?.message || err.response?.data?.message || err.message;
      if (status === 401 || status === 403) {
        this._authenticated = false;
        throw new Error(`Dolibarr: accès refusé sur ${path} — ${message}`);
      }
      if (status === 404) return null;
      throw new Error(`Dolibarr: ${method.toUpperCase()} ${path} → ${status || 'ERR'} — ${message}`);
    }
  }

  // ── Normalisation ──────────────────────────────────────────────────────────

  /**
   * Normalise un objet contact Dolibarr (llx_socpeople) en format unifié.
   * @param {object} c   Objet brut renvoyé par l'API
   * @param {object} [thirdparty]  Entreprise liée (optionnel, pour compléter le nom société)
   */
  _normalizeContact(c, thirdparty = null) {
    const firstname = (c.firstname || '').trim();
    const lastname  = (c.lastname  || c.name || '').trim();
    const name      = [firstname, lastname].filter(Boolean).join(' ') || `Contact #${c.id}`;
    const phone     = c.phone_pro || c.phone_mobile || c.phone_perso || null;
    const company   = thirdparty?.name || (c.socid ? `Société #${c.socid}` : null);
    return {
      id:        parseInt(c.id, 10),
      name,
      phone,
      email:     c.email     || null,
      company,
      companyId: c.socid     ? parseInt(c.socid, 10) : null,
      isCompany: false,
      function:  c.poste     || null,
      street:    c.address   || null,
      zip:       c.zip       || null,
      city:      c.town      || null,
      country:   c.country   || c.country_code || null,
      website:   null,
      comment:   c.note_public || c.note_private || null,
      crmUrl:    this.getCrmUrl(c.id, false),
      avatar:    c.photo     ? this._buildPhotoUrl(c.photo, false, c.id) : null,
    };
  }

  /**
   * Normalise un objet thirdparty Dolibarr (llx_societe) en format unifié.
   */
  _normalizeThirdparty(t) {
    return {
      id:        parseInt(t.id, 10),
      name:      t.name || `Société #${t.id}`,
      phone:     t.phone || null,
      email:     t.email || null,
      company:   null,
      companyId: null,
      isCompany: true,
      function:  null,
      street:    t.address || null,
      zip:       t.zip     || null,
      city:      t.town    || null,
      country:   t.country || t.country_code || null,
      website:   t.url     || null,
      comment:   t.note_public || t.note_private || null,
      crmUrl:    this.getCrmUrl(t.id, true),
      avatar:    t.logo ? this._buildPhotoUrl(t.logo, true, t.id) : null,
    };
  }

  /**
   * Construit l'URL d'une photo/logo Dolibarr.
   * Les photos sont accessibles via l'URL Dolibarr directe.
   */
  _buildPhotoUrl(photo, isCompany, id) {
    if (!photo) return null;
    // Si déjà une URL complète
    if (photo.startsWith('http')) return photo;
    // Sinon construire depuis le module
    const base = config.dolibarr.url.replace(/\/$/, '');
    if (isCompany) return `${base}/viewimage.php?modulepart=societe&file=${id}/logos/${photo}`;
    return `${base}/viewimage.php?modulepart=contact&file=${id}/photos/${photo}`;
  }

  // ── Normalisation téléphone ────────────────────────────────────────────────

  /**
   * Normalise un numéro de téléphone (France) : supprime espaces, tirets, points.
   * Convertit +33XXXXXXXXX → 0XXXXXXXXX
   */
  _normalizePhone(phone) {
    if (!phone) return '';
    let p = phone.replace(/[\s\.\-\(\)\/]/g, '');
    if (p.startsWith('+33')) p = '0' + p.slice(3);
    if (p.startsWith('0033')) p = '0' + p.slice(4);
    return p;
  }

  /**
   * Génère les variantes de recherche pour un numéro (4 premiers chiffres suffisent
   * pour LIKE en Dolibarr car on cherche en %…%).
   */
  _phoneVariants(phone) {
    const norm = this._normalizePhone(phone);
    const intl  = norm.startsWith('0') ? '+33' + norm.slice(1) : null;
    const intl2 = norm.startsWith('0') ? '0033' + norm.slice(1) : null;
    return [norm, intl, intl2].filter(Boolean);
  }

  // ── Cache téléphone ────────────────────────────────────────────────────────

  _cacheGet(phone) {
    const key  = this._normalizePhone(phone);
    const item = this._cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) { this._cache.delete(key); return null; }
    return item.contact;
  }

  _cacheSet(phone, contact) {
    const key = this._normalizePhone(phone);
    const ttl = (config.dolibarr?.cacheContactTtl ?? 300) * 1000;
    this._cache.set(key, { contact, expiresAt: Date.now() + ttl });
  }

  invalidateCache(phone) {
    if (phone) {
      this._cache.delete(this._normalizePhone(phone));
    } else {
      this._cache.clear();
    }
  }

  get cacheSize() { return this._cache.size; }

  // ── findContactByPhone ─────────────────────────────────────────────────────

  /**
   * Recherche un contact par téléphone.
   * Ordre : cache → contacts (phone_pro/mobile/perso) → thirdparties (phone).
   */
  async findContactByPhone(phone) {
    if (!phone) return null;

    // 1. Cache
    const cached = this._cacheGet(phone);
    if (cached) return cached;

    const norm     = this._normalizePhone(phone);
    const variants = this._phoneVariants(phone);

    // 2. Chercher dans les contacts (socpeople) sur les 3 champs téléphone
    //    Dolibarr sqlfilters : ((t.phone:like:'%NORM%') OR (t.phone_mobile:like:'%NORM%') OR (t.phone_perso:like:'%NORM%'))
    try {
      for (const variant of variants) {
        const filter = `((t.phone:like:'%${variant}%') OR (t.phone_mobile:like:'%${variant}%') OR (t.phone_perso:like:'%${variant}%'))`;
        const results = await this._req('GET', '/contacts', {
          sqlfilters: filter,
          limit:      5,
          sortfield:  't.rowid',
          sortorder:  'DESC',
        });

        if (Array.isArray(results) && results.length > 0) {
          const raw = results[0];
          // Récupérer l'entreprise liée si dispo
          let thirdparty = null;
          if (raw.socid) {
            try { thirdparty = await this._req('GET', `/thirdparties/${raw.socid}`); } catch { /* ignore */ }
          }
          const contact = this._normalizeContact(raw, thirdparty);
          this._cacheSet(phone, contact);
          return contact;
        }
      }
    } catch (err) {
      logger.error('Dolibarr: findContactByPhone (contacts) échoué', { phone, error: err.message });
    }

    // 3. Chercher dans les thirdparties
    try {
      for (const variant of variants) {
        const filter = `(t.phone:like:'%${variant}%')`;
        const results = await this._req('GET', '/thirdparties', {
          sqlfilters: filter,
          limit:      5,
          sortfield:  't.rowid',
          sortorder:  'DESC',
        });
        if (Array.isArray(results) && results.length > 0) {
          const contact = this._normalizeThirdparty(results[0]);
          this._cacheSet(phone, contact);
          return contact;
        }
      }
    } catch (err) {
      logger.error('Dolibarr: findContactByPhone (thirdparties) échoué', { phone, error: err.message });
    }

    return null;
  }

  // ── searchContacts ─────────────────────────────────────────────────────────

  /**
   * Recherche par nom dans contacts + thirdparties.
   */
  async searchContacts(query, limit = 20) {
    if (!query || query.length < 2) return [];
    const results = [];
    const seen    = new Set();

    try {
      // Chercher dans contacts (lastname ou firstname)
      const contactFilter = `((t.lastname:like:'%${query}%') OR (t.firstname:like:'%${query}%'))`;
      const contacts = await this._req('GET', '/contacts', {
        sqlfilters: contactFilter,
        limit,
        sortfield:  't.lastname',
        sortorder:  'ASC',
      });
      if (Array.isArray(contacts)) {
        for (const c of contacts) {
          const key = `c${c.id}`;
          if (!seen.has(key)) {
            seen.add(key);
            results.push(this._normalizeContact(c));
          }
        }
      }
    } catch (err) {
      logger.error('Dolibarr: searchContacts (contacts) échoué', { query, error: err.message });
    }

    try {
      // Chercher dans thirdparties (nom)
      const tpFilter = `(t.nom:like:'%${query}%')`;
      const tps = await this._req('GET', '/thirdparties', {
        sqlfilters: tpFilter,
        limit,
        sortfield:  't.nom',
        sortorder:  'ASC',
      });
      if (Array.isArray(tps)) {
        for (const t of tps) {
          const key = `tp${t.id}`;
          if (!seen.has(key)) {
            seen.add(key);
            results.push(this._normalizeThirdparty(t));
          }
        }
      }
    } catch (err) {
      logger.error('Dolibarr: searchContacts (thirdparties) échoué', { query, error: err.message });
    }

    return results.slice(0, limit);
  }

  // ── getContactById / getContactFull ────────────────────────────────────────

  async getContactById(id) {
    const raw = await this._req('GET', `/contacts/${id}`);
    if (!raw) return null;
    let thirdparty = null;
    if (raw.socid) {
      try { thirdparty = await this._req('GET', `/thirdparties/${raw.socid}`); } catch { /* ignore */ }
    }
    return this._normalizeContact(raw, thirdparty);
  }

  /**
   * Retourne la fiche complète (tous les champs).
   * Pour les thirdparties, ajoute id négatif convention (optionnel).
   */
  async getContactFull(id) {
    // Essayer contact d'abord, puis thirdparty si id préfixé 'tp'
    const raw = await this._req('GET', `/contacts/${id}`);
    if (raw) {
      let thirdparty = null;
      if (raw.socid) {
        try { thirdparty = await this._req('GET', `/thirdparties/${raw.socid}`); } catch { /* ignore */ }
      }
      const c = this._normalizeContact(raw, thirdparty);
      // Enrichir avec les champs étendus
      c.zip     = raw.zip     || null;
      c.country = raw.country || raw.country_code || null;
      c.website = thirdparty?.url || null;
      c.comment = raw.note_public || raw.note_private || null;
      if (thirdparty) {
        c.company   = thirdparty.name;
        c.companyId = parseInt(thirdparty.id, 10);
      }
      return c;
    }
    return null;
  }

  // ── createContact ──────────────────────────────────────────────────────────

  /**
   * Crée un contact Dolibarr depuis les données normalisées.
   * Découpe name en firstname / lastname (dernier mot = lastname).
   */
  async createContact(data) {
    const parts    = (data.name || '').trim().split(/\s+/);
    const lastname = parts.pop() || data.name || 'Inconnu';
    const firstname = parts.join(' ');

    const payload = {
      lastname,
      firstname,
      phone_pro:   data.phone   || '',
      email:       data.email   || '',
      poste:       data.function || '',
      address:     data.street  || '',
      zip:         data.zip     || '',
      town:        data.city    || '',
      note_public: data.comment || '',
      statut:      1,   // actif
    };
    if (data.companyId) payload.socid = data.companyId;

    const created = await this._req('POST', '/contacts', {}, payload);
    if (!created || !created.id) throw new Error('Dolibarr: création contact échouée — réponse invalide');

    this.invalidateCache(data.phone);
    return this.getContactFull(created.id);
  }

  // ── updateContact ──────────────────────────────────────────────────────────

  async updateContact(id, data) {
    const payload = {};
    if (data.phone)     payload.phone_pro  = data.phone;
    if (data.email)     payload.email      = data.email;
    if (data.function)  payload.poste      = data.function;
    if (data.street)    payload.address    = data.street;
    if (data.zip)       payload.zip        = data.zip;
    if (data.city)      payload.town       = data.city;
    if (data.comment)   payload.note_public = data.comment;
    if (data.companyId) payload.socid      = data.companyId;
    if (data.name) {
      const parts    = data.name.trim().split(/\s+/);
      payload.lastname  = parts.pop();
      payload.firstname = parts.join(' ');
    }

    await this._req('PUT', `/contacts/${id}`, {}, payload);
    this.invalidateCache(data.phone);
    return this.getContactFull(id);
  }

  // ── enrichFromSirene ───────────────────────────────────────────────────────

  /**
   * Enrichit un contact Dolibarr avec les données SIRENE INSEE.
   * Mappe : adresse, SIRET → idprof2, SIREN → idprof1, TVA.
   */
  async enrichFromSirene(contactId, sireneData) {
    const payload = {};

    if (sireneData.siren) payload.idprof1 = sireneData.siren;  // SIREN
    if (sireneData.siret) payload.idprof2 = sireneData.siret;  // SIRET

    if (sireneData.siren) {
      const siren = parseInt(sireneData.siren, 10);
      const clef = (12 + 3 * (siren % 97)) % 97;
      payload.tva_intra = `FR${String(clef).padStart(2, '0')}${sireneData.siren}`;
    }

    const addr = sireneData.adresse || {};
    const rue = [addr.numero, addr.type, addr.voie].filter(Boolean).join(' ');
    if (rue) payload.address = rue;
    if (addr.codePostal) payload.zip = addr.codePostal;
    if (addr.commune) payload.town = addr.commune;
    payload.country_id = 1; // France dans Dolibarr

    if (sireneData.denomination) {
      const parts = sireneData.denomination.trim().split(/\s+/);
      payload.lastname = parts.pop();
      payload.firstname = parts.join(' ');
    }

    if (Object.keys(payload).length === 0) return null;

    // Personne physique (EI, auto-entrepreneur) si catégorie juridique 1000–1999
    const catJur = parseInt(sireneData.categorieJuridique || '0', 10);
    payload.nature = (catJur === 0 || catJur >= 2000) ? 'c' : 'p'; // c=company, p=person

    await this._req('PUT', `/contacts/${contactId}`, {}, payload);
    this.invalidateCache(null);
    return this.getContactFull(contactId);
  }

  // ── logCallActivity ────────────────────────────────────────────────────────

  /**
   * Enregistre un appel téléphonique dans le journal Dolibarr (agendaevents).
   *
   * type_code : AC_TEL (appel téléphonique)
   * Endpoint  : POST /api/index.php/agendaevents
   *
   * Champs requis : userownerid + type_code
   */
  async logCallActivity(contactId, callData) {
    const {
      direction   = 'inbound',
      status      = 'hangup',
      duration    = 0,
      callerIdNum = '',
      exten       = '',
      timestamp   = new Date().toISOString(),
    } = callData;

    const dirLabel  = direction === 'outbound' ? 'Sortant' : 'Entrant';
    const statLabel = { answered: 'Décroché', missed: 'Manqué', hangup: 'Raccroché' }[status] || status;
    const durStr    = duration > 0
      ? (duration >= 60 ? `${Math.floor(duration / 60)}min ${duration % 60}s` : `${duration}s`)
      : 'N/A';

    const startTs = Math.floor(new Date(timestamp).getTime() / 1000);
    const endTs   = startTs + duration;

    const label = `📞 Appel ${dirLabel} — ${statLabel} (${callerIdNum || '?'} → poste ${exten || '?'})`;
    const note  = [
      `Direction : ${dirLabel}`,
      `Statut    : ${statLabel}`,
      `De        : ${callerIdNum || '—'}`,
      `Poste     : ${exten || '—'}`,
      `Durée     : ${durStr}`,
      `Date      : ${new Date(timestamp).toLocaleString('fr-FR')}`,
      'Source    : UCM-Middleware',
    ].join('\n');

    const payload = {
      type_code:    'AC_TEL',
      label,
      datep:        startTs,
      datep2:       endTs,
      fulldayevent: 0,
      percentage:   100,
      fk_contact:   contactId,
      note,
      userownerid:  config.dolibarr?.userId || 1,
      userassigned: [{ id: config.dolibarr?.userId || 1 }],
    };

    try {
      await this._req('POST', '/agendaevents', {}, payload);
      logger.info('Dolibarr: activité appel enregistrée', { contactId, status, duration });
    } catch (err) {
      logger.error('Dolibarr: logCallActivity échoué', { contactId, error: err.message });
    }
  }

  // ── getContactMessages ─────────────────────────────────────────────────────

  /**
   * Récupère les activités téléphoniques liées au contact (AC_TEL) depuis
   * Dolibarr, triées par date décroissante.
   */
  async getContactMessages(contactId, limit = 15) {
    try {
      const events = await this._req('GET', '/agendaevents', {
        sortfield:   't.datep',
        sortorder:   'DESC',
        limit,
        // Filtrer par contact et type AC_TEL
        sqlfilters:  `(t.fk_contact:=:${contactId})`,
      });
      if (!Array.isArray(events)) return [];
      return events.map(e => ({
        id:          e.id,
        body:        e.note || e.label || '',
        date:        e.datep ? new Date(e.datep * 1000).toISOString() : null,
        author:      e.userownerid || null,
        type:        e.type_code || 'UNKNOWN',
        label:       e.label || '',
      }));
    } catch (err) {
      logger.error('Dolibarr: getContactMessages échoué', { contactId, error: err.message });
      return [];
    }
  }

  // ── addContactNote ─────────────────────────────────────────────────────────

  /**
   * Ajoute une note au contact via un événement agenda de type NOTE.
   * Dolibarr utilise AC_NOTE (note) si le module est configuré,
   * sinon on tombe sur AC_OTH (autre).
   */
  async addContactNote(contactId, note) {
    const payload = {
      type_code:    'AC_NOTE',
      label:        'Note ajoutée depuis UCM-Middleware',
      note,
      datep:        Math.floor(Date.now() / 1000),
      fulldayevent: 0,
      percentage:   100,
      fk_contact:   contactId,
      userownerid:  config.dolibarr?.userId || 1,
      userassigned: [{ id: config.dolibarr?.userId || 1 }],
    };
    try {
      await this._req('POST', '/agendaevents', {}, payload);
    } catch (err) {
      logger.error('Dolibarr: addContactNote échoué', { contactId, error: err.message });
      throw err;
    }
  }
}

module.exports = DolibarrAdapter;
