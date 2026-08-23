// Tests des fonctions pures de update-data.mjs (node --test, sans dépendance).
//
// On ne teste ici que la logique déterministe (normalisation de noms,
// appariement vaisseau/pack, fusion des sources) : aucun appel réseau, donc
// rapide et reproductible en CI. Le point le plus important est la
// non-régression du repli RSI (voir "buildDataset — repli RSI"), un bug qui
// avait atteint la production faute de test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  normName,
  wikiShipUrl,
  matchByBareName,
  storefrontAliases,
  buildStorefrontIndex,
  bareNameKey,
  unmatchedStorefrontNames,
  usdPriceEntry,
  bareNameCandidates,
  matchShipsToPacks,
  matchShipsToConciergePacks,
  parseArgs,
  buildDataset,
  storefrontListingFromEnvelope,
  resolveGeneratedAt,
  parseGameVersion,
  uexPayload,
  buildUexRoster,
  parseShipMatrix,
  decodeEntities,
  truncateText,
  normalizeShipSize,
  normalizePadType,
  safeImageUrl,
  parseWikiConciergePacks,
  parseRsiResponse,
  loadPackagesFile,
  rosterHealth,
} from "./update-data.mjs";

// ---------------------------------------------------------------------------
// normName
// ---------------------------------------------------------------------------

test("normName met en minuscules et normalise les séparateurs", () => {
  assert.equal(normName("Anvil Carrack"), "anvil carrack");
  assert.equal(normName("F7C-M Super Hornet"), "f7c m super hornet");
  assert.equal(normName("  Drake   Cutlass  "), "drake cutlass");
});

test("normName retire les diacritiques", () => {
  assert.equal(normName("Ávila"), "avila");
  assert.equal(normName("Constellation Phœnix").includes("ph"), true);
});

// ---------------------------------------------------------------------------
// wikiShipUrl
// ---------------------------------------------------------------------------

test("wikiShipUrl retire le constructeur et encode les espaces", () => {
  assert.equal(wikiShipUrl("Anvil Carrack"), "https://starcitizen.tools/Carrack");
  assert.equal(wikiShipUrl("Drake Cutlass Black"), "https://starcitizen.tools/Cutlass_Black");
});

test("wikiShipUrl garde un nom d'un seul mot tel quel", () => {
  assert.equal(wikiShipUrl("Nomad"), "https://starcitizen.tools/Nomad");
});

test("wikiShipUrl encode les caractères qui casseraient l'URL", () => {
  // Sans encodage, tout ce qui suit « # » devient un fragment et le lien
  // pointe sur la mauvaise page.
  assert.equal(wikiShipUrl("Anvil F7C#M"), "https://starcitizen.tools/F7C%23M");
  assert.equal(wikiShipUrl("Drake Buccaneer?"), "https://starcitizen.tools/Buccaneer%3F");
  assert.equal(wikiShipUrl("MISC Fortune & Co"), "https://starcitizen.tools/Fortune_%26_Co");
});

// ---------------------------------------------------------------------------
// matchByBareName
// ---------------------------------------------------------------------------

test("matchByBareName trouve par nom complet normalisé", () => {
  const values = { "anvil carrack": "A" };
  assert.equal(matchByBareName("Anvil Carrack", values), "A");
});

test("matchByBareName retombe sur le nom sans constructeur", () => {
  const values = { carrack: "B" };
  assert.equal(matchByBareName("Anvil Carrack", values), "B");
});

test("matchByBareName renvoie null si rien ne correspond", () => {
  assert.equal(matchByBareName("Anvil Carrack", { cutlass: "X" }), null);
});

// ---------------------------------------------------------------------------
// storefrontAliases / buildStorefrontIndex (NON-RÉGRESSION — cas Polaris)
// ---------------------------------------------------------------------------
//
// Le pledge store vend « Polaris - Showdown Edition » ; le roster UEX ne
// connaît que « RSI Polaris ». matchByBareName ne retire que des mots de
// tête, donc sans alias le SKU n'était jamais apparié et le vaisseau, pourtant
// en vente directe, se retrouvait classé « vendu en pack ». Ce bug est parti
// en production faute de test sur un nom storefront *suffixé* : tous les tests
// existants n'exerçaient que le retrait du constructeur.

test("storefrontAliases indexe aussi le nom sans suffixe d'édition", () => {
  const a = storefrontAliases("Polaris - Showdown Edition");
  assert.equal(a.has("polaris showdown edition"), true);
  assert.equal(a.has("polaris"), true);
});

test("storefrontAliases ne coupe pas dans un nom à variante (Zeus Mk II ES)", () => {
  const a = storefrontAliases("Zeus Mk II ES - Showdown Edition");
  assert.equal(a.has("zeus mk ii es"), true);
  assert.equal(a.has("zeus"), false); // ne pas confondre avec les autres Zeus
});

test("storefrontAliases laisse intact un nom sans suffixe d'édition", () => {
  assert.deepEqual([...storefrontAliases("Anvil Carrack")], ["anvil carrack"]);
});

test("un SKU à suffixe d'édition s'apparie au nom nu du roster", () => {
  const index = buildStorefrontIndex([
    {
      name: "Polaris - Showdown Edition",
      stock: { available: true },
      nativePrice: { amount: 97500 },
    },
  ]);
  const hit = matchByBareName("RSI Polaris", index);
  assert.notEqual(hit, null);
  assert.equal(hit.available, true);
  assert.equal(hit.price, 975);
});

// Garde-fou sur l'heuristique elle-même : une règle plus permissive (retirer
// aussi des mots de tête côté store) rattraperait quelques cas de plus mais
// apparierait « C8R Pisces » à « Anvil C8 Pisces », deux vaisseaux distincts.
test("l'appariement par suffixe ne crée pas de faux positif entre variantes", () => {
  const index = buildStorefrontIndex([
    { name: "C8R Pisces", stock: { available: true }, nativePrice: { amount: 6500 } },
  ]);
  assert.equal(matchByBareName("Anvil C8 Pisces", index), null);
});

test("buildStorefrontIndex fusionne les doublons au lieu de les écraser", () => {
  // Le store renvoie réellement deux entrées « Basher ». Si la dernière est
  // indisponible, elle ne doit pas effacer la disponibilité de la première.
  const index = buildStorefrontIndex([
    { name: "Basher", stock: { available: true }, nativePrice: { amount: 10000 } },
    { name: "Basher", stock: { available: false }, nativePrice: { amount: 10000 } },
  ]);
  assert.equal(index.basher.available, true);
  assert.equal(index.basher.price, 100);
});

test("buildStorefrontIndex renvoie null sur un catalogue vide", () => {
  assert.equal(buildStorefrontIndex([]), null);
  assert.equal(buildStorefrontIndex([{ nativePrice: { amount: 1 } }]), null); // sans nom
});

test("unmatchedStorefrontNames signale les SKU qu'aucun vaisseau ne réclame", () => {
  const index = buildStorefrontIndex([
    { name: "Polaris - Showdown Edition", stock: { available: true } },
    { name: "Ursa Rover", stock: { available: true } },
  ]);
  const pledge = [{ name: "RSI Polaris" }];
  // Polaris est réclamé via son alias ; Ursa Rover ne l'est pas.
  assert.deepEqual(unmatchedStorefrontNames(index, pledge), ["Ursa Rover"]);
});

test("unmatchedStorefrontNames tolère un catalogue absent", () => {
  assert.deepEqual(unmatchedStorefrontNames(null, [{ name: "RSI Polaris" }]), []);
});

// ---------------------------------------------------------------------------
// usdPriceEntry
// ---------------------------------------------------------------------------

test("usdPriceEntry ne retient que la ligne USD", () => {
  const rows = [
    { currency: "EUR", price: 100 },
    { currency: "USD", price: 110 },
    { currency: "GBP", price: 95 },
  ];
  assert.equal(usdPriceEntry(rows).price, 110);
});

test("usdPriceEntry renvoie null sans ligne USD", () => {
  assert.equal(usdPriceEntry([{ currency: "EUR", price: 100 }]), null);
  assert.equal(usdPriceEntry([]), null);
});

// ---------------------------------------------------------------------------
// bareNameCandidates
// ---------------------------------------------------------------------------

test("bareNameCandidates génère les variantes sans constructeur", () => {
  const cands = bareNameCandidates(["Anvil Carrack"]);
  assert.equal(cands.has("anvil carrack"), true);
  assert.equal(cands.has("carrack"), true);
});

test("bareNameCandidates écarte les fragments trop courts", () => {
  const cands = bareNameCandidates(["RSI X1"]); // "x1" fait 2 caractères
  assert.equal(cands.has("x1"), false);
  assert.equal(cands.has("rsi x1"), true);
});

// ---------------------------------------------------------------------------
// matchShipsToPacks
// ---------------------------------------------------------------------------

test("matchShipsToPacks associe un vaisseau cité dans l'excerpt du pack", () => {
  const packs = [{ name: "Best In Show 2953", excerpt: "Includes the Carrack and more" }];
  const result = matchShipsToPacks(packs, new Set(["carrack", "cutlass"]));
  assert.deepEqual(result.carrack, { pack: "Best In Show 2953", concierge: false });
  assert.equal("cutlass" in result, false);
});

// ---------------------------------------------------------------------------
// matchShipsToConciergePacks
// ---------------------------------------------------------------------------

test("matchShipsToConciergePacks marque les vaisseaux comme concierge", () => {
  const packs = [{ name: "Concierge Pack", ships: ["Carrack", "Idris-P"] }];
  const result = matchShipsToConciergePacks(packs);
  assert.equal(result.carrack.concierge, true);
  assert.equal(result.carrack.pack, "Concierge Pack");
});

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

test("parseArgs applique les valeurs par défaut", () => {
  assert.deepEqual(parseArgs([]), {
    out: "docs/data.json",
    packages: "scripts/packages.txt",
    force: false,
  });
});

test("parseArgs lit --out et --packages", () => {
  const a = parseArgs(["--out", "x.json", "--packages", "p.txt"]);
  assert.equal(a.out, "x.json");
  assert.equal(a.packages, "p.txt");
});

test("parseArgs lit le drapeau --force", () => {
  assert.equal(parseArgs([]).force, false);
  assert.equal(parseArgs(["--force"]).force, true);
});

// ---------------------------------------------------------------------------
// storefrontListingFromEnvelope
// ---------------------------------------------------------------------------

test("storefrontListingFromEnvelope extrait le listing d'une enveloppe valide", () => {
  const env = [
    { data: { store: { listing: { resources: [{ name: "Carrack" }], totalCount: 1 } } } },
  ];
  const listing = storefrontListingFromEnvelope(env, "Op", 1);
  assert.equal(listing.totalCount, 1);
  assert.equal(listing.resources[0].name, "Carrack");
});

test("storefrontListingFromEnvelope signale les erreurs GraphQL", () => {
  const env = [{ errors: [{ message: "PersistedQueryNotFound" }] }];
  assert.throws(
    () => storefrontListingFromEnvelope(env, "Op", 1),
    /Erreurs GraphQL.*PersistedQueryNotFound/,
  );
});

test("storefrontListingFromEnvelope signale une structure inattendue", () => {
  assert.throws(
    () => storefrontListingFromEnvelope([{ data: {} }], "Op", 2),
    /Structure inattendue/,
  );
  assert.throws(() => storefrontListingFromEnvelope([], "Op", 1), /tableau attendu/);
  assert.throws(() => storefrontListingFromEnvelope(null, "Op", 1), /tableau attendu/);
});

// ---------------------------------------------------------------------------
// storefrontAliases — suffixe d'assurance
// ---------------------------------------------------------------------------
//
// Non-régression : le Carrack s'affichait « Pack : Legatus 2953 (Concierge) »,
// donc masqué par défaut, alors qu'il était bien vendu seul. Le store le publie
// sous « Carrack - 2 Year » — la durée d'assurance des SKU de vente
// anniversaire. Même mécanique que le suffixe d'édition du cas Polaris, mais
// une famille de suffixes distincte, que la règle « edition » ne couvrait pas.

test("storefrontAliases indexe aussi le nom sans durée d'assurance", () => {
  assert.deepEqual([...storefrontAliases("Carrack - 2 Year")].sort(), [
    "carrack",
    "carrack 2 year",
  ]);
});

test("storefrontAliases couvre les autres durées d'assurance", () => {
  const bare = (n) => [...storefrontAliases(n)].filter((a) => a !== normName(n));
  assert.deepEqual(bare("Perseus - 10 Year"), ["perseus"]);
  assert.deepEqual(bare("Hermes - 6 Month"), ["hermes"]);
  assert.deepEqual(bare("Idris-K - Lifetime Insurance"), ["idris k"]);
  assert.deepEqual(bare("Javelin - LTI"), ["javelin"]);
});

test("storefrontAliases cumule les deux familles de suffixes", () => {
  // Un SKU peut porter édition ET assurance : le nom nu doit rester atteignable.
  assert.equal(storefrontAliases("Polaris - Showdown Edition - 2 Year").has("polaris"), true);
});

test("storefrontAliases laisse intact un nom sans suffixe", () => {
  assert.deepEqual([...storefrontAliases("Cutlass Black")], ["cutlass black"]);
  assert.deepEqual([...storefrontAliases("Aurora Mk I ES")], ["aurora mk i es"]);
});

test("le retrait d'assurance ne déborde pas sur un nom qui finit par un mot proche", () => {
  // « Aurora Mk I LN » ne doit pas perdre son suffixe : LN n'est pas LTI, et
  // aucun nombre ne précède. Un retrait trop gourmand fusionnerait des variantes.
  assert.deepEqual([...storefrontAliases("Aurora Mk I LN")], ["aurora mk i ln"]);
});

test("buildStorefrontIndex rend le Carrack atteignable depuis le nom UEX", () => {
  const index = buildStorefrontIndex([
    { name: "Carrack - 2 Year", stock: { available: true }, nativePrice: { amount: 60000 } },
  ]);
  const hit = matchByBareName("Anvil Carrack", index);
  assert.equal(hit.available, true);
  assert.equal(hit.price, 600);
  // L'Expedition est un autre vaisseau : elle ne doit pas hériter du SKU.
  assert.equal(matchByBareName("Anvil Carrack Expedition", index), null);
});

test("buildStorefrontIndex fusionne le SKU standard et sa variante anniversaire", () => {
  // Le store publie parfois « Mole » ET « Mole - 2 Year ». Les deux retombent
  // sur la clé « mole » : une entrée indisponible ne doit pas effacer l'autre.
  const index = buildStorefrontIndex([
    { name: "Mole", stock: { available: false }, nativePrice: { amount: 31500 } },
    { name: "Mole - 2 Year", stock: { available: true }, nativePrice: { amount: 34500 } },
  ]);
  assert.equal(index.mole.available, true);
  assert.equal(index.mole.price, 315);
});

// ---------------------------------------------------------------------------
// bareNameKey
// ---------------------------------------------------------------------------

test("bareNameKey renvoie la clé qui a servi à l'appariement", () => {
  const values = { carrack: 1, "anvil hornet": 2 };
  assert.equal(bareNameKey("Anvil Carrack", values), "carrack");
  assert.equal(bareNameKey("Anvil Hornet", values), "anvil hornet");
  assert.equal(bareNameKey("Drake Cutlass", values), null);
});

test("matchByBareName reste cohérent avec bareNameKey", () => {
  const values = { carrack: { available: true } };
  assert.equal(
    matchByBareName("Anvil Carrack", values),
    values[bareNameKey("Anvil Carrack", values)],
  );
  assert.equal(matchByBareName("Drake Cutlass", values), null);
});

// ---------------------------------------------------------------------------
// resolveGeneratedAt
// ---------------------------------------------------------------------------

const FLAGS = {
  storefrontOk: true,
  rsiOk: true,
  shipMatrixOk: true,
  conciergeWikiOk: true,
  gameVersionOk: true,
  gameVersion: "4.9",
};
const SHIPS = [{ name: "Carrack", pledge: 600 }];

test("resolveGeneratedAt : pas de fichier précédent → nouvel horodatage", () => {
  assert.equal(resolveGeneratedAt(null, SHIPS, FLAGS, "NOW"), "NOW");
});

test("resolveGeneratedAt : données et sources inchangées → réutilise l'ancien", () => {
  const prev = { meta: { generatedAt: "OLD", ...FLAGS }, ships: SHIPS };
  assert.equal(resolveGeneratedAt(prev, SHIPS, FLAGS, "NOW"), "OLD");
});

test("resolveGeneratedAt : vaisseaux modifiés → nouvel horodatage", () => {
  const prev = { meta: { generatedAt: "OLD", ...FLAGS }, ships: SHIPS };
  const changed = [{ name: "Carrack", pledge: 650 }];
  assert.equal(resolveGeneratedAt(prev, changed, FLAGS, "NOW"), "NOW");
});

test("resolveGeneratedAt : une source qui tombe → nouvel horodatage", () => {
  const prev = { meta: { generatedAt: "OLD", ...FLAGS }, ships: SHIPS };
  const degraded = { ...FLAGS, storefrontOk: false };
  assert.equal(resolveGeneratedAt(prev, SHIPS, degraded, "NOW"), "NOW");
});

test("resolveGeneratedAt : un nouveau patch SC → nouvel horodatage", () => {
  // La comparaison porte sur tout meta, pas sur une liste de drapeaux figée :
  // un champ non booléen comme gameVersion doit compter lui aussi.
  const prev = { meta: { generatedAt: "OLD", ...FLAGS }, ships: SHIPS };
  assert.equal(resolveGeneratedAt(prev, SHIPS, { ...FLAGS, gameVersion: "4.10" }, "NOW"), "NOW");
});

test("resolveGeneratedAt : un champ meta apparu depuis → nouvel horodatage", () => {
  // Fichier écrit avant l'ajout de gameVersion : il faut le régénérer.
  const legacy = { ...FLAGS };
  delete legacy.gameVersion;
  delete legacy.gameVersionOk;
  const prev = { meta: { generatedAt: "OLD", ...legacy }, ships: SHIPS };
  assert.equal(resolveGeneratedAt(prev, SHIPS, FLAGS, "NOW"), "NOW");
});

test("resolveGeneratedAt : ordre des clés meta indifférent", () => {
  const prev = { meta: { ...FLAGS, generatedAt: "OLD" }, ships: SHIPS };
  const reordered = Object.fromEntries(Object.entries(FLAGS).reverse());
  assert.equal(resolveGeneratedAt(prev, SHIPS, reordered, "NOW"), "OLD");
});

// ---------------------------------------------------------------------------
// uexPayload — enveloppe des réponses UEX
// ---------------------------------------------------------------------------

test("uexPayload accepte une charge utile tableau", () => {
  assert.deepEqual(uexPayload({ status: "ok", data: [1, 2] }, "vehicles"), [1, 2]);
});

test("uexPayload accepte une charge utile objet quand on l'attend", () => {
  const payload = { live: "4.9", ptu: "4.10.0" };
  assert.deepEqual(uexPayload({ status: "ok", data: payload }, "game_versions", "object"), payload);
});

test("uexPayload garde le contrôle du champ status quelle que soit la forme", () => {
  assert.throws(() => uexPayload({ status: "error", data: [] }, "vehicles"), /inattendue/);
  assert.throws(
    () => uexPayload({ status: "error", data: { live: "4.9" } }, "game_versions", "object"),
    /inattendue/,
  );
});

test("uexPayload refuse une forme de charge utile non conforme", () => {
  // Un objet là où un tableau est attendu (et réciproquement) : c'est
  // exactement ce qui rejetait /game_versions avant le paramètre `shape`.
  assert.throws(
    () => uexPayload({ status: "ok", data: { live: "4.9" } }, "vehicles"),
    /inattendue/,
  );
  assert.throws(
    () => uexPayload({ status: "ok", data: [] }, "game_versions", "object"),
    /inattendue/,
  );
  assert.throws(() => uexPayload(null, "vehicles"), /inattendue/);
  assert.throws(
    () => uexPayload({ status: "ok", data: null }, "game_versions", "object"),
    /inattendue/,
  );
});

// ---------------------------------------------------------------------------
// parseGameVersion — patch SC courant
// ---------------------------------------------------------------------------

test("parseGameVersion retient la version LIVE, pas la PTU", () => {
  assert.equal(parseGameVersion({ live: "4.9", ptu: "4.10.0" }), "4.9");
});

test("parseGameVersion nettoie les espaces autour de la valeur", () => {
  assert.equal(parseGameVersion({ live: "  4.9 " }), "4.9");
});

test("parseGameVersion renvoie null sur une réponse inexploitable", () => {
  // Jamais de chaîne bancale : le pied de page masque la mention plutôt que
  // d'afficher « données SC undefined ».
  assert.equal(parseGameVersion({ ptu: "4.10.0" }), null);
  assert.equal(parseGameVersion({ live: "" }), null);
  assert.equal(parseGameVersion({ live: "   " }), null);
  assert.equal(parseGameVersion({ live: 4.9 }), null);
  assert.equal(parseGameVersion(null), null);
  assert.equal(parseGameVersion(undefined), null);
});

// ---------------------------------------------------------------------------
// rosterHealth — filet de sécurité UEX
// ---------------------------------------------------------------------------

const shipsOfLength = (n) => Array.from({ length: n }, (_, i) => ({ name: `S${i}` }));

test("rosterHealth : roster plein et stable → ok", () => {
  const prev = { ships: shipsOfLength(280) };
  assert.equal(rosterHealth(shipsOfLength(279), prev).ok, true);
});

test("rosterHealth : sous le plancher absolu → échec", () => {
  const h = rosterHealth(shipsOfLength(10), null);
  assert.equal(h.ok, false);
  assert.match(h.reason, /plancher/);
});

test("rosterHealth : effondrement par rapport au run précédent → échec", () => {
  const prev = { ships: shipsOfLength(279) };
  const h = rosterHealth(shipsOfLength(100), prev); // < 50 % de 279
  assert.equal(h.ok, false);
  assert.match(h.reason, /chute brutale/);
});

test("rosterHealth : baisse modérée (au-dessus du seuil) → ok", () => {
  const prev = { ships: shipsOfLength(279) };
  assert.equal(rosterHealth(shipsOfLength(200), prev).ok, true); // ~72 %, toléré
});

test("rosterHealth : premier run sans précédent, roster plein → ok", () => {
  assert.equal(rosterHealth(shipsOfLength(279), null).ok, true);
});

test("rosterHealth : un précédent lui-même minuscule ne sert pas de référence de chute", () => {
  // prevCount (20) < plancher : on ne déclenche pas la règle de chute sur une
  // base douteuse ; seul le plancher absolu s'applique au roster courant.
  const prev = { ships: shipsOfLength(20) };
  assert.equal(rosterHealth(shipsOfLength(279), prev).ok, true);
});

test("rosterHealth : seuils configurables", () => {
  assert.equal(rosterHealth(shipsOfLength(30), null, { minShips: 25 }).ok, true);
  assert.equal(rosterHealth(shipsOfLength(30), null, { minShips: 40 }).ok, false);
});

// ---------------------------------------------------------------------------
// buildDataset — repli RSI (NON-RÉGRESSION)
// ---------------------------------------------------------------------------
//
// Scénario : le catalogue Standalone Ships est indisponible
// (storefrontStandalone === null), UEX pense le vaisseau achetable
// (available: true) mais l'outil d'upgrade RSI ne le liste pas en standalone
// (really === false). Le vaisseau doit alors basculer en "pack uniquement"
// et ne plus être marqué achetable. Ce chemin était mort avant correction.

function carrackPledge(available) {
  return [{ key: "1", name: "Anvil Carrack", pledge: 600, available, concept: false }];
}

test("buildDataset : RSI rétrograde un vaisseau achetable en pack quand le storefront est down", () => {
  const ships = buildDataset(
    {},
    carrackPledge(true),
    null, // storefrontStandalone indisponible
    null,
    null, // storefrontPacks, wikiConciergePacks
    { carrack: false }, // RSI : pas achetable seul
    null,
    {}, // shipMatrix, manualPackages
  );
  assert.equal(ships.length, 1);
  assert.equal(ships[0].available, false);
  assert.equal(ships[0].packageOnly, true);
});

test("buildDataset : RSI confirme la disponibilité → reste achetable", () => {
  const ships = buildDataset(
    {},
    carrackPledge(true),
    null,
    null,
    null,
    { carrack: true }, // RSI : achetable seul
    null,
    {},
  );
  assert.equal(ships[0].available, true);
  assert.equal(ships[0].packageOnly, false);
});

test("buildDataset : storefront disponible → le repli RSI est ignoré", () => {
  const ships = buildDataset(
    {},
    carrackPledge(true),
    { carrack: { available: true, price: 600 } }, // storefront dit achetable
    null,
    null,
    { carrack: false }, // RSI dirait le contraire, mais storefront a le dernier mot
    null,
    {},
  );
  assert.equal(ships[0].available, true);
  assert.equal(ships[0].packageOnly, false);
});

test("buildDataset : une correction manuelle classe en pack un vaisseau non vendu seul", () => {
  const ships = buildDataset(
    {},
    carrackPledge(false),
    { cutlass: { name: "Cutlass", available: true, price: 100 } }, // Carrack absent du store
    null,
    null,
    null,
    null,
    { "anvil carrack": { pack: "Pack Manuel", concierge: true, storeAlias: null } },
  );
  assert.equal(ships[0].available, false);
  assert.equal(ships[0].packageOnly, true);
  assert.equal(ships[0].packName, "Pack Manuel");
  assert.equal(ships[0].packConcierge, true);
});

// NON-RÉGRESSION : « la vente directe est prioritaire sur le pack ». Avant,
// la branche manuelle forçait available = false *avant* de regarder le
// storefront — une entrée packages.txt obsolète (ajoutée pour contourner un
// appariement raté, puis oubliée quand RSI remet le vaisseau en vente)
// masquait durablement une vraie vente directe.
test("buildDataset : une correction manuelle ne peut plus masquer une vente directe", () => {
  const ships = buildDataset(
    {},
    carrackPledge(true),
    { carrack: { name: "Carrack", available: true, price: 600 } }, // storefront : en vente
    null,
    null,
    null,
    null,
    { "anvil carrack": { pack: "Pack Manuel", concierge: true, storeAlias: null } },
  );
  assert.equal(ships[0].available, true);
  assert.equal(ships[0].packageOnly, false);
  assert.equal(ships[0].packName, null);
});

// Le store vend « Ursa Rover », le roster dit « RSI Ursa » : aucune règle de
// suffixe sûre ne relie les deux, d'où la déclaration d'alias.
const ursaPledge = [{ key: "1", name: "RSI Ursa", pledge: 50, available: false, concept: false }];
const ursaAlias = { "rsi ursa": { pack: null, concierge: false, storeAlias: "Ursa Rover" } };

test("buildDataset : un alias @store relie le roster au nom du pledge store", () => {
  const ships = buildDataset(
    {},
    ursaPledge,
    { "ursa rover": { name: "Ursa Rover", available: true, price: 50 } },
    null,
    [{ name: "Praetorian Pack", ships: ["Ursa"] }], // le wiki le croit en pack Concierge
    null,
    null,
    ursaAlias,
  );
  assert.equal(ships[0].available, true);
  assert.equal(ships[0].packageOnly, false);
  assert.equal(ships[0].packConcierge, false);
});

// Un alias déclare un nom, il ne fige pas une disponibilité : c'est ce qui
// distingue « @store » d'un drapeau « forcer en vente », qui resterait bloqué
// sur « en vente » une fois le vaisseau retiré du store.
test("buildDataset : un alias @store ne force pas la disponibilité", () => {
  const ships = buildDataset(
    {},
    ursaPledge,
    { "ursa rover": { name: "Ursa Rover", available: false, price: 50 } }, // retiré du store
    null,
    [{ name: "Praetorian Pack", ships: ["Ursa"] }],
    null,
    null,
    ursaAlias,
  );
  assert.equal(ships[0].available, false);
  assert.equal(ships[0].packageOnly, true); // retombe sur le pack Concierge du wiki
  assert.equal(ships[0].packConcierge, true);
});

// ---------------------------------------------------------------------------
// buildDataset — autres branches
// ---------------------------------------------------------------------------

test("buildDataset : un vaisseau vendu en jeu mais absent du pledge est ajouté (orphelin)", () => {
  const inGame = {
    9: {
      name: "Orphan Ship",
      locations: [
        { loc: "L1", auec: 500 },
        { loc: "L2", auec: 300 },
      ],
    },
  };
  const ships = buildDataset(inGame, [], null, null, null, null, null, {});
  assert.equal(ships.length, 1);
  const s = ships[0];
  assert.equal(s.name, "Orphan Ship");
  assert.equal(s.pledge, null);
  assert.equal(s.available, false);
  assert.equal(s.packageOnly, false);
  assert.equal(s.auec, 300); // la localisation la moins chère
  assert.equal(s.loc, "L2");
  assert.equal(s.ratio, null); // pas de prix pledge → pas de ratio
});

test("buildDataset : prix pledge manquant complété par le storefront + ratio calculé", () => {
  const pledge = [
    { key: "1", name: "Anvil Carrack", pledge: null, available: false, concept: false },
  ];
  const inGame = { 1: { name: "Anvil Carrack", locations: [{ loc: "Area18", auec: 1200000 }] } };
  const ships = buildDataset(
    inGame,
    pledge,
    { carrack: { available: true, price: 600 } }, // storefront : achetable, prix 600
    null,
    null,
    null,
    null,
    {},
  );
  assert.equal(ships[0].pledge, 600); // complété depuis le storefront
  assert.equal(ships[0].available, true);
  assert.equal(ships[0].auec, 1200000);
  assert.equal(ships[0].ratio, 2000); // 1200000 / 600
});

test("buildDataset : le Ship Matrix a le dernier mot sur le statut Concept", () => {
  const pledge = [
    { key: "1", name: "Anvil Carrack", pledge: 600, available: true, concept: false },
  ];
  // UEX dit « pas concept », le Ship Matrix dit « concept » → concept.
  const overridden = buildDataset(
    {},
    pledge,
    { carrack: { available: true, price: 600 } },
    null,
    null,
    null,
    { carrack: { concept: true } },
    {},
  );
  assert.equal(overridden[0].concept, true);
});

test("buildDataset : sans entrée Ship Matrix correspondante, on garde le statut UEX", () => {
  const pledge = [{ key: "1", name: "Aopoa Nox", pledge: 40, available: true, concept: true }];
  const ships = buildDataset(
    {},
    pledge,
    { nox: { available: true, price: 40 } },
    null,
    null,
    null,
    { carrack: { concept: false } },
    {},
  ); // pas d'entrée « nox »
  assert.equal(ships[0].concept, true); // repli sur le concept UEX
});

test("buildDataset : entrée Ship Matrix sans production_status → repli sur UEX", () => {
  // Ces entrées sont désormais conservées pour leur taille / description ;
  // elles ne doivent pas pour autant écraser le statut Concept d'UEX.
  const pledge = [{ key: "1", name: "Anvil Carrack", pledge: 600, available: true, concept: true }];
  const ships = buildDataset(
    {},
    pledge,
    null,
    null,
    null,
    null,
    {
      carrack: { concept: null, size: "Large", description: "Un explorateur.", manufacturer: null },
    },
    {},
  );
  assert.equal(ships[0].concept, true);
  assert.equal(ships[0].size, "Large");
});

// ---------------------------------------------------------------------------
// buildDataset — champs de fiche
// ---------------------------------------------------------------------------

test("buildDataset remplit les champs de fiche depuis UEX et le Ship Matrix", () => {
  const pledge = [
    {
      key: "1",
      name: "Anvil Carrack",
      pledge: 600,
      available: true,
      concept: false,
      imageUrl: "https://assets.uexcorp.space/img/carrack.jpg",
      scu: 456,
      manufacturer: "Anvil Aerospace",
      padType: "L",
    },
  ];
  const matrix = {
    carrack: {
      concept: false,
      size: "Large",
      description: "Un vaisseau d'exploration.",
      manufacturer: "Anvil Aerospace (matrix)",
    },
  };
  const [ship] = buildDataset({}, pledge, null, null, null, null, matrix, {});
  assert.equal(ship.imageUrl, "https://assets.uexcorp.space/img/carrack.jpg");
  assert.equal(ship.scu, 456);
  assert.equal(ship.size, "Large");
  assert.equal(ship.description, "Un vaisseau d'exploration.");
  assert.equal(ship.padType, "L");
  // UEX est prioritaire sur le Ship Matrix pour le constructeur (quasi complet).
  assert.equal(ship.manufacturer, "Anvil Aerospace");
});

test("buildDataset : constructeur du Ship Matrix en repli quand UEX ne l'a pas", () => {
  const pledge = [
    { key: "1", name: "Anvil Carrack", pledge: 600, available: true, concept: false },
  ];
  const matrix = { carrack: { concept: false, manufacturer: "Anvil Aerospace" } };
  const [ship] = buildDataset({}, pledge, null, null, null, null, matrix, {});
  assert.equal(ship.manufacturer, "Anvil Aerospace");
});

test("buildDataset : champs de fiche absents → null, jamais undefined", () => {
  // La page distingue « aucune soute » (scu 0) de « information absente »
  // (null) : les clés doivent exister et valoir null, pas disparaître.
  const pledge = [
    { key: "1", name: "Anvil Carrack", pledge: 600, available: true, concept: false },
  ];
  const [ship] = buildDataset({}, pledge, null, null, null, null, null, {});
  for (const f of ["imageUrl", "manufacturer", "size", "description", "padType", "scu"]) {
    assert.ok(f in ship, `champ ${f} attendu`);
    assert.equal(ship[f], null, `champ ${f} attendu à null`);
  }
});

test("buildDataset : scu à 0 est conservé tel quel, pas transformé en null", () => {
  // 141 vaisseaux sur 280 n'ont pas de soute : « aucune soute » est une
  // information, à distinguer d'une donnée manquante.
  const pledge = [
    { key: "1", name: "Anvil Carrack", pledge: 600, available: true, concept: false, scu: 0 },
  ];
  const [ship] = buildDataset({}, pledge, null, null, null, null, null, {});
  assert.equal(ship.scu, 0);
});

test("buildDataset : vaisseau connu du seul catalogue en jeu → fiche du Ship Matrix", () => {
  const inGame = { 9: { name: "Drake Cutlass", locations: [{ loc: "Area18", auec: 100 }] } };
  const matrix = { cutlass: { concept: false, size: "Medium", description: "Polyvalent." } };
  const [ship] = buildDataset(inGame, [], null, null, null, null, matrix, {});
  assert.equal(ship.size, "Medium");
  assert.equal(ship.description, "Polyvalent.");
  assert.equal(ship.imageUrl, null); // aucune ligne UEX /vehicles à joindre
});

test("buildDataset : un vaisseau indisponible cité dans un pack storefront devient packageOnly", () => {
  const ships = buildDataset(
    {},
    carrackPledge(false), // UEX : pas achetable
    null, // storefront standalone indisponible → available reste false
    [{ name: "Best In Show 2953", excerpt: "Includes the Carrack and more" }],
    null,
    null,
    null,
    {},
  );
  assert.equal(ships[0].available, false);
  assert.equal(ships[0].packageOnly, true);
  assert.equal(ships[0].packName, "Best In Show 2953");
  assert.equal(ships[0].packConcierge, false);
});

test("buildDataset : un pack Concierge du wiki marque le vaisseau comme tel", () => {
  const ships = buildDataset(
    {},
    carrackPledge(false),
    null,
    null,
    [{ name: "Big Benefactor", ships: ["Carrack"] }], // pack concierge du wiki
    null,
    null,
    {},
  );
  assert.equal(ships[0].packageOnly, true);
  assert.equal(ships[0].packName, "Big Benefactor");
  assert.equal(ships[0].packConcierge, true);
});

// ---------------------------------------------------------------------------
// matchShipsToPacks — robustesse de l'appariement
// ---------------------------------------------------------------------------

test("matchShipsToPacks exige une frontière de mot (pas de sous-chaîne)", () => {
  const packs = [{ name: "P", excerpt: "the hypercarrackian device" }];
  const result = matchShipsToPacks(packs, new Set(["carrack"]));
  assert.equal("carrack" in result, false); // « carrack » au milieu d'un mot ne compte pas
});

test("matchShipsToPacks associe un nom multi-mots entouré d'espaces", () => {
  const packs = [{ name: "P", excerpt: "the Anvil Carrack is here" }];
  const result = matchShipsToPacks(packs, new Set(["anvil carrack"]));
  assert.deepEqual(result["anvil carrack"], { pack: "P", concierge: false });
});

test("matchShipsToPacks : le premier pack cité l'emporte sur les suivants", () => {
  const packs = [
    { name: "Premier", excerpt: "includes the Carrack" },
    { name: "Second", excerpt: "also includes the Carrack" },
  ];
  const result = matchShipsToPacks(packs, new Set(["carrack"]));
  assert.equal(result.carrack.pack, "Premier");
});

// Les tables d'appariement ont un prototype null : sans ça, un nom normalisé
// tel que « constructor » ou « tostring » répondait vrai au test
// d'appartenance et le vaisseau était silencieusement ignoré.
test("matchShipsToPacks n'est pas trompé par les clés du prototype", () => {
  const packs = [{ name: "P", excerpt: "includes the constructor and the tostring" }];
  const result = matchShipsToPacks(packs, new Set(["constructor", "tostring"]));
  assert.equal(result.constructor.pack, "P");
  assert.equal(result.tostring.pack, "P");
});

test("matchShipsToConciergePacks n'est pas trompé par les clés du prototype", () => {
  const result = matchShipsToConciergePacks([{ name: "VIP", ships: ["Constructor"] }]);
  assert.deepEqual(result.constructor, { pack: "VIP", concierge: true });
});

// ---------------------------------------------------------------------------
// buildUexRoster — fusion des tableaux bruts UEX
// ---------------------------------------------------------------------------

test("buildUexRoster ne retient que le prix USD et privilégie le prix standard", () => {
  const vehicles = [{ id: 1, name_full: "Anvil Carrack", is_concept: 0 }];
  const prices = [
    { id_vehicle: 1, currency: "EUR", price: 550, price_warbond: 0, on_sale: 1 },
    {
      id_vehicle: 1,
      currency: "USD",
      price: 600,
      price_warbond: 540,
      on_sale: 1,
      on_sale_warbond: 0,
    },
  ];
  const { pledge } = buildUexRoster(vehicles, prices, []);
  assert.equal(pledge[0].pledge, 600); // prix standard USD, pas l'EUR ni le warbond
  assert.equal(pledge[0].available, true); // on_sale
  assert.equal(pledge[0].concept, false);
});

test("buildUexRoster retombe sur le prix warbond quand le standard est absent", () => {
  const vehicles = [{ id: 2, name_full: "RSI Zeus", is_concept: 1 }];
  const prices = [
    {
      id_vehicle: 2,
      currency: "USD",
      price: 0,
      price_warbond: 250,
      on_sale: 0,
      on_sale_warbond: 1,
    },
  ];
  const { pledge } = buildUexRoster(vehicles, prices, []);
  assert.equal(pledge[0].pledge, 250); // repli warbond
  assert.equal(pledge[0].available, true); // on_sale_warbond
  assert.equal(pledge[0].concept, true); // is_concept === 1
});

test("buildUexRoster ignore les achats sans prix ou vers un véhicule inconnu", () => {
  const vehicles = [{ id: 1, name_full: "Anvil Carrack", is_concept: 0 }];
  const purchases = [
    { id_vehicle: 1, terminal_name: "Area18", price_buy: 0 }, // prix nul → ignoré
    { id_vehicle: 1, terminal_name: "NB Int", price_buy: 1000000 },
    { id_vehicle: 99, terminal_name: "Ghost", price_buy: 42 }, // véhicule inconnu → ignoré
  ];
  const { inGame } = buildUexRoster(vehicles, [], purchases);
  assert.deepEqual(Object.keys(inGame), ["1"]);
  assert.deepEqual(inGame["1"].locations, [{ loc: "NB Int", auec: 1000000 }]);
});

test("buildUexRoster retient photo, SCU, constructeur et type de pad", () => {
  const vehicles = [
    {
      id: 1,
      name_full: "Anvil Carrack",
      is_concept: 0,
      url_photo: "https://assets.uexcorp.space/img/carrack.jpg",
      scu: 456,
      company_name: "Anvil Aerospace",
      pad_type: "L",
    },
  ];
  const [ship] = buildUexRoster(vehicles, [], []).pledge;
  assert.equal(ship.imageUrl, "https://assets.uexcorp.space/img/carrack.jpg");
  assert.equal(ship.scu, 456);
  assert.equal(ship.manufacturer, "Anvil Aerospace");
  assert.equal(ship.padType, "L");
});

test("buildUexRoster écarte une URL de photo non conforme", () => {
  const vehicles = [
    {
      id: 1,
      name_full: "Anvil Carrack",
      is_concept: 0,
      url_photo: "https://ailleurs.example/carrack.jpg",
      scu: 0,
      company_name: "Grey&apos;s Market",
      pad_type: "",
    },
  ];
  const [ship] = buildUexRoster(vehicles, [], []).pledge;
  assert.equal(ship.imageUrl, null);
  assert.equal(ship.padType, null);
  assert.equal(ship.scu, 0); // « aucune soute », pas « information absente »
  assert.equal(ship.manufacturer, "Grey's Market"); // entité décodée
});

// ---------------------------------------------------------------------------
// parseShipMatrix
// ---------------------------------------------------------------------------

test("parseShipMatrix marque comme concept les vaisseaux « in-concept »", () => {
  const ships = [
    { name: "Carrack", production_status: "flight-ready" },
    { name: "Zeus", production_status: "In-Concept" }, // casse indifférente
    { name: "SansRien" }, // ni statut ni champ de fiche : ignoré
  ];
  const result = parseShipMatrix(ships);
  assert.equal(result.carrack.concept, false);
  assert.equal(result.zeus.concept, true);
  assert.equal("sansrien" in result, false);
});

test("parseShipMatrix retient taille, description et constructeur", () => {
  const ships = [
    {
      name: "Carrack",
      production_status: "flight-ready",
      size: "large", // casse incohérente côté source
      description: "  Un vaisseau   d'exploration.  ",
      manufacturer: { name: "Anvil Aerospace" },
    },
  ];
  const { carrack } = parseShipMatrix(ships);
  assert.equal(carrack.size, "Large");
  assert.equal(carrack.description, "Un vaisseau d'exploration."); // espaces normalisés
  assert.equal(carrack.manufacturer, "Anvil Aerospace");
});

test("parseShipMatrix garde une entrée sans statut mais avec des champs de fiche", () => {
  // Elle sert à la fiche ; son `concept` à null fait retomber l'appelant sur
  // ce que dit UEX, au lieu de conclure « pas concept ».
  const { zeus } = parseShipMatrix([{ name: "Zeus", size: "Medium" }]);
  assert.equal(zeus.concept, null);
  assert.equal(zeus.size, "Medium");
});

test("parseShipMatrix : champs de fiche absents ou inconnus → null", () => {
  const { carrack } = parseShipMatrix([
    { name: "Carrack", production_status: "flight-ready", size: "gigantesque" },
  ]);
  assert.equal(carrack.size, null); // valeur hors vocabulaire RSI
  assert.equal(carrack.description, null);
  assert.equal(carrack.manufacturer, null);
});

test("parseShipMatrix décode les entités des textes du wiki RSI", () => {
  const { market } = parseShipMatrix([
    {
      name: "Market",
      production_status: "flight-ready",
      manufacturer: { name: "Grey&apos;s Market" },
      description: "Vendu par Musashi &amp; Co.",
    },
  ]);
  // Sans décodage, esc() ré-échapperait et la page afficherait « &apos; ».
  assert.equal(market.manufacturer, "Grey's Market");
  assert.equal(market.description, "Vendu par Musashi & Co.");
});

// ---------------------------------------------------------------------------
// decodeEntities
// ---------------------------------------------------------------------------

test("decodeEntities décode les entités nommées rencontrées dans les sources", () => {
  assert.equal(decodeEntities("Grey&apos;s Market &amp; Co"), "Grey's Market & Co");
  assert.equal(decodeEntities("&lt;tag&gt; &quot;cité&quot;"), '<tag> "cité"');
});

test("decodeEntities décode les formes numériques", () => {
  assert.equal(decodeEntities("Grey&#39;s"), "Grey's");
  assert.equal(decodeEntities("Grey&#x27;s"), "Grey's");
});

test("decodeEntities laisse intacte une entité inconnue", () => {
  // Mieux vaut un « &frac12; » littéral qu'une transformation hasardeuse.
  assert.equal(decodeEntities("un &frac12; tour"), "un &frac12; tour");
});

test("decodeEntities renvoie null sur une entrée non textuelle", () => {
  assert.equal(decodeEntities(null), null);
  assert.equal(decodeEntities(undefined), null);
  assert.equal(decodeEntities(42), null);
});

// ---------------------------------------------------------------------------
// truncateText
// ---------------------------------------------------------------------------

test("truncateText laisse un texte court intact", () => {
  assert.equal(truncateText("Un vaisseau d'exploration.", 200), "Un vaisseau d'exploration.");
});

test("truncateText normalise les espaces et les retours à la ligne", () => {
  assert.equal(truncateText("  Un  vaisseau\n d'exploration. "), "Un vaisseau d'exploration.");
});

test("truncateText coupe sur une frontière de mot et ajoute une ellipse", () => {
  const out = truncateText("alpha bravo charlie delta echo", 18);
  assert.ok(out.length <= 19, `trop long : ${out}`);
  assert.ok(out.endsWith("…"));
  assert.doesNotMatch(out, /\s…$/); // pas d'espace avant l'ellipse
  assert.ok("alpha bravo charlie delta echo".startsWith(out.slice(0, -1)));
});

test("truncateText ne laisse pas de ponctuation orpheline avant l'ellipse", () => {
  assert.equal(truncateText("alpha bravo, charlie delta", 13), "alpha bravo…");
});

test("truncateText coupe net un mot plus long que la limite", () => {
  // Aucun espace exploitable : on coupe dans le mot plutôt que de tout perdre.
  const out = truncateText("a".repeat(50), 10);
  assert.equal(out, "a".repeat(10) + "…");
});

test("truncateText renvoie null sur une entrée vide ou non textuelle", () => {
  assert.equal(truncateText(""), null);
  assert.equal(truncateText("   "), null);
  assert.equal(truncateText(null), null);
  assert.equal(truncateText(undefined), null);
});

// ---------------------------------------------------------------------------
// normalizeShipSize / normalizePadType
// ---------------------------------------------------------------------------

test("normalizeShipSize uniformise la casse incohérente du Ship Matrix", () => {
  assert.equal(normalizeShipSize("Large"), "Large");
  assert.equal(normalizeShipSize("large"), "Large");
  assert.equal(normalizeShipSize("CAPITAL"), "Capital");
  assert.equal(normalizeShipSize(" medium "), "Medium");
});

test("normalizeShipSize reconnaît snub et vehicle", () => {
  assert.equal(normalizeShipSize("snub"), "Snub");
  assert.equal(normalizeShipSize("vehicle"), "Vehicle");
});

test("normalizeShipSize renvoie null hors du vocabulaire RSI", () => {
  assert.equal(normalizeShipSize("gigantesque"), null);
  assert.equal(normalizeShipSize(""), null);
  assert.equal(normalizeShipSize(null), null);
  assert.equal(normalizeShipSize(3), null);
});

test("normalizePadType ne retient que XS/S/M/L/XL", () => {
  assert.equal(normalizePadType("xs"), "XS");
  assert.equal(normalizePadType(" L "), "L");
  assert.equal(normalizePadType(""), null); // 45 véhicules ont un pad_type vide
  assert.equal(normalizePadType(null), null);
  assert.equal(normalizePadType("XXL"), null);
});

// ---------------------------------------------------------------------------
// safeImageUrl — validation côté serveur des URLs d'image
// ---------------------------------------------------------------------------

test("safeImageUrl accepte les hôtes de la liste blanche en https", () => {
  for (const host of [
    "assets.uexcorp.space",
    "cdn.uexcorp.space",
    "media.robertsspaceindustries.com",
    "robertsspaceindustries.com",
  ]) {
    assert.equal(safeImageUrl(`https://${host}/img/x.jpg`), `https://${host}/img/x.jpg`);
  }
});

test("safeImageUrl refuse tout schéma autre que https", () => {
  assert.equal(safeImageUrl("http://assets.uexcorp.space/x.jpg"), null);
  assert.equal(safeImageUrl("javascript:alert(1)"), null);
  assert.equal(safeImageUrl("data:image/svg+xml;base64,PHN2Zy8+"), null);
  assert.equal(safeImageUrl("//assets.uexcorp.space/x.jpg"), null);
});

test("safeImageUrl compare l'hôte exactement, sans suffixe ni sous-domaine", () => {
  // La comparaison doit résister aux hôtes construits pour ressembler.
  assert.equal(safeImageUrl("https://assets.uexcorp.space.evil.tld/x.jpg"), null);
  assert.equal(safeImageUrl("https://evil-assets.uexcorp.space/x.jpg"), null);
  assert.equal(safeImageUrl("https://x.assets.uexcorp.space/x.jpg"), null);
  assert.equal(safeImageUrl("https://uexcorp.space/x.jpg"), null);
});

test("safeImageUrl refuse une entrée vide ou non analysable", () => {
  assert.equal(safeImageUrl(""), null);
  assert.equal(safeImageUrl("   "), null);
  assert.equal(safeImageUrl("pas une url"), null);
  assert.equal(safeImageUrl(null), null);
  assert.equal(safeImageUrl(undefined), null);
  assert.equal(safeImageUrl(42), null);
});

test("safeImageUrl : la liste blanche est injectable pour les tests", () => {
  assert.equal(
    safeImageUrl("https://exemple.test/x.jpg", ["exemple.test"]),
    "https://exemple.test/x.jpg",
  );
  assert.equal(safeImageUrl("https://assets.uexcorp.space/x.jpg", ["exemple.test"]), null);
});

test("parseShipMatrix renvoie null quand rien n'est exploitable", () => {
  assert.equal(parseShipMatrix([]), null);
  assert.equal(parseShipMatrix([{ name: "X" }]), null); // pas de production_status
});

// ---------------------------------------------------------------------------
// parseWikiConciergePacks
// ---------------------------------------------------------------------------

const WIKI_HTML = `
<table class="wikitable">
  <tr><th>Name</th><th>Included ships</th><th>Availability</th></tr>
  <tr>
    <td>Big Benefactor</td>
    <td><ul><li>Anvil Carrack</li><li>Idris-P</li></ul></td>
    <td>Concierge only</td>
  </tr>
  <tr>
    <td>Starter Pack</td>
    <td><ul><li>Aurora MR</li></ul></td>
    <td>Available now</td>
  </tr>
</table>`;

test("parseWikiConciergePacks ne garde que les lignes Concierge et lit la liste de vaisseaux", () => {
  const packs = parseWikiConciergePacks(WIKI_HTML);
  assert.equal(packs.length, 1);
  assert.equal(packs[0].name, "Big Benefactor");
  assert.deepEqual(packs[0].ships, ["Anvil Carrack", "Idris-P"]);
});

test("parseWikiConciergePacks renvoie null sans ligne Concierge", () => {
  const html = `<table class="wikitable">
    <tr><th>Name</th><th>Included ships</th><th>Availability</th></tr>
    <tr><td>Starter</td><td><ul><li>Aurora</li></ul></td><td>Available now</td></tr>
  </table>`;
  assert.equal(parseWikiConciergePacks(html), null);
});

test("parseWikiConciergePacks ignore les tables sans les bons en-têtes", () => {
  const html = `<table class="wikitable">
    <tr><th>Foo</th><th>Bar</th></tr>
    <tr><td>x</td><td>Concierge</td></tr>
  </table>`;
  assert.equal(parseWikiConciergePacks(html), null);
});

// ---------------------------------------------------------------------------
// parseRsiResponse (+ findShipsList)
// ---------------------------------------------------------------------------

test("parseRsiResponse repère la liste de vaisseaux, même imbriquée, et lit la disponibilité", () => {
  const data = {
    data: {
      to: {
        ships: [
          { name: "Anvil Carrack", skus: [{ available: true }] },
          { name: "RSI Zeus", skus: [{ available: false }] },
        ],
      },
    },
  };
  const result = parseRsiResponse(data);
  assert.equal(result["anvil carrack"], true);
  assert.equal(result["rsi zeus"], false);
});

test("parseRsiResponse renvoie null quand aucune liste de vaisseaux n'est trouvée", () => {
  assert.equal(parseRsiResponse({ data: { to: {} } }), null);
});

// ---------------------------------------------------------------------------
// loadPackagesFile
// ---------------------------------------------------------------------------

test("loadPackagesFile analyse commentaires, synonymes et champs optionnels", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pledgefair-pkg-"));
  const file = join(dir, "packages.txt");
  try {
    await writeFile(
      file,
      [
        "# ceci est un commentaire",
        "",
        "Anvil Carrack | Best In Show | oui",
        "Drake Cutlass | ",
        "Nomad",
        "RSI Zeus | Pack Z | concierge",
        "RSI Ursa | @store | Ursa Rover",
      ].join("\n"),
      "utf-8",
    );
    const out = await loadPackagesFile(file);

    // « oui » = concierge
    assert.deepEqual(out["anvil carrack"], {
      pack: "Best In Show",
      concierge: true,
      storeAlias: null,
    });
    // 2e champ vide → pas de pack
    assert.deepEqual(out["drake cutlass"], { pack: null, concierge: false, storeAlias: null });
    // champ unique
    assert.deepEqual(out["nomad"], { pack: null, concierge: false, storeAlias: null });
    assert.deepEqual(out["rsi zeus"], { pack: "Pack Z", concierge: true, storeAlias: null });
    // déclaration d'alias : le 3e champ porte le nom côté store
    assert.deepEqual(out["rsi ursa"], { pack: null, concierge: false, storeAlias: "Ursa Rover" });
    assert.equal("# ceci est un commentaire" in out, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadPackagesFile renvoie une table vide pour un chemin absent ou nul", async () => {
  // Prototype null volontaire : une clé comme « constructor » ne doit pas
  // passer pour une correction manuelle existante.
  assert.deepEqual(Object.keys(await loadPackagesFile(join(tmpdir(), "n-existe-pas-1.txt"))), []);
  assert.deepEqual(Object.keys(await loadPackagesFile(null)), []);
  assert.equal(Object.getPrototypeOf(await loadPackagesFile(null)), null);
});
