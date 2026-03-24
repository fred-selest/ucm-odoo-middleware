# lookup/ — Services d'enrichissement et vérification

Services externes pour compléter les fiches contacts et filtrer le spam.

## Services

| Fichier | Source | Clé API | Rôle |
|---------|--------|---------|------|
| `SireneService.js` | INSEE SIRENE v3.11 | Oui (`SIRENE_API_KEY`) | SIRET, TVA, adresse, forme juridique |
| `AnnuaireService.js` | Annuaire Entreprises (data.gouv.fr) | Non (gratuit) | Fallback SIRENE, résout les EI par nom commercial |
| `GooglePlacesService.js` | Google Places API (New) | Oui (`GOOGLE_PLACES_API_KEY`) | Téléphone, site web, note Google |
| `SpamScoreService.js` | Tellows (communautaire) | Non (gratuit) | Score spam 1-9, type d'appelant, auto-blocage |

## Cascade d'enrichissement

1. **SIRENE INSEE** — recherche par SIRET/SIREN/nom → SIRET, TVA, adresse
2. **Annuaire Entreprises** — fallback si SIRENE ne trouve rien (entreprises individuelles)
3. **Google Places** — complète avec téléphone et site web si manquants

## Vérification spam (flux appel entrant)

1. Blacklist locale vérifiée en premier (numéros exacts + préfixes `0162*`)
2. Si pas blacklisté → Tellows score en temps réel
3. Score >= 7 → auto-ajout blacklist + log

## Cache

Tous les services ont un cache LRU en mémoire :

- SIRENE/Annuaire : 5 min TTL (données qui peuvent changer)
- Google Places : 24h TTL (données stables)
- Tellows : 1h TTL (scores évoluent avec les signalements)

## URL nettoyage

`GooglePlacesService._cleanUrl()` supprime automatiquement les paramètres UTM/tracking des URLs retournées par Google.
