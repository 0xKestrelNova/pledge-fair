// Tests du script d'archive de l'extension (scripts/package-extension.mjs).
//
// Le script n'écrit sur le disque que lancé directement : l'importer ici ne
// crée aucun fichier. L'archive est construite en mémoire, puis relue par un
// petit lecteur ZIP indépendant de l'écriture, pour vérifier qu'elle est
// réellement décompressable.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { inflateRawSync, crc32 } from "node:zlib";

import { packageFiles, archiveName, buildZip } from "./package-extension.mjs";

const EXTENSION = new URL("../extension/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", EXTENSION), "utf8"));

/** Lecteur ZIP minimal : parcourt le répertoire central et décompresse. */
function readZip(zip) {
  const end = zip.length - 22;
  assert.equal(zip.readUInt32LE(end), 0x06054b50, "fin de répertoire central introuvable");
  const count = zip.readUInt16LE(end + 10);
  let cursor = zip.readUInt32LE(end + 16);

  const entries = [];
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(cursor), 0x02014b50, "entrée de répertoire central invalide");
    const checksum = zip.readUInt32LE(cursor + 16);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const size = zip.readUInt32LE(cursor + 24);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const name = zip.toString("utf8", cursor + 46, cursor + 46 + nameLength);

    assert.equal(zip.readUInt32LE(localOffset), 0x04034b50, "en-tête local invalide");
    const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26);
    const data = inflateRawSync(zip.subarray(dataStart, dataStart + compressedSize));
    assert.equal(data.length, size, `taille de ${name}`);
    assert.equal(crc32(data), checksum, `somme de contrôle de ${name}`);

    entries.push({ name, data });
    cursor += 46 + nameLength;
  }
  return entries;
}

test("packageFiles — manifeste, script de contenu, modules et icônes", () => {
  const files = packageFiles(manifest);
  assert.ok(files.includes("manifest.json"));
  assert.ok(files.includes("loader.js"));
  assert.ok(files.includes("src/panel.js"));
  assert.ok(files.includes("icons/icon-128.png"));
  assert.deepEqual(files, [...new Set(files)].sort(), "liste triée et sans doublon");
});

test("packageFiles — ni tests, ni fixtures, ni documentation, ni fiche du store", () => {
  for (const file of packageFiles(manifest)) {
    assert.doesNotMatch(file, /\.test\.mjs$/, file);
    assert.doesNotMatch(file, /^(fixtures|store)\//, file);
    assert.doesNotMatch(file, /\.(md|svg|mjs)$/, file);
  }
});

test("packageFiles — tous les modules de src/ sont embarqués", () => {
  const modules = readdirSync(new URL("src/", EXTENSION))
    .filter((name) => name.endsWith(".js"))
    .map((name) => `src/${name}`);
  const files = packageFiles(manifest);
  for (const module of modules) assert.ok(files.includes(module), module);
});

test("packageFiles — chaque fichier embarqué existe", () => {
  for (const file of packageFiles(manifest)) {
    assert.ok(readFileSync(new URL(file, EXTENSION)).length > 0, file);
  }
});

test("packageFiles — manifeste minimal", () => {
  assert.deepEqual(packageFiles({}), ["manifest.json"]);
});

test("archiveName — porte la version du manifeste", () => {
  assert.equal(archiveName({ version: "1.2.3" }), "pledge-fair-hangar-1.2.3.zip");
});

test("buildZip — l'archive se relit : mêmes noms, même contenu", () => {
  const entries = [
    { name: "manifest.json", data: Buffer.from('{"name":"Pledge Fair — Hangar"}', "utf8") },
    { name: "src/répété.js", data: Buffer.from("a".repeat(5000), "utf8") },
    { name: "icons/binaire.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x00]) },
    { name: "vide.txt", data: Buffer.alloc(0) },
  ];
  const read = readZip(buildZip(entries));
  assert.deepEqual(
    read.map((entry) => entry.name),
    entries.map((entry) => entry.name),
  );
  for (const [index, entry] of entries.entries()) {
    assert.ok(read[index].data.equals(entry.data), entry.name);
  }
});

test("buildZip — compresse réellement", () => {
  const zip = buildZip([{ name: "a.txt", data: Buffer.from("a".repeat(5000)) }]);
  assert.ok(zip.length < 500, `archive de ${zip.length} octets`);
});

test("buildZip — même contenu, même archive octet pour octet", () => {
  const entries = [{ name: "a.txt", data: Buffer.from("contenu") }];
  assert.ok(buildZip(entries).equals(buildZip(entries)));
});

test("buildZip — archive vide valide", () => {
  assert.deepEqual(readZip(buildZip([])), []);
});

test("archive de l'extension — complète et relisible", () => {
  const files = packageFiles(manifest);
  const zip = buildZip(
    files.map((name) => ({ name, data: readFileSync(new URL(name, EXTENSION)) })),
  );
  const read = readZip(zip);
  assert.deepEqual(
    read.map((entry) => entry.name),
    files,
  );
  // Le manifeste embarqué est celui du dépôt, à la racine de l'archive.
  assert.deepEqual(JSON.parse(read.find((e) => e.name === "manifest.json").data), manifest);
});
