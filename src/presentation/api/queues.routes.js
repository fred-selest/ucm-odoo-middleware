'use strict';

const { Router } = require('express');
const config = require('../../config');
const logger = require('../../logger');

/**
 * Routes API pour les files d'attente
 */
function createQueuesRouter({ ucmHttpClient, callHistory, wsServer }) {
  const router = Router();

  /**
   * GET /api/queues - Liste des files d'attente
   */
  router.get('/', async (req, res) => {
    try {
      const queues = await ucmHttpClient.listQueues();
      
      // Enrichir avec les statistiques
      const enriched = await Promise.all(
        queues.map(async (queue) => {
          try {
            const stats = await ucmHttpClient.getQueueStats(queue.queue_id);
            const agents = await ucmHttpClient.getQueueAgents(queue.queue_id);
            const calls = await ucmHttpClient.getQueueCalls(queue.queue_id);
            
            return {
              ...queue,
              ...stats,
              agent_count: agents.length,
              waiting_calls: calls.length,
              agents,
            };
          } catch (err) {
            logger.warn('Queue stats error', { queue: queue.queue_id, error: err.message });
            return queue;
          }
        })
      );
      
      res.json(enriched);
    } catch (err) {
      logger.error('API queues: erreur', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/queues/:id - Détails d'une file
   */
  router.get('/:id', async (req, res) => {
    try {
      const queueId = req.params.id;
      
      const [stats, agents, calls] = await Promise.all([
        ucmHttpClient.getQueueStats(queueId),
        ucmHttpClient.getQueueAgents(queueId),
        ucmHttpClient.getQueueCalls(queueId),
      ]);
      
      res.json({
        queue_id: queueId,
        ...stats,
        agents,
        calls,
      });
    } catch (err) {
      logger.error('API queue detail: erreur', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/queues/:id/agents - Ajouter un agent
   */
  router.post('/:id/agents', async (req, res) => {
    try {
      const { extension } = req.body;
      const queueId = req.params.id;
      
      if (!extension) {
        return res.status(400).json({ error: 'Extension requise' });
      }
      
      await ucmHttpClient.addQueueAgent(queueId, extension);
      
      logger.info('API: agent ajouté à la file', { queue: queueId, extension });
      res.json({ success: true });
    } catch (err) {
      logger.error('API add agent: erreur', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * DELETE /api/queues/:id/agents/:extension - Retirer un agent
   */
  router.delete('/:id/agents/:extension', async (req, res) => {
    try {
      const { id: queueId, extension } = req.params;
      
      await ucmHttpClient.removeQueueAgent(queueId, extension);
      
      logger.info('API: agent retiré de la file', { queue: queueId, extension });
      res.json({ success: true });
    } catch (err) {
      logger.error('API remove agent: erreur', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/queues/:id/agents/:extension/pause - Mettre en pause un agent
   */
  router.post('/:id/agents/:extension/pause', async (req, res) => {
    try {
      const { id: queueId, extension } = req.params;
      const { pause = true } = req.body;
      
      await ucmHttpClient.pauseQueueAgent(queueId, extension, pause);
      
      logger.info('API: agent pause', { queue: queueId, extension, pause });
      res.json({ success: true });
    } catch (err) {
      logger.error('API pause agent: erreur', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/queues/stats - Statistiques globales des files
   */
  router.get('/stats/summary', async (req, res) => {
    try {
      const queues = await ucmHttpClient.listQueues();
      
      const summary = {
        total_queues: queues.length,
        total_waiting: 0,
        total_agents: 0,
        total_calls_today: 0,
        avg_wait_time: 0,
      };
      
      let totalWaitTime = 0;
      let count = 0;
      
      for (const queue of queues) {
        try {
          const stats = await ucmHttpClient.getQueueStats(queue.queue_id);
          const agents = await ucmHttpClient.getQueueAgents(queue.queue_id);
          const calls = await ucmHttpClient.getQueueCalls(queue.queue_id);
          
          summary.total_waiting += calls.length || 0;
          summary.total_agents += agents.length || 0;
          summary.total_calls_today += stats.total_calls_today || 0;
          
          if (stats.avg_wait_time) {
            totalWaitTime += stats.avg_wait_time;
            count++;
          }
        } catch (err) {
          logger.warn('Queue stats error', { queue: queue.queue_id });
        }
      }
      
      summary.avg_wait_time = count > 0 ? Math.round(totalWaitTime / count) : 0;
      
      res.json(summary);
    } catch (err) {
      logger.error('API queues summary: erreur', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = createQueuesRouter;
