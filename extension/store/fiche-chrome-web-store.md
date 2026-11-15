# Fiche Chrome Web Store — Pledge Fair — Hangar

Tout ce qu'il faut saisir dans le
[tableau de bord développeur](https://chrome.google.com/webstore/devconsole)
pour publier l'extension, onglet par onglet. Les textes sont prêts à être
collés. Les intitulés des champs sont ceux du tableau de bord en français ;
Google les renomme parfois, le contenu reste valable.

## Avant de commencer

1. **Compte développeur** : inscription sur le tableau de bord (frais uniques),
   validation en deux étapes activée sur le compte Google.
2. **Politique de confidentialité en ligne** : elle est dans ce dépôt
   (`docs/extension/confidentialite.html`) et n'est servie par GitHub Pages
   qu'une fois fusionnée sur `main`. Vérifie que cette adresse répond avant
   d'envoyer en validation :
   <https://0xkestrelnova.github.io/pledge-fair/extension/confidentialite.html>
3. **Archive** : `npm run package-extension` crée
   `dist/pledge-fair-hangar-<version>.zip`. C'est ce fichier qu'on téléverse
   (« Nouvel élément »). Il ne contient que ce que le manifeste référence — ni
   tests, ni fixtures, ni ce dossier `store/`.

Pour une mise à jour : augmente `version` dans `manifest.json` (le store refuse
une version déjà publiée), relance `npm run package-extension`, téléverse la
nouvelle archive.

## Onglet « Fiche du Store »

| Champ                           | Valeur                                                 |
| ------------------------------- | ------------------------------------------------------ |
| Nom                             | Vient du manifeste : `Pledge Fair — Hangar`            |
| Résumé                          | Vient du manifeste (champ `description`, 132 car. max) |
| Catégorie                       | Outils                                                 |
| Langue                          | Français                                               |
| Icône du Store (128×128)        | `extension/icons/icon-128.png`                         |
| Capture d'écran (1280×800)      | `extension/store/capture-1280x800.png`                 |
| Petite vignette promo (440×280) | `extension/store/vignette-440x280.png`                 |
| Site Web                        | <https://0xkestrelnova.github.io/pledge-fair/>         |
| URL d'assistance                | <https://github.com/0xKestrelNova/pledge-fair/issues>  |
| Contenu réservé aux adultes     | Non                                                    |

La capture montre l'extension sur un hangar fictif (les pledges des tests) :
aucune donnée réelle, aucun visuel du site RSI.

### Description détaillée

```text
Pledge Fair — Hangar calcule la valeur de fonte de ton hangar Star Citizen et l'exporte en CSV ou en JSON.

Ouvre ton hangar sur le site RSI (Account → My Hangar) : l'extension y ajoute un petit panneau et affiche, sur chaque pledge, sa valeur de fonte — ce que RSI te rendrait en crédit boutique si tu le fondais.

CE QUE ÇA FAIT
• Valeur de fonte sur chaque ligne du hangar, dès l'ouverture de la page.
• Total du hangar en un clic, toutes pages confondues.
• Export CSV, pensé pour Excel en français (séparateur « ; » ou « , », accents corrects).
• Export JSON, pour tes scripts et tes outils.
• Le résultat reste affiché quand tu changes de page ou recharges ; un bouton l'efface.

CE QUE ÇA NE FAIT PAS
• Aucune action sur ton compte : ni fonte, ni cadeau, ni achat. L'extension ne fait que lire.
• Aucune donnée envoyée où que ce soit : tout est calculé dans ton navigateur, les fichiers sont fabriqués sur place.
• Aucune permission demandée : l'extension ne s'active que sur les pages de ton hangar et n'a accès à aucun autre site.
• Ni mot de passe, ni cookie, ni jeton de session lus ou manipulés.

À SAVOIR
• La valeur de fonte n'est ni le prix que tu as payé, ni le prix actuel au pledge store, ni la valeur en jeu.
• RSI donne une valeur par pledge, pas par vaisseau : un pack de deux vaisseaux n'a qu'un montant.
• L'extension lit la page du hangar telle que RSI la sert en anglais. Si RSI en change la structure, une mise à jour peut être nécessaire.

Le code est public et testé : https://github.com/0xKestrelNova/pledge-fair/tree/main/extension

Outil de fan non officiel, sans lien avec le groupe Cloud Imperium. Star Citizen®, Roberts Space Industries® et Cloud Imperium® sont des marques déposées de Cloud Imperium Rights LLC.
```

### Description détaillée — version anglaise

À utiliser si tu ajoutes l'anglais comme langue de la fiche. L'interface de
l'extension reste en français.

```text
Pledge Fair — Hangar computes the melt value of your Star Citizen hangar and exports it to CSV or JSON. (The extension's interface is in French.)

Open your hangar on the RSI website (Account → My Hangar): the extension adds a small panel and shows, on each pledge, its melt value — the store credit RSI would give you back if you melted it.

WHAT IT DOES
• Melt value on every hangar row, as soon as the page opens.
• Hangar total in one click, across all pages.
• CSV export, tuned for spreadsheets (";" or "," separator, UTF-8 with BOM).
• JSON export, for your own scripts and tools.
• The result stays on screen when you change page or reload; one button clears it.

WHAT IT DOES NOT DO
• No action on your account: no melt, no gift, no purchase. The extension only reads.
• No data sent anywhere: everything is computed in your browser, files are generated locally.
• No permission requested: the extension only runs on your hangar pages and has no access to any other site.
• No password, cookie or session token is read or handled.

GOOD TO KNOW
• Melt value is not the price you paid, the current pledge store price, or the in-game value.
• RSI gives one value per pledge, not per ship: a two-ship pack has a single amount.
• The extension reads the hangar page as RSI serves it in English. If RSI changes its structure, an update may be needed.

The code is public and tested: https://github.com/0xKestrelNova/pledge-fair/tree/main/extension

Unofficial fan-made tool, not affiliated with the Cloud Imperium group of companies. Star Citizen®, Roberts Space Industries® and Cloud Imperium® are registered trademarks of Cloud Imperium Rights LLC.
```

## Onglet « Pratiques de confidentialité »

Les justifications sont lues par les examinateurs de Google : elles sont
données en anglais.

### Objectif unique

```text
Show the melt value of the user's Star Citizen pledges on their RSI hangar page, compute the hangar total, and let the user export that list as a CSV or JSON file.
```

### Justification des autorisations

L'extension ne déclare **aucune** autorisation (`permissions`,
`host_permissions`). Le tableau de bord demande malgré tout de justifier
l'accès aux pages visées par le script de contenu :

```text
The extension requests no permission. Its only site access is a content script limited to https://robertsspaceindustries.com/account/pledges (with or without a language prefix), the user's own hangar page. On that page it reads the pledge list (name, date, melt value, contained items) to display the melt value of each pledge and the hangar total. To cover hangars spanning several pages, it fetches the following pages of the same URL (?page=N) with plain GET requests to the same origin. It sends no request to any other host and performs no action on the user's account.
```

### Code distant

**Non, je n'utilise pas de code distant.** Tout le code est dans l'archive.
`loader.js` charge `src/panel.js` par un import dynamique, mais c'est un
fichier du paquet (`chrome.runtime.getURL`), pas une ressource externe. Si le
tableau de bord demande une précision :

```text
No remote code. loader.js uses a dynamic import() of a file bundled in the package (chrome.runtime.getURL("src/panel.js")) because Manifest V3 content scripts cannot be ES modules. No script, WebAssembly or eval comes from outside the package.
```

### Utilisation des données

**Aucune case à cocher** dans la liste des catégories de données collectées.
L'extension ne transmet rien hors de l'appareil de l'utilisateur : ni à
l'auteur, ni à un tiers. Ce qu'elle lit sur la page reste dans le navigateur
(stockage de session de l'onglet, fichiers téléchargés à la demande).

> C'est ma lecture de la définition de « collecte » par le Chrome Web Store
> (une donnée traitée uniquement en local n'est pas collectée). Si un
> examinateur en juge autrement, la catégorie à cocher serait **Contenu de
> sites Web**, avec l'explication ci-dessous — et rien d'autre.

```text
The extension reads the text of the user's own RSI hangar page (pledge names, dates, melt values, contained items) to display melt values and build the CSV/JSON export. This data never leaves the browser: it is not sent to the developer or to any third party. The latest result is kept in the tab's sessionStorage so it survives a page reload, and is erased when the tab closes or when the user clicks "Effacer" (Clear).
```

Les trois **certifications** sont à cocher, elles sont toutes vraies :

- Je ne vends ni ne transfère les données des utilisateurs à des tiers, en
  dehors des cas d'utilisation approuvés.
- Je n'utilise ni ne transfère les données des utilisateurs à des fins sans
  rapport avec l'objectif unique de l'article.
- Je n'utilise ni ne transfère les données des utilisateurs pour évaluer leur
  solvabilité ou à des fins de prêt.

### Règles de confidentialité (URL)

<https://0xkestrelnova.github.io/pledge-fair/extension/confidentialite.html>

## Onglet « Distribution »

| Champ      | Valeur recommandée                                                   |
| ---------- | -------------------------------------------------------------------- |
| Paiement   | Gratuit                                                              |
| Visibilité | Publique — ou « Non répertoriée » pour un premier essai avec un lien |
| Régions    | Toutes                                                               |

## Onglet « Instructions de test »

Les examinateurs n'ont pas de compte RSI : sans explication, ils ne verront
rien. À coller dans le champ d'instructions :

```text
This extension only runs on the hangar page of a logged-in Roberts Space Industries account: https://robertsspaceindustries.com/account/pledges

No test account can be provided: RSI accounts are personal game accounts. To see the extension work, sign in to any RSI account that owns at least one pledge and open the URL above. Each pledge row then shows a "Fonte : <amount>" label (its melt value), and a "Pledge Fair — Hangar" panel appears above the list. Clicking "Calculer la valeur du hangar" reads all hangar pages and shows the total; "Télécharger le CSV" / "Télécharger le JSON" save the list locally.

On any other page, including the RSI home page, the extension does nothing. It requests no permission, contains no remote code and sends no data anywhere. Source code: https://github.com/0xKestrelNova/pledge-fair/tree/main/extension
```

## Après l'envoi

- La validation prend de quelques jours à plusieurs semaines. Un refus arrive
  par e-mail avec le motif ; on corrige et on renvoie.
- Chaque mise à jour repasse en validation.
- Si l'extension change un jour ce qu'elle fait des données, mettre à jour
  **d'abord** `docs/extension/confidentialite.html` et cet onglet, puis
  publier.
