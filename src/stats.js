import { SPEED_BANDS, bandOf } from './speed.js';

// Coefficient entre vitesse autorisée et vitesse moyenne réellement pratiquée
// (prudence d'apprentissage, carrefours, circulation)
function realFactor(speed) {
  if (speed <= 30) return 0.65;
  if (speed <= 50) return 0.7;
  if (speed <= 70) return 0.78;
  if (speed <= 90) return 0.82;
  return 0.85;
}

export const SIGNAL_DELAY = 20; // secondes par feu
export const ROUNDABOUT_DELAY = 8; // secondes par rond-point

export function routeStats(graph, edges) {
  const bands = Object.fromEntries(SPEED_BANDS.map((b) => [b.key, 0]));
  let distance = 0;
  let duration = 0;
  let estimated = 0;
  let roundabouts = 0;
  let signals = 0;
  const roads = new Map();
  let prevRb = false;
  const seenSignals = new Set();

  for (const e of edges) {
    distance += e.len;
    duration += e.len / ((e.speed * realFactor(e.speed)) / 3.6);
    bands[bandOf(e.speed).key] += e.len;
    if (e.est) estimated += e.len;
    if (e.rb && !prevRb) roundabouts++;
    prevRb = e.rb;
    if (graph.signals.has(e.to) && !seenSignals.has(e.to)) {
      seenSignals.add(e.to);
      signals++;
    }
    const label = e.ref && e.name ? `${e.ref} · ${e.name}` : e.ref || e.name;
    if (label) roads.set(label, (roads.get(label) || 0) + e.len);
  }
  duration += signals * SIGNAL_DELAY + roundabouts * ROUNDABOUT_DELAY;

  const mainRoads = [...roads.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, len]) => ({ name, len }));

  return {
    distance,
    duration,
    bands,
    estimatedShare: distance ? estimated / distance : 0,
    roundabouts,
    signals,
    mainRoads,
    maxSpeed: edges.reduce((m, e) => Math.max(m, e.speed), 0),
  };
}

export function formatKm(m) {
  return m >= 10000 ? `${Math.round(m / 1000)} km` : `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

export function formatDuration(s) {
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
}
