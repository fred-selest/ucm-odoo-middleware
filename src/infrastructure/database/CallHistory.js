'use strict';

const db = require('./Database');
const logger = require('../../logger');

class CallHistory {
  constructor() {
    this.db = db;
  }

  async init() {
    await this.db.connect();
  }

  // ── CRUD Appels ────────────────────────────────────────────────────────────

  async createCall(callData) {
    const {
      uniqueId,
      callerIdNum,
      callerIdName,
      exten,
      agentExten,
      direction = 'inbound'
    } = callData;

    try {
      const result = await this.db.run(
        `INSERT INTO calls (unique_id, caller_id_num, caller_id_name, exten, agent_exten, direction, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [uniqueId, callerIdNum, callerIdName, exten, agentExten, direction, 'ringing']
      );
      
      logger.debug('Appel créé dans l\'historique', { id: result.id, uniqueId });
      return result.id;
    } catch (err) {
      logger.error('Erreur création appel', { error: err.message, uniqueId });
      throw err;
    }
  }

  async updateCallAnswered(uniqueId, data = {}) {
    try {
      await this.db.run(
        `UPDATE calls 
         SET status = 'answered', answered_at = CURRENT_TIMESTAMP
         WHERE unique_id = ?`,
        [uniqueId]
      );
      logger.debug('Appel marqué comme décroché', { uniqueId });
    } catch (err) {
      logger.error('Erreur mise à jour appel', { error: err.message, uniqueId });
    }
  }

  async updateCallHangup(uniqueId, duration = null) {
    try {
      const call = await this.db.get(
        'SELECT answered_at FROM calls WHERE unique_id = ?',
        [uniqueId]
      );

      const status = call && call.answered_at ? 'hangup' : 'missed';

      await this.db.run(
        `UPDATE calls 
         SET status = ?, hung_up_at = CURRENT_TIMESTAMP, duration = ?
         WHERE unique_id = ?`,
        [status, duration, uniqueId]
      );

      await this._updateDailyStats();
      
      logger.debug('Appel marqué comme raccroché', { uniqueId, status, duration });
    } catch (err) {
      logger.error('Erreur mise à jour appel', { error: err.message, uniqueId });
    }
  }

  async saveCallRecording(uniqueId, recordingUrl, recordingDuration = null) {
    try {
      await this.db.run(
        `UPDATE calls 
         SET recording_url = ?, recording_duration = ?, updated_at = CURRENT_TIMESTAMP
         WHERE unique_id = ?`,
        [recordingUrl, recordingDuration, uniqueId]
      );
      logger.info('Enregistrement associé à l\'appel', { uniqueId, url: recordingUrl });
      return true;
    } catch (err) {
      logger.error('Erreur sauvegarde enregistrement', { error: err.message, uniqueId });
      throw err;
    }
  }

  async getCallsWithRecordings(limit = 50) {
    try {
      return await this.db.all(
        `SELECT * FROM calls 
         WHERE recording_url IS NOT NULL 
         ORDER BY started_at DESC 
         LIMIT ?`,
        [limit]
      );
    } catch (err) {
      logger.error('Erreur récupération appels enregistrés', { error: err.message });
      return [];
    }
  }

  async updateCallContact(uniqueId, contact) {
    if (!contact) return;

    try {
      await this.db.run(
        `UPDATE calls 
         SET contact_id = ?, contact_name = ?, contact_phone = ?, 
             contact_email = ?, contact_odoo_url = ?, odoo_partner_id = ?, 
             contact_avatar = ?, contact_street = ?, contact_city = ?,
             contact_company = ?, contact_zip = ?, contact_country = ?,
             contact_website = ?, contact_function = ?, contact_mobile = ?
         WHERE unique_id = ?`,
        [
          contact.id,
          contact.name,
          contact.phone,
          contact.email,
          contact.odooUrl,
          contact.partnerId,
          contact.avatar,
          contact.street || null,
          contact.city || null,
          contact.company || null,
          contact.zip || null,
          contact.country || null,
          contact.website || null,
          contact.function || null,
          contact.mobile || null,
          uniqueId
        ]
      );
      logger.debug('Contact associé à l\'appel', { uniqueId, contactName: contact.name });
    } catch (err) {
      logger.error('Erreur mise à jour contact', { error: err.message, uniqueId });
    }
  }

  // ── Notes et Tags ───────────────────────────────────────────────────────────

  async addCallNote(uniqueId, note, createdBy = 'system') {
    try {
      const call = await this.getCallByUniqueId(uniqueId);
      if (!call) throw new Error('Appel non trouvé');
      
      const existingNotes = call.notes || '';
      const newNote = `[${new Date().toLocaleString('fr-FR')}] ${createdBy}: ${note}\n${existingNotes}`;
      
      await this.db.run(
        'UPDATE calls SET notes = ?, updated_at = CURRENT_TIMESTAMP WHERE unique_id = ?',
        [newNote, uniqueId]
      );
      logger.info('Note ajoutée à l\'appel', { uniqueId, createdBy });
      return true;
    } catch (err) {
      logger.error('Erreur ajout note', { error: err.message, uniqueId });
      throw err;
    }
  }

  async updateCallTags(uniqueId, tags) {
    try {
      const tagsJson = Array.isArray(tags) ? JSON.stringify(tags) : tags;
      await this.db.run(
        'UPDATE calls SET tags = ?, updated_at = CURRENT_TIMESTAMP WHERE unique_id = ?',
        [tagsJson, uniqueId]
      );
      logger.info('Tags mis à jour', { uniqueId, tags });
      return true;
    } catch (err) {
      logger.error('Erreur mise à jour tags', { error: err.message, uniqueId });
      throw err;
    }
  }

  async rateCall(uniqueId, rating, notes = '') {
    try {
      if (rating < 1 || rating > 5) throw new Error('Rating must be between 1 and 5');
      
      await this.db.run(
        'UPDATE calls SET rating = ?, notes = COALESCE(?, notes), updated_at = CURRENT_TIMESTAMP WHERE unique_id = ?',
        [rating, notes, uniqueId]
      );
      logger.info('Appel noté', { uniqueId, rating });
      return true;
    } catch (err) {
      logger.error('Erreur notation appel', { error: err.message, uniqueId });
      throw err;
    }
  }

  // ── Statuts Agent (Ringover style) ─────────────────────────────────────────

  async updateAgentStatus(exten, status) {
    try {
      const validStatuses = ['available', 'busy', 'on_call', 'pause', 'offline'];
      if (!validStatuses.includes(status)) {
        throw new Error(`Statut invalide. Valeurs acceptées: ${validStatuses.join(', ')}`);
      }

      await this.db.run(
        `INSERT INTO agent_status (exten, status, last_status_change)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(exten) DO UPDATE SET
           status = ?,
           last_status_change = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP`,
        [exten, status, status]
      );
      
      logger.debug('Statut agent mis à jour', { exten, status });
      return true;
    } catch (err) {
      logger.error('Erreur mise à jour statut agent', { error: err.message, exten });
      throw err;
    }
  }

  async setAgentOnCall(exten, uniqueId) {
    try {
      await this.db.run(
        `UPDATE agent_status 
         SET status = 'on_call', last_call_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE exten = ?`,
        [exten]
      );
      
      // Ajouter l'appel dans active_calls
      await this.db.run(
        `INSERT INTO active_calls (unique_id, exten, status, started_at)
         VALUES (?, ?, 'on_call', CURRENT_TIMESTAMP)
         ON CONFLICT(unique_id) DO UPDATE SET status = 'on_call'`,
        [uniqueId, exten]
      );
      
      logger.debug('Agent en appel', { exten, uniqueId });
      return true;
    } catch (err) {
      logger.error('Erreur setAgentOnCall', { error: err.message, exten });
      throw err;
    }
  }

  async setAgentAvailable(exten, callDuration = 0) {
    try {
      await this.db.run(
        `UPDATE agent_status 
         SET status = 'available', 
             total_calls_today = total_calls_today + 1,
             total_duration_today = total_duration_today + ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE exten = ?`,
        [callDuration, exten]
      );
      
      logger.debug('Agent disponible', { exten, callDuration });
      return true;
    } catch (err) {
      logger.error('Erreur setAgentAvailable', { error: err.message, exten });
      throw err;
    }
  }

  async getAgentStatus(exten) {
    return await this.db.get(
      'SELECT * FROM agent_status WHERE exten = ?',
      [exten]
    );
  }

  async getAllAgentsStatus() {
    return await this.db.all(
      'SELECT * FROM agent_status ORDER BY exten'
    );
  }

  async removeActiveCall(uniqueId) {
    try {
      await this.db.run(
        'DELETE FROM active_calls WHERE unique_id = ?',
        [uniqueId]
      );
    } catch (err) {
      logger.error('Erreur suppression appel actif', { error: err.message, uniqueId });
    }
  }

  async getActiveCalls(exten = null) {
    let sql = 'SELECT * FROM active_calls WHERE 1=1';
    const params = [];
    
    if (exten) {
      sql += ' AND exten = ?';
      params.push(exten);
    }
    
    sql += ' ORDER BY started_at DESC';
    return await this.db.all(sql, params);
  }

  async getCallById(id) {
    return await this.db.get('SELECT * FROM calls WHERE id = ?', [id]);
  }

  async getCallByUniqueId(uniqueId) {
    return await this.db.get('SELECT * FROM calls WHERE unique_id = ?', [uniqueId]);
  }

  async getCalls(options = {}) {
    const {
      limit = 50,
      offset = 0,
      status,
      direction,
      exten,
      callerIdNum,
      startDate,
      endDate,
      search
    } = options;

    let sql = 'SELECT * FROM calls WHERE 1=1';
    const params = [];

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }

    if (direction) {
      sql += ' AND direction = ?';
      params.push(direction);
    }

    if (exten) {
      sql += ' AND (exten = ? OR agent_exten = ?)';
      params.push(exten, exten);
    }

    if (callerIdNum) {
      sql += ' AND caller_id_num LIKE ?';
      params.push(`%${callerIdNum}%`);
    }

    if (startDate) {
      sql += ' AND started_at >= ?';
      params.push(startDate);
    }

    if (endDate) {
      sql += ' AND started_at <= ?';
      params.push(endDate);
    }

    if (search) {
      sql += ` AND (caller_id_num LIKE ? OR caller_id_name LIKE ? OR contact_name LIKE ?)`;
      const likeSearch = `%${search}%`;
      params.push(likeSearch, likeSearch, likeSearch);
    }

    sql += ' ORDER BY started_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return await this.db.all(sql, params);
  }

  async getCallsCount(options = {}) {
    const { status, direction, exten, startDate, endDate } = options;
    
    let sql = 'SELECT COUNT(*) as count FROM calls WHERE 1=1';
    const params = [];

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }

    if (direction) {
      sql += ' AND direction = ?';
      params.push(direction);
    }

    if (exten) {
      sql += ' AND (exten = ? OR agent_exten = ?)';
      params.push(exten, exten);
    }

    if (startDate) {
      sql += ' AND started_at >= ?';
      params.push(startDate);
    }

    if (endDate) {
      sql += ' AND started_at <= ?';
      params.push(endDate);
    }

    const result = await this.db.get(sql, params);
    return result.count;
  }

  // ── Statistiques ───────────────────────────────────────────────────────────

  async getStats(period = 'today') {
    let dateFilter;
    switch (period) {
      case 'today':
        dateFilter = "date(started_at) = date('now')";
        break;
      case 'yesterday':
        dateFilter = "date(started_at) = date('now', '-1 day')";
        break;
      case 'week':
        dateFilter = "started_at >= date('now', '-7 days')";
        break;
      case 'month':
        dateFilter = "started_at >= date('now', '-30 days')";
        break;
      default:
        dateFilter = "date(started_at) = date('now')";
    }

    const stats = await this.db.get(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'answered' THEN 1 ELSE 0 END) as answered,
        SUM(CASE WHEN status = 'missed' THEN 1 ELSE 0 END) as missed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        AVG(CASE WHEN duration > 0 THEN duration END) as avg_duration,
        SUM(CASE WHEN duration > 0 THEN duration END) as total_duration,
        COUNT(DISTINCT caller_id_num) as unique_callers
       FROM calls
       WHERE ${dateFilter}`
    );

    return {
      period,
      total: stats.total || 0,
      answered: stats.answered || 0,
      missed: stats.missed || 0,
      failed: stats.failed || 0,
      avgDuration: Math.round(stats.avg_duration || 0),
      totalDuration: stats.total_duration || 0,
      uniqueCallers: stats.unique_callers || 0,
      answerRate: stats.total > 0 ? Math.round((stats.answered / stats.total) * 100) : 0
    };
  }

  async getStatsByExtension(days = 30) {
    return await this.db.all(
      `SELECT 
        exten,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'answered' THEN 1 ELSE 0 END) as answered,
        SUM(CASE WHEN status = 'missed' THEN 1 ELSE 0 END) as missed,
        ROUND(AVG(CASE WHEN duration > 0 THEN duration END), 2) as avg_duration,
        SUM(CASE WHEN duration > 0 THEN duration END) as total_duration
       FROM calls
       WHERE started_at >= date('now', '-${days} days') AND exten IS NOT NULL
       GROUP BY exten
       ORDER BY total DESC`
    );
  }

  async getHourlyDistribution(date = 'today') {
    const dateFilter = date === 'today' 
      ? "date(started_at) = date('now')"
      : `date(started_at) = date('${date}')`;

    return await this.db.all(
      `SELECT 
        strftime('%H', started_at) as hour,
        COUNT(*) as count
       FROM calls
       WHERE ${dateFilter}
       GROUP BY hour
       ORDER BY hour`
    );
  }

  async getTopCallers(limit = 10, days = 30) {
    return await this.db.all(
      `SELECT 
        caller_id_num,
        caller_id_name,
        contact_name,
        COUNT(*) as call_count,
        SUM(CASE WHEN status = 'answered' THEN 1 ELSE 0 END) as answered_count
       FROM calls
       WHERE started_at >= date('now', '-${days} days') 
         AND caller_id_num IS NOT NULL
         AND caller_id_num != ''
       GROUP BY caller_id_num
       ORDER BY call_count DESC
       LIMIT ?`,
      [limit]
    );
  }

  // ── Blacklist ──────────────────────────────────────────────────────────────

  async addToBlacklist(phoneNumber, reason = '', blockedBy = 'system') {
    try {
      await this.db.run(
        `INSERT INTO blacklist (phone_number, reason, blocked_by)
         VALUES (?, ?, ?)
         ON CONFLICT(phone_number) DO UPDATE SET
           active = 1,
           blocked_at = CURRENT_TIMESTAMP,
           reason = COALESCE(?, blacklist.reason)`,
        [phoneNumber, reason, blockedBy, reason]
      );
      logger.info('Numéro ajouté à la blacklist', { phoneNumber, reason });
      return true;
    } catch (err) {
      logger.error('Erreur ajout blacklist', { error: err.message, phoneNumber });
      throw err;
    }
  }

  async removeFromBlacklist(phoneNumber) {
    try {
      await this.db.run(
        'UPDATE blacklist SET active = 0 WHERE phone_number = ?',
        [phoneNumber]
      );
      logger.info('Numéro retiré de la blacklist', { phoneNumber });
      return true;
    } catch (err) {
      logger.error('Erreur retrait blacklist', { error: err.message, phoneNumber });
      throw err;
    }
  }

  async isBlacklisted(phoneNumber) {
    const result = await this.db.get(
      `SELECT * FROM blacklist 
       WHERE phone_number = ? AND active = 1 
       AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
      [phoneNumber]
    );
    return result !== undefined;
  }

  async getBlacklist(options = {}) {
    const { limit = 50, offset = 0, active = true } = options;
    
    let sql = 'SELECT * FROM blacklist WHERE 1=1';
    const params = [];

    if (active !== null) {
      sql += ' AND active = ?';
      params.push(active ? 1 : 0);
    }

    sql += ' ORDER BY blocked_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return await this.db.all(sql, params);
  }

  // ── Maintenance ────────────────────────────────────────────────────────────

  async _updateDailyStats() {
    try {
      await this.db.run(
        `INSERT INTO daily_stats (date, total_calls, answered_calls, missed_calls, failed_calls, avg_duration, total_duration, unique_callers)
         SELECT 
           date(started_at) as date,
           COUNT(*),
           SUM(CASE WHEN status = 'answered' THEN 1 ELSE 0 END),
           SUM(CASE WHEN status = 'missed' THEN 1 ELSE 0 END),
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END),
           AVG(CASE WHEN duration > 0 THEN duration END),
           SUM(CASE WHEN duration > 0 THEN duration END),
           COUNT(DISTINCT caller_id_num)
         FROM calls
         WHERE date(started_at) = date('now')
         GROUP BY date(started_at)
         ON CONFLICT(date) DO UPDATE SET
           total_calls = excluded.total_calls,
           answered_calls = excluded.answered_calls,
           missed_calls = excluded.missed_calls,
           failed_calls = excluded.failed_calls,
           avg_duration = excluded.avg_duration,
           total_duration = excluded.total_duration,
           unique_callers = excluded.unique_callers,
           updated_at = CURRENT_TIMESTAMP`
      );
    } catch (err) {
      logger.error('Erreur mise à jour stats journalières', { error: err.message });
    }
  }

  async cleanupOldData(days = 365) {
    try {
      const result = await this.db.run(
        'DELETE FROM calls WHERE started_at < date("now", "-${days} days")',
        [days]
      );
      logger.info('Nettoyage anciens appels', { deleted: result.changes, days });
      return result.changes;
    } catch (err) {
      logger.error('Erreur nettoyage anciens appels', { error: err.message });
      throw err;
    }
  }

  // ── Méthodes pour HealthAgent ────────────────────────────────────────────

  async getTodayCount() {
    try {
      const result = await this.db.get(
        "SELECT COUNT(*) as count FROM calls WHERE date(started_at) = date('now')"
      );
      return result?.count || 0;
    } catch (err) {
      logger.error('Erreur getTodayCount', { error: err.message });
      return 0;
    }
  }

  async getLastCallTime() {
    try {
      const result = await this.db.get(
        "SELECT started_at FROM calls ORDER BY started_at DESC LIMIT 1"
      );
      return result?.started_at || null;
    } catch (err) {
      logger.error('Erreur getLastCallTime', { error: err.message });
      return null;
    }
  }
}

module.exports = CallHistory;
