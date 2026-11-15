// Tests de la lecture des montants et du total (extension/src/value.js).
//
// Comme pour docs/core.test.mjs, le séparateur de milliers fr-FR dépend des
// données ICU (espace fine insécable) : on retire les espaces avant de
// comparer les montants formatés.

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseMoney, summarize, centsToDecimal, formatMoney } from "./value.js";

const noSpace = (s) => s.replace(/\s/g, "");

test("parseMoney — formats du hangar RSI", () => {
  assert.deepEqual(parseMoney("$45.00 USD"), { cents: 4500, currency: "USD" });
  assert.deepEqual(parseMoney("$1,234.50 USD"), { cents: 123450, currency: "USD" });
  assert.deepEqual(parseMoney("$12,345,678.90 USD"), { cents: 1234567890, currency: "USD" });
  assert.deepEqual(parseMoney("$0.00 USD"), { cents: 0, currency: "USD" });
  assert.deepEqual(parseMoney("€20.00 EUR"), { cents: 2000, currency: "EUR" });
});

test("parseMoney — montant sans décimales ou sans devise", () => {
  assert.deepEqual(parseMoney("$45 USD"), { cents: 4500, currency: "USD" });
  assert.deepEqual(parseMoney("$45.5"), { cents: 4550, currency: "" });
});

test("parseMoney — pas d'erreur d'arrondi flottant", () => {
  // 19.99 * 100 vaut 1998.9999999999998 en flottant.
  assert.equal(parseMoney("$19.99 USD").cents, 1999);
  assert.equal(parseMoney("$1,005.35 USD").cents, 100535);
});

test("parseMoney — texte sans montant : null", () => {
  assert.equal(parseMoney(""), null);
  assert.equal(parseMoney(undefined), null);
  assert.equal(parseMoney("Store Credit"), null);
});

const pledge = (valueCents, currency = "USD") => ({ valueCents, currency });

test("summarize — additionne en centimes", () => {
  const summary = summarize([pledge(4500), pledge(123450), pledge(0), pledge(750), pledge(11000)]);
  assert.deepEqual(summary, {
    count: 5,
    unreadable: 0,
    totals: [{ currency: "USD", cents: 139700 }],
  });
});

test("summarize — pas de dérive flottante sur beaucoup de petits montants", () => {
  const summary = summarize(Array.from({ length: 1000 }, () => pledge(10)));
  assert.equal(summary.totals[0].cents, 10000);
});

test("summarize — les pledges illisibles sont comptés à part, hors total", () => {
  const summary = summarize([pledge(4500), pledge(null, ""), pledge(500)]);
  assert.equal(summary.count, 3);
  assert.equal(summary.unreadable, 1);
  assert.deepEqual(summary.totals, [{ currency: "USD", cents: 5000 }]);
});

test("summarize — un total par devise, jamais de mélange", () => {
  const summary = summarize([pledge(4500, "USD"), pledge(2000, "EUR"), pledge(500, "USD")]);
  assert.deepEqual(summary.totals, [
    { currency: "USD", cents: 5000 },
    { currency: "EUR", cents: 2000 },
  ]);
});

test("summarize — hangar vide", () => {
  assert.deepEqual(summarize([]), { count: 0, unreadable: 0, totals: [] });
});

test("centsToDecimal — virgule ou point, toujours deux décimales, pas de milliers", () => {
  assert.equal(centsToDecimal(123450), "1234,50");
  assert.equal(centsToDecimal(123450, "."), "1234.50");
  assert.equal(centsToDecimal(5), "0,05");
  assert.equal(centsToDecimal(0), "0,00");
  assert.equal(centsToDecimal(-50), "-0,50");
});

test("formatMoney — affichage français avec symbole et code de devise", () => {
  assert.equal(noSpace(formatMoney(421500, "USD")), "4215,00$USD");
  assert.equal(noSpace(formatMoney(2000, "EUR")), "20,00€EUR");
  assert.equal(noSpace(formatMoney(999, "CAD")), "9,99CAD");
  assert.equal(noSpace(formatMoney(100, "")), "1,00");
});
