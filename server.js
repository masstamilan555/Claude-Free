// Local development server — mirrors Vercel routing
// Usage: node server.js  or  npm run dev
// Opens: http://localhost:3000

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let DEFAULT_PORT = parseInt(process.env.PORT, 10) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.webp': 'image/webp',
};

// Pre-load the API handler
const { default: chatHandler } = await import('./api/chat.js');

const app = (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/';

  // Standard CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // ── API routes ──────────────────────────────────────
  if (pathname === '/api/chat' || pathname === '/api/chat.js') {
    console.log(`[API] ${req.method} ${pathname}`);
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      try {
        const rawBody = Buffer.concat(chunks).toString('utf-8');
        let body = {};
        if (rawBody) {
          try {
            body = JSON.parse(rawBody);
          } catch (jsonErr) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Malformed JSON payload: ' + jsonErr.message }));
            return;
          }
        }

        const mockReq = { method: req.method, body, headers: req.headers, query: Object.fromEntries(parsedUrl.searchParams) };
        const mockRes = {
          _status: 200,
          _headers: {},
          status(code) { this._status = code; return this; },
          setHeader(k, v) { this._headers[k] = v; return this; },
          json(data) {
            res.writeHead(this._status, { 'Content-Type': 'application/json', ...this._headers });
            res.end(JSON.stringify(data));
          },
          end(msg) {
            res.writeHead(this._status, this._headers);
            res.end(msg || '');
          },
        };

        await chatHandler(mockReq, mockRes);
      } catch (err) {
        console.error('API error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message || 'Internal server error' }));
      }
    });

    req.on('error', err => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  // Any other /api/* route that is not found: return JSON 404, NEVER HTML
  if (pathname.startsWith('/api/')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `API route not found: ${pathname}` }));
    return;
  }

  // ── Static files ─────────────────────────────────────
  try {
    const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const filePath = path.join(__dirname, 'public', relativePath);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(fs.readFileSync(filePath));
    } else {
      // SPA fallback
      const indexPath = path.join(__dirname, 'public', 'index.html');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(indexPath));
    }
  } catch (err) {
    console.error('Static error:', err.message);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Server error: ' + err.message);
  }
};

function startServer(port) {
  const server = http.createServer(app);

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`\x1b[33m[Warning]\x1b[0m Port ${port} is in use, trying port ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Server error:', err);
    }
  });

  server.listen(port, () => {
    console.log('\n  \x1b[32m\u2705 Claude AI \u2014 Local Server Running\x1b[0m');
    console.log('  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
    console.log(`  Web UI: \x1b[36mhttp://localhost:${port}\x1b[0m`);
    console.log(`  API:    \x1b[36mhttp://localhost:${port}/api/chat\x1b[0m`);
    console.log('  Press Ctrl+C to stop\n');
  });
}

startServer(DEFAULT_PORT);
