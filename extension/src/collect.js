// Pledge Fair — Hangar : collecte de toutes les pages du hangar.
//
// Module pur au sens où il ne connaît ni fetch ni le DOM : la fonction qui va
// chercher une page lui est injectée (`fetchPage`). panel.js lui passe une
// vraie requête vers RSI ; les tests lui passent les fixtures.
//
// Comment la pagination de RSI se comporte (observé en novembre 2026) :
//   - /account/pledges?page=N sert 10 pledges par page ; le paramètre
//     `pagesize` est ignoré ;
//   - demander une page au-delà de la dernière ne renvoie PAS une page vide :
//     RSI sert de nouveau la dernière page.
// On ne peut donc pas s'arrêter sur « page vide ». La règle d'arrêt est :
// une page qui n'apporte aucun pledge nouveau termine la collecte. Elle coûte
// une requête de plus que nécessaire, mais ne dépend pas du balisage du
// pager — si RSI le change, on ne risque pas un hangar tronqué en silence.

import { extractPage } from "./extract.js";

/** Erreur destinée à être affichée telle quelle à l'utilisateur. */
export class HangarError extends Error {
  constructor(message) {
    super(message);
    this.name = "HangarError";
  }
}

/** Garde-fou : 200 pages de 10 pledges, bien au-delà d'un hangar réel. */
export const MAX_PAGES = 200;

/**
 * Clé d'identité d'un pledge pour repérer une page déjà vue. L'identifiant
 * RSI suffit ; le repli ne sert que si RSI cessait de le fournir.
 */
const pledgeKey = (pledge, index) =>
  pledge.id || [pledge.name, pledge.dateText, pledge.valueText, index].join("|");

/**
 * Lit les pages du hangar une à une jusqu'à ne plus rien trouver de nouveau.
 *
 * @param {object} options
 * @param {(page: number) => Promise<object>} options.fetchPage
 *   Renvoie la racine du document de la page demandée (numérotée dès 1).
 * @param {(progress: {page: number, count: number}) => void} [options.onProgress]
 * @param {() => Promise<void>} [options.pause]
 *   Attente entre deux pages, pour ne pas marteler le site.
 * @param {number} [options.maxPages]
 * @returns {Promise<{ pledges: object[], pages: number, truncated: boolean }>}
 *   `pages` compte les pages qui ont apporté des pledges ; `truncated` vaut
 *   true si le garde-fou `maxPages` a interrompu la lecture.
 */
export async function collectHangar({
  fetchPage,
  onProgress = () => {},
  pause = async () => {},
  maxPages = MAX_PAGES,
}) {
  const seen = new Set();
  const pledges = [];

  for (let page = 1; page <= maxPages; page++) {
    if (page > 1) await pause();

    const { recognized, pledges: found } = extractPage(await fetchPage(page));
    if (!recognized) {
      throw new HangarError(
        "Hangar introuvable sur la page reçue : ta session RSI a peut-être expiré " +
          "(reconnecte-toi puis recharge la page), ou RSI a changé la structure du hangar.",
      );
    }

    const fresh = found.filter((pledge, index) => !seen.has(pledgeKey(pledge, index)));
    if (fresh.length === 0) return { pledges, pages: page - 1, truncated: false };

    found.forEach((pledge, index) => seen.add(pledgeKey(pledge, index)));
    pledges.push(...fresh);
    onProgress({ page, count: pledges.length });
  }

  return { pledges, pages: maxPages, truncated: true };
}
