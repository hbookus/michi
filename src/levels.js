// Profils de sortie. Chaque profil fixe les types de routes, la vitesse maximale
// et ce que l'on cherche à travailler.

const SMALL = ['residential', 'living_street', 'unclassified'];
const MEDIUM = ['tertiary', 'tertiary_link'];
const LARGE = ['secondary', 'secondary_link', 'primary', 'primary_link'];
const FAST = ['trunk', 'trunk_link', 'motorway', 'motorway_link'];

export const LEVELS = {
  decouverte: {
    label: 'Premiers pas',
    hint: 'Petites rues calmes, 30 à 50 km/h',
    highways: [...SMALL, ...MEDIUM],
    maxSpeed: 50,
    prefMin: 0,
    roundabouts: 'neutral',
    signals: 'avoid',
    hwWeight: { tertiary: 1.3 },
    defaultKm: 8,
    defaultMin: 25,
    maxKm: 30,
    linkMax: 0,
    avgSpeedGuess: 22,
  },
  ville: {
    label: 'En ville',
    hint: 'Carrefours, feux, ronds-points, 50 km/h',
    highways: [...SMALL, ...MEDIUM, ...LARGE],
    maxSpeed: 50,
    prefMin: 50,
    roundabouts: 'prefer',
    signals: 'neutral',
    hwWeight: { residential: 1.3, living_street: 2 },
    defaultKm: 12,
    defaultMin: 35,
    maxKm: 60,
    linkMax: 90,
    avgSpeedGuess: 25,
  },
  route: {
    label: 'Routes',
    hint: 'Nationales et routes de campagne, 70 à 90 km/h',
    highways: ['unclassified', ...MEDIUM, ...LARGE],
    maxSpeed: 90,
    prefMin: 70,
    roundabouts: 'neutral',
    signals: 'neutral',
    hwWeight: { unclassified: 1.4 },
    defaultKm: 30,
    defaultMin: 40,
    maxKm: 70,
    avgSpeedGuess: 50,
  },
  rapide: {
    label: 'Voies rapides',
    hint: 'Insertions, dépassements, 90 à 130 km/h',
    highways: [...MEDIUM, ...LARGE, ...FAST],
    maxSpeed: 130,
    prefMin: 90,
    roundabouts: 'neutral',
    signals: 'avoid',
    hwWeight: { tertiary: 1.5 },
    defaultKm: 50,
    defaultMin: 45,
    maxKm: 100,
    avgSpeedGuess: 70,
  },
};

// Transforme un profil + réglages de l'utilisateur en critères de calcul
export function buildCriteria(levelKey, overrides = {}) {
  const L = LEVELS[levelKey];
  const maxSpeed = overrides.maxSpeed ?? L.maxSpeed;
  let highways = [...L.highways];
  if (overrides.avoidMotorway) highways = highways.filter((h) => !h.startsWith('motorway'));
  const signals = overrides.signals ?? L.signals;
  return {
    level: levelKey,
    highways: new Set(highways),
    maxSpeed,
    prefMin: Math.min(L.prefMin, maxSpeed),
    roundabouts: overrides.roundabouts ?? L.roundabouts,
    signalPenalty: signals === 'avoid' ? 250 : 0,
    linkMax: overrides.links === false ? 0 : overrides.links === true ? Math.max(90, maxSpeed) : L.linkMax || 0,
    hwWeight: L.hwWeight,
    noUnpaved: true,
    avgSpeedGuess: Math.min(L.avgSpeedGuess, maxSpeed * 0.6),
  };
}
