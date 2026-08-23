#!/usr/bin/env node
// Génère docs/data.json pour l'app statique Pledge Fair — Upgrade Advisor.
//
// Port JavaScript (Node.js) de l'ancien upgrade_advisor.py : ce script tourne
// côté serveur (dans une GitHub Action planifiée), donc sans les restrictions
// CORS qui empêchent le navigateur d'interroger directement UEX ou le vrai
// catalogue RSI. Le navigateur, lui, se contente de charger docs/data.json
// (même origine, aucun souci CORS).
//
// Sources, par ordre de priorité (voir chaque fonction fetch* ci-dessous) :
//   1. L'API officielle UEX 2.0 (api.uexcorp.uk, pas de clé requise en
//      lecture) : prix aUEC en jeu + prix pledge de référence. Le site
//      uexcorp.space (pages HTML) bloque les IP des runners GitHub Actions,
//      d'où l'usage de l'API dédiée aux outils tiers plutôt que du scraping.
//   2. Le pledge store RSI lui-même (API interne non documentée, persisted
//      queries Apollo) : catalogues "Standalone Ships" et "Packs" réels.
//   3. L'outil d'upgrade RSI (API non documentée) : repli si 2. est indisponible.
//   4. Le Ship Matrix officiel RSI : statut Concept.
//   5. Le wiki communautaire (starcitizen.tools) : packs réservés aux membres
//      Concierge, invisibles dans le catalogue public même sans compte.
//
// Usage : node scripts/update-data.mjs [--out docs/data.json] [--packages scripts/packages.txt]

import { load as cheerioLoad } from "cheerio";
import { writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const URL_RSI_UPGRADE = "https://robertsspaceindustries.com/pledge-store/api/upgrade/graphql";
const URL_SHIP_MATRIX = "https://robertsspaceindustries.com/ship-matrix/index";

const URL_STOREFRONT_GRAPHQL = "https://robertsspaceindustries.com/graphql";
const HASH_STANDALONE_SHIPS = "ec372b54cbe912fff0590a28ce1db68f339a3367c8cfa48fd591ef9dc82140cb";
const PRODUCT_ID_STANDALONE_SHIPS = 72;
const HASH_PACKS = "7c00a99d486ed837f63885c2b75122237059ee40e08c4d3012559ed1f983bce1";
const PRODUCT_ID_PACKS = 270;

const URL_WIKI_BASE = "https://starcitizen.tools";
const URL_WIKI_PACKAGES = URL_WIKI_BASE + "/List_of_ship_packages";

const HTTP_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

// Variantes de requêtes essayées sur l'endpoint d'upgrade RSI (API non
// officielle : le schéma peut évoluer, d'où plusieurs formes candidates).
const RSI_QUERY_VARIANTS = [
  [
    "filterShips",
    `
query filterShips($fromFilters: [FilterConstraintValues], $toFilters: [FilterConstraintValues]) {
  to(filters: $toFilters) {
    ships { id name msrp skus { id title available price } }
  }
}`,
    { fromFilters: [], toFilters: [] },
  ],
  [null, "query { to { ships { id name msrp skus { id title available price } } } }", null],
  [null, "query { ships { id name msrp skus { id title available price } } }", null],
];

function log(msg) {
  console.error(msg);
}

// ---------------------------------------------------------------------------
// Réseau
// ---------------------------------------------------------------------------

export async function fetchText(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      ...options,
      headers: { ...HTTP_HEADERS, ...(options.headers || {}) },
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} sur ${url}`);
    return await resp.text();
  } finally {
    clearTimeout(t);
  }
}

async function fetchJson(url, options = {}, timeoutMs = 30000) {
  const text = await fetchText(url, options, timeoutMs);
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// Utilitaires de nom
// ---------------------------------------------------------------------------

export function normName(name) {
  const stripped = String(name).normalize("NFKD").replace(/[̀-ͯ]/g, "");
  return stripped
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Les réponses JSON de RSI et d'UEX contiennent des entités HTML déjà
// encodées ("Grey&apos;s Market", "Musashi &amp; Co"). Les écrire telles
// quelles dans data.json les ferait ré-échapper par esc() côté front, et le
// visiteur lirait littéralement « Grey&apos;s Market ». On les décode donc à
// la source, une fois, et esc() se charge ensuite de l'échappement réel.
// Seules les entités effectivement rencontrées sont nommées ; le reste passe
// par la forme numérique. Pur, donc testable.
const NAMED_ENTITIES = {
  amp: "&",
  apos: "'",
  quot: '"',
  lt: "<",
  gt: ">",
  nbsp: " ",
};

export function decodeEntities(text) {
  if (typeof text !== "string") return null;
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (whole, name) => {
      const c = NAMED_ENTITIES[name.toLowerCase()];
      return c === undefined ? whole : c;
    });
}

// Tronque sur une frontière de mot, sans couper au milieu d'un mot ni laisser
// de ponctuation orpheline. La troncature a lieu ici plutôt que dans le
// navigateur pour ne pas embarquer dans data.json ~26 ko de texte que la page
// n'affichera jamais. Pur, donc testable.
export function truncateText(text, max = 200) {
  if (typeof text !== "string") return null;
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const head = (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(
    /[\s,;:.!?—-]+$/,
    "",
  );
  return head + "…";
}

// La casse de `size` est incohérente côté Ship Matrix : on y trouve `Large` et
// `large`, `Capital` et `capital`, plus les valeurs `snub` et `vehicle`. On
// ramène le tout au vocabulaire canonique de RSI. Une valeur inconnue renvoie
// null plutôt qu'une chaîne bancale : la ligne disparaît de la fiche.
const SHIP_SIZES = {
  small: "Small",
  medium: "Medium",
  large: "Large",
  capital: "Capital",
  snub: "Snub",
  vehicle: "Vehicle",
};

export function normalizeShipSize(raw) {
  if (typeof raw !== "string") return null;
  return SHIP_SIZES[raw.trim().toLowerCase()] || null;
}

// Type de plateforme d'atterrissage UEX, repli quand `size` manque.
const PAD_TYPES = ["XS", "S", "M", "L", "XL"];

export function normalizePadType(raw) {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toUpperCase();
  return PAD_TYPES.includes(v) ? v : null;
}

// Hôtes autorisés pour les photos de vaisseaux. Mesuré sur les 280 véhicules
// du roster UEX : assets.uexcorp.space (197), cdn.uexcorp.space (59),
// media.robertsspaceindustries.com (5), robertsspaceindustries.com (1).
// N'autoriser que cdn.uexcorp.space, comme on pourrait le croire au vu d'un
// échantillon, casserait 203 images sur 262.
export const IMAGE_HOSTS = [
  "assets.uexcorp.space",
  "cdn.uexcorp.space",
  "media.robertsspaceindustries.com",
  "robertsspaceindustries.com",
];

/**
 * Valide une URL d'image avant de l'écrire dans data.json : schéma `https:`
 * obligatoire et hôte dans la liste blanche, en comparaison exacte (un
 * `assets.uexcorp.space.evil.tld` ou un `evil-uexcorp.space` ne passe pas).
 *
 * `esc()` protège l'insertion HTML côté front, mais ne dit rien de ce que
 * pointe un `src` : sans ce contrôle, une source amont compromise pourrait
 * faire charger une image arbitraire — et la même liste sert de base à la
 * directive `img-src` de la CSP. Pur, donc testable.
 */
export function safeImageUrl(raw, hosts = IMAGE_HOSTS) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (!hosts.includes(url.hostname.toLowerCase())) return null;
  return url.toString();
}

export function wikiShipUrl(name) {
  const words = name.split(/\s+/);
  const bare = words.length > 1 ? words.slice(1).join(" ") : name;
  // Les « _ » sont la convention MediaWiki pour les espaces, on les pose donc
  // *après* l'encodage. Sans encodage, un nom contenant « # » ou « ? »
  // tronquait l'URL (fragment / query string) et le lien tombait à côté.
  return `${URL_WIKI_BASE}/${encodeURIComponent(bare).replace(/%20/g, "_")}`;
}

// Renvoie la clé de `values` qui correspond à `uexName` (nom complet
// normalisé, puis sans son constructeur), ou null. Séparé de matchByBareName
// pour que l'appelant puisse savoir *quelle* entrée a servi — ce dont
// unmatchedStorefrontNames a besoin pour repérer celles qui n'ont servi à rien.
export function bareNameKey(uexName, values) {
  const n = normName(uexName);
  if (Object.prototype.hasOwnProperty.call(values, n)) return n;
  const words = n.split(" ");
  for (const skip of [1, 2]) {
    if (words.length > skip) {
      const cand = words.slice(skip).join(" ");
      if (Object.prototype.hasOwnProperty.call(values, cand)) return cand;
    }
  }
  return null;
}

export function matchByBareName(uexName, values) {
  const key = bareNameKey(uexName, values);
  return key === null ? null : values[key];
}

// Qualificatifs d'édition que le pledge store accole au nom d'un vaisseau
// ("Polaris - Showdown Edition"). La liste est explicite et non générique :
// voir storefrontAliases() pour pourquoi.
const EDITION_QUALIFIERS = [
  "showdown",
  "best in show",
  "invictus",
  "foundation festival",
  "intergalactic aerospace expo",
  "anniversary",
  "limited",
];
const EDITION_SUFFIX = new RegExp(`\\s+(?:${EDITION_QUALIFIERS.join("|")})?\\s*edition$`);

// Durée d'assurance que le store accole à ses SKU de vente anniversaire
// (« Carrack - 2 Year », « Perseus - 10 Year », « Javelin - LTI »). Même nature
// que le suffixe d'édition : ne fait pas partie du nom du vaisseau, n'existe ni
// chez UEX ni sur le wiki. Sans retrait, ces SKU n'étaient jamais appariés et le
// vaisseau retombait en « vendu en pack », Concierge donc masqué par défaut —
// le cas du Carrack. Le motif s'applique au nom déjà normalisé (donc sans
// tiret) : « Carrack - 2 Year » y est devenu « carrack 2 year ».
const INSURANCE_SUFFIX = /\s+(?:\d+\s+(?:year|month)s?|lti|lifetime insurance)$/;

/**
 * Clés sous lesquelles indexer une entrée du catalogue storefront.
 *
 * Le store vend parfois un vaisseau sous un nom d'édition ("Polaris - Showdown
 * Edition") alors que le roster UEX ne connaît que le nom nu ("RSI Polaris").
 * matchByBareName() ne sait retirer que des mots de *tête* (le constructeur),
 * jamais un suffixe : sans alias, ces SKU n'étaient jamais appariés et le
 * vaisseau se retrouvait classé « vendu en pack » alors qu'il est en vente
 * directe — le cas Polaris.
 *
 * On n'ajoute QUE le nom débarrassé de son suffixe d'édition, et seulement
 * pour une liste explicite de qualificatifs. Une règle générique (retirer
 * n'importe quel mot de queue, ou appliquer aussi le retrait de mots de tête
 * de matchByBareName au nom du store) rattraperait quelques cas de plus mais
 * produit des faux positifs : "C8R Pisces" s'apparierait alors à
 * "Anvil C8 Pisces", deux vaisseaux distincts. Un qualificatif inconnu est
 * donc simplement ignoré — et signalé par unmatchedStorefrontNames(), à
 * déclarer au besoin comme alias dans packages.txt.
 */
export function storefrontAliases(name) {
  const n = normName(name);
  const aliases = new Set([n]);
  // Les deux suffixes sont indépendants et peuvent se cumuler : on indexe le
  // nom privé de chacun, puis privé des deux, pour qu'un « Polaris - Showdown
  // Edition - 2 Year » reste apparié.
  for (const stripped of [n.replace(EDITION_SUFFIX, ""), n.replace(INSURANCE_SUFFIX, "")]) {
    const bare = stripped.replace(EDITION_SUFFIX, "").replace(INSURANCE_SUFFIX, "").trim();
    if (bare.length >= 3) aliases.add(bare);
  }
  return aliases;
}

// ---------------------------------------------------------------------------
// Extraction UEX — API officielle 2.0 (pas de scraping HTML)
// ---------------------------------------------------------------------------
//
// Le site uexcorp.space (pages HTML) bloque les requêtes venant des IP des
// runners GitHub Actions (403, probablement une protection anti-bot type
// Cloudflare) alors qu'il n'y a aucun souci en local. UEX publie justement
// une API dédiée aux outils tiers, sur un domaine différent, qui ne bloque
// pas ces IP et ne nécessite pas de clé pour la simple lecture. On l'utilise
// à la place du scraping HTML.

const URL_UEX_API = "https://api.uexcorp.uk/2.0";

// Valide l'enveloppe commune des réponses UEX ({ status, data, ... }) et
// renvoie sa charge utile. La plupart des points d'entrée renvoient un
// tableau, mais pas tous : /game_versions renvoie un objet
// ({"live":"4.9","ptu":"4.10.0"}), qu'une validation `Array.isArray` seule
// rejetterait. D'où le paramètre `shape`, qui garde le contrôle du champ
// `status` dans les deux cas. Pur, donc testable sans réseau.
export function uexPayload(data, path, shape = "array") {
  const payload = data && data.data;
  const shapeOk =
    shape === "array"
      ? Array.isArray(payload)
      : Boolean(payload) && typeof payload === "object" && !Array.isArray(payload);
  if (!data || data.status !== "ok" || !shapeOk) {
    throw new Error(`Réponse UEX API inattendue pour ${path}`);
  }
  return payload;
}

export async function fetchUexJson(path, shape = "array") {
  const data = await fetchJson(`${URL_UEX_API}/${path}`, {
    headers: { Accept: "application/json" },
  });
  return uexPayload(data, path, shape);
}

// UEX conserve un historique de prix par vaisseau ET par devise/région
// (USD, GBP, EUR-FR, EUR-DE, EUR-NL, EUR-AT...), pas une seule ligne par
// vaisseau. Il faut donc explicitement ne garder que l'entrée en USD —
// prendre "la plus récente" toutes devises confondues piocherait parfois
// une entrée en livres ou en euros, faussant le prix affiché en $.
export function usdPriceEntry(priceRows) {
  return priceRows.find((p) => p.currency === "USD") || null;
}

async function fetchUexRoster() {
  log(`Vérification UEX (${URL_UEX_API}) ...`);
  const [vehicles, prices, purchases] = await Promise.all([
    fetchUexJson("vehicles"),
    fetchUexJson("vehicles_prices"),
    fetchUexJson("vehicles_purchases_prices_all"),
  ]);
  return buildUexRoster(vehicles, prices, purchases);
}

// Fusionne les trois tableaux bruts de l'API UEX en { pledge, inGame }.
// Pur (aucun réseau), donc testable avec des fixtures. Pour chaque véhicule
// on ne retient que la ligne de prix en USD (usdPriceEntry), et on ne garde
// comme prix pledge que le prix standard, à défaut le prix warbond. Les
// lignes d'achat en jeu sans prix (price_buy <= 0) ou pointant vers un
// véhicule inconnu sont ignorées.
export function buildUexRoster(vehicles, prices, purchases) {
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));

  const pricesByVehicle = new Map();
  for (const p of prices) {
    if (!pricesByVehicle.has(p.id_vehicle)) pricesByVehicle.set(p.id_vehicle, []);
    pricesByVehicle.get(p.id_vehicle).push(p);
  }

  const pledge = vehicles.map((v) => {
    const usd = usdPriceEntry(pricesByVehicle.get(v.id) || []);
    let pledgePrice = null;
    let available = false;
    if (usd) {
      const std = usd.price > 0 ? usd.price : null;
      const wb = usd.price_warbond > 0 ? usd.price_warbond : null;
      pledgePrice = std != null ? std : wb;
      available = Boolean(usd.on_sale || usd.on_sale_warbond);
    }
    return {
      key: String(v.id),
      name: v.name_full,
      pledge: pledgePrice,
      available,
      concept: v.is_concept === 1,
      // Champs de fiche : déjà présents dans la réponse /vehicles, jusqu'ici
      // simplement jetés.
      imageUrl: safeImageUrl(v.url_photo),
      scu: typeof v.scu === "number" ? v.scu : null,
      manufacturer: decodeEntities(v.company_name) || null,
      padType: normalizePadType(v.pad_type),
    };
  });

  const inGame = {};
  for (const row of purchases) {
    if (!(row.price_buy > 0)) continue;
    const v = vehicleById.get(row.id_vehicle);
    if (!v) continue;
    const key = String(row.id_vehicle);
    if (!inGame[key]) inGame[key] = { name: v.name_full, locations: [] };
    inGame[key].locations.push({ loc: row.terminal_name, auec: row.price_buy });
  }

  return { pledge, inGame };
}

// Extrait la version LIVE de la réponse /game_versions
// ({"live":"4.9","ptu":"4.10.0"}). On retient `live` : c'est le patch que
// jouent les joueurs, donc celui auquel correspondent les prix en jeu. Une
// valeur absente ou vide renvoie null plutôt qu'une chaîne bancale — le pied
// de page masque alors la mention plutôt que d'afficher « SC undefined ».
// Pur, donc testable.
export function parseGameVersion(payload) {
  const live = payload && payload.live;
  return typeof live === "string" && live.trim() ? live.trim() : null;
}

// Source auxiliaire : son indisponibilité ne doit pas faire échouer la
// génération, au même titre que le Ship Matrix ou le wiki. On renvoie null et
// le drapeau meta.gameVersionOk le signale.
export async function fetchGameVersion() {
  log(`Vérification version du jeu (${URL_UEX_API}/game_versions) ...`);
  try {
    return parseGameVersion(await fetchUexJson("game_versions", "object"));
  } catch (exc) {
    log(`Avertissement: version du jeu indisponible (${exc}). La mention SC sera masquée.`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Ship Matrix officiel RSI (statut Concept)
// ---------------------------------------------------------------------------

export async function fetchShipMatrix() {
  log(`Vérification Ship Matrix (${URL_SHIP_MATRIX}) ...`);
  let data;
  try {
    data = await fetchJson(URL_SHIP_MATRIX, { headers: { Accept: "application/json" } });
  } catch (exc) {
    log(
      `Avertissement: Ship Matrix inaccessible (${exc}). Statut Concept basé sur UEX uniquement.`,
    );
    return null;
  }
  const ships = data && data.data;
  if (!Array.isArray(ships) || ships.length === 0) {
    log("Avertissement: réponse Ship Matrix sans liste de vaisseaux reconnaissable, ignorée.");
    return null;
  }
  return parseShipMatrix(ships);
}

// Construit la table { nom normalisé -> { concept, size, description,
// manufacturer } } depuis la liste de vaisseaux du Ship Matrix.
//
// Elle ne retenait que `production_status` ; on garde maintenant aussi de quoi
// remplir une fiche vaisseau. La clé reste le nom normalisé, donc
// matchByBareName() et l'appariement existant sont inchangés — c'est la
// *valeur* qui passe d'un booléen à un objet, d'où le `.concept` côté
// consommateur.
//
// `concept` vaut null quand production_status manque : l'appelant retombe
// alors sur ce que dit UEX, exactement comme avant, au lieu de conclure « pas
// concept ». Une entrée sans nom, ou sans aucun champ exploitable, est
// ignorée. Renvoie null si rien d'exploitable. Pur, donc testable.
export function parseShipMatrix(ships) {
  const result = {};
  for (const s of ships) {
    if (!s.name) continue;
    const status = s.production_status ? String(s.production_status).trim().toLowerCase() : null;
    const entry = {
      concept: status === null ? null : status === "in-concept",
      size: normalizeShipSize(s.size),
      description: truncateText(decodeEntities(s.description)),
      manufacturer: decodeEntities(s.manufacturer && s.manufacturer.name) || null,
    };
    if (entry.concept === null && !entry.size && !entry.description && !entry.manufacturer) {
      continue;
    }
    result[normName(String(s.name))] = entry;
  }
  return Object.keys(result).length ? result : null;
}

// ---------------------------------------------------------------------------
// Pledge store RSI direct (persisted queries Apollo)
// ---------------------------------------------------------------------------

// Extrait store.listing de l'enveloppe GraphQL du storefront en distinguant
// clairement les modes d'échec : erreurs GraphQL renvoyées par le serveur vs.
// structure inattendue (schéma changé). Sans ça, un simple `data[0].data...`
// lançait un TypeError opaque que l'appelant loggait comme « inaccessible »,
// masquant un vrai changement d'API. Exporté pour être testé sans réseau.
export function storefrontListingFromEnvelope(data, operationName, page) {
  const ctx = `op ${operationName}, page ${page}`;
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`Réponse GraphQL storefront non conforme (${ctx}) : tableau attendu`);
  }
  const errors = data[0].errors;
  if (Array.isArray(errors) && errors.length) {
    throw new Error(
      `Erreurs GraphQL storefront (${ctx}) : ` +
        errors.map((e) => String((e && e.message) || e)).join(" | "),
    );
  }
  const listing = data[0].data?.store?.listing;
  if (!listing || !Array.isArray(listing.resources)) {
    throw new Error(
      `Structure inattendue de la réponse storefront (${ctx}) : store.listing.resources absent`,
    );
  }
  return listing;
}

export async function fetchStorefrontListing(
  operationName,
  sha256,
  facet,
  productId,
  referer,
  pageSize = 100,
) {
  const resources = [];
  let page = 1;
  let total = null;
  while (total === null || resources.length < total) {
    const payload = [
      {
        operationName,
        variables: {
          storeFront: "pledge",
          query: {
            page,
            limit: pageSize,
            skus: {
              filtersFromTags: { tagIdentifiers: [], facetIdentifiers: [facet] },
              products: [productId],
            },
            sort: { field: "name", direction: "asc" },
          },
        },
        extensions: { persistedQuery: { version: 1, sha256Hash: sha256 } },
      },
    ];
    const data = await fetchJson(URL_STOREFRONT_GRAPHQL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Referer: referer,
        Origin: "https://robertsspaceindustries.com",
      },
      body: JSON.stringify(payload),
    });
    const listing = storefrontListingFromEnvelope(data, operationName, page);
    const batch = listing.resources;
    if (batch.length === 0) break;
    resources.push(...batch);
    total = listing.totalCount ?? resources.length;
    page += 1;
    if (page > 20) break; // garde-fou anti-boucle
  }
  return resources;
}

export async function fetchStorefrontStandaloneShips() {
  log(`Vérification du catalogue Standalone Ships (${URL_STOREFRONT_GRAPHQL}) ...`);
  let resources;
  try {
    resources = await fetchStorefrontListing(
      "GetBrowseSkusStandaloneShipByFilter",
      HASH_STANDALONE_SHIPS,
      "extras-standalone-ships",
      PRODUCT_ID_STANDALONE_SHIPS,
      "https://robertsspaceindustries.com/store/pledge/browse/extras/standalone-ships",
    );
  } catch (exc) {
    log(
      `Avertissement: catalogue Standalone Ships inaccessible (${exc}). Repli sur l'outil d'upgrade RSI / UEX.`,
    );
    return null;
  }
  return buildStorefrontIndex(resources);
}

/**
 * Indexe le catalogue Standalone Ships par nom normalisé *et* par alias sans
 * suffixe d'édition (voir storefrontAliases).
 *
 * Deux entrées qui se normalisent pareil (variante warbond, doublon de
 * listing — le store renvoie par exemple "Basher" deux fois) sont FUSIONNÉES
 * et non écrasées : avant, le dernier écrit gagnait, si bien qu'une entrée
 * indisponible pouvait effacer la disponibilité d'une entrée en vente. On
 * garde donc `available` dès qu'une seule des entrées est en vente, et le
 * premier prix connu.
 *
 * Pur (ne fait aucun réseau), donc testable avec des fixtures.
 */
export function buildStorefrontIndex(resources) {
  const result = Object.create(null);
  for (const r of resources) {
    if (!r.name) continue;
    const native = r.nativePrice && r.nativePrice.amount;
    const name = String(r.name);
    const available = Boolean(r.stock && r.stock.available);
    const price = typeof native === "number" ? native / 100 : null;
    for (const key of storefrontAliases(name)) {
      const prev = result[key];
      result[key] = prev
        ? { name: prev.name, available: prev.available || available, price: prev.price ?? price }
        : { name, available, price };
    }
  }
  return Object.keys(result).length ? result : null;
}

/** Recherche exacte (nom normalisé) dans l'index storefront. */
export function lookupStorefront(storefrontIndex, name) {
  const key = normName(name);
  return Object.prototype.hasOwnProperty.call(storefrontIndex, key) ? storefrontIndex[key] : null;
}

/**
 * Noms du catalogue storefront qu'aucun vaisseau du roster ne réclame.
 *
 * C'est le filet qui manquait quand le cas Polaris est passé en production :
 * un SKU non apparié ne produisait aucun signal, le vaisseau basculait
 * simplement en « vendu en pack » et personne ne voyait rien. Chaque nom
 * remonté ici est soit un vaisseau absent du roster UEX (normal, rien à
 * faire), soit un écart de nommage à corriger — nouveau qualificatif
 * d'édition à ajouter, ou entrée « @vente » dans packages.txt.
 *
 * Pur, donc testable sans réseau.
 */
export function unmatchedStorefrontNames(storefrontIndex, pledge, manualPackages = {}) {
  if (!storefrontIndex) return [];
  const claimed = new Set();
  for (const p of pledge) {
    const manual = manualPackages[normName(p.name)];
    const hit =
      (manual && manual.storeAlias ? lookupStorefront(storefrontIndex, manual.storeAlias) : null) ||
      matchByBareName(p.name, storefrontIndex);
    if (hit) claimed.add(hit.name);
  }
  // Un SKU est réclamé dès qu'une de ses clés d'indexation l'est, pas seulement
  // sous son nom exact : « Mole » et « Mole - 2 Year » partagent la clé « mole »
  // et désignent le même vaisseau, donc un seul appariement suffit à couvrir les
  // deux. Sans ça, la variante anniversaire remontait à chaque run comme un
  // écart de nommage à déclarer — un faux positif qui apprend à ignorer l'alerte,
  // exactement ce que ce filet cherche à éviter.
  const claimedKeys = new Set();
  for (const name of claimed) for (const key of storefrontAliases(name)) claimedKeys.add(key);
  const all = new Set(Object.values(storefrontIndex).map((e) => e.name));
  return [...all]
    .filter((n) => ![...storefrontAliases(n)].some((key) => claimedKeys.has(key)))
    .sort();
}

async function fetchStorefrontPacks() {
  log(`Vérification des packs en vente (${URL_STOREFRONT_GRAPHQL}) ...`);
  let resources;
  try {
    resources = await fetchStorefrontListing(
      "GetBrowseSkusByFilter",
      HASH_PACKS,
      "extras-packs",
      PRODUCT_ID_PACKS,
      "https://robertsspaceindustries.com/store/pledge/browse/extras/packs",
    );
  } catch (exc) {
    log(
      `Avertissement: catalogue Packs inaccessible (${exc}). Les noms de pack proviendront uniquement de packages.txt.`,
    );
    return null;
  }
  return resources.filter((r) => r.name).map((r) => ({ name: r.name, excerpt: r.excerpt || "" }));
}

// ---------------------------------------------------------------------------
// Wiki communautaire : packs réservés aux membres Concierge
// ---------------------------------------------------------------------------

// Équivalent de BeautifulSoup get_text(separator, strip=True) : parcourt tous
// les noeuds texte du sous-arbre (peu importe la structure — <li>, <br>,
// texte brut) et les joint avec 'sep'. Nécessaire ici car "Included ships"
// utilise une liste <ul><li> sur le wiki, pas des <br>.
function collectText($, node, texts) {
  $(node)
    .contents()
    .each((_, child) => {
      if (child.type === "text") {
        const t = (child.data || "").trim();
        if (t) texts.push(t);
      } else if (child.type === "tag") {
        collectText($, child, texts);
      }
    });
}

function getTextJoined($, el, sep = "|") {
  const texts = [];
  collectText($, el, texts);
  return texts.join(sep);
}

async function fetchWikiConciergePacks() {
  log(`Vérification des packs Concierge (${URL_WIKI_PACKAGES}) ...`);
  let html;
  try {
    html = await fetchText(URL_WIKI_PACKAGES);
  } catch (exc) {
    log(
      `Avertissement: wiki des packs inaccessible (${exc}). Les packs Concierge ne seront pas détectés automatiquement.`,
    );
    return null;
  }
  return parseWikiConciergePacks(html);
}

// Extrait les packs réservés aux membres Concierge des tables du wiki. Ne
// retient que les lignes dont la colonne « Availability » mentionne
// "concierge", et lit les vaisseaux inclus (colonne « Included ships »,
// souvent une liste <ul><li>). Pur (prend le HTML brut), donc testable via
// cheerio sans réseau. Renvoie null si aucun pack Concierge trouvé.
export function parseWikiConciergePacks(html) {
  const $ = cheerioLoad(html);
  const packs = [];
  $("table.wikitable, table.article-table").each((_, table) => {
    const rows = $(table).find("tr").toArray();
    if (rows.length === 0) return;
    const headers = $(rows[0])
      .find("th, td")
      .map((__, c) => $(c).text().trim())
      .get();
    const iName = headers.indexOf("Name");
    const iShips = headers.indexOf("Included ships");
    const iAvail = headers.indexOf("Availability");
    if (iName === -1 || iShips === -1 || iAvail === -1) return;
    for (const tr of rows.slice(1)) {
      const cells = $(tr).find("td, th");
      if (cells.length <= Math.max(iName, iShips, iAvail)) continue;
      const availText = cells.eq(iAvail).text().trim().toLowerCase();
      if (!availText.includes("concierge")) continue;
      const name = cells.eq(iName).text().trim();
      const shipsText = getTextJoined($, cells.get(iShips), "|");
      const ships = shipsText
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean);
      if (name && ships.length) packs.push({ name, ships });
    }
  });
  return packs.length ? packs : null;
}

// ---------------------------------------------------------------------------
// Outil d'upgrade RSI (repli si le catalogue direct est indisponible)
// ---------------------------------------------------------------------------

function findShipsList(node) {
  if (Array.isArray(node)) {
    if (node.length && node.every((x) => x && typeof x === "object" && "name" in x && "skus" in x))
      return node;
    for (const item of node) {
      const found = findShipsList(item);
      if (found) return found;
    }
  } else if (node && typeof node === "object") {
    for (const value of Object.values(node)) {
      const found = findShipsList(value);
      if (found) return found;
    }
  }
  return null;
}

export function parseRsiResponse(data) {
  const ships = findShipsList(data);
  if (!ships) {
    log("Avertissement: réponse RSI sans liste de vaisseaux reconnaissable, ignorée.");
    return null;
  }
  const result = {};
  for (const s of ships) {
    const skus = s.skus || [];
    const buyable = skus.some((sku) => sku && typeof sku === "object" && sku.available);
    result[normName(String(s.name))] = buyable;
  }
  return Object.keys(result).length ? result : null;
}

// Contrairement aux autres sources, on lit ici le corps de la réponse même
// sur un statut d'erreur (les messages GraphQL de RSI y sont) : d'où un fetch
// direct plutôt que fetchText, qui lève sur non-2xx. Le timeout, lui, doit
// être le même — sans lui, un endpoint qui accepte la connexion sans jamais
// répondre bloquait indéfiniment les 4 appels enchaînés par
// fetchRsiStandalone, et avec eux tout le run de l'Action.
export async function rsiPost(query, variables, operationName, timeoutMs = 30000) {
  const payload = { query };
  if (variables !== null && variables !== undefined) payload.variables = variables;
  if (operationName) payload.operationName = operationName;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  let resp;
  let text;
  try {
    resp = await fetch(URL_RSI_UPGRADE, {
      method: "POST",
      headers: { ...HTTP_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    text = await resp.text();
  } finally {
    clearTimeout(t);
  }
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* pas du JSON */
  }
  return [resp.status, data, text];
}

export async function fetchRsiStandalone() {
  log(`Vérification RSI (${URL_RSI_UPGRADE}) ...`);
  try {
    const [status0, , text0] = await rsiPost("query { __typename }");
    if (status0 !== 200) {
      log(`Avertissement: API RSI inaccessible (HTTP ${status0}) : ${text0.slice(0, 300)}`);
      return null;
    }
    const errors = [];
    for (const [opName, query, variables] of RSI_QUERY_VARIANTS) {
      const [status, data, text] = await rsiPost(query, variables, opName);
      if (data) {
        if (data.data) {
          const result = parseRsiResponse(data);
          if (result) return result;
        }
        for (const e of data.errors || []) errors.push(String(e.message || e).slice(0, 200));
      } else if (status !== 200) {
        errors.push(`HTTP ${status}: ${text.slice(0, 200)}`);
      }
    }
    log("Avertissement: aucune requête RSI n'a abouti.");
    for (const e of [...new Set(errors)]) log(`  - ${e}`);
    return null;
  } catch (exc) {
    log(
      `Avertissement: API RSI inaccessible (${exc}). Classification 'Package' basée sur packages.txt uniquement.`,
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Recoupement vaisseaux <-> packs
// ---------------------------------------------------------------------------

export function bareNameCandidates(names) {
  const out = new Set();
  for (const name of names) {
    const n = normName(name);
    if (n.length >= 3) out.add(n);
    const words = n.split(" ");
    for (const skip of [1, 2]) {
      if (words.length > skip) {
        const cand = words.slice(skip).join(" ");
        if (cand.length >= 3) out.add(cand);
      }
    }
  }
  return out;
}

export function matchShipsToPacks(packs, shipNames) {
  // Le motif ne dépend que du candidat : on le compile une fois pour toutes,
  // au lieu d'une fois par couple (pack, candidat) — soit ~25 000
  // compilations par run pour ~500 motifs distincts.
  const patterns = [...shipNames].map((candidate) => [
    candidate,
    new RegExp(`(?:^|\\s)${candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`),
  ]);
  // Prototype null : sans ça, un vaisseau dont le nom normalisé vaut
  // « constructor » ou « tostring » passerait pour déjà apparié.
  const result = Object.create(null);
  for (const pack of packs) {
    const text = normName(pack.excerpt);
    for (const [candidate, re] of patterns) {
      if (Object.hasOwn(result, candidate)) continue;
      if (re.test(text)) result[candidate] = { pack: pack.name, concierge: false };
    }
  }
  return result;
}

export function matchShipsToConciergePacks(packs) {
  const result = Object.create(null); // voir matchShipsToPacks
  const sorted = [...packs].sort((a, b) => a.ships.length - b.ships.length);
  for (const pack of sorted) {
    for (const token of pack.ships) {
      const key = normName(token);
      if (key.length < 3 || Object.hasOwn(result, key)) continue;
      result[key] = { pack: pack.name, concierge: true };
    }
  }
  return result;
}

// Marqueur du 2e champ de packages.txt qui force un vaisseau en vente
// directe, au lieu de le forcer en pack. Le « @ » ne peut pas entrer en
// collision avec un vrai nom de pack. Voir storefrontAliases() : l'heuristique
// de suffixe ne couvre que les qualificatifs d'édition connus, et certains
// écarts de nommage du store ("Ursa Rover" vs "RSI Ursa") n'ont pas de règle
// sûre — d'où cette trappe manuelle, symétrique de la mise en pack.
// Marqueur du 2e champ de packages.txt qui déclare, non pas un pack, mais le
// nom sous lequel le pledge store vend ce vaisseau (3e champ).
//
// C'est volontairement un *alias* et non un « forcer en vente » : la
// disponibilité reste lue dans le catalogue live. Une ligne oubliée après le
// retrait du vaisseau du store le repasse donc automatiquement en « pas en
// vente », là où un drapeau booléen l'aurait figé en vente indéfiniment —
// le même piège de fraîcheur que celui corrigé côté pack.
const STORE_ALIAS_MARKER = "@store";

export async function loadPackagesFile(path) {
  const out = Object.create(null);
  if (!path || !existsSync(path)) return out;
  const text = await readFile(path, "utf-8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split("|").map((p) => p.trim());
    const packField = parts.length > 1 && parts[1] ? parts[1] : null;
    const isAlias = packField !== null && packField.toLowerCase() === STORE_ALIAS_MARKER;
    const third = parts.length > 2 ? parts[2] : "";
    out[normName(parts[0])] = {
      pack: isAlias ? null : packField,
      concierge: !isAlias && ["concierge", "oui", "yes", "true", "1"].includes(third.toLowerCase()),
      storeAlias: isAlias && third ? third : null,
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fusion des données
// ---------------------------------------------------------------------------

export function buildDataset(
  inGame,
  pledge,
  storefrontStandalone,
  storefrontPacks,
  wikiConciergePacks,
  rsi,
  shipMatrix,
  manualPackages,
) {
  const inGameByName = {};
  for (const v of Object.values(inGame)) inGameByName[normName(v.name)] = v;
  const used = new Set();
  const ships = [];

  let shipToPack = {};
  if (storefrontPacks) {
    const candidates = bareNameCandidates(pledge.map((p) => p.name));
    if (shipMatrix) for (const k of Object.keys(shipMatrix)) candidates.add(k);
    shipToPack = matchShipsToPacks(storefrontPacks, candidates);
  }
  if (wikiConciergePacks) {
    for (const [key, val] of Object.entries(matchShipsToConciergePacks(wikiConciergePacks))) {
      if (!(key in shipToPack)) shipToPack[key] = val;
    }
  }

  /** Entrée Ship Matrix correspondant à un nom de vaisseau, ou null. */
  function matrixFor(name) {
    return shipMatrix === null ? null : matchByBareName(name, shipMatrix);
  }

  // `concept` reste piloté par le Ship Matrix quand il le connaît, et retombe
  // sur UEX sinon — y compris pour une entrée présente au Ship Matrix mais
  // sans production_status, désormais conservée pour ses autres champs.
  function conceptFor(name, uexConcept) {
    const entry = matrixFor(name);
    return entry && entry.concept !== null ? entry.concept : uexConcept;
  }

  /**
   * Champs de fiche d'un vaisseau. Le constructeur vient d'UEX en priorité
   * (quasi complet) et retombe sur le Ship Matrix ; la taille et la
   * description ne viennent que du Ship Matrix. Un champ absent vaut null : la
   * ligne correspondante disparaît de la fiche côté page, plutôt que de
   * s'afficher avec un tiret orphelin.
   */
  function detailsFor(name, uex = {}) {
    const entry = matrixFor(name);
    return {
      imageUrl: uex.imageUrl ?? null,
      manufacturer: uex.manufacturer || (entry && entry.manufacturer) || null,
      size: (entry && entry.size) || null,
      scu: uex.scu ?? null,
      description: (entry && entry.description) || null,
      padType: uex.padType ?? null,
    };
  }

  for (const p of pledge) {
    const ig = (p.key && inGame[p.key]) || inGameByName[normName(p.name)];
    const locations = ig ? [...ig.locations].sort((a, b) => a.auec - b.auec) : [];
    if (ig) used.add(ig);
    const best = locations.length ? locations[0] : null;

    const manualKey = normName(p.name);
    const manual = Object.hasOwn(manualPackages, manualKey) ? manualPackages[manualKey] : null;

    // Un alias déclaré dans packages.txt court-circuite l'appariement
    // automatique : il couvre les écarts de nommage qu'aucune règle sûre ne
    // rattrape ("Ursa Rover" côté store contre "RSI Ursa" côté roster).
    // La disponibilité reste celle du catalogue live.
    const storefrontMatch =
      storefrontStandalone !== null
        ? (manual && manual.storeAlias
            ? lookupStorefront(storefrontStandalone, manual.storeAlias)
            : null) || matchByBareName(p.name, storefrontStandalone)
        : null;
    let available;
    if (storefrontStandalone !== null) {
      available = Boolean(storefrontMatch && storefrontMatch.available);
    } else {
      available = p.available;
    }

    // Repli quand le catalogue Standalone Ships est indisponible : si UEX
    // pense le vaisseau achetable mais que l'outil d'upgrade RSI ne le liste
    // pas en standalone, c'est qu'il n'est en réalité vendu qu'en pack. On
    // corrige la disponibilité (l'outil d'upgrade ne fournit pas de nom de
    // pack, d'où le drapeau séparé consommé plus bas).
    let rsiPackageOnly = false;
    if (storefrontStandalone === null && rsi !== null && available) {
      const really = matchByBareName(p.name, rsi);
      if (really === false) {
        available = false;
        rsiPackageOnly = true;
      }
    }

    let pledgePrice = p.pledge;
    if (pledgePrice == null && storefrontMatch && storefrontMatch.price != null) {
      pledgePrice = storefrontMatch.price;
    }

    let packageOnly = false;
    let packName = null;
    let packConcierge = false;

    // Une ligne d'alias (@store) ne dit rien du pack : seules les lignes de
    // mise en pack sont consommées ici.
    const manualPack = manual && !manual.storeAlias ? manual : null;

    // Priorité : la vente directe l'emporte toujours sur le pack — d'où le
    // `!available` sur la branche manuelle aussi. Une correction manuelle ne
    // peut donc plus rétrograder un vaisseau que le storefront déclare vendu
    // seul : sinon une entrée devenue obsolète (ajoutée pour contourner un
    // appariement raté, puis oubliée quand RSI remet le vaisseau en vente)
    // masquerait durablement une vraie vente.
    if (manualPack && !available) {
      packageOnly = true;
      packName = manualPack.pack;
      packConcierge = manualPack.concierge;
    } else if (!available) {
      const matchedPack = Object.keys(shipToPack).length
        ? matchByBareName(p.name, shipToPack)
        : null;
      if (matchedPack) {
        packageOnly = true;
        packName = matchedPack.pack;
        packConcierge = matchedPack.concierge;
      } else if (rsiPackageOnly) {
        packageOnly = true;
      }
    }

    ships.push({
      name: p.name,
      pledge: pledgePrice,
      available,
      packageOnly,
      packName,
      packConcierge,
      concept: conceptFor(p.name, p.concept),
      wikiUrl: wikiShipUrl(p.name),
      auec: best ? best.auec : null,
      loc: best ? best.loc : null,
      ratio: best && pledgePrice ? Math.round((best.auec / pledgePrice) * 100) / 100 : null,
      ...detailsFor(p.name, p),
    });
  }

  for (const ig of Object.values(inGame)) {
    if (used.has(ig)) continue;
    const locations = [...ig.locations].sort((a, b) => a.auec - b.auec);
    const best = locations[0];
    ships.push({
      name: ig.name,
      pledge: null,
      available: false,
      packageOnly: false,
      packName: null,
      packConcierge: false,
      concept: conceptFor(ig.name, false),
      wikiUrl: wikiShipUrl(ig.name),
      auec: best.auec,
      loc: best.loc,
      ratio: null,
      // Vaisseau connu du seul catalogue en jeu : aucune ligne UEX /vehicles à
      // joindre, on ne dispose que de ce que dit le Ship Matrix.
      ...detailsFor(ig.name),
    });
  }

  ships.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return ships;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const args = { out: "docs/data.json", packages: "scripts/packages.txt", force: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--packages") args.packages = argv[++i];
    else if (argv[i] === "--force") args.force = true;
  }
  return args;
}

// Comparaison d'objets insensible à l'ordre des cles : `meta` est reconstruit
// a chaque run, `prev` relu d'un fichier ecrit par une version anterieure du
// script — leurs cles peuvent ne pas se presenter dans le meme ordre.
const stableJson = (o) =>
  JSON.stringify(
    Object.keys(o)
      .sort()
      .map((k) => [k, o[k]]),
  );

// L'Action tourne chaque jour, mais les données ne changent pas tous les
// jours. Pour ne pas polluer l'historique git d'un commit quotidien inutile
// (le gros data.json réécrit pour un simple horodatage), on réutilise
// l'horodatage précédent quand ni les vaisseaux ni le reste des métadonnées
// n'ont bougé : le fichier reste alors identique octet pour octet et `git` ne
// voit rien à committer. `generatedAt` reflète donc la dernière *évolution*
// des données, pas la dernière exécution.
//
// La comparaison porte sur tout `meta` (hors `generatedAt`) et non sur une
// liste de drapeaux figée : un champ ajouté plus tard — `gameVersion`, par
// exemple — entre ainsi dans le calcul sans qu'on ait à penser à l'inscrire
// quelque part. Exporté pour être testé.
export function resolveGeneratedAt(previous, ships, meta, now) {
  const prev = previous && previous.meta;
  if (!prev || !prev.generatedAt) return now;
  const prevRest = { ...prev };
  delete prevRest.generatedAt;
  const sameMeta = stableJson(prevRest) === stableJson(meta);
  const sameShips = JSON.stringify(previous.ships) === JSON.stringify(ships);
  return sameMeta && sameShips ? prev.generatedAt : now;
}

// Les quatre drapeaux meta ne surveillent que les sources *auxiliaires*
// (storefront, RSI, Ship Matrix, wiki). La colonne vertébrale, elle, est
// UEX : `fetchUexJson` n'exige qu'un `status: "ok"` et un tableau, si bien
// qu'une réponse UEX vidée ou tronquée passerait avec les quatre drapeaux au
// vert — et un data.json quasi vide se figerait en silence. On garde donc un
// filet : roster sous un plancher absolu, ou effondrement brutal par rapport
// au fichier précédent. Pur (aucun I/O), donc testable.
export function rosterHealth(ships, previous, { minShips = 50, dropRatio = 0.5 } = {}) {
  const count = ships.length;
  if (count < minShips) {
    return {
      ok: false,
      reason: `roster anormalement court : ${count} vaisseaux (plancher ${minShips})`,
    };
  }
  const prevCount = (previous && previous.ships && previous.ships.length) || 0;
  if (prevCount >= minShips && count < prevCount * dropRatio) {
    return {
      ok: false,
      reason:
        `chute brutale du roster : ${count} vaisseaux contre ${prevCount} au run précédent ` +
        `(< ${Math.round(dropRatio * 100)} %)`,
    };
  }
  return { ok: true };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const [
    storefrontStandalone,
    storefrontPacks,
    wikiConciergePacks,
    rsi,
    shipMatrix,
    uex,
    gameVersion,
  ] = await Promise.all([
    fetchStorefrontStandaloneShips(),
    fetchStorefrontPacks(),
    fetchWikiConciergePacks(),
    fetchRsiStandalone(),
    fetchShipMatrix(),
    fetchUexRoster(),
    fetchGameVersion(),
  ]);
  const { inGame, pledge } = uex;

  const manualPackages = await loadPackagesFile(args.packages);

  const ships = buildDataset(
    inGame,
    pledge,
    storefrontStandalone,
    storefrontPacks,
    wikiConciergePacks,
    rsi,
    shipMatrix,
    manualPackages,
  );

  // Écarts de nommage entre le catalogue du store et le roster UEX : sans ce
  // signal, un SKU non apparié faisait basculer le vaisseau en « vendu en
  // pack » sans le moindre avertissement (cas Polaris).
  const unmatched = unmatchedStorefrontNames(storefrontStandalone, pledge, manualPackages);
  if (unmatched.length) {
    log(
      `Avertissement: ${unmatched.length} entrée(s) du catalogue Standalone Ships ` +
        `sans vaisseau correspondant dans le roster UEX — si c'est un écart de ` +
        `nommage, le déclarer dans packages.txt (« Nom du roster | @store | Nom du store ») :`,
    );
    for (const n of unmatched) log(`  - ${n}`);
  }

  const flags = {
    storefrontOk: storefrontStandalone !== null,
    rsiOk: rsi !== null,
    shipMatrixOk: shipMatrix !== null,
    conciergeWikiOk: wikiConciergePacks !== null,
    gameVersionOk: gameVersion !== null,
  };

  let previous = null;
  if (existsSync(args.out)) {
    try {
      previous = JSON.parse(await readFile(args.out, "utf-8"));
    } catch {
      /* fichier illisible ou absent : on régénère intégralement */
    }
  }

  // Filet de sécurité UEX : contrairement aux sources auxiliaires (drapeaux
  // meta), un roster effondré ne se reflète nulle part. Plutôt que de publier
  // un data.json quasi vide, on laisse le fichier précédent en place et on
  // sort en échec — l'Action marque le run en erreur (donc notification) et
  // n'ayant pas réussi, l'étape de commit est sautée. --force pour passer
  // outre si la baisse est légitime.
  const health = rosterHealth(ships, previous);
  if (!health.ok && !args.force) {
    log(`ERREUR: ${health.reason}.`);
    log(`${args.out} n'est PAS réécrit : les données précédentes sont préservées.`);
    log("Si cette baisse est légitime, relancer avec --force pour écraser malgré tout.");
    process.exitCode = 1;
    return;
  }

  const metaRest = { ...flags, gameVersion };
  const generatedAt = resolveGeneratedAt(previous, ships, metaRest, new Date().toISOString());
  const meta = { generatedAt, ...metaRest };

  await writeFile(args.out, JSON.stringify({ meta, ships }, null, 2), "utf-8");

  const nAv = ships.filter((s) => s.available && !s.packageOnly).length;
  const nPk = ships.filter((s) => s.packageOnly).length;
  const nPkConcierge = ships.filter((s) => s.packageOnly && s.packConcierge).length;
  const nRatio = ships.filter((s) => s.ratio !== null).length;
  const nConcept = ships.filter((s) => s.concept).length;
  const nPhoto = ships.filter((s) => s.imageUrl).length;
  const nDesc = ships.filter((s) => s.description).length;
  log(
    `${args.out} généré : ${ships.length} vaisseaux — ${nAv} achetables standalone, ` +
      `${nPk} en pack uniquement (dont ${nPkConcierge} Concierge), ` +
      `${nRatio} avec ratio calculable, ${nConcept} en concept, ` +
      `${nPhoto} avec photo, ${nDesc} avec description` +
      `${gameVersion ? `, patch SC ${gameVersion}` : ", patch SC inconnu"}.`,
  );
}

// Ne lance le pipeline que lorsque le fichier est exécuté directement
// (node scripts/update-data.mjs). Importé depuis les tests, il n'expose que
// ses fonctions pures, sans déclencher le moindre appel réseau.
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((exc) => {
    console.error(exc);
    process.exit(1);
  });
}
