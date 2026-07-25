/**
 * Localhost Manager — Control Server
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
const BLUE_TEXT = "\x1b[96m";
const RESET = "\x1b[0m";

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
            const filePath = path.join(tmpdir, 'index.html');
            fs.readFile(filePath, (err, data) => {
                if (err) { res.writeHead(404); res.end('Not found'); return; }
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(data);
            });
        });

        // Track every open socket so we can destroy them instantly on stop.
        // Without this, server.close() waits for keep-alive connections to
        // timeout naturally — which can take 20+ seconds.
        const sockets = new Set();
        server.on('connection', (socket) => {
            sockets.add(socket);
            socket.once('close', () => sockets.delete(socket));
        });

        server.listen(port, '127.0.0.1', () => {
            hostedServers[port] = { server, tmpdir, sockets };
            console.log(`[+] Hosting on http://localhost:${port}`);
            resolve({ ok: true, port, message: `Serving on http://localhost:${port}` });
        });

        server.on('error', (e) => {
            fs.rmSync(tmpdir, { recursive: true, force: true });
            resolve({ ok: false, error: `Could not bind port ${port}: ${e.message}` });
        });
    });
}

// ── Start a multi-file project server ────────────────────────────────────────

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.htm':  'text/html; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.mjs':  'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg':  'image/svg+xml',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
    '.webp': 'image/webp',
    '.ico':  'image/x-icon',
    '.woff': 'font/woff',
    '.woff2':'font/woff2',
    '.ttf':  'font/ttf',
    '.mp4':  'video/mp4',
    '.webm': 'video/webm',
    '.mp3':  'audio/mpeg',
    '.wav':  'audio/wav',
    '.txt':  'text/plain; charset=utf-8',
    '.xml':  'application/xml',
    '.pdf':  'application/pdf',
};

function getMime(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return MIME_TYPES[ext] || 'application/octet-stream';
}

function startMultiServer(port, files, entryFile = 'index.html') {
    return new Promise((resolve) => {
        if (hostedServers[port]) {
            return resolve({ ok: false, error: `Port ${port} is already hosted` });
        }

        // Write every file to the temp directory, creating subdirs as needed
        const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'lm_pro_'));
        console.log(`[MULTI] Writing ${files.length} files to: ${tmpdir}`);
        try {
            for (const file of files) {
                const safePath = file.path.replace(/\.\.\//g, '').replace(/^\/+/, '');
                const dest = path.join(tmpdir, safePath);
                fs.mkdirSync(path.dirname(dest), { recursive: true });
                if (file.encoding === 'base64') {
                    fs.writeFileSync(dest, Buffer.from(file.content, 'base64'));
                } else {
                    fs.writeFileSync(dest, file.content, 'utf8');
                }
                console.log(`[MULTI]   wrote: ${safePath}`);
            }
        } catch (e) {
            fs.rmSync(tmpdir, { recursive: true, force: true });
            return resolve({ ok: false, error: `Failed to write files: ${e.message}` });
        }

        const server = http.createServer((req, res) => {
            let urlPath = req.url.split('?')[0];
            try { urlPath = decodeURIComponent(urlPath); } catch {}
            urlPath = urlPath.replace(/\.\.\//g, '').replace(/^\/+/, '');

            let filePath = path.join(tmpdir, urlPath);
            console.log(`[REQ] ${req.method} ${req.url} -> ${filePath}`);

            try {
                const stat = fs.statSync(filePath);
                if (stat.isDirectory()) {
                    filePath = path.join(filePath, entryFile);
                    console.log(`[DIR] resolved to: ${filePath}`);
                }
            } catch { /* not a directory or doesn't exist */ }

            fs.readFile(filePath, (err, data) => {
                if (err) {
                    console.log(`[404] not found: ${filePath}, falling back to ${entryFile}`);
                    const rootIndex = path.join(tmpdir, entryFile);
                    fs.readFile(rootIndex, (err2, fallbackData) => {
                        if (err2) {
                            console.log(`[404] root index.html also missing!`);
                            res.writeHead(404, { 'Content-Type': 'text/plain' });
                            res.end(`404 Not Found: /${urlPath}`);
                            return;
                        }
                        res.writeHead(200, { 'Content-Type': getMime(rootIndex) });
                        res.end(fallbackData);
                    });
                    return;
                }
                console.log(`[200] ${filePath}`);
                res.writeHead(200, { 'Content-Type': getMime(filePath) });
                res.end(data);
            });
        });

        // Track open sockets for instant stop
        const sockets = new Set();
        server.on('connection', (socket) => {
            sockets.add(socket);
            socket.once('close', () => sockets.delete(socket));
        });

        server.listen(port, '127.0.0.1', () => {
            hostedServers[port] = { server, tmpdir, sockets };
            console.log(`[+] Hosting project (${files.length} files) on http://localhost:${port}`);
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

        // Destroy all open sockets immediately — this is what makes stop instant.
        // server.close() alone waits for keep-alive connections which can linger
        // for 20+ seconds if a browser tab is still open on that port.
        entry.sockets.forEach(s => s.destroy());
        entry.sockets.clear();

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

    if (req.method === 'POST' && url === '/start-multi') {
        const body = await readBody(req);
        const { port, files, entryFile = 'index.html' } = body;

        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            send(res, 400, { ok: false, error: 'Invalid port number' });
            return;
        }
        if (!Array.isArray(files) || files.length === 0) {
            send(res, 400, { ok: false, error: 'No files provided' });
            return;
        }

        const result = await startMultiServer(port, files, entryFile);
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
    console.log(`${BLUE_TEXT}┌───────────────────────────────────────┐${RESET}`);
    console.log(`${BLUE_TEXT}│   Localhost Manager — Control Server  │${RESET}`);
    console.log(`${BLUE_TEXT}│   Listening on http://127.0.0.1:${CONTROL_PORT}  │${RESET}`);
    console.log(`${BLUE_TEXT}│   Keep this terminal open while using │${RESET}`);
    console.log(`${BLUE_TEXT}│   the extension. Ctrl+C to quit.      │${RESET}`);
    console.log(`${BLUE_TEXT}└───────────────────────────────────────┘${RESET}`);
    console.log('');
});

// Graceful shutdown — stop all hosted servers on Ctrl+C
process.on('SIGINT', async () => {
    console.log('\nShutting down all hosted servers...');
    await Promise.all(Object.keys(hostedServers).map(p => stopHostedServer(Number(p))));
    controlServer.close(() => process.exit(0));
});