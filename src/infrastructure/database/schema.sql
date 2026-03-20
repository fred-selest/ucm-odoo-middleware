-- Schéma de base de données SQLite pour l'historique des appels
-- UCM ↔ Odoo Middleware

-- Table des appels
CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unique_id TEXT NOT NULL UNIQUE,
  caller_id_num TEXT,
  caller_id_name TEXT,
  exten TEXT,
  agent_exten TEXT,
  direction TEXT CHECK(direction IN ('inbound', 'outbound', 'internal')),
  status TEXT CHECK(status IN ('ringing', 'answered', 'hangup', 'missed', 'failed')),
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  answered_at DATETIME,
  hung_up_at DATETIME,
  duration INTEGER, -- en secondes
  contact_id INTEGER,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  contact_odoo_url TEXT,
  odoo_partner_id INTEGER,
  recording_url TEXT,
  notes TEXT,
  tags TEXT, -- JSON array de tags
  rating INTEGER CHECK(rating BETWEEN 1 AND 5), -- Note 1-5 étoiles
  created_by TEXT, -- Qui a créé la note
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index pour les recherches fréquentes
CREATE INDEX IF NOT EXISTS idx_calls_caller_id ON calls(caller_id_num);
CREATE INDEX IF NOT EXISTS idx_calls_exten ON calls(exten);
CREATE INDEX IF NOT EXISTS idx_calls_started_at ON calls(started_at);
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);
CREATE INDEX IF NOT EXISTS idx_calls_direction ON calls(direction);

-- Table de blacklist
CREATE TABLE IF NOT EXISTS blacklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_number TEXT NOT NULL UNIQUE,
  reason TEXT,
  blocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  blocked_by TEXT,
  expires_at DATETIME,
  active BOOLEAN DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_blacklist_phone ON blacklist(phone_number);
CREATE INDEX IF NOT EXISTS idx_blacklist_active ON blacklist(active);

-- Table des statistiques journalières (pour performance)
CREATE TABLE IF NOT EXISTS daily_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date DATE NOT NULL UNIQUE,
  total_calls INTEGER DEFAULT 0,
  answered_calls INTEGER DEFAULT 0,
  missed_calls INTEGER DEFAULT 0,
  failed_calls INTEGER DEFAULT 0,
  avg_duration INTEGER DEFAULT 0, -- en secondes
  total_duration INTEGER DEFAULT 0, -- en secondes
  unique_callers INTEGER DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Table des statuts des agents (type Ringover)
CREATE TABLE IF NOT EXISTS agent_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exten TEXT NOT NULL UNIQUE,
  status TEXT CHECK(status IN ('available', 'busy', 'on_call', 'pause', 'offline')) DEFAULT 'offline',
  last_call_at DATETIME,
  last_status_change DATETIME DEFAULT CURRENT_TIMESTAMP,
  total_calls_today INTEGER DEFAULT 0,
  total_duration_today INTEGER DEFAULT 0, -- en secondes
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_status_exten ON agent_status(exten);
CREATE INDEX IF NOT EXISTS idx_agent_status_status ON agent_status(status);

-- Table des appels en cours (pour click-to-call et suivi)
CREATE TABLE IF NOT EXISTS active_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unique_id TEXT NOT NULL UNIQUE,
  caller_id_num TEXT,
  exten TEXT,
  direction TEXT,
  status TEXT,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  odoo_partner_id INTEGER,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_active_calls_unique_id ON active_calls(unique_id);
CREATE INDEX IF NOT EXISTS idx_active_calls_exten ON active_calls(exten);

-- Vue pour les appels du jour
CREATE VIEW IF NOT EXISTS today_calls AS
SELECT * FROM calls
WHERE date(started_at) = date('now');

-- Vue pour les appels manqués
CREATE VIEW IF NOT EXISTS missed_calls AS
SELECT * FROM calls
WHERE status = 'missed'
ORDER BY started_at DESC;

-- Vue pour les statistiques par extension
CREATE VIEW IF NOT EXISTS stats_by_extension AS
SELECT
  exten,
  COUNT(*) as total_calls,
  SUM(CASE WHEN status = 'answered' THEN 1 ELSE 0 END) as answered,
  SUM(CASE WHEN status = 'missed' THEN 1 ELSE 0 END) as missed,
  AVG(duration) as avg_duration,
  SUM(duration) as total_duration
FROM calls
WHERE started_at >= date('now', '-30 days')
GROUP BY exten;

-- Table de cache des contacts (pour synchronisation)
CREATE TABLE IF NOT EXISTS contact_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL UNIQUE,
  name TEXT,
  email TEXT,
  company TEXT,
  data TEXT, -- JSON complet du contact
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_contact_cache_phone ON contact_cache(phone);
