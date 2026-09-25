import { destination, haversine, seededRandom } from './geo.js';
import { edgeAllowed, edgeFactor, minFactor, nearestInSet, nearestNodes, stronglyConnected } from './graph.js';
import { routeStats } from './stats.js';

// ---------- File de priorité (tas binaire) ----------
class Heap {
  constructor() {
    this.k = [];
    this.v = [];
  }
  get size() {
    return this.k.length;
  }
  push(key, val) {
    const k = this.k;
    const v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop() {
    const k = this.k;
    const v = this.v;
    const top = v[0];
    const lk = k.pop();
    const lv = v.pop();
    if (k.length) {
      let i = 0;
      const n = k.length;
      while (true) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lk;
      v[i] = lv;
    }
    return top;
  }
}

export const edgeKey = (e, n) => (e.from < e.to ? e.from * n + e.to : e.to * n + e.from);

// A* entre deux nœuds. `used` : arêtes déjà parcourues (pénalisées pour éviter les allers-retours).
export function shortestPath(graph, s, t, c, mask, used, usedPenalty = 4) {
  const n = graph.nodeCount;
  const g = new Float64Array(n).fill(Infinity);
  const prev = new Array(n);
  const closed = new Uint8Array(n);
  const tl = graph.lat[t];
  const tn = graph.lon[t];
  const mf = minFactor(c);
  const heap = new Heap();
  g[s] = 0;
  heap.push(0, s);
  while (heap.size) {
    const u = heap.pop();
    if (closed[u]) continue;
    if (u === t) break;
    closed[u] = 1;
    for (const e of graph.out[u]) {
      const w = e.to;
      if (closed[w] || (mask && !mask[w]) || !edgeAllowed(e, c)) continue;
      let cost = e.len * edgeFactor(e, c);
      if (used && used.has(edgeKey(e, n))) cost *= usedPenalty;
      if (c.signalPenalty && graph.signals.has(w)) cost += c.signalPenalty;
      const ng = g[u] + cost;
      if (ng < g[w]) {
        g[w] = ng;
        prev[w] = e;
        heap.push(ng + haversine(graph.lat[w], graph.lon[w], tl, tn) * mf, w);
      }
    }
  }
  if (!prev[t] && s !== t) return null;
  const path = [];
  let cur = t;
  while (cur !== s) {
    const e = prev[cur];
    path.push(e);
    cur = e.from;
  }
  return path.reverse();
}

// Point de départ : nœud le plus proche appartenant à un réseau suffisamment grand
export function snapStart(graph, la, lo, c) {
  const near = nearestNodes(graph, la, lo, c, 15);
  let best = null;
  for (const cand of near) {
    const scc = stronglyConnected(graph, cand.i, c);
    if (!best || scc.members.length > best.scc.members.length) best = { node: cand.i, dist: cand.d, scc };
    if (scc.members.length > 300) break;
  }
  return best;
}

function buildLoop(graph, start, pts, c, mask, members) {
  const n = graph.nodeCount;
  const used = new Set();
  const nodes = [start];
  const exclude = new Set([start]);
  for (const [la, lo] of pts) {
    const s = nearestInSet(graph, la, lo, members, exclude);
    if (s.i < 0) return null;
    nodes.push(s.i);
    exclude.add(s.i);
  }
  nodes.push(start);
  const edges = [];
  for (let k = 0; k < nodes.length - 1; k++) {
    const p = shortestPath(graph, nodes[k], nodes[k + 1], c, mask, used);
    if (!p) return null;
    for (const e of p) {
      edges.push(e);
      used.add(edgeKey(e, n));
    }
  }
  return { edges, waypoints: nodes };
}

function overlapRatio(graph, edges) {
  const n = graph.nodeCount;
  const seen = new Map();
  let total = 0;
  let dup = 0;
  for (const e of edges) {
    const k = edgeKey(e, n);
    total += e.len;
    if (seen.has(k)) dup += e.len;
    else seen.set(k, 1);
  }
  return total ? dup / total : 0;
}

function waySet(edges) {
  return new Set(edges.map((e) => e.way));
}

function similarity(a, b) {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Génère des boucles qui partent et reviennent au point de départ.
 * target = { type: 'distance', value: mètres } ou { type: 'duration', value: secondes }
 */
export async function generateLoops(graph, startLatLon, target, c, opts = {}) {
  const count = opts.count || 3;
  const attempts = opts.attempts || 8;
  const rand = seededRandom(opts.seed ?? 1);
  const onProgress = opts.onProgress || (() => {});

  const snap = snapStart(graph, startLatLon[0], startLatLon[1], c);
  if (!snap || snap.scc.members.length < 20) {
    throw new Error("Aucune route compatible avec ces critères n'a été trouvée près du point de départ.");
  }
  const { node: start, scc } = snap;
  const sLat = graph.lat[start];
  const sLon = graph.lon[start];
  const metric = (st) => (target.type === 'duration' ? st.duration : st.distance);
  // Estimation initiale de la distance (pour une durée : vitesse moyenne supposée)
  const goalDist = target.type === 'duration' ? (target.value / 3600) * (c.avgSpeedGuess || 35) * 1000 : target.value;

  const results = [];
  const base = rand() * 360;
  for (let a = 0; a < attempts; a++) {
    onProgress(a / attempts);
    await tick();
    const heading = (base + (a * 360) / attempts + rand() * 20) % 360;
    const turn = a % 2 === 0 ? 60 : -60;
    let d = goalDist / (3 * 1.3);
    let best = null;
    for (let it = 0; it < 5; it++) {
      const p1 = destination(sLat, sLon, heading, d);
      const p2 = destination(sLat, sLon, heading + turn, d);
      const loop = buildLoop(graph, start, [p1, p2], c, scc.mask, scc.members);
      if (!loop) break;
      const st = routeStats(graph, loop.edges);
      const err = Math.abs(metric(st) - target.value) / target.value;
      const cand = { ...loop, stats: st, err, overlap: overlapRatio(graph, loop.edges), heading };
      if (!best || err < best.err) best = cand;
      if (err < 0.08) break;
      const ratio = target.value / Math.max(1, metric(st));
      d *= Math.min(2, Math.max(0.5, ratio));
    }
    if (best) {
      best.score = best.err + best.overlap * 1.2;
      results.push(best);
    }
  }
  onProgress(1);

  results.sort((x, y) => x.score - y.score);
  const chosen = [];
  for (const r of results) {
    const ws = waySet(r.edges);
    if (chosen.every((o) => similarity(o.ws, ws) < 0.6)) {
      chosen.push({ ...r, ws });
      if (chosen.length >= count) break;
    }
  }
  return chosen.map((r, k) => ({
    id: k + 1,
    edges: r.edges,
    stats: r.stats,
    overlap: r.overlap,
    err: r.err,
    start: [sLat, sLon],
    startGap: haversine(startLatLon[0], startLatLon[1], sLat, sLon),
    coords: pathCoords(graph, r.edges),
  }));
}

export function pathCoords(graph, edges) {
  if (!edges.length) return [];
  const pts = [[graph.lat[edges[0].from], graph.lon[edges[0].from]]];
  for (const e of edges) pts.push([graph.lat[e.to], graph.lon[e.to]]);
  return pts;
}
