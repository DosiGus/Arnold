#!/usr/bin/env python3
"""Loopback-only synthetic test endpoint. No health values, no persisted uploads."""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlsplit
SIZES = (2048, 4096, 8192, 16384, 32768)
def payload(n):
    base = {"bytes": n, "padding": ""}
    base["padding"] = "x" * (n - len(json.dumps(base, separators=(',', ':')).encode()))
    return json.dumps(base, separators=(',', ':')).encode()
class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(5)
    def log_message(self, *_): pass
    def reply(self, code, body):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def do_GET(self):
        u = urlsplit(self.path)
        try: n = int(parse_qs(u.query).get('bytes', ['0'])[0])
        except ValueError: n = 0
        if u.path == '/size' and n in SIZES: self.reply(200, payload(n))
        else: self.reply(404, b'{"error":"not_found"}')
    def do_POST(self):
        try: n = int(self.headers.get('Content-Length', '0'))
        except ValueError: n = -1
        if self.path != '/upload' or n < 0 or n > 256:
            self.reply(400, b'{"error":"invalid"}'); self.close_connection = True; return
        try: data = json.loads(self.rfile.read(n))
        except (ValueError, UnicodeDecodeError): data = None
        if data not in ({'probe': 'synthetic-v1'}, {'probe': 'synthetic-bg-v1'}):
            self.reply(400, b'{"error":"synthetic_only"}'); return
        self.reply(200, b'{"ok":true}')
if __name__ == '__main__':
    import sys
    if '--self-test' in sys.argv:
        for n in SIZES:
            raw = payload(n)
            assert len(raw) == n and json.loads(raw)['bytes'] == n
        print('PASS: 5 JSON payloads are exactly 2/4/8/16/32 KiB')
    else:
        print('Synthetic probe endpoint: 127.0.0.1:8813', flush=True)
        HTTPServer(('127.0.0.1', 8813), Handler).serve_forever()
