'use strict';

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../logger');

const DATA_FILE = path.join(process.cwd(), 'data', 'notifications.json');

/**
 * Service de notifications (Telegram, Email, Web Push)
 */
class NotificationService {
  constructor() {
    this._telegramToken = config.telegram?.token || process.env.TELEGRAM_TOKEN;
    this._chatIds = config.telegram?.chatIds || [];
    this._smtpConfig = config.smtp || {};
    this._webPushSubscriptions = [];
    this._missedCallThreshold = config.notifications?.missedCallThreshold || { count: 3, minutes: 15 };
    this._dailySummaryEnabled = config.notifications?.dailySummaryEnabled || false;
    this._dailySummaryTime = config.notifications?.dailySummaryTime || '18:00';
    
    this._missedCallBuffer = [];
    this._lastSummarySent = null;
    
    this._loadSubscriptions();
    this._startDailySummaryScheduler();
  }

  // ── Telegram ───────────────────────────────────────────────────────────────

  /**
   * Envoie un message Telegram à tous les chat IDs configurés
   */
  async sendTelegram(message, parseMode = 'HTML') {
    if (!this._telegramToken) {
      logger.warn('Telegram: token non configuré');
      return false;
    }

    const chatIds = this._chatIds.length > 0 ? this._chatIds : await this._getAdminChatIds();
    if (chatIds.length === 0) {
      logger.warn('Telegram: aucun destinataire');
      return false;
    }

    const url = `https://api.telegram.org/bot${this._telegramToken}/sendMessage`;
    let successCount = 0;

    for (const chatId of chatIds) {
      try {
        await axios.post(url, {
          chat_id: chatId,
          text: message,
          parse_mode: parseMode,
        }, { timeout: 10000 });
        successCount++;
      } catch (err) {
        logger.error('Telegram: erreur envoi', { chatId, error: err.message });
      }
    }

    logger.info('Telegram: messages envoyés', { sent: successCount, total: chatIds.length });
    return successCount > 0;
  }

  /**
   * Récupère les chat IDs des admins depuis Odoo
   */
  async _getAdminChatIds() {
    // TODO: Implémenter si les chat IDs sont stockés dans Odoo
    return [];
  }

  // ── Email (SMTP) ───────────────────────────────────────────────────────────

  /**
   * Envoie un email via SMTP
   */
  async sendEmail(subject, htmlBody, to = []) {
    if (!this._smtpConfig.host || !this._smtpConfig.from) {
      logger.warn('Email: SMTP non configuré');
      return false;
    }

    const nodemailer = require('nodemailer');
    
    const transporter = nodemailer.createTransport({
      host: this._smtpConfig.host,
      port: this._smtpConfig.port || 587,
      secure: this._smtpConfig.secure || false,
      auth: {
        user: this._smtpConfig.user,
        pass: this._smtpConfig.password,
      },
    });

    try {
      await transporter.sendMail({
        from: this._smtpConfig.from,
        to: to.length > 0 ? to : this._smtpConfig.defaultRecipients || [],
        subject,
        html: htmlBody,
      });
      logger.info('Email: envoyé', { subject, to });
      return true;
    } catch (err) {
      logger.error('Email: erreur envoi', { error: err.message });
      return false;
    }
  }

  // ── Web Push ───────────────────────────────────────────────────────────────

  /**
   * Envoie une notification Web Push aux navigateurs abonnés
   */
  async sendWebPush(title, body, url = null) {
    if (this._webPushSubscriptions.length === 0) {
      return false;
    }

    const webPush = require('web-push');
    
    const payload = JSON.stringify({
      title,
      body,
      url,
      icon: '/admin/icons/icon-192.png',
      badge: '/admin/icons/badge-72.png',
      vibrate: [200, 100, 200],
      tag: `notification-${Date.now()}`,
    });

    let successCount = 0;
    for (const subscription of this._webPushSubscriptions) {
      try {
        await webPush.sendNotification(subscription, payload);
        successCount++;
      } catch (err) {
        if (err.statusCode === 410) {
          // Subscription expirée, la supprimer
          this._removeSubscription(subscription);
        }
        logger.debug('Web Push: erreur', { error: err.message });
      }
    }

    logger.info('Web Push: notifications envoyées', { sent: successCount, total: this._webPushSubscriptions.length });
    return successCount > 0;
  }

  /**
   * Ajoute un abonnement Web Push
   */
  addSubscription(subscription) {
    if (!this._webPushSubscriptions.some(s => s.endpoint === subscription.endpoint)) {
      this._webPushSubscriptions.push(subscription);
      this._saveSubscriptions();
    }
  }

  /**
   * Supprime un abonnement Web Push
   */
  _removeSubscription(subscription) {
    this._webPushSubscriptions = this._webPushSubscriptions.filter(
      s => s.endpoint !== subscription.endpoint
    );
    this._saveSubscriptions();
  }

  _saveSubscriptions() {
    try {
      const data = this._loadData();
      data.webPush = this._webPushSubscriptions;
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
      logger.error('Notification: erreur sauvegarde', { error: err.message });
    }
  }

  _loadSubscriptions() {
    try {
      const data = this._loadData();
      this._webPushSubscriptions = data.webPush || [];
    } catch (err) {
      logger.debug('Notification: pas d\'abonnements existants');
    }
  }

  _loadData() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      }
    } catch { /* ignore */ }
    return {};
  }

  // ── Alertes appels manqués ────────────────────────────────────────────────

  /**
   * Vérifie et envoie une alerte si seuil d'appels manqués dépassé
   */
  async checkMissedCallAlert(call) {
    if (call.status !== 'missed') return;

    const now = Date.now();
    const windowMs = this._missedCallThreshold.minutes * 60 * 1000;
    
    // Ajouter au buffer
    this._missedCallBuffer.push({
      time: now,
      caller: call.caller_id_num,
      exten: call.exten,
    });

    // Nettoyer ancien buffer
    this._missedCallBuffer = this._missedCallBuffer.filter(
      item => now - item.time < windowMs
    );

    // Vérifier seuil
    if (this._missedCallBuffer.length >= this._missedCallThreshold.count) {
      await this._sendMissedCallAlert();
      this._missedCallBuffer = []; // Reset après alerte
    }
  }

  /**
   * Envoie l'alerte d'appels manqués
   */
  async _sendMissedCallAlert() {
    const count = this._missedCallThreshold.count;
    const minutes = this._missedCallThreshold.minutes;
    
    const callers = this._missedCallBuffer.map(item => item.caller).join(', ');
    
    // Message Telegram
    const telegramMsg = `🚨 <b>Alerte Appels Manqués</b>\n\n` +
      `${count} appels manqués en ${minutes} minutes\n\n` +
      `📞 Numéros: ${callers}\n\n` +
      `<i>Vérifiez votre standard téléphonique</i>`;
    
    await this.sendTelegram(telegramMsg);

    // Email
    if (this._smtpConfig.host) {
      const emailHtml = `
        <h2>🚨 Alerte Appels Manqués</h2>
        <p><strong>${count}</strong> appels manqués en <strong>${minutes} minutes</strong></p>
        <h3>Numéros appelants:</h3>
        <ul>${this._missedCallBuffer.map(item => `<li>${item.caller}</li>`).join('')}</ul>
        <p><em>Vérifiez votre standard téléphonique</em></p>
      `;
      await this.sendEmail('Alerte: Appels manqués multiples', emailHtml);
    }

    // Web Push
    await this.sendWebPush(
      `🚨 ${count} appels manqués`,
      `${count} appels non répondus en ${minutes} min`,
      '/admin/?tab=historique&status=missed'
    );

    logger.warn('Alerte appels manqués envoyée', { count, minutes, callers });
  }

  // ── Résumé quotidien ───────────────────────────────────────────────────────

  /**
   * Planifie l'envoi du résumé quotidien
   */
  _startDailySummaryScheduler() {
    if (!this._dailySummaryEnabled) return;

    const [hours, minutes] = this._dailySummaryTime.split(':').map(Number);
    const now = new Date();
    const scheduledTime = new Date();
    scheduledTime.setHours(hours, minutes, 0, 0);

    if (scheduledTime <= now) {
      scheduledTime.setDate(scheduledTime.getDate() + 1);
    }

    const delay = scheduledTime.getTime() - now.getTime();
    
    logger.info('Résumé quotidien planifié', { 
      nextSend: scheduledTime.toISOString(),
      delay: Math.round(delay / 60000) + ' min'
    });

    setTimeout(() => {
      this._sendDailySummary();
      // Re-planifier pour le lendemain
      setTimeout(() => this._startDailySummaryScheduler(), 24 * 60 * 60 * 1000);
    }, delay);
  }

  /**
   * Envoie le résumé quotidien des appels
   */
  async _sendDailySummary() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];

    // TODO: Récupérer les stats depuis CallHistory
    const stats = {
      total: 0,
      answered: 0,
      missed: 0,
      duration: 0,
      topCallers: [],
    };

    const answerRate = stats.total > 0 ? Math.round((stats.answered / stats.total) * 100) : 0;

    // Message Telegram
    const telegramMsg = `📊 <b>Résumé Quotidien - ${dateStr}</b>\n\n` +
      `📞 Appels totaux: <b>${stats.total}</b>\n` +
      `✅ Décrochés: <b>${stats.answered}</b>\n` +
      `❌ Manqués: <b>${stats.missed}</b>\n` +
      `📈 Taux de réponse: <b>${answerRate}%</b>\n` +
      `⏱️ Durée totale: <b>${Math.round(stats.duration / 60)} min</b>\n\n` +
      `<i>Configurez les notifications dans l'interface admin</i>`;

    await this.sendTelegram(telegramMsg);

    // Email
    if (this._smtpConfig.host) {
      const emailHtml = `
        <h2>📊 Résumé Quotidien - ${dateStr}</h2>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:8px;border:1px solid #ddd">📞 Total</td><td style="padding:8px;border:1px solid #ddd"><b>${stats.total}</b></td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd">✅ Décrochés</td><td style="padding:8px;border:1px solid #ddd"><b>${stats.answered}</b></td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd">❌ Manqués</td><td style="padding:8px;border:1px solid #ddd"><b>${stats.missed}</b></td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd">📈 Taux de réponse</td><td style="padding:8px;border:1px solid #ddd"><b>${answerRate}%</b></td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd">⏱️ Durée totale</td><td style="padding:8px;border:1px solid #ddd"><b>${Math.round(stats.duration / 60)} min</b></td></tr>
        </table>
      `;
      await this.sendEmail(`Résumé appels - ${dateStr}`, emailHtml);
    }

    this._lastSummarySent = dateStr;
    logger.info('Résumé quotidien envoyé', { date: dateStr });
  }

  // ── Configuration ──────────────────────────────────────────────────────────

  /**
   * Met à jour la configuration des notifications
   */
  updateConfig(configData) {
    if (configData.telegram) {
      if (configData.telegram.token) this._telegramToken = configData.telegram.token;
      if (configData.telegram.chatIds) this._chatIds = configData.telegram.chatIds;
    }
    if (configData.smtp) {
      this._smtpConfig = { ...this._smtpConfig, ...configData.smtp };
    }
    if (configData.missedCallThreshold) {
      this._missedCallThreshold = configData.missedCallThreshold;
    }
    if (configData.dailySummaryEnabled !== undefined) {
      this._dailySummaryEnabled = configData.dailySummaryEnabled;
      if (configData.dailySummaryTime) this._dailySummaryTime = configData.dailySummaryTime;
    }
    
    this._saveConfig();
    logger.info('Notifications: configuration mise à jour');
  }

  _saveConfig() {
    try {
      const data = this._loadData();
      data.config = {
        telegram: { token: this._telegramToken ? '***' : null, chatIds: this._chatIds },
        smtp: { host: this._smtpConfig.host, from: this._smtpConfig.from },
        missedCallThreshold: this._missedCallThreshold,
        dailySummary: {
          enabled: this._dailySummaryEnabled,
          time: this._dailySummaryTime,
        },
      };
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
      logger.error('Notification: erreur sauvegarde config', { error: err.message });
    }
  }

  /**
   * Teste l'envoi d'une notification
   */
  async testNotification(type = 'telegram') {
    const testMsg = `✅ <b>Test de notification</b>\n\n` +
      `Les notifications fonctionnent correctement !\n\n` +
      `<i>Envoyé depuis UCM-Odoo Middleware</i>`;

    switch (type) {
      case 'telegram':
        return await this.sendTelegram(testMsg);
      case 'email':
        return await this.sendEmail('Test de notification', '<h2>✅ Test réussi</h2><p>Les notifications email fonctionnent !</p>');
      case 'webpush':
        return await this.sendWebPush('✅ Test réussi', 'Les notifications Web Push fonctionnent !');
      default:
        return false;
    }
  }
}

module.exports = NotificationService;
