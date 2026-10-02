// Local development server — mirrors Vercel routing
// Usage: node server.js
// Opens: http://localhost:3000

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
};

// Pre-load the API handler
const { default: chatHandler } = await import('./api/chat.js');

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  console.log(`[${req.method}] ${url}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // ── API routes ──────────────────────────────────────
  if (url === '/api/chat' || url === '/api/chat.js') {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      try {
        const rawBody = Buffer.concat(chunks).toString();
        const body = rawBody ? JSON.parse(rawBody) : {};
        const mockReq = { method: req.method, body };
        const mockRes = {
          _status: 200,
          _headers: {},
          status(code) { this._status = code; return this; },
          setHeader(k, v) { this._headers[k] = v; },
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
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    req.on('error', err => {
      res.writeHead(400);
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  // ── Static files ─────────────────────────────────────
  try {
    const filePath = url === '/'
      ? path.join(__dirname, 'public', 'index.html')
      : path.join(__dirname, 'public', url);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
      res.end(fs.readFileSync(filePath));
    } else {
      // SPA fallback
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(path.join(__dirname, 'public', 'index.html')));
    }
  } catch (err) {
    console.error('Static error:', err.message);
    res.writeHead(500);
    res.end('Server error: ' + err.message);
  }
});

server.listen(PORT, () => {
  console.log('\n  \x1b[32m✅ Claude AI — Local Server\x1b[0m');
  console.log('  ─────────────────────────────────');
  console.log(`  Open: \x1b[36mhttp://localhost:${PORT}\x1b[0m`);
  console.log('  API:  \x1b[36mhttp://localhost:3000/api/chat\x1b[0m');
  console.log('\n  Press Ctrl+C to stop\n');
});
