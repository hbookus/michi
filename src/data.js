import { bboxAround } from './geo.js';
import { zoneCode } from './speed.js';
import { fetchFromTiles } from './tiles.js';

// Serveurs Overpass publics (données OpenStreetMap). Essayés dans l'ordre.
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

const cache = [];
const TIMEOUT_S = 30;

function contains(outer, inner) {
  return outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];
}

export function radiusFor(distanceMeters) {
  return Math.min(30000, distanceMeters * 0.3 + 1200);
}

export function buildQuery(bbox, highways) {
  const types = [...highways].sort().join('|');
  const b = bbox.map((x) => x.toFixed(5)).join(',');
  return `[out:json][timeout:30][bbox:${b}];
way["highway"~"^(${types})$"]->.r;
.r out body geom qt;
node(w.r)["highway"="traffic_signals"];
out qt;`;
}

export async function fetchRoads(lat, lon, radius, highways, onStatus = () => {}) {
  const bbox = bboxAround(lat, lon, radius);
  const hit = cache.find((c) => contains(c.bbox, bbox) && [...highways].every((h) => c.highways.has(h)));
  if (hit) return hit.data;

  // 1. Carreaux préparés (rapide, si la zone est couverte)
  try {
    const fromTiles = await fetchFromTiles(lat, lon, bbox, highways, onStatus);
    if (fromTiles) {
      cache.push({ bbox, highways: new Set(highways), data: fromTiles });
      if (cache.length > 3) cache.shift();
      return fromTiles;
    }
  } catch (err) {
    console.warn('Carreaux indisponibles, passage par Overpass', err);
  }

  // 2. Serveurs Overpass publics (deux tours, avec une pause entre les deux)

  const query = buildQuery(bbox, highways);
  let lastErr;
  for (const url of [...OVERPASS, OVERPASS[0], OVERPASS[1]]) {
    if (lastErr && url === OVERPASS[0]) {
      onStatus('Serveurs chargés, nouvel essai dans 3 s…');
      await new Promise((r) => setTimeout(r, 3000));
    }
    const host = new URL(url).host;
    const ctrl = new AbortController();
    const t0 = Date.now();
    const timer = setInterval(() => {
      const sec = Math.round((Date.now() - t0) / 1000);
      onStatus(`Téléchargement des routes (${host})… ${sec} s`);
      if (sec >= TIMEOUT_S) ctrl.abort();
    }, 1000);
    try {
      onStatus(`Téléchargement des routes (${host})…`);
      const res = await fetch(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: ctrl.signal,
      });
      clearInterval(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}${res.status === 504 || res.status === 429 ? ' (serveur saturé)' : ''}`);
      onStatus(`Réception des routes (${host})…`);
      const data = await res.json();
      if (!data.elements) throw new Error('Réponse vide');
      if (data.remark && /runtime error|timed out/i.test(data.remark) && !data.elements.length) throw new Error('Serveur surchargé');
      cache.push({ bbox, highways: new Set(highways), data });
      if (cache.length > 3) cache.shift();
      return data;
    } catch (err) {
      lastErr = err.name === 'AbortError' ? new Error(`pas de réponse de ${host} en ${TIMEOUT_S} s`) : err;
    } finally {
      clearInterval(timer);
    }
  }
  if (lastErr instanceof TypeError) {
    throw new Error("Pas d'accès aux données OpenStreetMap depuis cette fenêtre. Si la page est ouverte dans un aperçu (Claude, Finder…), ouvre-la dans Chrome ou Safari, ou utilise la version en ligne.");
  }
  throw new Error(`Impossible de récupérer les données OpenStreetMap (${lastErr?.message || 'erreur réseau'}). Réessaie dans une minute.`);
}

// Pays / région du point de départ (pour les vitesses par défaut)
export async function detectRegion(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&lat=${lat}&lon=${lon}&accept-language=fr`;
    const res = await fetch(url);
    const j = await res.json();
    const a = j.address || {};
    const zone = zoneCode(a.country_code, a['ISO3166-2-lvl4']);
    return { zone, known: zone !== 'DEFAULT', country: a.country || '', place: a.city || a.town || a.village || a.municipality || '' };
  } catch {
    return { zone: null, known: false, country: '', place: '' };
  }
}

export async function searchPlace(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=fr&q=${encodeURIComponent(q)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Recherche indisponible');
  const list = await res.json();
  return list.map((p) => ({ lat: +p.lat, lon: +p.lon, label: p.display_name }));
}
