# Fonctionnalites & DevOps - UCM <-> Odoo Middleware

Ce document decrit les nouvelles fonctionnalites et ameliorations DevOps ajoutees au middleware.

## Nouvelles Fonctionnalites

### Historique des Appels
- **Stockage persistant** : Tous les appels sont sauvegardes en SQLite
- **Recherche avancee** : Par date, statut, extension, numero
- **Filtres** : Appels manques, repondus, echoues
- **Notes** : Ajouter des notes sur chaque appel

### Statistiques
- **Tableau de bord** : Vue d'ensemble des appels (aujourd'hui, hier, semaine, mois)
- **Stats par extension** : Performance des agents
- **Distribution horaire** : Heures de pointe
- **Top appelants** : Numeros les plus frequents
- **Taux de reponse** : Pourcentage d'appels decroches

### Blacklist
- **Bloquer des numeros** : Spam, harcelement
- **Gestion via API** : Ajouter/retirer des numeros
- **Expiration automatique** : Duree configurable
- **Verification temps reel** : Les appels bloques sont ignores

### Documentation API
- **Swagger UI** : Accessible sur `/api-docs`
- **Specification OpenAPI** : Telechargeable en JSON
- **Endpoints documentes** : Authentification, appels, stats, blacklist

### Recherche de Contacts
- **Par numero** : Recherche automatique lors des appels entrants
- **Par nom/societe** : Recherche manuelle via API
- **Multi-criteres** : Recherche dans nom ET societe parente
- **Resultats enrichis** : Phone, mobile, email, fonction, adresse

## DevOps

### CI/CD GitHub Actions

#### Workflow Principal (`ci-cd.yml`)
- **Tests** : Lint + tests automatiques
- **Build** : Image Docker multi-arch (amd64/arm64)
- **Security** : Scan Trivy des vulnerabilites
- **Deploy** : Deploiement automatique sur main/tags

#### Workflow Cleanup (`cleanup.yml`)
- **Nettoyage images** : Suppression des images obsoletes
- **Nettoyage donnees** : Archivage des anciens appels
- **Execution** : Tous les dimanches a 2h

### Docker Multi-Stage

```
+-------------+     +-------------+     +-------------+
|   Builder   | --> |    Deps     | --> |   Runtime   |
+-------------+     +-------------+     +-------------+
  Build tools          Prod deps        Image finale
  (python, make)      (optimisees)      (securisee)
```

**Stages** :
1. **builder** : Compilation des modules natifs (sqlite3)
2. **deps** : Dependances de production uniquement
3. **runtime** : Image finale minimale et securisee
4. **development** : Hot-reload avec nodemon

### Docker Compose

#### Production
```bash
docker-compose up -d
```

#### Developpement
```bash
docker-compose -f docker-compose.yml -f docker-compose.override.yml up -d
# ou simplement
docker-compose up -d  # utilise automatiquement override.yml
```

### Scripts NPM

```bash
# Build images
npm run build         # Image production
npm run build:dev     # Image developpement

# Maintenance
npm run cleanup       # Nettoyer anciens appels
npm run db:migrate    # Initialiser la base de donnees
```

## Structure des Nouveaux Fichiers

```
src/
├── infrastructure/
│   └── database/
│       ├── schema.sql          # Schema SQLite
│       ├── Database.js         # Connexion DB
│       └── CallHistory.js      # Service historique
├── config/
│   └── swagger.js              # Configuration Swagger
└── presentation/
    └── api/
        └── router.js           # Routes API (mis a jour)

.github/
└── workflows/
    ├── ci-cd.yml               # CI/CD principal
    └── cleanup.yml             # Nettoyage

docker-compose.override.yml     # Config developpement
Dockerfile                      # Multi-stage (mis a jour)
```

## Nouveaux Endpoints API

### Historique
```
GET  /api/calls/history          # Liste paginee
GET  /api/calls/history/:id      # Detail appel
GET  /api/calls/missed           # Appels manques
POST /api/calls/:id/notes        # Ajouter note
```

### Statistiques
```
GET /api/stats                   # Stats globales
GET /api/stats/extensions        # Par extension
GET /api/stats/hourly            # Distribution horaire
GET /api/stats/top-callers       # Top appelants
```

### Blacklist
```
GET    /api/blacklist            # Liste bloques
POST   /api/blacklist            # Ajouter numero
DELETE /api/blacklist/:phone     # Retirer numero
GET    /api/blacklist/check/:phone # Verifier
```

### Documentation
```
GET /api-docs                    # Interface Swagger
GET /api-docs.json               # Spec OpenAPI
```

### Recherche Contacts Odoo
```
GET /api/odoo/search?q={nom}     # Recherche par nom/societe
POST /api/odoo/test              # Test connexion/recherche par phone
```

## Migration

1. **Installer les nouvelles dependances** :
   ```bash
   npm install
   ```

2. **Rebuild l'image Docker** :
   ```bash
   npm run build
   ```

3. **Redemarrer le service** :
   ```bash
   docker-compose up -d
   ```

4. **Verifier la base de donnees** :
   ```bash
   npm run db:migrate
   ```

## Securite

- **Non-root** : L'application tourne avec l'utilisateur `node`
- **Distroless-like** : Image Alpine minimale
- **Scan vulnerabilites** : Trivy dans le CI
- **Healthcheck** : Surveillance du service
- **Secrets** : Variables d'environnement uniquement

## Monitoring

Le middleware expose les metriques suivantes :
- Nombre d'appels actifs
- Taux de reponse
- Duree moyenne des appels
- Top appelants
- Distribution horaire

Accedez-y via l'interface d'administration ou les endpoints API.
