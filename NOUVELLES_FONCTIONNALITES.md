# Nouvelles Fonctionnalités - UCM ↔ Odoo Middleware

**Date** : Mars 2026
**Version** : 2.1.0

---

## 📋 Sommaire

1. [Enregistrement d'appels](#1-enregistrement-dappels)
2. [Files d'attente (Call Queues)](#2-files-dattente-call-queues)
3. [Module Odoo léger](#3-module-odoo-léger)
4. [Interface admin améliorée](#4-interface-admin-améliorée)
5. [Correction bug : mise à jour des contacts](#5-correction-bug--mise-à-jour-des-contacts)

---

## 1. Enregistrement d'appels

### Fonctionnalités ajoutées

- ✅ Récupération automatique des enregistrements depuis le UCM6300
- ✅ Association des enregistrements aux appels dans l'historique
- ✅ Lecture audio directement dans l'interface admin
- ✅ Synchronisation des enregistrements vers Odoo
- ✅ API REST pour gérer les enregistrements

### API Endpoints

```bash
# Liste des enregistrements
GET /api/recordings?startTime=2026-03-17&endTime=2026-03-17&limit=50

# Détails d'un enregistrement
GET /api/recordings/:id

# Supprimer un enregistrement
DELETE /api/recordings/:id

# Synchroniser les enregistrements
POST /api/recordings/sync
```

### Configuration UCM6300

Dans le UCM6300, activez l'enregistrement automatique :

1. **Call Features** → **Call Recording**
2. Activez **Enable Call Recording**
3. Configurez les extensions à enregistrer
4. Définissez le mode : `All Calls` ou `External Calls`

### Utilisation dans Odoo

Le module `ucm_connector` ajoute :
- Champ `has_recording` dans le journal des appels
- Bouton "Écouter" pour jouer l'enregistrement
- Lien vers l'enregistrement dans le chatter du contact

---

## 2. Files d'attente (Call Queues)

### Fonctionnalités ajoutées

- ✅ Supervision des files d'attente en temps réel
- ✅ Statistiques des files (temps d'attente, appels en attente, etc.)
- ✅ Gestion des agents par file
- ✅ API pour ajouter/retirer des agents

### API Endpoints

```bash
# Liste des files
GET /api/queues

# Détails d'une file
GET /api/queues/:id

# Statistiques globales
GET /api/queues/stats/summary

# Ajouter un agent
POST /api/queues/:id/agents
{
  "extension": "1001"
}

# Retirer un agent
DELETE /api/queues/:id/agents/:extension

# Mettre en pause un agent
POST /api/queues/:id/agents/:extension/pause
{
  "pause": true
}
```

### Modèle de données (Odoo)

```python
class UcmQueue(models.Model):
    _name = 'ucm.queue'
    
    name = fields.Char(string='Nom')
    queue_number = fields.Char(string='Numéro file')
    agent_ids = fields.Many2many('res.users', string='Agents')
    active_calls = fields.Integer(string='Appels en cours')
    waiting_calls = fields.Integer(string='Appels en attente')
    avg_wait_time = fields.Integer(string='Temps attente moyen')
```

---

## 3. Module Odoo léger

### Installation

1. Copiez le dossier `odoo_addons/ucm_connector` dans votre répertoire Odoo
2. Ajoutez le chemin dans `odoo.conf` :
   ```ini
   addons_path = /path/to/odoo/addons,/path/to/ucm_connector
   ```
3. Redémarrez Odoo
4. Installez le module **UCM Connector - Grandstream CTI**

### Configuration

1. Allez dans **Téléphonie UCM** → **Configuration** → **Connecteur**
2. Renseignez :
   - URL du middleware : `http://localhost:3000`
   - Clé API (si configurée)
3. Cliquez sur **Tester connexion**
4. Enregistrez

### Fonctionnalités du module Odoo

#### Journal des appels
- Vue complète des appels avec filtres
- Recherche par numéro, contact, agent
- Statuts colorés (décroché, manqué, etc.)
- Intégration des enregistrements audio

#### Statuts des agents
- Supervision en temps réel
- Statuts : Disponible, En appel, Occupé, Pause, Hors ligne
- Statistiques individuelles (appels du jour, durée)

#### Files d'attente
- Supervision des files
- Agents par file
- Statistiques (temps d'attente, appels abandonnés)

#### Click-to-call
- Bouton d'appel sur les fiches contacts
- Appel depuis n'importe quel numéro de téléphone
- Association automatique de l'appel au contact

#### Intégration Chatter
- Journal automatique des appels dans le chatter
- Informations : direction, durée, statut, enregistrement
- Historique complet par contact

### Webhooks Odoo → Middleware

Quand un contact est modifié dans Odoo :

```python
# Dans res.partner, après modification
def write(self, vals):
    result = super().write(vals)
    if 'phone' in vals or 'mobile' in vals:
        # Notifier le middleware
        requests.post(
            f"{middleware_url}/api/contacts/sync-partner",
            json={
                'partner_id': self.id,
                'phone': vals.get('phone'),
                'mobile': vals.get('mobile')
            }
        )
    return result
```

---

## 4. Interface admin améliorée

### Nouveau dashboard temps réel

**Statistiques du jour :**
- Total appels
- Appels décrochés / manqués
- Taux de réponse (%)
- Durée moyenne / totale
- Graphique horaire

**Supervision des agents :**
- Liste des agents avec statut
- Nombre d'appels du jour
- Durée totale

**Files d'attente :**
- Nombre de files actives
- Appels en attente
- Temps d'attente moyen
- Agents par file

**Appels récents :**
- 10 derniers appels terminés
- Durée et contact
- Direction (entrant/sortant)

**Enregistrements :**
- Lecteur audio intégré
- Liste des derniers enregistrements
- Association aux contacts

### Technologies utilisées

- **Chart.js** : Graphiques interactifs
- **WebSocket** : Mises à jour temps réel
- **Bootstrap 5** : Interface responsive
- **Bootstrap Icons** : Icônes modernes

### Rafraîchissement automatique

- Stats : 30 secondes
- WebSocket : temps réel
- Reconnexion auto en cas de déconnexion

---

## 5. Correction bug : mise à jour des contacts

### Problème résolu

**Avant :** Quand une fiche contact était modifiée dans Odoo (changement de nom, email, etc.), l'historique des appels n'était pas mis à jour.

**Solution :** Nouveau service de synchronisation `ContactSyncService`

### Fonctionnement

1. **Modification dans Odoo** → Webhook vers middleware
2. **Middleware** :
   - Récupère le contact mis à jour
   - Met à jour TOUS les appels pour ce numéro
   - Met à jour le cache
3. **Résultat** : L'historique est toujours synchronisé

### API Endpoint

```bash
POST /api/contacts/sync-partner
{
  "partner_id": 123,
  "phone": "+33123456789",
  "mobile": "+33612345678"
}
```

### Réponse

```json
{
  "ok": true,
  "updated": 15,
  "contact": {
    "id": 123,
    "name": "Jean Dupont",
    "phone": "+33123456789",
    "email": "jean@exemple.com"
  }
}
```

---

## 📊 Résumé des fichiers créés/modifiés

### Middleware (Node.js)

```
src/
├── application/
│   └── ContactSyncService.js        # NOUVEAU
├── infrastructure/
│   ├── database/
│   │   ├── CallHistory.js           # MODIFIÉ (+updateCallsForPhone)
│   │   └── schema.sql               # MODIFIÉ (+contact_cache)
│   └── ucm/
│       └── UcmHttpClient.js         # MODIFIÉ (+recordings, queues)
└── presentation/
    └── api/
        ├── router.js                # MODIFIÉ (+routes stats, contacts)
        ├── recordings.routes.js     # NOUVEAU
        └── queues.routes.js         # NOUVEAU
```

### Module Odoo (Python)

```
ucm_connector/
├── __manifest__.py
├── __init__.py
├── models/
│   ├── __init__.py
│   ├── ucm_call_log.py              # Journal des appels
│   ├── ucm_call_tag.py              # Tags
│   ├── ucm_agent_status.py          # Statuts agents
│   ├── ucm_queue.py                 # Files d'attente
│   ├── ucm_connector.py             # Configuration
│   ├── res_partner.py               # Extension contact
│   └── res_users.py                 # Extension utilisateur
├── wizard/
│   ├── __init__.py
│   └── configure_wizard.py          # Assistant config
├── views/
│   ├── ucm_call_log_views.xml
│   ├── ucm_agent_status_views.xml
│   ├── ucm_queue_views.xml
│   ├── res_partner_views.xml
│   ├── res_users_views.xml
│   └── ucm_connector_views.xml
├── data/
│   └── ucm_connector_data.xml       # Données par défaut
├── security/
│   └── ir.model.access.csv          # Permissions
└── static/
    ├── src/
    │   ├── js/ucm_call_popup.js     # Popup appel
    │   ├── xml/ucm_call_popup.xml
    │   └── scss/ucm_call_popup.scss
    └── description/
        └── icon.png
```

---

## 🚀 Déploiement

### 1. Redémarrer le middleware

```bash
cd /opt/stacks/ucm-odoo-middleware
docker-compose restart
```

### 2. Installer le module Odoo

```bash
# Dans Odoo
Apps → "UCM Connector" → Installer
```

### 3. Configurer

1. Middleware : http://localhost:3000/admin
2. Odoo : Téléphonie UCM → Configuration

---

## 📞 Support

Pour toute question ou problème :
- Vérifiez les logs : `docker logs -f ucm_odoo_middleware`
- Consultez la documentation API : http://localhost:3000/api-docs
- Interface admin : http://localhost:3000/admin

---

*Développé par Selest Informatique - Mars 2026*
