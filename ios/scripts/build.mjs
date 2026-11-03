#!/usr/bin/env node
/**
 * Builds the iPhone PWA.
 *
 * The app itself is `apps/mobile`, exported for the browser by Metro. Everything that makes it an
 * installable web app — icons, manifest, service worker, iOS status-bar metadata, the offline page —
 * does not exist in React Native and is produced here, after the export, into `ios/dist`.
 *
 * `ios/dist` is generated output. Never edit it by hand; every file in it is rewritten by this script.
 */

import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IOS_DIR = path.resolve(HERE, '..');
const ROOT_DIR = path.resolve(IOS_DIR, '..');
const MOBILE_DIR = path.join(ROOT_DIR, 'apps', 'mobile');
const DIST = path.join(IOS_DIR, 'dist');
const PUBLIC_DIR = path.join(IOS_DIR, 'public');

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(`--${name}`);

function fail(message) {
  console.error(`\n[ios/build] ${message}\n`);
  process.exit(1);
}

function step(label) {
  console.log(`\n[ios/build] ${label}`);
}

const config = JSON.parse(fs.readFileSync(path.join(IOS_DIR, 'app.json'), 'utf8'));

// `ios/.env.local` holds the same keys as `ios/.env.example`, for a build you never commit. Node's
// loader does not override a real environment variable, so a hosting platform's settings win.
for (const file of ['.env.local', '.env']) {
  const envPath = path.join(IOS_DIR, file);
  if (!fs.existsSync(envPath)) continue;
  process.loadEnvFile(envPath);
  console.log(`[ios/build] loaded ${file}`);
}

// ---------------------------------------------------------------------------
// 1. Which backend does this build talk to?
// ---------------------------------------------------------------------------
// Metro inlines EXPO_PUBLIC_* at build time, so the value is baked into dist/ and cannot be changed
// by a hosting environment variable after the fact. A leading '/' means same-origin, which is the
// configuration the session cookie needs on iOS Safari — see README.md.
const apiBase =
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  process.env.EXPO_PUBLIC_API_BASE ??
  config.api.defaultBaseUrl;

const isDev = hasFlag('dev');

// ---------------------------------------------------------------------------
// 2. Metro export
// ---------------------------------------------------------------------------
function runExport() {
  step(`exporting apps/mobile for web (${isDev ? 'development' : 'production'})`);
  // Windows holds a brief lock on a directory an indexer or explorer just touched; retry rather than
  // fail the build for it.
  fs.rmSync(DIST, { recursive: true, force: true, maxRetries: 8, retryDelay: 400 });

  const cli = path.join(ROOT_DIR, 'node_modules', 'expo', 'bin', 'cli');
  if (!fs.existsSync(cli)) fail(`Expo CLI not found at ${cli} — run npm ci at the repository root first.`);

  const args = [cli, 'export', '--platform', 'web', '--output-dir', DIST];
  if (isDev) args.push('--dev', '--no-minify');

  const result = spawnSync(process.execPath, args, {
    cwd: MOBILE_DIR,
    stdio: 'inherit',
    env: {
      ...process.env,
      EXPO_PUBLIC_API_BASE_URL: apiBase,
      NODE_ENV: isDev ? 'development' : 'production',
    },
  });
  if (result.status !== 0) fail(`expo export exited with code ${result.status ?? result.error?.code}.`);
  if (!fs.existsSync(path.join(DIST, 'index.html'))) fail('expo export finished but dist/index.html is missing.');
}

if (hasFlag('skip-export')) {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) fail('--skip-export needs an existing dist/; run the build once without it.');
  step('reusing the existing dist/ (--skip-export)');
} else {
  runExport();
}

// ---------------------------------------------------------------------------
// 3. Static files that live in ios/public
// ---------------------------------------------------------------------------
function copyPublicFiles() {
  step('copying ios/public');
  if (!fs.existsSync(PUBLIC_DIR)) return [];
  const copied = [];
  for (const entry of fs.readdirSync(PUBLIC_DIR)) {
    const from = path.join(PUBLIC_DIR, entry);
    if (!fs.statSync(from).isFile()) continue;
    fs.copyFileSync(from, path.join(DIST, entry));
    copied.push(`/${entry}`);
  }
  return copied;
}

const publicFiles = copyPublicFiles();
if (!publicFiles.includes('/offline.html')) fail('ios/public/offline.html is missing — the offline fallback needs it.');

// ---------------------------------------------------------------------------
// 4. Icons
// ---------------------------------------------------------------------------
async function buildIcons() {
  step('rasterising icons');
  const sharp = require('sharp');
  const iconDir = path.join(DIST, 'icons');
  fs.mkdirSync(iconDir, { recursive: true });

  const sourcePath = path.resolve(IOS_DIR, config.iconSource);
  if (!fs.existsSync(sourcePath)) fail(`icon source not found at ${sourcePath}`);

  const sizes = [
    ['icon-180.png', 180],
    ['icon-192.png', 192],
    ['icon-512.png', 512],
  ];
  for (const [name, size] of sizes) {
    await sharp(sourcePath).resize(size, size, { fit: 'cover' }).png().toFile(path.join(iconDir, name));
  }

  // A maskable icon is a full-bleed background with the mark inside the inner 80% circle; the browser
  // crops the rest, so the mark must be letterboxed rather than edge-to-edge.
  const maskable = 512;
  const inset = Math.round(maskable * 0.1);
  const mark = await sharp(sourcePath).resize(maskable - inset * 2, maskable - inset * 2, { fit: 'contain' }).png().toBuffer();
  await sharp({
    create: { width: maskable, height: maskable, channels: 4, background: config.backgroundColor },
  })
    .composite([{ input: mark, gravity: 'centre' }])
    .png()
    .toFile(path.join(iconDir, 'icon-maskable-512.png'));

  return sizes.map(([name]) => `/icons/${name}`).concat('/icons/icon-maskable-512.png');
}

const iconFiles = await buildIcons();

// ---------------------------------------------------------------------------
// 4b. The wordmark on the launch screen
// ---------------------------------------------------------------------------
// expo-splash-screen is native-only, so an exported document used to show a plain blue rectangle
// until the fonts and session had settled. Inlining the wordmark means it paints with the first
// byte of HTML - no extra request, no 404, and it still appears when the worker serves the shell
// offline. It is downscaled to 3x the 180 dp it is drawn at, not shipped at its 1024 px source size.
const SPLASH_WORDMARK_WIDTH_PX = 540;

async function buildSplashWordmark() {
  step('inlining the launch wordmark');
  const sharp = require('sharp');
  const sourcePath = path.resolve(IOS_DIR, config.ios.splashImage);
  if (!fs.existsSync(sourcePath)) fail(`splash wordmark not found at ${sourcePath}`);
  const png = await sharp(sourcePath)
    .resize({ width: SPLASH_WORDMARK_WIDTH_PX, withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

const splashWordmark = await buildSplashWordmark();

// ---------------------------------------------------------------------------
// 5. Web app manifest
// ---------------------------------------------------------------------------
function writeManifest() {
  step('writing manifest.webmanifest');
  const manifest = {
    id: config.startUrl,
    name: config.name,
    short_name: config.shortName,
    description: config.description,
    start_url: config.startUrl,
    scope: config.scope,
    display: config.display,
    orientation: config.orientation,
    theme_color: config.themeColor,
    background_color: config.backgroundColor,
    lang: config.lang,
    categories: config.categories,
    icons: config.icons,
  };
  fs.writeFileSync(path.join(DIST, 'manifest.webmanifest'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

const manifest = writeManifest();

// ---------------------------------------------------------------------------
// 6. Service worker: version stamp, then the list of files to install with
// ---------------------------------------------------------------------------
function listFiles(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(path.join(dir, entry.name), rel));
    else out.push({ rel, size: fs.statSync(path.join(dir, entry.name)).size });
  }
  return out;
}

const allFiles = listFiles(DIST);
// The worker is replaced by name, never by hash, so it must stay out of its own hash input or every
// build would look identical to the last one from the browser's point of view.
const fingerprint = crypto
  .createHash('sha256')
  .update(allFiles.filter((f) => f.rel !== 'sw.js').map((f) => `${f.rel}:${f.size}`).join('\n'))
  .digest('hex')
  .slice(0, 12);

/**
 * What the worker downloads while it installs.
 *
 * Only what the very first paint needs: the document, the offline page, the bundles index.html loads
 * with a script tag, the two root layouts, the brand fonts and the icons. Everything else — each
 * screen's own chunk, the product photography — is cached the first time a visit asks for it, which
 * keeps an install cheap on a phone connection while still leaving those files available offline
 * afterwards.
 */
function buildPrecacheList() {
  const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  const eager = [...html.matchAll(/<script src="(\/_expo\/static\/js\/web\/[^"]+)"/g)].map((m) => m[1]);
  if (eager.length === 0) fail('no entry bundles found in the exported index.html — the inject step would be guessing.');

  const layouts = allFiles
    .map((f) => `/${f.rel}`)
    .filter((u) => u.startsWith('/_expo/static/js/web/_layout-'));

  const fonts = allFiles
    .map((f) => `/${f.rel}`)
    .filter((u) => u.endsWith('.ttf') && /(TitilliumWeb|Ionicons)/.test(u));

  const urls = [...new Set([...eager, ...layouts, ...fonts, ...iconFiles, '/index.html', '/offline.html'])];
  const bytes = urls.reduce((sum, u) => sum + (allFiles.find((f) => `/${f.rel}` === u)?.size ?? 0), 0);
  return { urls, bytes };
}

// URLs are left exactly as the page asks for them. The URL parser percent-encodes anything that needs
// encoding identically on both the cache write and the later read, so pre-encoding here would only
// risk a key that never matches.
const precache = buildPrecacheList();

function writeServiceWorker() {
  step('compiling sw.js');
  const template = fs.readFileSync(path.join(IOS_DIR, 'service-worker.js'), 'utf8');
  const compiled = template
    .replaceAll('__PY_VERSION__', fingerprint)
    .replaceAll('__PY_CACHE_PREFIX__', `${config.serviceWorker.cachePrefix}-`)
    .replace('__PY_PRECACHE__', JSON.stringify(precache.urls, null, 2));
  for (const token of ['__PY_VERSION__', '__PY_PRECACHE__', '__PY_CACHE_PREFIX__']) {
    if (compiled.includes(token)) fail(`${token} in service-worker.js was not substituted.`);
  }
  fs.writeFileSync(path.join(DIST, 'sw.js'), compiled);
}

writeServiceWorker();

// ---------------------------------------------------------------------------
// 7. index.html: the iOS and PWA metadata React Native has no way to emit
// ---------------------------------------------------------------------------
function injectHead() {
  step('injecting PWA metadata into index.html');
  const file = path.join(DIST, 'index.html');
  let html = fs.readFileSync(file, 'utf8');
  // Injection is a one-shot rewrite of Metro's own document; running it twice would double the tags.
  if (html.includes('window.__PY_PWA__')) {
    fail('dist/index.html is already injected — build again without --skip-export so Metro emits a clean document.');
  }

  html = html.replace(/<html lang="[^"]*"/, `<html lang="${config.lang}"`);

  // viewport-fit=cover is what makes env(safe-area-inset-*) non-zero, and safe-area-context's web
  // provider reads exactly those values. Without it the tab bar sits under the home indicator.
  html = html.replace(
    /<meta name="viewport" content="([^"]*)"/,
    (_m, current) =>
      `<meta name="viewport" content="${current.includes('viewport-fit') ? current : `${current}, viewport-fit=cover`}"`,
  );

  const appleMeta = [
    `<meta name="theme-color" content="${config.themeColor}" />`,
    `<meta name="description" content="${config.description}" />`,
    `<meta name="mobile-web-app-capable" content="yes" />`,
    `<meta name="apple-mobile-web-app-capable" content="${config.ios.webAppCapable ? 'yes' : 'no'}" />`,
    `<meta name="apple-mobile-web-app-status-bar-style" content="${config.ios.statusBarStyle}" />`,
    `<meta name="apple-mobile-web-app-title" content="${config.ios.title}" />`,
    `<meta name="format-detection" content="telephone=no" />`,
    `<link rel="manifest" href="/manifest.webmanifest" />`,
    `<link rel="apple-touch-icon" sizes="180x180" href="${config.appleTouchIcon}" />`,
    `<link rel="icon" sizes="192x192" type="image/png" href="${config.favicon}" />`,
    // The bridge from the browser's blue splash to the app's own blue splash, so a cold start in
    // standalone mode does not flash white first.
    `<style>html,body,#root{background-color:${config.backgroundColor}}</style>`,
    // The launch screen itself. It covers #root until React mounts its first element, then fades.
    `<style>
      #py-splash{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background-color:${config.backgroundColor};transition:opacity .3s ease-out}
      #py-splash img{display:block;width:180px;height:auto}
      #py-splash[data-hidden="true"]{opacity:0;pointer-events:none}
      @media (prefers-reduced-motion: reduce){#py-splash{transition:none}}
    </style>`,
  ].join('\n    ');

  if (!html.includes('</head>')) fail('the exported index.html has no </head> to inject into.');
  html = html.replace('</head>', `\n    ${appleMeta}\n  </head>`);

  const boot = {
    version: fingerprint,
    scope: config.serviceWorker.scope,
    name: config.name,
    themeColor: config.themeColor,
    installGuide: config.installGuide,
    updateBanner: config.updateBanner,
  };
  const splash = [
    `<div id="py-splash" aria-hidden="true"><img src="${splashWordmark}" alt="" width="180" height="30" /></div>`,
    // Without JS there is nothing to mount, so the splash must not cover the <noscript> message.
    '<noscript><style>#py-splash{display:none}</style></noscript>',
  ].join('\n  ');
  if (!/<body[^>]*>/.test(html)) fail('the exported index.html has no <body> to inject into.');
  html = html.replace(/<body([^>]*)>/, `<body$1>\n  ${splash}`);

  // The deferred bundles run only after the document is parsed, so this handler is already observing
  // #root before React's first element appears. It also gives up after 8 s, in case boot fails.
  const splashHandoff = [
    '<script>',
    '(function(){',
    "var splash=document.getElementById('py-splash');",
    'if(!splash)return;',
    'var done=false;',
    'function hide(){if(done)return;done=true;splash.setAttribute("data-hidden","true");setTimeout(function(){splash.remove()},350);}',
    "var root=document.getElementById('root');",
    'if(!root){hide();return;}',
    'var observer=new MutationObserver(function(){if(root.childElementCount){observer.disconnect();hide();}});',
    'observer.observe(root,{childList:true});',
    'if(root.childElementCount){observer.disconnect();hide();}',
    'setTimeout(function(){observer.disconnect();hide();},8000);',
    '})();',
    '</script>',
  ].join('\n  ');

  const injected = [
    splashHandoff,
    `<script>window.__PY_PWA__ = ${JSON.stringify(boot).replace(/</g, '\\u003c')};</script>`,
    '<script src="/pwa-chrome.js" defer></script>',
  ].join('\n  ');
  html = html.replace('</body>', `  ${injected}\n  </body>`);

  fs.writeFileSync(file, html);
  return html;
}

const finalHtml = injectHead();
if (!finalHtml.includes('viewport-fit=cover')) fail('viewport-fit=cover was not injected.');

// ---------------------------------------------------------------------------
// 8. Summary
// ---------------------------------------------------------------------------
const totalBytes = allFiles.reduce((sum, f) => sum + f.size, 0);
console.log(`
[ios/build] done — dist/ is ready to serve or deploy
  version        ${fingerprint}
  api base       ${apiBase}${apiBase.startsWith('/') ? '  (same origin)' : ''}
  precached      ${precache.urls.length} files, ${(precache.bytes / 1024 / 1024).toFixed(2)} MB
  whole bundle   ${allFiles.length} files, ${(totalBytes / 1024 / 1024).toFixed(2)} MB
  manifest       ${manifest.name} (${manifest.display}, ${manifest.orientation})
`);

if (hasFlag('dev-server')) {
  const { startServer } = await import('./serve.mjs');
  startServer({ dist: DIST });
}
