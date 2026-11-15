// Pledge Fair — Hangar : lecture des montants et calcul de la valeur du hangar.
//
// Module pur (ni DOM ni réseau). Les montants sont manipulés en centimes
// entiers : additionner des flottants ("45.10" + "7.20"…) finirait par
// afficher un total en …,999999.

/**
 * "$1,234.50 USD" → { cents: 123450, currency: "USD" }.
 *
 * RSI affiche les montants du hangar au format américain (virgule pour les
 * milliers, point pour les décimales) suivi du code de la devise. Renvoie
 * null si le texte ne contient pas de montant lisible : l'appelant le signale
 * au lieu de compter zéro en silence.
 */
export function parseMoney(raw) {
  const m = /(\d[\d,]*(?:\.\d+)?)\s*([A-Z]{3})?/.exec(raw ?? "");
  if (!m) return null;
  const amount = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(amount)) return null;
  return { cents: Math.round(amount * 100), currency: m[2] ?? "" };
}

/**
 * Valeur de fonte totale du hangar.
 *
 * Les totaux sont tenus par devise : un hangar n'en contient normalement
 * qu'une (USD), mais additionner des devises différentes serait faux.
 * `unreadable` compte les pledges dont le montant n'a pas pu être lu — ils
 * ne sont pas dans le total, et l'interface le dit.
 *
 * @returns {{ count: number, unreadable: number, totals: {currency: string, cents: number}[] }}
 */
export function summarize(pledges) {
  const byCurrency = new Map();
  let unreadable = 0;
  for (const pledge of pledges) {
    if (pledge.valueCents === null) {
      unreadable += 1;
      continue;
    }
    byCurrency.set(pledge.currency, (byCurrency.get(pledge.currency) ?? 0) + pledge.valueCents);
  }
  return {
    count: pledges.length,
    unreadable,
    totals: [...byCurrency].map(([currency, cents]) => ({ currency, cents })),
  };
}

/**
 * Centimes → nombre décimal pour le CSV, sans séparateur de milliers :
 * 123450 → "1234,50" (ou "1234.50" selon `decimalSeparator`).
 */
export function centsToDecimal(cents, decimalSeparator = ",") {
  const abs = Math.abs(cents);
  const fraction = String(abs % 100).padStart(2, "0");
  return `${cents < 0 ? "-" : ""}${Math.trunc(abs / 100)}${decimalSeparator}${fraction}`;
}

const SYMBOLS = { USD: "$", EUR: "€", GBP: "£" };

/** Centimes → montant affiché en français : "4 215,00 $ USD". */
export function formatMoney(cents, currency) {
  const amount = (cents / 100).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return [amount, SYMBOLS[currency], currency].filter(Boolean).join(" ");
}
