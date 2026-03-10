'use strict';

const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'UCM ↔ Odoo Middleware API',
      version: '1.1.0',
      description: `
API pour le middleware de CTI entre Grandstream UCM et Odoo.

## Fonctionnalités
- Gestion des événements d'appels téléphoniques
- Recherche de contacts Odoo
- WebSocket temps réel pour les agents
- Historique des appels et statistiques
- Gestion des blacklists

## Authentification
L'API utilise des tokens de session pour l'authentification.
Obtenez un token via "/api/auth/login" et incluez-le dans le header :
\`\`\`
X-Session-Token: votre-token
\`\`\`
      `,
      contact: {
        name: 'Support',
        email: 'support@example.com'
      }
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Serveur local'
      }
    ],
    tags: [
      { name: 'Authentification', description: 'Gestion des sessions' },
      { name: 'Appels', description: 'Gestion des appels téléphoniques' },
      { name: 'Historique', description: 'Historique des appels' },
      { name: 'Statistiques', description: 'Statistiques et analytics' },
      { name: 'Blacklist', description: 'Gestion des numéros bloqués' },
      { name: 'Configuration', description: 'Configuration UCM et Odoo' },
      { name: 'Webhooks', description: 'Gestion des tokens webhook' },
      { name: 'Monitoring', description: 'Health checks et logs' },
      { name: 'Contacts', description: 'Recherche de contacts Odoo' }
    ]
  },
  apis: ['./src/presentation/api/*.js', './src/**/*.js']
};

module.exports = swaggerJsdoc(options);
