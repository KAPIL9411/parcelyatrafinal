#!/usr/bin/env node
/**
 * Checks what `dist/` actually contains, before anyone calls it a PWA.
 *
 * Each check is here because its absence breaks something a user would notice: no `viewport-fit` means
 * the tab bar sits under the home indicator, a precached `/v1` response means the next person to hold
 * this phone reads your messages, an icon at the wrong size means a grey square on the Home Screen.
 *
 * Run after `node scripts/build.mjs`: `node scripts/verify.mjs`.
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IOS_DIR = path.resolve(HERE, '..');
const ROOT_DIR = path.resolve(IOS_DIR, '..');
const DIST = path.join(IOS_DIR, 'dist');

const config = JSON.parse(fs.readFileSync(path.join(IOS_DIR, 'app.json'), 'utf8'));

const queue = [];
const check = (label, fn) => queue.push({ label, fn });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const read = (rel) => {
  const file = path.join(DIST, rel);
  assert(fs.existsSync(file), `${rel} is missing`);
  return fs.readFileSync(file, 'utf8');
};
const exists = (rel) => fs.existsSync(path.join(DIST, rel));

const BUNDLE_DIR = '_expo/static/js/web';

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------
check('the app is still one Expo project, not a second copy', () => {
  assert(!fs.existsSync(path.join(IOS_DIR, 'src')), 'ios/src exists — /ios must build from apps/mobile, not a parallel implementation');
  assert(fs.existsSync(path.join(ROOT_DIR, 'apps', 'mobile', 'app.json')), 'apps/mobile/app.json is missing');
  return 'no ios/src; screens come from apps/mobile';
});

const html = read('index.html');

check('index.html was injected exactly once', () => {
  const count = html.split('window.__PY_PWA__').length - 1;
  assert(count === 1, `the PWA boot block appears ${count} times — the build ran on an already-injected document`);
});

check('every script the document loads exists on disk', () => {
  const srcs = [...html.matchAll(/<script src="(\/[^"]+)"/g)].map((m) => m[1]);
  assert(srcs.length >= 4, `only ${srcs.length} script tags — the export looks truncated`);
  for (const src of srcs) assert(exists(src.slice(1)), `${src} is referenced but not in dist/`);
  return `${srcs.length} scripts`;
});

// ---------------------------------------------------------------------------
// Viewport, colour, iOS metadata
// ---------------------------------------------------------------------------
check('viewport-fit=cover is set, so safe-area insets are non-zero', () => {
  const viewport = /<meta name="viewport" content="([^"]+)"/.exec(html);
  assert(viewport, 'no viewport meta at all');
  assert(/viewport-fit=cover/.test(viewport[1]), `viewport is "${viewport[1]}"`);
  assert(/width=device-width/.test(viewport[1]), 'width=device-width is missing');
  return viewport[1];
});

check('the browser UI is coloured to the brand, not left default', () => {
  const theme = /<meta name="theme-color" content="([^"]+)"/.exec(html);
  assert(theme, 'no theme-color meta');
  assert(theme[1].toLowerCase() === config.themeColor.toLowerCase(), `theme-color ${theme[1]} != ${config.themeColor}`);
  return theme[1];
});

check('iOS standalone and status-bar metadata are present', () => {
  assert(/<meta name="apple-mobile-web-app-capable" content="yes"/.test(html), 'apple-mobile-web-app-capable is missing');
  const style = /<meta name="apple-mobile-web-app-status-bar-style" content="([^"]+)"/.exec(html);
  assert(style, 'apple-mobile-web-app-status-bar-style is missing');
  assert(style[1] === config.ios.statusBarStyle, `status bar style is ${style[1]}`);
  assert(/<meta name="apple-mobile-web-app-title" content="Parcel Yatra"/.test(html), 'the Home Screen label is not Parcel Yatra');
  return style[1];
});

check('the document does not flash white before the app paints', () => {
  assert(new RegExp(`background-color:${config.backgroundColor}`).test(html), 'no brand background on html/body/#root');
});

check('the shell fills the physical screen in a home-screen app', () => {
  // iOS reports the standalone viewport as the screen minus the status-bar inset, so a 100%-tall
  // shell stops short of the bottom and the body background shows as a band under the tab bar.
  assert(/html\.py-standalone[^{]*\{[^}]*height:100vh[^}]*height:100lvh/.test(html), 'the standalone shell is still the short viewport');
  assert(/display-mode: standalone/.test(html), 'a platform where standalone matches gets no fallback');
  assert(/navigator\.standalone === true/.test(html), 'the standalone class is never set from navigator.standalone');
  const bootstrap = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .find((s) => s.includes('py-standalone'));
  assert(bootstrap, 'no bootstrap sets the standalone class');
  assert(/defineProperty\(w, 'innerHeight'/.test(bootstrap), 'innerHeight is left short, so safe-area insets double-count the status bar');
});

check('the launch screen shows the wordmark before React mounts', () => {
  const splash = /<div id="py-splash"[^>]*>\s*<img src="data:image\/png;base64,([A-Za-z0-9+/=]+)"/.exec(html);
  assert(splash, 'no inlined #py-splash wordmark — the PWA shows a blank blue screen until React mounts');
  const png = Buffer.from(splash[1], 'base64');
  assert(png.subarray(1, 4).toString('ascii') === 'PNG', 'the launch wordmark is not a PNG');
  const handoff = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .find((s) => s.includes('py-splash'));
  assert(handoff && handoff.includes('MutationObserver'), 'nothing removes the splash when the app mounts');
  return `${Math.round(png.length / 1024)} KB wordmark inlined`;
});

// ---------------------------------------------------------------------------
// Manifest and icons
// ---------------------------------------------------------------------------
let manifest;
check('manifest.webmanifest parses', () => {
  manifest = JSON.parse(read('manifest.webmanifest'));
});

check('the manifest installs as Parcel Yatra, standalone and portrait', () => {
  assert(manifest, 'manifest did not parse');
  assert(manifest.name === 'Parcel Yatra', `name is ${manifest.name}`);
  assert(manifest.short_name === 'Parcel Yatra', `short_name is ${manifest.short_name}`);
  assert(manifest.display === 'standalone', 'it would open in a Safari tab, not as an app');
  assert(manifest.orientation === 'portrait', 'orientation is not pinned to portrait');
  assert(manifest.start_url === '/', `start_url is ${manifest.start_url}`);
  assert(manifest.scope === '/', `scope is ${manifest.scope} — the app could open outside its own origin`);
  assert(manifest.theme_color === config.themeColor, 'theme_color does not match the brand');
  assert(manifest.background_color === config.backgroundColor, 'background_color does not match the splash');
  assert(typeof manifest.description === 'string' && manifest.description.length > 20, 'no usable description');
});

check('the manifest stays out of the API', () => {
  assert(!('serviceworker' in manifest), 'the deprecated serviceworker key is present; registration lives in pwa-chrome.js');
  assert(!JSON.stringify(manifest).includes('/v1'), 'the manifest points at the API');
});

check('every icon the manifest promises exists and is the size it claims', async () => {
  const sharp = require('sharp');
  const wanted = [...config.icons, { src: config.appleTouchIcon, sizes: '180x180', purpose: 'any' }];
  const seen = [];
  for (const icon of wanted) {
    const rel = icon.src.slice(1);
    assert(exists(rel), `${icon.src} is missing from dist/`);
    const meta = await sharp(path.join(DIST, rel)).metadata();
    const [w, h] = icon.sizes.split('x').map(Number);
    assert(meta.width === w && meta.height === h, `${icon.src} is ${meta.width}x${meta.height}, promised ${icon.sizes}`);
    assert(meta.format === 'png', `${icon.src} is ${meta.format}, must be png`);
    seen.push(`${icon.sizes}${icon.purpose === 'maskable' ? ' maskable' : ''}`);
  }
  return seen.join(', ');
});

check('the icon set covers both platforms and the maskable crop', () => {
  assert(config.icons.some((i) => i.purpose === 'maskable'), 'no purpose:"maskable" entry');
  assert(config.icons.some((i) => i.sizes === '192x192'), 'no 192x192 icon');
  assert(config.icons.some((i) => i.sizes === '512x512'), 'no 512x512 icon');
});

// ---------------------------------------------------------------------------
// Service worker
// ---------------------------------------------------------------------------
const sw = read('sw.js');

check('the service worker has no unsubstituted build tokens', () => {
  for (const token of ['__PY_VERSION__', '__PY_PRECACHE__', '__PY_CACHE_PREFIX__']) {
    assert(!sw.includes(token), `${token} survived into dist/sw.js`);
  }
});

const precacheLiteral = /const PRECACHE = (\[[\s\S]*?\]);/.exec(sw);
assert(precacheLiteral, 'could not read PRECACHE out of sw.js');
const precache = JSON.parse(precacheLiteral[1]);

check('every precached file is really in dist/', () => {
  const missing = precache.filter((url) => !exists(decodeURIComponent(url.slice(1))));
  assert(missing.length === 0, `missing: ${missing.join(', ')}`);
  const bytes = precache.reduce((n, url) => n + fs.statSync(path.join(DIST, decodeURIComponent(url.slice(1)))).size, 0);
  assert(bytes < 6 * 1024 * 1024, `an install would pull ${(bytes / 1024 / 1024).toFixed(1)} MB up front — precache is too greedy`);
  return `${precache.length} files, ${(bytes / 1024 / 1024).toFixed(2)} MB`;
});

check('the worker installs the document, the entry bundle and the offline page', () => {
  assert(precache.includes('/index.html'), 'the shell is not precached, so a cold start with no signal shows nothing');
  assert(precache.includes('/offline.html'), 'offline.html is not precached');
  assert(precache.some((u) => u.startsWith(`/${BUNDLE_DIR}/entry-`)), 'the entry bundle is not precached');
  assert(precache.some((u) => /TitilliumWeb_400Regular/.test(u)), 'the brand font is not precached, so the first paint uses the system face');
});

const isHashedStatic = /function isHashedStatic[\s\S]*?\n\}/.exec(sw);

check('the worker caches content-addressed files and nothing else', () => {
  assert(isHashedStatic, 'isHashedStatic is gone from the worker');
  for (const prefix of ['/_expo/', '/assets/', '/icons/']) {
    assert(isHashedStatic[0].includes(`'${prefix}'`), `the worker does not cache ${prefix}`);
  }
  assert(!/\/v1|\/socket\.io/.test(isHashedStatic[0]), 'the worker treats API traffic as cacheable static');
  assert(/no-store|private/.test(sw), 'the worker does not honour no-store/private responses');
});

check('nothing personal is precached', () => {
  const forbidden = precache.filter((url) => /\/v1(\/|$)|\/socket\.io|\/api\//.test(url));
  assert(forbidden.length === 0, `precached API traffic: ${forbidden.join(', ')}`);
});

check('the worker never intercepts another origin', () => {
  assert(/function isForeignOrigin[\s\S]*?location\.origin/.test(sw), 'cross-origin traffic is not excluded by origin');
});

check('caches are versioned, and an update deletes the previous build', () => {
  const version = /const VERSION = '([^']+)'/.exec(sw);
  assert(version, 'no VERSION constant');
  assert(sw.includes(`'${config.serviceWorker.cachePrefix}-'`), `cache namespace is not ${config.serviceWorker.cachePrefix}-`);
  assert(/caches\.delete/.test(sw), 'old versioned caches are never removed');
  const boot = /window\.__PY_PWA__ = (\{.*?\});<\/script>/.exec(html);
  assert(boot, 'no boot config in index.html');
  assert(JSON.parse(boot[1]).version === version[1], 'the page and the worker disagree about which build this is');
  return version[1];
});

check('a failed precache cannot leave the app permanently stuck on the old build', () => {
  assert(/Promise\.allSettled/.test(sw), 'install uses an all-or-nothing addAll, so one renamed file blocks activation forever');
});

// ---------------------------------------------------------------------------
// Browser chrome
// ---------------------------------------------------------------------------
const chrome = read('pwa-chrome.js');

check('the worker is registered with the app scope, and only on a secure origin', () => {
  assert(chrome.includes("register('/sw.js'"), 'sw.js is never registered');
  assert(/isSecureContext/.test(chrome), 'there is no http guard around registration');
});

check('an update is detected and offered, not silently applied mid-flight', () => {
  assert(/updatefound/.test(chrome), 'no updatefound listener');
  assert(/PY_SKIP_WAITING/.test(chrome), 'the waiting worker is never told to take over');
  assert(/navigator\.serviceWorker\.controller/.test(chrome), 'a first install is not distinguished from an update');
});

check('the install guide never appears inside the installed app', () => {
  assert(/display-mode: standalone/.test(chrome), 'standalone is not detected');
  assert(/navigator\.standalone/.test(chrome), 'iOS standalone is not detected');
  assert(chrome.includes(config.installGuide.storageKey), 'the dismissal key does not come from ios/app.json');
});

check('the install guide stores nothing but a dismissal flag', () => {
  const writes = [...chrome.matchAll(/setItem\(([^)]*)\)/g)].map((m) => m[1]);
  assert(writes.length > 0, 'dismissal is never persisted, so it would nag on every visit');
  for (const call of writes) assert(call.includes('dismissKey'), `unexpected web-storage write: ${call}`);
});

check('offline.html is self-contained', () => {
  const page = read('offline.html');
  assert(!/<script/.test(page), 'the offline page runs scripts — it must render with no JS and no network');
  assert(!/https?:\/\//.test(page.replace(/<!--[\s\S]*?-->/g, '')), 'the offline page reaches for something remote');
  assert(page.includes('/icons/icon-180.png'), 'the offline page has no precached artwork to show');
});

// ---------------------------------------------------------------------------
// The bundle is the browser build, not the Android build
// ---------------------------------------------------------------------------
check('the export really picked the browser variants of the native modules', () => {
  // A screen's code lives in its own lazily loaded chunk, so the evidence has to be read across the
  // whole bundle set — searching only the entry bundle would report a false negative.
  const chunks = fs.readdirSync(path.join(DIST, BUNDLE_DIR)).filter((f) => f.endsWith('.js'));
  assert(chunks.length > 10, `only ${chunks.length} route chunks in the export`);
  const code = chunks.map((f) => read(`${BUNDLE_DIR}/${f}`)).join('\n');
  const evidence = [
    ['photo.web.ts', /createObjectURL/],
    ['LocationService.web.ts', /geolocation/],
    ['TrackingMapFrame.web.tsx', /srcDoc|srcdoc/],
    ['client-transport.web.ts', /credentials/],
    ['dialog.web.tsx', /alertdialog/],
  ];
  const missing = evidence.filter(([, re]) => !re.test(code)).map(([name]) => name);
  assert(missing.length === 0, `the bundle looks like the native path for: ${missing.join(', ')}`);
  assert(!/SecureStore\.setValueWithKeyAsync|expo-secure-store/.test(code), 'the platform keystore is still in the browser bundle');
  return evidence.map(([name]) => name).join(', ');
});

check('no browser variant is shadowed by a differently-extensioned base file', () => {
  // Metro walks sourceExts in order and, for each one, tries `name.web.<ext>` before `name.<ext>`.
  // So `dialog.ts` beats `dialog.web.tsx`: `ts` comes first, and the plain file is found there. A web
  // variant must therefore match its base extension, or the native module silently ships to the phone.
  const mobile = path.join(ROOT_DIR, 'apps', 'mobile');
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        walk(full);
        continue;
      }
      const webVar = /^(.*)\.web\.(tsx?)$/.exec(entry.name);
      if (!webVar) continue;
      const [rel, ext] = webVar.slice(1);
      if (ext === 'tsx' && fs.existsSync(path.join(dir, `${rel}.ts`))) {
        offenders.push(path.relative(mobile, path.join(dir, `${rel}.ts`)).replace(/\\/g, '/'));
      }
    }
  };
  for (const root of ['app', 'src']) walk(path.join(mobile, root));
  assert(offenders.length === 0, `these .ts files win over their .web.tsx siblings: ${offenders.join(', ')}`);
});

check('dist/ contains no remote http: asset a phone would block', () => {
  const offenders = [];
  for (const rel of ['index.html', 'manifest.webmanifest', 'sw.js', 'pwa-chrome.js', 'offline.html']) {
    const text = rel === 'offline.html' ? read(rel).replace(/<!--[\s\S]*?-->/g, '') : read(rel);
    for (const m of text.matchAll(/http:\/\/([a-z0-9.-]+)/gi)) {
      if (!/^(localhost|127\.|www\.w3\.org)/.test(m[1])) offenders.push(`${rel}: ${m[0]}`);
    }
  }
  assert(offenders.length === 0, offenders.join('; '));
});

// ---------------------------------------------------------------------------
// Deployment contract
// ---------------------------------------------------------------------------
check('vercel.json deploys this directory and rewrites deep links', () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(IOS_DIR, 'vercel.json'), 'utf8'));
  assert(vercel.buildCommand.includes('scripts/build.mjs'), `buildCommand is ${vercel.buildCommand}`);
  assert(vercel.outputDirectory === 'dist', 'outputDirectory must be dist');
  assert(vercel.rewrites.some((r) => r.destination === '/index.html'), 'there is no SPA fallback, so /bookings/123 404s');
  const rule = vercel.headers.find((h) => h.source === '/sw.js');
  assert(rule, 'sw.js has no header rule');
  const valueOf = (key) => (rule.headers.find((h) => h.key.toLowerCase() === key) || {}).value;
  assert(!/immutable/.test(valueOf('cache-control') || ''), 'sw.js must never be immutable or an update can never land');
  assert(/max-age=0/.test(valueOf('cache-control') || ''), 'sw.js must be revalidated on every load');
  assert(/javascript/.test(valueOf('content-type') || ''), 'a worker served with the wrong MIME type is refused by Safari');
  assert(valueOf('service-worker-allowed') === '/', 'the worker is not allowed to control the whole origin');
  assert(!('$comment' in vercel), 'vercel.json carries a key Vercel does not define');
});

check('no dependency was invented for the PWA layer', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(IOS_DIR, 'package.json'), 'utf8'));
  assert(!pkg.dependencies, 'ios/package.json should delegate to the workspace install, not add its own tree');
  assert(pkg.scripts.build.includes('scripts/build.mjs'), 'the build script is not wired to scripts/build.mjs');
  assert(pkg.scripts.verify.includes('scripts/verify.mjs'), 'npm run verify is not wired to scripts/verify.mjs');
});

// ---------------------------------------------------------------------------
const results = [];
for (const { label, fn } of queue) {
  try {
    const detail = await fn();
    results.push({ ok: true, label, detail: detail === undefined ? '' : String(detail) });
  } catch (error) {
    results.push({ ok: false, label, detail: error && error.message ? error.message : String(error) });
  }
}

const failed = results.filter((r) => !r.ok);
for (const result of results) {
  console.log(`${result.ok ? '  ok  ' : ' FAIL '} ${result.label}${result.detail ? `  —  ${result.detail}` : ''}`);
}
console.log(`\n[ios/verify] ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) process.exit(1);
