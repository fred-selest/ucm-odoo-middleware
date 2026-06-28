'use strict';

const logger = require('../../logger');

/**
 * Liste ordonnée des migrations de schéma.
 *
 * Pour ajouter une migration :
 *   1. Choisir un numéro séquentiel (0003, 0004, ...)
 *   2. Écrire le SQL (idempotent de préférence)
 *   3. Décrire le changement dans `description`
 *
 * Le système détecte automatiquement les migrations déjà appliquées
 * via la table _migrations et n'exécute que les nouvelles.
 *
 * Les migrations legacy déjà appliquées via du code ad-hoc sont bootstrapées
 * automatiquement (INSERT OR IGNORE sur leur version).
 */
const MIGRATIONS = [
  {
    version: '0002_calls_transcription',
    description: 'Ajout colonne transcription pour Whisper',
    sql: 'ALTER TABLE calls ADD COLUMN transcription TEXT',
  },
];

/**
 * Crée la table _migrations et applique toutes les migrations non encore appliquées.
 * Idempotent — peut être appelé à chaque démarrage.
 * @param {object} db - instance de Database exposant run(), all(), get()
 * @returns {Promise<{applied: string[], skipped: string[]}>}
 */
async function applyMigrations(db) {
  // 1. Créer la table _migrations (idempotent)
  await db.run(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version     TEXT PRIMARY KEY,
      description TEXT,
      applied_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 2. Bootstrap : enregistre les migrations connues comme "déjà appliquées"
  //    si la colonne existe déjà (cas où l'ancien code ad-hoc a déjà fait l'ALTER).
  const results = { applied: [], skipped: [], errors: [] };

  // 3. Récupère les versions déjà trackées
  const appliedVersions = new Set();
  const rows = await db.all('SELECT version FROM _migrations');
  rows.forEach((r) => appliedVersions.add(r.version));

  // 4. Pour chaque migration connue, applique si pas encore trackée
  for (const m of MIGRATIONS) {
    if (appliedVersions.has(m.version)) {
      results.skipped.push(m.version);
      continue;
    }

    let actuallyApplied = true;
    try {
      await db.run(m.sql);
      logger.info('Migration appliquée', { version: m.version, description: m.description });
    } catch (err) {
      // Cas spécial : la colonne existe déjà (code legacy ou boot précédent raté)
      if (/duplicate column/i.test(err.message)) {
        logger.warn('Migration déjà appliquée (ALTER préexistant)', { version: m.version });
      } else {
        logger.error('Migration échouée', { version: m.version, error: err.message });
        results.errors.push({ version: m.version, error: err.message });
        actuallyApplied = false;
        // On continue les autres migrations — un échec n'arrête pas tout
        continue;
      }
    }

    await db.run(
      'INSERT INTO _migrations (version, description) VALUES (?, ?)',
      [m.version, m.description]
    );
    if (actuallyApplied) results.applied.push(m.version);
  }

  return results;
}

module.exports = { MIGRATIONS, applyMigrations };