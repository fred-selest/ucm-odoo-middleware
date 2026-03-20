# -*- coding: utf-8 -*-
from odoo import models, fields, api
from datetime import datetime


class UcmAgentStatus(models.Model):
    _name = 'ucm.agent_status'
    _description = 'Statut des agents téléphoniques'
    _order = 'exten'

    user_id = fields.Many2one('res.users', string='Utilisateur', domain=[('share', '=', False)])
    exten = fields.Char(string='Extension', required=True, index=True)
    
    status = fields.Selection([
        ('available', 'Disponible'),
        ('busy', 'Occupé'),
        ('on_call', 'En appel'),
        ('pause', 'Pause'),
        ('offline', 'Hors ligne'),
    ], string='Statut', default='offline', index=True)
    
    last_call_date = fields.Datetime(string='Dernier appel')
    status_change_date = fields.Datetime(string='Changement statut', default=fields.Datetime.now)
    
    # Statistiques du jour
    total_calls_today = fields.Integer(string='Appels aujourd\'hui', default=0)
    total_duration_today = fields.Integer(string='Durée aujourd\'hui (sec)', default=0)
    
    # Champs calculés
    duration_display = fields.Char(string='Durée affichée', compute='_compute_duration_display')
    is_available = fields.Boolean(string='Disponible', compute='_compute_is_available')
    
    @api.depends('total_duration_today')
    def _compute_duration_display(self):
        for record in self:
            hours = record.total_duration_today // 3600
            minutes = (record.total_duration_today % 3600) // 60
            record.duration_display = f"{hours}h {minutes}min"
    
    @api.depends('status')
    def _compute_is_available(self):
        for record in self:
            record.is_available = record.status in ('available', 'on_call')
    
    @api.model
    def update_from_middleware(self, vals):
        """Met à jour le statut d'un agent depuis le middleware"""
        exten = vals.get('exten')
        if not exten:
            return False
        
        agent = self.search([('exten', '=', exten)], limit=1)
        
        agent_vals = {
            'status': vals.get('status', 'offline'),
            'status_change_date': fields.Datetime.now(),
        }
        
        if vals.get('total_calls_today') is not None:
            agent_vals['total_calls_today'] = vals['total_calls_today']
        if vals.get('total_duration_today') is not None:
            agent_vals['total_duration_today'] = vals['total_duration_today']
        
        if agent:
            agent.write(agent_vals)
        else:
            agent_vals['exten'] = exten
            agent = self.create(agent_vals)
        
        return agent.id
    
    def action_set_available(self):
        self.write({'status': 'available', 'status_change_date': fields.Datetime.now()})
    
    def action_set_busy(self):
        self.write({'status': 'busy', 'status_change_date': fields.Datetime.now()})
    
    def action_set_pause(self):
        self.write({'status': 'pause', 'status_change_date': fields.Datetime.now()})
