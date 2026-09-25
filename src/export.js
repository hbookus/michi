import { haversine } from './geo.js';

const esc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);

export function toGPX(route, name) {
  const pts = route.coords
    .map(([la, lo]) => `      <trkpt lat="${la.toFixed(6)}" lon="${lo.toFixed(6)}"></trkpt>`)
    .join('\n');
  const [sl, so] = route.coords[0];
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Michi" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${esc(name)}</name>
    <desc>Parcours calculé sur les données OpenStreetMap (© contributeurs OpenStreetMap, ODbL)</desc>
  </metadata>
  <wpt lat="${sl.toFixed(6)}" lon="${so.toFixed(6)}"><name>Départ / arrivée</name></wpt>
  <trk>
    <name>${esc(name)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}

// Points régulièrement espacés le long du tracé
export function samplePoints(coords, n) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + haversine(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]));
  }
  const total = cum[cum.length - 1];
  const out = [];
  let j = 0;
  for (let k = 1; k <= n; k++) {
    const target = (total * k) / (n + 1);
    while (j < cum.length - 1 && cum[j] < target) j++;
    out.push(coords[j]);
  }
  return out;
}

// Lien Google Maps approximatif (9 étapes maximum : Google peut choisir un autre chemin entre deux étapes)
export function googleMapsUrl(route) {
  const [sl, so] = route.coords[0];
  const origin = `${sl.toFixed(6)},${so.toFixed(6)}`;
  const wps = samplePoints(route.coords, 8)
    .map(([la, lo]) => `${la.toFixed(6)},${lo.toFixed(6)}`)
    .join('|');
  return `https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=${origin}&destination=${origin}&waypoints=${encodeURIComponent(wps)}`;
}

export function download(filename, text, type = 'application/gpx+xml') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}
