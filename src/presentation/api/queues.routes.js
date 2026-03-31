'use strict';

const { Router } = require('express');
const config = require('../../config');
const logger = require('../../logger');
const { errorHandler, notFoundHandler, requestLogger, requireSession } = require('./middleware');

/**
 * Routes API pour les files d'attente
 */
function createQueuesRouter({ ucmHttpClient, callHistory, wsServer }) {
  const router = Router();

  // Middleware de logging
  router.use(requestLogger);

  /**
   * GET /api/queues - Liste des files d'attente
   */
  router.get('/', requireSession, async (req, res) => {
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
  });

  /**
   * GET /api/queues/:id - Détails d'une file
   */
  router.get('/:id', requireSession, async (req, res) => {
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
  });

  /**
   * POST /api/queues/:id/agents - Ajouter un agent
   */
  router.post('/:id/agents', requireSession, async (req, res) => {
    const { extension } = req.body;
    const queueId = req.params.id;

    if (!extension) {
      return res.status(400).json({ error: 'Extension requise' });
    }

    await ucmHttpClient.addQueueAgent(queueId, extension);

    logger.info('API: agent ajouté à la file', { queue: queueId, extension });
    res.json({ success: true });
  });

  /**
   * DELETE /api/queues/:id/agents/:extension - Retirer un agent
   */
  router.delete('/:id/agents/:extension', requireSession, async (req, res) => {
    const { id: queueId, extension } = req.params;

    await ucmHttpClient.removeQueueAgent(queueId, extension);

    logger.info('API: agent retiré de la file', { queue: queueId, extension });
    res.json({ success: true });
  });

  /**
   * POST /api/queues/:id/agents/:extension/pause - Mettre en pause un agent
   */
  router.post('/:id/agents/:extension/pause', requireSession, async (req, res) => {
    const { id: queueId, extension } = req.params;
    const { pause = true } = req.body;

    await ucmHttpClient.pauseQueueAgent(queueId, extension, pause);

    logger.info('API: agent pause', { queue: queueId, extension, pause });
    res.json({ success: true });
  });

  /**
   * GET /api/queues/stats - Statistiques globales des files
   */
  router.get('/stats/summary', requireSession, async (req, res) => {
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
  });

  // Gestion d'erreurs
  router.use(notFoundHandler);
  router.use(errorHandler);

  return router;
}

module.exports = createQueuesRouter;
