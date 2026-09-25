// Vitesses maximales en Belgique.
// Priorité : valeur signalée dans OpenStreetMap (maxspeed), puis valeur implicite
// (BE-VLG:rural, BE:urban, zone 30...), puis valeur par défaut selon la région et le type de route.

export const REGIONS = {
  VLG: { label: 'Flandre', urban: 50, rural: 70 },
  WAL: { label: 'Wallonie', urban: 50, rural: 90 },
  BRU: { label: 'Bruxelles-Capitale', urban: 30, rural: 50 },
};

const URBAN_TYPES = new Set(['residential', 'living_street']);

function regionOf(code) {
  return REGIONS[code] || REGIONS.WAL;
}

// Interprète une valeur de tag maxspeed. Retourne un nombre (km/h) ou null.
export function parseMaxspeed(value, regionCode) {
  if (value == null) return null;
  const v = String(value).trim().toLowerCase();
  if (!v || v === 'none' || v === 'signals' || v === 'variable') return null;
  const num = v.match(/^(\d+(?:\.\d+)?)\s*(mph)?$/);
  if (num) {
    const n = parseFloat(num[1]);
    return num[2] ? Math.round(n * 1.609) : n;
  }
  if (v === 'walk') return 6;
  // Valeurs implicites du type "BE-VLG:rural", "BE:urban", "BE:zone30"
  const m = v.match(/^be(?:-(vlg|wal|bru))?:(.+)$/);
  if (!m) return null;
  const reg = regionOf(m[1] ? m[1].toUpperCase() : regionCode);
  const kind = m[2];
  if (kind === 'urban') return reg.urban;
  if (kind === 'rural') return reg.rural;
  if (kind === 'motorway') return 120;
  if (kind === 'trunk') return 120;
  if (kind === 'living_street' || kind === 'woonerf') return 20;
  if (kind === 'bicycle_road' || kind === 'cyclestreet') return 30;
  const zone = kind.match(/zone\s*:?\s*(\d+)/) || kind.match(/^(\d+)$/);
  if (zone) return parseInt(zone[1], 10);
  return null;
}

// Vitesse d'un tronçon dans un sens donné.
// Retourne { speed, estimated } : estimated = true si aucune donnée n'était présente dans OSM.
export function resolveSpeed(tags, direction, regionCode) {
  const dirKey = direction === 'backward' ? 'maxspeed:backward' : 'maxspeed:forward';
  const candidates = [tags[dirKey], tags.maxspeed];
  for (const c of candidates) {
    const s = parseMaxspeed(c, regionCode);
    if (s) return { speed: s, estimated: false };
  }
  // Tags implicites complémentaires
  for (const k of ['maxspeed:type', 'source:maxspeed', 'zone:maxspeed', 'zone:traffic']) {
    const s = parseMaxspeed(tags[k], regionCode);
    if (s) return { speed: s, estimated: false };
  }
  const reg = regionOf(regionCode);
  const hw = tags.highway || '';
  if (hw === 'living_street') return { speed: 20, estimated: true };
  if (hw.startsWith('motorway')) return { speed: hw === 'motorway' ? 120 : 70, estimated: true };
  if (URBAN_TYPES.has(hw)) return { speed: reg.urban, estimated: true };
  if (hw === 'unclassified') return { speed: Math.min(reg.rural, 70), estimated: true };
  if (hw.endsWith('_link')) return { speed: Math.min(reg.rural, 70), estimated: true };
  return { speed: reg.rural, estimated: true };
}

// Tranches affichées dans les statistiques
export const SPEED_BANDS = [
  { key: 'b30', label: '≤ 30', max: 30, color: '#6a9f7a' },
  { key: 'b50', label: '50', max: 50, color: '#4f86a8' },
  { key: 'b70', label: '70', max: 70, color: '#c9a13b' },
  { key: 'b90', label: '90', max: 90, color: '#d0703c' },
  { key: 'b120', label: '120', max: Infinity, color: '#a8434f' },
];

export function bandOf(speed) {
  return SPEED_BANDS.find((b) => speed <= b.max) || SPEED_BANDS[SPEED_BANDS.length - 1];
}
