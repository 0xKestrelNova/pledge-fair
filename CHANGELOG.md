# Changelog

Toutes les évolutions notables de Pledge Fair. Le format suit
[Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le versionnage
[SemVer](https://semver.org/lang/fr/).

La version affichée dans le pied de page du site vient de `package.json`, via
`docs/version.json` (voir `npm run sync-version`). La version SC affichée à côté
est celle du patch LIVE couvert par les données, pas celle du site.

## [1.2.0] — 2026-08-23

### Ajouté

- Les quatre sections de résultats sont repliables (`<details>/<summary>`).
  Seule « Achetables maintenant » est ouverte au chargement ; titre et compteur
  restent lisibles une fois repliés.
- Chaque tableau n'affiche que ses 25 premières lignes, suivies d'un bouton
  « Afficher les N lignes restantes ». La troncature s'applique après le tri et
  le filtre, donc changer l'un ou l'autre la recalcule.
- En-têtes de colonnes collants pendant le défilement d'un tableau long.

### Modifié

- `applyTableState()` prend une limite et renvoie `{ rows, hidden, all }` au
  lieu d'un tableau : les lignes visibles, le nombre de lignes coupées, et
  l'ensemble filtré+trié avant troncature.
- Lignes de tableau plus denses (`padding` et interlignage des `<td>` réduits).

## [1.1.0] — 2026-08-23

### Ajouté

- Pied de page : version du site, patch Star Citizen couvert par les données,
  date de dernière mise à jour et lien vers ce changelog.
- `npm run sync-version` régénère `docs/version.json` depuis `package.json`, et
  `npm run sync-version:check` échoue si les deux ont divergé. La CI rejoue ce
  contrôle, comme elle rejoue déjà `format:check`.
- `docs/data.json` porte `meta.gameVersion` (patch LIVE lu sur l'API UEX
  `/game_versions`) et son drapeau `meta.gameVersionOk`, aligné sur les quatre
  drapeaux de sources existants.
- Ce fichier.

### Modifié

- `fetchUexJson()` accepte désormais une charge utile objet en plus des
  tableaux : `/game_versions` renvoie `{"live":…,"ptu":…}`, que la validation
  précédente rejetait. Le contrôle du champ `status` est conservé dans les deux
  cas, et les points d'entrée qui attendent un tableau continuent de refuser un
  objet.
- `resolveGeneratedAt()` compare l'intégralité de `meta` plutôt qu'une liste de
  drapeaux figée, pour qu'un champ ajouté plus tard entre automatiquement dans
  le calcul de « les données ont-elles bougé ».

## [1.0.0] — 2026-07-07

Première version publiée sur GitHub Pages.

### Ajouté

- Comparaison de la valeur en jeu (aUEC) des vaisseaux Star Citizen à leur prix
  pledge ($), avec calcul du ratio et du rendement d'un upgrade (règle du CCU).
- Deux modes : catalogue complet sans sélection, upgrades possibles depuis un
  vaisseau de départ.
- Répartition en quatre groupes de disponibilité (en vente seul, pack, pas en
  vente, prix en jeu inconnu), avec tri et filtre indépendants par tableau.
- Mode Concierge pour révéler les packs réservés aux gros contributeurs.
- Génération quotidienne de `docs/data.json` par GitHub Action, fusionnant l'API
  UEX, le pledge store RSI, le Ship Matrix et le wiki communautaire.
- Filet de sécurité sur le roster : refus de réécrire `data.json` si le
  catalogue s'effondre, et drapeaux `meta` signalant chaque source en repli.
- Échappement systématique des données externes et Content-Security-Policy
  stricte, sans `unsafe-inline`.
- Suite de tests `node --test` sans réseau ni navigateur, rejouée en CI avec
  ESLint et Prettier.

[1.2.0]: https://github.com/0xKestrelNova/pledge-fair/releases/tag/v1.2.0
[1.1.0]: https://github.com/0xKestrelNova/pledge-fair/releases/tag/v1.1.0
[1.0.0]: https://github.com/0xKestrelNova/pledge-fair/releases/tag/v1.0.0
