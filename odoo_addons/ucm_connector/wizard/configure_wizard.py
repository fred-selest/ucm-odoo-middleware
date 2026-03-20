# -*- coding: utf-8 -*-
from odoo import models, fields, api, _
from odoo.exceptions import UserError
import requests


class UcmConfigureWizard(models.TransientModel):
    _name = 'ucm.configure.wizard'
    _description = 'Assistant de configuration UCM'

    middleware_url = fields.Char(string='URL Middleware', default='http://localhost:3000')
    api_key = fields.Char(string='Clé API')
    
    ucm_host = fields.Char(string='Hôte UCM')
    ucm_port = fields.Integer(string='Port UCM', default=443)
    ucm_username = fields.Char(string='Utilisateur UCM')
    ucm_password = fields.Char(string='Mot de passe UCM')
    
    odoo_url = fields.Char(string='URL Odoo', default=lambda self: self.env['ir.config_parameter'].sudo().get_param('web.base.url'))
    odoo_db = fields.Char(string='Base de données', default=lambda self: self._cr.dbname)
    
    is_connected = fields.Boolean(string='Connecté', compute='_compute_is_connected')
    
    def _compute_is_connected(self):
        for wizard in self:
            try:
                response = requests.get(f"{wizard.middleware_url}/health", timeout=2)
                wizard.is_connected = response.status_code == 200
            except:
                wizard.is_connected = False
    
    def action_test_connection(self):
        """Teste la connexion au middleware"""
        self.ensure_one()
        try:
            response = requests.get(
                f"{self.middleware_url}/health",
                timeout=5
            )
            if response.status_code == 200:
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
    
    def action_save_config(self):
        """Enregistre la configuration"""
        self.ensure_one()
        
        # Créer/mettre à jour le connecteur
        connector = self.env['ucm.connector'].search([], limit=1)
        
        config_vals = {
            'middleware_url': self.middleware_url,
            'api_key': self.api_key,
        }
        
        if connector:
            connector.write(config_vals)
        else:
            self.env['ucm.connector'].create(config_vals)
        
        # Mettre à jour la configuration du middleware via API
        try:
            requests.post(
                f"{self.middleware_url}/api/config/odoo",
                json={
                    'url': self.odoo_url,
                    'db': self.odoo_db,
                },
                headers={'X-API-Key': self.api_key} if self.api_key else {},
                timeout=5
            )
        except:
            pass  # Optionnel
        
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': _('Configuration enregistrée'),
                'message': _('Redémarrage du middleware recommandé'),
                'type': 'success',
                'sticky': False,
            }
        }
