const fs = require('node:fs');
const t = fs.readFileSync('parcel-yatra-startup-pack/api/ERROR_CATALOG.md', 'utf8');
const codes = [...t.matchAll(/^\|\s*`([A-Z0-9_]+)`/gm)].map((m) => m[1]);
console.log(codes.join('\n'));
