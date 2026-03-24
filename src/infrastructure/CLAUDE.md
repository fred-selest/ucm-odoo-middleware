# infrastructure/ — Couche infrastructure

Accès aux systèmes externes et persistance. Chaque sous-répertoire est indépendant.

## Sous-répertoires

| Dossier | Rôle |
|---------|------|
| `ucm/` | Clients de communication avec le PABX UCM6300 |
| `odoo/` | Client XML-RPC Odoo — **⚠️ variables critiques, voir CLAUDE.md dédié** |
| `websocket/` | Serveur WebSocket pour les clients navigateur |
| `database/` | SQLite — historique appels, agents, blacklist |
| `monitoring/` | HealthAgent — supervision périodique |
| `lookup/` | Services d'enrichissement et vérification : SIRENE, Annuaire, Google Places, Tellows spam |

## Règle générale

Les classes infrastructure **n'ont pas connaissance** les unes des autres. Elles sont assemblées dans `src/index.js` et injectées dans `CallHandler` et `router.js`.
