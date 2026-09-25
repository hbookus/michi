// Vitesses maximales par défaut.
// Priorité : valeur signalée dans OpenStreetMap (maxspeed), puis valeur implicite
// (BE-VLG:rural, FR:urban, DE:zone30...), puis valeur par défaut selon le pays / la région
// et le type de route.

// urban = en agglomération, rural = hors agglomération, motorway = autoroute, trunk = voie rapide
export const ZONES = {
  'BE-VLG': { label: 'Flandre', urban: 50, rural: 70, motorway: 120 },
  'BE-WAL': { label: 'Wallonie', urban: 50, rural: 90, motorway: 120 },
  'BE-BRU': { label: 'Bruxelles-Capitale', urban: 30, rural: 50, motorway: 120 },
  BE: { label: 'Belgique', urban: 50, rural: 90, motorway: 120 },
  FR: { label: 'France', urban: 50, rural: 80, motorway: 130, trunk: 110 },
  LU: { label: 'Luxembourg', urban: 50, rural: 90, motorway: 130 },
  NL: { label: 'Pays-Bas', urban: 50, rural: 80, motorway: 100, trunk: 100 },
  DE: { label: 'Allemagne', urban: 50, rural: 100, motorway: 130 },
  CH: { label: 'Suisse', urban: 50, rural: 80, motorway: 120, trunk: 100 },
  AT: { label: 'Autriche', urban: 50, rural: 100, motorway: 130 },
  ES: { label: 'Espagne', urban: 50, rural: 90, motorway: 120 },
  IT: { label: 'Italie', urban: 50, rural: 90, motorway: 130, trunk: 110 },
  PT: { label: 'Portugal', urban: 50, rural: 90, motorway: 120 },
  GB: { label: 'Royaume-Uni', urban: 48, rural: 97, motorway: 113, trunk: 113 },
  IE: { label: 'Irlande', urban: 50, rural: 80, motorway: 120, trunk: 100 },
  DEFAULT: { label: 'Règles génériques', urban: 50, rural: 80, motorway: 110 },
};

// Anciennes clés courtes (Belgique)
const ALIASES = { VLG: 'BE-VLG', WAL: 'BE-WAL', BRU: 'BE-BRU', UK: 'GB' };

export function zoneOf(code) {
  if (!code) return ZONES.DEFAULT;
  const k = String(code).toUpperCase();
  return ZONES[ALIASES[k] || k] || ZONES[k.split('-')[0]] || ZONES.DEFAULT;
}

// Code de zone à partir des infos de géocodage (pays + subdivision ISO)
export function zoneCode(countryCode, iso) {
  const cc = (countryCode || '').toUpperCase();
  if (cc === 'BE' && ['BE-VLG', 'BE-WAL', 'BE-BRU'].includes(iso)) return iso;
  return ZONES[cc] ? cc : 'DEFAULT';
}

// Valeurs implicites britanniques
const GB_IMPLICIT = { nsl_single: 97, nsl_dual: 113, nsl_restricted: 48, motorway: 113 };

// Interprète une valeur de tag maxspeed. Retourne un nombre (km/h) ou null.
export function parseMaxspeed(value, zone) {
  if (value == null) return null;
  const v = String(value).trim().toLowerCase();
  if (!v || v === 'none' || v === 'signals' || v === 'variable') return null;
  const num = v.match(/^(\d+(?:\.\d+)?)\s*(mph)?$/);
  if (num) {
    const n = parseFloat(num[1]);
    return num[2] ? Math.round(n * 1.609) : n;
  }
  if (v === 'walk') return 6;
  // Valeurs implicites : "BE-VLG:rural", "FR:urban", "DE:zone30", "GB:nsl_single"
  const m = v.match(/^([a-z]{2}(?:-[a-z]+)?):(.+)$/);
  if (!m) return null;
  const z = m[1].includes('-') ? zoneOf(m[1]) : m[1].toUpperCase() === 'BE' ? zoneOf(zone) : zoneOf(m[1]);
  const kind = m[2].trim();
  if (m[1] === 'gb' && GB_IMPLICIT[kind]) return GB_IMPLICIT[kind];
  if (kind === 'urban') return z.urban;
  if (kind === 'rural') return z.rural;
  if (kind === 'motorway') return z.motorway;
  if (kind === 'trunk' || kind === 'expressway') return z.trunk || z.motorway;
  if (kind === 'living_street' || kind === 'woonerf' || kind === 'walk') return 20;
  if (kind === 'bicycle_road' || kind === 'cyclestreet') return 30;
  const zoneNum = kind.match(/zone\s*:?\s*(\d+)/) || kind.match(/^(\d+)$/);
  if (zoneNum) return parseInt(zoneNum[1], 10);
  return null;
}

const URBAN_TYPES = new Set(['residential', 'living_street']);

// Vitesse d'un tronçon dans un sens donné.
// Retourne { speed, estimated } : estimated = true si aucune donnée n'était présente dans OSM.
export function resolveSpeed(tags, direction, zone) {
  const dirKey = direction === 'backward' ? 'maxspeed:backward' : 'maxspeed:forward';
  for (const c of [tags[dirKey], tags.maxspeed]) {
    const s = parseMaxspeed(c, zone);
    if (s) return { speed: s, estimated: false };
  }
  for (const k of ['maxspeed:type', 'source:maxspeed', 'zone:maxspeed', 'zone:traffic']) {
    const s = parseMaxspeed(tags[k], zone);
    if (s) return { speed: s, estimated: false };
  }
  const z = zoneOf(zone);
  const hw = tags.highway || '';
  if (hw === 'living_street') return { speed: 20, estimated: true };
  if (hw === 'motorway') return { speed: z.motorway, estimated: true };
  if (hw === 'motorway_link') return { speed: Math.min(z.rural, 70), estimated: true };
  if (hw === 'trunk' && z.trunk) return { speed: z.trunk, estimated: true };
  if (URBAN_TYPES.has(hw)) return { speed: z.urban, estimated: true };
  if (hw === 'unclassified') return { speed: Math.min(z.rural, 70), estimated: true };
  if (hw.endsWith('_link')) return { speed: Math.min(z.rural, 70), estimated: true };
  return { speed: z.rural, estimated: true };
}

// Tranches affichées dans les statistiques
export const SPEED_BANDS = [
  // Palette bleu → violet, volontairement sans vert/orange/rouge pour ne pas évoquer le trafic
  { key: 'b30', label: '≤ 30', max: 30, color: '#5fb3b3' },
  { key: 'b50', label: '50', max: 50, color: '#3d85c6' },
  { key: 'b70', label: '70', max: 70, color: '#3f4fb5' },
  { key: 'b90', label: '80-100', max: 100, color: '#7b3fa6' },
  { key: 'b120', label: '110+', max: Infinity, color: '#3b1a5a' },
];

export function bandOf(speed) {
  return SPEED_BANDS.find((b) => speed <= b.max) || SPEED_BANDS[SPEED_BANDS.length - 1];
}
