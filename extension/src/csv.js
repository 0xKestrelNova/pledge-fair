// Pledge Fair — Hangar : génération du CSV, entièrement locale.
//
// Module pur (ni DOM ni réseau) : il transforme la liste des pledges en texte
// CSV. Le téléchargement lui-même est fait par panel.js.
//
// Choix de format, pensés pour Excel en français :
//   - BOM UTF-8 en tête, sans quoi Excel lit le fichier en Windows-1252 et
//     affiche « RÃ©compense » ;
//   - séparateur « ; » par défaut, avec virgule décimale (« 1234,50 ») ; le
//     séparateur « , » bascule sur le point décimal (« 1234.50 ») ;
//   - fins de ligne CRLF (RFC 4180) ;
//   - une ligne par pledge, sans ligne de total : la colonne « Valeur de
//     fonte » se somme directement.

import { centsToDecimal } from "./value.js";
import { shipsOf, insuranceOf, otherItemsOf } from "./extract.js";

/** Marque d'ordre d'octets UTF-8 : fait reconnaître l'encodage par Excel. */
export const BOM = "﻿";

export const SEPARATORS = [";", ","];

export const HEADERS = [
  "ID",
  "Pledge",
  "Date",
  "Valeur de fonte",
  "Devise",
  "Vaisseaux",
  "Assurance",
  "Autres articles",
  "Giftable",
  "Fondable",
];

/**
 * Une cellule CSV.
 *
 * - Injection de formule : un tableur exécute une cellule qui commence par
 *   « = », « + », « - » ou « @ ». Les noms viennent du site RSI, pas de
 *   l'utilisateur, mais le fichier est fait pour être ouvert dans Excel : on
 *   neutralise par une apostrophe en tête, que le tableur n'affiche pas.
 * - Échappement : une cellule contenant le séparateur, un guillemet, un
 *   retour à la ligne ou des espaces en bordure est mise entre guillemets,
 *   les guillemets internes étant doublés.
 */
export function csvCell(value, separator = ";") {
  let cell = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(cell)) cell = "'" + cell;
  const needsQuotes = cell.includes(separator) || /["\r\n]/.test(cell) || /^\s|\s$/.test(cell);
  return needsQuotes ? '"' + cell.replace(/"/g, '""') + '"' : cell;
}

/** Tableau de lignes (tableaux de cellules) → texte CSV avec BOM et CRLF. */
export function toCsv(rows, separator = ";") {
  return (
    BOM +
    rows.map((row) => row.map((cell) => csvCell(cell, separator)).join(separator) + "\r\n").join("")
  );
}

const yesNo = (flag) => (flag ? "oui" : "non");

/** Plusieurs articles dans une même cellule. */
const joinItems = (titles) => titles.join(" | ");

/** La ligne CSV d'un pledge, dans l'ordre de HEADERS. */
export function pledgeRow(pledge, separator = ";") {
  const decimalSeparator = separator === "," ? "." : ",";
  return [
    pledge.id,
    pledge.name,
    // Date ISO si elle a pu être lue, sinon le texte de RSI tel quel.
    pledge.date || pledge.dateText,
    pledge.valueCents === null ? "" : centsToDecimal(pledge.valueCents, decimalSeparator),
    pledge.currency,
    joinItems(shipsOf(pledge)),
    joinItems(insuranceOf(pledge)),
    joinItems(otherItemsOf(pledge)),
    yesNo(pledge.giftable),
    yesNo(pledge.meltable),
  ];
}

/** Le CSV complet du hangar : en-têtes puis une ligne par pledge. */
export function hangarCsv(pledges, separator = ";") {
  return toCsv([HEADERS, ...pledges.map((pledge) => pledgeRow(pledge, separator))], separator);
}

/** Nom du fichier téléchargé : hangar-rsi-2026-11-15.csv (date locale). */
export function csvFileName(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `hangar-rsi-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.csv`;
}
