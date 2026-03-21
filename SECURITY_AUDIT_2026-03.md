# AUDIT DE SÉCURITÉ ET D'OPTIMISATION
## UCM ↔ Odoo Middleware
**Date**: 21 mars 2026  
**Audit par**: opencode  

---

## SCORES GLOBAL

| Catégorie | Score | Weight | Commentaire |
|-----------|-------|--------|-------------|
| 🔐 **Sécurité** | **4.5 / 10** | 40% | Problèmes critiques sur secrets, TLS |
| ⚡ **Optimisation** | **5.5 / 10** | 40% | N+1 queries, timers leaks |
| 📊 **Qualité code** | **7 / 10** | 20% | 0 errors, 595 warnings |
| **TOTAL** | **5.7 / 10** | 100% | 🔴 Attention nécessaire |

---

## 🚨 PROBLÈMES CRITIQUES (3)

### 1. Secrets en clair dans `.env`
- **Fichier**: `.env` (lignes 9, 26)
- **Problème**: 
  - `UCM_API_PASS=FtCQS3Zt2jqes1` 
  - `ODOO_API_KEY=f0b18bc8cd6ef0dc17a7098b6226155273d3b09a`
  - `API_SECRET_KEY=change_me_in_production`
- **Recommandation**: Utiliser Docker secrets ou Vault

### 2. Permissions fichier `.env` trop permissives
- **Fichier**: `.env` (mode 664)
- **Recommandation**: `chmod 600 .env`

### 3. TLS non stricte
- **Fichier**: `src/infrastructure/ucm/UcmHttpClient.js:33-35`
- **Problème**: `UCM_TLS_REJECT_UNAUTHORIZED=false`
- **Recommandation**: Activer TLS strict

---

## 🟠 PROBLÈMES HIGH PRIORITY (10)

### 4. Aucune validation d'entrée
- **Fichiers**: `router.js`, `WebhookManager.js`
- **Recommandation**: Ajouter `express-validator`

### 5. No rate limiting
- **Impact**: DDoS possible
- **Recommandation**: `express-rate-limit` (100 req/15min)

### 6. CORS non configuré
- **Recommandation**: `cors` middleware avec whitelist

### 7. Sessions non HMAC signées
- **Fichier**: `router.js:26-37`
- **Recommandation**: HMAC-SHA256 signing

### 8. Logs sensibles
- **Fichier**: `UcmHttpClient.js:90,104`
- **Recommandation**: Ne pas logger de tokens

### 9. Webhooks non sécurisés
- **Fichier**: `WebhookManager.js:59-60`
- **Recommandation**: Timestamp + IP whitelist

### 10. N+1 queries
- **Fichier**: `CallHistory.js:689-700`
- **Impact**: 213 appels × 1 query
- **Recommandation**: Bulk UPDATE WHERE IN

### 11. Timer leaks
- **Fichiers**: `CallHandler.js:313-320`, `UcmWsClient.js:86,101`
- **Recommandation**: Clear all timers dans `disconnect()`

### 12. No connection pooling
- **Fichiers**: `UcmHttpClient.js`, `OdooClient.js`
- **Recommandation**: Agent keep-alive avec maxSockets:50

### 13. SQLite sans index
- **Fichier**: `schema.sql`
- **Recommandation**: Composite indexes sur `contact_id`, `caller_id_num`

---

## 📋 PLAN D'ACTION RAPIDE

### IMMÉDIAT (0-7 jours) - **CRITIQUE**
1. ✅ Changer les secrets par défaut
2. ✅ `chmod 600 .env`
3. ✅ Activer TLS strict
4. ✅ Ajouter rate limiting
5. ✅ Ajouter validation d'entrée

### COURT-TERM (1-4 semaines) - **HIGH**
6. Optimiser requêtes N+1
7. Fix timers leaks
8.Ajouter health thresholds
9. Activer compression

### MOYEN-TERM (1-3 mois) - **MEDIUM**
10. Mettre à jour dépendances
11. Setup CI/CD security scan
12. Implement backup strategy

---

## 📊 DÉTAIL DES PROBLÈMES

### Sécurité (12 issues)
- 🔴 CRITIQUE: 3 (secrets, TLS, permissions)
- 🟠 HIGH: 5 (validation, rate limit, CORS, sessions, webhooks)
- 🟡 MEDIUM: 4 (logging, static files, try-catch, outdated deps)

### Optimisation (17 issues)
- 🔴 CRITIQUE: 2 (N+1 queries, cache TTL)
- 🟠 HIGH: 5 (timers, WebSocket timers, blocking ops, SQLite, memory buffer)
- 🟡 MEDIUM: 4 (file I/O, cache pattern, sync crypto, connection pooling)
- 🟢 LOW: 4 (missing indexes, size, health monitoring, gzip)

---

## ✅ POSITIVES

- ✅ Node.js 20+ (Docker)
- ✅ 0 syntax errors
- ✅ Async/await correctement utilisé
- ✅ Winston logger configuré
- ✅ Health monitoring actif
- ✅ All cleanup toggle

---

## 📄 FICHIERS CIBLES

| Fichier | Sécurité | Optimisation | Statut |
|---------|----------|--------------|--------|
| `.env` | 🔴 3 | 🟢 0 | ⚠️ Prioritaire |
| `router.js` | 🟠 3 | 🟠 2 | ⚠️ Prioritaire |
| `UcmHttpClient.js` | 🟡 1 | 🟠 1 | ⚠️ Prioritaire |
| `CallHistory.js` | 🟢 0 | 🟠 1 | ⚠️ Prioritaire |
| `UcmWsClient.js` | 🟢 0 | 🔴 2 | ⚠️ Prioritaire |
| `OdooClient.js` | 🟢 0 | 🟠 2 | ⚠️ Prioritaire |
| `index.js` | 🟢 0 | 🟢 0 | ✅ OK |

---

## 🎯 RECOMMANDATION FINALE

**L'installation est FONCTIONNELLE mais PAS硫вшие (secure)**.

### Actions obligatoires avant production:
1. **Changer tous les secrets par défaut**
2. **Activer TLS strict**  
3. **Ajouter rate limiting**
4. **Fix permissions `.env`**

### Actions recommandées:
5. Ajouter validation d'entrée
6. Configurer CORS
7. Signer sessions HMAC
8. Optimiser N+1 queries
9. Fix timer leaks
10. Add SQLite indexes

### Temps estimé pour immaturation:
- **Critical fixes**: 2-3 heures
- **All HIGH priority**: 8-12 heures
- **Full audit follow-up**: 20-30 heures

---

*Audit complet: refer to `/opt/stacks/ucm-odoo-middleware/lint-analysis.md`*
