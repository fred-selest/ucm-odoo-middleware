'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// ══ GESTION DES NOTIFICATIONS — Telegram, Email, Web Push ═════════════════
// ═══════════════════════════════════════════════════════════════════════════

let _notifConfig = null;

/**
 * Charge la configuration des notifications
 */
async function loadNotificationConfig() {
  try {
    const r = await apiFetch('/api/config/notifications');
    const d = await r.json();
    if (!d.ok) return;

    _notifConfig = d;

    // Alertes appels manqués
    if (d.missedCallThreshold) {
      document.getElementById('notifMissedCount').value = d.missedCallThreshold.count || 3;
      document.getElementById('notifMissedMinutes').value = d.missedCallThreshold.minutes || 15;
    }

    // Résumé quotidien
    if (d.dailySummary) {
      document.getElementById('notifDailyEnabled').checked = d.dailySummary.enabled || false;
      document.getElementById('notifDailyTime').value = d.dailySummary.time || '18:00';
    }

    // Telegram
    if (d.telegram) {
      document.getElementById('notifTelegramToken').value = '';
      document.getElementById('notifTelegramChatIds').value = d.telegram.chatIds ? JSON.stringify(d.telegram.chatIds) : '[]';
    }

    // SMTP
    if (d.smtp) {
      document.getElementById('notifSmtpHost').value = d.smtp.host || '';
      document.getElementById('notifSmtpPort').value = d.smtp.port || 587;
      document.getElementById('notifSmtpFrom').value = d.smtp.from || '';
      document.getElementById('notifSmtpUser').value = '';
      document.getElementById('notifSmtpPassword').value = '';
    }

    // Web Push status
    updateWebPushStatus();
  } catch (err) {
    console.error('Erreur chargement config notifications:', err);
  }
}

/**
 * Sauvegarde la configuration des notifications
 */
async function saveNotifications() {
  const config = {
    missedCallThreshold: {
      count: parseInt(document.getElementById('notifMissedCount').value) || 3,
      minutes: parseInt(document.getElementById('notifMissedMinutes').value) || 15,
    },
    dailySummary: {
      enabled: document.getElementById('notifDailyEnabled').checked,
      time: document.getElementById('notifDailyTime').value || '18:00',
    },
    telegram: {
      token: document.getElementById('notifTelegramToken').value || undefined,
      chatIds: parseChatIds(document.getElementById('notifTelegramChatIds').value),
    },
    smtp: {
      host: document.getElementById('notifSmtpHost').value || undefined,
      port: parseInt(document.getElementById('notifSmtpPort').value) || 587,
      from: document.getElementById('notifSmtpFrom').value || undefined,
      user: document.getElementById('notifSmtpUser').value || undefined,
      password: document.getElementById('notifSmtpPassword').value || undefined,
    },
  };

  try {
    const r = await apiFetch('/api/config/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    const d = await r.json();

    if (d.ok) {
      showNotification('Configuration enregistrée', 'success');
      // Recharger la config
      await loadNotificationConfig();
    } else {
      showNotification('Erreur: ' + (d.error || d.message), 'danger');
    }
  } catch (err) {
    showNotification('Erreur: ' + err.message, 'danger');
  }
}

/**
 * Teste l'envoi d'une notification
 */
async function testNotification(type) {
  const btn = event.target;
  const originalText = btn.innerHTML;
  btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Envoi...';
  btn.disabled = true;

  try {
    const r = await apiFetch('/api/config/notifications/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type }),
    });
    const d = await r.json();

    if (d.ok) {
      showNotification('Test réussi ! Vérifiez vos ' + (type === 'telegram' ? 'Telegram' : 'emails'), 'success');
    } else {
      showNotification('Échec du test: ' + (d.error || d.message), 'danger');
    }
  } catch (err) {
    showNotification('Erreur: ' + err.message, 'danger');
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

/**
 * Parse les chat IDs Telegram (JSON ou liste séparée par virgules)
 */
function parseChatIds(input) {
  if (!input || input.trim() === '') return [];
  try {
    const parsed = JSON.parse(input);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // Essayer de parser comme liste CSV
    return input.split(',').map(s => s.trim()).filter(Boolean).map(s => {
      const n = parseInt(s);
      return isNaN(n) ? s : n;
    });
  }
}

/**
 * Demande la permission pour les notifications navigateur
 */
async function requestNotifPermission() {
  if (!('Notification' in window)) {
    showNotification('Votre navigateur ne supporte pas les notifications', 'warning');
    return;
  }

  if (Notification.permission === 'granted') {
    showNotification('Les notifications sont déjà activées', 'success');
    subscribeWebPush();
    return;
  }

  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      showNotification('Notifications activées !', 'success');
      subscribeWebPush();
    }
  } else {
    showNotification('Notifications bloquées. Débloquez-les dans les paramètres du navigateur.', 'warning');
  }
}

/**
 * S'abonne aux notifications Web Push
 */
async function subscribeWebPush() {
  try {
    // Vérifier si le navigateur supporte les Service Workers
    if (!('serviceWorker' in navigator)) {
      document.getElementById('webPushStatus').textContent = 'Service Worker non supporté';
      return;
    }

    // Enregistrer le service worker (fichier factice pour l'instant)
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) {
      // Pour une implémentation complète, il faudrait créer un sw.js
      console.log('Service Worker non enregistré (nécessite un fichier sw.js)');
    }

    // S'abonner via l'API
    await apiFetch('/api/webpush/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: 'browser-' + Date.now(),
        browser: navigator.userAgent,
      }),
    });

    document.getElementById('webPushStatus').textContent = '✓ Activées';
    document.getElementById('btnEnableWebPush').innerHTML = '<i class="bi bi-check-circle"></i> Activées';
    document.getElementById('btnEnableWebPush').disabled = true;
  } catch (err) {
    console.error('Erreur Web Push:', err);
    document.getElementById('webPushStatus').textContent = 'Erreur';
  }
}

/**
 * Met à jour le statut Web Push affiché
 */
function updateWebPushStatus() {
  const permission = Notification.permission;
  const statusEl = document.getElementById('webPushStatus');
  const btnEl = document.getElementById('btnEnableWebPush');

  if (!statusEl || !btnEl) return;

  if (permission === 'granted') {
    statusEl.textContent = '✓ Activées';
    btnEl.innerHTML = '<i class="bi bi-check-circle"></i> Activées';
    btnEl.disabled = true;
  } else if (permission === 'denied') {
    statusEl.textContent = '✗ Bloquées';
    btnEl.innerHTML = '<i class="bi bi-slash-circle"></i> Bloquées';
    btnEl.disabled = true;
  } else {
    statusEl.textContent = 'En attente';
    btnEl.innerHTML = '<i class="bi bi-bell me-1"></i>Activer les notifications';
    btnEl.disabled = false;
  }
}

/**
 * Affiche une notification toast
 */
function showNotification(message, type = 'info') {
  const container = document.getElementById('notificationContainer') || createNotificationContainer();

  const toast = document.createElement('div');
  toast.className = `alert alert-${type} alert-dismissible fade show position-fixed`;
  toast.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px;';
  toast.innerHTML = `
    ${message}
    <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
  `;

  container.appendChild(toast);

  // Auto-dismiss après 5 secondes
  setTimeout(() => toast.remove(), 5000);
}

/**
 * Crée le container de notifications s'il n'existe pas
 */
function createNotificationContainer() {
  const container = document.createElement('div');
  container.id = 'notificationContainer';
  document.body.appendChild(container);
  return container;
}

// Initialisation au chargement du DOM
document.addEventListener('DOMContentLoaded', () => {
  // Vérifier le statut des notifications au chargement
  updateWebPushStatus();

  // Charger la config quand la modale de configuration s'ouvre
  const modalConfig = document.getElementById('modalConfig');
  if (modalConfig) {
    modalConfig.addEventListener('show.bs.modal', () => {
      loadNotificationConfig();
    });
  }

  // Charger la config quand l'onglet Notifications est activé
  const tabNotifications = document.getElementById('tabNotifications');
  if (tabNotifications) {
    tabNotifications.addEventListener('shown.bs.tab', () => {
      loadNotificationConfig();
    });
  }
});
