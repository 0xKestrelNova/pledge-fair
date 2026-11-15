// Tests de la mise en mémoire du résultat (extension/src/store.js).

import { test } from "node:test";
import assert from "node:assert/strict";

import { STORAGE_KEY, serializeResult, parseStored } from "./store.js";
import { extractPage } from "./extract.js";
import { loadFixture } from "../fixtures/dom.mjs";

const READ_AT = new Date("2026-11-15T10:30:00.000Z");

const fixtureResult = () => ({
  pledges: [
    ...extractPage(loadFixture("hangar-page-1.html")).pledges,
    ...extractPage(loadFixture("hangar-page-2.html")).pledges,
  ],
  pages: 2,
  truncated: false,
});

/** Texte stocké valide, dont on abîme ensuite un champ. */
const tampered = (change) => {
  const data = JSON.parse(serializeResult(fixtureResult(), READ_AT));
  change(data);
  return JSON.stringify(data);
};

test("serializeResult / parseStored — aller-retour sans perte", () => {
  const result = fixtureResult();
  const restored = parseStored(serializeResult(result, READ_AT));
  assert.deepEqual(restored, { ...result, readAt: READ_AT });
});

test("parseStored — conserve un montant illisible (null) et un hangar vide", () => {
  const odd = fixtureResult();
  odd.pledges[0].valueCents = null;
  assert.equal(parseStored(serializeResult(odd, READ_AT)).pledges[0].valueCents, null);

  const empty = { pledges: [], pages: 0, truncated: false };
  assert.deepEqual(parseStored(serializeResult(empty, READ_AT)).pledges, []);
});

test("parseStored — rien de stocké ou texte illisible : null", () => {
  assert.equal(parseStored(null), null);
  assert.equal(parseStored(undefined), null);
  assert.equal(parseStored(""), null);
  assert.equal(parseStored("{pas du json"), null);
  assert.equal(parseStored("null"), null);
  assert.equal(parseStored('"texte"'), null);
  assert.equal(parseStored("[]"), null);
});

test("parseStored — autre version des données : ignorée", () => {
  assert.equal(parseStored(tampered((d) => (d.version = 2))), null);
  assert.equal(parseStored(tampered((d) => delete d.version)), null);
});

test("parseStored — date de lecture absente ou invalide : ignoré", () => {
  assert.equal(parseStored(tampered((d) => delete d.readAt)), null);
  assert.equal(parseStored(tampered((d) => (d.readAt = "hier"))), null);
  assert.equal(parseStored(tampered((d) => (d.readAt = 1763202600000))), null);
});

test("parseStored — champs de tête d'un type inattendu : ignoré", () => {
  assert.equal(parseStored(tampered((d) => (d.pages = "2"))), null);
  assert.equal(parseStored(tampered((d) => (d.truncated = "non"))), null);
  assert.equal(parseStored(tampered((d) => (d.pledges = {}))), null);
});

test("parseStored — un seul pledge mal formé invalide l'ensemble", () => {
  assert.equal(parseStored(tampered((d) => (d.pledges[3] = null))), null);
  assert.equal(parseStored(tampered((d) => delete d.pledges[0].name)), null);
  assert.equal(parseStored(tampered((d) => (d.pledges[0].valueCents = "4500"))), null);
  assert.equal(parseStored(tampered((d) => (d.pledges[0].valueCents = 45.5))), null);
  assert.equal(parseStored(tampered((d) => (d.pledges[0].giftable = "oui"))), null);
  assert.equal(parseStored(tampered((d) => (d.pledges[0].items = "Aurora"))), null);
  assert.equal(
    parseStored(tampered((d) => (d.pledges[0].items[0] = { title: 1, kind: "" }))),
    null,
  );
});

test("STORAGE_KEY — porte un numéro de version", () => {
  assert.match(STORAGE_KEY, /^pledge-fair-hangar:v\d+$/);
});
