// Pledge Fair — Hangar : génération de l'export JSON, entièrement locale.
//
// Module pur (ni DOM ni réseau), pendant de csv.js. Le JSON contient les
// mêmes informations que le CSV, sous une forme faite pour être relue par un
// programme plutôt que par un tableur :
//   - les montants sont des nombres (45.5), pas du texte localisé ;
//   - vaisseaux, assurances et autres articles sont des tableaux ;
//   - giftable / meltable sont des booléens ;
//   - le total du hangar et la date de sa lecture sont en tête du fichier.
//
// Les clés sont en anglais, comme celles de docs/data.json.

import { summarize } from "./value.js";
import { shipsOf, insuranceOf, otherItemsOf } from "./extract.js";

/**
 * Centimes → nombre décimal pour le JSON (123450 → 1234.5).
 * La division d'un entier de centimes par 100 donne le flottant le plus
 * proche du montant : JSON.stringify l'écrit sans bruit d'arrondi (19.99).
 */
const amount = (cents) => (cents === null ? null : cents / 100);

/** Un pledge tel qu'il apparaît dans l'export JSON. */
export function pledgeRecord(pledge) {
  return {
    id: pledge.id,
    name: pledge.name,
    // Date ISO si elle a pu être lue, sinon le texte de RSI tel quel.
    date: pledge.date || pledge.dateText,
    meltValue: amount(pledge.valueCents),
    currency: pledge.currency,
    ships: shipsOf(pledge),
    insurance: insuranceOf(pledge),
    otherItems: otherItemsOf(pledge),
    giftable: pledge.giftable,
    meltable: pledge.meltable,
    upgraded: pledge.upgraded,
  };
}

/**
 * L'export complet du hangar, sous forme d'objet.
 *
 * `readAt` est le moment où le hangar a été lu — pas celui du téléchargement :
 * un résultat mémorisé peut être exporté bien après sa lecture.
 * `truncated` vaut true si la lecture a été interrompue par le garde-fou de
 * pagination : le total est alors partiel, et le fichier le dit.
 */
export function hangarExport(pledges, { readAt = new Date(), truncated = false } = {}) {
  const { count, unreadable, totals } = summarize(pledges);
  return {
    readAt: readAt.toISOString(),
    source: "https://robertsspaceindustries.com/account/pledges",
    count,
    // Un total par devise ; un hangar n'en contient normalement qu'une.
    meltValueTotals: totals.map(({ currency, cents }) => ({ currency, amount: amount(cents) })),
    // Pledges au montant illisible (meltValue null), absents des totaux.
    unreadable,
    truncated,
    pledges: pledges.map(pledgeRecord),
  };
}

/** Le texte JSON du hangar : indenté, UTF-8 sans BOM, terminé par une fin de ligne. */
export function hangarJson(pledges, options) {
  return JSON.stringify(hangarExport(pledges, options), null, 2) + "\n";
}
