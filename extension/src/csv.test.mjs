// Tests de la génération du CSV (extension/src/csv.js), avec node --test.

import { test } from "node:test";
import assert from "node:assert/strict";

import { BOM, HEADERS, csvCell, toCsv, pledgeRow, hangarCsv, csvFileName } from "./csv.js";
import { extractPage } from "./extract.js";
import { loadFixture } from "../fixtures/dom.mjs";

const fixturePledges = () => [
  ...extractPage(loadFixture("hangar-page-1.html")).pledges,
  ...extractPage(loadFixture("hangar-page-2.html")).pledges,
];

test("csvCell — texte simple : inchangé", () => {
  assert.equal(csvCell("Aurora MR"), "Aurora MR");
  assert.equal(csvCell(42), "42");
  assert.equal(csvCell(""), "");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
});

test("csvCell — guillemets doublés et cellule entourée", () => {
  assert.equal(csvCell('Édition "Test"'), '"Édition ""Test"""');
});

test("csvCell — le séparateur courant force les guillemets, l'autre non", () => {
  assert.equal(csvCell("a;b", ";"), '"a;b"');
  assert.equal(csvCell("a,b", ";"), "a,b");
  assert.equal(csvCell("a,b", ","), '"a,b"');
  assert.equal(csvCell("a;b", ","), "a;b");
});

test("csvCell — retours à la ligne et espaces en bordure", () => {
  assert.equal(csvCell("ligne 1\nligne 2"), '"ligne 1\nligne 2"');
  assert.equal(csvCell("ligne 1\r\nligne 2"), '"ligne 1\r\nligne 2"');
  assert.equal(csvCell(" bord "), '" bord "');
});

test("csvCell — neutralise les débuts de formule pour les tableurs", () => {
  assert.equal(csvCell("=1+1"), "'=1+1");
  assert.equal(csvCell("+33"), "'+33");
  assert.equal(csvCell("-Promo"), "'-Promo");
  assert.equal(csvCell("@cmd"), "'@cmd");
  // Neutralisée ET échappée quand elle contient aussi le séparateur.
  assert.equal(csvCell('=HYPERLINK("x";"y")'), '"\'=HYPERLINK(""x"";""y"")"');
  // Un signe au milieu du texte n'est pas une formule.
  assert.equal(csvCell("Standalone Ship - Aurora"), "Standalone Ship - Aurora");
});

test("toCsv — BOM UTF-8, CRLF, ligne finale terminée", () => {
  const csv = toCsv([
    ["a", "b"],
    ["1", "2"],
  ]);
  assert.equal(csv, "﻿a;b\r\n1;2\r\n");
  assert.ok(csv.startsWith(BOM));
});

test("toCsv — le BOM s'encode bien en EF BB BF", () => {
  const bytes = new TextEncoder().encode(toCsv([["é"]]));
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
});

test("pledgeRow — colonnes dans l'ordre des en-têtes", () => {
  const [standalone] = fixturePledges();
  const row = pledgeRow(standalone);
  assert.equal(row.length, HEADERS.length);
  assert.deepEqual(row, [
    "10000001",
    "Standalone Ship - Testeur Mk I",
    "2023-11-20",
    "45,00",
    "USD",
    "Testeur Mk I",
    "Lifetime Insurance",
    "Maquette de test",
    "oui",
    "oui",
  ]);
});

test("pledgeRow — plusieurs vaisseaux dans une même cellule", () => {
  const upgraded = fixturePledges()[1];
  assert.equal(pledgeRow(upgraded)[5], "Pionnier Lourd | Navette d'essai");
});

test("pledgeRow — séparateur virgule : point décimal", () => {
  const upgraded = fixturePledges()[1];
  assert.equal(pledgeRow(upgraded, ";")[3], "1234,50");
  assert.equal(pledgeRow(upgraded, ",")[3], "1234.50");
});

test("pledgeRow — date illisible : texte brut de RSI ; montant illisible : vide", () => {
  const row = pledgeRow({
    id: "1",
    name: "Étrange",
    date: "",
    dateText: "il y a longtemps",
    valueCents: null,
    currency: "",
    items: [],
    giftable: false,
    meltable: false,
  });
  assert.equal(row[2], "il y a longtemps");
  assert.equal(row[3], "");
  assert.deepEqual(row.slice(8), ["non", "non"]);
});

test("hangarCsv — fichier complet sur les fixtures (séparateur « ; »)", () => {
  const csv = hangarCsv(fixturePledges());
  const lines = csv.slice(BOM.length).split("\r\n");
  // 1 ligne d'en-têtes + 5 pledges + la chaîne vide après le dernier CRLF.
  assert.equal(lines.length, 7);
  assert.equal(lines.at(-1), "");
  assert.equal(
    lines[0],
    "ID;Pledge;Date;Valeur de fonte;Devise;Vaisseaux;Assurance;Autres articles;Giftable;Fondable",
  );
  assert.equal(
    lines[1],
    "10000001;Standalone Ship - Testeur Mk I;2023-11-20;45,00;USD;Testeur Mk I;Lifetime Insurance;Maquette de test;oui;oui",
  );
  // Nom contenant guillemets, point-virgule et virgule : échappé, une seule cellule.
  assert.equal(
    lines[2],
    '10000002;"Package - Pionnier ""Édition; Test"", Starter";2019-05-05;1234,50;USD;' +
      "Pionnier Lourd | Navette d'essai;120 Month Insurance;" +
      "Jeu d'essai Digital Download | Starting Money: 1,000 UEC;non;oui",
  );
  assert.equal(
    lines[3],
    "10000003;Récompense - Trophée de test;2024-01-01;0,00;USD;;;Trophée de test;non;non",
  );
});

test("hangarCsv — séparateur « , » : les virgules des cellules sont protégées", () => {
  const lines = hangarCsv(fixturePledges(), ",").slice(BOM.length).split("\r\n");
  assert.equal(
    lines[2],
    '10000002,"Package - Pionnier ""Édition; Test"", Starter",2019-05-05,1234.50,USD,' +
      "Pionnier Lourd | Navette d'essai,120 Month Insurance," +
      '"Jeu d\'essai Digital Download | Starting Money: 1,000 UEC",non,oui',
  );
});

test("hangarCsv — hangar vide : en-têtes seuls", () => {
  assert.equal(hangarCsv([]), BOM + HEADERS.join(";") + "\r\n");
});

test("csvFileName — date locale, mois et jour sur deux chiffres", () => {
  assert.equal(csvFileName(new Date(2026, 10, 15)), "hangar-rsi-2026-11-15.csv");
  assert.equal(csvFileName(new Date(2027, 0, 5)), "hangar-rsi-2027-01-05.csv");
});
