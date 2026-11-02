import { colors } from '../theme.ts';

/**
 * CARTO's raster basemap is keyed now: a request without one returns a placeholder tile that reads
 * "API KEY REQUIRED", so the map would ship somebody else's warning instead of streets. Without a
 * key the layer is skipped and the route is drawn on the card's own background.
 *
 * Metro substitutes `EXPO_PUBLIC_*` literals at build time, which means the key travels inside the
 * bundle and is readable from any installed app — the only protection is that the key can do nothing
 * but ask for tiles, is quota-limited, and can be revoked in the CARTO dashboard.
 */
const BASMAP_KEY = (process.env.EXPO_PUBLIC_CARTO_API_KEY ?? '').trim();

/** The documented keyed form; `{s}` and `{r}` are filled in by Leaflet per request. */
const basemapUrl = (): string =>
  `https://{s}.basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(BASMAP_KEY)}`;

/**
 * The document behind the send screen's route map.
 *
 * It is a real slippy map: Leaflet from a CDN, CARTO's light basemap for tiles, and the road
 * geometry the API routed. Nothing here draws a stylised street grid — when the server cannot route
 * a pair it answers `ROUTING_UNAVAILABLE` and the React side shows that instead of a line.
 *
 * The React layer calls `window.__pyRoute` / `window.__pyReset` through `MapFrame.run`, which is
 * `injectJavaScript` on native and `contentWindow.eval` on web.
 */
export function routeMapHtml(): string {
  const brand = colors.brand;
  const navy = colors.navy;
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
  .leaflet-container { background: #eaeef5; }
  .pin { filter: drop-shadow(0 3px 5px rgba(6, 26, 122, 0.35)); }
  /* CARTO and OSM both require a credit for the tiles and the road data. It stays small and sits
     above the locality chips, which occupy the bottom edge of the card. */
  .leaflet-bottom.leaflet-left { margin: 0 0 34px 8px; }
  .leaflet-control-attribution {
    background: rgba(255, 255, 255, 0.78);
    border-radius: 5px;
    color: #4a5570;
    font: 500 9px/1.5 system-ui, sans-serif;
    padding: 1px 5px;
  }
  .leaflet-control-attribution a { color: #4a5570; }
</style>
</head>
<body>
<div id="map"></div>
<script>
var map = L.map('map', {
  zoomControl: false, attributionControl: false, keyboard: false,
  scrollWheelZoom: false, dragging: true, doubleClickZoom: true, touchZoom: true,
  zoomSnap: 0.25
}).setView([22.9734, 78.6309], 4.25);

${BASMAP_KEY
    ? `L.tileLayer('${basemapUrl()}', {
  subdomains: 'abcd', maxZoom: 18,
  attribution: '© OpenStreetMap contributors © CARTO'
}).addTo(map);`
    : '// No basemap key is configured: the route is drawn on a plain background rather than a placeholder tile.'}

L.control.attribution({ position: 'bottomleft', prefix: false, collapsible: false }).addTo(map);
${BASMAP_KEY ? '' : "map.attributionControl.addAttribution('Route data © OpenStreetMap contributors');"}

function pin(fill, core) {
  return L.divIcon({
    className: 'pin-holder',
    html: '<svg class="pin" width="26" height="34" viewBox="0 0 26 34">'
      + '<path d="M13 32.5C13 32.5 23.5 20.4 23.5 12.5C23.5 6.4 18.8 1.5 13 1.5C7.2 1.5 2.5 6.4 2.5 12.5C2.5 20.4 13 32.5 13 32.5Z" '
      + 'fill="' + fill + '" stroke="#ffffff" stroke-width="2.2" />'
      + '<circle cx="13" cy="12.3" r="4.2" fill="' + core + '" /></svg>',
    iconSize: [26, 34],
    iconAnchor: [13, 32]
  });
}

var pickupIcon = pin('${brand}', '#ffffff');
var dropIcon = pin('${navy}', '#ffffff');

// Under the coloured line: the same geometry, wider and translucent, so the route reads on top of
// a busy basemap without a hard outline.
var glow = L.polyline([], { color: '${brand}', weight: 13, opacity: 0.15, lineCap: 'round' }).addTo(map);
var line = L.polyline([], { color: '${brand}', weight: 5, opacity: 1, lineCap: 'round' }).addTo(map);

var from = null;
var to = null;
var framed = false;
var lastPoints = null;

var FIT = { padding: [26, 44], maxZoom: 13 };

function frameRoute() {
  if (!lastPoints) return;
  map.fitBounds(L.latLngBounds(lastPoints), { animate: false, padding: FIT.padding, maxZoom: FIT.maxZoom });
}

window.__pyRoute = function (data) {
  var points = data.points;
  if (!points || points.length < 2) { window.__pyReset(); return; }

  lastPoints = points;
  line.setLatLngs(points);
  glow.setLatLngs(points);

  if (!from) {
    from = L.marker(points[0], { icon: pickupIcon, interactive: false, keyboard: false }).addTo(map);
    to = L.marker(points[points.length - 1], { icon: dropIcon, interactive: false, keyboard: false }).addTo(map);
  } else {
    from.setLatLng(points[0]);
    to.setLatLng(points[points.length - 1]);
  }

  var bounds = L.latLngBounds(points);
  var options = { padding: FIT.padding, maxZoom: FIT.maxZoom };
  if (framed && data.animate !== false) {
    map.flyToBounds(bounds, { duration: 0.75, easeLinearity: 0.2, padding: options.padding, maxZoom: options.maxZoom });
  } else {
    map.fitBounds(bounds, { animate: false, padding: options.padding, maxZoom: options.maxZoom });
  }
  framed = true;
};

window.__pyReset = function () {
  line.setLatLngs([]);
  glow.setLatLngs([]);
  if (from) { map.removeLayer(from); from = null; }
  if (to) { map.removeLayer(to); to = null; }
  framed = false;
  lastPoints = null;
  map.setView([22.9734, 78.6309], 4.25, { animate: false });
};

// The frame is sized by React Native after this document starts, and Leaflet fits a route to the
// size it measured at creation — which can be 0x0. Re-measure, and re-frame the route if the box
// changed, so the first route never locks the camera to an empty viewport.
function measure() {
  var before = map.getSize();
  map.invalidateSize();
  var after = map.getSize();
  if (lastPoints && (before.x !== after.x || before.y !== after.y)) frameRoute();
}

setTimeout(measure, 0);
setTimeout(measure, 120);
setTimeout(measure, 500);
window.addEventListener('resize', measure);
if (window.ResizeObserver) new ResizeObserver(measure).observe(document.getElementById('map'));
</script>
</body>
</html>`;
}
