/*
 * Shared favorites store for the static storefront.
 *
 * Exposes: window.ldcFavorites
 * Storage key: ldc:favorites
 *
 * Core API:
 * - getFavorites(), getFavoriteById(id), hasFavorite(id)
 * - addFavorite(item), removeFavorite(id), toggleFavorite(item), clearFavorites()
 * - subscribe(listener), unsubscribe(listener)
 * - setMoveToCartAdapter(fn), moveFavoriteToCart(id, context)
 */
(function initFavoritesStore(global) {
  'use strict';

  if (!global || !global.document) {
    return;
  }

  var STORE_VERSION = 2;
  var STORAGE_KEY = 'ldc:favorites';
  var CHANGE_EVENT = 'ldc:favorites:change';
  var LEGACY_KEYS = ['ldc:favorites'];

  var listeners = new Set();
  var moveToCartAdapter = null;
  var storage = null;
  var state = {
    version: STORE_VERSION,
    storage_key: STORAGE_KEY,
    updated_at: isoNow(),
    items: []
  };

  function isoNow() {
    return new Date().toISOString();
  }

  function hasStorage() {
    try {
      if (!global.localStorage) return false;
      var probe = '__ldc_favorites_store_probe__';
      global.localStorage.setItem(probe, '1');
      global.localStorage.removeItem(probe);
      return true;
    } catch (error) {
      return false;
    }
  }

  function getStorage() {
    if (storage) return storage;
    if (!hasStorage()) return null;
    storage = global.localStorage;
    return storage;
  }

  function isObject(value) {
    return !!value && Object.prototype.toString.call(value) === '[object Object]';
  }

  function toText(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim();
  }

  function toLowerSlug(value) {
    return toText(value)
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9._:/|-]/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^[-|]+|[-|]+$/g, '');
  }

  function toNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    var normalized = toText(value).replace(/[^0-9.-]/g, '');
    if (!normalized) return 0;
    var parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function toCurrencyCode(value) {
    var code = toText(value).toUpperCase();
    return code || 'USD';
  }

  function normalizeUrl(value) {
    var raw = toText(value);
    if (!raw) return '';
    try {
      var parsed = new URL(raw, global.location ? global.location.origin : undefined);
      var path = toText(parsed.pathname);
      return path ? parsed.pathname + parsed.search + parsed.hash : parsed.toString();
    } catch (error) {
      return raw;
    }
  }

  function getCurrentPath() {
    try {
      return toText(global.location && global.location.pathname) || '/';
    } catch (error) {
      return '/';
    }
  }

  function normalizeOption(rawOption) {
    if (!rawOption) return null;

    if (typeof rawOption === 'string') {
      var simple = toText(rawOption);
      if (!simple) return null;
      return {
        label: 'Option',
        value: simple,
        swatch_style: '',
        swatch_glyph: ''
      };
    }

    if (!isObject(rawOption)) return null;

    var label =
      toText(rawOption.label) ||
      toText(rawOption.name) ||
      toText(rawOption.key) ||
      'Option';
    var value =
      toText(rawOption.value) ||
      toText(rawOption.title) ||
      toText(rawOption.selected) ||
      '';

    if (!label && !value) return null;

    return {
      label: label || 'Option',
      value: value,
      swatch_style: toText(rawOption.swatch_style || rawOption.swatchStyle),
      swatch_glyph: toText(rawOption.swatch_glyph || rawOption.swatchGlyph)
    };
  }

  function normalizeOptions(rawOptions) {
    var list = [];

    if (Array.isArray(rawOptions)) {
      rawOptions.forEach(function eachOption(entry) {
        var normalized = normalizeOption(entry);
        if (normalized) list.push(normalized);
      });
    } else if (isObject(rawOptions)) {
      Object.keys(rawOptions).forEach(function eachKey(key) {
        var value = rawOptions[key];
        var normalized = normalizeOption({ label: key, value: value });
        if (normalized) list.push(normalized);
      });
    }

    return list;
  }

  function optionsSummary(options) {
    if (!Array.isArray(options) || !options.length) return '';
    return options
      .map(function mapOption(option) {
        var label = toText(option.label);
        var value = toText(option.value);
        if (!label && !value) return '';
        return label ? label + ': ' + value : value;
      })
      .filter(Boolean)
      .join(' | ');
  }

  function buildProductRef(item) {
    var productId = toText(item.product_id);
    if (productId) return 'pid:' + toLowerSlug(productId);

    var productHandle = toText(item.product_handle);
    if (productHandle) return 'ph:' + toLowerSlug(productHandle);

    var productUrl = normalizeUrl(item.product_url);
    if (productUrl) return 'pu:' + toLowerSlug(productUrl);

    var title = toText(item.title);
    if (title) return 'pt:' + toLowerSlug(title);

    var previewImage = toText(item.preview_image || item.image_url);
    if (previewImage) return 'pi:' + toLowerSlug(previewImage);

    return 'unknown';
  }

  function buildVariantRef(item) {
    var variantId = toText(item.variant_id);
    if (variantId) return 'vid:' + toLowerSlug(variantId);

    var variantTitle = toText(item.variant_title);
    if (variantTitle) return 'vt:' + toLowerSlug(variantTitle);

    var optionsSig = optionsSummary(item.selected_options || []);
    if (optionsSig) return 'opt:' + toLowerSlug(optionsSig);

    return 'default';
  }

  function buildFavoriteKey(item) {
    var productRef = buildProductRef(item);
    var variantRef = buildVariantRef(item);
    return 'fav|' + productRef + '|' + variantRef;
  }

  function cloneOption(option) {
    return {
      label: option.label,
      value: option.value,
      swatch_style: option.swatch_style,
      swatch_glyph: option.swatch_glyph
    };
  }

  function cloneFavorite(item) {
    return {
      id: item.id,
      favorite_key: item.favorite_key,
      product_id: item.product_id,
      product_handle: item.product_handle,
      product_url: item.product_url,
      variant_id: item.variant_id,
      title: item.title,
      variant_title: item.variant_title,
      short_description: item.short_description,
      description: item.description,
      price: item.price,
      currency_code: item.currency_code,
      preview_image: item.preview_image,
      image_url: item.image_url,
      preview_style: item.preview_style,
      selected_options: (item.selected_options || []).map(cloneOption),
      options_summary: item.options_summary,
      source_path: item.source_path,
      added_at: item.added_at,
      updated_at: item.updated_at
    };
  }

  function normalizeFavoriteItem(rawItem, meta) {
    var source = isObject(rawItem) ? rawItem : { title: rawItem };
    var context = isObject(meta) ? meta : {};

    var selectedOptions = normalizeOptions(
      source.selected_options || source.selectedOptions || source.options || []
    );

    var canonical = {
      id: '',
      favorite_key: '',
      product_id: toText(source.product_id || source.productId || (source.product && source.product.id)),
      product_handle: toText(
        source.product_handle ||
          source.productHandle ||
          source.handle ||
          (source.product && source.product.handle)
      ),
      product_url: normalizeUrl(source.product_url || source.productUrl || source.url || source.href),
      variant_id: toText(
        source.variant_id ||
          source.variantId ||
          source.selected_variant_id ||
          source.selectedVariantId ||
          (source.variant && source.variant.id)
      ),
      title: toText(
        source.title || source.name || source.product_title || source.productTitle ||
        (source.product && source.product.title)
      ) || 'Favorite',
      variant_title: toText(
        source.variant_title ||
          source.variantTitle ||
          (source.variant && source.variant.title)
      ),
      short_description: toText(
        source.short_description || source.shortDescription || source.summary
      ),
      description: toText(source.description || source.desc || source.product_description),
      price: toNumber(source.price || source.unit_price || source.unitPrice || 0),
      currency_code: toCurrencyCode(source.currency_code || source.currencyCode || (source.currency && source.currency.code)),
      preview_image: toText(
        source.preview_image || source.previewImage || source.image_url || source.imageUrl || source.image || source.thumbnail
      ),
      image_url: '',
      preview_style: toText(source.preview_style || source.previewStyle),
      selected_options: selectedOptions,
      options_summary: '',
      source_path: toText(
        source.source_path || source.sourcePath || context.source_path || context.sourcePath || getCurrentPath()
      ) || '/',
      added_at: toText(source.added_at || source.addedAt || source.created_at || source.createdAt || source.updated_at || source.updatedAt),
      updated_at: isoNow()
    };

    if (!canonical.short_description) {
      canonical.short_description = toText(source.subtitle || source.meta || source.note);
    }
    if (!canonical.description) {
      canonical.description = canonical.short_description;
    }

    canonical.image_url = canonical.preview_image;
    canonical.options_summary = optionsSummary(canonical.selected_options);

    if (!canonical.added_at) {
      canonical.added_at = canonical.updated_at;
    }

    var explicitKey = toText(source.favorite_key || source.favoriteKey);
    var explicitId = toText(source.id);
    var stableKey = explicitKey || buildFavoriteKey(canonical);

    if (!stableKey && explicitId) {
      stableKey = toLowerSlug(explicitId);
    }
    if (!stableKey) {
      stableKey = buildFavoriteKey(canonical);
    }

    canonical.id = stableKey;
    canonical.favorite_key = stableKey;

    return canonical;
  }

  function mergeFavoriteRecords(current, incoming) {
    if (!current) return incoming;

    var merged = cloneFavorite(current);
    var fields = [
      'product_id',
      'product_handle',
      'product_url',
      'variant_id',
      'title',
      'variant_title',
      'short_description',
      'description',
      'currency_code',
      'preview_image',
      'image_url',
      'preview_style',
      'options_summary',
      'source_path',
      'added_at'
    ];

    fields.forEach(function eachField(field) {
      var nextValue = incoming[field];
      if (nextValue === null || nextValue === undefined) return;
      if (typeof nextValue === 'string' && !toText(nextValue)) return;
      merged[field] = nextValue;
    });

    if (Number.isFinite(incoming.price)) {
      merged.price = incoming.price;
    }

    if (Array.isArray(incoming.selected_options) && incoming.selected_options.length) {
      merged.selected_options = incoming.selected_options.map(cloneOption);
      merged.options_summary = optionsSummary(merged.selected_options);
    }

    merged.updated_at = incoming.updated_at || isoNow();
    if (!merged.added_at) {
      merged.added_at = merged.updated_at;
    }

    return merged;
  }

  function normalizeFavoritesPayload(rawPayload, meta) {
    var payload = rawPayload;
    if (!payload) {
      return {
        version: STORE_VERSION,
        storage_key: STORAGE_KEY,
        updated_at: isoNow(),
        items: []
      };
    }

    var rawItems = [];
    if (Array.isArray(payload)) {
      rawItems = payload;
    } else if (isObject(payload) && Array.isArray(payload.items)) {
      rawItems = payload.items;
    }

    var byId = new Map();
    rawItems.forEach(function eachRaw(rawItem) {
      var normalized = normalizeFavoriteItem(rawItem, meta);
      if (!normalized.id) return;
      var existing = byId.get(normalized.id);
      byId.set(normalized.id, mergeFavoriteRecords(existing, normalized));
    });

    return {
      version: STORE_VERSION,
      storage_key: STORAGE_KEY,
      updated_at: isoNow(),
      items: Array.from(byId.values())
    };
  }

  function migratePayload(rawPayload, meta) {
    return normalizeFavoritesPayload(rawPayload, meta);
  }

  function serializeState(nextState) {
    return JSON.stringify({
      version: STORE_VERSION,
      storage_key: STORAGE_KEY,
      updated_at: nextState.updated_at || isoNow(),
      items: (nextState.items || []).map(cloneFavorite)
    });
  }

  function readRawStorageValue(key) {
    var store = getStorage();
    if (!store) return null;
    try {
      return store.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function writeRawStorageValue(key, value) {
    var store = getStorage();
    if (!store) return false;
    try {
      store.setItem(key, value);
      return true;
    } catch (error) {
      return false;
    }
  }

  function loadStateFromStorage() {
    var store = getStorage();
    if (!store) {
      return normalizeFavoritesPayload({ items: [] });
    }

    var rawText = null;
    var rawKeyUsed = STORAGE_KEY;

    for (var i = 0; i < LEGACY_KEYS.length; i += 1) {
      var key = LEGACY_KEYS[i];
      rawText = readRawStorageValue(key);
      if (rawText) {
        rawKeyUsed = key;
        break;
      }
    }

    if (!rawText) {
      return normalizeFavoritesPayload({ items: [] });
    }

    var parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (error) {
      parsed = { items: [] };
    }

    var normalized = migratePayload(parsed, { source_path: getCurrentPath() });
    var normalizedText = serializeState(normalized);

    if (rawText !== normalizedText || rawKeyUsed !== STORAGE_KEY) {
      writeRawStorageValue(STORAGE_KEY, normalizedText);
      if (rawKeyUsed !== STORAGE_KEY) {
        try {
          store.removeItem(rawKeyUsed);
        } catch (error) {
          // Ignore cleanup failures.
        }
      }
    }

    return normalized;
  }

  function emitChange(reason, meta) {
    var detail = {
      reason: reason || 'update',
      meta: isObject(meta) ? meta : {},
      state: getSnapshot()
    };

    listeners.forEach(function eachListener(listener) {
      try {
        listener(detail);
      } catch (error) {
        // Keep listener failures isolated.
      }
    });

    try {
      global.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: detail }));
    } catch (error) {
      // Ignore event failures.
    }

    try {
      global.document.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: detail }));
    } catch (error) {
      // Ignore event failures.
    }
  }

  function persistState(reason, meta) {
    state.updated_at = isoNow();
    writeRawStorageValue(STORAGE_KEY, serializeState(state));
    emitChange(reason, meta);
  }

  function getSnapshot() {
    return {
      version: STORE_VERSION,
      storage_key: STORAGE_KEY,
      updated_at: state.updated_at,
      items: state.items.map(cloneFavorite)
    };
  }

  function getFavorites() {
    return getSnapshot().items;
  }

  function getFavoriteById(id) {
    var favoriteId = toText(id);
    if (!favoriteId) return null;
    var match = state.items.find(function findItem(item) {
      return item.id === favoriteId;
    });
    return match ? cloneFavorite(match) : null;
  }

  function hasFavorite(id) {
    var favoriteId = toText(id);
    if (!favoriteId) return false;
    return state.items.some(function hasItem(item) {
      return item.id === favoriteId;
    });
  }

  function upsertFavorite(rawItem, meta) {
    var normalized = normalizeFavoriteItem(rawItem, meta);
    if (!normalized.id) return null;

    var existingIndex = state.items.findIndex(function findIndex(item) {
      return item.id === normalized.id;
    });

    if (existingIndex >= 0) {
      var merged = mergeFavoriteRecords(state.items[existingIndex], normalized);
      state.items.splice(existingIndex, 1, merged);
      persistState('update', { id: merged.id });
      return cloneFavorite(merged);
    }

    state.items.push(normalized);
    persistState('add', { id: normalized.id });
    return cloneFavorite(normalized);
  }

  function removeFavorite(id) {
    var favoriteId = toText(id);
    if (!favoriteId) return false;
    var nextItems = state.items.filter(function filterItem(item) {
      return item.id !== favoriteId;
    });
    if (nextItems.length === state.items.length) return false;
    state.items = nextItems;
    persistState('remove', { id: favoriteId });
    return true;
  }

  function toggleFavorite(rawItem, meta) {
    var normalized = normalizeFavoriteItem(rawItem, meta);
    if (!normalized.id) return { action: 'noop', item: null };

    if (hasFavorite(normalized.id)) {
      removeFavorite(normalized.id);
      return { action: 'removed', item: null, id: normalized.id };
    }

    var added = upsertFavorite(normalized, meta);
    return { action: 'added', item: added, id: normalized.id };
  }

  function clearFavorites() {
    if (!state.items.length) return false;
    state.items = [];
    persistState('clear', {});
    return true;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') {
      return function noopUnsubscribe() {};
    }
    listeners.add(listener);
    return function unsubscribeFromListener() {
      listeners.delete(listener);
    };
  }

  function unsubscribe(listener) {
    return listeners.delete(listener);
  }

  function setMoveToCartAdapter(adapter) {
    if (adapter !== null && typeof adapter !== 'function') {
      return false;
    }
    moveToCartAdapter = adapter;
    return true;
  }

  function buildCartItemFromFavorite(favorite, overrides) {
    var source = favorite || {};
    var patch = isObject(overrides) ? overrides : {};
    var base = {
      id: source.id,
      name: source.title || 'Favorite',
      title: source.title || 'Favorite',
      price: Number(source.price || 0),
      quantity: 1,
      image: source.preview_image || source.image_url || '',
      previewStyle: source.preview_style || '',
      options: Array.isArray(source.selected_options)
        ? source.selected_options.map(cloneOption)
        : []
    };
    return Object.assign(base, patch);
  }

  function moveFavoriteToCart(id, context) {
    var favorite = getFavoriteById(id);
    if (!favorite) {
      return Promise.resolve({ ok: false, reason: 'favorite_not_found', id: toText(id) });
    }
    if (typeof moveToCartAdapter !== 'function') {
      return Promise.resolve({ ok: false, reason: 'adapter_not_set', id: favorite.id });
    }

    try {
      var adapterResult = moveToCartAdapter(cloneFavorite(favorite), {
        context: isObject(context) ? context : {},
        api: publicApi,
        buildCartItem: function buildCartItem(overrides) {
          return buildCartItemFromFavorite(favorite, overrides);
        }
      });
      return Promise.resolve(adapterResult);
    } catch (error) {
      return Promise.resolve({
        ok: false,
        reason: 'adapter_error',
        id: favorite.id,
        error: toText(error && error.message)
      });
    }
  }

  function handleStorageEvent(event) {
    if (!event || event.key !== STORAGE_KEY) return;
    var nextState = loadStateFromStorage();
    var prevSerialized = serializeState(state);
    var nextSerialized = serializeState(nextState);
    if (prevSerialized === nextSerialized) return;
    state = nextState;
    emitChange('storage_sync', { key: STORAGE_KEY });
  }

  state = loadStateFromStorage();

  if (typeof global.addEventListener === 'function') {
    global.addEventListener('storage', handleStorageEvent);
  }

  var publicApi = {
    __sharedStore: true,
    version: STORE_VERSION,
    storageKey: STORAGE_KEY,
    events: {
      change: CHANGE_EVENT
    },
    getSnapshot: getSnapshot,
    getFavorites: getFavorites,
    getFavoriteById: getFavoriteById,
    hasFavorite: hasFavorite,
    addFavorite: upsertFavorite,
    removeFavorite: removeFavorite,
    toggleFavorite: toggleFavorite,
    clearFavorites: clearFavorites,
    subscribe: subscribe,
    unsubscribe: unsubscribe,
    normalizeFavoriteItem: normalizeFavoriteItem,
    normalizeFavoritesPayload: normalizeFavoritesPayload,
    migrateFavoritesPayload: migratePayload,
    buildFavoriteKey: buildFavoriteKey,
    buildCartItemFromFavorite: buildCartItemFromFavorite,
    setMoveToCartAdapter: setMoveToCartAdapter,
    moveFavoriteToCart: moveFavoriteToCart,
    reloadFromStorage: function reloadFromStorage() {
      state = loadStateFromStorage();
      emitChange('reload', {});
      return getFavorites();
    }
  };

  global.ldcFavorites = publicApi;
})(window);
