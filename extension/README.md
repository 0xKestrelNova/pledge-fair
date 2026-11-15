# Pledge Fair — Hangar (extension de navigateur)

Petite extension pour Chrome et Edge qui lit ton hangar Star Citizen sur le
site RSI, en calcule la **valeur de fonte** (ce que RSI te rendrait en crédit
boutique si tu fondais chaque pledge) et l'exporte en **CSV** ou en **JSON**.
Elle affiche aussi la valeur de fonte de chaque pledge directement dans la
liste du hangar.

Elle ne fait que lire ton compte. Tout se passe dans ton navigateur : rien
n'est envoyé ailleurs, et les fichiers sont fabriqués sur place.

## Installation (mode développeur)

L'extension n'est pas publiée sur le Chrome Web Store : on la charge depuis ce
dossier.

1. Récupère le dépôt (`git clone`, ou « Code → Download ZIP » puis décompresse).
2. Ouvre `chrome://extensions` (ou `edge://extensions`).
3. Active le **Mode développeur** (interrupteur en haut à droite).
4. Clique **Charger l'extension non empaquetée** et choisis le dossier
   `extension/` — celui qui contient `manifest.json`.

Après une mise à jour du dépôt, reviens sur cette page et clique la flèche
circulaire ↻ de l'extension pour recharger le code, puis recharge la page du
hangar. Sans ce rechargement, le panneau peut disparaître : Chrome garde
l'ancien manifeste, qui ne connaît pas les fichiers ajoutés depuis.

## Utilisation

1. Connecte-toi sur <https://robertsspaceindustries.com> comme d'habitude.
2. Ouvre ton hangar : **Account → My Hangar**
   (`https://robertsspaceindustries.com/account/pledges`). Chaque pledge de la
   liste porte aussitôt une étiquette **Fonte : 45,00 $ USD**, à côté de sa
   date — sans rien avoir à cliquer.
3. Un panneau « Pledge Fair — Hangar » apparaît au-dessus de la liste. Clique
   **Calculer la valeur du hangar**.
4. L'extension lit les pages une à une (compte une demi-seconde par page de
   10 pledges), puis affiche le nombre de pledges et le total.
5. Exporte le résultat, dans le format qui te convient :
   - **Télécharger le CSV**, après avoir choisi le séparateur, pour un
     tableur : `hangar-rsi-AAAA-MM-JJ.csv` ;
   - **Télécharger le JSON** pour un script ou un autre outil :
     `hangar-rsi-AAAA-MM-JJ.json`.

```
┌ Pledge Fair — Hangar ───────────────────────────────────────────────────┐
│ 37 pledges · Valeur de fonte : 4 215,00 $ USD · lu le 15/11 à 10:30     │
│ [ Relire le hangar ]  Séparateur [ ; ▾]  [ Télécharger le CSV ]         │
│ [ Télécharger le JSON ]  [ Effacer ]                                    │
└─────────────────────────────────────────────────────────────────────────┘
```

### Le résultat reste affiché

Une fois le hangar lu, le total et les boutons d'export restent dans le
panneau quand tu recharges la page ou que tu passes à une autre page du
hangar : pas besoin de relire. Le panneau rappelle quand la lecture a eu lieu
(« lu le 15/11 à 10:30 »).

Ce résultat est mémorisé **dans l'onglet seulement** : il disparaît quand tu
fermes l'onglet, et le bouton **Effacer** le supprime tout de suite. Il ne se
met pas à jour tout seul : après une fonte, un achat ou un cadeau, clique
**Relire le hangar**.

### La valeur de fonte sur chaque pledge

L'étiquette « Fonte : … » de chaque ligne vient de la ligne elle-même, pas du
résultat mémorisé : elle est donc toujours à jour, y compris sur les pages que
tu n'as pas encore lues avec le panneau. RSI donne une valeur de fonte par
pledge, pas par vaisseau : un pack de deux vaisseaux n'a qu'un montant.

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

### Le fichier JSON

Les mêmes informations que le CSV, sous une forme faite pour être relue par un
programme : montants en nombres, articles en tableaux, booléens, et le total
du hangar en tête. Les clés sont en anglais, comme celles de `docs/data.json`.

```json
{
  "readAt": "2026-11-15T10:30:00.000Z",
  "source": "https://robertsspaceindustries.com/account/pledges",
  "count": 37,
  "meltValueTotals": [{ "currency": "USD", "amount": 4215 }],
  "unreadable": 0,
  "truncated": false,
  "pledges": [
    {
      "id": "12345678",
      "name": "Standalone Ship - Aurora MR",
      "date": "2023-11-20",
      "meltValue": 30,
      "currency": "USD",
      "ships": ["Aurora MR"],
      "insurance": ["Lifetime Insurance"],
      "otherItems": ["Hangar Selfland"],
      "giftable": true,
      "meltable": true,
      "upgraded": false
    }
  ]
}
```

- `readAt` : le moment où le hangar a été lu (pas celui du téléchargement).
- `meltValueTotals` : un total par devise (un hangar n'en a normalement
  qu'une).
- `unreadable` : nombre de pledges dont le montant n'a pas pu être lu ; leur
  `meltValue` vaut `null` et ils ne sont pas dans le total.
- `truncated` : `true` si la lecture a été interrompue avant la fin du hangar
  (le total est alors partiel).
- `upgraded` : `true` si RSI marque le pledge comme upgradé (CCU appliqué).
  Cette information n'est pas dans le CSV.

Le fichier est en UTF-8 sans BOM, indenté sur deux espaces.

## Ce que l'extension fait, et ne fait pas

- Elle ne s'active **que** sur les pages du hangar
  (`robertsspaceindustries.com/account/pledges`, avec ou sans préfixe de
  langue comme `/en/`). Elle ne demande **aucune permission** : pas d'accès aux
  autres sites, aux onglets, aux cookies ni à l'historique.
- Elle ne lit que le HTML de ces pages, avec la session déjà ouverte dans
  l'onglet. Sur la page affichée, elle n'ajoute que son panneau et
  l'étiquette « Fonte » de chaque pledge ; elle ne retire ni ne modifie rien
  de ce que RSI affiche. Elle ne voit ni ne manipule ton mot de passe ou un quelconque
  jeton.
- Elle ne déclenche **aucune action** sur ton compte : ni fonte, ni cadeau, ni
  achat. Elle constate seulement que RSI affiche — ou non — les boutons
  « Gift » et « Exchange ».
- Elle n'envoie rien nulle part. Le seul endroit où elle écrit est le
  stockage de session de l'onglet du hangar, pour garder le dernier résultat
  affiché : il ne quitte pas ton navigateur, n'est lisible que par le site
  RSI lui-même (dont ces données proviennent) et s'efface à la fermeture de
  l'onglet ou par le bouton **Effacer**. Restent les fichiers que tu as
  téléchargés.

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
  recopiée telle quelle dans l'export, et un type inconnu range l'article dans
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
├── icons/               Icône de l'extension : source SVG et PNG 16 / 32 / 48 / 128
├── src/
│   ├── panel.js         Le panneau : réseau, stockage de session, téléchargements
│   ├── rows.js          L'étiquette « Fonte » posée sur chaque ligne du hangar
│   ├── collect.js       Enchaînement des pages et règle d'arrêt (fetch injecté)
│   ├── extract.js       Extraction des pledges depuis le HTML — tous les sélecteurs
│   ├── value.js         Lecture des montants, total en centimes, formatage
│   ├── csv.js           Génération du CSV (échappement, BOM, séparateurs)
│   ├── json.js          Génération du JSON (montants en nombres, total en tête)
│   ├── filename.js      Nom daté des fichiers exportés
│   ├── store.js         Forme du résultat mémorisé, et sa vérification à la relecture
│   └── *.test.mjs       Tests (node --test) des modules purs
├── fixtures/
│   ├── hangar-page-*.html   Pages de hangar anonymisées (structure RSI, données fictives)
│   └── dom.mjs              Adaptateur cheerio → mini API DOM, pour les tests
├── store/               Fiche du Chrome Web Store : textes, capture, vignette
└── manifest.test.mjs    Garde-fous sur les permissions du manifeste
```

Comme pour le site (`docs/core.js` contre `docs/app.js`), la logique est
séparée de la page : `extract.js`, `value.js`, `csv.js`, `json.js`,
`filename.js`, `store.js` et `collect.js` sont purs et testés par `npm test`, sans navigateur. `panel.js` se contente de
brancher ces modules sur la page.

### Publier sur le Chrome Web Store

```bash
npm run package-extension
```

crée `dist/pledge-fair-hangar-<version>.zip`, l'archive à téléverser. Elle ne
contient que ce que le manifeste référence (manifeste, script de contenu,
modules de `src/`, icônes) : ni tests, ni fixtures, ni documentation.

Les textes de la fiche, les réponses de l'onglet « Pratiques de
confidentialité », la capture d'écran et la vignette sont dans
[`store/`](store/) — voir
[`store/fiche-chrome-web-store.md`](store/fiche-chrome-web-store.md). La
politique de confidentialité est publiée avec le site :
[`docs/extension/confidentialite.html`](../docs/extension/confidentialite.html).

Les PNG de `icons/` sont des rendus de [`icons/icon.svg`](icons/icon.svg) : si
l'icône change, les régénérer aux quatre tailles.

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
