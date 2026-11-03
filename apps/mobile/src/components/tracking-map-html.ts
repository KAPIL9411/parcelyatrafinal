/**
 * The Leaflet document behind the live tracking map, shared by the WebView shell
 * (`TrackingMapFrame.tsx`) and the iframe shell (`TrackingMapFrame.web.tsx`).
 *
 * It is a string rather than a component because both shells hand the same page to a browser
 * engine — one embedded, one in a frame — and the two must not drift: the marker, the bearing
 * animation and the `window.updatePosition` / `window.setPolyline` entry points are the contract the
 * socket handlers call into.
 */

export const TRACKING_MAP_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    body, html, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #f8fafc; overflow: hidden; }
    .driver-pin {
      width: 42px; height: 42px; background: #005DFD; border-radius: 50%;
      border: 3px solid #ffffff; box-shadow: 0 4px 12px rgba(0,93,253,0.45);
      display: flex; align-items: center; justify-content: center;
      transition: transform 0.15s linear;
    }
    .driver-pin svg { width: 20px; height: 20px; fill: none; stroke: #ffffff; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var map = L.map('map', { zoomControl: false, attributionControl: false }).setView([28.6139, 77.2090], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

    var driverIcon = L.divIcon({
      className: 'driver-container',
      html: '<div id="pin" class="driver-pin"><svg viewBox="0 0 24 24"><polygon points="12 2 19 21 12 17 5 21 12 2"></polygon></svg></div>',
      iconSize: [42, 42],
      iconAnchor: [21, 21]
    });

    var marker = L.marker([28.6139, 77.2090], { icon: driverIcon }).addTo(map);
    var polyline = L.polyline([], { color: '#005DFD', weight: 5, opacity: 0.85 }).addTo(map);

    var currentLat = 0, currentLng = 0, currentBearing = 0;
    var targetLat = 0, targetLng = 0, targetBearing = 0;

    function animate() {
      if (targetLat !== 0 && targetLng !== 0) {
        currentLat += (targetLat - currentLat) * 0.1;
        currentLng += (targetLng - currentLng) * 0.1;

        var diffB = (targetBearing - currentBearing + 360) % 360;
        if (diffB > 180) diffB -= 360;
        currentBearing = (currentBearing + diffB * 0.15 + 360) % 360;

        marker.setLatLng([currentLat, currentLng]);
        var el = document.getElementById('pin');
        if (el) el.style.transform = 'rotate(' + Math.round(currentBearing) + 'deg)';
      }
      requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);

    window.updatePosition = function(lat, lng, bearing) {
      if (currentLat === 0 && currentLng === 0) {
        currentLat = lat; currentLng = lng; currentBearing = bearing;
        map.setView([lat, lng], 15);
      }
      targetLat = lat; targetLng = lng; targetBearing = bearing;
    };

    window.setPolyline = function(points) {
      if (points && points.length > 0) {
        polyline.setLatLngs(points);
        map.fitBounds(polyline.getBounds(), { padding: [30, 30] });
      }
    };
  </script>
</body>
</html>
`;
