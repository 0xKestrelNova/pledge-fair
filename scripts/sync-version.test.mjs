// Tests des fonctions pures de sync-version.mjs (node --test, sans réseau ni
// accès disque : le module n'exécute son pipeline que lancé directement).

import { test } from "node:test";
import assert from "node:assert/strict";

import { versionFileContents, parseArgs } from "./sync-version.mjs";

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
