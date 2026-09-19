// Document GraphQL du catalogue du pledge store, vendorisé.
//
// POURQUOI CE FICHIER EXISTE
//
// Le storefront RSI fonctionne en requêtes persistées (APQ) : le client
// envoie le SHA-256 d'un document, pas le document. Tant que le hash est
// dans le registre du serveur, la requête aboutit ; le jour où RSI l'en
// retire, elle échoue en `PersistedQueryNotFound` — ce qui est arrivé le
// 31/08/2026 et a fait échouer 19 exécutions planifiées d'affilée, sans
// qu'une ligne du dépôt ait bougé.
//
// Le protocole APQ prévoit exactement ce cas : on rejoue la requête avec le
// texte complet, et le serveur réenregistre le document. Encore faut-il
// posséder ce texte — d'où cette copie.
//
// PROVENANCE
//
// Extrait du manifeste de requêtes persistées embarqué dans le bundle client
// du store (plt-client), puis authentifié : son SHA-256 reproduit au bit près
// le hash que RSI attend. C'est cette propriété qui rend la copie fiable, et
// c'est elle que `update-data.mjs` exploite en dérivant le hash du document
// plutôt qu'en le stockant à côté — les deux ne peuvent plus diverger.
//
// NE PAS REFORMATER. Le moindre octet modifié change le hash, ce qui ferait
// échouer le chemin rapide à chaque appel : tout passerait par le renvoi,
// silencieusement et pour rien.
//
// Une même opération sert les deux catalogues (vaisseaux seuls et packs) :
// seuls le facet et le produit passés en variables les distinguent.

export const STOREFRONT_BROWSE_QUERY = `query GetBrowseSkusByFilter($query: SearchQuery, $storeFront: String = "pledge") {
  store(browse: true, name: $storeFront) {
    listing: search(query: $query) {
      resources {
        ...TyItemBrowseFragment
        __typename
      }
      count
      totalCount
      heapTagFiltersOptions {
        ...StoreListingHeapTagFiltersOptionsFragment
        __typename
      }
      __typename
    }
    __typename
  }
}

fragment ImageComposerFragment on ImageComposer {
  name
  slot
  url
  __typename
}

fragment StoreListingHeapTagFiltersOptionsFragment on HeapTagGroup {
  groupIdentifier
  facets {
    facet
    tagIdentifiers {
      identifier
      name
      __typename
    }
    __typename
  }
  __typename
}

fragment TyHeapTagFragment on HeapTag {
  name
  __typename
}

fragment TyItemBrowseFragment on TyItem {
  id
  slug
  name
  title
  subtitle
  url
  body
  excerpt
  type
  media {
    thumbnail {
      slideshow
      storeSmall
      __typename
    }
    list {
      slideshow
      __typename
    }
    __typename
  }
  nativePrice {
    amount
    discounted
    discountDescription
    __typename
  }
  price {
    amount
    discounted
    taxDescription
    discountDescription
    __typename
  }
  stock {
    ...TyStockFragment
    __typename
  }
  tags {
    ...TyHeapTagFragment
    __typename
  }
  ... on TySku {
    imageComposer {
      ...ImageComposerFragment
      __typename
    }
    ...TySkuBrowseFragment
    __typename
  }
  ... on TyProduct {
    imageComposer {
      ...ImageComposerFragment
      __typename
    }
    ...TyProductBrowseFragment
    __typename
  }
  __typename
}

fragment TyProductBrowseFragment on TyProduct {
  skus {
    id
    title
    isVip
    isDirectCheckout
    __typename
  }
  isVip
  __typename
}

fragment TySkuBrowseFragment on TySku {
  label
  customizable
  isWarbond
  isPackage
  isVip
  isDirectCheckout
  __typename
}

fragment TyStockFragment on TyStock {
  unlimited
  show
  available
  backOrder
  qty
  backOrderQty
  level
  __typename
}`;
