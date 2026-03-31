'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const FormData = require('form-data');
const axios = require('axios');
const config = require('../../config');
const logger = require('../../logger');

const TMP_DIR   = path.join(os.tmpdir(), 'ucm-whisper');
const MODEL_DIR = process.env.WHISPER_MODEL_DIR || '/app/data/whisper';

class WhisperService {
  constructor({ ucmHttpClient, callHistory, crmClient }) {
    this._ucm = ucmHttpClient;
    this._callHistory = callHistory;
    this._crm = crmClient;
    this._processing = false;
    this._whisperCmd = null;
    this._cmdDetected = false;

    if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
  }

  get isEnabled() { return config.whisper.enabled; }
  get mode() { return config.whisper.mode; }

  /**
   * Initialise le service (détecte commande Whisper si mode local).
   */
  async init() {
    if (this.mode === 'local' && !this._cmdDetected) {
      await this._detectCommand();
    }
  }

  /**
   * Traite les nouveaux enregistrements sans transcription.
   */
  async processNewRecordings() {
    if (!this.isEnabled || this._processing) return 0;
    this._processing = true;

    try {
      // Réduire à 2 appels max pour éviter la surcharge CPU
      const calls = await this._callHistory.getCallsNeedingTranscription(2);
      if (calls.length === 0) return 0;

      // Mode local : vérifier la commande une fois
      let cmd = this._whisperCmd;
      if (this.mode === 'local' && !cmd) {
        cmd = await this._detectCommand();
        if (!cmd) return 0;
      }

      let count = 0;
      // Traiter en série pour éviter la surcharge CPU
      for (const call of calls) {
        try {
          // Skip si trop long (> 10 min pour CPU)
          const maxDuration = this.mode === 'local' ? 600 : config.whisper.maxDurationSec;
          if (call.duration && call.duration > maxDuration) {
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

    const internalUrl = `http://localhost:3000/api/recordings/download/${encodeURIComponent(filename)}`;

    let wavBuffer;
    try {
      const response = await axios.get(internalUrl, {
        responseType: 'arraybuffer',
        timeout: 30000
      });
      wavBuffer = Buffer.from(response.data);
    } catch (err) {
      logger.warn('Whisper: erreur téléchargement', { filename, error: err.message });
      return null;
    }

    if (!wavBuffer || wavBuffer.length < 1000) {
      logger.warn('Whisper: fichier WAV trop petit ou vide', { filename, size: wavBuffer?.length });
      return null;
    }

    const safeId = call.unique_id.replace(/[^a-zA-Z0-9.-]/g, '_');
    const wavPath = path.join(TMP_DIR, `${safeId}.wav`);

    try {
      fs.writeFileSync(wavPath, wavBuffer);
    } catch (err) {
      logger.warn('Whisper: erreur écriture fichier temporaire', { wavPath, error: err.message });
      return null;
    }

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
      // Nettoyage complet des fichiers temporaires
      const cleanupFiles = [
        wavPath,
        wavPath.replace('.wav', '.txt'),
        wavPath.replace('.wav', '.json'),
        wavPath.replace('.wav', '.vtt'),
        wavPath.replace('.wav', '.srt'),
        wavPath.replace('.wav', '.tsv'),
      ];
      for (const file of cleanupFiles) {
        try {
          if (fs.existsSync(file)) fs.unlinkSync(file);
        } catch { /* ignore */ }
      }
    }
  }

  /**
   * Transcription via API HTTP (OpenAI ou Groq).
   */
  async _transcribeViaApi(wavPath, originalFilename) {
    if (!config.whisper.apiKey) {
      throw new Error('WHISPER_API_KEY non configurée');
    }

    if (!config.whisper.apiUrl) {
      throw new Error('WHISPER_API_URL non configurée');
    }

    const form = new FormData();
    const safeFilename = originalFilename ? path.basename(originalFilename) : 'audio.wav';
    form.append('file', fs.createReadStream(wavPath), {
      filename: safeFilename,
      contentType: 'audio/wav',
    });

    // Adapter le modèle selon l'API
    const isGroq = config.whisper.apiUrl.includes('groq.com');
    const model = isGroq
      ? 'whisper-large-v3'  // Groq utilise ce nom exact
      : 'whisper-1';        // OpenAI utilise whisper-1

    form.append('model', model);
    form.append('language', config.whisper.language);
    form.append('response_format', 'text');

    try {
      const response = await axios.post(config.whisper.apiUrl, form, {
        headers: {
          ...form.getHeaders(),
          'Authorization': `Bearer ${config.whisper.apiKey}`,
        },
        timeout: 60000,
        validateStatus: (status) => status >= 200 && status < 300,
      });

      const result = typeof response.data === 'string'
        ? response.data
        : response.data?.text;

      if (!result) {
        logger.warn('Whisper API: réponse vide', { status: response.status, data: response.data });
        return null;
      }

      return result;
    } catch (err) {
      const status = err.response?.status;
      const data = err.response?.data;

      if (status === 401) {
        throw new Error('Whisper API: clé invalide (401)');
      } else if (status === 429) {
        throw new Error('Whisper API: rate limit dépassé (429)');
      } else if (status && status >= 500) {
        throw new Error(`Whisper API: erreur serveur (${status})`);
      } else if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
        throw new Error('Whisper API: timeout dépassé (60s)');
      } else {
        logger.warn('Whisper API: erreur inattendue', {
          status,
          code: err.code,
          message: err.message,
          data: typeof data === 'string' ? data : JSON.stringify(data),
        });
        throw err;
      }
    }
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
      '--model_dir', MODEL_DIR,
      '--verbose', 'False',
    ];

    // Timeout plus long pour CPU (5 min max par appel)
    await this._exec(cmd, args, { timeout: 300000 });

    const txtPath = wavPath.replace('.wav', '.txt');
    if (fs.existsSync(txtPath)) {
      const content = fs.readFileSync(txtPath, 'utf8');
      // Nettoyer les artefacts Whisper (timestamps, etc.)
      return content.trim().replace(/^\[.*?\]\s*/gm, '').trim();
    }
    return null;
  }

  /**
   * Détecte la commande Whisper locale disponible sur le système.
   */
  async _detectCommand() {
    if (this._whisperCmd) return this._whisperCmd;

    if (config.whisper.command) {
      this._whisperCmd = config.whisper.command;
      this._cmdDetected = true;
      return this._whisperCmd;
    }

    for (const cmd of ['whisper', '/usr/local/bin/whisper', '/usr/bin/whisper']) {
      try {
        await this._exec(cmd, ['--help'], { timeout: 5000 });
        this._whisperCmd = cmd;
        this._cmdDetected = true;
        logger.info('Whisper: commande locale détectée', { command: cmd });
        return cmd;
      } catch { /* pas trouvé */ }
    }

    logger.warn('Whisper: aucune commande locale trouvée');
    this._cmdDetected = true;
    return null;
  }

  _exec(cmd, args, options = {}) {
    return new Promise((resolve, reject) => {
      execFile(cmd, args, { timeout: options.timeout || 10000, ...options }, (err, stdout, stderr) => {
        if (err) {
          logger.debug('Whisper exec error', { cmd, args, error: err.message, stderr });
          return reject(err);
        }
        resolve(stdout);
      });
    });
  }
}

module.exports = WhisperService;
