#!/usr/bin/env python3
"""Render the pilot TLS configuration with an explicit production HSTS setting."""
import os
from pathlib import Path
import sys


def main():
    enabled = os.environ.get('BARGHSA_PILOT_HSTS', 'false')
    if enabled not in {'true', 'false'}:
        sys.exit('BARGHSA_PILOT_HSTS must be true or false')
    if enabled == 'true' and os.environ.get('BARGHSA_DEPLOYMENT_ENV') != 'production':
        sys.exit('Pilot HSTS requires the production deployment environment')

    config = Path(__file__).with_name('nginx.conf').read_text()
    marker = '# BARGHSA_PILOT_HSTS'
    if config.count(marker) != 2:
        sys.exit('Expected HSTS markers in the HTTPS server and its local rate-limit response')
    if enabled == 'true':
        config = config.replace(
            marker,
            'add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;',
        )
    sys.stdout.write(config)


if __name__ == '__main__':
    main()
