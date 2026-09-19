# Changelog

Toutes les évolutions notables de Pledge Fair. Le format suit
[Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le versionnage
[SemVer](https://semver.org/lang/fr/).

La version affichée dans le pied de page du site vient de `package.json`, via
`docs/version.json` (voir `npm run sync-version`). La version SC affichée à côté
est celle du patch LIVE couvert par les données, pas celle du site.

## [1.4.0] — 2026-09-19

### Ajouté

- Repli APQ sur le catalogue du pledge store. Le storefront RSI n'accepte que
  des requêtes pré-enregistrées, identifiées par un SHA-256 : le texte de la
  requête n'était jamais envoyé, donc le jour où RSI retire ce document de son
  registre, il n'y avait rien à rejouer. Le document est désormais vendorisé
  dans `scripts/storefront-query.mjs` et renvoyé automatiquement quand le
  serveur répond `PersistedQueryNotFound`. Le chemin normal est inchangé — hash
  seul, une requête par page ; les 2 Ko du document ne partent qu'au renvoi, et
  un seul, pour qu'un vrai changement de schéma remonte au lieu de boucler.
- Le document vendorisé a été authentifié : son SHA-256 reproduit au bit près
  le hash attendu par RSI. Le fichier porte un avertissement de non-reformatage,
  le moindre octet modifié invalidant le chemin rapide.

### Corrigé

- Le catalogue Standalone Ships basculait en repli depuis le 31/08/2026, ce qui
  marquait chaque exécution planifiée en échec — 19 d'affilée, sans qu'une ligne
  du dépôt ait bougé. RSI avait retiré de son registre l'opération dédiée
  `GetBrowseSkusStandaloneShipByFilter`, dont le hash était codé en dur depuis le
  commit initial. L'opération générique `GetBrowseSkusByFilter`, déjà utilisée
  pour les packs, sert le même listing : seuls le facet et le produit
  distinguent les deux catalogues. Le site n'était pas cassé pendant cette
  période, mais il servait une disponibilité sur-estimée, marquant achetables
  des vaisseaux qui ne l'étaient pas.
- Six vaisseaux vendus sous un nom court que l'appariement ne pouvait pas
  relier au roster sans risquer un faux positif étaient comptés « pas en
  vente » alors qu'ils sont bien achetables seuls : A2, C2 et M2 Hercules,
  Ares Inferno, Ares Ion et Basher. L'écart était antérieur à la panne du hash.
  Deux entrées du catalogue restent volontairement non appariées, et
  `packages.txt` documente pourquoi : « Sabre Raven EX » est un vaisseau
  distinct que le roster UEX ne liste pas encore, et « Nine Tails Shogun Pack »
  est un pack, sans contrepartie au roster.

### Modifié

- Le hash APQ cesse d'être une constante : il est dérivé du document par
  `documentHash()`, puisque le protocole le définit comme le SHA-256 de ce
  document. Les deux ne peuvent plus diverger. `fetchStorefrontListing()` prend
  en conséquence `queryDoc` au lieu de `sha256`, pour qu'il devienne impossible
  de passer une paire désaccordée.
- `actions/checkout` et `actions/setup-node` passent en v7 : les v4 ciblent
  Node 20, que GitHub a déprécié et force déjà sur Node 24.
- L'image des runners est épinglée sur `ubuntu-24.04` plutôt que `ubuntu-latest`,
  dont le label migre vers Ubuntu 26 à partir du 19/10/2026. La bascule devient
  ainsi déclenchée plutôt que subie, ce qui compte pour un job quotidien sans
  surveillance. L'épinglage est à lever une fois la migration validée.

## [1.3.2] — 2026-08-23

### Corrigé

- `npm run format:check` échouait sur 15 fichiers sur tout poste Windows
  configuré en `core.autocrlf=true` (le réglage par défaut de Git for Windows),
  qui réécrit les fichiers en CRLF au checkout alors que Prettier est réglé sur
  `endOfLine: "lf"`. `npm run format` n'y changeait rien, Git reconvertissant au
  checkout suivant. Un `.gitattributes` (`* text=auto eol=lf`) force désormais
  LF dans l'arbre de travail, quelle que soit la configuration Git locale.
  Aucun contenu n'a changé : tout le dépôt était déjà stocké en LF.

## [1.3.1] — 2026-08-23

### Corrigé

- `npm run sync-version:check` échouait sur tout poste Windows configuré en
  `core.autocrlf=true` (le réglage par défaut de Git for Windows) : le fichier
  est réécrit en CRLF au checkout alors que le script écrit en LF, et la
  comparaison octet à octet y voyait une divergence. La faute était invisible
  en CI, qui tourne sous Linux. La comparaison normalise désormais les fins de
  ligne ; l'indentation et la version restent vérifiées.

## [1.3.0] — 2026-08-23

### Ajouté

- Fiche vaisseau : photo, constructeur, taille, capacité de soute et courte
  description. Visible sur la carte du vaisseau sélectionné, et dans une ligne
  dépliable sous n'importe quelle ligne de tableau.
- `docs/data.json` porte les champs `imageUrl`, `manufacturer`, `size`, `scu`,
  `description` et `padType`, extraits des réponses UEX et Ship Matrix déjà
  téléchargées.
- `safeImageUrl()` valide les URLs de photos côté générateur (schéma `https:`
  et hôte d'une liste blanche, en comparaison exacte) avant de les écrire dans
  `data.json`.

### Modifié

- La directive `img-src` de la CSP autorise les quatre hôtes qui servent
  réellement les photos : `assets.uexcorp.space`, `cdn.uexcorp.space`,
  `media.robertsspaceindustries.com` et `robertsspaceindustries.com`.
- `parseShipMatrix()` retient désormais `{ concept, size, description,
manufacturer }` au lieu du seul booléen de statut. La clé reste le nom
  normalisé, l'appariement existant est inchangé.
- Les vignettes portent `referrerpolicy="no-referrer"` : les deux hôtes UEX
  protègent leurs images contre le hotlink et renvoient 403 dès qu'un `Referer`
  tiers accompagne la requête.

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

[1.4.0]: https://github.com/0xKestrelNova/pledge-fair/releases/tag/v1.4.0
[1.3.2]: https://github.com/0xKestrelNova/pledge-fair/releases/tag/v1.3.2
[1.3.1]: https://github.com/0xKestrelNova/pledge-fair/releases/tag/v1.3.1
[1.3.0]: https://github.com/0xKestrelNova/pledge-fair/releases/tag/v1.3.0
[1.2.0]: https://github.com/0xKestrelNova/pledge-fair/releases/tag/v1.2.0
[1.1.0]: https://github.com/0xKestrelNova/pledge-fair/releases/tag/v1.1.0
[1.0.0]: https://github.com/0xKestrelNova/pledge-fair/releases/tag/v1.0.0
