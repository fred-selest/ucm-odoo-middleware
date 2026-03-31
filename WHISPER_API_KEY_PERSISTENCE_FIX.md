# 🔧 Correction : Persistance de la clé API Whisper/Groq

## Problème

La clé API Whisper (Groq ou OpenAI) était perdue à chaque redémarrage du conteneur.

## Cause

Le chargement de la configuration lisait **`.env` en premier**, écrasant la configuration sauvegardée dans `data/config.json`.

## Solution appliquée

### 1. Priorité à `config.json` pour la persistance

**Fichier :** `src/config/index.js`

La configuration Whisper charge maintenant les valeurs depuis `config.json` (overrides) en premier, avec `.env` comme fallback :

```javascript
whisper: {
  // Priorité à ov.whisper (config.json) pour persistance
  apiKey:   ov.whisper?.apiKey   ?? process.env.WHISPER_API_KEY  ?? '',
  apiUrl:   ov.whisper?.apiUrl   ?? process.env.WHISPER_API_URL  ?? '...',
  mode:     ov.whisper?.mode     ?? process.env.WHISPER_MODE     ?? 'local',
  // ...
}
```

### 2. Sauvegarde correcte des clés API vides

**Fichier :** `src/config/index.js`

La fonction `updateEnvVar` sauvegarde maintenant la clé API même si elle est vide (pour permettre la suppression) :

```javascript
// Avant
if (overrides.whisper.apiKey) {  // ❌ Faux si apiKey = ''
  updateEnvVar('WHISPER_API_KEY', overrides.whisper.apiKey, ...);
}

// Après
if ('apiKey' in overrides.whisper) {  // ✅ Vérifie l'existence
  updateEnvVar('WHISPER_API_KEY', overrides.whisper.apiKey, ...);
}
```

## Comment tester

### 1. Définir la clé API via l'interface admin

1. Connectez-vous à l'interface admin UCM
2. Allez dans **Configuration** → **Whisper**
3. Sélectionnez **Mode API**
4. Choisissez **Groq** ou **OpenAI**
5. Entrez votre clé API
6. Cliquez sur **Sauvegarder**

### 2. Vérifier la persistance

```bash
# Vérifier que config.json contient la clé
cat /opt/stacks/ucm-odoo-middleware/data/config.json

# Vérifier que .env contient la clé
grep WHISPER_API_KEY /opt/stacks/ucm-odoo-middleware/.env
```

### 3. Redémarrer et vérifier

```bash
# Redémarrer le conteneur
cd /opt/stacks/ucm-odoo-middleware
docker compose restart

# Vérifier que la configuration est toujours là
docker logs ucm_odoo_middleware | grep -i whisper
```

## Fichiers modifiés

| Fichier | Modification |
|---------|-------------|
| `src/config/index.js` | Priorité à `config.json` pour Whisper |
| `src/config/index.js` | Sauvegarde des clés API vides |

## Architecture de persistance

```
┌─────────────────────────────────────────────────────────────┐
│  Hôte (Host)                                                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ .env (variables d'environnement)                     │   │
│  │ - Lu par docker-compose au démarrage                 │   │
│  │ - Mis à jour par saveOverrides()                     │   │
│  └──────────────────────────────────────────────────────┘   │
│                            ↓                                 │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ data/config.json (overrides)                         │   │
│  │ - Volume Docker monté dans ./data:/app/data          │   │
│  │ - Contient les configurations sensibles (API keys)   │   │
│  │ - Lu en premier par loadOverrides()                  │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Conteneur Docker                                           │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ /app/data/config.json                                │   │
│  │ - Même fichier que data/config.json de l'hôte        │   │
│  │ - Persiste entre les redémarrages                    │   │
│  └──────────────────────────────────────────────────────┘   │
│                            ↓                                 │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ config = { ... }                                     │   │
│  │ - Charge ov (overrides) en premier                   │   │
│  │ - Fallback sur process.env                           │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Ordre de priorité des configurations

1. **`data/config.json`** (overrides) - **PRIORITAIRE** ✅
2. **`.env`** (variables d'environnement) - Fallback
3. **Valeurs par défaut** - Dernier recours

## Clés API concernées

Cette correction s'applique à :

- ✅ **Whisper API** (`WHISPER_API_KEY`)
- ✅ **Odoo API** (`ODOO_API_KEY`) - déjà correct
- ✅ **Dolibarr API** (`DOLIBARR_API_KEY`) - déjà correct
- ✅ **SIRENE INSEE** (`INSEE_SIRENE_API_KEY`) - via .env uniquement
- ✅ **Google Places** (`GOOGLE_PLACES_API_KEY`) - via .env uniquement

## Notes de sécurité

⚠️ **Ne jamais committer `data/config.json`** dans Git - il contient des clés API sensibles.

Le fichier `.gitignore` devrait inclure :
```
data/config.json
.env
```

## Déploiement

Après cette correction, reconstruisez le conteneur :

```bash
cd /opt/stacks/ucm-odoo-middleware
docker compose build --no-cache
docker compose up -d
```
