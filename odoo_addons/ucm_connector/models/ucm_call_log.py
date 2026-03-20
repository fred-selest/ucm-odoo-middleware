# -*- coding: utf-8 -*-
from odoo import models, fields, api, _
from odoo.exceptions import UserError
from datetime import datetime, timedelta


class UcmCallLog(models.Model):
    _name = 'ucm.call_log'
    _description = 'Journal des appels UCM'
    _order = 'start_date DESC'
    _rec_name = 'caller_id'

    unique_id = fields.Char(string='Unique ID', required=True, index=True)
    
    # Informations sur l'appelant
    caller_id = fields.Char(string='Numéro appelant', index=True)
    caller_name = fields.Char(string='Nom appelant')
    partner_id = fields.Many2one('res.partner', string='Contact', index=True)
    
    # Informations sur l'appelé
    callee_id = fields.Char(string='Numéro appelé', index=True)
    agent_exten = fields.Char(string='Extension agent')
    agent_id = fields.Many2one('res.users', string='Agent', domain=[('share', '=', False)])
    
    # Détails de l'appel
    direction = fields.Selection([
        ('inbound', 'Entrant'),
        ('outbound', 'Sortant'),
        ('internal', 'Interne'),
    ], string='Direction', default='inbound', index=True)
    
    call_type = fields.Selection([
        ('ringing', 'En sonnerie'),
        ('answered', 'Décroché'),
        ('missed', 'Manqué'),
        ('hangup', 'Terminé'),
        ('failed', 'Échoué'),
    ], string='Statut', default='ringing')
    
    start_date = fields.Datetime(string='Date début', default=fields.Datetime.now, index=True)
    answer_date = fields.Datetime(string='Date décroché')
    end_date = fields.Datetime(string='Date fin')
    duration = fields.Integer(string='Durée (sec)', default=0)
    
    # Enregistrement
    recording_url = fields.Char(string='URL enregistrement')
    recording_duration = fields.Integer(string='Durée enregistrement (sec)')
    has_recording = fields.Boolean(string='A un enregistrement', compute='_compute_has_recording')
    
    # Notes et tags
    notes = fields.Text(string='Notes')
    tag_ids = fields.Many2many('ucm.call.tag', string='Tags')
    rating = fields.Selection([
        ('1', '⭐'),
        ('2', '⭐⭐'),
        ('3', '⭐⭐⭐'),
        ('4', '⭐⭐⭐⭐'),
        ('5', '⭐⭐⭐⭐⭐'),
    ], string='Note', default=False)
    
    # File d'attente
    queue_id = fields.Many2one('ucm.queue', string='File d\'attente')
    queue_wait_time = fields.Integer(string='Temps attente file (sec)', default=0)
    queue_talk_time = fields.Integer(string='Temps parole (sec)', default=0)
    
    # Champs calculés
    display_name = fields.Char(string='Nom affiché', compute='_compute_display_name_field')
    
    @api.depends('recording_url')
    def _compute_has_recording(self):
        for record in self:
            record.has_recording = bool(record.recording_url)
    
    @api.depends('caller_id', 'caller_name', 'partner_id')
    def _compute_display_name_field(self):
        for record in self:
            if record.partner_id:
                record.display_name = record.partner_id.display_name
            elif record.caller_name:
                record.display_name = f"{record.caller_name} ({record.caller_id})"
            else:
                record.display_name = record.caller_id or _('Inconnu')
    
    @api.model
    def create_or_update_from_middleware(self, vals):
        """Crée ou met à jour un appel depuis les données du middleware"""
        unique_id = vals.get('unique_id')
        if not unique_id:
            return False
        
        # Chercher un appel existant
        call = self.search([('unique_id', '=', unique_id)], limit=1)
        
        # Trouver le contact par numéro de téléphone
        partner = False
        caller_id = vals.get('caller_id')
        if caller_id:
            partner = self.env['res.partner'].search([
                '|',
                ('phone', '=', caller_id),
                ('mobile', '=', caller_id)
            ], limit=1)
        
        # Trouver l'agent par extension
        agent = False
        agent_exten = vals.get('agent_exten')
        if agent_exten:
            agent = self.env['res.users'].search([
                ('ucm_extension', '=', agent_exten)
            ], limit=1)
        
        # Préparer les valeurs
        call_vals = {
            'caller_id': caller_id,
            'caller_name': vals.get('caller_name', ''),
            'partner_id': partner.id if partner else False,
            'callee_id': vals.get('callee_id'),
            'agent_exten': agent_exten,
            'agent_id': agent.id if agent else False,
            'direction': vals.get('direction', 'inbound'),
            'start_date': vals.get('start_date', fields.Datetime.now()),
        }
        
        # Mettre à jour selon le statut
        call_type = vals.get('call_type')
        if call_type == 'answered':
            call_vals['call_type'] = 'answered'
            call_vals['answer_date'] = vals.get('answer_date', fields.Datetime.now())
        elif call_type == 'hangup':
            call_vals['call_type'] = 'hangup'
            call_vals['end_date'] = vals.get('end_date', fields.Datetime.now())
            call_vals['duration'] = vals.get('duration', 0)
            
            # Si enregistrement fourni
            if vals.get('recording_url'):
                call_vals['recording_url'] = vals['recording_url']
                call_vals['recording_duration'] = vals.get('recording_duration', 0)
        elif call_type == 'missed':
            call_vals['call_type'] = 'missed'
            call_vals['end_date'] = vals.get('end_date', fields.Datetime.now())
        
        if call:
            call.write(call_vals)
        else:
            call_vals['unique_id'] = unique_id
            call = self.create(call_vals)
        
        # Poster un message dans le chatter du contact
        if partner and call:
            self._post_to_chatter(partner, call)
        
        return call.id
    
    def _post_to_chatter(self, partner, call):
        """Poste un message dans le chatter du contact"""
        direction_label = dict(self._fields['direction'].selection).get(call.direction, '')
        status_label = dict(self._fields['call_type'].selection).get(call.call_type, '')
        
        duration_str = ''
        if call.duration:
            minutes = call.duration // 60
            seconds = call.duration % 60
            duration_str = f" ({minutes}min {seconds}s)"
        
        message = f"""
            <div style="background: #f8f9fa; padding: 10px; border-left: 3px solid #00A09D; margin: 10px 0;">
                <strong>📞 Appel téléphonique</strong><br/>
                Direction: {direction_label}<br/>
                Statut: {status_label}{duration_str}<br/>
                Numéro: {call.caller_id or 'Inconnu'}<br/>
                Agent: {call.agent_id.name if call.agent_id else call.agent_exten or '-'}<br/>
                Date: {call.start_date.strftime('%d/%m/%Y %H:%M')}
                {f'<br/>Enregistrement: <a href="{call.recording_url}">Écouter</a>' if call.recording_url else ''}
            </div>
        """
        
        partner.message_post(body=message, message_type='notification')
    
    def action_play_recording(self):
        """Ouvre l'enregistrement dans un nouvel onglet"""
        self.ensure_one()
        if not self.recording_url:
            raise UserError(_('Aucun enregistrement disponible'))
        return {
            'type': 'ir.actions.act_url',
            'url': self.recording_url,
            'target': 'new',
        }
    
    def action_view_related_calls(self):
        """Affiche tous les appels pour le même numéro"""
        self.ensure_one()
        return {
            'name': _('Appels pour ce numéro'),
            'type': 'ir.actions.act_window',
            'res_model': 'ucm.call_log',
            'view_mode': 'tree,form',
            'domain': [('caller_id', '=', self.caller_id)],
            'context': {'search_default_caller_id': self.caller_id},
        }
