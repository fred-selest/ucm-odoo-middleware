# infrastructure/websocket/ — Serveur WebSocket navigateur

## WsServer.js

Serveur WebSocket (`/ws`) pour les clients navigateur (interface admin).

### Protocole client → serveur

```javascript
// S'abonner à une extension
{ type: 'subscribe', extension: '101' }

// S'abonner à toutes les extensions
{ type: 'subscribe', extension: '*' }

// Se désabonner
{ type: 'unsubscribe', extension: '101' }

// Ping
{ type: 'ping' }
```

### Protocole serveur → client

```javascript
// Connexion établie
{ type: 'connected', clientId: '...', timestamp: '...' }

// Pong
{ type: 'pong', ts: 1234567890 }

// Événements d'appels (poussés par CallHandler)
{ type: 'call:incoming', data: { uniqueId, callerIdNum, callerIdName, exten, contact, direction, timestamp } }
{ type: 'call:answered', data: { uniqueId, exten, answeredAt, ... } }
{ type: 'call:hangup',   data: { uniqueId, exten, duration, hungUpAt, ... } }
{ type: 'contact',       data: { uniqueId, contact: { id, name, phone, email, company, avatar, odooUrl } } }

// Autres
{ type: 'agent:status_changed', data: { exten, status, timestamp } }
{ type: 'call:outbound',        data: { uniqueId, callerIdNum, exten, direction } }
```

### Méthodes principales

```javascript
// Notifie les clients abonnés à une extension (ou '*')
wsServer.notifyExtension(exten, 'call:incoming', callData)

// Broadcast à tous les clients
wsServer.broadcast('agent:status_changed', { exten, status })
```

### État interne

- `_clients` : Map `clientId → { ws, extensions: Set<string> }`
- Ping heartbeat : toutes les **30s** — clients sans pong en 10s déconnectés
- Reconnexion côté navigateur : automatique après 3s (dans `websocket.js`)
