// Mise à jour de CallHandler.js pour intégrer le lookup français

const FrenchLookupService = require('./lookup/FrenchLookupService');

// Dans le constructeur de CallHandler (après ligne 33)
constructor(http, ws, crm, webhooks, callHistory) {
  // ... code existant ...
  
  // Ajouter le service de lookup français (gratuit, pas de persistance)
  if (config.frenchLookup?.enabled !== false) {
    this._frenchLookup = new FrenchLookupService();
    logger.info('FrenchLookupService: activé');
  }
}

// Ajouter la méthode privée après _isInternalNumber()
async _lookupFrenchContact(phone) {
  if (!this._frenchLookup) return null;
  try {
    const contact = await this._frenchLookup.lookup(phone);
    if (contact) {
      logger.debug('Numéro inconnu identifié via lookup français', { 
        phone, name: contact.name, source: contact.source 
      });
    }
    return contact;
  } catch (error) {
    logger.debug('Lookup français échoué', { phone, error: error.message });
    return null;
  }
}

// Modifier la méthode _onIncoming() (lignes 109-150)

async _onIncoming(call) {
  const { uniqueId } = call;
  
  // Eviter les duplications si l'appel est déjà en cours (même uniqueId ou même numéro)
  if (this._activeCalls.has(uniqueId)) {
    logger.debug('Appel déjà en cours (doublon ignoré)', { uniqueId });
    return;
  }
  
  const existingCallWithSameCaller = [...this._activeCalls.values()].find(
    c => c.callerIdNum === call.callerIdNum && c.direction === 'inbound'
  );
  if (existingCallWithSameCaller) {
    logger.debug('Appel déjà en cours (même numéro appelant)', { 
      uniqueId, existingUniqueId: existingCallWithSameCaller.uniqueId, callerIdNum: call.callerIdNum 
    });
    return;
  }
  
  const { callerIdName, exten, agentExten } = call;
  logger.info('Appel entrant', { from: call.callerIdNum, to: exten || agentExten, uniqueId });

  // Vérifier si le numéro est blacklisté
  if (this._callHistory && call.callerIdNum) {
    const isBlacklisted = await this._callHistory.isBlacklisted(call.callerIdNum);
    if (isBlacklisted) {
      logger.info('Appel bloqué (blacklist)', { callerIdNum: call.callerIdNum, uniqueId });
      return;
    }
  }

  let contact = null;

  // Recherche CRM uniquement si numéro externe (non interne)
  if (call.callerIdNum && !this._isInternalNumber(call.callerIdNum)) {
    try {
      // 1. Recherche dans Odoo/Dolibarr
      contact = await this._crm.findContactByPhone(call.callerIdNum);
      
      // 2. Si non trouvé et lookup français activé, chercher infos publiques
      if (!contact && this._frenchLookup) {
        contact = await this._lookupFrenchContact(call.callerIdNum);
      }
    } catch (err) {
      logger.warn('Erreur recherche contact', { error: err.message, phone: call.callerIdNum });
    }
  }

  // Enrichir l'appel avec le contact trouvé (ou null)
  const enriched = { 
    ...call, 
    contact,
    timestamp: call.timestamp || new Date().toISOString()
  };
  this._activeCalls.set(uniqueId, enriched);

  // Notifier l'extension cible
  const target = exten || agentExten || enriched.exten || enriched.agentExten;
  if (target) {
    this._ws.notifyExtension(target, 'call:incoming', enriched);
    
    // Notifier le contact séparément si trouvé
    if (contact) {
      this._ws.notifyExtension(target, 'contact', { uniqueId, contact });
    }
  }
}