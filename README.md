# Pledge Fair — Upgrade Advisor

Compare la valeur en jeu (aUEC) de tes vaisseaux Star Citizen à leur prix réel
($), et trouve le meilleur upgrade possible. Application web statique,
données mises à jour automatiquement.

## Structure du dépôt

```
docs/                          Le site publié (GitHub Pages)
├── index.html                 Page unique de l'application
├── style.css                  Styles (thème sombre "cockpit")
├── app.js                     Front-end : lecture de l'UI et rendu du DOM (module ES)
├── core.js                    Logique pure du front-end (calculs, formatage, échappement)
├── core.test.mjs              Tests (node --test) de core.js, sans navigateur
├── data.json                  Données générées — ne pas éditer à la main
└── version.json               Version du site, générée — ne pas éditer à la main
scripts/
├── update-data.mjs            Génère docs/data.json (tourne dans la GitHub Action)
├── update-data.test.mjs       Tests (node --test) des fonctions pures du script
├── sync-version.mjs           Recopie la version de package.json dans docs/version.json
├── sync-version.test.mjs      Tests (node --test) des fonctions pures du script
├── packages.txt.example       Gabarit commenté des corrections manuelles
└── packages.txt               (optionnel, à créer) corrections manuelles de classification
.github/workflows/
├── ci.yml                     Lint + tests + cohérence de version à chaque push / PR
└── update-data.yml            Action planifiée : régénère et commite data.json
CHANGELOG.md                   Historique des versions, lié depuis le pied de page
```

## Le site (`docs/`)

`docs/` est l'application publique, pensée pour être servie telle quelle par
**GitHub Pages** (Settings → Pages → Source : branche `main`, dossier `/docs`).
Elle ne contient que du HTML/CSS/JS statique : `index.html` charge `data.json`
au chargement de la page (même origine, aucun problème CORS) et affiche les
résultats.

La page a deux modes, selon qu'un vaisseau de départ est sélectionné ou non :

- **Catalogue complet** (aucune sélection, état initial) — tout le catalogue et
  ses ratios, réparti dans les mêmes groupes de disponibilité, sans les colonnes
  propres à l'upgrade (coût, gain de ratio, rendement) qui n'auraient pas de
  sens sans point de comparaison. Permet de parcourir tous les vaisseaux sans
  devoir sélectionner, par exemple, le moins cher.
- **Upgrades possibles** (un vaisseau sélectionné) — uniquement les vaisseaux
  plus chers (règle du CCU), avec le coût de l'upgrade et son rendement.

On revient au catalogue avec le bouton « Voir tout le catalogue », ou en
re-cliquant le vaisseau sélectionné.

Les quatre sections de résultats sont repliables (`<details>`) : seule
« Achetables maintenant » est ouverte au chargement. Chaque tableau n'affiche
que ses 25 premières lignes — après tri et filtre —, le reste étant derrière un
bouton « Afficher les N lignes restantes ». Sans ça, le mode catalogue empilait
ses ~280 lignes d'un bloc et la dernière section demandait un long scroll.

Le JavaScript est scindé en deux modules ES, chargés via
`<script type="module">` (même origine, compatible avec la CSP stricte) :
`core.js` regroupe la logique pure (calcul des upgrades candidats, tri/filtre,
formatage, échappement HTML) et se teste sans navigateur ; `app.js` ne garde
que ce qui touche au DOM (lecture des cases à cocher, génération du HTML).
Voir [Tests](#tests).

`docs/data.json` est régénéré automatiquement par une GitHub Action
planifiée (`.github/workflows/update-data.yml`, une fois par jour, ou à la
demande via le bouton "Run workflow" dans l'onglet Actions du repo). Un
bandeau en haut de la page affiche la date de la dernière mise à jour.

## Fiche vaisseau

Chaque vaisseau porte, en plus de ses prix et de son ratio, de quoi savoir de
quel vaisseau on parle : une photo, un constructeur, une taille, une capacité de
soute et une courte description. Ces informations apparaissent à deux endroits —
sur la carte du vaisseau sélectionné, et dans une ligne dépliable sous n'importe
quelle ligne de tableau (clic sur la ligne, ou <kbd>Entrée</kbd> sur le chevron).

Les champs correspondants de `docs/data.json` :

| Champ          | Source                                        | Couverture (23/08/2026) |
| -------------- | --------------------------------------------- | ----------------------- |
| `imageUrl`     | UEX `/vehicles` → `url_photo`, validée        | 262 / 280               |
| `manufacturer` | UEX `company_name`, repli Ship Matrix         | 280 / 280               |
| `size`         | Ship Matrix → `size`, casse normalisée        | 227 / 280               |
| `scu`          | UEX `/vehicles` → `scu`                       | 280 (dont 141 à `0`)    |
| `description`  | Ship Matrix, tronquée à 200 caractères        | 231 / 280               |
| `padType`      | UEX `pad_type` (XS/S/M/L/XL), repli de `size` | 223 / 280               |

Trois détails qui ne se devinent pas :

- **`scu: 0` n'est pas une donnée manquante.** 141 vaisseaux n'ont tout
  simplement pas de soute ; la page écrit « aucune soute », pas « 0 SCU ».
- **La casse de `size` est incohérente côté Ship Matrix** (`Large` et `large`,
  `Capital` et `capital`, plus `snub` et `vehicle`). `normalizeShipSize()` la
  ramène au vocabulaire canonique de RSI ; une valeur hors vocabulaire donne
  `null`, et la ligne disparaît de la fiche plutôt que de s'afficher avec un
  tiret orphelin.
- **La description est tronquée côté générateur**, pas côté navigateur : sans
  ça, `data.json` embarquerait ~26 ko de texte que la page n'affiche jamais.

### Photos : d'où elles viennent, et pourquoi la CSP les autorise

Les photos ne sont pas copiées dans le dépôt : `data.json` pointe vers les URLs
d'origine. Quatre hôtes les servent réellement, mesuré sur les 280 véhicules du
roster — `assets.uexcorp.space` (197), `cdn.uexcorp.space` (59),
`media.robertsspaceindustries.com` (5), `robertsspaceindustries.com` (1).

Deux garde-fous, dans cet ordre :

1. `safeImageUrl()` **valide chaque URL côté serveur** avant de l'écrire dans
   `data.json` : schéma `https:` obligatoire et hôte de la liste blanche, en
   comparaison exacte. `esc()` protège l'insertion HTML, mais ne dit rien de ce
   que pointe un `src`.
2. La directive `img-src` de la CSP (`docs/index.html`) reprend exactement la
   même liste. C'est le second filet, pas le premier : les deux listes doivent
   rester synchronisées.

Enfin, les vignettes portent `referrerpolicy="no-referrer"`. Ce n'est pas un
détail de confidentialité : les deux hôtes UEX, qui servent 256 des 262 photos,
protègent leurs images contre le hotlink et renvoient **403 dès qu'un `Referer`
tiers accompagne la requête**. Sans cet attribut, la quasi-totalité des photos
seraient cassées une fois le site publié.

## Mise à jour des données (`scripts/update-data.mjs`)

Script Node.js (aucune dépendance Python) qui récupère et fusionne :

1. [L'API officielle UEX 2.0](https://uexcorp.space/api/documentation/)
   (`api.uexcorp.uk`, lecture publique sans clé) — prix aUEC en jeu et prix
   pledge de référence. Les pages HTML de uexcorp.space bloquent les IP des
   runners GitHub Actions (403) ; l'API dédiée aux outils tiers n'a pas ce
   problème.
2. Le pledge store RSI lui-même (API interne non documentée) — catalogues
   réels "Standalone Ships" et "Packs", qui ont le dernier mot sur ce qui est
   _vraiment_ en vente.
3. L'outil d'upgrade RSI — repli si 2. est indisponible.
4. Le [Ship Matrix](https://robertsspaceindustries.com/ship-matrix/index)
   officiel — statut Concept / Flight Ready, plus la taille, la description et
   le constructeur de chaque vaisseau (voir « Fiche vaisseau »).
5. Le [wiki communautaire](https://starcitizen.tools) — packs réservés aux
   membres "Concierge" (invisibles dans le catalogue public, même sans
   compte).
6. UEX `/game_versions` — le patch Star Citizen LIVE couvert par les données,
   écrit dans `meta.gameVersion` et affiché dans le pied de page du site.
   Contrairement aux autres points d'entrée UEX, celui-ci renvoie un objet et
   non un tableau, d'où le paramètre `shape` de `fetchUexJson()`.

Ces sources ne supportent pas toutes les requêtes cross-origin (CORS) depuis
un navigateur : c'est pourquoi la récupération se fait côté serveur (dans la
GitHub Action), pas directement dans le JS de la page.

Lancer manuellement :

```bash
npm install
node scripts/update-data.mjs
npm test   # toute la suite de tests (node --test, sans réseau) — voir « Tests »
```

### Priorité des statuts

**La vente directe l'emporte toujours sur le pack.** Un vaisseau que le
catalogue Standalone Ships déclare vendu seul est affiché « En vente », même
si un pack le mentionne aussi et même si `packages.txt` le classe en pack —
une correction manuelle devenue obsolète ne peut donc pas masquer une vraie
vente.

Le catalogue du store et le roster UEX ne nomment pas toujours un vaisseau
pareil : le store vend par exemple « Polaris - Showdown Edition » là où UEX
dit « RSI Polaris ». L'appariement gère les suffixes d'édition connus
(`storefrontAliases`) ; les écarts qu'aucune règle sûre ne rattrape se
déclarent dans `packages.txt`. À chaque exécution, le script **liste les
entrées du catalogue qu'aucun vaisseau du roster ne réclame** — c'est le
signal qui manquait quand des vaisseaux en vente se sont retrouvés classés en
pack sans que rien ne l'indique.

### Corrections manuelles (`scripts/packages.txt`)

Ce fichier optionnel corrige la classification d'un vaisseau dans les deux
sens. Copie le gabarit commenté
[`scripts/packages.txt.example`](scripts/packages.txt.example) en
`scripts/packages.txt` et commite-le pour que la GitHub Action le prenne en
compte. Un vaisseau par ligne, deux formes :

```
Nom du vaisseau | Nom du pack | concierge      # forcer en « vendu en pack »
Nom du vaisseau | @store | Nom côté store      # déclarer le nom du store
```

Les 2ᵉ et 3ᵉ champs sont optionnels. Une ligne `@store` déclare seulement une
correspondance de noms : elle ne force pas la disponibilité, qui reste lue
dans le catalogue live. Si le vaisseau quitte le store, il repasse tout seul
en « pas en vente », sans qu'il y ait de ligne à nettoyer.

### Appariement des noms du catalogue RSI

Le pledge store nomme ses SKU autrement qu'UEX, et un SKU non apparié n'échoue
pas : le vaisseau est simplement affiché « pas en vente » à tort. Deux
mécanismes traitent ces écarts dans `scripts/update-data.mjs` :

- **Suffixe d'assurance** — les SKU de vente anniversaire portent leur durée
  d'assurance dans le nom (`Carrack - 2 Year`, `Perseus - 10 Year`, `… - LTI`).
  `stripInsuranceSuffix()` la retire avant normalisation.
- **Alias explicites** — quelques noms diffèrent trop pour qu'une règle
  générique les rapproche sans risque (`Ursa Rover` → `RSI Ursa`,
  `PTV Buggy` → `Greycat PTV`…). Ils sont listés dans
  `STOREFRONT_NAME_ALIASES`. Retirer aussi des mots de _queue_ n'est pas une
  option : « Anvil Carrack Expedition » correspondrait au SKU « Carrack » et
  serait marqué en vente à tort.

En fin de run, `unmatchedStorefrontNames()` journalise les SKU qu'aucun
vaisseau ne réclame — c'est le signal qu'un alias est à ajouter ou à corriger.

### Filet de sécurité sur le roster

Les cinq drapeaux `meta` de `data.json` (`storefrontOk`, `rsiOk`,
`shipMatrixOk`, `conciergeWikiOk`, `gameVersionOk`) ne surveillent que les
sources _auxiliaires_ ; l'Action les signale (run en échec) dès que l'une est en
repli. La source _principale_, UEX, n'a pas de drapeau : une réponse UEX vidée
ou tronquée passerait donc inaperçue. Le script refuse par sécurité de réécrire
`data.json` quand le roster tombe sous un plancher absolu (50 vaisseaux) ou
s'effondre de plus de moitié par rapport au fichier précédent : il sort en
échec (donc notification + commit sauté) et **préserve les données
précédentes** plutôt que de publier un catalogue quasi vide. Si la baisse est
légitime, relancer avec `--force` :

```bash
node scripts/update-data.mjs --force
```

## Version du site et changelog

Le pied de page affiche la version du site, le patch Star Citizen couvert par
les données, la date de dernière mise à jour et un lien vers le changelog :

```
Pledge Fair v1.1.0 · données SC 4.9 · màj 23/08/2026 · changelog
```

`package.json` est la source de vérité pour la version du site. Le site étant
purement statique et servi tel quel par GitHub Pages, il n'y a pas d'étape de
build où injecter la valeur : un petit `docs/version.json`, lu au chargement,
est le mécanisme le plus simple qui reste en même origine — donc compatible avec
la Content-Security-Policy stricte.

`docs/data.json` ne conviendrait pas comme véhicule : il est régénéré chaque
jour par l'Action de données, alors qu'un bump de version arrive avec une PR de
code. Le site afficherait une version périmée jusqu'au prochain run.

**Dans une PR qui change le comportement du site**, trois gestes :

```bash
npm version minor --no-git-tag-version   # ou major / patch, selon la portée
npm run sync-version                     # régénère docs/version.json
# puis ajouter l'entrée correspondante dans CHANGELOG.md
```

La CI rejoue `npm run sync-version:check` et échoue si `docs/version.json` a
divergé de `package.json`, exactement comme `format:check` garde le formatage.
Sans ce garde-fou, le fichier dériverait en silence.

Le patch SC, lui, ne se bumpe pas à la main : il vient de l'API UEX à chaque
régénération des données. Si `/game_versions` est injoignable, la génération
réussit quand même, `meta.gameVersionOk` passe à `false` et la mention
« données SC … » disparaît simplement du pied de page.

## Tests

`npm test` lance toute la suite avec le lanceur intégré de Node
(`node --test`, aucune dépendance de test). Les fichiers sont découverts
automatiquement et ne font **aucun appel réseau réel** :

- [`scripts/update-data.test.mjs`](scripts/update-data.test.mjs) — logique du
  générateur : normalisation et appariement des noms, fusion des sources
  (UEX / storefront / wiki), repli RSI, parseurs purs des réponses réseau, et
  le filet de sécurité sur le roster. `update-data.mjs` n'expose ses fonctions
  à l'import que lorsqu'il n'est pas exécuté directement, donc les importer ne
  déclenche aucun `fetch`.
- [`scripts/update-data.network.test.mjs`](scripts/update-data.network.test.mjs)
  — contrat de la couche réseau : terminaison et garde-fou de la pagination du
  storefront, enchaînement des variantes RSI, validation de l'enveloppe UEX,
  et repli sur `null` quand une source est injoignable. `globalThis.fetch` est
  remplacé par un bouchon le temps du test — aucun trafic réel.
- [`scripts/sync-version.test.mjs`](scripts/sync-version.test.mjs) — fonctions
  pures de la synchronisation de version. Comme `update-data.mjs`, le script
  n'exécute son pipeline que lancé directement : l'importer ne touche pas au
  disque.
- [`docs/core.test.mjs`](docs/core.test.mjs) — logique pure du front-end
  ([`docs/core.js`](docs/core.js)) : calcul des upgrades candidats (règle CCU,
  répartition en groupes, ratios, tri/filtre), mode catalogue et échappement
  HTML. `core.js`
  ne touche jamais au DOM, d'où des tests sans jsdom ni navigateur.

La CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) rejoue
`npm run lint`, `npm run format:check`, `npm run sync-version:check` puis
`npm test` à chaque push et pull request. Elle est
distincte de `update-data.yml`, qui ne fait que régénérer `data.json` :
la CI valide le code, sans toucher aux données.

## Prévisualiser le site en local

Le site est purement statique : n'importe quel serveur de fichiers suffit.

```bash
python -m http.server 8000 -d docs
# puis ouvrir http://localhost:8000
```

(Ouvrir `docs/index.html` directement en `file://` ne marche pas : le
`fetch("./data.json")` est bloqué hors HTTP.)

## Sécurité

Les données affichées proviennent de sources externes — notamment le wiki
communautaire, publiquement éditable. Deux garde-fous côté front :

- tout texte issu de `data.json` (noms de vaisseaux, de packs, de terminaux,
  URLs, descriptions) est échappé par `esc()` (dans `core.js`, appelé par
  `app.js`) avant insertion dans le DOM — le comportement de `esc()` est couvert
  par les tests ;
- les URLs d'image sont en plus validées côté serveur par `safeImageUrl()`
  avant d'entrer dans `data.json` (voir « Photos » plus haut) : `esc()` rend
  l'insertion HTML sûre, il ne dit rien de la destination d'un `src` ;
- une Content-Security-Policy stricte dans `index.html` bloque tout script
  inline ou tiers en défense en profondeur, et n'autorise les images que depuis
  les quatre hôtes connus.

## Mettre en ligne sur GitHub Pages

1. Créer un dépôt GitHub et y pousser ce projet.
2. Dans **Settings → Pages**, choisir la branche `main` et le dossier `/docs`.
3. Dans **Settings → Actions → General**, vérifier que les workflows ont la
   permission d'écriture (`Workflow permissions` → `Read and write
permissions`) pour que l'Action puisse commiter `docs/data.json`.
4. Le site est servi à `https://<utilisateur>.github.io/<repo>/`.

## Historique

Ce pipeline Node.js a été porté d'anciens prototypes Python (dont
`upgrade_advisor.py`). Ceux-ci ont été retirés du dépôt une fois le portage
terminé ; ils restent consultables dans l'historique git si besoin.
