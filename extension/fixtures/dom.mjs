// Adaptateur de test : expose un document cheerio sous la forme du petit
// sous-ensemble de l'API DOM dont extract.js a besoin (querySelector,
// querySelectorAll, textContent, getAttribute).
//
// Il permet de tester l'extraction avec `node --test` sur les fixtures HTML,
// sans navigateur ni jsdom : cheerio est déjà une dépendance du dépôt (le
// générateur de données s'en sert). Dans l'extension, extract.js reçoit un
// vrai Document produit par DOMParser — même interface, aucun adaptateur.

import { readFileSync } from "node:fs";
import { load } from "cheerio";

function wrap($, node) {
  return {
    querySelector(selector) {
      const found = $(node).find(selector).first();
      return found.length ? wrap($, found[0]) : null;
    },
    querySelectorAll(selector) {
      return $(node)
        .find(selector)
        .toArray()
        .map((child) => wrap($, child));
    },
    get textContent() {
      return $(node).text();
    },
    getAttribute(name) {
      return $(node).attr(name) ?? null;
    },
  };
}

/** Chaîne HTML → racine de document façon DOM. */
export function parseHtml(html) {
  const $ = load(html);
  return wrap($, $.root()[0]);
}

/** Fixture de ce dossier (par nom de fichier) → racine de document. */
export function loadFixture(name) {
  return parseHtml(readFileSync(new URL(name, import.meta.url), "utf8"));
}
