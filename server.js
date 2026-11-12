import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 5180;
const MAGPIE_ADDR = process.env.MAGPIE_ADDR || '127.0.0.1:3425';
const MAGPIE_KEY = process.env.MAGPIE_KEY || 'magpie-dashboard';
const BASE = `http://${MAGPIE_ADDR}`;
const MAGPIE_EXE =
  process.env.MAGPIE_EXE ||
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'magpie', 'magpie.exe');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
}

async function magpieGet(pathAndQuery) {
  const res = await fetch(BASE + pathAndQuery, {
    headers: { Authorization: `Bearer ${MAGPIE_KEY}` },
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Magpie ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

const PERIODS = new Set(['today', '7d', '30d', 'all']);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;

  try {
    if (pathname === '/api/hello') {
      const hello = await magpieGet('/api/hello');
      return sendJson(res, 200, { ...hello, addr: MAGPIE_ADDR });
    }

    if (pathname === '/api/usage') {
      const period = url.searchParams.get('period') || 'today';
      if (!PERIODS.has(period)) return sendJson(res, 400, { error: 'period 只能是 today / 7d / 30d / all' });
      return sendJson(res, 200, await magpieGet(`/v1/magpie/usage?period=${period}`));
    }

    if (pathname === '/api/quotas') {
      return sendJson(res, 200, await magpieGet('/v1/magpie/quotas'));
    }

    if (pathname === '/api/export') {
      const period = url.searchParams.get('period') || 'today';
      if (!PERIODS.has(period)) return sendJson(res, 400, { error: 'period 只能是 today / 7d / 30d / all' });

      const { stdout } = await execFileAsync(MAGPIE_EXE, ['usage', '--csv', period], {
        maxBuffer: 64 * 1024 * 1024,
        timeout: 60000,
        windowsHide: true,
      });

      const stamp = new Date().toISOString().slice(0, 10);
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="magpie-usage-${period}-${stamp}.csv"`,
        'Cache-Control': 'no-store',
      });
      res.end('\uFEFF' + stdout);
      return;
    }

    if (pathname.startsWith('/api/')) {
      return sendJson(res, 404, { error: '未知接口' });
    }

    serveStatic(res, pathname);
  } catch (err) {
    const unreachable = err.cause?.code === 'ECONNREFUSED' || /fetch failed/i.test(err.message);
    sendJson(res, unreachable ? 503 : 502, {
      error: unreachable
        ? `连接不上 Magpie 网关（${MAGPIE_ADDR}），请确认 Magpie 正在运行`
        : err.message,
    });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Magpie 用量看板 → http://localhost:${PORT}（仅本机访问）`);
  console.log(`  数据来源: ${BASE}\n`);
});
