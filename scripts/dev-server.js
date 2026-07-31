/**
 * scripts/dev-server.js
 *
 * DEV-ONLY local server that emulates Vercel's routing for this project.
 *
 * Why this exists: the normal way to run Vercel serverless functions locally
 * is `vercel dev`, but that requires an interactive browser OAuth login,
 * which is not possible in this automated/headless environment. This script
 * is a small stand-in so `api/**` handlers and the static HTML pages
 * (hr-system.html, apply-landing.html, job-detail.html, index.html) can be
 * exercised locally without that login step.
 *
 * It replicates, to the extent this project needs:
 *   - static file serving from the project root
 *   - Vercel's file-based routing for /api/*, including dynamic `[param]`
 *     folder/file segments (e.g. /api/jobs/abc-123/candidates ->
 *     api/jobs/[id]/candidates.js with req.query.id === 'abc-123')
 *   - JSON body parsing for POST/PATCH/PUT/DELETE, exposed as req.body
 *   - req.query as route params merged with the URL query string
 *   - a minimal res.status(code).json(obj) / res.end() API
 *
 * DO NOT use this in production. Production deployment uses real Vercel,
 * which handles this routing natively and correctly; this file is only a
 * local development convenience and has not been hardened for untrusted
 * input, concurrency, or security.
 *
 * Usage: node scripts/dev-server.js  (optionally PORT=xxxx node scripts/dev-server.js)
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Load DATABASE_URL from .env.local, same pattern as scripts/run-sql.js and
// scripts/verify-seed.js, so api/_lib/db.js can find it when handlers import it.
if (!process.env.DATABASE_URL && existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

const PORT = process.env.PORT || 3000;
const ROOT = process.cwd();
const API_ROOT = join(ROOT, 'api');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

/**
 * Walk api/ segment by segment, matching literal files/dirs first and
 * falling back to a single `[param]` dynamic file/dir per level, the same
 * precedence Vercel's file-system router uses.
 */
function resolveApiRoute(segments) {
  let dir = API_ROOT;
  const params = {};

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;

    if (isLast) {
      const literalFile = join(dir, seg + '.js');
      if (existsSync(literalFile) && statSync(literalFile).isFile()) {
        return { file: literalFile, params };
      }
    }

    const literalDir = join(dir, seg);
    if (existsSync(literalDir) && statSync(literalDir).isDirectory()) {
      dir = literalDir;
      if (isLast) {
        const indexFile = join(dir, 'index.js');
        if (existsSync(indexFile)) return { file: indexFile, params };
      }
      continue;
    }

    if (!existsSync(dir) || !statSync(dir).isDirectory()) return null;
    const entries = readdirSync(dir);
    const dynDir = entries.find(e => /^\[.+\]$/.test(e) && statSync(join(dir, e)).isDirectory());
    const dynFile = entries.find(e => /^\[.+\]\.js$/.test(e));

    if (isLast && dynFile) {
      const paramName = dynFile.slice(1, dynFile.indexOf(']'));
      params[paramName] = seg;
      return { file: join(dir, dynFile), params };
    }
    if (dynDir) {
      const paramName = dynDir.slice(1, -1);
      params[paramName] = seg;
      dir = join(dir, dynDir);
      if (isLast) {
        const indexFile = join(dir, 'index.js');
        if (existsSync(indexFile)) return { file: indexFile, params };
      }
      continue;
    }
    return null;
  }
  return null;
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(json);
}

function serveStatic(req, res, pathname) {
  const filePath = pathname === '/' ? '/index.html' : pathname;
  const fullPath = join(ROOT, filePath);
  if (!fullPath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (!existsSync(fullPath) || statSync(fullPath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }
  const ext = extname(fullPath);
  const body = readFileSync(fullPath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  if (!pathname.startsWith('/api/')) {
    return serveStatic(req, res, pathname);
  }

  const segments = pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
  const route = resolveApiRoute(segments);
  if (!route) return send(res, 404, { error: 'Not found' });

  let body;
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        return send(res, 400, { error: 'Invalid JSON body' });
      }
    }
  }

  const query = { ...route.params };
  for (const [k, v] of url.searchParams) query[k] = v;

  const fakeReq = { method: req.method, query, body, headers: req.headers };
  const fakeRes = {
    _status: 200,
    status(code) {
      this._status = code;
      return this;
    },
    json(obj) {
      send(res, this._status, obj);
    },
    end() {
      res.writeHead(this._status);
      res.end();
    }
  };

  try {
    // Cache-bust the dynamic import so edits to handler files are picked up
    // without restarting the dev server.
    const mod = await import(pathToFileURL(route.file).href + `?t=${Date.now()}`);
    await mod.default(fakeReq, fakeRes);
  } catch (err) {
    console.error('Handler error:', err);
    if (!res.headersSent) send(res, 500, { error: 'Internal server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Dev server running at http://localhost:${PORT}`);
  console.log('(dev-only Vercel routing shim -- do not use in production)');
});
