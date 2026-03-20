# -*- coding: utf-8 -*-
from odoo import models, fields, api, _
import requests


class ResPartner(models.Model):
    _inherit = 'res.partner'

    # Champs pour les informations téléphoniques
    ucm_call_count = fields.Integer(string='Nombre d\'appels', compute='_compute_ucm_call_count')
    ucm_last_call_date = fields.Datetime(string='Dernier appel', compute='_compute_ucm_call_stats')
    ucm_total_duration = fields.Integer(string='Durée totale (sec)', compute='_compute_ucm_call_stats')
    
    # Notes d'appel récentes
    ucm_recent_calls = fields.One2many('ucm.call_log', 'partner_id', string='Appels récents')
    
    def _compute_ucm_call_count(self):
        for partner in self:
            partner.ucm_call_count = self.env['ucm.call_log'].search_count([
                ('partner_id', '=', partner.id)
            ])
    
    def _compute_ucm_call_stats(self):
        for partner in self:
            calls = self.env['ucm.call_log'].search([
                ('partner_id', '=', partner.id)
            ], order='start_date DESC', limit=100)
            
            partner.ucm_last_call_date = calls[0].start_date if calls else False
            partner.ucm_total_duration = sum(calls.mapped('duration'))
    
    def action_view_ucm_calls(self):
        """Affiche l'historique des appels pour ce contact"""
        self.ensure_one()
        return {
            'name': _('Historique des appels'),
            'type': 'ir.actions.act_window',
            'res_model': 'ucm.call_log',
            'view_mode': 'tree,form',
            'domain': [('partner_id', '=', self.id)],
            'context': {'search_default_partner_id': self.id},
        }
    
    def action_ucm_click_to_call(self, phone):
        """Déclenche un click-to-call via le middleware"""
        self.ensure_one()
        
        # Trouver l'agent connecté
        agent = self.env.user
        agent_exten = agent.ucm_extension
        
        if not agent_exten:
            return {
                'type': 'ir.actions.client',
                'tag': 'display_notification',
                'params': {
                    'title': _('Extension non configurée'),
                    'message': _('Configurez votre extension dans vos préférences'),
                    'type': 'danger',
                    'sticky': True,
                }
            }
        
        # Appeler le middleware
        connector = self.env['ucm.connector'].search([], limit=1)
        if not connector or not connector.is_connected:
            return {
                'type': 'ir.actions.client',
                'tag': 'display_notification',
                'params': {
                    'title': _('Middleware non connecté'),
                    'message': _('Vérifiez la connexion au middleware UCM'),
                    'type': 'danger',
                    'sticky': True,
                }
            }
        
        try:
            response = requests.post(
                f"{connector.middleware_url}/api/call/click",
                json={
                    'caller': agent_exten,
                    'callee': phone,
                    'partner_id': self.id,
                    'partner_name': self.name,
                },
                headers={'X-API-Key': connector.api_key} if connector.api_key else {},
                timeout=5
            )
            
            if response.status_code == 200:
                return {
                    'type': 'ir.actions.client',
                    'tag': 'display_notification',
                    'params': {
                        'title': _('Appel en cours...'),
                        'message': _('Connexion avec %s (%s)') % (self.name, phone),
                        'type': 'success',
                        'sticky': False,
                    }
                }
            else:
                raise UserError(_('Erreur: %s') % response.text)
                
        except Exception as e:
            raise UserError(_('Échec de l\'appel: %s') % str(e))
