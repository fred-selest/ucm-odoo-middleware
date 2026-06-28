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

**Patches sécurité/dette/outillage appliqués en 2026-06** (session de maintenance, 13 commits) :

### Sécurité

| Item | Commit |
|------|--------|
| TLS `rejectUnauthorized` (régression SEC_LOG) | `b854907` |
| Rate-limit `/api/auth/login` (tests régression) | `b854907` |
| Sessions bornées (anti-OOM, plafond 10 000) | `eecc26f` |
| SQL injection `updateCallsForPhone` (paramétrisation + batching 500) | `eecc26f` |
| Bug logout 500 trouvé par E2E (`SESSIONS` import path) | `e62121c` |

### Dette

| Item | Commit |
|------|--------|
| Retry auth OdooClient dédupliqué (`_searchReadWithReauth`) | `eecc26f` |
| Dep npm `crypto` inutile supprimée (module natif Node) | `eecc26f` |
| 12 logs DEBUG en `debug` (CallHandler) | `1ef66b6` |
| TTL purge `_activeCalls` (2h, intervalle 10 min, unref) | `1ef66b6` |
| Migrations DB versionnées (table `_migrations`) | `14a6d07` |
| Container DI (god bootstrap 236 → 100 LOC) | `bd7a79f` |

### Outillage & observabilité

| Item | Commit |
|------|--------|
| CI GitHub Actions (lint + tests + syntax check) | `e550ec6` |
| Secret scan gitleaks (barrière pre-merge) | `e550ec6` |
| Prometheus `/metrics` (process + calls + http + sessions) | `fc03506` |
| ESLint 9 + flat config (drop plugin-node obsolète) | `f7471e4` |

### Tests & documentation

| Item | Commit |
|------|--------|
| OdooClient XML-RPC parser + phone variants (20 cas) | `1ef66b6` |
| Tests CrmFactory + Odoo/Dolibarr adapters (28 cas) | `a25c785` |
| Documentation unifiée (README + docs/) | `e64d2e9` |
| Tests E2E stack complet via supertest (20 cas) | `e62121c` |
| `config.test.js` rendu CI-resilient (mock config) | `c592098` |
| `.gitignore` mis à jour (`.bak`, `.bak-*`) | `4c33d81` |

### Bugs découverts par les tests (bonus)

| Bug | Détecté par | Fixé dans |
|-----|-------------|-----------|
| TLS hardcodé `rejectUnauthorized: false` | Audit initial | `b854907` |
| Logout `/api/auth/logout` retourne 500 (`SESSIONS` undefined) | Tests E2E | `e62121c` |

### Stats session

- **Tests** : 78 / 5 suites → **192 / 17 suites** (+114 tests)
- **`src/index.js`** : 236 LOC → 100 LOC (-58%)
- **Bind mounts docker-compose** : 9 → 15 fichiers
- **Couverture CRM** : 0% → Odoo + Dolibarr testés
- **Documentation** : 5 fichiers redondants (930 LOC) → 4 fichiers hiérarchisés (613 LOC)
- **Tag Git** : `session-maintenance-2026-06`

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