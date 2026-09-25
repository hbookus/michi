// Carreaux de routes préparés à l'avance (voir scripts/build_tiles.py et le workflow GitHub).
// L'emplacement des carreaux est donné par /tiles.json : { "base": "https://…/tiles/" }.
// Sans ce fichier, l'app passe directement par les serveurs Overpass.

let indexPromise = null;
const tileCache = new Map();

async function getIndex() {
  if (!indexPromise) {
    indexPromise = (async () => {
      try {
        const cfg = await fetch('/tiles.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null));
        if (!cfg || !cfg.base) return null;
        const base = cfg.base.endsWith('/') ? cfg.base : cfg.base + '/';
        const idx = await fetch(base + 'index.json').then((r) => (r.ok ? r.json() : null));
        if (!idx) return null;
        return { ...idx, base, sets: Object.fromEntries(Object.entries(idx.layers).map(([k, v]) => [k, new Set(v)])) };
      } catch {
        return null;
      }
    })();
  }
  return indexPromise;
}

export async function tilesInfo() {
  const idx = await getIndex();
  return idx ? { updated: idx.updated } : null;
}

function tileRange(idx, bbox) {
  const [s, w, n, e] = bbox;
  const x0 = Math.floor(w / idx.tileLon);
  const x1 = Math.floor(e / idx.tileLon);
  const y0 = Math.floor(s / idx.tileLat);
  const y1 = Math.floor(n / idx.tileLat);
  const out = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(`${x}_${y}`);
  return out;
}

async function loadTile(url) {
  if (!tileCache.has(url)) {
    const p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
    tileCache.set(url, p);
    p.catch(() => tileCache.delete(url));
  }
  return tileCache.get(url);
}

// Convertit des carreaux au format Overpass ({ elements }) attendu par buildGraph
function decodeNodes(t) {
  if (t.v !== 2) return t.n;
  const out = [];
  let id = 0;
  let la = 0;
  let lo = 0;
  for (let i = 0; i < t.n.length; i += 3) {
    id += t.n[i];
    la += t.n[i + 1];
    lo += t.n[i + 2];
    out.push([id, la, lo]);
  }
  return out;
}

export function mergeTiles(tiles) {
  const ways = new Map();
  const signals = new Map();
  for (const raw of tiles) {
    const t = { ...raw, n: decodeNodes(raw) };
    for (const idx of t.s) {
      const [id, la, lo] = t.n[idx];
      signals.set(id, { type: 'node', id, lat: la / 1e6, lon: lo / 1e6, tags: { highway: 'traffic_signals' } });
    }
    for (const [id, ti, refs] of t.w) {
      if (ways.has(id)) continue;
      const nodes = [];
      const geometry = [];
      for (const r of refs) {
        const [nid, la, lo] = t.n[r];
        nodes.push(nid);
        geometry.push({ lat: la / 1e6, lon: lo / 1e6 });
      }
      ways.set(id, { type: 'way', id, nodes, geometry, tags: t.t[ti] });
    }
  }
  return { elements: [...signals.values(), ...ways.values()] };
}

// Retourne les données au format Overpass, ou null si la zone n'est pas couverte
export async function fetchFromTiles(lat, lon, bbox, highways, onStatus = () => {}) {
  const idx = await getIndex();
  if (!idx) return null;
  const layer = highways.has('residential') || highways.has('living_street') ? 'a' : 'm';
  const set = idx.sets[layer];
  if (!set) return null;
  const startKey = `${Math.floor(lon / idx.tileLon)}_${Math.floor(lat / idx.tileLat)}`;
  if (!set.has(startKey)) return null;
  const keys = tileRange(idx, bbox).filter((k) => set.has(k));
  let done = 0;
  onStatus(`Chargement des routes (0/${keys.length})…`);
  const tiles = [];
  const queue = [...keys];
  const worker = async () => {
    while (queue.length) {
      const k = queue.shift();
      tiles.push(await loadTile(`${idx.base}${layer}/${k}.json`));
      done++;
      onStatus(`Chargement des routes (${done}/${keys.length})…`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, keys.length) }, worker));
  return mergeTiles(tiles);
}
