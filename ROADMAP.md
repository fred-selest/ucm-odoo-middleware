# Roadmap — UCM ↔ Odoo Middleware

## Versions publiées

### v1.0.0 — Version initiale
- Connexion UCM6300 (HTTP API + WebSocket)
- Intégration Odoo 19 (XML-RPC) + Dolibarr (REST API)
- Dashboard admin SPA (Bootstrap 5)
- Historique des appels SQLite
- Gestion agents, contacts, blacklist
- Enrichissement SIRENE INSEE + Annuaire Entreprises + Google Places
- Anti-spam Tellows
- WebSocket temps réel vers navigateurs
- Authentification session (X-Session-Token, 8h TTL)
- Documentation Swagger

### v1.1.0 — Lecteur audio & CDR sync
- Lecteur audio barre Spotify-style (play/pause, seek, drag, téléchargement)
- Synchronisation CDR avec aplatissement sub-CDR imbriqués UCM
- Nettoyage automatique des recordfiles (@ suffix, path prefix)
- Bouton play dans historique, dashboard et chatter contact
- Correction superposition audio, format API recordings

### v1.2.0 — CDR Auto-Sync & Transcription *(actuelle)*
- CDR Auto-Sync toutes les 5 min (configurable)
- Résolution contacts automatique après enrichissement
- Transcription Whisper optionnelle (openai-whisper CLI)
- UI transcription : toggle dans historique, aperçu dashboard et chatter
- Routes API transcription (GET/POST)

---

## v1.3.0 — Notifications & Alertes

- [ ] Alertes appels manqués par Telegram (bot existant sur le serveur)
- [ ] Notification email configurable (SMTP) pour appels manqués ou SLA dépassé
- [ ] Seuil d'alerte configurable : X appels manqués en Y minutes
- [ ] Résumé quotidien automatique (nombre d'appels, taux de réponse, durée moyenne)
- [ ] Notifications navigateur (Web Push) pour les agents connectés au dashboard

## v1.4.0 — Statistiques avancées

- [ ] Graphiques par semaine / mois / période personnalisée
- [ ] Tendances et comparaison période précédente
- [ ] Taux de réponse et durée moyenne par agent
- [ ] Répartition horaire des appels (heatmap)
- [ ] Top appelants / numéros les plus fréquents
- [ ] Export CSV / PDF de l'historique avec filtres (date, agent, contact, statut)

## v1.5.0 — Gestion avancée des files d'attente

- [ ] Supervision temps réel des files UCM (appels en attente, temps d'attente)
- [ ] Historique et stats par file d'attente
- [ ] Alertes sur temps d'attente max dépassé
- [ ] Assignation automatique des appels selon disponibilité agent
- [ ] Dashboard dédié files d'attente avec métriques SLA

## v1.6.0 — Intégration VoIP WebRTC

- [ ] Click-to-call depuis le dashboard via FreeSWITCH WebRTC (softphone intégré)
- [ ] Réception d'appels directement dans le navigateur
- [ ] Transfert d'appel (aveugle / assisté) depuis le dashboard
- [ ] Mise en attente / reprise depuis l'interface
- [ ] Indicateur de présence agent temps réel (disponible / en appel / pause)

## v1.7.0 — Multi-tenant & Sécurité

- [ ] Support multi-UCM (plusieurs PBX sur un seul middleware)
- [ ] Rôles et permissions (admin, superviseur, agent)
- [ ] Audit log des actions utilisateur
- [ ] Authentification 2FA (TOTP)
- [ ] Rate limiting par utilisateur + IP

## v1.8.0 — IA & Automatisation

- [ ] Résumé automatique des appels par IA (post-transcription)
- [ ] Détection de sentiment sur les appels transcrits
- [ ] Catégorisation automatique des appels (commercial, support, spam)
- [ ] Suggestions de rappel intelligent (meilleur créneau basé sur l'historique)
- [ ] Réponse vocale interactive (IVR) pilotée par IA

---

## Backlog (non planifié)

- [ ] Application mobile (PWA) pour supervision à distance
- [ ] Intégration calendrier (Odoo/Google) : ne pas déranger si en réunion
- [ ] Enregistrement sélectif à la demande depuis le dashboard
- [ ] Intégration SMS (envoi de SMS depuis la fiche contact)
- [ ] Webhook sortant configurable (Zapier, n8n, Make)
- [ ] Thème sombre pour le dashboard
