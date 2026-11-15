// Garde-fous sur le manifeste de l'extension, avec node --test.
//
// Le manifeste est la promesse faite à l'utilisateur : l'extension ne voit
// que le hangar RSI et ne demande aucune permission. Ces tests empêchent
// qu'un ajout ultérieur élargisse cette promesse sans qu'on le décide.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
const manifest = JSON.parse(read("manifest.json"));

const RSI = "https://robertsspaceindustries.com/";

test("manifeste — Manifest V3, aucune permission demandée", () => {
  assert.equal(manifest.manifest_version, 3);
  for (const key of ["permissions", "optional_permissions", "host_permissions", "background"]) {
    assert.equal(manifest[key], undefined, `clé inattendue : ${key}`);
  }
});

test("manifeste — le script de contenu ne s'active que sur le hangar RSI", () => {
  assert.equal(manifest.content_scripts.length, 1);
  const [script] = manifest.content_scripts;
  assert.deepEqual(script.js, ["loader.js"]);
  for (const pattern of script.matches) {
    assert.ok(pattern.startsWith(RSI), pattern);
    assert.match(pattern, /\/account\/pledges\*$/);
  }
});

test("manifeste — les modules ne sont exposés qu'au site RSI", () => {
  assert.equal(manifest.web_accessible_resources.length, 1);
  const [entry] = manifest.web_accessible_resources;
  assert.deepEqual(entry.matches, [RSI + "*"]);
});

test("manifeste — chaque module de src/ est déclaré, et rien d'autre", () => {
  // Un module oublié ici ferait échouer l'import dynamique de loader.js, et
  // donc disparaître le panneau, sans qu'aucun test de logique ne le voie.
  const modules = readdirSync(new URL("src/", import.meta.url))
    .filter((name) => name.endsWith(".js"))
    .map((name) => `src/${name}`)
    .sort();
  assert.deepEqual([...manifest.web_accessible_resources[0].resources].sort(), modules);
});

test("manifeste — les fichiers référencés existent", () => {
  for (const file of [
    ...manifest.content_scripts[0].js,
    ...manifest.web_accessible_resources[0].resources,
  ]) {
    assert.ok(read(file).length > 0, file);
  }
});
