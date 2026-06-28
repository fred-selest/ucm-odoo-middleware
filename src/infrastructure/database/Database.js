'use strict';

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const logger = require('../../logger');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../../data/middleware.db');

class Database {
  constructor() {
    this.db = null;
  }

  async connect() {
    const dbDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
      // Ouverture explicite en lecture-écriture (flag SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE)
      this.db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
        if (err) {
          logger.error('Erreur connexion base de données', { error: err.message });
          reject(err);
        } else {
          logger.info('Base de données SQLite connectée', { path: DB_PATH });
          this._initSchema().then(resolve).catch(reject);
        }
      });
    });
  }

  async _initSchema() {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    const statements = schema.split(';').filter(s => s.trim());

    for (const statement of statements) {
      await this.run(statement);
    }

    logger.info('Schéma de base de données initialisé');

    // Migrations versionnées — table _migrations + ALTER traçables
    const { applyMigrations } = require('./migrations');
    const result = await applyMigrations(this);
    if (result.applied.length > 0) {
      logger.info('Nouvelles migrations appliquées', { versions: result.applied });
    } else if (result.skipped.length > 0) {
      logger.debug('Toutes les migrations connues déjà appliquées', { versions: result.skipped });
    }
    if (result.errors.length > 0) {
      logger.warn('Migrations en erreur', { count: result.errors.length, errors: result.errors });
    }
  }

  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) {
          logger.error('Erreur SQL', { sql, error: err.message });
          reject(err);
        } else {
          resolve({ id: this.lastID, changes: this.changes });
        }
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) {
          logger.error('Erreur SQL', { sql, error: err.message });
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          logger.error('Erreur SQL', { sql, error: err.message });
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  close() {
    return new Promise((resolve, reject) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) reject(err);
          else {
            logger.info('Base de données fermée');
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = new Database();
