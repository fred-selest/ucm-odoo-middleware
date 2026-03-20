# -*- coding: utf-8 -*-
from odoo import models, fields, api, _
from odoo.exceptions import UserError
import requests
import logging

_logger = logging.getLogger(__name__)


class UcmConnector(models.Model):
    _name = 'ucm.connector'
    _description = 'Configuration du connecteur UCM'

    name = fields.Char(string='Nom', default='UCM Connector')
    
    # Configuration middleware
    middleware_url = fields.Char(string='URL Middleware', default='http://localhost:3000')
    api_key = fields.Char(string='Clé API')
    
    # Statut connexion
    is_connected = fields.Boolean(string='Connecté', compute='_compute_connection_status')
    last_sync_date = fields.Datetime(string='Dernière synchro')
    
    # Configuration
    auto_create_contacts = fields.Boolean(string='Créer contacts auto', default=True)
    auto_log_calls = fields.Boolean(string='Logger appels auto', default=True)
    enable_click_to_call = fields.Boolean(string='Click-to-call', default=True)
    enable_recording_sync = fields.Boolean(string='Synchro enregistrements', default=True)
    
    @api.depends('middleware_url')
    def _compute_connection_status(self):
        for record in self:
            try:
                response = requests.get(f"{record.middleware_url}/health", timeout=2)
                record.is_connected = response.status_code == 200
            except:
                record.is_connected = False
    
    def action_test_connection(self):
        """Teste la connexion au middleware"""
        self.ensure_one()
        try:
            response = requests.get(
                f"{self.middleware_url}/health",
                headers={'X-API-Key': self.api_key} if self.api_key else {},
                timeout=5
            )
            if response.status_code == 200:
                self.last_sync_date = fields.Datetime.now()
                return {
                    'type': 'ir.actions.client',
                    'tag': 'display_notification',
                    'params': {
                        'title': _('Connexion réussie'),
                        'message': _('Le middleware UCM est accessible'),
                        'type': 'success',
                        'sticky': False,
                    }
                }
            else:
                raise UserError(_('Erreur de connexion: %s') % response.status_code)
        except Exception as e:
            raise UserError(_('Échec de connexion: %s') % str(e))
    
    def action_sync_contacts(self):
        """Synchronise les contacts Odoo vers le middleware"""
        self.ensure_one()
        
        # Récupérer tous les contacts avec téléphone
        partners = self.env['res.partner'].search([
            '|', ('phone', '!=', False), ('mobile', '!=', False)
        ])
        
        contacts = []
        for partner in partners:
            contacts.append({
                'id': partner.id,
                'name': partner.name,
                'phone': partner.phone or partner.mobile,
                'email': partner.email,
                'company': partner.company_id.name if partner.company_id else None,
            })
        
        # Envoyer au middleware
        try:
            response = requests.post(
                f"{self.middleware_url}/api/contacts/sync",
                json={'contacts': contacts},
                headers={'X-API-Key': self.api_key} if self.api_key else {},
                timeout=10
            )
            
            if response.status_code == 200:
                self.last_sync_date = fields.Datetime.now()
                return {
                    'type': 'ir.actions.client',
                    'tag': 'display_notification',
                    'params': {
                        'title': _('Synchronisation réussie'),
                        'message': _('%d contacts synchronisés') % len(contacts),
                        'type': 'success',
                        'sticky': False,
                    }
                }
        except Exception as e:
            raise UserError(_('Échec synchronisation: %s') % str(e))
        
        return False
    
    def action_fetch_recordings(self):
        """Récupère les enregistrements depuis le middleware"""
        self.ensure_one()
        
        try:
            response = requests.get(
                f"{self.middleware_url}/api/calls/recordings",
                headers={'X-API-Key': self.api_key} if self.api_key else {},
                timeout=10
            )
            
            if response.status_code == 200:
                recordings = response.json()
                updated = 0
                
                for rec in recordings:
                    call = self.env['ucm.call_log'].search(
                        [('unique_id', '=', rec.get('unique_id'))],
                        limit=1
                    )
                    if call:
                        call.write({
                            'recording_url': rec.get('recording_url'),
                            'recording_duration': rec.get('recording_duration'),
                        })
                        updated += 1
                
                return {
                    'type': 'ir.actions.client',
                    'tag': 'display_notification',
                    'params': {
                        'title': _('Enregistrements synchronisés'),
                        'message': _('%d appels mis à jour') % updated,
                        'type': 'success',
                        'sticky': False,
                    }
                }
        except Exception as e:
            raise UserError(_('Échec récupération enregistrements: %s') % str(e))
        
        return False
