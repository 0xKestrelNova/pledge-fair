# Pledge Fair — Hangar (extension de navigateur)

Petite extension pour Chrome et Edge qui lit ton hangar Star Citizen sur le
site RSI, en calcule la **valeur de fonte** (ce que RSI te rendrait en crédit
boutique si tu fondais chaque pledge) et l'exporte en **CSV**.

Elle ne fait que lire. Tout se passe dans ton navigateur : rien n'est envoyé
ailleurs, et le CSV est fabriqué sur place.

## Installation (mode développeur)

L'extension n'est pas publiée sur le Chrome Web Store : on la charge depuis ce
dossier.

1. Récupère le dépôt (`git clone`, ou « Code → Download ZIP » puis décompresse).
2. Ouvre `chrome://extensions` (ou `edge://extensions`).
3. Active le **Mode développeur** (interrupteur en haut à droite).
4. Clique **Charger l'extension non empaquetée** et choisis le dossier
   `extension/` — celui qui contient `manifest.json`.

Après une mise à jour du dépôt, reviens sur cette page et clique la flèche
circulaire ↻ de l'extension pour recharger le code.

## Utilisation

1. Connecte-toi sur <https://robertsspaceindustries.com> comme d'habitude.
2. Ouvre ton hangar : **Account → My Hangar**
   (`https://robertsspaceindustries.com/account/pledges`).
3. Un panneau « Pledge Fair — Hangar » apparaît au-dessus de la liste. Clique
   **Calculer la valeur du hangar**.
4. L'extension lit les pages une à une (compte une demi-seconde par page de
   10 pledges), puis affiche le nombre de pledges et le total.
5. Choisis le séparateur et clique **Télécharger le CSV** : le fichier
   `hangar-rsi-AAAA-MM-JJ.csv` arrive dans tes téléchargements.

```
┌ Pledge Fair — Hangar ───────────────────────────────────────────────────┐
│ 37 pledges · Valeur de fonte : 4 215,00 $ USD                           │
│              [ Relire le hangar ]  Séparateur [ ; ▾]  [ Télécharger… ]  │
└─────────────────────────────────────────────────────────────────────────┘
```

### Le fichier CSV

Une ligne par pledge, sans ligne de total : la colonne « Valeur de fonte » se
somme directement dans le tableur.

| Colonne         | Contenu                                                          |
| --------------- | ---------------------------------------------------------------- |
| ID              | Identifiant du pledge chez RSI                                   |
| Pledge          | Nom du pledge                                                    |
| Date            | Date de création, au format `AAAA-MM-JJ`                         |
| Valeur de fonte | Montant rendu par une fonte                                      |
| Devise          | Devise du montant (`USD`)                                        |
| Vaisseaux       | Vaisseaux et véhicules contenus, séparés par `\|`                |
| Assurance       | Assurances contenues (`Lifetime Insurance`, `6 Month Insurance`) |
| Autres articles | Le reste : peintures, équipement, décorations, accès au jeu…     |
| Giftable        | `oui` si RSI propose le bouton « Gift » sur ce pledge            |
| Fondable        | `oui` si RSI propose le bouton « Exchange » sur ce pledge        |

- **Séparateur `;`** (par défaut) : pour Excel en français, montants avec
  virgule décimale (`1234,50`). Le fichier s'ouvre par un double-clic.
- **Séparateur `,`** : CSV classique, montants avec point décimal (`1234.50`).

Le fichier est en UTF-8 avec BOM, pour qu'Excel affiche correctement les
accents.

## Ce que l'extension fait, et ne fait pas

- Elle ne s'active **que** sur les pages du hangar
  (`robertsspaceindustries.com/account/pledges`, avec ou sans préfixe de
  langue comme `/en/`). Elle ne demande **aucune permission** : pas d'accès aux
  autres sites, aux onglets, aux cookies ni à l'historique.
- Elle ne lit que le HTML de ces pages, avec la session déjà ouverte dans
  l'onglet. Elle ne voit ni ne manipule ton mot de passe ou un quelconque
  jeton.
- Elle ne déclenche **aucune action** sur ton compte : ni fonte, ni cadeau, ni
  achat. Elle constate seulement que RSI affiche — ou non — les boutons
  « Gift » et « Exchange ».
- Elle n'envoie rien nulle part et ne stocke rien : fermer l'onglet efface
  tout, sauf le CSV que tu as téléchargé.

Ces promesses sont vérifiées par [`manifest.test.mjs`](manifest.test.mjs), qui
fait échouer la CI si le manifeste demande un jour une permission ou un autre
site.

## Limites

- **Valeur de fonte seulement.** Ce n'est ni le prix que tu as payé (un pledge
  upgradé par CCU fond pour la somme de ce qui y a été mis, pas pour le prix
  catalogue du vaisseau final), ni le prix actuel au pledge store, ni la valeur
  en jeu en aUEC.
- **Les pledges non fondables comptent quand même** dans le total, à la valeur
  que RSI leur attribue (souvent 0 $ pour les récompenses et cadeaux). La
  colonne « Fondable » permet de les filtrer.
- **Le « buy back » n'est pas lu** : seuls les pledges présents dans le hangar
  le sont.
- **Site en anglais.** Les dates et les types d'articles sont lus tels que RSI
  les sert en anglais. Dans une autre langue, une date non reconnue est
  recopiée telle quelle dans le CSV, et un type inconnu range l'article dans
  « Autres articles ».
- **Le hangar n'est pas une API.** L'extension lit le HTML de la page, que RSI
  peut modifier sans prévenir. Si le panneau affiche « Hangar introuvable » ou
  des montants illisibles alors que tu es bien connecté, la structure a changé
  : voir ci-dessous.
- Chrome et Edge uniquement (Manifest V3) ; Firefox n'est pas pris en charge.

## Développement

```
extension/
├── manifest.json        Manifest V3 : un script de contenu, aucune permission
├── loader.js            Script de contenu : charge src/panel.js par import dynamique
├── src/
│   ├── panel.js         Le panneau : seul fichier qui touche à la page et au réseau
│   ├── collect.js       Enchaînement des pages et règle d'arrêt (fetch injecté)
│   ├── extract.js       Extraction des pledges depuis le HTML — tous les sélecteurs
│   ├── value.js         Lecture des montants, total en centimes, formatage
│   ├── csv.js           Génération du CSV (échappement, BOM, séparateurs)
│   └── *.test.mjs       Tests (node --test) des modules purs
├── fixtures/
│   ├── hangar-page-*.html   Pages de hangar anonymisées (structure RSI, données fictives)
│   └── dom.mjs              Adaptateur cheerio → mini API DOM, pour les tests
└── manifest.test.mjs    Garde-fous sur les permissions du manifeste
```

Comme pour le site (`docs/core.js` contre `docs/app.js`), la logique est
séparée de la page : `extract.js`, `value.js`, `csv.js` et `collect.js` sont
purs et testés par `npm test`, sans navigateur. `panel.js` se contente de
brancher ces modules sur la page.

### Si RSI change la structure du hangar

Tout ce qui dépend du HTML de RSI est dans [`src/extract.js`](src/extract.js)
(la table `SEL` des sélecteurs, le format des dates) et dans `parseMoney` de
[`src/value.js`](src/value.js). Pour réparer :

1. Regarde le nouveau balisage d'un pledge dans les outils de développement.
2. Reporte la **structure** dans les fixtures de [`fixtures/`](fixtures/), en
   gardant des données inventées.
3. Lance `npm test` : les tests d'extraction échouent là où ça ne correspond
   plus. Corrige les sélecteurs jusqu'au vert.

**Ne commite jamais une copie brute de ton hangar** : les fixtures ne
contiennent que des pledges fictifs.

### Pagination de RSI

Observée en novembre 2026 : `?page=N` sert 10 pledges par page, le paramètre
`pagesize` est ignoré, et une page demandée au-delà de la fin renvoie de
nouveau la dernière page plutôt qu'une page vide. La collecte s'arrête donc
dès qu'une page n'apporte aucun pledge nouveau — au prix d'une requête de
confirmation en fin de lecture.
