# -*- coding: utf-8 -*-
from odoo import models, fields, api


class UcmCallTag(models.Model):
    _name = 'ucm.call.tag'
    _description = 'Tags pour les appels'
    _order = 'name'

    name = fields.Char(string='Nom', required=True)
    color = fields.Integer(string='Couleur')
    
    _sql_constraints = [
        ('name_uniq', 'unique (name)', 'Le nom du tag doit être unique !')
    ]
