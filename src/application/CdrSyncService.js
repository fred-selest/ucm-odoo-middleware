'use strict';

const config = require('../config');
const logger = require('../logger');
const {
  UCM_SUB_CDR_KEYS,
  CDR_SYNC_INITIAL_DELAY_MS,
  MAX_CALLS_TO_RESOLVE,
} = require('../config/constants');

/**
 * Aplatit les CDR imbriqués UCM en un tableau de sous-CDR exploitables.
 * Choisit le meilleur sub_cdr (ANSWERED le plus long) et y propage le recordfiles si absent.
 * @param {Array<object>} records - Tableau des CDR UCM avec sub_cdr imbriqués
 * @returns {Array<object>} Tableau des CDR aplatis
 */
function flattenCdrRecords(records) {
  const flat = [];
  for (const cdr of records) {
    const subs = UCM_SUB_CDR_KEYS.map(k => cdr[k]).filter(Boolean);
    const answered = subs.filter(s => s.disposition === 'ANSWERED');
    const best = answered.sort((a, b) => (b.billsec || 0) - (a.billsec || 0))[0]
      || subs[0] || cdr.main_cdr;
    if (!best?.uniqueid) continue;
    if (!best.recordfiles?.replace(/@$/g, '').trim()) {
      const withRec = subs.find(s => s.recordfiles?.replace(/@$/g, '').trim());
      if (withRec) best.recordfiles = withRec.recordfiles;
    }
    flat.push(best);
  }
  return flat;
}

/**
 * Service de synchronisation automatique CDR.
 * Tourne toutes les X minutes et :
 * 1. Récupère les CDR depuis le UCM
 * 2. Les insère en base (avec recording_url)
 * 3. Résout les contacts inconnus
 * 4. Lance la transcription Whisper (si activée)
 */
class CdrSyncService {
  /**
   * @param {{ ucmHttpClient: object, callHistory: object, crmClient: object, wsServer: object, whisperService: object }} deps - Dépendances du service
   */
  constructor({ ucmHttpClient, callHistory, crmClient, wsServer, whisperService }) {
    this._ucm = ucmHttpClient;
    this._callHistory = callHistory;
    this._crm = crmClient;
    this._ws = wsServer;
    this._whisper = whisperService;
    this._interval = null;
    this._running = false;
  }

  start() {
    const ms = config.cdrSync.intervalMs;
    logger.info('CDR auto-sync: démarré', { intervalMs: ms });
    // Premier sync 30s après le démarrage
    setTimeout(() => this._runSync().catch(() => {}), CDR_SYNC_INITIAL_DELAY_MS);
    this._interval = setInterval(() => this._runSync().catch(() => {}), ms);
  }

  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
      logger.info('CDR auto-sync: arrêté');
    }
  }

  async syncNow({ startTime, endTime } = {}) {
    return await this._runSync(startTime, endTime);
  }

  async resolveContacts() {
    return await this._resolveUnknownCalls();
  }

  async _runSync(startTime, endTime) {
    if (this._running) {
      logger.debug('CDR sync: déjà en cours, skip');
      return { skipped: true };
    }
    this._running = true;

    try {
      const now = new Date();
      const pad = n => String(n).padStart(2, '0');
      const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const st = startTime || `${today} 00:00:00`;
      const et = endTime || `${today} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

      // 1. Récupérer et aplatir les CDR
      const { records, total } = await this._ucm.fetchCdr(st, et);
      const flatRecords = flattenCdrRecords(records);

      // 2. Insérer en base
      let inserted = 0;
      let recordingsUpdated = 0;
      for (const cdr of flatRecords) {
        const ok = await this._callHistory.createCallFromCdr(cdr);
        if (ok) inserted++;

        // Mettre à jour recording_url si CDR existant
        const rawFiles = (cdr.recordfiles || '').replace(/@$/g, '').trim();
        if (rawFiles && !ok && cdr.uniqueid) {
          const filename = rawFiles.includes('/') ? rawFiles.split('/').pop() : rawFiles;
          const recordingUrl = `/api/recordings/download/${encodeURIComponent(filename)}`;
          await this._callHistory.updateCallRecordingUrl(cdr.uniqueid, recordingUrl);
          recordingsUpdated++;
        }
      }

      // 3. Résoudre les contacts inconnus
      const resolveResult = await this._resolveUnknownCalls();

      // 4. Transcription Whisper (en arrière-plan, non bloquant)
      let transcribed = 0;
      if (this._whisper?.isEnabled) {
        try {
          transcribed = await this._whisper.processNewRecordings();
        } catch (err) {
          logger.warn('CDR sync: erreur transcription (non bloquante)', { error: err.message });
        }
      }

      const result = {
        fetched: records.length,
        flattened: flatRecords.length,
        inserted,
        recordingsUpdated,
        ...resolveResult,
        transcribed,
        startTime: st,
        endTime: et,
      };

      if (inserted > 0 || resolveResult.resolved > 0) {
        logger.info('CDR sync: terminée', result);
      }

      return result;
    } catch (err) {
      logger.error('CDR sync: erreur', { error: err.message });
      throw err;
    } finally {
      this._running = false;
    }
  }

  async _resolveUnknownCalls() {
    const rows = await this._callHistory.getUnresolvedPhones(MAX_CALLS_TO_RESOLVE);
    if (rows.length === 0) return { checked: 0, resolved: 0 };

    let resolved = 0;
    for (const row of rows) {
      try {
        const contact = await this._crm.findContactByPhone(row.caller_id_num);
        if (contact && contact.name && !contact.name.startsWith('Inconnu ')) {
          const count = await this._callHistory.resolveCallsByPhone(row.caller_id_num, contact);
          if (count > 0) {
            resolved += count;
            logger.info('Appels résolus', { phone: row.caller_id_num, name: contact.name, count });
          }
        }
      } catch (err) {
        logger.warn('Résolution appel: erreur', { phone: row.caller_id_num, error: err.message });
      }
    }

    if (resolved > 0 && this._ws) {
      this._ws.broadcast({ type: 'calls_updated', resolved });
    }

    return { checked: rows.length, resolved };
  }
}

module.exports = CdrSyncService;
