# -*- coding: utf-8 -*-
from odoo import models, fields, api


class UcmQueue(models.Model):
    _name = 'ucm.queue'
    _description = 'File d\'attente d\'appels'
    _order = 'name'

    name = fields.Char(string='Nom', required=True)
    queue_number = fields.Char(string='Numéro file', required=True)
    description = fields.Text(string='Description')
    
    # Configuration
    max_wait_time = fields.Integer(string='Temps attente max (sec)', default=300)
    max_queue_size = fields.Integer(string='Taille max file', default=50)
    
    # Agents de la file
    agent_ids = fields.Many2many('res.users', string='Agents', domain=[('share', '=', False)])
    
    # Statistiques en temps réel
    active_calls = fields.Integer(string='Appels en cours', default=0)
    waiting_calls = fields.Integer(string='Appels en attente', default=0)
    avg_wait_time = fields.Integer(string='Temps attente moyen (sec)', default=0)
    avg_talk_time = fields.Integer(string='Temps parole moyen (sec)', default=0)
    
    # Statistiques du jour
    total_calls_today = fields.Integer(string='Appels aujourd\'hui', default=0)
    answered_calls_today = fields.Integer(string='Appels répondus', default=0)
    missed_calls_today = fields.Integer(string='Appels manqués', default=0)
    abandoned_calls_today = fields.Integer(string='Appels abandonnés', default=0)
    
    @api.model
    def update_from_middleware(self, vals):
        """Met à jour les stats d'une file depuis le middleware"""
        queue_number = vals.get('queue_number')
        if not queue_number:
            return False
        
        queue = self.search([('queue_number', '=', queue_number)], limit=1)
        
        queue_vals = {
            'active_calls': vals.get('active_calls', 0),
            'waiting_calls': vals.get('waiting_calls', 0),
            'avg_wait_time': vals.get('avg_wait_time', 0),
            'avg_talk_time': vals.get('avg_talk_time', 0),
            'total_calls_today': vals.get('total_calls_today', 0),
            'answered_calls_today': vals.get('answered_calls_today', 0),
            'missed_calls_today': vals.get('missed_calls_today', 0),
            'abandoned_calls_today': vals.get('abandoned_calls_today', 0),
        }
        
        if queue:
            queue.write(queue_vals)
        else:
            queue_vals['queue_number'] = queue_number
            queue_vals['name'] = vals.get('name', f'File {queue_number}')
            queue = self.create(queue_vals)
        
        return queue.id
    
    def action_view_active_calls(self):
        """Affiche les appels actifs de la file"""
        self.ensure_one()
        return {
            'name': f'Appels en cours - {self.name}',
            'type': 'ir.actions.act_window',
            'res_model': 'ucm.call_log',
            'view_mode': 'tree,form',
            'domain': [
                ('queue_id', '=', self.id),
                ('call_type', 'in', ('ringing', 'answered'))
            ],
        }
