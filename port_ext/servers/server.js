/**
 * Localhost Manager Pro — Control Server
 * Run once in the background: node server.js
 *
 * Exposes a local REST API on http://127.0.0.1:8765 that the
 * Chrome extension uses to start/stop real HTTP servers.
 *
 * Endpoints:
 *   POST /start  { port: 9000, content: "<html>..." }  → starts server on that port
 *   POST /stop   { port: 9000 }                        → stops server on that port
 *   GET  /status                                        → lists active hosted ports
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const CONTROL_PORT = 8765;

// Registry of active hosted servers
// Maps port number → { server: http.Server, tmpdir: string }
const hostedServers = {};

// ── CORS helper ──────────────────────────────────────────────────────────────
// The extension popup runs in a chrome-extension:// origin so we need CORS.

function setCORS(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try { resolve(JSON.parse(body)); }
            catch { resolve({}); }
        });
        req.on('error', reject);
    });
}

function send(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(body);
}

// ── Start a hosted server ────────────────────────────────────────────────────

function startHostedServer(port, htmlContent) {
    return new Promise((resolve) => {
        if (hostedServers[port]) {
            return resolve({ ok: false, error: `Port ${port} is already hosted` });
        }

        // Write the HTML to a temp file
        const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'lm_pro_'));
        fs.writeFileSync(path.join(tmpdir, 'index.html'), htmlContent, 'utf8');

        const server = http.createServer((req, res) => {
            // Serve index.html for any request (single-file host)
            const filePath = path.join(tmpdir, 'index.html');
            fs.readFile(filePath, (err, data) => {
                if (err) {
                    res.writeHead(404);
                    res.end('Not found');
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(data);
            });
        });

        server.listen(port, '127.0.0.1', () => {
            hostedServers[port] = { server, tmpdir };
            console.log(`[+] Hosting on http://localhost:${port}`);
            resolve({ ok: true, port, message: `Serving on http://localhost:${port}` });
        });

        server.on('error', (e) => {
            fs.rmSync(tmpdir, { recursive: true, force: true });
            resolve({ ok: false, error: `Could not bind port ${port}: ${e.message}` });
        });
    });
}

// ── Stop a hosted server ─────────────────────────────────────────────────────

function stopHostedServer(port) {
    return new Promise((resolve) => {
        const entry = hostedServers[port];
        if (!entry) {
            return resolve({ ok: false, error: `No server running on port ${port}` });
        }

        entry.server.close(() => {
            fs.rmSync(entry.tmpdir, { recursive: true, force: true });
            delete hostedServers[port];
            console.log(`[-] Stopped http://localhost:${port}`);
            resolve({ ok: true, port, message: `Stopped server on port ${port}` });
        });
    });
}

// ── Control server ───────────────────────────────────────────────────────────

const controlServer = http.createServer(async (req, res) => {
    setCORS(res);

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = req.url.split('?')[0];

    if (req.method === 'GET' && url === '/status') {
        send(res, 200, { ok: true, activePorts: Object.keys(hostedServers).map(Number) });
        return;
    }

    if (req.method === 'POST' && url === '/start') {
        const body = await readBody(req);
        const { port, content } = body;

        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            send(res, 400, { ok: false, error: 'Invalid port number' });
            return;
        }
        if (typeof content !== 'string' || content.trim() === '') {
            send(res, 400, { ok: false, error: 'No HTML content provided' });
            return;
        }

        const result = await startHostedServer(port, content);
        send(res, result.ok ? 200 : 400, result);
        return;
    }

    if (req.method === 'POST' && url === '/stop') {
        const body = await readBody(req);
        const { port } = body;

        if (!Number.isInteger(port)) {
            send(res, 400, { ok: false, error: 'Invalid port number' });
            return;
        }

        const result = await stopHostedServer(port);
        send(res, result.ok ? 200 : 400, result);
        return;
    }

    send(res, 404, { ok: false, error: 'Unknown endpoint' });
});

controlServer.listen(CONTROL_PORT, '127.0.0.1', () => {
    console.log('');
    console.log('┌──────────────────────────────────────────┐');
    console.log('│   Localhost Manager Pro — Control Server │');
    console.log(`│   Listening on http://127.0.0.1:${CONTROL_PORT}    │`);
    console.log('│   Keep this terminal open while using    │');
    console.log('│   the extension. Ctrl+C to quit.         │');
    console.log('└──────────────────────────────────────────┘');
    console.log('');
});

// Graceful shutdown — stop all hosted servers on Ctrl+C
process.on('SIGINT', async () => {
    console.log('\nShutting down all hosted servers...');
    await Promise.all(Object.keys(hostedServers).map(p => stopHostedServer(Number(p))));
    controlServer.close(() => process.exit(0));
});