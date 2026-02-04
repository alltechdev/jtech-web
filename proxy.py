#!/usr/bin/env python3
"""CORS proxy for Discourse API. Uses cloudscraper to handle Cloudflare."""

import http.server
import json
import sys
import cloudscraper

TARGET = "https://forums.jtechforums.org"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080

# Persistent session to maintain Cloudflare clearance cookies
scraper = cloudscraper.create_scraper()


class ProxyHandler(http.server.BaseHTTPRequestHandler):
    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Session-Token, X-CSRF-Token")
        self.send_header("Access-Control-Expose-Headers", "X-Session-Token, X-CSRF-Token")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def _proxy(self, method):
        url = TARGET + self.path
        content_len = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_len) if content_len > 0 else None

        # Build headers for upstream
        fwd = {"Accept": "application/json"}
        ct = self.headers.get("Content-Type")
        if ct:
            fwd["Content-Type"] = ct

        # Session token -> cookie
        token = self.headers.get("X-Session-Token")
        if token:
            scraper.cookies.set("_t", token, domain="forums.jtechforums.org")

        # CSRF
        csrf = self.headers.get("X-CSRF-Token")
        if csrf:
            fwd["X-CSRF-Token"] = csrf

        try:
            resp = scraper.request(method, url, headers=fwd, data=body, timeout=30, allow_redirects=True)

            self.send_response(resp.status_code)
            self._cors_headers()
            self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))

            # Extract _t cookie
            t_cookie = resp.cookies.get("_t")
            if t_cookie:
                self.send_header("X-Session-Token", t_cookie)

            # Forward CSRF
            resp_csrf = resp.headers.get("X-CSRF-Token")
            if resp_csrf:
                self.send_header("X-CSRF-Token", resp_csrf)

            self.end_headers()
            self.wfile.write(resp.content)
        except Exception as e:
            self.send_response(502)
            self._cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def do_GET(self): self._proxy("GET")
    def do_POST(self): self._proxy("POST")
    def do_PUT(self): self._proxy("PUT")
    def do_PATCH(self): self._proxy("PATCH")
    def do_DELETE(self): self._proxy("DELETE")

    def log_message(self, fmt, *args):
        sys.stderr.write(f"[proxy] {fmt % args}\n")


if __name__ == "__main__":
    server = http.server.HTTPServer(("0.0.0.0", PORT), ProxyHandler)
    print(f"CORS proxy listening on :{PORT} -> {TARGET}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
