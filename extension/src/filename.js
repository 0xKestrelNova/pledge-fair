// Pledge Fair — Hangar : nom des fichiers exportés. Module pur.

/**
 * Nom du fichier téléchargé, daté du jour (date locale) :
 * exportFileName("csv") → "hangar-rsi-2026-11-15.csv".
 */
export function exportFileName(extension, now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `hangar-rsi-${day}.${extension}`;
}
