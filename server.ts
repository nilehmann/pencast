import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import type { AppState, DirectoryEntry, ServerMessage } from './shared/types.ts';

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
const PIN = process.env['PIN'] ?? '1234';

// --- Auth ---
const validTokens = new Set<string>();

function generateToken(): string {
  return crypto.randomUUID();
}

function isAuthenticated(req: http.IncomingMessage, url: URL): boolean {
  const token = url.searchParams.get('token') ?? req.headers['x-auth-token'];
  return typeof token === 'string' && validTokens.has(token);
}

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

// --- Path security ---
function isWithinRoot(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const root = path.resolve(PDF_ROOT);
  return resolved === root || resolved.startsWith(root + path.sep);
}

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

// --- API handler ---
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function handleApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
): void {
  const pathname = url.pathname;

  // POST /api/auth — unauthenticated
  if (req.method === 'POST' && pathname === '/api/auth') {
    readBody(req).then((body) => {
      let pin: string | undefined;
      try { pin = (JSON.parse(body) as { pin?: string }).pin; } catch { /* ignore */ }
      if (pin === PIN) {
        const token = generateToken();
        validTokens.add(token);
        sendJson(res, 200, { token });
      } else {
        sendJson(res, 401, { error: 'Invalid PIN' });
      }
    }).catch(() => { res.writeHead(400); res.end(); });
    return;
  }

  // All other API routes require auth
  if (!isAuthenticated(req, url)) {
    res.writeHead(401);
    res.end('Unauthorized');
    return;
  }

  // GET /api/browse?path=<dir>
  if (req.method === 'GET' && pathname === '/api/browse') {
    const dirParam = url.searchParams.get('path') ?? PDF_ROOT;
    const dirPath = path.resolve(dirParam);

    if (!isWithinRoot(dirPath)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const result: DirectoryEntry[] = entries
      .filter((e) => e.isDirectory() || (e.isFile() && e.name.toLowerCase().endsWith('.pdf')))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map((e) => ({
        name: e.name,
        path: path.join(dirPath, e.name),
        type: e.isDirectory() ? 'folder' : 'file',
      }));

    sendJson(res, 200, result);
    return;
  }

  // GET /api/pdf?path=<filepath>
  if (req.method === 'GET' && pathname === '/api/pdf') {
    const fileParam = url.searchParams.get('path');
    if (!fileParam) {
      res.writeHead(400);
      res.end('Missing path');
      return;
    }

    const filePath = path.resolve(fileParam);

    if (!isWithinRoot(filePath) || !filePath.toLowerCase().endsWith('.pdf')) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const stat = fs.statSync(filePath);
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': stat.size,
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
}

// --- WebSocket server ---
const clients = new Set<WebSocket>();

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  if (!isAuthenticated(req, url)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

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
