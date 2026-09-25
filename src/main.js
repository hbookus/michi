import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';

import { LEVELS, buildCriteria } from './levels.js';
import { detectRegion, fetchRoads, radiusFor, searchPlace } from './data.js';
import { buildGraph } from './graph.js';
import { generateLoops } from './router.js';
import { SPEED_BANDS, bandOf, zoneOf } from './speed.js';
import { formatDuration, formatKm } from './stats.js';
import { download, googleMapsUrl, toGPX } from './export.js';

// ---------- Stockage local (préférences, parcours enregistrés) ----------
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('michi.' + key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem('michi.' + key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
};

const $ = (s) => document.querySelector(s);
const ROUTE_COLORS = ['#2e4a7d', '#b4533c', '#4f7a5a'];
const LETTERS = ['A', 'B', 'C'];

const state = {
  start: store.get('start', null),
  level: store.get('level', 'decouverte'),
  mode: store.get('mode', 'duration'),
  amount: store.get('amount', null),
  regionInfo: null,
  routes: [],
  selected: 0,
  busy: false,
};

// ---------- Carte ----------
const map = L.map('map', { zoomControl: false, attributionControl: true }).setView([50.64, 4.67], 8);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

const startIcon = L.divIcon({ className: 'start-pin', html: '<span></span>', iconSize: [26, 26], iconAnchor: [13, 13] });
let startMarker = null;
const routeLayer = L.layerGroup().addTo(map);

function setStart(lat, lon, label = '') {
  state.start = { lat, lon, label };
  state.regionInfo = null;
  store.set('start', state.start);
  if (!startMarker) {
    startMarker = L.marker([lat, lon], { icon: startIcon, draggable: true }).addTo(map);
    startMarker.on('dragend', () => {
      const p = startMarker.getLatLng();
      setStart(p.lat, p.lng, '');
    });
  } else startMarker.setLatLng([lat, lon]);
  clearRoutes();
  updateStartInfo();
  $('#go').disabled = false;
  refreshRegion();
}

async function refreshRegion() {
  const s = state.start;
  const info = await detectRegion(s.lat, s.lon);
  if (state.start !== s) return;
  state.regionInfo = info;
  if (!s.label && info.place) s.label = info.place;
  updateStartInfo();
}

function updateStartInfo() {
  const s = state.start;
  const el = $('#start-info');
  if (!s) return;
  const name = s.label ? escapeHtml(s.label.split(',').slice(0, 2).join(',')) : `${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}`;
  let region = '';
  const info = state.regionInfo;
  if (info) {
    if (info.zone && !info.known) region = `<span class="warn">${escapeHtml(info.country || 'Pays')} : règles génériques (hors agglomération 80 km/h). Les vitesses « estimées » peuvent être fausses.</span>`;
    else if (info.zone) {
      const z = zoneOf(info.zone);
      region = `<span class="chip">${z.label}</span> hors agglomération ${z.rural} km/h par défaut`;
    }
  }
  el.innerHTML = `<strong>${name}</strong>${region ? `<br>${region}` : ''}`;
}

map.on('click', (e) => setStart(e.latlng.lat, e.latlng.lng));

$('#locate').addEventListener('click', () => {
  if (!navigator.geolocation) return setStatus('La géolocalisation n’est pas disponible sur cet appareil.', 'error');
  setStatus('Recherche de ta position…');
  navigator.geolocation.getCurrentPosition(
    (p) => {
      setStatus('');
      setStart(p.coords.latitude, p.coords.longitude, 'Ma position');
      map.setView([p.coords.latitude, p.coords.longitude], 14);
    },
    () => setStatus('Position refusée ou introuvable. Touche la carte pour choisir le départ.', 'error'),
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

// ---------- Recherche d'adresse ----------
$('#search').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('#q').value.trim();
  const list = $('#search-results');
  if (q.length < 2) return;
  list.hidden = false;
  list.innerHTML = '<li class="muted">Recherche…</li>';
  try {
    const found = await searchPlace(q);
    if (!found.length) {
      list.innerHTML = '<li class="muted">Aucun résultat en Belgique.</li>';
      return;
    }
    list.innerHTML = '';
    for (const p of found) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = p.label;
      b.addEventListener('click', () => {
        list.hidden = true;
        $('#q').value = '';
        setStart(p.lat, p.lon, p.label);
        map.setView([p.lat, p.lon], 14);
      });
      li.appendChild(b);
      list.appendChild(li);
    }
  } catch {
    list.innerHTML = '<li class="muted">Recherche indisponible pour le moment.</li>';
  }
});

// ---------- Profils et réglages ----------
function renderLevels() {
  const box = $('#levels');
  box.innerHTML = '';
  for (const [key, lv] of Object.entries(LEVELS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'level' + (key === state.level ? ' is-active' : '');
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', key === state.level);
    b.innerHTML = `<span class="level-name">${lv.label}</span><span class="level-hint">${lv.hint}</span>`;
    b.addEventListener('click', () => {
      state.level = key;
      store.set('level', key);
      state.amount = null;
      renderLevels();
      applyLevelDefaults();
    });
    box.appendChild(b);
  }
}

function applyLevelDefaults() {
  const lv = LEVELS[state.level];
  $('#max-speed').value = String(lv.maxSpeed);
  $('#roundabouts').value = lv.roundabouts;
  $('#signals').value = lv.signals;
  $('#avoid-motorway').checked = false;
  $('#avoid-motorway').closest('label').hidden = state.level !== 'rapide';
  configureSlider();
  clearRoutes();
}

function configureSlider() {
  const lv = LEVELS[state.level];
  const s = $('#amount');
  if (state.mode === 'duration') {
    s.min = 10;
    s.max = 120;
    s.step = 5;
    s.value = state.amount ?? lv.defaultMin;
  } else {
    s.min = 2;
    s.max = lv.maxKm;
    s.step = lv.maxKm > 40 ? 5 : 1;
    s.value = state.amount ?? lv.defaultKm;
  }
  state.amount = +s.value;
  updateAmount();
  document.querySelectorAll('.seg').forEach((b) => b.classList.toggle('is-active', b.dataset.mode === state.mode));
}

function updateAmount() {
  const v = +$('#amount').value;
  $('#amount-out').textContent = state.mode === 'duration' ? formatDuration(v * 60) : `${v} km`;
}

$('#amount').addEventListener('input', () => {
  state.amount = +$('#amount').value;
  store.set('amount', state.amount);
  updateAmount();
});

document.querySelectorAll('.seg').forEach((b) =>
  b.addEventListener('click', () => {
    if (state.mode === b.dataset.mode) return;
    state.mode = b.dataset.mode;
    state.amount = null;
    store.set('mode', state.mode);
    store.set('amount', null);
    configureSlider();
  })
);

// ---------- Tabs ----------
document.querySelectorAll('.tab').forEach((t) =>
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => {
      x.classList.toggle('is-active', x === t);
      x.setAttribute('aria-selected', x === t);
    });
    $('#tab-plan').hidden = t.dataset.tab !== 'plan';
    $('#tab-saved').hidden = t.dataset.tab !== 'saved';
    if (t.dataset.tab === 'saved') renderSaved();
    else drawRoutes();
  })
);

// ---------- Calcul ----------
function setStatus(msg, kind = '') {
  const el = $('#status');
  el.className = 'status' + (kind ? ' is-' + kind : '');
  el.innerHTML = msg;
}

let graphCache = { data: null, region: null, graph: null };

$('#go').addEventListener('click', async () => {
  if (!state.start || state.busy) return;
  state.busy = true;
  $('#go').disabled = true;
  clearRoutes();
  try {
    const lv = LEVELS[state.level];
    const criteria = buildCriteria(state.level, {
      maxSpeed: +$('#max-speed').value,
      roundabouts: $('#roundabouts').value,
      signals: $('#signals').value,
      avoidMotorway: $('#avoid-motorway').checked,
    });
    const target =
      state.mode === 'duration'
        ? { type: 'duration', value: state.amount * 60 }
        : { type: 'distance', value: state.amount * 1000 };
    const approxDist = target.type === 'distance' ? target.value : (target.value / 3600) * lv.avgSpeedGuess * 1000 * 1.25;

    if (!state.regionInfo) {
      setStatus('Identification de la région…');
      state.regionInfo = await detectRegion(state.start.lat, state.start.lon);
      updateStartInfo();
    }
    const region = state.regionInfo.zone || 'DEFAULT';

    const data = await fetchRoads(state.start.lat, state.start.lon, radiusFor(approxDist), criteria.highways, (m) => setStatus(m));
    if (graphCache.data !== data || graphCache.region !== region) {
      setStatus('Construction du réseau routier…');
      await new Promise((r) => setTimeout(r, 0));
      graphCache = { data, region, graph: buildGraph(data, region) };
    }
    const routes = await generateLoops(graphCache.graph, [state.start.lat, state.start.lon], target, criteria, {
      seed: Math.floor(Math.random() * 1e9),
      count: 3,
      onProgress: (p) => setStatus(`Recherche de parcours… ${Math.round(p * 100)} %`),
    });
    if (!routes.length) throw new Error('Aucun parcours trouvé avec ces critères. Essaie une autre durée ou assouplis les critères.');
    state.routes = routes.map((r) => ({ ...r, level: state.level, criteria: summaryOfCriteria(criteria) }));
    state.selected = 0;
    setStatus(`${routes.length} parcours proposés. Touche une carte pour l'afficher.`);
    renderResults();
    drawRoutes(true);
  } catch (err) {
    console.error(err);
    setStatus(escapeHtml(err.message || String(err)), 'error');
  } finally {
    state.busy = false;
    $('#go').disabled = false;
  }
});

function summaryOfCriteria(c) {
  const rb = { avoid: 'ronds-points évités', neutral: '', prefer: 'avec ronds-points' }[c.roundabouts];
  return [`≤ ${c.maxSpeed} km/h`, rb, c.signalPenalty ? 'peu de feux' : ''].filter(Boolean).join(' · ');
}

// ---------- Affichage des parcours ----------
function clearRoutes() {
  state.routes = [];
  routeLayer.clearLayers();
  $('#results').innerHTML = '';
}

function speedSegments(coords, speeds) {
  // Regroupe les points consécutifs de même tranche de vitesse
  const segs = [];
  let cur = null;
  for (let i = 0; i < speeds.length; i++) {
    const band = bandOf(speeds[i]);
    if (!cur || cur.band !== band) {
      cur = { band, pts: [coords[i]] };
      segs.push(cur);
    }
    cur.pts.push(coords[i + 1]);
  }
  return segs;
}

function drawOne(route, color, selected) {
  const speeds = route.speeds || route.edges.map((e) => e.speed);
  if (selected) {
    L.polyline(route.coords, { color: '#fff', weight: 9, opacity: 0.9 }).addTo(routeLayer);
    for (const s of speedSegments(route.coords, speeds)) {
      L.polyline(s.pts, { color: s.band.color, weight: 5, opacity: 1 }).addTo(routeLayer);
    }
    L.circleMarker(route.coords[0], { radius: 7, color: '#fff', weight: 3, fillColor: color, fillOpacity: 1 }).addTo(routeLayer);
  } else {
    L.polyline(route.coords, { color, weight: 4, opacity: 0.35, dashArray: '6 6' }).addTo(routeLayer);
  }
}

const isNarrow = () => window.matchMedia('(max-width: 899px)').matches;
function revealMap() {
  if (isNarrow()) document.querySelector('.map-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function drawRoutes(fit = false) {
  routeLayer.clearLayers();
  state.routes.forEach((r, i) => {
    if (i !== state.selected) drawOne(r, ROUTE_COLORS[i % 3], false);
  });
  const sel = state.routes[state.selected];
  if (sel) {
    drawOne(sel, ROUTE_COLORS[state.selected % 3], true);
    if (fit) map.fitBounds(L.latLngBounds(sel.coords).pad(0.12));
  }
}

function bandBar(stats) {
  const total = stats.distance || 1;
  const parts = SPEED_BANDS.filter((b) => stats.bands[b.key] > 0)
    .map((b) => `<span style="flex:${stats.bands[b.key] / total};background:${b.color}" title="${b.label} km/h : ${formatKm(stats.bands[b.key])}"></span>`)
    .join('');
  const legend = SPEED_BANDS.filter((b) => stats.bands[b.key] > 0)
    .map((b) => `<li><i style="background:${b.color}"></i>${b.label} km/h <b>${formatKm(stats.bands[b.key])}</b></li>`)
    .join('');
  return `<div class="bar" aria-hidden="true">${parts}</div><ul class="legend">${legend}</ul>`;
}

function routeCard(r, i, { saved = false } = {}) {
  const s = r.stats;
  const letter = saved ? '' : `<span class="letter" style="background:${ROUTE_COLORS[i % 3]}">${LETTERS[i]}</span>`;
  const title = saved ? escapeHtml(r.name) : `Parcours ${LETTERS[i]}`;
  const est = Math.round(s.estimatedShare * 100);
  const roads = s.mainRoads.length
    ? `<p class="roads"><span class="muted">Principaux axes :</span> ${s.mainRoads.map((x) => escapeHtml(x.name)).join(', ')}</p>`
    : '';
  const gap = !saved && r.startGap > 150 ? `<p class="note">Le parcours commence à ${Math.round(r.startGap)} m du point choisi (route compatible la plus proche).</p>` : '';
  return `
    <article class="card${!saved && i === state.selected ? ' is-selected' : ''}" data-i="${i}">
      <header>
        ${letter}
        <h3>${title}</h3>
        ${saved ? `<span class="muted small">${new Date(r.date).toLocaleDateString('fr-BE')}</span>` : ''}
      </header>
      <div class="figures">
        <div><b>${formatKm(s.distance)}</b><span>distance</span></div>
        <div><b>${formatDuration(s.duration)}</b><span>durée estimée</span></div>
        <div><b>${s.roundabouts}</b><span>ronds-points</span></div>
        <div><b>${s.signals}</b><span>feux</span></div>
      </div>
      ${bandBar(s)}
      ${roads}
      <p class="small muted">${escapeHtml(LEVELS[r.level]?.label || '')}${r.criteria ? ' · ' + escapeHtml(r.criteria) : ''} · ${est ? `${est} % des vitesses estimées` : 'vitesses toutes signalées dans OSM'}</p>
      ${gap}
      ${saved ? notesBlock(r) : ''}
      <div class="actions">
        <button type="button" class="btn-ghost" data-act="gpx">GPX</button>
        <a class="btn-ghost" data-act="gmaps" href="${googleMapsUrl(r)}" target="_blank" rel="noopener">Google Maps</a>
        ${saved ? '<button type="button" class="btn-ghost" data-act="show">Afficher</button><button type="button" class="btn-ghost danger" data-act="del">Supprimer</button>' : '<button type="button" class="btn-ghost" data-act="save">Enregistrer</button>'}
      </div>
    </article>`;
}

function doneSummary(r) {
  const d = r.done || [];
  if (!d.length) return 'Pas encore fait';
  const last = new Date(d[d.length - 1]).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short' });
  return `Fait ${d.length} fois · dernière le ${last}`;
}

function notesBlock(r) {
  const rating = r.rating || 0;
  const stars = [1, 2, 3, 4, 5]
    .map((n) => `<button type="button" class="star${n <= rating ? ' is-on' : ''}" data-act="star" data-v="${n}" aria-label="${n} étoile${n > 1 ? 's' : ''}" aria-pressed="${n <= rating}">★</button>`)
    .join('');
  return `
      <div class="notes">
        <div class="notes-row">
          <div class="stars" aria-label="Note">${stars}</div>
          <label class="redo"><input type="checkbox" data-act="redo"${r.redo ? ' checked' : ''} /> À refaire</label>
        </div>
        <textarea data-act="comment" rows="2" placeholder="Remarques : ce qui a bien marché, un carrefour délicat, à retravailler…">${escapeHtml(r.comment || '')}</textarea>
        <div class="notes-row">
          <span class="small muted" data-done-label>${doneSummary(r)}</span>
          <span class="done-btns">
            ${(r.done || []).length ? '<button type="button" class="link" data-act="undone">Annuler</button>' : ''}
            <button type="button" class="btn-ghost small-btn" data-act="done">Fait aujourd'hui</button>
          </span>
        </div>
      </div>`;
}

function updateSaved(id, patch) {
  const saved = store.get('saved', []);
  const r = saved.find((x) => x.id === id);
  if (!r) return null;
  Object.assign(r, typeof patch === 'function' ? patch(r) : patch);
  store.set('saved', saved);
  return r;
}

function fileName(r, i) {
  const d = new Date().toISOString().slice(0, 10);
  return `michi-${d}-${LEVELS[r.level]?.label.toLowerCase().replace(/\s+/g, '-') || 'parcours'}-${LETTERS[i] || ''}.gpx`;
}

function renderResults() {
  const box = $('#results');
  box.innerHTML = state.routes.map((r, i) => routeCard(r, i)).join('');
  box.querySelectorAll('.card').forEach((card) => {
    const i = +card.dataset.i;
    const r = state.routes[i];
    card.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'gpx') return download(fileName(r, i), toGPX(r, `Michi · ${LEVELS[r.level].label} · ${formatKm(r.stats.distance)}`));
      if (act === 'gmaps') return;
      if (act === 'save') return saveRoute(r, e.target);
      state.selected = i;
      box.querySelectorAll('.card').forEach((c) => c.classList.toggle('is-selected', +c.dataset.i === i));
      drawRoutes(true);
      revealMap();
    });
  });
}

// ---------- Parcours enregistrés ----------
function saveRoute(r, btn) {
  const def = `${LEVELS[r.level].label} · ${formatKm(r.stats.distance)} · ${state.start?.label?.split(',')[0] || ''}`.replace(/ · $/, '');
  const name = prompt('Nom du parcours', def);
  if (name === null) return;
  const saved = store.get('saved', []);
  saved.unshift({
    id: Date.now(),
    name: name.trim() || def,
    date: new Date().toISOString(),
    level: r.level,
    criteria: r.criteria,
    stats: r.stats,
    coords: r.coords.map(([a, b]) => [+a.toFixed(5), +b.toFixed(5)]),
    speeds: r.edges.map((e) => e.speed),
  });
  try {
    navigator.storage?.persist?.();
  } catch {}
  if (!store.set('saved', saved)) return setStatus("Impossible d'enregistrer : stockage du navigateur indisponible.", 'error');
  btn.textContent = 'Enregistré';
  btn.disabled = true;
  updateSavedCount();
}

function updateSavedCount() {
  const n = store.get('saved', []).length;
  $('#saved-count').textContent = n ? n : '';
}

let savedFilter = 'all';

function renderSaved() {
  const all = store.get('saved', []);
  const box = $('#saved');
  routeLayer.clearLayers();
  const redoCount = all.filter((r) => r.redo).length;
  const toolbar = `
    <div class="saved-bar">
      <div class="filters">
        <button type="button" class="filter${savedFilter === 'all' ? ' is-active' : ''}" data-filter="all">Tous (${all.length})</button>
        <button type="button" class="filter${savedFilter === 'redo' ? ' is-active' : ''}" data-filter="redo">À refaire (${redoCount})</button>
        <button type="button" class="filter${savedFilter === 'top' ? ' is-active' : ''}" data-filter="top">★ 4 et plus</button>
      </div>
      <p class="small muted">Gardés dans ce navigateur, sur cet appareil.
        <button type="button" class="link" data-backup="export">Sauvegarder dans un fichier</button> ·
        <button type="button" class="link" data-backup="import">Restaurer</button>
      </p>
    </div>`;
  const list = all.filter((r) => savedFilter === 'all' || (savedFilter === 'redo' ? r.redo : (r.rating || 0) >= 4));
  const empty = !all.length
    ? '<p class="muted empty">Aucun parcours enregistré. Après un calcul, touche « Enregistrer » sur un parcours pour le retrouver ici.</p>'
    : !list.length
      ? '<p class="muted empty">Aucun parcours dans ce filtre.</p>'
      : '';
  box.innerHTML = toolbar + empty + list.map((r, i) => routeCard(r, i, { saved: true }).replace(`data-i="${i}"`, `data-id="${r.id}"`)).join('');

  box.querySelectorAll('[data-filter]').forEach((b) =>
    b.addEventListener('click', () => {
      savedFilter = b.dataset.filter;
      renderSaved();
    })
  );
  box.querySelector('[data-backup=export]').addEventListener('click', () => {
    const d = new Date().toISOString().slice(0, 10);
    download(`michi-sauvegarde-${d}.json`, JSON.stringify({ app: 'michi', version: 1, saved: store.get('saved', []) }), 'application/json');
  });
  box.querySelector('[data-backup=import]').addEventListener('click', importBackup);

  box.querySelectorAll('.card').forEach((card) => {
    const id = +card.dataset.id;
    const get = () => store.get('saved', []).find((x) => x.id === id);
    const comment = card.querySelector('textarea');
    let t;
    comment.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => updateSaved(id, { comment: comment.value }), 400);
    });
    comment.addEventListener('blur', () => updateSaved(id, { comment: comment.value }));
    card.querySelector('[data-act=redo]').addEventListener('change', (e) => {
      updateSaved(id, { redo: e.target.checked });
      const n = store.get('saved', []).filter((r) => r.redo).length;
      box.querySelector('[data-filter=redo]').textContent = `À refaire (${n})`;
    });
    card.addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]');
      const act = el?.dataset.act;
      const r = get();
      if (!r) return;
      if (act === 'comment' || act === 'redo' || (!act && e.target.closest('.notes'))) return;
      if (act === 'star') {
        const v = +el.dataset.v;
        const rating = r.rating === v ? 0 : v;
        updateSaved(id, { rating });
        card.querySelectorAll('.star').forEach((s) => {
          const on = +s.dataset.v <= rating;
          s.classList.toggle('is-on', on);
          s.setAttribute('aria-pressed', on);
        });
        return;
      }
      if (act === 'done' || act === 'undone') {
        updateSaved(id, (x) => {
          const done = [...(x.done || [])];
          if (act === 'done') done.push(new Date().toISOString());
          else done.pop();
          return { done };
        });
        const scrollY = window.scrollY;
        renderSaved();
        window.scrollTo(0, scrollY);
        return;
      }
      if (act === 'gpx') return download(`michi-${r.name.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}.gpx`, toGPX(r, r.name));
      if (act === 'gmaps') return;
      if (act === 'del') {
        if (!confirm(`Supprimer « ${r.name} » ?`)) return;
        store.set('saved', store.get('saved', []).filter((x) => x.id !== id));
        updateSavedCount();
        return renderSaved();
      }
      routeLayer.clearLayers();
      drawOne(r, ROUTE_COLORS[0], true);
      map.fitBounds(L.latLngBounds(r.coords).pad(0.12));
      box.querySelectorAll('.card').forEach((c) => c.classList.toggle('is-selected', c === card));
      revealMap();
    });
  });
}

function importBackup() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const incoming = Array.isArray(data) ? data : data.saved;
      if (!Array.isArray(incoming)) throw new Error();
      const current = store.get('saved', []);
      const ids = new Set(current.map((r) => r.id));
      const added = incoming.filter((r) => r && r.id && r.coords && !ids.has(r.id));
      const merged = [...current, ...added].sort((a, b) => new Date(b.date) - new Date(a.date));
      store.set('saved', merged);
      updateSavedCount();
      renderSaved();
      alert(`${added.length} parcours restauré${added.length > 1 ? 's' : ''}.`);
    } catch {
      alert("Ce fichier n'est pas une sauvegarde Michi.");
    }
  });
  input.click();
}

function escapeHtml(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ---------- Démarrage ----------
renderLevels();
applyLevelDefaults();
updateSavedCount();
if (state.start) {
  setStart(state.start.lat, state.start.lon, state.start.label);
  map.setView([state.start.lat, state.start.lon], 13);
}
