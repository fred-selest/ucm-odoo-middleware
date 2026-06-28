# Roadmap

> État des fonctionnalités et backlog. Versions historiques en bas.

## Légende

- ✅ Implémenté
- 🟡 En cours
- ❌ Non démarré

## Versions publiées

### ✅ v2.1.x — Production stable (2026)

| Version | Date | Highlights |
|---------|------|------------|
| v2.1.0 | 2026-03 | Améliorations complètes (multi-CRM, health checks, refactoring) |
| v2.1.1 | 2026-04 | Fix timestamps ISO + superpositions mobile |
| v2.1.2 | 2026-04 | Fix responsive dashboard (cards < 992px) |

**Patches sécurité/dette appliqués en 2026-06** (session de maintenance) :

| Item | Statut |
|------|--------|
| TLS `rejectUnauthorized` (régression SEC_LOG) | ✅ |
| Rate-limit `/api/auth/login` (tests régression) | ✅ |
| Sessions bornées (anti-OOM) | ✅ |
| SQL injection `updateCallsForPhone` | ✅ |
| Retry auth OdooClient dédupliqué | ✅ |
| Dep `crypto` inutile supprimée | ✅ |
| Logs DEBUG en `debug` (CallHandler) | ✅ |
| TTL purge `_activeCalls` | ✅ |
| OdooClient XML-RPC parser testé | ✅ |
| Migrations DB versionnées | ✅ |
| Container DI (god bootstrap) | ✅ |
| CI GitHub Actions + gitleaks | ✅ |
| Prometheus `/metrics` | ✅ |
| ESLint 9 + flat config | ✅ |
| Tests CrmFactory + adapters | ✅ |

## Versions futures

### v1.3.0 — Notifications & Alertes (❌)

- [ ] Alertes appels manqués par Telegram
- [ ] Notification email configurable (SMTP)
- [ ] Seuil d'alerte configurable : X appels manqués en Y minutes
- [ ] Résumé quotidien automatique (nombre d'appels, taux de réponse, durée moyenne)
- [ ] Notifications navigateur (Web Push) pour les agents connectés au dashboard

### v1.4.0 — Statistiques avancées (❌)

- [ ] Graphiques par semaine / mois / période personnalisée
- [ ] Tendances et comparaison période précédente
- [ ] Taux de réponse et durée moyenne par agent
- [ ] Répartition horaire des appels (heatmap)
- [ ] Top appelants / numéros les plus fréquents
- [ ] Export CSV / PDF de l'historique avec filtres

### v1.5.0 — Files d'attente avancées (❌)

- [ ] Supervision temps réel des files UCM (appels en attente, temps d'attente)
- [ ] Historique et stats par file d'attente
- [ ] Alertes sur temps d'attente max dépassé
- [ ] Assignation automatique des appels selon disponibilité agent
- [ ] Dashboard dédié files d'attente avec métriques SLA

### v1.6.0 — VoIP WebRTC (❌)

- [ ] Click-to-call depuis le dashboard via FreeSWITCH WebRTC (softphone intégré)
- [ ] Réception d'appels directement dans le navigateur
- [ ] Transfert d'appel (aveugle / assisté) depuis le dashboard
- [ ] Mise en attente / reprise depuis l'interface
- [ ] Indicateur de présence agent temps réel

### v1.7.0 — Multi-tenant & Sécurité (❌)

- [ ] Support multi-UCM (plusieurs PBX sur un seul middleware)
- [ ] Rôles et permissions (admin, superviseur, agent)
- [ ] Audit log des actions utilisateur
- [ ] Authentification 2FA (TOTP)
- [ ] Rate limiting par utilisateur + IP

### v1.8.0 — IA & Automatisation (❌)

- [ ] Résumé automatique des appels par IA (post-transcription)
- [ ] Détection de sentiment sur les appels transcrits
- [ ] Catégorisation automatique des appels (commercial, support, spam)
- [ ] Suggestions de rappel intelligent
- [ ] Réponse vocale interactive (IVR) pilotée par IA

## Backlog (non planifié)

- [ ] Application mobile (PWA) pour supervision à distance
- [ ] Intégration calendrier (Odoo/Google) : ne pas déranger si en réunion
- [ ] Enregistrement sélectif à la demande depuis le dashboard
- [ ] Intégration SMS (envoi de SMS depuis la fiche contact)
- [ ] Webhook sortant configurable (Zapier, n8n, Make)
- [ ] Thème sombre pour le dashboard