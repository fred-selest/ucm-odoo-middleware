'use strict';

const axios = require('axios');
const https = require('https');
const crypto = require('crypto');
const config = require('../../config');
const logger = require('../../logger');

/**
 * Client HTTP pour l'API Grandstream UCM6300
 * Authentification challenge/response avec cookie de session
 * @class UcmHttpClient
 */
class UcmHttpClient {
  constructor() {
    this._baseUrl = '';
    this._cookie = null;
    this._cookieExpiry = null;
    this._authenticated = false;
    this._axiosInstance = null;
    this._reconnectAttempts = 0;
    this._maxReconnectAttempts = 5;
    this._authPromise = null;  // verrou anti-concurrence

    this._setupAxios();
  }

  /**
   * Configure l'instance Axios avec les paramètres TLS
   * @private
   */
  _setupAxios() {
    const tlsOptions = {
      rejectUnauthorized: false,
    };

    if (config.ucm.tls.caCert) {
      tlsOptions.ca = config.ucm.tls.caCert;
    }

    const agent = new https.Agent({
      ...tlsOptions,
      keepAlive: true,
      maxSockets: 50,
    });

    this._axiosInstance = axios.create({
      httpsAgent: agent,
      timeout: config.ucm.timeout || 8000,
      validateStatus: () => true,
      headers: {
        'Content-Type': 'application/json',
        'Connection': 'close',
      },
    });
  }

  /**
   * Initialise la connexion à l'UCM
   * @returns {Promise<boolean>}
   */
  async connect() {
    const { host, webPort, username, password } = config.ucm;
    
    // Construire l'URL de base
    this._baseUrl = `https://${host}:${webPort}/api`;
    
    logger.info('UCM HTTP: connexion en cours', { 
      host, 
      port: webPort,
      username 
    });

    // Verrou : une seule auth à la fois
    if (this._authPromise) return this._authPromise;
    this._authPromise = this._authenticate(username, password)
      .then(() => { this._authPromise = null; return true; })
      .catch(err => { this._authPromise = null; logger.error('UCM HTTP: échec authentification', { error: err.message }); throw err; });
    return this._authPromise;
  }

  /**
   * Authentification challenge/response
   * 1. Demande un challenge
   * 2. Calcule MD5(challenge + password)
   * 3. Envoie le token pour obtenir le cookie
   * @param {string} username
   * @param {string} password
   * @returns {Promise<string>} cookie
   * @private
   */
  async _authenticate(username, password) {
    try {
      // Étape 1: Obtenir le challenge
      const challenge = await this._getChallenge(username);
      logger.debug('UCM HTTP: challenge reçu');

      // Étape 2: Calculer le token MD5
      const token = this._computeToken(challenge, password);
      logger.debug('UCM HTTP: token généré');

      // Étape 3: Login avec le token
      const cookie = await this._login(username, token);
      
      this._cookie = cookie;
      this._cookieExpiry = Date.now() + (10 * 60 * 1000); // 10 minutes
      this._authenticated = true;
      this._reconnectAttempts = 0;

      logger.info('UCM HTTP: authentifié avec succès');
      return cookie;

    } catch (err) {
      this._authenticated = false;
      this._cookie = null;
      throw err;
    }
  }

  /**
   * Demande un challenge à l'UCM
   * @param {string} username
   * @returns {Promise<string>}
   * @private
   */
  async _getChallenge(username) {
    const payload = {
      request: {
        action: 'challenge',
        user: username,
        version: '1.0'
      }
    };

    const response = await this._axiosInstance.post(this._baseUrl, payload);
    
    if (response.status !== 200 || response.data.status !== 0) {
      throw new Error(`Challenge failed: ${response.data.status || response.status}`);
    }

    return response.data.response.challenge;
  }

  /**
   * Calcule le token MD5(challenge + password)
   * @param {string} challenge
   * @param {string} password
   * @returns {string}
   * @private
   */
  _computeToken(challenge, password) {
    return crypto
      .createHash('md5')
      .update(challenge + password)
      .digest('hex');
  }

  /**
   * Envoie le login avec le token pour obtenir le cookie
   * @param {string} username
   * @param {string} token
   * @returns {Promise<string>}
   * @private
   */
  async _login(username, token) {
    const payload = {
      request: {
        action: 'login',
        user: username,
        token: token,
      }
    };

    const response = await this._axiosInstance.post(this._baseUrl, payload);

    if (response.status !== 200 || response.data.status !== 0) {
      const errorCode = response.data?.status || response.status;
      const remainNum = response.data?.response?.remain_num;
      const remainTime = response.data?.response?.remain_time;
      
      let errorMsg = `Login failed: ${errorCode}`;
      if (remainNum !== undefined) {
        errorMsg += ` - Tentatives restantes: ${remainNum}`;
      }
      if (remainTime !== undefined) {
        errorMsg += ` - Délai: ${remainTime}s`;
      }
      
      throw new Error(errorMsg);
    }

    return response.data.response.cookie;
  }

  /**
   * Vérifie si le cookie est encore valide
   * @returns {boolean}
   */
  isAuthenticated() {
    if (!this._authenticated || !this._cookie) {
      return false;
    }
    
    // Refresh 1 minute avant expiration
    return Date.now() < (this._cookieExpiry - 60000);
  }

  /**
   * Exécute une requête API avec re-authentification automatique
   * @param {string} action
   * @param {object} params
   * @returns {Promise<any>}
   */
  async request(action, params = {}) {
    // Vérifier/rafraîchir l'authentification
    if (!this.isAuthenticated()) {
      logger.info('UCM HTTP: session expirée, re-authentification...');
      await this.connect();
    }

    const payload = {
      request: {
        action,
        cookie: this._cookie,
        ...params
      }
    };

    try {
      const response = await this._axiosInstance.post(this._baseUrl, payload);
      
      if (response.data.status === -6) {
        // Cookie invalide, re-authentifier
        logger.warn('UCM HTTP: cookie invalide, re-authentification');
        await this.connect();
        payload.request.cookie = this._cookie;
        return await this._axiosInstance.post(this._baseUrl, payload);
      }

      if (response.data.status !== 0) {
        throw new Error(`API Error ${response.data.status}: ${this._getErrorMessage(response.data.status)}`);
      }

      return response.data.response;

    } catch (err) {
      logger.error('UCM HTTP: erreur requête', { action, error: err.message });
      throw err;
    }
  }

  /**
   * Traduit les codes d'erreur UCM
   * @param {number} code
   * @returns {string}
   * @private
   */
  _getErrorMessage(code) {
    const errors = {
      '-0': 'Succès',
      '-1': 'Paramètres invalides',
      '-5': 'Authentification requise',
      '-6': 'Erreur cookie',
      '-7': 'Connexion fermée',
      '-8': 'Timeout système',
      '-9': 'Erreur système',
      '-15': 'Valeur invalide',
      '-16': 'Élément inexistant',
      '-37': 'Compte/mot de passe incorrect',
      '-45': 'Trop de requêtes, réessayez dans 15s',
      '-47': 'Permission refusée',
      '-68': 'Restriction de connexion',
      '-70': 'Connexion interdite',
    };
    return errors[String(code)] || 'Erreur inconnue';
  }

  /**
   * Récupère le statut système
   * @returns {Promise<object>}
   */
  async getSystemStatus() {
    return await this.request('getSystemStatus');
  }

  /**
   * Récupère la liste des extensions
   * @returns {Promise<Array>}
   */
  async listExtensions() {
    const result = await this.request('listAccount', {
      options: 'extension,fullname,status,addr',
      sord: 'asc',
      sidx: 'extension'
    });
    return result.account || [];
  }

  /**
   * Récupère toutes les pages d'une action retournant des canaux
   * @param {string} action
   * @returns {Promise<Array>}
   * @private
   */
  async _fetchAllChannelPages(action) {
    const first = await this.request(action);
    const channels = [...(first.channel || [])];
    const totalPages = first.total_page || 1;
    for (let page = 2; page <= totalPages; page++) {
      const result = await this.request(action, { page });
      channels.push(...(result.channel || []));
    }
    return channels;
  }

  /**
   * Récupère les appels en cours (bridged) — toutes pages
   * @returns {Promise<Array>}
   */
  async listBridgedChannels() {
    return this._fetchAllChannelPages('listBridgedChannels');
  }

  /**
   * Récupère les appels en sonnerie (unbridged) — toutes pages
   * @returns {Promise<Array>}
   */
  async listUnBridgedChannels() {
    return this._fetchAllChannelPages('listUnBridgedChannels');
  }

  /**
   * Raccroche un appel
   * @param {string} channel
   * @returns {Promise<boolean>}
   */
  async hangup(channel) {
    await this.request('Hangup', { channel });
    return true;
  }

  /**
   * Appelle une extension interne
   * @param {string} caller - Extension qui appelle
   * @param {string} callee - Extension appelée
   * @returns {Promise<boolean>}
   */
  async dialExtension(caller, callee) {
    await this.request('dialExtension', { caller, callee });
    return true;
  }

  /**
   * Appelle un numéro externe
   * @param {string} caller - Extension qui appelle
   * @param {string} outbound - Numéro à appeler
   * @returns {Promise<boolean>}
   */
  async dialOutbound(caller, outbound) {
    await this.request('dialOutbound', { caller, outbound });
    return true;
  }

  /**
   * Accepte un appel entrant (dans les 10s)
   * @param {string} channel
   * @returns {Promise<boolean>}
   */
  async acceptCall(channel) {
    await this.request('acceptCall', { channel });
    return true;
  }

  /**
   * Refuse un appel entrant (dans les 10s)
   * @param {string} channel
   * @returns {Promise<boolean>}
   */
  async refuseCall(channel) {
    await this.request('refuseCall', { channel });
    return true;
  }

  /**
   * Transfère un appel
   * @param {string} channel
   * @param {string} extension
   * @returns {Promise<boolean>}
   */
  async callTransfer(channel, extension) {
    await this.request('callTransfer', { channel, extension });
    return true;
  }

  /**
   * Active ou désactive le mode Ne-Pas-Déranger d'une extension
   * @param {string} extension
   * @param {boolean} enable
   * @returns {Promise<boolean>}
   */
  async doNotDisturb(extension, enable) {
    await this.request('doNotDisturb', { extension, dnd: enable ? '1' : '0' });
    return true;
  }

  /**
   * Récupère les statistiques d'une file d'attente
   * @param {string} queue
   * @param {string} startTime
   * @param {string} endTime
   * @returns {Promise<object>}
   */
  async getQueueStats(queue, startTime, endTime) {
    return await this.request('queueapi', {
      queue,
      startTime,
      endTime,
      format: 'json'
    });
  }

  /**
   * Déconnexion propre
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (this._cookie) {
      try {
        await this.request('logout', {});
      } catch (err) {
        logger.warn('UCM HTTP: erreur déconnexion', { error: err.message });
      }
    }
    this._cookie = null;
    this._authenticated = false;
    logger.info('UCM HTTP: déconnecté');
  }

  /**
   * Récupère les enregistrements CDR via l'API officielle (POST /api, action cdrapi)
   * @param {string} startTime  - 'YYYY-MM-DD HH:MM:SS'
   * @param {string} endTime    - 'YYYY-MM-DD HH:MM:SS'
   * @param {number} numRecords - Max enregistrements (max 1000, défaut 1000)
   * @param {number} offset     - Pagination
   * @returns {Promise<{records: Array, total: number}>}
   */
  async fetchCdr(startTime, endTime, numRecords = 1000) {
    const first = await this._fetchCdrPage(startTime, endTime, numRecords, 0);
    const allRecords = [...first];
    const MAX_PAGES = 50;
    let page = 1;
    while (first.length === numRecords && page < MAX_PAGES) {
      const next = await this._fetchCdrPage(startTime, endTime, numRecords, page * numRecords);
      if (!next.length) break;
      allRecords.push(...next);
      page++;
      if (next.length < numRecords) break;
    }
    if (page > 1) logger.info('UCM CDR: pagination', { pages: page, total: allRecords.length });
    return { records: allRecords, total: allRecords.length };
  }

  async _fetchCdrPage(startTime, endTime, numRecords, offset) {
    if (!this.isAuthenticated()) await this.connect();
    const params = {
      format:     'json',
      numRecords: String(numRecords),
      offset:     String(offset),
    };
    if (startTime) params.startTime = startTime;
    if (endTime)   params.endTime   = endTime;
    try {
      // cdrapi retourne {"cdr_root":[...]} sans wrapper "response" ni "status"
      const payload = { request: { action: 'cdrapi', cookie: this._cookie, ...params } };
      const resp = await this._axiosInstance.post(this._baseUrl, payload);
      const { data } = resp;
      if (data?.status !== undefined && data.status !== 0) {
        throw new Error(`CDR API error: status ${data.status}`);
      }
      return data?.cdr_root || [];
    } catch (err) {
      logger.error('UCM CDR: erreur récupération page', { error: err.message, offset });
      throw err;
    }
  }

  /**
    * Getter pour le statut d'authentification
    */
  get authenticated() {
    return this._authenticated && this._cookieExpiry > Date.now();
  }

  /**
   * Getter pour le cookie (tests uniquement)
   */
  get cookie() {
    return this._cookie;
  }

  // ── Enregistrements d'appels ────────────────────────────────────────────────

  /**
   * Récupère les noms de fichiers d'enregistrement pour un CDR donné.
   * @param {string} acctId - AcctId du CDR
   * @returns {{ recordfiles: string }}
   */
  async getRecordInfosByCall(acctId) {
    return await this.request('getRecordInfosByCall', { id: String(acctId) });
  }

  /**
   * Télécharge un fichier d'enregistrement WAV depuis le UCM.
   * recapi retourne un binaire (pas JSON), il faut une requête spéciale.
   * @param {string} filename - ex: "auto-1774356619-+33695516169-6500.wav"
   * @returns {Buffer} contenu WAV
   */
  async downloadRecording(filename) {
    // Forcer une ré-authentification fraîche pour le download
    await this.connect();

    const payload = {
      request: {
        action: 'recapi',
        cookie: this._cookie,
        filedir: 'monitor',
        filename,
      }
    };

    const response = await this._axiosInstance.post(this._baseUrl, payload, {
      responseType: 'arraybuffer',
      timeout: 30000,
    });

    const raw = Buffer.from(response.data);

    // Si le UCM retourne du JSON c'est une erreur (petit payload = probable JSON)
    if (raw.length < 500) {
      try {
        const json = JSON.parse(raw.toString('utf8'));
        if (json.status && json.status !== 0) {
          throw new Error(`UCM recapi erreur: status ${json.status}`);
        }
      } catch (e) {
        if (e.message.includes('UCM recapi')) throw e;
        // Pas du JSON, c'est un très petit WAV (improbable mais OK)
      }
    }

    return raw;
  }

  async deleteRecording(recordingId) {
    await this.request('deleteRecording', { recording_id: recordingId });
    return true;
  }

  // ── Files d'attente (Call Queues) ───────────────────────────────────────────

  async listQueues() {
    const result = await this.request('listQueues');
    return result.queue || [];
  }


  async getQueueCalls(queueId) {
    const result = await this.request('getQueueCalls', { queue_id: queueId });
    return result.calls || [];
  }

  async getQueueAgents(queueId) {
    const result = await this.request('getQueueAgents', { queue_id: queueId });
    return result.agents || [];
  }

  async addQueueAgent(queueId, extension) {
    await this.request('addQueueAgent', { queue_id: queueId, extension });
    return true;
  }

  async removeQueueAgent(queueId, extension) {
    await this.request('removeQueueAgent', { queue_id: queueId, extension });
    return true;
  }

  async pauseQueueAgent(queueId, extension, pause) {
    await this.request('pauseQueueAgent', { queue_id: queueId, extension, pause: pause ? '1' : '0' });
    return true;
  }
}

module.exports = UcmHttpClient;
