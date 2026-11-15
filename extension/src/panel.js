// Pledge Fair — Hangar : le panneau ajouté à la page du hangar RSI.
//
// C'est le seul fichier de l'extension qui touche au réseau et au stockage ;
// avec rows.js (l'étiquette de fonte sur chaque ligne), le seul qui touche à
// la page. Tout le reste est pur et testé sans navigateur : extract.js
// (lecture du HTML), value.js (montants et total), csv.js et json.js (fichiers
// exportés), filename.js (leur nom), collect.js (enchaînement des pages),
// store.js (forme du résultat mémorisé).
//
// Ce que fait ce fichier, et rien d'autre :
//   - il ajoute un panneau au-dessus de la liste du hangar ;
//   - au clic, il lit les pages /account/pledges?page=N par des requêtes GET
//     vers la même origine, avec la session déjà ouverte dans l'onglet ;
//   - il affiche le total et fabrique le CSV ou le JSON dans le navigateur ;
//   - il mémorise le dernier résultat dans le sessionStorage de l'onglet, pour
//     le réafficher après un rechargement ou un changement de page du hangar.
//
// Ce qu'il ne fait jamais : lire ou transmettre des identifiants, cliquer sur
// un bouton du site (fonte, cadeau, achat), envoyer une requête à un autre
// hôte que celui de la page, écrire ailleurs que dans le stockage de session
// de l'onglet (effacé à sa fermeture, ou par le bouton « Effacer »).

import { collectHangar, HangarError } from "./collect.js";
import { summarize, formatMoney } from "./value.js";
import { hangarCsv, SEPARATORS } from "./csv.js";
import { hangarJson } from "./json.js";
import { exportFileName } from "./filename.js";
import { STORAGE_KEY, serializeResult, parseStored } from "./store.js";
import { watchRows } from "./rows.js";

const HOST_ID = "pledge-fair-hangar";

/** Pause entre deux pages : on lit le hangar, on ne le martèle pas. */
const PAGE_PAUSE_MS = 300;

const STYLE = `
  :host { all: initial; display: block; margin: 0 0 16px; }
  .panel {
    font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #dbe7f3; background: #0e1b2a; border: 1px solid #2b4a68;
    border-radius: 6px; padding: 12px 16px;
    display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px;
  }
  .panel.floating {
    position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
    max-width: 420px; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
  }
  .brand { font-weight: 600; color: #7fc4ff; white-space: nowrap; }
  .status { flex: 1 1 240px; min-width: 0; }
  .status.error { color: #ff9c8a; }
  .status strong { color: #fff; }
  .controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  button, select {
    font: inherit; color: #dbe7f3; background: #16304a; border: 1px solid #3a6a96;
    border-radius: 4px; padding: 6px 12px; cursor: pointer;
  }
  button:hover:not(:disabled) { background: #1f456b; }
  button:disabled { opacity: 0.5; cursor: default; }
  button:focus-visible, select:focus-visible { outline: 2px solid #7fc4ff; outline-offset: 2px; }
  label { display: flex; align-items: center; gap: 6px; }
  [hidden] { display: none !important; }
`;

/** Crée un élément ; `props` sont posées telles quelles (textContent, etc.). */
function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

/* ---------------------------------------------------------------------------
 * Réseau : lecture d'une page du hangar
 * ------------------------------------------------------------------------- */

/**
 * Récupère la page N du hangar et la renvoie comme Document.
 *
 * On analyse le HTML reçu du serveur, jamais la page affichée : d'autres
 * extensions peuvent avoir modifié celle-ci (tri, « tout afficher »…), le
 * HTML d'origine, lui, ne dépend que de RSI.
 */
async function fetchHangarPage(page) {
  // Même chemin que la page ouverte (avec son préfixe de langue éventuel),
  // seul le numéro de page change.
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set("page", String(page));

  let response;
  try {
    response = await fetch(url, { credentials: "same-origin" });
  } catch {
    throw new HangarError("Impossible de joindre RSI. Vérifie ta connexion puis réessaie.");
  }
  if (!response.ok) {
    throw new HangarError(
      `RSI a répondu ${response.status} en lisant la page ${page}. Réessaie dans un instant.`,
    );
  }
  // Session expirée : RSI redirige hors du hangar.
  if (!new URL(response.url).pathname.includes("/account/pledges")) {
    throw new HangarError("RSI a redirigé hors du hangar : reconnecte-toi puis recharge la page.");
  }
  return new DOMParser().parseFromString(await response.text(), "text/html");
}

const pause = () => new Promise((resolve) => setTimeout(resolve, PAGE_PAUSE_MS));

/* ---------------------------------------------------------------------------
 * Téléchargement local des exports
 * ------------------------------------------------------------------------- */

/** Fait télécharger un texte fabriqué sur place, sans passer par le réseau. */
function download(content, type, extension) {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = el("a", { href: url, download: exportFileName(extension) });
  link.click();
  // Laisse au navigateur le temps de démarrer le téléchargement.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/* ---------------------------------------------------------------------------
 * Mémoire de l'onglet : le dernier résultat survit aux rechargements
 * ------------------------------------------------------------------------- */

// sessionStorage peut être indisponible ou plein (navigation privée stricte,
// quota) : dans ce cas le panneau fonctionne simplement sans mémoire.

function loadStored() {
  try {
    return parseStored(sessionStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function saveStored(result) {
  try {
    sessionStorage.setItem(STORAGE_KEY, serializeResult(result, result.readAt));
  } catch {
    // Pas de mémoire cette fois : le résultat reste affiché jusqu'au rechargement.
  }
}

function clearStored() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Rien à effacer si le stockage est inaccessible.
  }
}

/* ---------------------------------------------------------------------------
 * Panneau
 * ------------------------------------------------------------------------- */

const plural = (n, word) => `${n} ${word}${n > 1 ? "s" : ""}`;

/** "15/11 à 10:30" : le moment de la lecture, pour juger si elle a vieilli. */
function formatReadAt(readAt) {
  const day = readAt.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
  const time = readAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return `${day} à ${time}`;
}

/** Phrase de résultat : nombre de pledges, total(s), réserves, date de lecture. */
function summaryNodes({ pledges, truncated, readAt }) {
  const { count, unreadable, totals } = summarize(pledges);
  const when = ` · lu le ${formatReadAt(readAt)}`;
  if (count === 0) return ["Aucun pledge trouvé dans ce hangar" + when + "."];

  const total = totals.map(({ cents, currency }) => formatMoney(cents, currency)).join(" + ");
  const nodes = [
    `${plural(count, "pledge")} · Valeur de fonte : `,
    el("strong", { textContent: total || "—" }),
  ];
  if (unreadable > 0)
    nodes.push(
      ` · ${plural(unreadable, "montant")} illisible${unreadable > 1 ? "s" : ""}, hors total`,
    );
  if (truncated) nodes.push(" · lecture interrompue : hangar trop long, total partiel");
  nodes.push(when);
  return nodes;
}

const IDLE_STATUS = "Calcule la valeur de fonte de ton hangar.";
const READ_LABEL = "Calculer la valeur du hangar";

function buildPanel() {
  const status = el("div", { className: "status", textContent: IDLE_STATUS });
  status.setAttribute("role", "status");

  const readButton = el("button", { type: "button", textContent: READ_LABEL });
  const separator = el(
    "select",
    {},
    SEPARATORS.map((value) => el("option", { value, textContent: value })),
  );
  const separatorLabel = el("label", { hidden: true }, ["Séparateur", separator]);
  const csvButton = el("button", {
    type: "button",
    textContent: "Télécharger le CSV",
    hidden: true,
  });
  const jsonButton = el("button", {
    type: "button",
    textContent: "Télécharger le JSON",
    hidden: true,
  });
  const forgetButton = el("button", {
    type: "button",
    textContent: "Effacer",
    title: "Efface le résultat mémorisé dans cet onglet",
    hidden: true,
  });
  // Les exports n'apparaissent qu'une fois le hangar lu, et s'il n'est pas vide.
  const setExportsHidden = (hidden) => {
    separatorLabel.hidden = csvButton.hidden = jsonButton.hidden = hidden;
  };

  let result = null;

  const setStatus = (nodes, isError = false) => {
    status.replaceChildren(...nodes);
    status.classList.toggle("error", isError);
  };

  /** Affiche un résultat, qu'il vienne d'être lu ou qu'il sorte de la mémoire. */
  const showResult = (shown) => {
    result = shown;
    setStatus(summaryNodes(result));
    setExportsHidden(result.pledges.length === 0);
    forgetButton.hidden = false;
    readButton.textContent = "Relire le hangar";
  };

  /** Revient au panneau de départ. */
  const showIdle = () => {
    result = null;
    setStatus([IDLE_STATUS]);
    setExportsHidden(true);
    forgetButton.hidden = true;
    readButton.textContent = READ_LABEL;
  };

  readButton.addEventListener("click", async () => {
    readButton.disabled = true;
    setExportsHidden(true);
    forgetButton.hidden = true;
    setStatus(["Lecture de la page 1…"]);
    try {
      const collected = await collectHangar({
        fetchPage: fetchHangarPage,
        pause,
        onProgress: ({ page, count }) =>
          setStatus([`Lecture de la page ${page + 1}… (${plural(count, "pledge")} jusqu'ici)`]),
      });
      showResult({ ...collected, readAt: new Date() });
      saveStored(result);
    } catch (error) {
      // Une lecture ratée ne laisse pas un ancien résultat se faire passer
      // pour le nouveau : on oublie tout.
      showIdle();
      clearStored();
      // Les HangarError sont rédigées pour l'utilisateur ; le reste est un bug.
      const message =
        error instanceof HangarError
          ? error.message
          : `Erreur inattendue : ${error?.message ?? error}`;
      setStatus([message], true);
    } finally {
      readButton.disabled = false;
    }
  });

  csvButton.addEventListener("click", () => {
    if (result) download(hangarCsv(result.pledges, separator.value), "text/csv", "csv");
  });

  jsonButton.addEventListener("click", () => {
    if (!result) return;
    const json = hangarJson(result.pledges, {
      readAt: result.readAt,
      truncated: result.truncated,
    });
    download(json, "application/json", "json");
  });

  forgetButton.addEventListener("click", () => {
    clearStored();
    showIdle();
  });

  // Résultat mémorisé par une lecture précédente dans cet onglet : on le
  // réaffiche tel quel, avec sa date, sans relire le hangar.
  const stored = loadStored();
  if (stored) showResult(stored);

  return el("div", { className: "panel" }, [
    el("span", { className: "brand", textContent: "Pledge Fair — Hangar" }),
    status,
    el("div", { className: "controls" }, [
      readButton,
      separatorLabel,
      csvButton,
      jsonButton,
      forgetButton,
    ]),
  ]);
}

/** Ajoute le panneau à la page, une seule fois, et étiquette les lignes. */
export function start() {
  if (document.getElementById(HOST_ID)) return;

  watchRows();

  const host = el("div", { id: HOST_ID });
  const shadow = host.attachShadow({ mode: "open" });
  // Feuille de style « construite » : isolée du site par le shadow DOM, et
  // non soumise à sa Content-Security-Policy comme le serait un <style>.
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(STYLE);
  shadow.adoptedStyleSheets = [sheet];
  const panel = buildPanel();
  shadow.append(panel);

  // Au-dessus de la liste du hangar ; si RSI a changé la page au point que la
  // liste est introuvable, le panneau flotte en bas à droite — la lecture
  // dira elle-même si le hangar est encore reconnaissable.
  const list = document.querySelector("ul.list-items");
  if (list) {
    list.before(host);
  } else {
    panel.classList.add("floating");
    document.body.append(host);
  }
}
