import { haversine } from './geo.js';
import { resolveSpeed } from './speed.js';

const BLOCKED_ACCESS = new Set(['no', 'private', 'destination', 'agricultural', 'forestry', 'delivery', 'customers', 'emergency', 'bus', 'psv']);
const UNPAVED = new Set(['unpaved', 'gravel', 'fine_gravel', 'dirt', 'earth', 'ground', 'grass', 'mud', 'sand', 'compacted', 'pebblestone', 'woodchips']);

function blocked(tags) {
  for (const k of ['access', 'vehicle', 'motor_vehicle', 'motorcar']) {
    if (tags[k] && BLOCKED_ACCESS.has(tags[k])) {
      // un tag plus précis peut rouvrir l'accès (ex. access=no + motorcar=yes)
      const more = ['motorcar', 'motor_vehicle', 'vehicle'].find((x) => x !== k && (tags[x] === 'yes' || tags[x] === 'permissive'));
      if (!more) return true;
    }
  }
  return tags.area === 'yes' || tags.oneway === 'reversible';
}

function directions(tags) {
  const ow = (tags.oneway || '').toLowerCase();
  if (ow === 'yes' || ow === '1' || ow === 'true') return [true, false];
  if (ow === '-1' || ow === 'reverse') return [false, true];
  if (ow === 'no' || ow === 'false' || ow === '0') return [true, true];
  if (tags.junction === 'roundabout' || tags.junction === 'circular') return [true, false];
  if (tags.highway === 'motorway' || tags.highway === 'motorway_link') return [true, false];
  return [true, true];
}

// Construit le graphe routier complet à partir d'une réponse Overpass (out body geom).
export function buildGraph(osm, regionCode) {
  const idx = new Map();
  const lat = [];
  const lon = [];
  const out = [];
  const signalIds = new Set();

  for (const el of osm.elements) {
    if (el.type === 'node' && el.tags && el.tags.highway === 'traffic_signals') signalIds.add(el.id);
  }

  const nodeIndex = (id, la, lo) => {
    let i = idx.get(id);
    if (i === undefined) {
      i = lat.length;
      idx.set(id, i);
      lat.push(la);
      lon.push(lo);
      out.push([]);
    }
    return i;
  };

  let edgeCount = 0;
  for (const el of osm.elements) {
    if (el.type !== 'way' || !el.tags || !el.geometry || !el.nodes) continue;
    const t = el.tags;
    if (blocked(t)) continue;
    const [fwd, bwd] = directions(t);
    const fs = resolveSpeed(t, 'forward', regionCode);
    const bs = resolveSpeed(t, 'backward', regionCode);
    const isRb = t.junction === 'roundabout' || t.junction === 'circular';
    const unpaved = UNPAVED.has(t.surface) || (t.tracktype && t.tracktype !== 'grade1');
    const base = {
      hw: t.highway,
      way: el.id,
      name: t.name || '',
      ref: t.ref || '',
      rb: isRb,
      unpaved: !!unpaved,
    };
    const n = Math.min(el.nodes.length, el.geometry.length);
    for (let k = 0; k < n - 1; k++) {
      const g1 = el.geometry[k];
      const g2 = el.geometry[k + 1];
      if (!g1 || !g2) continue;
      const a = nodeIndex(el.nodes[k], g1.lat, g1.lon);
      const b = nodeIndex(el.nodes[k + 1], g2.lat, g2.lon);
      if (a === b) continue;
      const len = haversine(g1.lat, g1.lon, g2.lat, g2.lon);
      if (fwd) {
        out[a].push({ ...base, from: a, to: b, len, speed: fs.speed, est: fs.estimated });
        edgeCount++;
      }
      if (bwd) {
        out[b].push({ ...base, from: b, to: a, len, speed: bs.speed, est: bs.estimated });
        edgeCount++;
      }
    }
  }

  const signals = new Set();
  for (const id of signalIds) {
    const i = idx.get(id);
    if (i !== undefined) signals.add(i);
  }

  return { lat, lon, out, signals, region: regionCode, nodeCount: lat.length, edgeCount };
}

// ---------- Critères ----------

export function edgeAllowed(e, c) {
  if (!c.highways.has(e.hw)) return false;
  if (e.speed > c.maxSpeed && !(c.linkMax && e.speed <= c.linkMax)) return false;
  if (c.noUnpaved && e.unpaved) return false;
  return true;
}

export function edgeFactor(e, c) {
  let f = 1;
  // liaison plus rapide que la vitesse max : autorisée mais fortement découragée
  if (e.speed > c.maxSpeed) f *= 4;
  if (e.speed < c.prefMin) f += (c.prefMin - e.speed) / 40;
  if (c.hwWeight && c.hwWeight[e.hw]) f *= c.hwWeight[e.hw];
  if (e.rb) {
    if (c.roundabouts === 'prefer') f *= 0.5;
    else if (c.roundabouts === 'avoid') f *= 3;
  }
  return f;
}

export function minFactor(c) {
  return c.roundabouts === 'prefer' ? 0.5 * 0.8 : 0.8;
}

// Composante fortement connexe contenant `start` (on peut aller et revenir)
export function stronglyConnected(graph, start, c) {
  const n = graph.nodeCount;
  const fwd = new Uint8Array(n);
  const rev = [];
  for (let i = 0; i < n; i++) rev.push([]);
  for (let i = 0; i < n; i++) for (const e of graph.out[i]) if (edgeAllowed(e, c)) rev[e.to].push(i);

  const stack = [start];
  fwd[start] = 1;
  while (stack.length) {
    const u = stack.pop();
    for (const e of graph.out[u]) {
      if (!fwd[e.to] && edgeAllowed(e, c)) {
        fwd[e.to] = 1;
        stack.push(e.to);
      }
    }
  }
  const both = new Uint8Array(n);
  const members = [];
  if (fwd[start]) {
    both[start] = 1;
    members.push(start);
    stack.push(start);
    while (stack.length) {
      const u = stack.pop();
      for (const p of rev[u]) {
        if (!both[p] && fwd[p]) {
          both[p] = 1;
          members.push(p);
          stack.push(p);
        }
      }
    }
  }
  return { mask: both, members };
}

// Nœuds ayant au moins une arête autorisée, triés par distance au point
export function nearestNodes(graph, la, lo, c, limit = 12) {
  const best = [];
  for (let i = 0; i < graph.nodeCount; i++) {
    if (!graph.out[i].some((e) => edgeAllowed(e, c))) continue;
    const d = haversine(la, lo, graph.lat[i], graph.lon[i]);
    if (best.length < limit || d < best[best.length - 1].d) {
      best.push({ i, d });
      best.sort((x, y) => x.d - y.d);
      if (best.length > limit) best.pop();
    }
  }
  return best;
}

export function nearestInSet(graph, la, lo, members, exclude) {
  let bi = -1;
  let bd = Infinity;
  for (const i of members) {
    if (exclude && exclude.has(i)) continue;
    const d = haversine(la, lo, graph.lat[i], graph.lon[i]);
    if (d < bd) {
      bd = d;
      bi = i;
    }
  }
  return { i: bi, d: bd };
}
