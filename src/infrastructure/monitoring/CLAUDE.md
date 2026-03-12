# infrastructure/monitoring/ — HealthAgent

## HealthAgent.js

Supervision périodique (toutes les **30 secondes**) de tous les services.

### Vérifications

| Service | Méthode | Statut OK |
|---------|---------|-----------|
| UCM HTTP | `ucmHttpClient.authenticated` (getter) | `'connected'` |
| UCM WebSocket | `ucmWsClient.isConnected` (getter) | `'connected'` |
| Odoo | `odooClient.authenticate()` | `'connected'` |
| SQLite | `callHistory.getTodayCount()` | `'healthy'` |
| WS navigateur | `wsServer.getClientCount() > 0` | `'connected'` |

### Warning "Aucun appel"

Le warning `HealthAgent: Aucun appel depuis ...` est déclenché si aucun appel n'a été enregistré en base depuis plus de **2 heures**. C'est normal en dehors des heures de bureau.

### État exposé

```javascript
healthAgent.getStatus() → {
  ucmHttp: 'connected'|'disconnected',
  ucmWebSocket: 'connected'|'disconnected',
  odoo: 'connected'|'error',
  database: 'healthy'|'error',
  websocket: 'connected'|'disconnected',
  lastCallAt: '2026-03-12 17:12:33',  // depuis SQLite
  callsToday: 108,
  uptime: 3600.5,
  timestamp: '...',
  consecutiveFailures: 0,
  alerted: false
}
```

Accessible via `GET /api/health/status` (authentifié) et `GET /health` (public).

### Alertes

Après 3 vérifications consécutives en échec : log niveau `error` avec détail des services dégradés.
