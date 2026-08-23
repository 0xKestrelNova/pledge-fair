// Tests des fonctions pures de sync-version.mjs (node --test, sans réseau ni
// accès disque : le module n'exécute son pipeline que lancé directement).

import { test } from "node:test";
import assert from "node:assert/strict";

import { versionFileContents, matchesExpected, parseArgs } from "./sync-version.mjs";

test("versionFileContents produit le JSON attendu", () => {
  assert.equal(versionFileContents("1.1.0"), '{\n  "version": "1.1.0"\n}\n');
});

test("versionFileContents reproduit la sortie de Prettier", () => {
  // docs/version.json n'est pas dans .prettierignore : il est vérifié comme
  // les autres fichiers. Indentation à 2 espaces et retour à la ligne final.
  const out = versionFileContents("2.0.0");
  assert.match(out, /^\{\n {2}"version"/);
  assert.ok(out.endsWith("}\n"));
});

test("versionFileContents ne réinterprète pas la version", () => {
  // Un tag de pré-version reste tel quel : c'est package.json qui fait foi.
  assert.equal(JSON.parse(versionFileContents("1.2.0-rc.1")).version, "1.2.0-rc.1");
});

test("parseArgs reconnaît --check", () => {
  assert.deepEqual(parseArgs(["--check"]), { check: true });
  assert.deepEqual(parseArgs([]), { check: false });
  assert.deepEqual(parseArgs(["--autre"]), { check: false });
});

// ---------------------------------------------------------------------------
// matchesExpected
// ---------------------------------------------------------------------------

test("matchesExpected accepte un fichier identique", () => {
  const expected = versionFileContents("1.3.0");
  assert.equal(matchesExpected(expected, expected), true);
});

test("matchesExpected tolère un fichier réécrit en CRLF", () => {
  // Git for Windows en `core.autocrlf=true` — son réglage par défaut —
  // réécrit le fichier au checkout. Sans cette tolérance, la vérification
  // échoue sur un fichier pourtant correct, et « npm run sync-version » n'y
  // change rien puisque Git reconvertit aussitôt.
  const expected = versionFileContents("1.3.0");
  const crlf = expected.split("\n").join("\r\n");
  assert.notEqual(crlf, expected); // le fichier diffère bien octet à octet…
  assert.equal(matchesExpected(crlf, expected), true); // … mais reste valide
});

test("matchesExpected refuse une version différente", () => {
  assert.equal(matchesExpected(versionFileContents("1.2.0"), versionFileContents("1.3.0")), false);
});

test("matchesExpected refuse une mise en forme qui a dérivé", () => {
  // Les fins de ligne sont tolérées ; l'indentation ne l'est pas.
  const expected = versionFileContents("1.3.0");
  assert.equal(matchesExpected('{"version":"1.3.0"}\n', expected), false);
  assert.equal(matchesExpected("", expected), false);
});

test("matchesExpected refuse un fichier absent", () => {
  // main() passe null quand la lecture échoue.
  assert.equal(matchesExpected(null, versionFileContents("1.3.0")), false);
  assert.equal(matchesExpected(undefined, versionFileContents("1.3.0")), false);
});
