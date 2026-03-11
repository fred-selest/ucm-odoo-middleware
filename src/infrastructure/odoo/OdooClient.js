'use strict';

const axios  = require('axios');
const config = require('../../config');
const logger = require('../../logger');

/**
 * Client Odoo via XML-RPC (interface externe officielle).
 *
 * Endpoints :
 *   /xmlrpc/2/common  → authenticate(db, login, api_key, {}) → uid
 *   /xmlrpc/2/object  → execute_kw(db, uid, api_key, model, method, args, kwargs)
 *
 * Fonctionne avec les API keys Odoo 14+ et les comptes SaaS.
 */
class OdooClient {
  constructor() {
    this._uid   = null;
    this._cache = new Map();   // phone → { contact, expiresAt }
    this._axios = axios.create({
      baseURL: config.odoo.url,
      timeout: config.odoo.timeout,
      headers: { 'Content-Type': 'text/xml' },
    });
  }

  // ── Authentification ───────────────────────────────────────────────────────

  async authenticate() {
    logger.debug('Odoo: authentification XML-RPC...');
    const uid = await this._xmlRpc('/xmlrpc/2/common', 'authenticate', [
      config.odoo.db,
      config.odoo.username,
      config.odoo.apiKey,
      {},
    ]);
    if (!uid || typeof uid !== 'number') throw new Error('Odoo auth échouée — uid non retourné');
    this._uid = uid;
    logger.info('Odoo: authentifié', { uid: this._uid });
    return this._uid;
  }

  async ensureAuthenticated() {
    if (!this._uid) await this.authenticate();
    return this._uid;
  }

  // ── Recherche de contact ───────────────────────────────────────────────────

  async findContactByPhone(phone) {
    const normalized = this._normalizePhone(phone);
    const cacheKey   = normalized;

    const cached = this._cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      logger.debug('Odoo: contact en cache', { phone: normalized });
      return cached.contact;
    }

    await this.ensureAuthenticated();

    const variants = this._phoneVariants(phone);
    logger.debug('Odoo: recherche contact', { phone, variants });

    const domain = this._buildPhoneDomain(variants);

    let result;
    try {
      result = await this._callModel('res.partner', 'search_read', [domain], {
        fields: ['id', 'name', 'phone', 'email', 'parent_id', 'is_company', 'street', 'city', 'function', 'image_128'],
        limit:  1,
        order:  'is_company desc, id asc',
      });
    } catch (err) {
      if (err.message?.includes('Access Denied') || err.message?.includes('Session expired')) {
        this._uid = null;
        await this.authenticate();
        result = await this._callModel('res.partner', 'search_read', [domain], {
          fields: ['id', 'name', 'phone', 'email', 'parent_id', 'is_company', 'street', 'city', 'function', 'image_128'],
          limit:  1,
          order:  'is_company desc, id asc',
        });
      } else {
        throw err;
      }
    }

    const contact = result?.[0] ? this._formatContact(result[0]) : null;
    logger.info('Odoo: contact trouvé', { phone, contact: contact?.name || null });

    this._cache.set(cacheKey, {
      contact,
      expiresAt: Date.now() + config.odoo.cacheContactTtl * 1000,
    });

    return contact;
  }

  async searchContactsByNameOrCompany(query, limit = 20) {
    if (!query || query.trim().length < 2) {
      throw new Error('La recherche doit contenir au moins 2 caractères');
    }

    await this.ensureAuthenticated();

    const searchTerm = query.trim();
    logger.debug('Odoo: recherche par nom/société', { query: searchTerm, limit });

    // Domaine : recherche dans name OU parent_id (société)
    const domain = [
      '|',
      ['name', 'ilike', searchTerm],
      ['parent_id.name', 'ilike', searchTerm]
    ];

    let result;
    try {
      result = await this._callModel('res.partner', 'search_read', [domain], {
        fields: ['id', 'name', 'phone', 'email', 'parent_id', 'is_company', 'street', 'city', 'function', 'image_128'],
        limit: limit,
        order: 'name asc',
      });
    } catch (err) {
      if (err.message?.includes('Access Denied') || err.message?.includes('Session expired')) {
        this._uid = null;
        await this.authenticate();
        result = await this._callModel('res.partner', 'search_read', [domain], {
          fields: ['id', 'name', 'phone', 'email', 'parent_id', 'is_company', 'street', 'city', 'function', 'image_128'],
          limit: limit,
          order: 'name asc',
        });
      } else {
        throw err;
      }
    }

    const contacts = result?.map(p => this._formatContact(p)) || [];
    logger.info('Odoo: recherche par nom', { query: searchTerm, results: contacts.length });

    return contacts;
  }

  async getContactHistory(contactId, limit = 50) {
    await this.ensureAuthenticated();
    
    // Récupérer les informations complètes du contact
    const result = await this._callModel('res.partner', 'search_read', [
      [['id', '=', contactId]]
    ], {
      fields: ['id', 'name', 'phone', 'email', 'parent_id', 'is_company',
               'street', 'city', 'zip', 'country_id', 'function', 'website', 'comment'],
      limit: 1,
    });
    
    if (!result || result.length === 0) return null;
    
    return this._formatContactFull(result[0]);
  }

  async createContact(contactData) {
    await this.ensureAuthenticated();
    
    const values = {
      name: contactData.name,
      phone: contactData.phone,
      email: contactData.email,
      is_company: contactData.is_company || false,
    };
    
    if (contactData.company_id) values.parent_id = contactData.company_id;
    if (contactData.street) values.street = contactData.street;
    if (contactData.city) values.city = contactData.city;
    if (contactData.function) values.function = contactData.function;
    if (contactData.comment) values.comment = contactData.comment;
    
    const ids = await this._callModel('res.partner', 'create', [values]);
    logger.info('Odoo: contact créé', { id: ids[0], name: contactData.name });
    
    return this.getContactById(ids[0]);
  }

  async updateContact(contactId, contactData) {
    await this.ensureAuthenticated();
    
    const values = {};
    if (contactData.name !== undefined) values.name = contactData.name;
    if (contactData.phone !== undefined) values.phone = contactData.phone;
    if (contactData.email !== undefined) values.email = contactData.email;
    if (contactData.street !== undefined) values.street = contactData.street;
    if (contactData.city !== undefined) values.city = contactData.city;
    if (contactData.function !== undefined) values.function = contactData.function;
    if (contactData.comment !== undefined) values.comment = contactData.comment;
    if (contactData.company_id !== undefined) values.parent_id = contactData.company_id;
    
    await this._callModel('res.partner', 'write', [[contactId], values]);
    logger.info('Odoo: contact modifié', { id: contactId });
    
    return this.getContactById(contactId);
  }

  async getContactById(contactId) {
    await this.ensureAuthenticated();
    
    const result = await this._callModel('res.partner', 'search_read', [
      [['id', '=', contactId]]
    ], {
      fields: ['id', 'name', 'phone', 'email', 'parent_id', 'is_company',
               'street', 'city', 'function', 'image_128'],
      limit: 1,
    });
    
    if (!result || result.length === 0) return null;
    return this._formatContact(result[0]);
  }

  /**
   * Logue automatiquement un appel dans le chatter Odoo du contact
   */
  async logCallActivity(partnerId, callData) {
    await this.ensureAuthenticated();
    const { direction = 'inbound', status, duration, callerIdNum, exten, timestamp } = callData;
    const dirLabel = direction === 'outbound' ? 'sortant' : 'entrant';
    const statusLabel = { answered: 'Décroché', missed: 'Manqué', hangup: 'Raccroché' }[status] || status;
    const icon = status === 'answered' ? '📞' : '📵';
    const dt = new Date(timestamp || Date.now());
    const dateStr = dt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    let body = `<p>${icon} <strong>Appel ${dirLabel}</strong> — ${statusLabel}`;
    if (duration > 0) {
      const min = Math.floor(duration / 60), sec = duration % 60;
      body += `<br/>⏱ Durée : ${min > 0 ? min + 'min ' : ''}${sec}s`;
    }
    if (callerIdNum) body += `<br/>📱 De : ${callerIdNum}`;
    if (exten)       body += `<br/>🔢 Ext. : ${exten}`;
    body += `<br/><small style="color:#888">${dateStr}</small></p>`;
    try {
      await this._callModel('res.partner', 'message_post', [[partnerId]], {
        body,
        message_type: 'comment',
        subtype_xmlid: 'mail.mt_note',
      });
      logger.info('Odoo: appel loggé sur contact', { partnerId, status });
    } catch (err) {
      logger.warn('Odoo: échec log appel', { error: err.message, partnerId });
    }
  }

  /**
   * Récupère les messages du chatter d'un contact
   */
  async getContactMessages(partnerId, limit = 15) {
    await this.ensureAuthenticated();
    try {
      const result = await this._callModel('mail.message', 'search_read', [
        [['res_id', '=', partnerId], ['model', '=', 'res.partner'], ['message_type', 'in', ['comment', 'email']]]
      ], {
        fields: ['body', 'date', 'author_id', 'message_type'],
        limit,
        order: 'date desc',
      });
      return result || [];
    } catch (err) {
      logger.warn('Odoo: échec récupération messages', { error: err.message, partnerId });
      return [];
    }
  }

  /**
   * Ajoute une note manuelle dans le chatter d'un contact
   */
  async addContactNote(partnerId, note) {
    await this.ensureAuthenticated();
    await this._callModel('res.partner', 'message_post', [[partnerId]], {
      body: note.trim(),
      message_type: 'comment',
      subtype_xmlid: 'mail.mt_note',
    });
  }

  invalidateCache(phone = null) {
    if (phone) this._cache.delete(this._normalizePhone(phone));
    else this._cache.clear();
  }

  get cacheSize() { return this._cache.size; }

  // ── Privé ──────────────────────────────────────────────────────────────────

  async _callModel(model, method, args = [], kwargs = {}) {
    return this._xmlRpc('/xmlrpc/2/object', 'execute_kw', [
      config.odoo.db, this._uid, config.odoo.apiKey,
      model, method, args, kwargs,
    ]);
  }

  // ── XML-RPC minimal ────────────────────────────────────────────────────────

  async _xmlRpc(path, method, params) {
    const body = this._buildXml(method, params);
    let response;
    try {
      response = await this._axios.post(path, body);
    } catch (err) {
      if (err.response) throw new Error(`Odoo HTTP ${err.response.status}: ${err.response.statusText}`);
      throw err;
    }
    return this._parseXml(response.data);
  }

  _buildXml(method, params) {
    const paramsXml = params.map(p => `<param>${this._valueToXml(p)}</param>`).join('\n');
    return `<?xml version="1.0"?>\n<methodCall>\n<methodName>${method}</methodName>\n<params>\n${paramsXml}\n</params>\n</methodCall>`;
  }

  _valueToXml(val) {
    if (val === null || val === false) return '<value><boolean>0</boolean></value>';
    if (val === true)                  return '<value><boolean>1</boolean></value>';
    if (typeof val === 'number' && Number.isInteger(val)) return `<value><int>${val}</int></value>`;
    if (typeof val === 'number')       return `<value><double>${val}</double></value>`;
    if (typeof val === 'string')       return `<value><string>${this._esc(val)}</string></value>`;
    if (Array.isArray(val)) {
      const items = val.map(v => `<value>${this._innerValue(v)}</value>`).join('');
      return `<value><array><data>${items}</data></array></value>`;
    }
    if (typeof val === 'object') {
      const members = Object.entries(val).map(([k, v]) =>
        `<member><name>${this._esc(k)}</name>${this._valueToXml(v)}</member>`
      ).join('');
      return `<value><struct>${members}</struct></value>`;
    }
    return `<value><string>${this._esc(String(val))}</string></value>`;
  }

  _innerValue(val) {
    // Strip outer <value> tags if present
    const xml = this._valueToXml(val);
    return xml.replace(/^<value>/, '').replace(/<\/value>$/, '');
  }

  _esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  _parseXml(xml) {
    if (/<fault>/i.test(xml)) {
      // Extraire le message de l'erreur dans la fault
      const vs = this._extractTagged(xml, 'string');
      throw new Error(`Odoo fault: ${vs[0] || 'unknown'}`);
    }
    // Trouver le <value> dans <params><param>
    const paramStart = xml.indexOf('<param>');
    if (paramStart === -1) throw new Error('Odoo XML-RPC: réponse invalide');
    const valueStart = xml.indexOf('<value>', paramStart);
    if (valueStart === -1) throw new Error('Odoo XML-RPC: réponse invalide');
    const valueEnd = this._findClose(xml, valueStart, 'value');
    return this._parseValue(xml.slice(valueStart, valueEnd));
  }

  /**
   * Trouve la position de fin du tag fermant correspondant au tag ouvrant à `start`.
   * Retourne l'index juste après `</tag>`.
   */
  _findClose(xml, start, tag) {
    const open  = `<${tag}>`;
    const close = `</${tag}>`;
    let depth = 0;
    let pos   = start;
    while (pos < xml.length) {
      const io = xml.indexOf(open,  pos);
      const ic = xml.indexOf(close, pos);
      if (ic === -1) return xml.length;
      if (io !== -1 && io < ic) { depth++; pos = io + open.length; }
      else { depth--; if (depth === 0) return ic + close.length; pos = ic + close.length; }
    }
    return xml.length;
  }

  _parseValue(xml) {
    xml = xml.trim();
    // Retirer <value>...</value> englobant
    if (xml.startsWith('<value>') && xml.endsWith('</value>')) {
      xml = xml.slice('<value>'.length, xml.length - '</value>'.length).trim();
    }

    if (xml.startsWith('<int>'))     return parseInt(xml.slice(5, xml.indexOf('</int>')));
    if (xml.startsWith('<i4>'))      return parseInt(xml.slice(4, xml.indexOf('</i4>')));
    if (xml.startsWith('<double>'))  return parseFloat(xml.slice(8, xml.indexOf('</double>')));
    if (xml.startsWith('<boolean>')) return xml.slice(9, xml.indexOf('</boolean>')).trim() === '1';
    if (xml.startsWith('<string>'))  return this._unesc(xml.slice(8, xml.indexOf('</string>')));
    if (xml.startsWith('<nil'))      return null;

    if (xml.startsWith('<array>')) {
      const ds = xml.indexOf('<data>');
      const de = xml.lastIndexOf('</data>');
      if (ds === -1) return [];
      return this._parseArrayValues(xml.slice(ds + 6, de));
    }

    if (xml.startsWith('<struct>')) {
      return this._parseStruct(xml);
    }

    // Bare string sans balise de type
    return this._unesc(xml);
  }

  _parseArrayValues(xml) {
    const result = [];
    let pos = 0;
    while (pos < xml.length) {
      const start = xml.indexOf('<value>', pos);
      if (start === -1) break;
      const end = this._findClose(xml, start, 'value');
      result.push(this._parseValue(xml.slice(start, end)));
      pos = end;
    }
    return result;
  }

  _parseStruct(xml) {
    const obj = {};
    let pos = 0;
    while (pos < xml.length) {
      const ms = xml.indexOf('<member>', pos);
      if (ms === -1) break;
      const me = this._findClose(xml, ms, 'member');
      const member = xml.slice(ms, me);

      const ns = member.indexOf('<name>');
      const ne = member.indexOf('</name>');
      const vs = member.indexOf('<value>', ne);
      if (ns !== -1 && ne !== -1 && vs !== -1) {
        const name    = member.slice(ns + 6, ne);
        const valEnd  = this._findClose(member, vs, 'value');
        const valXml  = member.slice(vs, valEnd);
        obj[name] = this._parseValue(valXml);
      }
      pos = me;
    }
    return obj;
  }

  _extractTagged(xml, tag) {
    const results = [];
    let pos = 0;
    const open = `<${tag}>`, close = `</${tag}>`;
    while (pos < xml.length) {
      const s = xml.indexOf(open, pos);
      if (s === -1) break;
      const e = xml.indexOf(close, s);
      if (e === -1) break;
      results.push(this._unesc(xml.slice(s + open.length, e)));
      pos = e + close.length;
    }
    return results;
  }

  _unesc(s) {
    return String(s)
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"');
  }

  // ── Helpers téléphone ──────────────────────────────────────────────────────

  _buildPhoneDomain(variants) {
    if (variants.length === 0) return [['phone', '=', false]];
    const conditions = variants.map(v => ['phone', 'like', v]);
    if (conditions.length === 1) return conditions;
    const domain = [];
    for (let i = 0; i < conditions.length - 1; i++) domain.push('|');
    return [...domain, ...conditions];
  }

  _normalizePhone(phone) {
    return phone.replace(/[\s\-\.\(\)]/g, '');
  }

  _phoneVariants(phone) {
    const clean = this._normalizePhone(phone);
    const variants = new Set([clean]);

    if (/^0[1-9]\d{8}$/.test(clean)) {
      const nat = clean.slice(1); // ex: 679293871
      variants.add('+33' + nat);
      variants.add('0033' + nat);
      // Formats courants : espaces et points (local)
      variants.add(clean.replace(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/, '$1 $2 $3 $4 $5'));
      variants.add(clean.replace(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/, '$1.$2.$3.$4.$5'));
      // Format international avec espaces : +33 6 79 29 38 71
      const intl = nat.replace(/^(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/, '+33 $1 $2 $3 $4 $5');
      if (intl !== nat) variants.add(intl);
    }
    if (/^\+33\d{9}$/.test(clean)) {
      const nat = clean.slice(3); // ex: 679293871
      variants.add('0' + nat);
      variants.add('0033' + nat);
      // Format international avec espaces : +33 6 79 29 38 71
      const intlSpaced = nat.replace(/^(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/, '+33 $1 $2 $3 $4 $5');
      if (intlSpaced !== nat) variants.add(intlSpaced);
      // Format national avec espaces : 06 79 29 38 71
      const localSpaced = nat.replace(/^(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/, '0$1 $2 $3 $4 $5');
      if (localSpaced !== nat) variants.add(localSpaced);
    }
    if (/^0033\d{9}$/.test(clean)) {
      variants.add('0' + clean.slice(4));
      variants.add('+33' + clean.slice(4));
    }

    // Suffixe des 8 derniers chiffres pour matcher toute mise en forme
    const digits = clean.replace(/\D/g, '');
    if (digits.length >= 8) {
      variants.add(digits.slice(-8));
    }

    return [...variants];
  }

  _formatContact(partner) {
    const company = Array.isArray(partner.parent_id) ? partner.parent_id[1] : null;
    const name    = partner.is_company || !company
      ? partner.name
      : `${partner.name} (${company})`;
    return {
      id:        partner.id,
      name,
      phone:     partner.phone || null,
      email:     partner.email || null,
      company,
      isCompany: partner.is_company,
      function:  partner.function || null,
      street:    partner.street || null,
      city:      partner.city   || null,
      odooUrl:   `${config.odoo.url}/odoo/contacts/${partner.id}`,
      avatar:    partner.image_128 ? `data:image/png;base64,${partner.image_128}` : null,
    };
  }

  _formatContactFull(partner) {
    const company = Array.isArray(partner.parent_id) ? partner.parent_id[1] : null;
    const country = Array.isArray(partner.country_id) ? partner.country_id[1] : null;
    const name    = partner.is_company || !company
      ? partner.name
      : `${partner.name} (${company})`;
    return {
      id:        partner.id,
      name,
      phone:     partner.phone || null,
      email:     partner.email || null,
      company,
      companyId: Array.isArray(partner.parent_id) ? partner.parent_id[0] : null,
      isCompany: partner.is_company,
      function:  partner.function || null,
      street:    partner.street || null,
      city:      partner.city   || null,
      zip:       partner.zip    || null,
      country:   country        || null,
      website:   partner.website || null,
      comment:   partner.comment || null,
      odooUrl:   `${config.odoo.url}/odoo/contacts/${partner.id}`,
    };
  }
}

module.exports = OdooClient;
