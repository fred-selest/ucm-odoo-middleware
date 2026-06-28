# infrastructure/transcription/ — WhisperService

## WhisperService.js

Transcription des enregistrements d'appels via OpenAI Whisper API ou whisper.cpp local.

## Configuration (env)

| Variable | Défaut | Description |
|----------|--------|-------------|
| `WHISPER_ENABLED` | `false` | Activer la transcription |
| `WHISPER_MODE` | `local` | `local` (whisper.cpp) ou `api` (OpenAI) |
| `WHISPER_MODEL` | `base` | Modèle Whisper |
| `WHISPER_LANGUAGE` | `fr` | Langue de transcription |
| `WHISPER_API_URL` | — | URL API (si mode `api`) |
| `WHISPER_API_KEY` | — | Clé API OpenAI |
| `WHISPER_MAX_DURATION` | `300` | Durée max audio (secondes) |

## Flux de transcription

```
callHistory.insert() → CDR avec recordfiles
    ↓
WhisperService.transcribe(callId, recordingUrl)
    ↓
Téléchargement audio / fetch
    ↓
Transcription (local whisper.cpp ou API OpenAI)
    ↓
Enregistrement dans callHistory.notes (prefix "TRANSCRIPTION:")
```

## Méthodes principales

```javascript
async transcribe(callId, recordingUrl)   // → { text, duration }
async transcribeFromPath(callId, filePath) // → fichier local
isEnabled()                               // → boolean
```

## CdrSyncService integration

Le `CdrSyncService` lance automatiquement la transcription sur les nouveaux CDR :
- Vérifie `WHISPER_ENABLED`
- Skip si fichier déjà transcrit (évite doublon)
- Gère les erreurs silencieusement (transcription = bonus, pas bloquant)