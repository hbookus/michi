# Michi · parcours pour apprendre à conduire

Michi propose des **boucles de conduite** autour d'un point de départ (pensée pour la Belgique, utilisable dans d'autres pays), selon ce qu'on veut travailler (petites rues, ville, routes, voies rapides) et le temps ou la distance disponible.

Aucune IA dans la boucle : tout est calculé à partir des **données routières réelles d'OpenStreetMap** (types de routes, vitesses maximales, sens uniques, ronds-points, feux).

## Ce que fait l'app

- Départ : position GPS, recherche d'adresse ou clic sur la carte.
- Profils : *Premiers pas* (≤ 50 km/h, petites rues), *En ville* (carrefours, ronds-points), *Routes* (70 à 90 km/h), *Voies rapides* (jusqu'à 120 km/h).
- Objectif en **temps** ou en **distance**.
- Réglages : vitesse maximale, ronds-points (éviter / indifférent / en chercher), feux, sans autoroute.
- Trois parcours proposés, avec pour chacun : distance, durée estimée, km par tranche de vitesse, nombre de ronds-points et de feux, principaux axes.
- Export **GPX** (à ouvrir dans OsmAnd ou Organic Maps, qui guident le long du tracé) et lien **Google Maps** (approximatif : 9 étapes maximum).
- **Mes parcours** : enregistrement dans le navigateur, avec note en étoiles, case « À refaire », commentaire et journal des sorties faites. Filtres « À refaire » et « 4 étoiles et plus ».
- **Mes adresses** : enregistrer des points de départ (Maison, Chez ma sœur…) et les rappeler d'un geste.
- **Sauvegarde / restauration** des parcours dans un fichier `.json` (pour changer d'appareil ou de navigateur).

### Où sont gardés les parcours ?

Dans le stockage local du navigateur (`localStorage`), sur l'appareil utilisé. Ils restent après un rechargement ou un redémarrage. Ils disparaissent si on efface les données du site, en navigation privée, et ne passent pas d'un appareil à l'autre : d'où le bouton « Sauvegarder dans un fichier ». Sur iPhone, ajouter l'app à l'écran d'accueil (Partager > Sur l'écran d'accueil) évite que Safari efface les données d'un site non visité depuis longtemps.

## D'où viennent les vitesses

1. Vitesse signalée dans OpenStreetMap (`maxspeed`, y compris `BE-VLG:rural`, `BE:zone30`…).
2. Sinon, règle du pays du départ (et de la région en Belgique) : hors agglomération 70 km/h en Flandre, 90 km/h en Wallonie, 80 km/h en France… Pays prévus : Belgique, France, Luxembourg, Pays-Bas, Allemagne, Suisse, Autriche, Espagne, Italie, Portugal, Royaume-Uni, Irlande. Ailleurs, règles génériques (50 / 80 / 110) signalées dans l'app.

L'app affiche la part des vitesses « estimées » (non renseignées dans OSM). **Les panneaux sur place font toujours foi.**

## Lancer en local

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # tests du moteur de calcul
npm run build    # version de production dans dist/
```

## Trafic sur le parcours (optionnel)

Avec une clé TomTom, Michi vérifie le trafic **sur chaque parcours proposé** : une dizaine de points le long de la boucle, vitesse actuelle comparée à la vitesse habituelle. Sous le parcours : « fluide », « ralentissements » ou « bouchons », l'impact potentiel, le retard estimé et la durée avec le trafic. Les endroits ralentis sont marqués sur la carte. Pour un parcours enregistré : « Vérifier le trafic maintenant ».

1. Compte gratuit sur [developer.tomtom.com](https://developer.tomtom.com), copier la clé (« My first API key »), restreindre la clé au domaine de l'app (Domain whitelisting).
2. Vercel : *Settings > Environment Variables*, `VITE_TOMTOM_KEY` (type *Config*), puis *Redeploy*.

## Démarrer une sortie

« Démarrer » enregistre le parcours et ouvre le guidage dans Google Maps. En revenant dans Michi, un bandeau « Sortie en cours » propose de **terminer** : étoiles, « à refaire », commentaire. La sortie est ajoutée au journal du parcours avec sa durée réelle.

## Durées

La durée estimée part des vitesses autorisées, réduites pour refléter une conduite réelle (65 % à 30 km/h, jusqu'à 85 % sur voie rapide), plus 20 s par feu et 8 s par rond-point. Le trafic en direct s'ajoute séparément.

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

## Données préparées à l'avance (recommandé)

Les serveurs Overpass publics sont souvent saturés (délais, erreurs 504). Le workflow `.github/workflows/tiles.yml` prépare donc chaque mois toutes les routes de Belgique :

1. il télécharge l'extrait OpenStreetMap du pays chez Geofabrik ;
2. il garde les routes carrossables avec leurs attributs (type, vitesse, sens unique, rond-point, revêtement, accès, nom) et les feux ;
3. il les découpe en carreaux d'environ 11 × 10 km, publiés sur GitHub Pages ;
4. il écrit leur adresse dans `public/tiles.json`, ce qui redéploie l'app sur Vercel.

Ce sont exactement les mêmes données qu'avec Overpass, petites rues comprises, simplement préparées. L'app charge les carreaux autour du départ en 1 à 2 secondes et revient à Overpass hors de la zone couverte.

**Mise en place, une seule fois :**

1. Sur GitHub : *Settings > Pages > Build and deployment > Source* : **GitHub Actions**.
2. Onglet *Actions* > **Préparer les carreaux** > *Run workflow*. Compter 5 à 10 minutes.

Pour ajouter un pays : modifier `REGIONS` dans le workflow (ex. `europe/belgium europe/luxembourg`).

## Architecture

| Fichier | Rôle |
|---|---|
| `src/data.js` | Chargement des routes (carreaux, sinon API Overpass), pays via Nominatim |
| `src/tiles.js` | Lecture et fusion des carreaux préparés |
| `scripts/build_tiles.py` | Préparation des carreaux à partir d'un extrait OSM |
| `src/speed.js` | Règles de vitesse par pays (et région belge) |
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
