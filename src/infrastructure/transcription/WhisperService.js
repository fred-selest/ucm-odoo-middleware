'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const FormData = require('form-data');
const axios = require('axios');
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

    if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
  }

  get isEnabled() { return config.whisper.enabled; }
  get mode() { return config.whisper.mode; }

  /**
   * Traite les nouveaux enregistrements sans transcription.
   */
  async processNewRecordings() {
    if (!this.isEnabled || this._processing) return 0;
    this._processing = true;

    try {
      const calls = await this._callHistory.getCallsNeedingTranscription(5);
      if (calls.length === 0) return 0;

      // Mode local : vérifier la commande une fois
      let cmd = null;
      if (this.mode === 'local') {
        cmd = await this._detectCommand();
        if (!cmd) return 0;
      }

      let count = 0;
      for (const call of calls) {
        try {
          if (call.duration && call.duration > config.whisper.maxDurationSec) {
            logger.debug('Whisper: appel trop long, skip', { uniqueId: call.unique_id, duration: call.duration });
            continue;
          }

          const text = await this._transcribeCall(call, cmd);
          if (text) {
            count++;
            if (call.odoo_partner_id) {
              try {
                const note = `Transcription de l'appel du ${call.caller_id_num || 'inconnu'}\n\n${text}`;
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

      if (count > 0) logger.info('Whisper: transcriptions effectuées', { count, mode: this.mode });
      return count;
    } finally {
      this._processing = false;
    }
  }

  /**
   * Transcrit un appel spécifique (local ou API).
   */
  async _transcribeCall(call, cmd) {
    const filename = decodeURIComponent((call.recording_url || '').replace(/^\/api\/recordings\/download\//, ''));
    if (!filename) return null;

    logger.info('Whisper: transcription en cours', { uniqueId: call.unique_id, filename, mode: this.mode });

    // 1. Télécharger le WAV depuis le UCM
    const wavBuffer = await this._ucm.downloadRecording(filename);
    if (!wavBuffer || wavBuffer.length < 1000) {
      logger.warn('Whisper: fichier WAV trop petit ou vide', { filename, size: wavBuffer?.length });
      return null;
    }

    const wavPath = path.join(TMP_DIR, `${call.unique_id.replace(/[^a-zA-Z0-9.-]/g, '_')}.wav`);
    fs.writeFileSync(wavPath, wavBuffer);

    try {
      const text = this.mode === 'api'
        ? await this._transcribeViaApi(wavPath, filename)
        : await this._transcribeLocal(cmd, wavPath);

      if (text?.trim()) {
        await this._callHistory.updateCallTranscription(call.unique_id, text.trim());
        logger.info('Whisper: transcription réussie', { uniqueId: call.unique_id, length: text.trim().length });
        return text.trim();
      }

      return null;
    } finally {
      try { fs.unlinkSync(wavPath); } catch { /* ignore */ }
      for (const ext of ['.txt', '.json', '.vtt', '.srt', '.tsv']) {
        try { fs.unlinkSync(wavPath.replace('.wav', ext)); } catch { /* ignore */ }
      }
    }
  }

  /**
   * Transcription via API HTTP (OpenAI ou Groq).
   */
  async _transcribeViaApi(wavPath, originalFilename) {
    if (!config.whisper.apiKey) throw new Error('WHISPER_API_KEY non configurée');

    const form = new FormData();
    form.append('file', fs.createReadStream(wavPath), {
      filename: path.basename(originalFilename) || 'audio.wav',
      contentType: 'audio/wav',
    });
    form.append('model', 'whisper-1');
    form.append('language', config.whisper.language);
    form.append('response_format', 'text');

    const response = await axios.post(config.whisper.apiUrl, form, {
      headers: {
        ...form.getHeaders(),
        'Authorization': `Bearer ${config.whisper.apiKey}`,
      },
      timeout: 60000,
    });

    return typeof response.data === 'string' ? response.data : response.data?.text || null;
  }

  /**
   * Transcription via CLI Whisper local.
   */
  async _transcribeLocal(cmd, wavPath) {
    const args = [
      wavPath,
      '--model', config.whisper.model,
      '--language', config.whisper.language,
      '--output_format', 'txt',
      '--output_dir', TMP_DIR,
    ];

    await this._exec(cmd, args, { timeout: 120000 });

    const txtPath = wavPath.replace('.wav', '.txt');
    if (fs.existsSync(txtPath)) return fs.readFileSync(txtPath, 'utf8');
    return null;
  }

  /**
   * Détecte la commande Whisper locale disponible sur le système.
   */
  async _detectCommand() {
    if (this._whisperCmd) return this._whisperCmd;

    if (config.whisper.command) {
      this._whisperCmd = config.whisper.command;
      return this._whisperCmd;
    }

    for (const cmd of ['whisper', '/usr/local/bin/whisper', '/usr/bin/whisper']) {
      try {
        await this._exec(cmd, ['--help']);
        this._whisperCmd = cmd;
        logger.info('Whisper: commande locale détectée', { command: cmd });
        return cmd;
      } catch { /* pas trouvé */ }
    }

    logger.warn('Whisper: aucune commande locale trouvée');
    return null;
  }

  _exec(cmd, args, options = {}) {
    return new Promise((resolve, reject) => {
      execFile(cmd, args, { timeout: options.timeout || 10000, ...options }, (err, stdout) => {
        if (err) return reject(err);
        resolve(stdout);
      });
    });
  }
}

module.exports = WhisperService;
