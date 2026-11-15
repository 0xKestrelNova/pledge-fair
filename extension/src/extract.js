// Pledge Fair — Hangar : extraction des pledges depuis le HTML du hangar RSI.
//
// Le HTML de /account/pledges n'est pas une API documentée : RSI peut en
// changer la structure sans prévenir. TOUT ce qui dépend de cette structure
// (sélecteurs, formats de date et de montant) vit dans ce fichier et dans
// value.js. Si l'extension cesse de reconnaître le hangar, c'est ici qu'on
// répare — les fixtures de ../fixtures/ et extract.test.mjs disent aussitôt
// ce qui ne correspond plus.
//
// Ce module est pur : il ne touche ni au réseau ni à la page affichée. Il
// reçoit une racine de document et n'en utilise qu'un sous-ensemble minuscule
// de l'API DOM — querySelector, querySelectorAll, textContent, getAttribute —
// ce qui permet de le tester avec `node --test` sur un adaptateur cheerio
// (../fixtures/dom.mjs), sans navigateur ni jsdom.

import { parseMoney } from "./value.js";

/* ---------------------------------------------------------------------------
 * Sélecteurs — structure observée sur RSI en novembre 2026
 * ------------------------------------------------------------------------- */

const SEL = {
  // Liste des pledges de la page. Son absence signifie que la page n'est pas
  // le hangar (session expirée, page d'erreur, refonte du site).
  list: "ul.list-items",
  pledge: "ul.list-items li",
  // Champs cachés posés par RSI sur chaque pledge : la source la plus fiable.
  id: ".js-pledge-id",
  name: ".js-pledge-name",
  // Valeur de fonte ("$45.00 USD"). À ne pas confondre avec
  // .js-pledge-configuration-value, qui diffère pour les pledges upgradés.
  value: ".js-pledge-value",
  title: "h3",
  date: ".date-col",
  status: ".availability",
  upgraded: "h3.upgraded, span.upgraded",
  // Articles contenus : avec vignette (titre + type) ou sans (titre seul).
  item: ".item",
  itemTitle: ".title",
  itemKind: ".kind",
  // Boutons d'action : leur présence dit ce que RSI autorise sur le pledge.
  // L'extension ne fait que constater leur présence, elle ne les actionne pas.
  meltButton: ".js-reclaim",
  giftButton: ".js-gift-v2, .js-gift",
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/* ---------------------------------------------------------------------------
 * Utilitaires
 * ------------------------------------------------------------------------- */

/** Texte d'un élément, espaces et retours à la ligne réduits. */
const text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");

/** Attribut `value` d'un champ caché, ou "" s'il est absent. */
const fieldValue = (root, selector) => {
  const el = root.querySelector(selector);
  return el ? (el.getAttribute("value") ?? "").trim() : "";
};

/**
 * "November 20, 2023" ou "Nov 20, 2023" → "2023-11-20".
 * Renvoie "" si le texte ne ressemble pas à une date RSI : l'appelant garde
 * alors le texte brut plutôt que d'inventer une date.
 */
export function parseRsiDate(raw) {
  const m = /([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(raw ?? "");
  if (!m) return "";
  const month = MONTHS.indexOf(m[1].toLowerCase());
  const day = Number(m[2]);
  if (month < 0 || day < 1 || day > 31) return "";
  return `${m[3]}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/* ---------------------------------------------------------------------------
 * Extraction
 * ------------------------------------------------------------------------- */

/** Un article contenu dans un pledge : { title, kind } (kind "" si inconnu). */
function extractItem(el) {
  return {
    title: text(el.querySelector(SEL.itemTitle)),
    kind: text(el.querySelector(SEL.itemKind)),
  };
}

/**
 * Un pledge du hangar.
 *
 * @returns {{
 *   id: string, name: string, date: string, dateText: string,
 *   valueText: string, valueCents: number|null, currency: string,
 *   status: string, upgraded: boolean,
 *   items: {title: string, kind: string}[],
 *   giftable: boolean, meltable: boolean,
 * }}
 */
export function extractPledge(el) {
  // Le <h3> d'un pledge upgradé contient aussi le bouton « Upgrade log » :
  // le champ caché est plus propre, le titre ne sert que de repli.
  const name = fieldValue(el, SEL.name) || text(el.querySelector(SEL.title));
  // "Created: November 20, 2023" → on retire le libellé.
  const dateText = text(el.querySelector(SEL.date)).replace(/^[^:]*:\s*/, "");
  const valueText = fieldValue(el, SEL.value);
  const money = parseMoney(valueText);

  return {
    id: fieldValue(el, SEL.id),
    name,
    date: parseRsiDate(dateText),
    dateText,
    valueText,
    valueCents: money ? money.cents : null,
    currency: money ? money.currency : "",
    status: text(el.querySelector(SEL.status)),
    upgraded: el.querySelector(SEL.upgraded) !== null,
    items: [...el.querySelectorAll(SEL.item)].map(extractItem).filter((item) => item.title),
    giftable: el.querySelector(SEL.giftButton) !== null,
    meltable: el.querySelector(SEL.meltButton) !== null,
  };
}

/**
 * Tous les pledges d'une page du hangar.
 *
 * `recognized` vaut false quand la liste du hangar est introuvable : la page
 * n'est pas (ou plus) le hangar. Une liste présente mais vide donne
 * `recognized: true` et aucun pledge — un hangar vide est un cas légitime.
 *
 * @returns {{ recognized: boolean, pledges: ReturnType<typeof extractPledge>[] }}
 */
export function extractPage(root) {
  if (!root.querySelector(SEL.list)) return { recognized: false, pledges: [] };
  const pledges = [...root.querySelectorAll(SEL.pledge)]
    // Un <li> sans identifiant ni nom n'est pas un pledge (élément décoratif).
    .filter((li) => li.querySelector(SEL.id) || li.querySelector(SEL.name))
    .map(extractPledge);
  return { recognized: true, pledges };
}

/* ---------------------------------------------------------------------------
 * Lecture des articles contenus
 * ------------------------------------------------------------------------- */

const isInsurance = (item) => /^insurance$/i.test(item.kind) || /\binsurance\b/i.test(item.title);
const isShip = (item) => /^(ship|vehicle)$/i.test(item.kind);

/** Titres des vaisseaux (et véhicules) contenus dans le pledge. */
export const shipsOf = (pledge) => pledge.items.filter(isShip).map((item) => item.title);

/** Assurances du pledge ("Lifetime Insurance", "6 Month Insurance"…). */
export const insuranceOf = (pledge) =>
  pledge.items.filter((item) => !isShip(item) && isInsurance(item)).map((item) => item.title);

/** Tout le reste : peintures, équipement, décorations, accès au jeu… */
export const otherItemsOf = (pledge) =>
  pledge.items.filter((item) => !isShip(item) && !isInsurance(item)).map((item) => item.title);
