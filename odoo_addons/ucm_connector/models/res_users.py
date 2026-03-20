# -*- coding: utf-8 -*-
from odoo import models, fields, api, _


class ResUsers(models.Model):
    _inherit = 'res.users'

    # Extension téléphonique UCM
    ucm_extension = fields.Char(string='Extension UCM', groups='base.group_user')
    ucm_agent_status = fields.Selection([
        ('available', 'Disponible'),
        ('busy', 'Occupé'),
        ('pause', 'Pause'),
        ('offline', 'Hors ligne'),
    ], string='Statut téléphonique', default='offline', groups='base.group_user')
    
    # Statistiques
    ucm_total_calls_today = fields.Integer(string='Appels aujourd\'hui', default=0)
    ucm_total_duration_today = fields.Integer(string='Durée aujourd\'hui (sec)', default=0)
    
    def action_ucm_set_available(self):
        self.write({'ucm_agent_status': 'available'})
    
    def action_ucm_set_busy(self):
        self.write({'ucm_agent_status': 'busy'})
    
    def action_ucm_set_pause(self):
        self.write({'ucm_agent_status': 'pause'})
