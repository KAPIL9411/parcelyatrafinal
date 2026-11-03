#!/usr/bin/env node
/**
 * A static server for `ios/dist`, for checking the PWA on a phone or in a browser before deploying it.
 *
 * It is not a development server in the Metro sense: it serves the same files Vercel would, with the
 * same rules (deep links fall back to the document, hashed files cache forever, the worker and the
 * document never do), so what you see here is what ships.
 *
 * Optional `--api <origin>` mirrors the recommended production topology: `/v1` and `/socket.io` are
 * proxied onto the API so the browser sees one origin. That matters more than it sounds — iOS Safari
 * drops a cross-site session cookie, so a PWA served from one host and calling an API on another cannot
 * keep you signed in. Proxying is the only way to exercise the real cookie flow without deploying.
 */

import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIST = path.resolve(HERE, '..', 'dist');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function safeJoin(rootDir, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const target = path.resolve(rootDir, `.${decoded === '/' ? '/index.html' : decoded}`);
  if (target !== rootDir && !target.startsWith(rootDir + path.sep)) return null;
  return target;
}

function cacheHeaders(pathname) {
  if (pathname.startsWith('/_expo/') || pathname.startsWith('/assets/') || pathname.startsWith('/icons/')) {
    return 'public, max-age=31536000, immutable';
  }
  if (pathname === '/sw.js' || pathname.endsWith('.html') || pathname.endsWith('.webmanifest') || pathname === '/pwa-chrome.js') {
    return 'public, max-age=0, must-revalidate';
  }
  return 'public, max-age=0, must-revalidate';
}

/**
 * Forward API traffic to a real backend so the browser sees one origin.
 *
 * Raw piping, not fetch: document uploads go through here as PUT bodies of several megabytes, and the
 * session cookie has to survive the hop in both directions. Over plain http the `Secure` flag is
 * stripped, because no browser sends a Secure cookie to http://localhost:8080 and the whole point is to
 * test the cookie path.
 */
function upstreamTransport(target) {
  return target.startsWith('https://') ? https : http;
}

function proxyTo(target, req, res) {
  const upstream = new URL(req.url, target);
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;
  if (target.startsWith('https://')) delete headers['accept-encoding'];

  const upstreamRequest = upstreamTransport(target).request(
    upstream,
    {
      method: req.method,
      headers: {
        ...headers,
        origin: target,
        referer: `${target}/`,
      },
    },
    (upstreamResponse) => {
      const cookies = upstreamResponse.headers['set-cookie'];
      if (cookies && !target.startsWith('https://')) {
        upstreamResponse.headers['set-cookie'] = cookies.map((c) => c.replace(/;\s*Secure/i, '').replace(/;\s*SameSite=None/i, '; SameSite=Lax'));
      }
      res.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(res);
    },
  );

  upstreamRequest.on('error', (error) => {
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { code: 'UPSTREAM_UNAVAILABLE', message: error.message } }));
  });
  req.pipe(upstreamRequest);
}

export function createHandler({ dist, api }) {
  const rootDir = path.resolve(dist);
  const apiTarget = api ? api.replace(/\/+$/, '') : null;
  const proxied = (url) => apiTarget && (/^\/v1(\/|$|\?)/.test(url) || /^\/socket\.io(\/|$|\?)/.test(url));

  return (req, res) => {
    if (proxied(req.url)) {
      if (req.method === 'OPTIONS') {
        // Same-origin in the browser, so preflight should not happen; answer it anyway so a stray
        // custom header shows up as a clean 204 rather than a confusing 405 from the static server.
        res.writeHead(204, { 'content-length': '0' });
        res.end();
        return;
      }
      proxyTo(apiTarget, req, res);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Method not allowed');
      return;
    }

    const wantsHtml = !path.extname(req.url.split('?')[0]);
    const file = safeJoin(rootDir, req.url);
    if (!file) {
      res.writeHead(400);
      res.end('Bad path');
      return;
    }

    const serve = (target) => {
      res.writeHead(200, {
        'content-type': TYPES[path.extname(target)] ?? 'application/octet-stream',
        'cache-control': cacheHeaders(req.url.split('?')[0]),
      });
      fs.createReadStream(target).pipe(res);
    };

    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      serve(file);
      return;
    }
    if (wantsHtml || req.headers.accept?.includes('text/html')) {
      const shell = path.join(rootDir, 'index.html');
      if (fs.existsSync(shell)) {
        serve(shell);
        return;
      }
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  };
}

export function startServer({ dist = DEFAULT_DIST, api = process.env.PY_PROXY_API, port = Number(process.env.PORT ?? 8080), host = '0.0.0.0' } = {}) {
  if (!fs.existsSync(path.resolve(dist, 'index.html'))) {
    console.error('[ios/serve] dist/index.html is missing — run `node scripts/build.mjs` first.');
    process.exit(1);
  }
  const server = http.createServer(createHandler({ dist, api }));

  // Socket.IO prefers a websocket; without this the client silently falls back to long polling, which
  // works but changes what a live-tracking test is actually proving.
  if (api) {
    server.on('upgrade', (req, clientSocket) => {
      const upstream = new URL(req.url, api);
      const target = upstreamTransport(api).request({
        hostname: upstream.hostname,
        port: upstream.port || (upstream.protocol === 'https:' ? 443 : 80),
        path: upstream.pathname + upstream.search,
        headers: { ...req.headers, host: upstream.host },
      });
      target.on('upgrade', (response, upstreamSocket) => {
        clientSocket.write(
          `HTTP/1.1 101 Switching Protocols\r\nUpgrade: ${response.headers.upgrade}\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${response.headers['sec-websocket-accept'] || ''}\r\n\r\n`,
        );
        upstreamSocket.pipe(clientSocket);
        clientSocket.pipe(upstreamSocket);
      });
      target.on('error', () => clientSocket.destroy());
      req.pipe(target);
    });
  }

  server.listen(port, host, () => {
    const lan = Object.values(os.networkInterfaces())
      .flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal)
      .map((i) => i.address);
    console.log(`\n[ios/serve] ${path.resolve(dist)}`);
    console.log(`[ios/serve] http://localhost:${port}`);
    if (api) console.log(`[ios/serve] /v1 and /socket.io proxied to ${api}`);
    else console.log('[ios/serve] no --api: /v1 calls leave this origin, so the session cookie will not stick');
    const phone = lan.find((a) => !a.startsWith('127.'));
    if (phone) console.log(`[ios/serve] on your network (iPhone can open this): http://${phone}:${port}`);
    console.log('[ios/serve] Ctrl+C to stop\n');
  });
  return server;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const flagValue = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  startServer({
    dist: flagValue('dist') ?? DEFAULT_DIST,
    api: flagValue('api') ?? process.env.PY_PROXY_API,
    port: Number(flagValue('port') ?? process.env.PORT ?? 8080),
  });
}
