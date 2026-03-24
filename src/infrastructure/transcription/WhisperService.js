'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('../../config');
const logger = require('../../logger');

const TMP_DIR = path.join(os.tmpdir(), 'ucm-whisper');

class WhisperService {
  constructor({ ucmHttpClient, callHistory, crmClient }) {
    this._ucm = ucmHttpClient;
    this._callHistory = callHistory;
    this._crm = crmClient;
    this._processing = false;
    this._whisperCmd = null;

    // Créer le dossier temp
    if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
  }

  get isEnabled() {
    return config.whisper.enabled;
  }

  /**
   * Détecte la commande Whisper disponible sur le système.
   * Priorité : config custom > whisper (Python) > whisper.cpp (main)
   */
  async _detectCommand() {
    if (this._whisperCmd) return this._whisperCmd;

    if (config.whisper.command) {
      this._whisperCmd = config.whisper.command;
      return this._whisperCmd;
    }

    // Tester whisper (Python openai-whisper)
    for (const cmd of ['whisper', '/usr/local/bin/whisper', '/usr/bin/whisper']) {
      try {
        await this._exec(cmd, ['--help']);
        this._whisperCmd = cmd;
        logger.info('Whisper: commande détectée', { command: cmd });
        return cmd;
      } catch { /* pas trouvé */ }
    }

    logger.warn('Whisper: aucune commande trouvée, transcription désactivée');
    return null;
  }

  /**
   * Traite les nouveaux enregistrements sans transcription.
   * @returns {number} nombre de transcriptions effectuées
   */
  async processNewRecordings() {
    if (!this.isEnabled || this._processing) return 0;
    this._processing = true;

    try {
      const cmd = await this._detectCommand();
      if (!cmd) return 0;

      const calls = await this._callHistory.getCallsNeedingTranscription(5);
      if (calls.length === 0) return 0;

      let count = 0;
      for (const call of calls) {
        try {
          // Vérifier la durée max
          if (call.duration && call.duration > config.whisper.maxDurationSec) {
            logger.debug('Whisper: appel trop long, skip', { uniqueId: call.unique_id, duration: call.duration });
            continue;
          }

          const text = await this._transcribeCall(call, cmd);
          if (text) {
            count++;
            // Poster dans le chatter Odoo si contact identifié
            if (call.odoo_partner_id) {
              try {
                const note = `🎙️ Transcription de l'appel du ${call.caller_id_num || 'inconnu'}\n\n${text}`;
                await this._crm.addContactNote(call.odoo_partner_id, note);
              } catch (err) {
                logger.warn('Whisper: erreur post chatter', { error: err.message });
              }
            }
          }
        } catch (err) {
          logger.warn('Whisper: erreur transcription appel', { uniqueId: call.unique_id, error: err.message });
        }
      }

      if (count > 0) logger.info('Whisper: transcriptions effectuées', { count });
      return count;
    } finally {
      this._processing = false;
    }
  }

  /**
   * Transcrit un appel spécifique.
   */
  async _transcribeCall(call, cmd) {
    const recordingUrl = call.recording_url;
    // Extraire le filename de l'URL
    const filename = decodeURIComponent(recordingUrl.replace(/^\/api\/recordings\/download\//, ''));
    if (!filename) return null;

    logger.info('Whisper: transcription en cours', { uniqueId: call.unique_id, filename });

    // 1. Télécharger le WAV depuis le UCM
    const wavBuffer = await this._ucm.downloadRecording(filename);
    if (!wavBuffer || wavBuffer.length < 1000) {
      logger.warn('Whisper: fichier WAV trop petit ou vide', { filename, size: wavBuffer?.length });
      return null;
    }

    // 2. Écrire dans un fichier temp
    const wavPath = path.join(TMP_DIR, `${call.unique_id.replace(/[^a-zA-Z0-9.-]/g, '_')}.wav`);
    fs.writeFileSync(wavPath, wavBuffer);

    try {
      // 3. Lancer Whisper
      const text = await this._runWhisper(cmd, wavPath);

      // 4. Sauvegarder en base
      if (text?.trim()) {
        await this._callHistory.updateCallTranscription(call.unique_id, text.trim());
        logger.info('Whisper: transcription réussie', { uniqueId: call.unique_id, length: text.trim().length });
        return text.trim();
      }

      return null;
    } finally {
      // 5. Nettoyage
      try { fs.unlinkSync(wavPath); } catch { /* ignore */ }
      // Supprimer aussi les fichiers de sortie whisper (.txt, .json, etc.)
      for (const ext of ['.txt', '.json', '.vtt', '.srt', '.tsv']) {
        try { fs.unlinkSync(wavPath.replace('.wav', ext)); } catch { /* ignore */ }
      }
    }
  }

  /**
   * Exécute Whisper CLI et retourne le texte transcrit.
   */
  async _runWhisper(cmd, wavPath) {
    const model = config.whisper.model;
    const lang = config.whisper.language;

    // Format de la commande selon le type de whisper
    const args = [
      wavPath,
      '--model', model,
      '--language', lang,
      '--output_format', 'txt',
      '--output_dir', TMP_DIR,
    ];

    try {
      await this._exec(cmd, args, { timeout: 120000 });

      // Lire le fichier de sortie (.txt)
      const txtPath = wavPath.replace('.wav', '.txt');
      if (fs.existsSync(txtPath)) {
        return fs.readFileSync(txtPath, 'utf8');
      }

      return null;
    } catch (err) {
      logger.error('Whisper: erreur exécution', { error: err.message, cmd, args: args.join(' ') });
      throw err;
    }
  }

  _exec(cmd, args, options = {}) {
    return new Promise((resolve, reject) => {
      execFile(cmd, args, { timeout: options.timeout || 10000, ...options }, (err, stdout, stderr) => {
        if (err) return reject(err);
        resolve(stdout);
      });
    });
  }
}

module.exports = WhisperService;
