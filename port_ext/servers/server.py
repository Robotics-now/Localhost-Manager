#!/usr/bin/env python3
"""
Localhost Manager — Control Server (Python)
Run once in the background: python3 server.py

Exposes a local REST API on http://127.0.0.1:8765 that the
Chrome extension uses to start/stop real HTTP servers.

This is a drop-in equivalent of server.js for anyone who'd rather
run the control server in Python instead of Node.js. Same endpoints,
same JSON shapes, same instant-stop behavior — only the runtime differs.

Endpoints:
  POST /start  { "port": 9000, "content": "<html>..." }  -> starts server on that port
  POST /stop   { "port": 9000 }                           -> stops server on that port
  GET  /status                                             -> lists active hosted ports

Uses only the Python standard library — no pip install required.
"""

import json
import os
import shutil
import signal
import socket
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CONTROL_PORT = 8765

# Registry of active hosted servers.
# Maps port number (int) -> dict with keys: server, thread, tmpdir, sockets
hosted_servers = {}
hosted_servers_lock = threading.Lock()


# ── Hosted file server ───────────────────────────────────────────────────────
# Each hosted port gets its own ThreadingHTTPServer instance serving a single
# index.html out of a temp directory. We track every accepted socket so we
# can force-close them on stop instead of waiting for keep-alive timeouts,
# which is what made the original Node version take 20+ seconds to stop.

class _SocketTrackingServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.open_sockets = set()
        self.open_sockets_lock = threading.Lock()

    def get_request(self):
        sock, addr = super().get_request()
        with self.open_sockets_lock:
            self.open_sockets.add(sock)
        return sock, addr

    def shutdown_request(self, request):
        with self.open_sockets_lock:
            self.open_sockets.discard(request)
        super().shutdown_request(request)

    def force_close_all_sockets(self):
        """Immediately destroy every open connection. Called on stop so we
        don't have to wait for browser keep-alive connections to time out."""
        with self.open_sockets_lock:
            sockets = list(self.open_sockets)
            self.open_sockets.clear()
        for sock in sockets:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                sock.close()
            except OSError:
                pass


def _make_hosted_handler(tmpdir):
    """Returns a request handler class bound to the given temp directory,
    always serving index.html regardless of the requested path."""

    class HostedFileHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            self._serve_index()

        def do_HEAD(self):
            self._serve_index(head_only=True)

        def _serve_index(self, head_only=False):
            index_path = os.path.join(tmpdir, 'index.html')
            try:
                with open(index_path, 'rb') as f:
                    data = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                if not head_only:
                    self.wfile.write(data)
            except (FileNotFoundError, OSError):
                self.send_response(404)
                self.send_header('Content-Type', 'text/plain')
                self.end_headers()
                if not head_only:
                    self.wfile.write(b'Not found')

        def log_message(self, fmt, *args):
            pass  # silence per-request access logs

    return HostedFileHandler


def start_hosted_server(port, html_content):
    """Writes html_content to a temp file and binds a server on the given
    port. Returns a dict matching the JSON shape the extension expects."""
    with hosted_servers_lock:
        if port in hosted_servers:
            return {"ok": False, "error": f"Port {port} is already hosted"}

    tmpdir = tempfile.mkdtemp(prefix='lm_pro_')
    index_path = os.path.join(tmpdir, 'index.html')
    with open(index_path, 'w', encoding='utf-8') as f:
        f.write(html_content)

    handler_cls = _make_hosted_handler(tmpdir)

    try:
        server = _SocketTrackingServer(('127.0.0.1', port), handler_cls)
    except OSError as e:
        shutil.rmtree(tmpdir, ignore_errors=True)
        return {"ok": False, "error": f"Could not bind port {port}: {e}"}

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    with hosted_servers_lock:
        hosted_servers[port] = {
            "server": server,
            "thread": thread,
            "tmpdir": tmpdir,
        }

    print(f"[+] Hosting on http://localhost:{port}")
    return {"ok": True, "port": port, "message": f"Serving on http://localhost:{port}"}


def stop_hosted_server(port):
    """Force-closes all connections, shuts down the server, removes the temp
    directory, and returns a dict matching the JSON shape the extension expects."""
    with hosted_servers_lock:
        entry = hosted_servers.pop(port, None)

    if entry is None:
        return {"ok": False, "error": f"No server running on port {port}"}

    # Destroy all open sockets immediately — this is what makes stop instant.
    # shutdown() alone waits for keep-alive connections, which can linger
    # for 20+ seconds if a browser tab is still open on that port.
    entry["server"].force_close_all_sockets()
    entry["server"].shutdown()
    entry["server"].server_close()
    shutil.rmtree(entry["tmpdir"], ignore_errors=True)

    print(f"[-] Stopped http://localhost:{port}")
    return {"ok": True, "port": port, "message": f"Stopped server on port {port}"}


def get_active_ports():
    with hosted_servers_lock:
        return list(hosted_servers.keys())


# ── Control server ───────────────────────────────────────────────────────────
# A single HTTP server on CONTROL_PORT exposing /status, /start, /stop.
# CORS is required since the extension popup runs on a chrome-extension://
# origin.

class ControlHandler(BaseHTTPRequestHandler):

    def _set_cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def _send_json(self, status, obj):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(status)
        self._set_cors()
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self):
        length = int(self.headers.get('Content-Length', 0))
        raw = self.rfile.read(length) if length > 0 else b''
        try:
            return json.loads(raw.decode('utf-8'))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return {}

    def do_OPTIONS(self):
        # CORS preflight
        self.send_response(204)
        self._set_cors()
        self.end_headers()

    def do_GET(self):
        path = self.path.split('?')[0]

        if path == '/status':
            self._send_json(200, {"ok": True, "activePorts": get_active_ports()})
            return

        self._send_json(404, {"ok": False, "error": "Unknown endpoint"})

    def do_POST(self):
        path = self.path.split('?')[0]

        if path == '/start':
            body = self._read_json_body()
            port = body.get('port')
            content = body.get('content')

            if not isinstance(port, int) or isinstance(port, bool) or not (1 <= port <= 65535):
                self._send_json(400, {"ok": False, "error": "Invalid port number"})
                return
            if not isinstance(content, str) or content.strip() == '':
                self._send_json(400, {"ok": False, "error": "No HTML content provided"})
                return

            result = start_hosted_server(port, content)
            self._send_json(200 if result["ok"] else 400, result)
            return

        if path == '/stop':
            body = self._read_json_body()
            port = body.get('port')

            if not isinstance(port, int) or isinstance(port, bool):
                self._send_json(400, {"ok": False, "error": "Invalid port number"})
                return

            result = stop_hosted_server(port)
            self._send_json(200 if result["ok"] else 400, result)
            return

        self._send_json(404, {"ok": False, "error": "Unknown endpoint"})

    def log_message(self, fmt, *args):
        pass  # silence per-request access logs on the control server too


class ControlServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def shutdown_all_and_exit(*_args):
    print("\nShutting down all hosted servers...")
    with hosted_servers_lock:
        ports = list(hosted_servers.keys())
    for port in ports:
        stop_hosted_server(port)
    sys.exit(0)


def main():
    signal.signal(signal.SIGINT, shutdown_all_and_exit)

    control_server = ControlServer(('127.0.0.1', CONTROL_PORT), ControlHandler)

    print()
    print('┌───────────────────────────────────────┐')
    print('│   Localhost Manager — Control Server   │')
    print(f'│   Listening on http://127.0.0.1:{CONTROL_PORT} │')
    print('│   Keep this terminal open while using  │')
    print('│   the extension. Ctrl+C to quit.       │')
    print('└───────────────────────────────────────┘')
    print()

    control_server.serve_forever()


if __name__ == '__main__':
    main()