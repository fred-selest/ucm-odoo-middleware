# Configuration Multi-Sites UCM

## Problématique VPN

**Situation actuelle** :
- UCM6300 accessible via VPN : `192.168.10.100:8089`
- Si VPN coupé → Plus de connexion HTTP/WS
- Click-to-call et appels entrants ne fonctionnent plus

**Reconnexion automatique existante** :
- ✅ HTTP API : Re-authentification auto (cookie 10 min)
- ✅ WebSocket : Reconnexion avec backoff (3s → 60s)
- ❌ Mais si VPN HS → Échec des connexions

---

## Solutions

### 1️⃣ Exposition HTTPS (Recommandée)

**Principe** : Rendre l'UCM accessible via Internet de façon sécurisée

**Configuration UCM6300** :
```
Integrations → API Configuration → HTTPS Settings
- Enable Remote Access: ON
- HTTPS Port: 8089 (interne) → 18089 (externe, NAT)
- IP Whitelist: <IP publique du middleware>
```

**Modification `.env`** :
```bash
# Avant (VPN)
UCM_HOST=192.168.10.100
UCM_WEB_PORT=8089

# Après (Internet)
UCM_HOST=ucm-site1.selest.info    # DNS public
UCM_WEB_PORT=18089                # Port NATé
UCM_TLS_REJECT_UNAUTHORIZED=false # Si certificat auto-signé
```

**Sécurité** :
- ✅ Whitelist IP middleware uniquement
- ✅ HTTPS obligatoire (pas de HTTP)
- ✅ Password API fort (min 16 caractères)
- ✅ Fail2ban sur l'UCM (5 échecs → ban 1h)

---

### 2️⃣ Tunnel SSH Inversé

**Principe** : Le site distant initie le tunnel vers le middleware

**Sur le serveur middleware** :
```bash
# Tunnel permanent
autossh -M 0 -N \
  -R 18089:localhost:8089 \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  user@ucm-site1.selest.info
```

**Configuration `.env`** :
```bash
UCM_HOST=localhost
UCM_WEB_PORT=18089
```

**Avantages** :
- ✅ Pas d'ouverture de port sur l'UCM
- ✅ Tunnel chiffré
- ✅ Reconnexion automatique (autossh)

**Inconvénients** :
- ⚠️ Nécessite SSH sur le site distant
- ⚠️ Un tunnel par site UCM

---

### 3️⃣ Mode Webhook (Fallback)

**Principe** : L'UCM pousse les événements au middleware (pas de WebSocket)

**Configuration UCM6300** :
```
Integrations → Webhook Configuration
- Enable Webhook: ON
- Call Events: Ring, Answer, Hangup
- URL: https://middleware.selest.info/webhook/TOKEN_UCM1
```

**Modification code** (à implémenter) :
```javascript
// router.js
if (!ucmHttpClient.authenticated) {
  logger.warn('UCM non joignable, mode webhook activé');
  // Accepter uniquement les webhooks entrants
}
```

**Avantages** :
- ✅ Fonctionne sans connexion sortante
- ✅ L'UCM initie la connexion

**Inconvénients** :
- ⚠️ Click-to-call ne fonctionne pas
- ⚠️ Nécessite IP publique ou DNS dynamique

---

### 4️⃣ Architecture Multi-Sites

**Principe** : Un middleware par site, centralisation Odoo

```
┌─────────────────┐     ┌─────────────────┐
│ Middleware S1   │     │ Middleware S2   │
│ 192.168.10.x    │     │ 192.168.20.x    │
│ UCM: 10.100     │     │ UCM: 20.50      │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     │
              ┌──────▼───────┐
              │   Odoo SaaS  │
              │   (central)  │
              └──────────────┘
```

**Avantages** :
- ✅ Chaque middleware est proche de son UCM (LAN)
- ✅ Pas de VPN requis
- ✅ Résilient (panne site n'affecte pas l'autre)

**Inconvénients** :
- ⚠️ Coût infrastructure (1 VPS par site)
- ⚠️ Maintenance multipliée

---

## 📋 Procédure : Passage en HTTPS Direct

### 1. Préparer l'UCM6300

```
1. Integrations → API Configuration
2. Enable API: ON
3. HTTPS Port: 8089
4. Enable Remote Access: ON
5. Remote HTTPS Port: 18089
6. IP Whitelist: <IP publique middleware>
7. Username: fred_admin
8. Password: <nouveau password fort>
```

### 2. Configurer le NAT/Routeur

```
Port externe 18089 → 192.168.10.100:8089 (TCP)
```

### 3. Tester depuis l'extérieur

```bash
# Depuis un mobile (4G/5G) ou autre site
curl -sk "https://<IP-publique>:18089/api" \
  -H "Content-Type: application/json" \
  -d '{"request":{"action":"challenge","user":"fred_admin","version":"1.0"}}'
```

### 4. Mettre à jour le middleware

```bash
# Éditer .env
nano /opt/stacks/ucm-odoo-middleware/.env

# Modifier
UCM_HOST=<IP-publique-ou-DNS>
UCM_WEB_PORT=18089
UCM_API_PASS=<nouveau-password>

# Redémarrer
docker restart ucm_odoo_middleware

# Vérifier
docker logs -f ucm_odoo_middleware | grep "UCM HTTP"
```

---

## 🔒 Checklist Sécurité

- [ ] Password API changé (min 16 caractères)
- [ ] IP whitelist restreinte au middleware
- [ ] HTTPS uniquement (pas de HTTP)
- [ ] Firewall routeur : port 18089 ouvert
- [ ] Fail2ban activé sur l'UCM
- [ ] Logs surveillés (tentatives échouées)
- [ ] Certificat SSL valide (ou auto-signé accepté)

---

## 🎯 Recommandation

**Pour votre cas** (1 site avec VPN) :

1. **Court terme** : Garder VPN + reconnexion auto
   - Le middleware retente toutes les 3-60s
   - Reprise automatique quand VPN revient

2. **Moyen terme** : Exposition HTTPS sécurisée
   - DNS : `ucm.selest.info:18089`
   - IP whitelist : middleware uniquement
   - Password fort

3. **Long terme** : Multi-sites si expansion
   - 1 middleware par site
   - Centralisation Odoo

---

*Document généré le 11 Mars 2026*
