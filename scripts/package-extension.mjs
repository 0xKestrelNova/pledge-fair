// Fabrique l'archive .zip de l'extension Hangar à téléverser sur le Chrome
// Web Store : dist/pledge-fair-hangar-<version>.zip.
//
// L'archive ne contient que ce que le manifeste référence — manifest.json, le
// script de contenu, les modules de src/ et les icônes. Les tests, les
// fixtures, le README et les textes de la fiche du store n'y entrent pas : un
// fichier n'est embarqué que s'il sert à faire tourner l'extension. La liste
// se déduit du manifeste, il n'y a donc rien à tenir à jour ici quand un
// module est ajouté.
//
// Aucune dépendance : le format ZIP est écrit à la main avec node:zlib. Les
// dates des entrées sont fixes, pour qu'un même contenu donne toujours le même
// fichier, octet pour octet.
//
// Comme sync-version.mjs, le script n'écrit sur le disque que lancé
// directement : l'importer (tests) n'a aucun effet.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { deflateRawSync, crc32 } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EXTENSION_DIR = path.join(ROOT, "extension");
const DIST_DIR = path.join(ROOT, "dist");

/* ---------------------------------------------------------------------------
 * Quoi embarquer
 * ------------------------------------------------------------------------- */

/**
 * Chemins (relatifs au dossier de l'extension) des fichiers que le manifeste
 * référence, manifeste compris — triés, sans doublon.
 */
export function packageFiles(manifest) {
  const files = new Set(["manifest.json"]);
  for (const script of manifest.content_scripts ?? []) {
    for (const file of [...(script.js ?? []), ...(script.css ?? [])]) files.add(file);
  }
  for (const entry of manifest.web_accessible_resources ?? []) {
    for (const file of entry.resources ?? []) files.add(file);
  }
  for (const file of Object.values(manifest.icons ?? {})) files.add(file);
  return [...files].sort();
}

/** Nom de l'archive : pledge-fair-hangar-0.3.0.zip. */
export const archiveName = (manifest) => `pledge-fair-hangar-${manifest.version}.zip`;

/* ---------------------------------------------------------------------------
 * Écriture du ZIP
 * ------------------------------------------------------------------------- */

// Date fixe des entrées, au format MS-DOS : 1er janvier 1980, 00:00.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

// Bit 11 du champ « general purpose » : les noms de fichiers sont en UTF-8.
const FLAG_UTF8 = 0x0800;
const METHOD_DEFLATE = 8;

/**
 * Construit une archive ZIP en mémoire.
 *
 * @param {{ name: string, data: Buffer }[]} entries
 *   `name` utilise « / » comme séparateur, quel que soit le système.
 * @returns {Buffer}
 */
export function buildZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const compressed = deflateRawSync(data, { level: 9 });
    const checksum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // signature d'en-tête local
    local.writeUInt16LE(20, 4); // version requise : 2.0
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(METHOD_DEFLATE, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // pas de champ supplémentaire

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // signature du répertoire central
    central.writeUInt16LE(20, 4); // version d'origine
    central.writeUInt16LE(20, 6); // version requise
    central.writeUInt16LE(FLAG_UTF8, 8);
    central.writeUInt16LE(METHOD_DEFLATE, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    // Champ supplémentaire, commentaire, disque, attributs : tous à zéro.
    central.writeUInt32LE(offset, 42); // position de l'en-tête local

    localParts.push(local, nameBytes, compressed);
    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // signature de fin de répertoire central
  end.writeUInt16LE(entries.length, 8); // entrées sur ce disque
  end.writeUInt16LE(entries.length, 10); // entrées au total
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16); // position du répertoire central

  return Buffer.concat([...localParts, centralDirectory, end]);
}

/* ---------------------------------------------------------------------------
 * Exécution
 * ------------------------------------------------------------------------- */

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const manifest = JSON.parse(readFileSync(path.join(EXTENSION_DIR, "manifest.json"), "utf8"));
  const files = packageFiles(manifest);
  const zip = buildZip(
    files.map((name) => ({ name, data: readFileSync(path.join(EXTENSION_DIR, name)) })),
  );

  mkdirSync(DIST_DIR, { recursive: true });
  const target = path.join(DIST_DIR, archiveName(manifest));
  writeFileSync(target, zip);

  console.log(`${path.relative(ROOT, target)} — ${files.length} fichiers, ${zip.length} octets`);
  for (const name of files) console.log(`  ${name}`);
}
