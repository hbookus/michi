#!/usr/bin/env python3
"""
Prépare les carreaux de routes utilisés par Michi.

Entrée : un extrait OpenStreetMap (.osm.pbf ou .osm), idéalement déjà filtré avec
    osmium tags-filter pays.osm.pbf w/highway n/highway=traffic_signals -o routes.osm.pbf
Sortie : un dossier de carreaux JSON + un index.

    python3 scripts/build_tiles.py routes.osm.pbf dist-tiles

Deux couches :
  a/ toutes les routes carrossables
  m/ sans les rues résidentielles (profils « Routes » et « Voies rapides », plus légers)

Format d'un carreau :
  { "v": 2, "t": [ {tags}, ... ], "n": [d_id, d_lat, d_lon, ...]  (différences successives de id, lat*1e6, lon*1e6),
    "w": [[way_id, index_tags, [index_noeud, ...]], ...], "s": [index_noeud_feu, ...] }
Une voie qui traverse plusieurs carreaux est copiée entière dans chacun :
l'app fusionne les carreaux et relie les routes par les identifiants de nœuds.
"""
import json
import math
import os
import sys
from datetime import datetime, timezone

import osmium

TILE_LAT = 0.10
TILE_LON = 0.15

HIGHWAYS = {
    'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
    'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified',
    'residential', 'living_street',
}
MINOR = {'residential', 'living_street'}
KEEP_TAGS = (
    'highway', 'maxspeed', 'maxspeed:forward', 'maxspeed:backward', 'maxspeed:type',
    'source:maxspeed', 'zone:maxspeed', 'zone:traffic', 'oneway', 'junction',
    'access', 'vehicle', 'motor_vehicle', 'motorcar', 'surface', 'tracktype',
    'area', 'name', 'ref',
)


def tile_of(lat, lon):
    return math.floor(lon / TILE_LON), math.floor(lat / TILE_LAT)


class Tile:
    __slots__ = ('tags', 'tag_idx', 'nodes', 'node_idx', 'ways', 'signals')

    def __init__(self):
        self.tags, self.tag_idx = [], {}
        self.nodes, self.node_idx = [], {}
        self.ways = []
        self.signals = set()

    def add_way(self, wid, tags, coords, signal_ids):
        key = json.dumps(tags, sort_keys=True, ensure_ascii=False)
        ti = self.tag_idx.get(key)
        if ti is None:
            ti = self.tag_idx[key] = len(self.tags)
            self.tags.append(tags)
        refs = []
        for nid, lat, lon in coords:
            ni = self.node_idx.get(nid)
            if ni is None:
                ni = self.node_idx[nid] = len(self.nodes)
                self.nodes.append([nid, round(lat * 1e6), round(lon * 1e6)])
                if nid in signal_ids:
                    self.signals.add(ni)
            refs.append(ni)
        self.ways.append([wid, ti, refs])

    def to_json(self):
        # Nœuds en différences successives (id, lat, lon) : fichiers 2 à 3 fois plus petits
        flat, pi, pa, po = [], 0, 0, 0
        for nid, la, lo in self.nodes:
            flat += [nid - pi, la - pa, lo - po]
            pi, pa, po = nid, la, lo
        return {'v': 2, 't': self.tags, 'n': flat, 'w': self.ways, 's': sorted(self.signals)}


class Signals(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.ids = set()

    def node(self, n):
        if n.tags.get('highway') == 'traffic_signals':
            self.ids.add(n.id)


class Roads(osmium.SimpleHandler):
    def __init__(self, signal_ids):
        super().__init__()
        self.signal_ids = signal_ids
        self.layers = {'a': {}, 'm': {}}
        self.count = 0
        self.bounds = [90, 180, -90, -180]

    def way(self, w):
        hw = w.tags.get('highway')
        if hw not in HIGHWAYS or w.tags.get('area') == 'yes':
            return
        coords = []
        for n in w.nodes:
            if not n.location.valid():
                return
            coords.append((n.ref, n.location.lat, n.location.lon))
        if len(coords) < 2:
            return
        tags = {k: w.tags.get(k) for k in KEEP_TAGS if w.tags.get(k) is not None}
        tiles = {tile_of(lat, lon) for _, lat, lon in coords}
        layers = ('a',) if hw in MINOR else ('a', 'm')
        for layer in layers:
            for t in tiles:
                self.layers[layer].setdefault(t, Tile()).add_way(w.id, tags, coords, self.signal_ids)
        self.count += 1
        b = self.bounds
        for _, lat, lon in coords:
            b[0] = min(b[0], lat); b[1] = min(b[1], lon); b[2] = max(b[2], lat); b[3] = max(b[3], lon)


def main(src, out):
    sig = Signals()
    sig.apply_file(src)
    roads = Roads(sig.ids)
    roads.apply_file(src, locations=True, idx='flex_mem')

    total = 0
    index = {'v': 2, 'tileLat': TILE_LAT, 'tileLon': TILE_LON, 'layers': {}}
    for layer, tiles in roads.layers.items():
        os.makedirs(os.path.join(out, layer), exist_ok=True)
        index['layers'][layer] = sorted(f'{x}_{y}' for x, y in tiles)
        for (x, y), tile in tiles.items():
            path = os.path.join(out, layer, f'{x}_{y}.json')
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(tile.to_json(), f, ensure_ascii=False, separators=(',', ':'))
            total += os.path.getsize(path)
    index['bounds'] = roads.bounds
    index['ways'] = roads.count
    index['updated'] = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    with open(os.path.join(out, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(index, f, separators=(',', ':'))
    print(f"{roads.count} voies, {sum(len(t) for t in roads.layers.values())} carreaux, {total / 1e6:.1f} Mo")


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
