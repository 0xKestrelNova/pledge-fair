// Pledge Fair — Upgrade Advisor : logique pure du front-end.
//
// Ce module ne touche jamais au DOM : il ne contient que des fonctions
// déterministes (échappement, formatage, calcul des upgrades candidats, tri
// et filtre des tableaux). app.js s'occupe de lire l'état de l'interface
// (cases à cocher, sélecteur de tri) et de générer le HTML ; il délègue ici
// tout ce qui est calculable sans navigateur.
//
// Ce découpage permet de tester la logique métier avec `node --test`, sans
// jsdom ni navigateur (voir core.test.mjs). Le navigateur charge ce fichier
// comme un module ES (import depuis app.js), même origine : compatible avec
// la Content-Security-Policy stricte de index.html.

/* ---------------------------------------------------------------------------
 * Utilitaires de présentation
 * ------------------------------------------------------------------------- */

/** Échappe une valeur pour insertion sûre dans du HTML (texte ou attribut). */
export const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

/** Nombre entier au format français : 1 234 567. */
export const fmtN = (n) => n.toLocaleString("fr-FR", { maximumFractionDigits: 0 });

/** Prix en dollars : $1,234.50 (au plus 2 décimales). */
export const fmtUsd = (n) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** "07 juillet 2026 à 15:50" à partir d'un timestamp ISO. */
export function formatFreshness(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "date inconnue";
  const dateStr = d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  const timeStr = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return `${dateStr} à ${timeStr}`;
}

/** "23/08/2026" à partir d'un timestamp ISO, ou null si la date est illisible. */
export function formatShortDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Ligne de version du pied de page :
 *   Pledge Fair v1.1.0 · données SC 4.9 · màj 23/08/2026 · changelog
 *
 * Chaque segment ne s'affiche que si l'information est là. Une source manquante
 * fait donc disparaître son segment plutôt que d'écrire « données SC undefined »
 * ou une date invalide — et le reste de la ligne tient debout tout seul, y
 * compris quand docs/version.json est illisible.
 */
export function versionLine({ siteVersion, gameVersion, generatedAt, changelogUrl } = {}) {
  const parts = [];
  if (siteVersion) parts.push(`Pledge Fair v${esc(siteVersion)}`);
  if (gameVersion) parts.push(`données SC ${esc(gameVersion)}`);
  const day = formatShortDate(generatedAt);
  if (day) parts.push(`màj ${day}`);
  if (changelogUrl) {
    parts.push(`<a href="${esc(changelogUrl)}" target="_blank" rel="noopener">changelog</a>`);
  }
  return parts.join(" · ");
}

/* ---------------------------------------------------------------------------
 * Étiquettes de statut (En vente / Pack / Pas en vente / Concept)
 * ------------------------------------------------------------------------- */

export function packTag(s) {
  return `<span class="tag pk">${s.packName ? "Pack : " + esc(s.packName) : "Pack"}${
    s.packConcierge ? " (Concierge)" : ""
  }</span>`;
}

/**
 * Un vaisseau vendu uniquement dans un pack Concierge est traité comme
 * "Pas en vente" tant que le Mode Concierge n'est pas actif : la plupart des
 * joueurs ne voient tout simplement pas ces packs.
 */
export function isHiddenConcierge(s, conciergeMode) {
  return s.packageOnly && s.packConcierge && !conciergeMode;
}

/**
 * Rang de tri du statut pledge store : 0 = En vente, 1 = Pack,
 * 2 = Pas en vente. Reflète exactement ce que tagsOf() affiche.
 */
export function statusRank(s, conciergeMode) {
  if (isHiddenConcierge(s, conciergeMode)) return 2;
  if (s.packageOnly) return 1;
  if (s.available) return 0;
  return 2;
}

export function tagsOf(s, conciergeMode, showConcept = true) {
  const t = [];
  if (isHiddenConcierge(s, conciergeMode)) t.push('<span class="tag na">Pas en vente</span>');
  else if (s.packageOnly) t.push(packTag(s));
  else if (s.available) t.push('<span class="tag av">En vente</span>');
  else t.push('<span class="tag na">Pas en vente</span>');
  if (showConcept && s.concept) t.push('<span class="tag cc">Concept</span>');
  return t.join("");
}

/* ---------------------------------------------------------------------------
 * Calcul des candidats à l'upgrade
 * ------------------------------------------------------------------------- */

/**
 * Retourne les vaisseaux éligibles à un upgrade depuis `base`, répartis en
 * 4 groupes correspondant aux 4 tableaux de la page :
 *   avail    — achetables seuls dès maintenant (ratio calculable)
 *   pack     — vendus uniquement dans un pack visible (ratio calculable)
 *   unavail  — pas en vente actuellement (ratio calculable)
 *   noInGame — prix en jeu inconnu, donc pas de ratio (souvent Concept)
 *
 * Règle CCU : la cible doit coûter strictement plus cher que le vaisseau de
 * départ ; l'upgrade ne coûte alors que la différence (`cost`).
 * `marginal` = aUEC gagnés ÷ $ réellement dépensés pour CET upgrade.
 * `gain` = variation du ratio absolu par rapport au vaisseau actuel (%).
 *
 * @param {Array}  ships le catalogue complet
 * @param {Object} base  le vaisseau de départ (référence appartenant à ships)
 * @param {Object} opts  { onlyBetter, sortBy, conciergeMode }
 */
export function computeCandidates(ships, base, opts = {}) {
  if (!base) return { avail: [], pack: [], unavail: [], noInGame: [] };
  const { onlyBetter = false, sortBy = "ratio", conciergeMode = false } = opts;
  const withRatio = [];
  const noInGame = [];
  for (const s of ships) {
    if (s === base || s.pledge == null) continue;
    if (s.pledge <= base.pledge) continue; // règle CCU
    const cost = s.pledge - base.pledge;
    if (s.ratio == null) {
      // pas de prix en jeu connu
      noInGame.push({ ...s, cost });
      continue;
    }
    if (onlyBetter && base.ratio != null && s.ratio <= base.ratio) continue;
    const marginal = base.auec != null ? (s.auec - base.auec) / cost : s.auec / cost;
    withRatio.push({
      ...s,
      cost,
      marginal,
      gain: base.ratio != null ? (s.ratio / base.ratio - 1) * 100 : null,
    });
  }
  const cmp = {
    ratio: (a, b) => b.ratio - a.ratio,
    marginal: (a, b) => b.marginal - a.marginal,
    cost: (a, b) => a.cost - b.cost,
    pledge: (a, b) => a.pledge - b.pledge,
  }[sortBy];
  withRatio.sort(cmp);
  noInGame.sort((a, b) => a.pledge - b.pledge);
  return { ...groupByAvailability(withRatio, conciergeMode), noInGame };
}

/**
 * Répartit des lignes déjà triées dans les 3 groupes de disponibilité
 * (achetable seul / pack visible / pas en vente). Partagé par
 * computeCandidates() et computeCatalog() pour que les deux modes classent
 * exactement de la même façon.
 */
export function groupByAvailability(rows, conciergeMode) {
  return {
    avail: rows.filter((r) => r.available && !r.packageOnly),
    pack: rows.filter((r) => r.packageOnly && (conciergeMode || !r.packConcierge)),
    unavail: rows.filter(
      (r) =>
        (!r.available && !r.packageOnly) || (r.packageOnly && r.packConcierge && !conciergeMode),
    ),
  };
}

/**
 * Mode catalogue : tout le catalogue, sans vaisseau de départ. Mêmes 4 groupes
 * que computeCandidates(), mais aucune notion propre à l'upgrade (cost,
 * marginal, gain) puisqu'il n'y a rien à comparer. Sert à parcourir les
 * vaisseaux et leurs ratios sans devoir d'abord sélectionner, par exemple, le
 * vaisseau le moins cher.
 *
 * Les tris propres à l'upgrade retombent sur leur équivalent absolu :
 * `cost` → prix pledge croissant, `marginal` → ratio décroissant.
 *
 * @param {Array}  ships le catalogue complet
 * @param {Object} opts  { sortBy, conciergeMode }
 */
export function computeCatalog(ships, opts = {}) {
  const { sortBy = "ratio", conciergeMode = false } = opts;
  const withRatio = [];
  const noInGame = [];
  for (const s of ships) {
    if (s.pledge == null) continue; // sans prix pledge, rien à comparer
    (s.ratio == null ? noInGame : withRatio).push({ ...s });
  }
  const byPledge = sortBy === "pledge" || sortBy === "cost";
  withRatio.sort(byPledge ? (a, b) => a.pledge - b.pledge : (a, b) => b.ratio - a.ratio);
  noInGame.sort((a, b) => a.pledge - b.pledge);
  return { ...groupByAvailability(withRatio, conciergeMode), noInGame };
}

/* ---------------------------------------------------------------------------
 * Tri, filtre et troncature par tableau
 * ------------------------------------------------------------------------- */

/**
 * Nombre de lignes affichées par défaut dans chaque tableau. Au-delà, le reste
 * est replié derrière un bouton : en mode catalogue les quatre tableaux
 * totalisent ~280 lignes, toutes déployées, ce qui rendait la dernière section
 * inatteignable sans un long scroll.
 */
export const ROW_LIMIT = 25;

/**
 * Applique filtre, tri puis troncature d'un état de tableau `st`
 * ({ sort, dir, filter }) aux lignes `rows`. Les valeurs absentes
 * (null/undefined) sont toujours classées en bas, quel que soit le sens du tri.
 *
 * La troncature vient volontairement en dernier, après le tri et le filtre :
 * les lignes visibles sont donc toujours les `limit` premières de l'ordre
 * courant, et changer de tri ou saisir un filtre recalcule la coupe.
 *
 * @param {Object}      st           { sort, dir, filter }
 * @param {Array}       rows         lignes du groupe
 * @param {Array}       filterFields champs sur lesquels le filtre texte porte
 * @param {?number}     limit        lignes visibles max, ou null pour tout afficher
 * @returns {{rows: Array, hidden: number, all: Array}}
 *   `rows` les lignes à afficher, `hidden` le nombre de lignes coupées,
 *   `all` toutes les lignes retenues (filtre + tri) avant troncature — utile
 *   pour ce qui doit rester stable au déploiement, comme l'échelle des barres.
 */
export function applyTableState(st, rows, filterFields, limit = null) {
  let out = rows;
  if (st.filter) {
    out = out.filter((r) =>
      filterFields.some((f) =>
        String(r[f] ?? "")
          .toLowerCase()
          .includes(st.filter),
      ),
    );
  }
  if (st.sort) {
    const col = st.sort;
    const dir = st.dir;
    out = [...out].sort((a, b) => {
      let va = a[col];
      let vb = b[col];
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // valeurs absentes toujours en bas
      if (vb == null) return -1;
      if (typeof va === "boolean") {
        va = va ? 1 : 0;
        vb = vb ? 1 : 0;
      }
      if (typeof va === "string") return va.localeCompare(vb) * dir;
      return (va - vb) * dir;
    });
  }
  if (limit == null || out.length <= limit) return { rows: out, hidden: 0, all: out };
  return { rows: out.slice(0, limit), hidden: out.length - limit, all: out };
}

/**
 * Bouton de déploiement / repli d'un tableau tronqué. Renvoie une chaîne vide
 * quand il n'y a rien à déployer (tableau plus court que la limite, ou
 * troncature désactivée) : pas de bouton inerte dans la page.
 *
 * `total` est le nombre de lignes retenues par le filtre, `limit` la
 * troncature du tableau — toujours la même valeur, qu'il soit déployé ou non.
 * Le compte de lignes masquées se déduit des deux plutôt que d'être passé à
 * part : une fois le tableau déployé, applyTableState() ne masque plus rien et
 * un `hidden` transmis vaudrait 0, ce qui escamoterait le bouton « Réduire ».
 *
 * Le libellé annonce le nombre exact de lignes concernées — « Voir plus » seul
 * ne dirait pas ce qu'on rate. Le clic est géré par délégation dans app.js
 * (data-expand), comme les en-têtes de tri : aucun JS inline, donc compatible
 * avec la Content-Security-Policy stricte de index.html.
 */
export function expandButton({ total, limit, expanded }) {
  if (limit == null || total <= limit) return "";
  const label = expanded
    ? `Réduire à ${limit} lignes`
    : `Afficher les ${total - limit} lignes restantes`;
  return `<button type="button" class="moreRows" data-expand aria-expanded="${expanded}">${label}</button>`;
}

/**
 * En-tête de colonne triable. Le clic est géré par délégation dans app.js
 * (data-col + un seul listener par tableau) : aucun JS inline, ce qui permet
 * la Content-Security-Policy stricte déclarée dans index.html.
 */
export function thSort(st, col, label, title = "") {
  const active = st.sort === col;
  const arrow = active ? (st.dir === 1 ? " ▲" : " ▼") : "";
  const titleAttr = title ? ` title="${esc(title)}"` : "";
  return `<th class="sortable${active ? " sorted" : ""}"${titleAttr} data-col="${col}">${label}${arrow}</th>`;
}
