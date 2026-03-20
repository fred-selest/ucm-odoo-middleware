# -*- coding: utf-8 -*-
{
    'name': 'UCM Connector - Grandstream CTI',
    'version': '16.0.1.0.0',
    'category': 'Productivity/Communications',
    'summary': 'Intégration téléphonique Grandstream UCM6300 avec Odoo',
    'description': """
UCM Connector - Intégration Grandstream UCM6300
================================================

Ce module connecte Odoo au PBX Grandstream UCM6300 via WebSocket pour :

* Popup contact sur appel entrant
* Click-to-call depuis Odoo
* Historique des appels dans le chatter
* Synchronisation des enregistrements d'appels
* Gestion des files d'attente (call queues)
* Statuts des agents en temps réel

Configuration
-------------
1. Installer le middleware UCM-Odoo (port 3000)
2. Configurer l'URL du middleware dans les paramètres
3. Associer les extensions aux utilisateurs Odoo
    """,
    'author': 'Selest Informatique',
    'website': 'https://www.selest.info',
    'license': 'LGPL-3',
    'depends': [
        'base',
        'mail',
        'web',
        'phone_validation',
    ],
    'data': [
        'security/ir.model.access.csv',
        'data/ucm_connector_data.xml',
        'views/ucm_call_log_views.xml',
        'views/ucm_agent_status_views.xml',
        'views/ucm_queue_views.xml',
        'views/res_partner_views.xml',
        'views/res_users_views.xml',
        'views/ucm_connector_views.xml',
        'wizard/configure_wizard_views.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'ucm_connector/static/src/js/**/*.js',
            'ucm_connector/static/src/xml/**/*.xml',
            'ucm_connector/static/src/scss/**/*.scss',
        ],
    },
    'installable': True,
    'application': False,
    'auto_install': False,
}
