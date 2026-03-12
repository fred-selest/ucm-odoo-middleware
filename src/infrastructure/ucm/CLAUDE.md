# infrastructure/ucm/ — Clients UCM6300

Deux clients actifs : WebSocket (principal) et HTTP (polling/actions).

## UcmWsClient.js — Client principal

Connexion permanente WebSocket au PABX. Source des événements d'appels.

### Protocole d'authentification

```
1. WSS connect → wss://host:8089/websockify
2. → { type:"request", message:{ action:"challenge", username, version:"1" } }
3. ← { type:"response", message:{ challenge:"..." } }
4. → { type:"request", message:{ action:"login", username, token:MD5(challenge+password), url:"" } }
5. ← { type:"response", message:{ status:0 } }   ← PAS de cookie retourné (session implicite)
6. → { action:"subscribe", eventnames:["ExtensionStatus"] }
7. ← événements notify en continu
```

### Keep-alive obligatoire

L'UCM coupe la connexion après ~25s d'inactivité. Le client re-subscribe toutes les **15s** :

```javascript
// heartbeat() — NE PAS supprimer cet intervalle
this._heartbeatTimer = setInterval(() => this._heartbeat(), 15000);
```

### Mapping des statuts UCM → événements Node

| Statut UCM reçu | Événement émis |
|-----------------|----------------|
| `ringing`, `ring` | `call:incoming` |
| `inuse`, `busy`, `answered` | `call:answered` |
| `idle`, `hungup`, `unavailable` | `call:hangup` |

### Champs extraits de l'événement ExtensionStatus

```javascript
callerIdNum:  body.callerid    || body.CallerIDNum || body.from
callerIdName: body.calleridname || body.CallerIDName
exten:        body.extension   || body.Extension   || body.exten
uniqueId:     body.uniqueid    || body.UniqueID     || body.callid
              // Si absent : généré = `ws-${exten}-${Date.now()}`
```

### Reconnexion automatique

Backoff exponentiel : 3s → 6s → 12s … → 60s max (`UCM_RECONNECT_MAX_DELAY`).

## UcmHttpClient.js — Client HTTP/actions

Utilisé pour :
- **Polling de fallback** : `listBridgedChannels()`, `listUnBridgedChannels()` toutes les 3s
- **Click-to-call** : `dialExtension(caller, callee)`, `dialOutbound(caller, outbound)`
- **CDR sync** : `fetchCdr(startTime, endTime)` → API port 8443

### Session HTTP

- Cookie valide **10 minutes**
- `isAuthenticated()` retourne `false` à 9min (1min de marge)
- `request()` re-authentifie automatiquement si session expirée
- **⚠️ Ne pas appeler `isAuthenticated()` avant `_doPoll()`** — laisser `request()` gérer la re-auth

### fetchCdr(startTime, endTime)

```javascript
// Interroge https://UCM_HOST:8443/cdrapi
// Requiert le cookie de session de l'API principale (port 8089)
// Retourne { records: [], total: N }
```

## UcmWebSocketClient.js — DÉPRÉCIÉ

Ne pas utiliser. Remplacé par `UcmWsClient.js`.

## UcmEventParser.js — Protocole AMI (héritage)

Parser pour le protocole Asterisk AMI (texte). Non utilisé en mode WebSocket.
