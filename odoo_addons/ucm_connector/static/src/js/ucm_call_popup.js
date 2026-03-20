/** @odoo-module **/

import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { Component, useState, onMounted, onWillUnmount } from "@odoo/owl";

/**
 * Popup d'appel entrant - affiché quand un appel arrive
 */
export class UcmCallPopup extends Component {
    static template = "ucm_connector.UcmCallPopup";
    
    setup() {
        super.setup();
        this.notification = useService("notification");
        this.rpc = useService("rpc");
        
        this.state = useState({
            visible: false,
            incomingCall: null,
            callerInfo: null,
        });
        
        // Écouter les événements WebSocket
        this.ws = null;
        this.connectWebSocket();
        
        onMounted(() => {
            this.checkVisibility();
        });
        
        onWillUnmount(() => {
            if (this.ws) {
                this.ws.close();
            }
        });
    }
    
    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ucm-ws`;
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('[UCM] WebSocket connecté');
        };
        
        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleWebSocketMessage(data);
        };
        
        this.ws.onclose = () => {
            console.log('[UCM] WebSocket déconnecté');
            // Reconnect after 5 seconds
            setTimeout(() => this.connectWebSocket(), 5000);
        };
        
        this.ws.onerror = (error) => {
            console.error('[UCM] WebSocket erreur:', error);
        };
    }
    
    handleWebSocketMessage(data) {
        if (data.type === 'call:incoming') {
            this.showIncomingCall(data.data);
        } else if (data.type === 'call:hangup') {
            this.hidePopup();
        }
    }
    
    async showIncomingCall(callData) {
        // Chercher les infos du contact
        let callerInfo = null;
        if (callData.callerIdNum) {
            callerInfo = await this.searchPartner(callData.callerIdNum);
        }
        
        this.state.incomingCall = callData;
        this.state.callerInfo = callerInfo;
        this.state.visible = true;
        
        // Jouer une sonnerie
        this.playRingtone();
    }
    
    async searchPartner(phone) {
        try {
            const partners = await this.rpc('/web/search_read', {
                model: 'res.partner',
                fields: ['name', 'phone', 'mobile', 'email', 'company_id'],
                domain: [
                    '|',
                    ['phone', '=', phone],
                    ['mobile', '=', phone]
                ],
                limit: 1,
            });
            return partners[0] || null;
        } catch (e) {
            return null;
        }
    }
    
    hidePopup() {
        this.state.visible = false;
        this.state.incomingCall = null;
        this.stopRingtone();
    }
    
    playRingtone() {
        const audio = new Audio('/ucm_connector/static/src/sounds/ringtone.mp3');
        audio.loop = true;
        audio.play().catch(() => {});
        this.ringtoneAudio = audio;
    }
    
    stopRingtone() {
        if (this.ringtoneAudio) {
            this.ringtoneAudio.pause();
            this.ringtoneAudio = null;
        }
    }
    
    checkVisibility() {
        // Vérifier si l'utilisateur a une extension configurée
        this.rpc('/web/session/get_context', {}).then((context) => {
            // TODO: Vérifier l'extension
        });
    }
}

registry.category("components").add("UcmCallPopup", UcmCallPopup);
