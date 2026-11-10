#!/usr/bin/env python3
"""Set the temporary synthetic HTTPS endpoint. URL stays out of Git."""
import json
import sys
from pathlib import Path
from urllib.parse import urlsplit
url = sys.argv[1].rstrip('/') if len(sys.argv) == 2 else ''
p = urlsplit(url)
if url and (p.scheme != 'https' or not p.hostname or p.username or p.password or p.query or p.fragment):
    raise SystemExit('Expected an HTTPS base URL without credentials, query or fragment')
(Path(__file__).resolve().parents[1] / 'source/ProbeConfig.mc').write_text(
    'import Toybox.Lang;\n(:background) module ProbeConfig { var URL as String = ' + json.dumps(url) + '; }\n')
print('Temporary probe endpoint configured' if url else 'Probe endpoint cleared')
