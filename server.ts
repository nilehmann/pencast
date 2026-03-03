import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import type { AppState } from './shared/types.ts';
import type { ServerMessage } from './shared/types.ts';

// --- CLI arg validation ---
const PDF_ROOT = process.argv[2];
if (!PDF_ROOT) {
  console.error('Usage: tsx server.ts <pdf-root-dir>');
  process.exit(1);
}
if (!fs.existsSync(PDF_ROOT)) {
  console.error(`Error: path does not exist: ${PDF_ROOT}`);
  process.exit(1);
}

const CLIENT_DIR = path.join(import.meta.dirname, 'dist', 'client');
const PORT = 3001;

// --- In-memory state ---
const appState: AppState = {
  activePdfPath: null,
  activePdfName: null,
  pageCount: 0,
  currentSlide: 0,
  annotations: {},
};

// --- MIME types ---
const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.mjs':  'application/javascript',
  '.css':  'text/css',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.json': 'application/json',
  '.pdf':  'application/pdf',
};

// --- HTTP server ---
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // Route API requests
  if (pathname.startsWith('/api/')) {
    handleApi(req, res, url);
    return;
  }

  // Static file serving with SPA fallback
  let filePath = path.join(CLIENT_DIR, pathname);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(CLIENT_DIR, 'index.html');
  }

  const ext = path.extname(filePath);
  const contentType = MIME[ext] ?? 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

function handleApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _url: URL,
): void {
  res.writeHead(404);
  res.end('Not found');
}

// --- WebSocket server ---
const clients = new Set<WebSocket>();

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`WS client connected (total: ${clients.size})`);

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`WS client disconnected (total: ${clients.size})`);
  });

  ws.on('error', (err) => {
    console.error('WS error:', err.message);
  });
});

function broadcast(msg: ServerMessage): void {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

// keep broadcast in scope for later use
void broadcast;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
