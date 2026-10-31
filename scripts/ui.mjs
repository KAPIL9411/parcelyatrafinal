/**
 * Minimal UI driver for the Android emulator.
 *
 * The emulator is driven through `adb` and the accessibility tree, not screenshots: every assertion
 * and tap is made against text the user can actually see, so a test that passes proves the label was
 * on screen. Screenshots are still taken for the record, but nothing here depends on reading one.
 *
 * Usage:
 *   node scripts/ui.mjs dump
 *   node scripts/ui.mjs tap "Allow"
 *   node scripts/ui.mjs tapid permission_allow_button
 *   node scripts/ui.mjs type "9000000001"
 *   node scripts/ui.mjs key 4
 *   node scripts/ui.mjs swipe 540 1800 540 700 300
 *   node scripts/ui.mjs wait "Send a parcel" 20000
 *   node scripts/ui.mjs shot home
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const ADB = process.env.ADB ?? 'C:/Users/kurmi/AppData/Local/Android/Sdk/platform-tools/adb.exe';

function adb(args, opts = {}) {
  return execFileSync(ADB, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...opts });
}

function dumpXml() {
  // `uiautomator dump` fails with "could not get idle state" whenever the screen animates. It then
  // leaves the previous dump on disk, so a naive read returns stale UI and every later assertion is
  // about a screen the user already left. Delete first, and fail loudly rather than lie.
  for (let attempt = 0; attempt < 25; attempt += 1) {
    try {
      adb(['shell', 'rm', '-f', '/sdcard/ui.xml'], { stdio: ['ignore', 'pipe', 'pipe'] });
      adb(['shell', 'uiautomator', 'dump', '/sdcard/ui.xml'], { stdio: ['ignore', 'pipe', 'pipe'] });
      const xml = adb(['shell', 'cat', '/sdcard/ui.xml']);
      if (xml.includes('<hierarchy')) return xml;
    } catch {
      // fall through to the retry
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
  }
  throw new Error('uiautomator could not produce a fresh dump');
}

function decode(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function parse(xml) {
  const nodes = [];
  const re = /<node\b([^>]*?)\/?>/g;
  let match;
  while ((match = re.exec(xml))) {
    const attrs = {};
    const attrRe = /([a-zA-Z0-9-]+)="([^"]*)"/g;
    let a;
    while ((a = attrRe.exec(match[1]))) attrs[a[1]] = decode(a[2]);
    const bounds = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attrs.bounds ?? '');
    if (!bounds) continue;
    const [x1, y1, x2, y2] = bounds.slice(1).map(Number);
    nodes.push({
      text: attrs.text ?? '',
      desc: attrs['content-desc'] ?? '',
      id: attrs['resource-id'] ?? '',
      cls: attrs.class ?? '',
      clickable: attrs.clickable === 'true',
      scrollable: attrs.scrollable === 'true',
      focused: attrs.focused === 'true',
      checked: attrs.checked === 'true',
      x: Math.round((x1 + x2) / 2),
      y: Math.round((y1 + y2) / 2),
      x1,
      y1,
      x2,
      y2,
    });
  }
  return nodes;
}

const label = (n) => (n.text || n.desc || '').trim();
const visible = (n) => n.y2 > 0 && n.y1 < 2400 && label(n).length > 0;

function find(nodes, needle) {
  const lower = needle.toLowerCase();
  return (
    nodes.find((n) => label(n).toLowerCase() === lower && n.clickable) ??
    nodes.find((n) => label(n).toLowerCase() === lower) ??
    nodes.find((n) => label(n).toLowerCase().includes(lower) && n.clickable) ??
    nodes.find((n) => label(n).toLowerCase().includes(lower)) ??
    nodes.find((n) => n.id.toLowerCase().includes(lower))
  );
}

const [, , command, ...rest] = process.argv;

if (command === 'dump') {
  const nodes = parse(dumpXml()).filter(visible);
  for (const n of nodes) {
    const flags = [n.clickable ? 'tap' : '', n.scrollable ? 'scroll' : '', n.focused ? 'focus' : '', n.checked ? 'checked' : '']
      .filter(Boolean)
      .join(',');
    console.log(`${String(n.x).padStart(4)},${String(n.y).padStart(4)}  ${flags.padEnd(12)} ${label(n)}${n.id ? `   [${n.id}]` : ''}`);
  }
} else if (command === 'tap') {
  const nodes = parse(dumpXml()).filter(visible);
  const node = find(nodes, rest.join(' '));
  if (!node) {
    console.error(`NOT FOUND: ${rest.join(' ')}`);
    process.exit(2);
  }
  adb(['shell', 'input', 'tap', String(node.x), String(node.y)]);
  console.log(`tapped "${label(node)}" at ${node.x},${node.y}`);
} else if (command === 'tapxy') {
  adb(['shell', 'input', 'tap', rest[0], rest[1]]);
} else if (command === 'type') {
  const text = rest.join(' ');
  adb(['shell', 'input', 'text', text.replace(/ /g, '%s')]);
} else if (command === 'key') {
  adb(['shell', 'input', 'keyevent', rest[0]]);
} else if (command === 'swipe') {
  adb(['shell', 'input', 'swipe', ...rest]);
} else if (command === 'wait') {
  const needle = rest[0];
  const timeout = Number(rest[1] ?? 20000);
  const started = Date.now();
  for (;;) {
    const nodes = parse(dumpXml()).filter(visible);
    if (find(nodes, needle)) {
      console.log(`found "${needle}" after ${Date.now() - started}ms`);
      process.exit(0);
    }
    if (Date.now() - started > timeout) {
      console.error(`TIMEOUT waiting for "${needle}"`);
      process.exit(3);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
} else if (command === 'shot') {
  const name = rest[0] ?? 'shot';
  const buffer = adb(['exec-out', 'screencap', '-p'], { encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'] });
  writeFileSync(`.e2e-shots/${name}.png`, buffer);
  console.log(`saved .e2e-shots/${name}.png`);
} else if (command === 'assert') {
  const nodes = parse(dumpXml()).filter(visible);
  const missing = rest.filter((needle) => !find(nodes, needle));
  if (missing.length) {
    console.error(`MISSING: ${missing.join(', ')}`);
    process.exit(4);
  }
  console.log(`all present: ${rest.join(', ')}`);
} else {
  console.error('unknown command');
  process.exit(1);
}
