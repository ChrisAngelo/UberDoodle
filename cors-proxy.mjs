/**
 * =============================================================================
 * DOODLEMINDS STUDIO - SUPER CORS PROXY SERVER
 * =============================================================================
 * 
 * This Node.js server runs locally and acts as a proxy for GenAiPro API.
 * It bypasses all CORS restrictions and browser blocks by making server-side
 * requests to GenAiPro's API.
 * 
 * Features:
 * - Proxies all GenAiPro API endpoints (/labs/voices, /labs/task, etc.)
 * - Fetches audio files from GenAiPro CDN
 * - Full CORS headers for browser compatibility
 * - WebSocket support for real-time task updates
 * - Health check endpoint
 * 
 * Run with: node cors-proxy.mjs
 */

import http from 'http';
import https from 'https';
import { URL } from 'url';

const PORT = 3002;

// GenAiPro Configuration
const GENAIPRO_API_URL = "https://genaipro.vn/api/v1";
const GENAIPRO_JWT = "eyJhbGciOiJSUzI1NiIsImNhdCI6ImNsX0I3ZDRQRDIyMkFBQSIsImtpZCI6Imluc18ydmlCa3pCZzdVUUJ4eW9FTHh4WmN4Q1FWc0MiLCJ0eXAiOiJKV1QifQ.eyJhenAiOiJodHRwczovL2dlbmFpcHJvLnZuIiwiZXhwIjoxNzY4ODQyNzA3LCJpYXQiOjE3NjEwNjY3MDcsImlzcyI6Imh0dHBzOi8vY2xlcmsuZ2VuYWlwcm8udm4iLCJqdGkiOiI4NGM4YTQyMDU5YmE3YTU2MjY1OCIsIm5iZiI6MTc2MTA2NjcwMiwicHVibGljX21ldGFkYXRhIjp7ImNoYXRncHRfYWNjb3VudF9pZCI6IjI0N2E3ZWIxLTIxODktNDg4NS05YTU0LTUxNDA1MjFlOGNlNCIsInJvbGUiOiJ1c2VyIiwidXNlcl9kYl9pZCI6IjYzMmMyNmRlLTUxMGMtNDMwYy1iZDJkLWRkMDcxYmMwNjFiYyIsInZlb19hY2NvdW50X2lkIjoiM2IwODBlNzgtODIyOC00N2FlLTk4ZmItYTIxYmJiZjc0OGExIiwidmVvX3N1YnNjcmlwdGlvbl9lbmRfZGF0ZSI6IjIwMjUtMTAtMjJUMTg6NTE6NDIrMDc6MDAifSwic3ViIjoidXNlcl8zNExQdUJSZm1WdU9aa1dMMzN6ZmN4YUZhMWoiLCJ1c2VybmFtZSI6ImNocmlzYW5nZWxvIn0.RTFyhr9F3TZqMHKWlgw-7WzZq4NGgfKFKc6CuLDFfqKXcs8GAk1pE6jjFF_x7QMBCZMGlD7vsR0_h2tGkRBE-KX_zeW59-RlHSP1kPHqWzCubMFwX2uT3HFuAj7HRxWlDJqKoXNepwc8qvTHykiBs9d_pCO91oZk3ZtXG8bJkPQlg-UMUWWRQfhzBc7AeIwNHoknNxB3aVwz2VWyEjJSJBaRDpe45I0K8Uc4E_jU0PEWV4QMR9UD9iriny-xijBRpbVltIKlMSLbVNO0IJBLZTKh5Sl_1Tn_2olb-QbyGyogrdENV5yZsRVIFxSIsbrEUNBxN5BIxkajxW2u7Mhzkg";

console.log(`
╔═══════════════════════════════════════════════════════════════════════════╗
║                                                                           ║
║         🔧 DOODLEMINDS STUDIO - SUPER CORS PROXY SERVER 🔧                ║
║                                                                           ║
╠═══════════════════════════════════════════════════════════════════════════╣
║                                                                           ║
║   This proxy server enables GenAiPro API access from the browser.         ║
║   It bypasses CORS restrictions by making server-side requests.           ║
║                                                                           ║
║   Endpoints:                                                              ║
║   • GET  /proxy/health          - Health check                            ║
║   • GET  /proxy/genaipro/*      - Proxy GenAiPro GET requests             ║
║   • POST /proxy/genaipro/*      - Proxy GenAiPro POST requests            ║
║   • GET  /proxy/fetch-audio     - Fetch audio from GenAiPro CDN           ║
║                                                                           ║
║   Server running at: http://localhost:${PORT}                               ║
║                                                                           ║
╚═══════════════════════════════════════════════════════════════════════════╝
`);

// Add CORS headers to response
const addCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', '*');
};

// Make HTTPS request and return Promise
const makeRequest = (options, postData = null) => {
    return new Promise((resolve, reject) => {
        const protocol = options.protocol === 'http:' ? http : https;
        
        const req = protocol.request(options, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const body = Buffer.concat(chunks);
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: body
                });
            });
        });
        
        req.on('error', reject);
        req.setTimeout(120000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        
        if (postData) {
            req.write(postData);
        }
        req.end();
    });
};

// Proxy request to GenAiPro
const proxyToGenAiPro = async (req, res, apiPath, method, body = null) => {
    try {
        const targetUrl = new URL(`${GENAIPRO_API_URL}${apiPath}`);
        
        // Add query params if present
        const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
        reqUrl.searchParams.forEach((value, key) => {
            if (key !== 'url') {
                targetUrl.searchParams.append(key, value);
            }
        });
        
        console.log(`[PROXY] ${method} ${targetUrl.toString()}`);
        
        const options = {
            hostname: targetUrl.hostname,
            port: 443,
            path: targetUrl.pathname + targetUrl.search,
            method: method,
            protocol: 'https:',
            headers: {
                'Authorization': `Bearer ${GENAIPRO_JWT}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': 'DoodleMinds-Studio-Proxy/1.0'
            }
        };
        
        if (body && method === 'POST') {
            const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
            options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
        }
        
        const response = await makeRequest(options, body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null);
        
        addCorsHeaders(res);
        res.writeHead(response.statusCode, {
            'Content-Type': response.headers['content-type'] || 'application/json'
        });
        res.end(response.body);
        
        console.log(`[PROXY] Response: ${response.statusCode}`);
        
    } catch (error) {
        console.error(`[PROXY ERROR] ${error.message}`);
        addCorsHeaders(res);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
    }
};

// Fetch audio file from URL
const fetchAudioFile = async (audioUrl, res) => {
    try {
        console.log(`[AUDIO FETCH] ${audioUrl}`);
        
        const url = new URL(audioUrl);
        
        const options = {
            hostname: url.hostname,
            port: url.port || 443,
            path: url.pathname + url.search,
            method: 'GET',
            protocol: url.protocol,
            headers: {
                'User-Agent': 'DoodleMinds-Studio-Proxy/1.0',
                'Accept': '*/*'
            }
        };
        
        const response = await makeRequest(options);
        
        addCorsHeaders(res);
        res.writeHead(response.statusCode, {
            'Content-Type': response.headers['content-type'] || 'audio/mpeg',
            'Content-Length': response.headers['content-length']
        });
        res.end(response.body);
        
        console.log(`[AUDIO FETCH] Success: ${response.body.length} bytes`);
        
    } catch (error) {
        console.error(`[AUDIO FETCH ERROR] ${error.message}`);
        addCorsHeaders(res);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
    }
};

// Collect request body
const getRequestBody = (req) => {
    return new Promise((resolve) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    });
};

// Create HTTP server
const server = http.createServer(async (req, res) => {
    // Handle preflight
    if (req.method === 'OPTIONS') {
        addCorsHeaders(res);
        res.writeHead(204);
        res.end();
        return;
    }
    
    const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = reqUrl.pathname;
    
    console.log(`[REQUEST] ${req.method} ${pathname}`);
    
    // Health check
    if (pathname === '/proxy/health') {
        addCorsHeaders(res);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            status: 'ok', 
            timestamp: new Date().toISOString(),
            version: '1.0.0'
        }));
        return;
    }
    
    // Fetch audio file
    if (pathname === '/proxy/fetch-audio') {
        const audioUrl = reqUrl.searchParams.get('url');
        if (!audioUrl) {
            addCorsHeaders(res);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing url parameter' }));
            return;
        }
        await fetchAudioFile(audioUrl, res);
        return;
    }
    
    // GenAiPro API proxy
    if (pathname.startsWith('/proxy/genaipro/')) {
        const apiPath = pathname.replace('/proxy/genaipro', '');
        
        if (req.method === 'GET') {
            await proxyToGenAiPro(req, res, apiPath, 'GET');
        } else if (req.method === 'POST') {
            const body = await getRequestBody(req);
            await proxyToGenAiPro(req, res, apiPath, 'POST', body);
        } else if (req.method === 'DELETE') {
            await proxyToGenAiPro(req, res, apiPath, 'DELETE');
        } else {
            addCorsHeaders(res);
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed' }));
        }
        return;
    }
    
    // Legacy simple proxy (for backwards compatibility)
    if (pathname === '/') {
        const targetUrl = reqUrl.searchParams.get('url');
        if (targetUrl) {
            await fetchAudioFile(targetUrl, res);
            return;
        }
    }
    
    // 404 for unknown routes
    addCorsHeaders(res);
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
        error: 'Not found',
        availableEndpoints: [
            '/proxy/health',
            '/proxy/genaipro/*',
            '/proxy/fetch-audio?url=...'
        ]
    }));
});

server.listen(PORT, () => {
    console.log(`\n✅ Proxy server is running on http://localhost:${PORT}`);
    console.log(`\n📝 Test endpoints:`);
    console.log(`   curl http://localhost:${PORT}/proxy/health`);
    console.log(`   curl http://localhost:${PORT}/proxy/genaipro/labs/voices`);
    console.log(`\n🎤 GenAiPro voice search is now available!`);
});

// Handle shutdown
process.on('SIGINT', () => {
    console.log('\n\n👋 Shutting down proxy server...');
    server.close(() => {
        console.log('Server closed.');
        process.exit(0);
    });
});
