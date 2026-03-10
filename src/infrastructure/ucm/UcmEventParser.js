'use strict';

/**
 * Parse le protocole texte AMI (Asterisk Manager Interface).
 *
 * Le protocole AMI est line-based :
 *   Key: Value\r\n
 *   Key: Value\r\n
 *   \r\n          ← fin de message (ligne vide)
 *
 * Cette classe accumule les données binaires du socket TCP,
 * découpe les messages et les émet via un callback.
 */
class UcmEventParser {
  constructor(onMessage) {
    this._onMessage = onMessage;
    this._buffer    = '';
  }

  /** Ingère un chunk brut du socket. */
  feed(data) {
    this._buffer += data.toString('utf8');

    let boundary;
    // Un message se termine par \r\n\r\n OU \n\n
    while ((boundary = this._findMessageEnd()) !== -1) {
      const raw = this._buffer.slice(0, boundary);
      this._buffer = this._buffer.slice(boundary).replace(/^[\r\n]+/, '');
      const msg = this._parse(raw);
      if (msg) this._onMessage(msg);
    }
  }

  reset() {
    this._buffer = '';
  }

  // ── Privé ──────────────────────────────────────────────────────────────────

  _findMessageEnd() {
    const idx = this._buffer.indexOf('\r\n\r\n');
    if (idx !== -1) return idx + 4;
    const idx2 = this._buffer.indexOf('\n\n');
    if (idx2 !== -1) return idx2 + 2;
    return -1;
  }

  _parse(raw) {
    const msg = {};
    const lines = raw.split(/\r?\n/);

    for (const line of lines) {
      if (!line.trim()) continue;
      const colon = line.indexOf(': ');
      if (colon === -1) {
        // Ligne de bannière ex: "Asterisk Call Manager/X.X"
        if (line.startsWith('Asterisk') || line.startsWith('Grandstream')) {
          msg._banner = line.trim();
        }
        continue;
      }
      const key = line.slice(0, colon).trim();
      const val = line.slice(colon + 2).trim();
      msg[key]  = val;
    }

    return Object.keys(msg).length ? msg : null;
  }
}

module.exports = UcmEventParser;
