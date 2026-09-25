# Michi · parcours pour apprendre à conduire

Michi propose des **boucles de conduite** autour d'un point de départ, en Belgique, selon ce qu'on veut travailler (petites rues, ville, routes, voies rapides) et le temps ou la distance disponible.

Aucune IA dans la boucle : tout est calculé à partir des **données routières réelles d'OpenStreetMap** (types de routes, vitesses maximales, sens uniques, ronds-points, feux).

## Ce que fait l'app

- Départ : position GPS, recherche d'adresse ou clic sur la carte.
- Profils : *Premiers pas* (≤ 50 km/h, petites rues), *En ville* (carrefours, ronds-points), *Routes* (70 à 90 km/h), *Voies rapides* (jusqu'à 120 km/h).
- Objectif en **temps** ou en **distance**.
- Réglages : vitesse maximale, ronds-points (éviter / indifférent / en chercher), feux, sans autoroute.
- Trois parcours proposés, avec pour chacun : distance, durée estimée, km par tranche de vitesse, nombre de ronds-points et de feux, principaux axes.
- Export **GPX** (à ouvrir dans OsmAnd ou Organic Maps, qui guident le long du tracé) et lien **Google Maps** (approximatif : 9 étapes maximum).
- **Mes parcours** : enregistrement local dans le navigateur.

## D'où viennent les vitesses

1. Vitesse signalée dans OpenStreetMap (`maxspeed`, y compris `BE-VLG:rural`, `BE:zone30`…).
2. Sinon, règle régionale selon la région du départ : hors agglomération 70 km/h en Flandre, 90 km/h en Wallonie ; en agglomération 50 km/h (30 km/h à Bruxelles).

L'app affiche la part des vitesses « estimées » (non renseignées dans OSM). **Les panneaux sur place font toujours foi.**

## Lancer en local

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # tests du moteur de calcul
npm run build    # version de production dans dist/
```

## Mettre en ligne (GitHub + Vercel)

1. Crée un dépôt vide sur GitHub (par exemple `michi`).
2. Dans le dossier du projet :
   ```bash
   git remote add origin https://github.com/<ton-compte>/michi.git
   git push -u origin main
   ```
3. Sur [vercel.com](https://vercel.com) : *Add New… > Project*, importe le dépôt. Vercel détecte **Vite** tout seul (build `npm run build`, dossier `dist`). Clique *Deploy*.
4. Chaque `git push` redéploie automatiquement.

Aucune clé d'API ni variable d'environnement n'est nécessaire.

## Architecture

| Fichier | Rôle |
|---|---|
| `src/data.js` | Téléchargement des routes via l'API Overpass (OSM), région via Nominatim |
| `src/speed.js` | Règles de vitesse belges |
| `src/graph.js` | Construction du graphe routier, filtres (accès privés, sens uniques, revêtement) |
| `src/router.js` | A* et génération de boucles (deux points de passage sur un cercle, ajustés pour atteindre l'objectif) |
| `src/stats.js` | Distance, durée estimée, tranches de vitesse, ronds-points, feux |
| `src/levels.js` | Profils de sortie |
| `src/export.js` | GPX et lien Google Maps |
| `src/main.js` | Interface (Leaflet) |

Tout tourne dans le navigateur. Les services utilisés (Overpass, Nominatim, tuiles OSM) sont publics et gratuits, pour un usage raisonnable. Si l'app devait être utilisée par beaucoup de monde, il faudrait passer par un fournisseur de tuiles et un serveur Overpass dédiés.

## Limites

- Pas de données sur les travaux, les limitations temporaires ni la densité du trafic : l'heure de la sortie compte.
- La durée est une estimation (vitesse réduite par rapport au maximum autorisé, plus un temps par feu et par rond-point).
- Les rails de tram ne sont pas encore pris en compte.

Données © contributeurs OpenStreetMap, licence ODbL.
