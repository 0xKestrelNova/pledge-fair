// Tests de l'export JSON (extension/src/json.js) et du nom des fichiers
// exportés (extension/src/filename.js), avec node --test.

import { test } from "node:test";
import assert from "node:assert/strict";

import { pledgeRecord, hangarExport, hangarJson } from "./json.js";
import { exportFileName } from "./filename.js";
import { extractPage } from "./extract.js";
import { loadFixture } from "../fixtures/dom.mjs";

const fixturePledges = () => [
  ...extractPage(loadFixture("hangar-page-1.html")).pledges,
  ...extractPage(loadFixture("hangar-page-2.html")).pledges,
];

const NOW = new Date("2026-11-15T10:30:00.000Z");

test("pledgeRecord — pledge simple : montant en nombre, articles en tableaux", () => {
  const [standalone] = fixturePledges();
  assert.deepEqual(pledgeRecord(standalone), {
    id: "10000001",
    name: "Standalone Ship - Testeur Mk I",
    date: "2023-11-20",
    meltValue: 45,
    currency: "USD",
    ships: ["Testeur Mk I"],
    insurance: ["Lifetime Insurance"],
    otherItems: ["Maquette de test"],
    giftable: true,
    meltable: true,
    upgraded: false,
  });
});

test("pledgeRecord — pledge upgradé à plusieurs vaisseaux", () => {
  const record = pledgeRecord(fixturePledges()[1]);
  assert.equal(record.name, 'Package - Pionnier "Édition; Test", Starter');
  assert.equal(record.meltValue, 1234.5);
  assert.deepEqual(record.ships, ["Pionnier Lourd", "Navette d'essai"]);
  assert.equal(record.giftable, false);
  assert.equal(record.upgraded, true);
});

test("pledgeRecord — pledge à 0 $ : zéro, pas null ; listes vides, pas absentes", () => {
  const record = pledgeRecord(fixturePledges()[2]);
  assert.equal(record.meltValue, 0);
  assert.deepEqual(record.ships, []);
  assert.deepEqual(record.insurance, []);
});

test("pledgeRecord — montant illisible : null ; date illisible : texte brut de RSI", () => {
  const record = pledgeRecord({
    id: "1",
    name: "Étrange",
    date: "",
    dateText: "il y a longtemps",
    valueCents: null,
    currency: "",
    items: [],
    giftable: false,
    meltable: false,
    upgraded: false,
  });
  assert.equal(record.meltValue, null);
  assert.equal(record.date, "il y a longtemps");
});

test("hangarExport — en-tête : date de lecture, nombre de pledges, total par devise", () => {
  const data = hangarExport(fixturePledges(), { readAt: NOW });
  assert.equal(data.readAt, "2026-11-15T10:30:00.000Z");
  assert.equal(data.source, "https://robertsspaceindustries.com/account/pledges");
  assert.equal(data.count, 5);
  // 45,00 + 1 234,50 + 0,00 + 7,50 + 110,00
  assert.deepEqual(data.meltValueTotals, [{ currency: "USD", amount: 1397 }]);
  assert.equal(data.unreadable, 0);
  assert.equal(data.truncated, false);
  assert.deepEqual(
    data.pledges.map((p) => p.id),
    ["10000001", "10000002", "10000003", "10000004", "10000005"],
  );
});

test("hangarExport — les montants s'écrivent sans bruit d'arrondi flottant", () => {
  const pledge = (valueCents) => ({ valueCents, currency: "USD", items: [] });
  const data = hangarExport([pledge(1999), pledge(10), pledge(20)], { readAt: NOW });
  assert.equal(JSON.stringify(data.pledges[0].meltValue), "19.99");
  // 0.1 + 0.2 donnerait 0.30000000000000004 ; la somme se fait en centimes.
  assert.equal(JSON.stringify(data.meltValueTotals[0].amount), "20.29");
});

test("hangarExport — lecture interrompue et montants illisibles sont signalés", () => {
  const data = hangarExport([{ valueCents: null, currency: "", items: [] }], {
    readAt: NOW,
    truncated: true,
  });
  assert.equal(data.truncated, true);
  assert.equal(data.unreadable, 1);
  assert.deepEqual(data.meltValueTotals, []);
});

test("hangarExport — hangar vide", () => {
  const data = hangarExport([], { readAt: NOW });
  assert.equal(data.count, 0);
  assert.deepEqual(data.meltValueTotals, []);
  assert.deepEqual(data.pledges, []);
});

test("hangarJson — JSON valide, indenté, sans BOM, terminé par une fin de ligne", () => {
  const json = hangarJson(fixturePledges(), { readAt: NOW });
  assert.ok(json.startsWith("{\n  "));
  assert.ok(json.endsWith("}\n"));
  assert.notEqual(json.charCodeAt(0), 0xfeff);
  assert.deepEqual(JSON.parse(json), hangarExport(fixturePledges(), { readAt: NOW }));
});

test("hangarJson — guillemets et accents des noms survivent à l'aller-retour", () => {
  const parsed = JSON.parse(hangarJson(fixturePledges(), { readAt: NOW }));
  assert.equal(parsed.pledges[1].name, 'Package - Pionnier "Édition; Test", Starter');
  assert.equal(parsed.pledges[2].name, "Récompense - Trophée de test");
});

test("exportFileName — date locale, mois et jour sur deux chiffres", () => {
  assert.equal(exportFileName("csv", new Date(2026, 10, 15)), "hangar-rsi-2026-11-15.csv");
  assert.equal(exportFileName("json", new Date(2027, 0, 5)), "hangar-rsi-2027-01-05.json");
});
