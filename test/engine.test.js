import { describe, expect, it } from 'vitest';
import { parseMaxspeed, resolveSpeed } from '../src/speed.js';
import { buildGraph, edgeAllowed } from '../src/graph.js';
import { buildCriteria } from '../src/levels.js';
import { generateLoops, shortestPath, snapStart } from '../src/router.js';
import { toGPX, googleMapsUrl } from '../src/export.js';
import { buildQuery } from '../src/data.js';
import { gridOSM } from './fixture.js';

describe('vitesses belges', () => {
  it('lit les valeurs numériques et implicites', () => {
    expect(parseMaxspeed('70', 'BE-WAL')).toBe(70);
    expect(parseMaxspeed('BE-VLG:rural', 'BE-WAL')).toBe(70);
    expect(parseMaxspeed('BE-WAL:rural', 'BE-VLG')).toBe(90);
    expect(parseMaxspeed('BE:urban', 'BE-BRU')).toBe(30);
    expect(parseMaxspeed('BE:urban', 'BE-VLG')).toBe(50);
    expect(parseMaxspeed('BE:zone30', 'BE-WAL')).toBe(30);
    expect(parseMaxspeed('BE:motorway', 'BE-WAL')).toBe(120);
    expect(parseMaxspeed('none', 'BE-WAL')).toBeNull();
  });
  it('applique les défauts régionaux quand rien n’est signalé', () => {
    expect(resolveSpeed({ highway: 'secondary' }, 'forward', 'BE-VLG')).toEqual({ speed: 70, estimated: true });
    expect(resolveSpeed({ highway: 'secondary' }, 'forward', 'BE-WAL')).toEqual({ speed: 90, estimated: true });
    expect(resolveSpeed({ highway: 'residential' }, 'forward', 'BE-BRU')).toEqual({ speed: 30, estimated: true });
    expect(resolveSpeed({ highway: 'primary', 'maxspeed:backward': '50', maxspeed: '70' }, 'backward', 'BE-WAL').speed).toBe(50);
    expect(resolveSpeed({ highway: 'residential', 'zone:maxspeed': 'BE:30' }, 'forward', 'BE-WAL')).toEqual({ speed: 30, estimated: false });
  });
});

describe('graphe', () => {
  const osm = gridOSM();
  const g = buildGraph(osm, 'BE-WAL');
  it('respecte les sens uniques et les accès privés', () => {
    const owId = osm.elements.find((el) => el.tags && el.tags.oneway === 'yes').id;
    expect(g.out.flat().filter((e) => e.way === owId).length).toBe(1); // la rue à sens unique n'a qu'une arête
    // colonne 3 privée : aucune arête verticale de la colonne 3
    const colLon = 4.84 + 3 * 0.00135 * 1.55;
    const priv = g.out.flat().filter((e) => Math.abs(g.lon[e.from] - colLon) < 1e-9 && Math.abs(g.lon[e.to] - colLon) < 1e-9);
    expect(priv.length).toBe(0);
  });
  it('repère les feux et le rond-point', () => {
    expect(g.signals.size).toBe(4);
    expect(g.out.flat().filter((e) => e.rb).length).toBe(4);
  });
});

describe('boucles', () => {
  const osm = gridOSM();
  const g = buildGraph(osm, 'BE-WAL');
  const start = [osm.center.lat, osm.center.lon];

  it('calcule un plus court chemin', () => {
    const c = buildCriteria('route');
    const s = snapStart(g, start[0], start[1], c);
    const p = shortestPath(g, s.node, s.scc.members[s.scc.members.length - 1], c, s.scc.mask);
    expect(p.length).toBeGreaterThan(0);
    for (let i = 1; i < p.length; i++) expect(p[i].from).toBe(p[i - 1].to);
  });

  for (const [level, km] of [['decouverte', 6], ['ville', 8], ['route', 15]]) {
    it(`profil ${level} : boucle de ${km} km conforme aux critères`, async () => {
      const c = buildCriteria(level);
      const routes = await generateLoops(g, start, { type: 'distance', value: km * 1000 }, c, { seed: 7 });
      expect(routes.length).toBeGreaterThan(0);
      for (const r of routes) {
        // la boucle revient au départ
        expect(r.edges[0].from).toBe(r.edges[r.edges.length - 1].to);
        // continuité
        for (let i = 1; i < r.edges.length; i++) expect(r.edges[i].from).toBe(r.edges[i - 1].to);
        // critères respectés
        for (const e of r.edges) expect(edgeAllowed(e, c)).toBe(true);
        expect(r.stats.maxSpeed).toBeLessThanOrEqual(c.maxSpeed);
        // distance proche de la cible (±20 %)
        expect(Math.abs(r.stats.distance - km * 1000) / (km * 1000)).toBeLessThan(0.2);
      }
      const best = routes[0];
      console.log(level, routes.map((r) => `${(r.stats.distance / 1000).toFixed(1)} km, ${Math.round(r.stats.duration / 60)} min, recouvrement ${(r.overlap * 100).toFixed(0)} %`).join(' | '));
      expect(best.overlap).toBeLessThan(0.35);
    });
  }

  it('profil routes : privilégie les tronçons à 70-90', async () => {
    const c = buildCriteria('route');
    const [r] = await generateLoops(g, start, { type: 'distance', value: 15000 }, c, { seed: 3 });
    const fast = r.stats.bands.b70 + r.stats.bands.b90;
    expect(fast / r.stats.distance).toBeGreaterThan(0.5);
  });

  it('cible une durée', async () => {
    const c = buildCriteria('ville');
    const routes = await generateLoops(g, start, { type: 'duration', value: 20 * 60 }, c, { seed: 2 });
    expect(Math.abs(routes[0].stats.duration - 1200) / 1200).toBeLessThan(0.2);
  });

  it('exporte en GPX et en lien Google Maps', async () => {
    const c = buildCriteria('ville');
    const [r] = await generateLoops(g, start, { type: 'distance', value: 8000 }, c, { seed: 1 });
    const gpx = toGPX(r, 'Test & essai');
    expect(gpx).toContain('<trkpt');
    expect(gpx).toContain('Test &amp; essai');
    const url = googleMapsUrl(r);
    expect(url).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1/);
    expect(decodeURIComponent(url.split('waypoints=')[1]).split('|').length).toBe(8);
  });
});

describe('requête Overpass', () => {
  it('produit une requête bornée', () => {
    const q = buildQuery([50.4, 4.8, 50.5, 4.9], new Set(['residential', 'primary']));
    expect(q).toContain('[bbox:50.40000,4.80000,50.50000,4.90000]');
    expect(q).toContain('^(primary|residential)$');
  });
});

describe('autres pays', () => {
  it('applique les règles du pays', () => {
    expect(resolveSpeed({ highway: 'secondary' }, 'forward', 'FR').speed).toBe(80);
    expect(resolveSpeed({ highway: 'motorway' }, 'forward', 'FR').speed).toBe(130);
    expect(resolveSpeed({ highway: 'trunk' }, 'forward', 'NL').speed).toBe(100);
    expect(resolveSpeed({ highway: 'secondary' }, 'forward', 'DE').speed).toBe(100);
    expect(resolveSpeed({ highway: 'secondary' }, 'forward', 'XX').speed).toBe(80);
    expect(parseMaxspeed('FR:urban', 'BE-WAL')).toBe(50);
    expect(parseMaxspeed('DE:rural', 'FR')).toBe(100);
    expect(parseMaxspeed('GB:nsl_single', 'GB')).toBe(97);
    expect(parseMaxspeed('30 mph', 'GB')).toBe(48);
  });
});
