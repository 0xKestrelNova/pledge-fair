#!/usr/bin/env node
// Recopie la version de package.json dans docs/version.json.
//
// Le site est purement statique et servi tel quel par GitHub Pages : il n'y a
// aucune étape de build où injecter la valeur dans le HTML. Un petit fichier
// JSON lu au chargement est le mécanisme le plus simple qui reste en même
// origine, donc compatible avec la Content-Security-Policy stricte de
// index.html (`connect-src 'self'`).
//
// docs/data.json ne conviendrait pas : il est régénéré chaque jour par
// l'Action de données, alors qu'un bump de version arrive avec une PR de code
// — le site afficherait une version périmée jusqu'au prochain run.
//
// Usage :
//   node scripts/sync-version.mjs           régénère docs/version.json
//   node scripts/sync-version.mjs --check   échoue si le fichier a dérivé
//
// Le mode --check est rejoué par la CI : sans lui, docs/version.json
// divergerait silencieusement de package.json, exactement comme le formatage
// dérivait avant `format:check`.

import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const PKG = "package.json";
const OUT = "docs/version.json";

/**
 * Contenu attendu de docs/version.json pour une version donnée. Le retour à la
 * ligne final et l'indentation à 2 espaces reproduisent la sortie de Prettier,
 * qui vérifie ce fichier comme les autres. Pur, donc testable.
 */
export function versionFileContents(version) {
  return JSON.stringify({ version }, null, 2) + "\n";
}

export function parseArgs(argv) {
  return { check: argv.includes("--check") };
}

async function main() {
  const { check } = parseArgs(process.argv.slice(2));
  const { version } = JSON.parse(await readFile(PKG, "utf-8"));
  if (typeof version !== "string" || !version.trim()) {
    console.error(`ERREUR: ${PKG} ne déclare pas de version exploitable.`);
    process.exitCode = 1;
    return;
  }
  const expected = versionFileContents(version);

  if (check) {
    let actual = null;
    try {
      actual = await readFile(OUT, "utf-8");
    } catch {
      /* fichier absent : traité comme une divergence ci-dessous */
    }
    if (actual === expected) {
      console.log(`${OUT} est à jour (v${version}).`);
      return;
    }
    console.error(
      `ERREUR: ${OUT} ne correspond pas à ${PKG} (v${version}).\n` +
        `Lancer « npm run sync-version » et commiter le résultat.`,
    );
    process.exitCode = 1;
    return;
  }

  await writeFile(OUT, expected, "utf-8");
  console.log(`${OUT} régénéré depuis ${PKG} (v${version}).`);
}

// Importé depuis les tests, le module n'expose que ses fonctions pures : aucun
// accès disque n'est déclenché.
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((exc) => {
    console.error(exc);
    process.exit(1);
  });
}
