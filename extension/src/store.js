// Pledge Fair — Hangar : mise en mémoire du dernier résultat de lecture.
//
// Pour que le total reste affiché quand on recharge la page ou qu'on change
// de page du hangar, panel.js range le résultat dans le `sessionStorage` de
// l'onglet : il ne quitte pas le navigateur, n'est visible que du site RSI
// lui-même (dont il provient) et disparaît à la fermeture de l'onglet.
//
// Ce module est pur : il ne touche pas au stockage. Il transforme un résultat
// en texte et, au retour, vérifie que le texte relu a bien la forme attendue.
// Cette vérification compte : le stockage de session est partagé avec les
// scripts de la page, et un contenu inattendu (ancienne version, donnée
// abîmée) doit être ignoré plutôt que de casser le panneau.

/** Clé de stockage ; le suffixe change si la forme des données change. */
export const STORAGE_KEY = "pledge-fair-hangar:v1";

const VERSION = 1;

/** Résultat de collecte → texte à stocker, daté du moment de la lecture. */
export function serializeResult({ pledges, pages, truncated }, readAt = new Date()) {
  return JSON.stringify({
    version: VERSION,
    readAt: readAt.toISOString(),
    pages,
    truncated,
    pledges,
  });
}

const isString = (value) => typeof value === "string";
const isBoolean = (value) => typeof value === "boolean";

const isItem = (item) =>
  item !== null && typeof item === "object" && isString(item.title) && isString(item.kind);

const isPledge = (pledge) =>
  pledge !== null &&
  typeof pledge === "object" &&
  [pledge.id, pledge.name, pledge.date, pledge.dateText, pledge.valueText, pledge.currency].every(
    isString,
  ) &&
  (pledge.valueCents === null || Number.isSafeInteger(pledge.valueCents)) &&
  [pledge.upgraded, pledge.giftable, pledge.meltable].every(isBoolean) &&
  Array.isArray(pledge.items) &&
  pledge.items.every(isItem);

/**
 * Texte relu du stockage → { pledges, pages, truncated, readAt } ou null.
 *
 * Renvoie null pour tout ce qui n'est pas un résultat complet et bien formé :
 * rien de stocké, JSON illisible, autre version, champ manquant ou d'un type
 * inattendu. L'appelant repart alors d'un panneau vide.
 */
export function parseStored(text) {
  if (!isString(text)) return null;
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (data === null || typeof data !== "object" || data.version !== VERSION) return null;

  const readAt = new Date(data.readAt);
  if (!isString(data.readAt) || Number.isNaN(readAt.getTime())) return null;
  if (!Number.isSafeInteger(data.pages) || !isBoolean(data.truncated)) return null;
  if (!Array.isArray(data.pledges) || !data.pledges.every(isPledge)) return null;

  return { pledges: data.pledges, pages: data.pages, truncated: data.truncated, readAt };
}
