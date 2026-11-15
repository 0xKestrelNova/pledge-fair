// Tests de la partie pure de l'étiquetage des lignes (extension/src/rows.js).
//
// L'insertion de l'étiquette dans la page (annotateRows, watchRows) demande un
// vrai DOM : elle n'est pas couverte ici.

import { test } from "node:test";
import assert from "node:assert/strict";

import { meltTextOf, MELT_CLASS } from "./rows.js";
import { loadFixture, parseHtml } from "../fixtures/dom.mjs";

const noSpace = (s) => s.replace(/\s/g, "");

const rows = (fixture) => loadFixture(fixture).querySelectorAll("ul.list-items li");

test("meltTextOf — valeur de fonte de chaque ligne de la page", () => {
  assert.deepEqual(rows("hangar-page-1.html").map(meltTextOf).map(noSpace), [
    "45,00$USD",
    // Pledge upgradé : la valeur de fonte, pas la « configuration value ».
    "1234,50$USD",
    "0,00$USD",
  ]);
  assert.deepEqual(rows("hangar-page-2.html").map(meltTextOf).map(noSpace), [
    "7,50$USD",
    "110,00$USD",
  ]);
});

test("meltTextOf — ligne sans montant lisible : null, pas d'étiquette", () => {
  const [noField] = parseHtml(
    "<ul class='list-items'><li><h3>Sans champ</h3></li></ul>",
  ).querySelectorAll("ul.list-items li");
  assert.equal(meltTextOf(noField), null);

  const [unreadable] = parseHtml(
    "<ul class='list-items'><li><input class='js-pledge-value' value='Store Credit'></li></ul>",
  ).querySelectorAll("ul.list-items li");
  assert.equal(meltTextOf(unreadable), null);
});

test("MELT_CLASS — propre à l'extension, absente du balisage RSI", () => {
  assert.equal(MELT_CLASS, "pledge-fair-melt");
  assert.deepEqual(loadFixture("hangar-page-1.html").querySelectorAll("." + MELT_CLASS), []);
});
