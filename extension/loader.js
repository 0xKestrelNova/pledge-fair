// Pledge Fair — Hangar : point d'entrée du script de contenu.
//
// Un script de contenu Manifest V3 ne peut pas être un module ES. Ce fichier
// classique se contente donc de charger le vrai code, écrit en modules (les
// mêmes fichiers que ceux testés par `node --test`), par un import dynamique.
// C'est pour cet import que le manifeste déclare src/*.js en
// `web_accessible_resources`, restreint au seul site RSI.

(async () => {
  try {
    const { start } = await import(chrome.runtime.getURL("src/panel.js"));
    start();
  } catch (error) {
    console.error("[Pledge Fair — Hangar] Chargement impossible :", error);
  }
})();
