// Réseau routier synthétique au format Overpass : grille de 40 x 40 carrefours (~150 m).
// Toutes les 5 lignes : route plus importante (tertiary 70 ou primary 90).
export function gridOSM({ size = 40, step = 0.00135, lat0 = 50.44, lon0 = 4.84 } = {}) {
  const elements = [];
  const id = (r, c) => r * 1000 + c + 1;
  const pos = (r, c) => ({ lat: lat0 + r * step, lon: lon0 + c * step * 1.55 });
  let wayId = 1;
  const addWay = (nodes, tags) => {
    elements.push({
      type: 'way',
      id: wayId++,
      nodes: nodes.map(([r, c]) => id(r, c)),
      geometry: nodes.map(([r, c]) => pos(r, c)),
      tags,
    });
  };
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size - 1; c++) {
      let tags = { highway: 'residential' };
      if (r % 10 === 0) tags = { highway: 'primary', maxspeed: '90', ref: `N${r}` };
      else if (r % 5 === 0) tags = { highway: 'tertiary', maxspeed: '70', name: `Rue ${r}` };
      addWay([[r, c], [r, c + 1]], tags);
    }
  }
  for (let c = 0; c < size; c++) {
    for (let r = 0; r < size - 1; r++) {
      let tags = { highway: 'residential', maxspeed: '30' };
      if (c % 10 === 0) tags = { highway: 'secondary', maxspeed: 'BE-WAL:rural' };
      else if (c % 5 === 0) tags = { highway: 'tertiary', maxspeed: '50' };
      if (c === 7 && r === 3) tags = { highway: 'residential', oneway: 'yes' };
      if (c === 3) tags = { highway: 'residential', access: 'private' };
      addWay([[r, c], [r + 1, c]], tags);
    }
  }
  // un petit rond-point autour du nœud (20,20) : boucle à sens unique
  addWay([[20, 20], [20, 21], [21, 21], [21, 20], [20, 20]], { highway: 'tertiary', junction: 'roundabout', maxspeed: '50' });
  // feux
  for (const [r, c] of [[10, 10], [10, 20], [20, 10], [25, 25]]) {
    elements.push({ type: 'node', id: id(r, c), lat: pos(r, c).lat, lon: pos(r, c).lon, tags: { highway: 'traffic_signals' } });
  }
  return { elements, center: pos(size / 2, size / 2) };
}
