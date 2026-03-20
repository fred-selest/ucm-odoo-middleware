'use strict';

const { Router } = require('express');
const config = require('../../config');
const logger = require('../../logger');

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
      const { startTime, endTime, limit = 100 } = req.query;
      
      const recordings = await ucmHttpClient.listRecordings(startTime, endTime);
      
      // Limiter le nombre de résultats
      const limited = recordings.slice(0, parseInt(limit));
      
      // Enrichir avec les données d'appels si disponibles
      const enriched = await Promise.all(
        limited.map(async (rec) => {
          const call = await callHistory?.getCallByUniqueId(rec.unique_id);
          return {
            ...rec,
            contact_name: call?.contact_name,
            caller_id: call?.caller_id_num,
            duration: call?.duration || rec.duration,
          };
        })
      );
      
      res.json(enriched);
    } catch (err) {
      logger.error('API recordings: erreur', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/recordings/:id - Détails d'un enregistrement
   */
  router.get('/:id', async (req, res) => {
    try {
      const recording = await ucmHttpClient.getRecording(req.params.id);
      res.json(recording);
    } catch (err) {
      logger.error('API recording detail: erreur', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * DELETE /api/recordings/:id - Supprimer un enregistrement
   */
  router.delete('/:id', async (req, res) => {
    try {
      await ucmHttpClient.deleteRecording(req.params.id);
      res.json({ success: true });
    } catch (err) {
      logger.error('API delete recording: erreur', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/recordings/sync - Synchroniser les enregistrements
   */
  router.post('/sync', async (req, res) => {
    try {
      const { startTime, endTime } = req.body;
      
      const recordings = await ucmHttpClient.listRecordings(startTime, endTime);
      
      let updated = 0;
      for (const rec of recordings) {
        if (rec.unique_id) {
          await callHistory?.saveCallRecording(
            rec.unique_id,
            rec.recording_url,
            rec.duration
          );
          updated++;
        }
      }
      
      logger.info('API: synchronisation enregistrements', { count: updated });
      res.json({ success: true, updated });
    } catch (err) {
      logger.error('API sync recordings: erreur', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = createRecordingsRouter;
