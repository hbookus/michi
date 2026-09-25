// Trafic en direct le long d'un parcours (TomTom Flow Segment Data).
// On interroge une dizaine de points répartis sur la boucle : vitesse actuelle vs vitesse habituelle.
import { haversine } from './geo.js';

const KEY = import.meta.env.VITE_TOMTOM_KEY;
export const trafficEnabled = !!KEY;

const SAMPLES = 10;

// Indices régulièrement espacés le long du tracé (en distance)
function sampleIndices(coords, n) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + haversine(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]));
  }
  const total = cum[cum.length - 1];
  const out = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const target = (total * (k + 0.5)) / n;
    while (j < cum.length - 1 && cum[j] < target) j++;
    out.push(j);
  }
  return out;
}

function distToPolyline(la, lo, pts) {
  let best = Infinity;
  for (const p of pts) best = Math.min(best, haversine(la, lo, p.latitude, p.longitude));
  return best;
}

async function querySegment([la, lo]) {
  const url = `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?point=${la.toFixed(6)},${lo.toFixed(6)}&unit=KMPH&key=${KEY}`;
  const res = await fetch(url);
  if (res.status === 403 || res.status === 401) throw Object.assign(new Error('Clé TomTom refusée'), { auth: true });
  if (!res.ok) return null;
  const d = (await res.json()).flowSegmentData;
  if (!d) return null;
  // TomTom renvoie le tronçon le plus proche : on l'ignore s'il ne passe pas par notre point
  const pts = d.coordinates?.coordinate || [];
  if (pts.length && distToPolyline(la, lo, pts) > 40) return null;
  return {
    lat: la,
    lon: lo,
    current: d.currentSpeed,
    free: d.freeFlowSpeed,
    ratio: d.freeFlowSpeed ? d.currentSpeed / d.freeFlowSpeed : 1,
    closure: !!d.roadClosure,
    confidence: d.confidence,
  };
}

/**
 * Vérifie le trafic sur un parcours.
 * names[i] (facultatif) : nom de la route au point i du tracé, pour des messages lisibles.
 */
export async function checkRouteTraffic(route, names = null) {
  const coords = route.coords;
  const idx = sampleIndices(coords, SAMPLES);
  const results = await Promise.all(
    idx.map(async (i) => {
      const r = await querySegment(coords[i]);
      if (r && names) r.road = names[Math.max(0, i - 1)] || '';
      return r;
    })
  );
  const pts = results.filter(Boolean);
  if (!pts.length) return { level: 'unknown', delayMin: 0, points: [], checkedAt: new Date().toISOString() };

  // Retard estimé : chaque point représente 1/N de la durée du parcours
  const share = (route.stats.duration || 0) / SAMPLES;
  let delay = 0;
  for (const p of pts) {
    if (p.closure) continue;
    const slow = Math.min(3, p.ratio > 0 ? 1 / p.ratio : 3);
    delay += share * Math.max(0, slow - 1);
  }
  const slowPts = pts.filter((p) => p.closure || p.ratio < 0.75);
  const worst = Math.min(...pts.map((p) => (p.closure ? 0 : p.ratio)));
  const delayMin = Math.round(delay / 60);

  let level = 'low';
  if (pts.some((p) => p.closure)) level = 'closed';
  else if (worst < 0.45 || delayMin >= 6) level = 'high';
  else if (worst < 0.75 || delayMin >= 2) level = 'medium';

  return { level, delayMin, points: pts, slowPoints: slowPts, checkedAt: new Date().toISOString() };
}

// Phrase affichée sous le parcours
export function trafficSentence(t) {
  if (!t) return '';
  const roads = [...new Set((t.slowPoints || []).map((p) => p.road).filter(Boolean))].slice(0, 2);
  const where = roads.length ? ` (${roads.join(', ')})` : '';
  const n = (t.slowPoints || []).length;
  switch (t.level) {
    case 'low':
      return { cls: 'low', title: 'Trafic : fluide', text: 'Impact : aucun sur la sortie.' };
    case 'medium':
      return {
        cls: 'medium',
        title: `Trafic : ralentissements${where}`,
        text: `Impact potentiel : modéré${t.delayMin ? `, environ +${t.delayMin} min` : ''}. ${n > 1 ? `${n} endroits concernés.` : 'Un endroit concerné.'}`,
      };
    case 'high':
      return {
        cls: 'high',
        title: `Trafic : bouchons${where}`,
        text: `Impact potentiel : fort${t.delayMin ? `, environ +${t.delayMin} min` : ''}. Mieux vaut un autre parcours ou un autre horaire.`,
      };
    case 'closed':
      return { cls: 'high', title: `Route fermée sur le parcours${where}`, text: 'Choisis un autre parcours.' };
    default:
      return { cls: 'unknown', title: 'Trafic : pas de données', text: 'TomTom ne couvre pas ces petites routes, en général peu chargées.' };
  }
}
