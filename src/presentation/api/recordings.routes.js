'use strict';

const { Router } = require('express');
const config = require('../../config');
const logger = require('../../logger');

/**
 * Aplatit les CDR imbriqués UCM et propage les recordfiles.
 */
function _flattenCdrRecords(records) {
  const flat = [];
  for (const cdr of records) {
    const subs = ['sub_cdr_1', 'sub_cdr_2', 'sub_cdr_3', 'sub_cdr_4']
      .map(k => cdr[k]).filter(Boolean);
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
 * Routes API pour les enregistrements d'appels
 */
function createRecordingsRouter({ ucmHttpClient, callHistory }) {
  const router = Router();

  /**
   * GET /api/recordings - Liste des enregistrements
   * Query params: startTime, endTime, limit
   */
  router.get('/', async (req, res) => {
    try {
      // Récupérer les appels avec des enregistrements depuis la base de données
      const { startTime, endTime, limit = 100 } = req.query;
      
      let query = 'SELECT * FROM calls WHERE recording_url IS NOT NULL';
      const params = [];
      
      if (startTime) {
        query += ' AND started_at >= ?';
        params.push(startTime);
      }
      if (endTime) {
        query += ' AND started_at <= ?';
        params.push(endTime);
      }
      
      query += ' ORDER BY started_at DESC LIMIT ?';
      params.push(parseInt(limit));
      
      const recordings = await callHistory?.all(query, params) || [];

      res.json({ ok: true, data: recordings });
    } catch (err) {
      logger.error('API recordings: erreur', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/recordings/download/:filename - Télécharger un enregistrement
   */
  router.get('/download/:filename', async (req, res) => {
    try {
      const filename = decodeURIComponent(req.params.filename);
      logger.info('Téléchargement enregistrement', { filename });
      
      const wavBuffer = await ucmHttpClient.downloadRecording(filename);
      
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      res.send(wavBuffer);
    } catch (err) {
      logger.error('API download recording: erreur', { error: err.message, filename: req.params.filename });
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/recordings/sync - Synchroniser les enregistrements depuis les CDR
   */
  router.post('/sync', async (req, res) => {
    try {
      const { startTime, endTime } = req.body;
      
      // Récupérer les CDR depuis l'UCM
      const cdrResult = await ucmHttpClient.fetchCdr(startTime, endTime);
      const recordings = [];

      // Aplatir les CDR imbriqués (main_cdr, sub_cdr_1, sub_cdr_2...)
      const flatRecords = _flattenCdrRecords(cdrResult.records);

      // Mettre à jour les enregistrements dans la base
      for (const cdr of flatRecords) {
        const rawFiles = (cdr.recordfiles || '').replace(/@$/g, '').trim();
        if (!rawFiles) continue;
        const filename = rawFiles.includes('/') ? rawFiles.split('/').pop() : rawFiles;
        const recordingUrl = `/api/recordings/download/${encodeURIComponent(filename)}`;

        const created = await callHistory?.createCallFromCdr(cdr);
        if (!created && cdr.uniqueid) {
          await callHistory?.updateCallRecordingUrl(cdr.uniqueid, recordingUrl);
        }
        recordings.push({ unique_id: cdr.uniqueid, recordfiles: rawFiles, recording_url: recordingUrl });
      }
      
      logger.info('API: synchronisation enregistrements', { count: recordings.length });
      res.json({ success: true, updated: recordings.length, recordings });
    } catch (err) {
      logger.error('API sync recordings: erreur', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = createRecordingsRouter;
