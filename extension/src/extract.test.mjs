// Tests de l'extraction du hangar (extension/src/extract.js), avec node --test.
//
// Ils tournent sur des fixtures HTML anonymisées (../fixtures/) qui
// reproduisent la structure servie par RSI. Si RSI change son balisage, on
// met la fixture à jour d'après la nouvelle structure, ces tests rougissent,
// et on corrige les sélecteurs de extract.js — au même endroit.

import { test } from "node:test";
import assert from "node:assert/strict";

import { extractPage, parseRsiDate, shipsOf, insuranceOf, otherItemsOf } from "./extract.js";
import { loadFixture, parseHtml } from "../fixtures/dom.mjs";

const page1 = () => extractPage(loadFixture("hangar-page-1.html"));
const page2 = () => extractPage(loadFixture("hangar-page-2.html"));

test("extractPage — reconnaît le hangar et trouve tous les pledges de la page", () => {
  const { recognized, pledges } = page1();
  assert.equal(recognized, true);
  assert.deepEqual(
    pledges.map((p) => p.id),
    ["10000001", "10000002", "10000003"],
  );
  assert.equal(page2().pledges.length, 2);
});

test("extractPage — pledge simple : nom, date ISO, valeur de fonte, statut", () => {
  const [pledge] = page1().pledges;
  assert.equal(pledge.name, "Standalone Ship - Testeur Mk I");
  assert.equal(pledge.dateText, "November 20, 2023");
  assert.equal(pledge.date, "2023-11-20");
  assert.equal(pledge.valueText, "$45.00 USD");
  assert.equal(pledge.valueCents, 4500);
  assert.equal(pledge.currency, "USD");
  assert.equal(pledge.status, "Attributed");
  assert.equal(pledge.upgraded, false);
});

test("extractPage — articles avec vignette : titre et type", () => {
  const [pledge] = page1().pledges;
  assert.deepEqual(pledge.items, [
    { title: "Testeur Mk I", kind: "Ship" },
    { title: "Lifetime Insurance", kind: "Insurance" },
    { title: "Maquette de test", kind: "Hangar decoration" },
  ]);
});

test("extractPage — pledge upgradé : le nom ne contient pas le bouton « Upgrade log »", () => {
  const pledge = page1().pledges[1];
  assert.equal(pledge.name, 'Package - Pionnier "Édition; Test", Starter');
  assert.equal(pledge.upgraded, true);
});

test("extractPage — la valeur de fonte n'est pas la « configuration value »", () => {
  // Pledge upgradé : RSI expose deux montants. Seul .js-pledge-value est ce
  // que rend une fonte ; l'autre (1 400 $ dans la fixture) doit être ignoré.
  const pledge = page1().pledges[1];
  assert.equal(pledge.valueCents, 123450);
});

test("extractPage — articles sans vignette (« Also Contains ») : titre seul", () => {
  const pledge = page1().pledges[1];
  assert.deepEqual(pledge.items.slice(3), [
    { title: "Jeu d'essai Digital Download", kind: "" },
    { title: "Starting Money: 1,000 UEC", kind: "" },
  ]);
  // Le libellé « Also Contains » n'est pas un article.
  assert.ok(!pledge.items.some((item) => /also contains/i.test(item.title)));
});

test("extractPage — giftable et fondable se lisent sur la présence des boutons", () => {
  const [standalone, upgraded, reward] = page1().pledges;
  assert.deepEqual([standalone.giftable, standalone.meltable], [true, true]);
  assert.deepEqual([upgraded.giftable, upgraded.meltable], [false, true]);
  assert.deepEqual([reward.giftable, reward.meltable], [false, false]);
});

test("extractPage — pledge à 0 $ : la valeur est zéro, pas illisible", () => {
  const reward = page1().pledges[2];
  assert.equal(reward.valueCents, 0);
  assert.equal(reward.date, "2024-01-01");
});

test("extractPage — page sans liste du hangar : non reconnue", () => {
  const login = parseHtml(
    "<html><body><form><input type='text' name='login'></form></body></html>",
  );
  assert.deepEqual(extractPage(login), { recognized: false, pledges: [] });
});

test("extractPage — hangar vide : reconnu, aucun pledge", () => {
  const empty = parseHtml('<div class="inner-content"><ul class="list-items"></ul></div>');
  assert.deepEqual(extractPage(empty), { recognized: true, pledges: [] });
});

test("extractPage — repli sur le <h3> si le champ caché du nom disparaît", () => {
  const doc = parseHtml(`
    <ul class="list-items"><li>
      <h3> Standalone Ship -
        Repli </h3>
      <input type="hidden" class="js-pledge-id" value="42">
      <input type="hidden" class="js-pledge-value" value="$10.00 USD">
    </li></ul>`);
  const [pledge] = extractPage(doc).pledges;
  assert.equal(pledge.name, "Standalone Ship - Repli");
  assert.equal(pledge.valueCents, 1000);
});

test("extractPage — montant absent ou illisible : valueCents null", () => {
  const doc = parseHtml(`
    <ul class="list-items"><li>
      <input type="hidden" class="js-pledge-id" value="43">
      <input type="hidden" class="js-pledge-name" value="Sans valeur">
    </li></ul>`);
  const [pledge] = extractPage(doc).pledges;
  assert.equal(pledge.valueCents, null);
  assert.equal(pledge.currency, "");
});

test("parseRsiDate — mois longs, mois courts, jour à un chiffre", () => {
  assert.equal(parseRsiDate("November 20, 2023"), "2023-11-20");
  assert.equal(parseRsiDate("May 5, 2019"), "2019-05-05");
  assert.equal(parseRsiDate("Sep 01, 2020"), "2020-09-01");
  assert.equal(parseRsiDate("Dec. 31 2021"), "2021-12-31");
});

test("parseRsiDate — texte qui n'est pas une date : chaîne vide", () => {
  assert.equal(parseRsiDate(""), "");
  assert.equal(parseRsiDate(undefined), "");
  assert.equal(parseRsiDate("20/11/2023"), "");
  assert.equal(parseRsiDate("Smarch 12, 2023"), "");
});

test("shipsOf / insuranceOf / otherItemsOf — répartition des articles", () => {
  const [standalone, upgraded] = page1().pledges;
  assert.deepEqual(shipsOf(standalone), ["Testeur Mk I"]);
  assert.deepEqual(insuranceOf(standalone), ["Lifetime Insurance"]);
  assert.deepEqual(otherItemsOf(standalone), ["Maquette de test"]);

  assert.deepEqual(shipsOf(upgraded), ["Pionnier Lourd", "Navette d'essai"]);
  assert.deepEqual(insuranceOf(upgraded), ["120 Month Insurance"]);
  assert.deepEqual(otherItemsOf(upgraded), [
    "Jeu d'essai Digital Download",
    "Starting Money: 1,000 UEC",
  ]);
});

test("insuranceOf — assurance listée sans type (« Also Contains ») reconnue au titre", () => {
  const cargo = page2().pledges[1];
  assert.deepEqual(insuranceOf(cargo), ["6 Month Insurance"]);
  assert.deepEqual(otherItemsOf(cargo), []);
});

test("otherItemsOf — une peinture n'est ni un vaisseau ni une assurance", () => {
  const paint = page2().pledges[0];
  assert.deepEqual(shipsOf(paint), []);
  assert.deepEqual(otherItemsOf(paint), ["Testeur - Livrée Démonstration"]);
});
