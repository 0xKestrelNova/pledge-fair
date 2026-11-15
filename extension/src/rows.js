// Pledge Fair — Hangar : la valeur de fonte affichée sur chaque pledge.
//
// Avec panel.js, c'est le seul fichier qui modifie la page. Il ajoute une
// étiquette « Fonte : 45,00 $ USD » à chaque ligne de la liste du hangar.
//
// Le montant vient de la ligne elle-même (le champ caché que RSI y pose déjà) :
// l'étiquette apparaît donc dès l'ouverture de la page, sans lecture du
// hangar ni requête, et reste juste même si un résultat mémorisé a vieilli.
//
// Les sélecteurs sont ceux de extract.js : si RSI change la structure d'une
// ligne, c'est là-bas qu'on répare.

import { SEL } from "./extract.js";
import { parseMoney, formatMoney } from "./value.js";

/** Classe posée sur nos étiquettes, pour ne pas en ajouter deux fois. */
export const MELT_CLASS = "pledge-fair-melt";

/**
 * Texte de la valeur de fonte d'une ligne du hangar ("45,00 $ USD"), ou null
 * si la ligne ne porte pas de montant lisible. Pur : testable sans navigateur.
 */
export function meltTextOf(row) {
  const field = row.querySelector(SEL.value);
  const money = field ? parseMoney(field.getAttribute("value")) : null;
  return money ? formatMoney(money.cents, money.currency) : null;
}

/**
 * Ajoute l'étiquette aux lignes qui ne l'ont pas encore. Renvoie le nombre
 * d'étiquettes ajoutées. Sans effet sur une ligne déjà étiquetée : on peut
 * l'appeler autant de fois qu'on veut.
 */
export function annotateRows(root = document) {
  let added = 0;
  for (const row of root.querySelectorAll(SEL.pledge)) {
    if (row.querySelector("." + MELT_CLASS)) continue;
    const target = row.querySelector(SEL.rowInfo);
    const melt = meltTextOf(row);
    if (!target || melt === null) continue;

    // Même balisage que les colonnes « Created: » et « Contains: » de RSI
    // (div.date-col > label), pour hériter de leur mise en forme.
    const label = document.createElement("label");
    label.textContent = "Fonte :";
    const tag = document.createElement("div");
    tag.className = `date-col ${MELT_CLASS}`;
    tag.append(label, " " + melt);
    target.append(tag);
    added += 1;
  }
  return added;
}

/**
 * Étiquette les lignes présentes, puis celles qui apparaîtront : RSI ou une
 * autre extension peut reconstruire la liste (tri, « tout afficher »…).
 */
export function watchRows() {
  annotateRows();
  let scheduled = false;
  const observer = new MutationObserver(() => {
    // Une seule passe par image, quel que soit le nombre de mutations ; nos
    // propres ajouts relancent une passe qui ne trouve plus rien à faire.
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      annotateRows();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
