/**
 * UberDoodle / DoodleMinds Studio - local CORS proxy for the GenAiPro API.
 *
 * Hardened:
 *  - Binds to 127.0.0.1 only (override with PROXY_HOST at your own risk).
 *  - NOT an open relay: /proxy/genaipro/* only forwards to GENAIPRO_API_URL, and
 *    /proxy/fetch-audio only fetches https URLs whose host is in AUDIO_HOST_ALLOWLIST.
 *  - CORS restricted to localhost dev origins (PROXY_ALLOWED_ORIGINS).
 *  - Request body limit (1 MB) and upstream response limit (50 MB), timeouts.
 *  - Bearer token read from env GENAIPRO_JWT (never hardcode secrets).
 *
 * Run: GENAIPRO_JWT=... node cors-proxy.mjs   (or put it in .env.local)
 */
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import { URL } from 'node:url';

// Minimal .env.local / .env loader (no dependency); real env vars win.
for (const f of ['.env.local', '.env']) {
    try {
        for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
            const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
            if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
        }
    } catch { /* file absent */ }
}

const PORT = Number(process.env.PROXY_PORT || 3002);
const HOST = process.env.PROXY_HOST || '127.0.0.1';
const GENAIPRO_API_URL = new URL(process.env.GENAIPRO_API_URL || 'https://genaipro.vn/api/v1');
const GENAIPRO_JWT = process.env.GENAIPRO_JWT || '';
const MAX_BODY_BYTES = 1 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 50 * 1024 * 1024;
const TIMEOUT_MS = 120_000;

const AUDIO_HOST_ALLOWLIST = (process.env.AUDIO_HOST_ALLOWLIST ||
    'genaipro.vn,*.genaipro.vn,storage.googleapis.com,*.r2.dev,*.cloudfront.net')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

const ALLOWED_ORIGINS = (process.env.PROXY_ALLOWED_ORIGINS ||
    'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://localhost:4173')
    .split(',').map(s => s.trim()).filter(Boolean);

if (!GENAIPRO_JWT) {
    console.warn('[WARN] GENAIPRO_JWT is not set - /proxy/genaipro/* requests will be rejected upstream.');
}

const hostAllowed = (hostname) => {
    const h = hostname.toLowerCase();
    return AUDIO_HOST_ALLOWLIST.some(p => p.startsWith('*.') ? h.endsWith(p.slice(1)) : h === p);
};

const addCorsHeaders = (req, res) => {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('X-Content-Type-Options', 'nosniff');
};

const sendJson = (req, res, status, obj) => {
    addCorsHeaders(req, res);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
};

class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}

const makeRequest = (targetUrl, method, headers, postData = null) => new Promise((resolve, reject) => {
    if (targetUrl.protocol !== 'https:') return reject(new HttpError(400, 'Only https upstreams are allowed'));
    const req = https.request(targetUrl, { method, headers }, (up) => {
        const chunks = [];
        let size = 0;
        up.on('data', (c) => {
            size += c.length;
            if (size > MAX_RESPONSE_BYTES) {
                up.destroy();
                reject(new HttpError(502, 'Upstream response too large'));
                return;
            }
            chunks.push(c);
        });
        up.on('end', () => resolve({ statusCode: up.statusCode || 502, headers: up.headers, body: Buffer.concat(chunks) }));
        up.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new HttpError(504, 'Upstream timeout')));
    if (postData) req.write(postData);
    req.end();
});

const getRequestBody = (req) => new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY_BYTES) { reject(new HttpError(413, 'Request body too large')); req.destroy(); return; }
        chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
});

const proxyToGenAiPro = async (req, res, apiPath, method, body = null) => {
    // Only simple path segments; blocks traversal / host smuggling.
    if (!/^\/[A-Za-z0-9._~\-/]*$/.test(apiPath) || apiPath.includes('..') || apiPath.includes('//')) {
        throw new HttpError(400, 'Invalid API path');
    }
    const target = new URL(GENAIPRO_API_URL.href.replace(/\/$/, '') + apiPath);
    if (target.origin !== GENAIPRO_API_URL.origin) throw new HttpError(400, 'Invalid target');
    new URL(req.url, 'http://localhost').searchParams.forEach((v, k) => {
        if (k !== 'url') target.searchParams.append(k, v);
    });
    const headers = {
        'Authorization': `Bearer ${GENAIPRO_JWT}`,
        'Accept': 'application/json',
        'User-Agent': 'DoodleMinds-Studio-Proxy/1.1',
    };
    if (body !== null) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(body);
    }
    console.log(`[PROXY] ${method} ${target.pathname}`);
    const up = await makeRequest(target, method, headers, body);
    addCorsHeaders(req, res);
    res.writeHead(up.statusCode, { 'Content-Type': up.headers['content-type'] || 'application/json' });
    res.end(up.body);
};

const fetchAudioFile = async (req, res, rawUrl) => {
    let url;
    try { url = new URL(rawUrl); } catch { throw new HttpError(400, 'Invalid url'); }
    if (url.protocol !== 'https:') throw new HttpError(400, 'Only https audio URLs are allowed');
    if (url.username || url.password) throw new HttpError(400, 'Credentials in URL not allowed');
    if (!hostAllowed(url.hostname)) throw new HttpError(403, `Host not in AUDIO_HOST_ALLOWLIST: ${url.hostname}`);
    console.log(`[AUDIO FETCH] ${url.hostname}${url.pathname}`);
    const up = await makeRequest(url, 'GET', { 'User-Agent': 'DoodleMinds-Studio-Proxy/1.1', 'Accept': 'audio/*,*/*' });
    addCorsHeaders(req, res);
    res.writeHead(up.statusCode, {
        'Content-Type': up.headers['content-type'] || 'audio/mpeg',
        'Content-Length': up.body.length,
    });
    res.end(up.body);
};

const server = http.createServer(async (req, res) => {
    try {
        if (req.method === 'OPTIONS') { addCorsHeaders(req, res); res.writeHead(204); res.end(); return; }
        const { pathname, searchParams } = new URL(req.url, 'http://localhost');

        if (pathname === '/proxy/health') {
            return sendJson(req, res, 200, { status: 'ok', timestamp: new Date().toISOString(), version: '1.1.0', tokenConfigured: Boolean(GENAIPRO_JWT) });
        }
        if (pathname === '/proxy/fetch-audio' && req.method === 'GET') {
            const u = searchParams.get('url');
            if (!u) return sendJson(req, res, 400, { error: 'Missing url parameter' });
            return await fetchAudioFile(req, res, u);
        }
        if (pathname.startsWith('/proxy/genaipro/')) {
            const apiPath = pathname.slice('/proxy/genaipro'.length);
            if (req.method === 'GET' || req.method === 'DELETE') return await proxyToGenAiPro(req, res, apiPath, req.method);
            if (req.method === 'POST') return await proxyToGenAiPro(req, res, apiPath, 'POST', await getRequestBody(req));
            return sendJson(req, res, 405, { error: 'Method not allowed' });
        }
        // Legacy "/?url=" open relay removed intentionally.
        return sendJson(req, res, 404, { error: 'Not found', availableEndpoints: ['/proxy/health', '/proxy/genaipro/*', '/proxy/fetch-audio?url=...'] });
    } catch (err) {
        const status = err instanceof HttpError ? err.status : 500;
        console.error(`[PROXY ERROR] ${err.message}`);
        if (!res.headersSent) sendJson(req, res, status, { error: err.message });
        else res.destroy();
    }
});
server.requestTimeout = TIMEOUT_MS + 10_000;
server.headersTimeout = 30_000;

server.listen(PORT, HOST, () => {
    console.log(`Proxy listening on http://${HOST}:${PORT}  (allowed origins: ${ALLOWED_ORIGINS.join(', ')})`);
    console.log(`Audio host allowlist: ${AUDIO_HOST_ALLOWLIST.join(', ')}`);
});

process.on('SIGINT', () => server.close(() => process.exit(0)));
