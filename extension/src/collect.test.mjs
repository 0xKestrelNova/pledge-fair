// Tests de la collecte multi-pages (extension/src/collect.js), avec node --test.
//
// `fetchPage` est injecté : ici il sert les fixtures au lieu d'interroger RSI.
// Le faux serveur reproduit le comportement observé du vrai : une page
// demandée au-delà de la fin renvoie de nouveau la dernière page.

import { test } from "node:test";
import assert from "node:assert/strict";

import { collectHangar, HangarError } from "./collect.js";
import { summarize } from "./value.js";
import { loadFixture, parseHtml } from "../fixtures/dom.mjs";

const FIXTURES = ["hangar-page-1.html", "hangar-page-2.html"];

/** Faux RSI : pages 1 et 2, puis la page 2 resservie indéfiniment. */
function fakeRsi() {
  const requested = [];
  const fetchPage = async (page) => {
    requested.push(page);
    return loadFixture(FIXTURES[Math.min(page, FIXTURES.length) - 1]);
  };
  return { fetchPage, requested };
}

test("collectHangar — lit toutes les pages et s'arrête sur une page déjà vue", async () => {
  const { fetchPage, requested } = fakeRsi();
  const result = await collectHangar({ fetchPage });

  assert.deepEqual(
    result.pledges.map((p) => p.id),
    ["10000001", "10000002", "10000003", "10000004", "10000005"],
  );
  assert.equal(result.pages, 2);
  assert.equal(result.truncated, false);
  // Deux pages utiles + une requête de confirmation, pas davantage.
  assert.deepEqual(requested, [1, 2, 3]);
});

test("collectHangar — total de fonte sur un hangar de plusieurs pages", async () => {
  const { pledges } = await collectHangar({ fetchPage: fakeRsi().fetchPage });
  // 45,00 + 1 234,50 + 0,00 + 7,50 + 110,00
  assert.deepEqual(summarize(pledges).totals, [{ currency: "USD", cents: 139700 }]);
});

test("collectHangar — signale la progression page par page", async () => {
  const progress = [];
  await collectHangar({ fetchPage: fakeRsi().fetchPage, onProgress: (p) => progress.push(p) });
  assert.deepEqual(progress, [
    { page: 1, count: 3 },
    { page: 2, count: 5 },
  ]);
});

test("collectHangar — marque une pause entre les pages, pas avant la première", async () => {
  let pauses = 0;
  const { requested, fetchPage } = fakeRsi();
  await collectHangar({
    fetchPage,
    pause: async () => {
      pauses += 1;
    },
  });
  assert.equal(pauses, requested.length - 1);
});

test("collectHangar — hangar d'une seule page", async () => {
  const requested = [];
  const result = await collectHangar({
    fetchPage: async (page) => {
      requested.push(page);
      return loadFixture("hangar-page-2.html");
    },
  });
  assert.equal(result.pledges.length, 2);
  assert.equal(result.pages, 1);
  assert.deepEqual(requested, [1, 2]);
});

test("collectHangar — hangar vide : aucun pledge, aucune erreur", async () => {
  const result = await collectHangar({
    fetchPage: async () => parseHtml('<ul class="list-items"></ul>'),
  });
  assert.deepEqual(result, { pledges: [], pages: 0, truncated: false });
});

test("collectHangar — page qui n'est pas le hangar : HangarError lisible", async () => {
  await assert.rejects(
    collectHangar({ fetchPage: async () => parseHtml("<h1>Sign in</h1>") }),
    (err) => err instanceof HangarError && /session RSI/.test(err.message),
  );
});

test("collectHangar — session perdue en cours de route : erreur, pas de total partiel", async () => {
  await assert.rejects(
    collectHangar({
      fetchPage: async (page) =>
        page === 1 ? loadFixture("hangar-page-1.html") : parseHtml("<h1>Sign in</h1>"),
    }),
    HangarError,
  );
});

test("collectHangar — une erreur réseau remonte telle quelle", async () => {
  await assert.rejects(
    collectHangar({
      fetchPage: async () => {
        throw new HangarError("RSI a répondu 503");
      },
    }),
    /503/,
  );
});

test("collectHangar — garde-fou maxPages : lecture interrompue et signalée", async () => {
  // Faux site qui invente un pledge nouveau à chaque page, sans fin.
  const endless = async (page) =>
    parseHtml(`<ul class="list-items"><li>
      <input type="hidden" class="js-pledge-id" value="${page}">
      <input type="hidden" class="js-pledge-value" value="$1.00 USD">
    </li></ul>`);
  const result = await collectHangar({ fetchPage: endless, maxPages: 4 });
  assert.equal(result.pledges.length, 4);
  assert.equal(result.truncated, true);
});

test("collectHangar — pledges sans identifiant : la page répétée est quand même reconnue", async () => {
  const noIds = async () =>
    parseHtml(`<ul class="list-items">
      <li><input type="hidden" class="js-pledge-name" value="Jumeau">
          <input type="hidden" class="js-pledge-value" value="$5.00 USD"></li>
      <li><input type="hidden" class="js-pledge-name" value="Jumeau">
          <input type="hidden" class="js-pledge-value" value="$5.00 USD"></li>
    </ul>`);
  const result = await collectHangar({ fetchPage: noIds });
  // Deux pledges identiques sur la même page restent deux pledges.
  assert.equal(result.pledges.length, 2);
  assert.equal(result.pages, 1);
});
