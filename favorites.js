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

    function normalizeMoveResult(rawResult) {
      if (rawResult === true) return { ok: true };
      if (rawResult === false) {
        return { ok: false, reason: 'adapter_returned_false', id: favorite.id };
      }
      if (isObject(rawResult)) {
        return Object.assign({ id: favorite.id }, rawResult);
      }
      return { ok: false, reason: 'adapter_invalid_result', id: favorite.id };
    }

    var adapterResult;
    try {
      adapterResult = moveToCartAdapter(cloneFavorite(favorite), {
        context: isObject(context) ? context : {},
        api: publicApi,
        buildCartItem: function buildCartItem(overrides) {
          return buildCartItemFromFavorite(favorite, overrides);
        }
      });
    } catch (error) {
      return Promise.resolve({
        ok: false,
        reason: 'adapter_error',
        id: favorite.id,
        error: toText(error && error.message)
      });
    }

    return Promise.resolve(adapterResult)
      .then(function onAdapterResult(rawResult) {
        var normalized = normalizeMoveResult(rawResult);
        if (!normalized.ok) {
          return normalized;
        }
        var removed = removeFavorite(favorite.id);
        return Object.assign({}, normalized, {
          id: favorite.id,
          moved: true,
          removed: removed
        });
      })
      .catch(function onAdapterFailure(error) {
        return {
          ok: false,
          reason: 'adapter_error',
          id: favorite.id,
          error: toText(error && error.message)
        };
      });
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

(function initFavoritesUi(global) {
  'use strict';

  if (!global || !global.document) return;
  if (global.__ldcFavoritesUiInit) return;

  var api = global.ldcFavorites;
  if (!api || !api.__sharedStore) return;

  global.__ldcFavoritesUiInit = true;

  var document = global.document;
  var UI_STYLE_ID = 'ldc-favorites-ui-style';
  var TAB_OPEN_CLASS = 'favorites-open';
  var activeFocus = null;
  var ui = {
    drawer: null,
    overlay: null,
    panel: null,
    closeButton: null,
    itemsContainer: null,
    cta: null
  };

  function toText(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim();
  }

  function escapeHtml(value) {
    return toText(value).replace(/[&<>"']/g, function mapChar(char) {
      switch (char) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        case '\'': return '&#39;';
        default: return char;
      }
    });
  }

  function parsePrice(raw) {
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    var text = toText(raw).replace(/[^0-9.-]/g, '');
    if (!text) return 0;
    var parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatPrice(value, currencyCode) {
    var amount = parsePrice(value);
    var currency = toText(currencyCode).toUpperCase() || 'USD';
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency
      }).format(amount);
    } catch (error) {
      return '$' + amount.toFixed(2);
    }
  }

  function normalizeRoute(rawUrl) {
    var text = toText(rawUrl);
    if (!text) return '';
    try {
      var parsed = new URL(text, global.location ? global.location.origin : undefined);
      return parsed.pathname + parsed.search + parsed.hash;
    } catch (error) {
      return text;
    }
  }

  function cleanLabel(value) {
    return toText(value)
      .replace(/^\s*view\s+/i, '')
      .replace(/\s+(swatch|option|accent)\s*$/i, '')
      .trim();
  }

  function extractImageUrlFromStyle(styleValue) {
    var style = toText(styleValue);
    if (!style) return '';
    var match = style.match(/url\(["']?(.*?)["']?\)/i);
    return match ? match[1] : '';
  }

  function ensureStyles() {
    if (document.getElementById(UI_STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = UI_STYLE_ID;
    style.textContent = [
      '.ldc-favorites-drawer{position:fixed;inset:0;z-index:1300;pointer-events:none;}',
      '.ldc-favorites-drawer.is-open{pointer-events:auto;}',
      '.ldc-favorites-overlay{position:absolute;inset:0;background:rgba(15,23,42,.48);opacity:0;transition:opacity 180ms ease;}',
      '.ldc-favorites-drawer.is-open .ldc-favorites-overlay{opacity:1;}',
      '.ldc-favorites-panel{position:absolute;top:0;right:0;width:min(26rem,92vw);height:100%;background:#fff;color:#111827;box-shadow:-20px 0 40px rgba(15,23,42,.22);display:flex;flex-direction:column;transform:translateX(108%);transition:transform 200ms ease;}',
      '.ldc-favorites-drawer.is-open .ldc-favorites-panel{transform:translateX(0);} ',
      '.ldc-favorites-header{display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding:1rem 1rem .75rem;border-bottom:1px solid rgba(15,23,42,.12);}',
      '.ldc-favorites-title{margin:0;font-size:1rem;letter-spacing:.08em;text-transform:uppercase;}',
      '.ldc-favorites-close{border:0;background:transparent;font-size:1.45rem;line-height:1;padding:.15rem .35rem;border-radius:.5rem;color:#111827;cursor:pointer;}',
      '.ldc-favorites-close:focus-visible{outline:2px solid #7c3aed;outline-offset:2px;}',
      '.ldc-favorites-body{flex:1 1 auto;overflow:auto;padding:.85rem;display:grid;gap:.75rem;align-content:start;}',
      '.ldc-favorites-empty{padding:1rem;border:1px dashed rgba(15,23,42,.24);border-radius:.85rem;text-align:center;color:#475569;background:#f8fafc;}',
      '.ldc-favorites-item{position:relative;border:1px solid rgba(15,23,42,.1);border-radius:.85rem;padding:.75rem .75rem 3rem;background:#fff;box-shadow:0 8px 20px rgba(15,23,42,.06);}',
      '.ldc-favorites-item-main{display:flex;align-items:flex-start;gap:.7rem;}',
      '.ldc-favorites-item-preview{width:3.25rem;height:3.25rem;border-radius:.7rem;overflow:hidden;flex:0 0 auto;background:#eef2ff;display:flex;align-items:center;justify-content:center;}',
      '.ldc-favorites-item-preview img{width:100%;height:100%;object-fit:cover;display:block;}',
      '.ldc-favorites-item-info{min-width:0;display:grid;gap:.2rem;}',
      '.ldc-favorites-item-title{font-size:.9rem;font-weight:700;line-height:1.3;color:#111827;word-break:break-word;}',
      '.ldc-favorites-item-variant{font-size:.73rem;color:#334155;line-height:1.3;}',
      '.ldc-favorites-item-description{font-size:.73rem;color:#64748b;line-height:1.3;}',
      '.ldc-favorites-item-price{font-size:.8rem;font-weight:700;color:#111827;letter-spacing:.04em;}',
      '.ldc-favorites-item-actions{position:absolute;right:.7rem;bottom:.7rem;display:flex;align-items:center;gap:.45rem;}',
      '.ldc-favorites-icon-btn{border:1px solid rgba(15,23,42,.18);background:#fff;border-radius:999px;width:2rem;height:2rem;display:inline-flex;align-items:center;justify-content:center;color:#111827;cursor:pointer;}',
      '.ldc-favorites-icon-btn:hover{background:#f8fafc;}',
      '.ldc-favorites-icon-btn:focus-visible{outline:2px solid #7c3aed;outline-offset:2px;}',
      '.ldc-favorites-icon-btn[data-favorite-add-cart]{background:#111827;border-color:#111827;color:#fff;}',
      '.ldc-favorites-icon-btn[data-favorite-add-cart]:hover{background:#1f2937;}',
      '.ldc-favorites-footer{padding:.75rem 1rem 1rem;border-top:1px solid rgba(15,23,42,.12);}',
      '.ldc-favorites-cta{display:inline-flex;align-items:center;justify-content:center;width:100%;text-decoration:none;padding:.8rem 1rem;border-radius:.75rem;background:#111827;color:#fff;letter-spacing:.08em;text-transform:uppercase;font-size:.76rem;font-weight:700;}',
      '.tile-action-favorite.is-active{background:rgba(244,114,182,.18)!important;color:#e11d48!important;border-color:rgba(225,29,72,.45)!important;}'
    ].join('');
    document.head.appendChild(style);
  }

  function createDrawerElement() {
    var drawer = document.createElement('div');
    drawer.setAttribute('data-favorites-drawer', '');
    document.body.appendChild(drawer);
    return drawer;
  }

  function ensureDrawerStructure() {
    var drawer = document.querySelector('[data-favorites-drawer]');
    if (!drawer) {
      drawer = createDrawerElement();
    }
    drawer.classList.add('favorites-drawer', 'ldc-favorites-drawer');
    if (drawer.getAttribute('data-favorites-managed') !== 'shared-ready') {
      drawer.innerHTML = [
        '<div class="favorites-overlay ldc-favorites-overlay" data-favorites-overlay></div>',
        '<aside class="favorites-panel ldc-favorites-panel" data-favorites-panel role="dialog" aria-modal="true" aria-label="Favorites drawer" aria-hidden="true" tabindex="-1">',
        '  <header class="favorites-header ldc-favorites-header">',
        '    <h2 class="favorites-title ldc-favorites-title">Your Favorites</h2>',
        '    <button type="button" class="favorites-close-btn ldc-favorites-close" data-favorites-close aria-label="Close favorites">×</button>',
        '  </header>',
        '  <div class="favorites-body ldc-favorites-body" data-favorites-items aria-live="polite"></div>',
        '  <footer class="favorites-footer ldc-favorites-footer">',
        '    <a class="favorites-btn ldc-favorites-cta" data-favorites-cta href="favorites.html">Favorites</a>',
        '  </footer>',
        '</aside>'
      ].join('');
      drawer.setAttribute('data-favorites-managed', 'shared-ready');
    }

    ui.drawer = drawer;
    ui.overlay = drawer.querySelector('[data-favorites-overlay]');
    ui.panel = drawer.querySelector('[data-favorites-panel]');
    ui.closeButton = drawer.querySelector('[data-favorites-close]');
    ui.itemsContainer = drawer.querySelector('[data-favorites-items]');
    ui.cta = drawer.querySelector('[data-favorites-cta]');
  }

  function getOpeners() {
    return Array.prototype.slice.call(document.querySelectorAll('[data-favorites-open]'));
  }

  function getBadges() {
    return Array.prototype.slice.call(document.querySelectorAll('[data-favorites-count]'));
  }

  function getCardElement(node) {
    if (!node || typeof node.closest !== 'function') return null;
    return node.closest('.product-card, .arrival-card, .group, article, [data-product-handle], [data-product-id]');
  }

  function readTextFromCard(card, selectors) {
    for (var i = 0; i < selectors.length; i += 1) {
      var el = card.querySelector(selectors[i]);
      var text = toText(el && el.textContent);
      if (text) return text;
    }
    return '';
  }

  function readImageFromCard(card) {
    var image = card.querySelector('[data-product-image], img');
    if (!image) return '';
    return toText(image.getAttribute('src') || image.currentSrc);
  }

  function readProductLink(card) {
    var link = card.querySelector('[data-product-link], a.tile-title, a.product-title, a.arrival-title, a[href*=".html"]');
    if (!link) return '';
    return normalizeRoute(link.getAttribute('href'));
  }

  function readSelectedOptions(card) {
    var options = [];
    var seen = {};

    var pushOption = function pushOption(rawLabel, rawValue, rawStyle, rawGlyph) {
      var value = cleanLabel(rawValue);
      if (!value) return;
      var label = cleanLabel(rawLabel) || 'Option';
      var key = (label + '|' + value).toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      options.push({
        label: label,
        value: value,
        swatch_style: toText(rawStyle),
        swatch_glyph: toText(rawGlyph)
      });
    };

    var activeSwatches = card.querySelectorAll('.swatch.is-active');
    activeSwatches.forEach(function eachActive(swatch) {
      var swatchType = toText(swatch.dataset.swatchType).toLowerCase();
      var label = swatchType === 'accessory' ? 'Accessory' : 'Color';
      var value =
        swatch.dataset.variantLabel ||
        swatch.dataset.colorLabel ||
        swatch.dataset.accessoryLabel ||
        swatch.getAttribute('aria-label') ||
        swatch.getAttribute('title');
      pushOption(label, value, swatch.getAttribute('style'), swatch.textContent);
    });

    pushOption('Color', card.dataset.selectedColorLabel || card.dataset.selectedColor, card.dataset.selectedColorStyle, card.dataset.selectedColorGlyph);
    pushOption('Accessory', card.dataset.selectedAccessoryLabel || card.dataset.selectedAccessory, card.dataset.selectedAccessoryStyle, card.dataset.selectedAccessoryGlyph);
    pushOption('Wrap', card.dataset.selectedWrap, '', '');
    pushOption('Notes', card.dataset.selectedNotes, '', '');

    return options;
  }

  function readPriceFromCard(card) {
    var text = readTextFromCard(card, [
      '[data-product-price]',
      '.product-price',
      '.arrival-price',
      '.tile-price',
      '.favorite-meta'
    ]);
    return parsePrice(text);
  }

  function readVariantId(card) {
    var addButton = card.querySelector('[data-add-to-cart]');
    return toText(
      card.dataset.selectedVariantId ||
      card.dataset.variantId ||
      (addButton && (addButton.dataset.selectedVariantId || addButton.dataset.variantId)) ||
      ''
    );
  }

  function toProductHandle(card, productUrl) {
    var fromDataset = toText(card.dataset.productHandle || card.dataset.productKey);
    if (fromDataset) return fromDataset;
    var route = toText(productUrl || '');
    if (!route) return '';
    var parts = route.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1].replace(/\.html?$/i, '') : '';
  }

  function buildFavoritePayloadFromButton(button) {
    var card = getCardElement(button);
    if (!card) return null;

    var title = readTextFromCard(card, [
      '[data-product-title]',
      '.tile-title',
      '.product-title',
      '.arrival-title',
      'h3',
      'h2'
    ]) || 'Favorite';
    var shortDescription = readTextFromCard(card, [
      '[data-product-description]',
      '.product-description',
      '.arrival-meta',
      '.tile-description',
      '.product-details'
    ]);
    var price = readPriceFromCard(card);
    var productUrl = readProductLink(card);
    var imageUrl = readImageFromCard(card);
    var options = readSelectedOptions(card);
    var variantId = readVariantId(card);

    return {
      product_id: toText(card.dataset.productId),
      product_handle: toProductHandle(card, productUrl),
      product_url: productUrl,
      variant_id: variantId,
      title: title,
      variant_title: toText(options.map(function mapOption(opt) { return opt.value; }).filter(Boolean).join(' | ')),
      short_description: shortDescription,
      description: shortDescription,
      price: price,
      currency_code: 'USD',
      preview_image: imageUrl,
      image_url: imageUrl,
      preview_style: '',
      selected_options: options,
      source_path: toText(global.location && global.location.pathname) || '/'
    };
  }

  function setHeartState(button, isActive) {
    if (!button) return;
    button.classList.toggle('is-active', Boolean(isActive));
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    button.setAttribute('aria-label', isActive ? 'Remove from favorites' : 'Add to favorites');
  }

  function syncHeartButtons() {
    var buttons = Array.prototype.slice.call(document.querySelectorAll('.tile-action-favorite'));
    buttons.forEach(function eachButton(button) {
      var payload = buildFavoritePayloadFromButton(button);
      if (!payload) {
        setHeartState(button, false);
        return;
      }
      var normalized = api.normalizeFavoriteItem(payload, { source_path: payload.source_path });
      var favoriteId = toText(normalized.id || normalized.favorite_key);
      if (favoriteId) {
        button.dataset.favoriteId = favoriteId;
      }
      setHeartState(button, favoriteId ? api.hasFavorite(favoriteId) : false);
    });
  }

  function updateBadgesAndOpeners() {
    var count = api.getFavorites().length;
    getBadges().forEach(function eachBadge(badge) {
      if (!badge) return;
      if (count > 0) {
        badge.textContent = String(count);
        badge.hidden = false;
        badge.removeAttribute('hidden');
      } else {
        badge.textContent = '';
        badge.hidden = true;
        badge.setAttribute('hidden', '');
      }
    });

    var hasFavorites = count > 0;
    getOpeners().forEach(function eachOpener(opener) {
      opener.classList.toggle('favorites-active', hasFavorites);
      opener.setAttribute('aria-pressed', hasFavorites ? 'true' : 'false');
      opener.setAttribute('aria-expanded', ui.drawer && ui.drawer.classList.contains('is-open') ? 'true' : 'false');
    });
  }

  function renderOptionsSummary(item) {
    if (toText(item.options_summary)) return toText(item.options_summary);
    if (!Array.isArray(item.selected_options)) return '';
    return item.selected_options
      .map(function mapOption(opt) {
        var label = cleanLabel(opt && opt.label);
        var value = cleanLabel(opt && opt.value);
        if (!value) return '';
        return label ? label + ': ' + value : value;
      })
      .filter(Boolean)
      .join(' | ');
  }

  function getPreviewForItem(item) {
    var image = toText(item.preview_image || item.image_url);
    var style = toText(item.preview_style);
    if (!image && style) {
      image = extractImageUrlFromStyle(style);
    }
    return image;
  }

  function renderDrawerItems() {
    if (!ui.itemsContainer) return;
    var items = api.getFavorites();
    if (!items.length) {
      ui.itemsContainer.innerHTML = '<div class="favorites-empty ldc-favorites-empty">No favorites yet.</div>';
      return;
    }

    var markup = items.map(function mapItem(item) {
      var id = escapeHtml(item.id);
      var title = escapeHtml(item.title || 'Favorite');
      var variantInfo = escapeHtml(renderOptionsSummary(item) || item.variant_title || '');
      var description = escapeHtml(item.short_description || item.description || '');
      var price = escapeHtml(formatPrice(item.price, item.currency_code));
      var image = getPreviewForItem(item);
      var imageHtml = image
        ? '<img src="' + escapeHtml(image) + '" alt="' + title + '" loading="lazy" />'
        : '';
      var productUrl = toText(item.product_url);
      var titleContent = productUrl
        ? '<a class="ldc-favorites-item-title" href="' + escapeHtml(productUrl) + '">' + title + '</a>'
        : '<div class="ldc-favorites-item-title">' + title + '</div>';
      return [
        '<article class="favorites-item ldc-favorites-item" data-favorite-id="', id, '">',
        '  <div class="favorites-item-main ldc-favorites-item-main">',
        '    <div class="favorites-item-preview ldc-favorites-item-preview">', imageHtml, '</div>',
        '    <div class="favorites-item-info ldc-favorites-item-info">',
        '      ', titleContent,
        variantInfo ? '      <div class="ldc-favorites-item-variant">' + variantInfo + '</div>' : '',
        description ? '      <div class="ldc-favorites-item-description">' + description + '</div>' : '',
        '      <div class="favorites-item-price ldc-favorites-item-price">', price, '</div>',
        '    </div>',
        '  </div>',
        '  <div class="favorites-actions ldc-favorites-item-actions">',
        '    <button type="button" class="favorites-remove-btn ldc-favorites-icon-btn" data-favorite-remove aria-label="Remove ', title, '">×</button>',
        '    <button type="button" class="favorites-add-cart ldc-favorites-icon-btn" data-favorite-add-cart aria-label="Add ', title, ' to cart">',
        '      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h2l1 7h12l1-4H6" /><circle cx="9" cy="19" r="1.25" /><circle cx="17" cy="19" r="1.25" /></svg>',
        '    </button>',
        '  </div>',
        '</article>'
      ].join('');
    }).join('');

    ui.itemsContainer.innerHTML = markup;
  }

  function openDrawer(trigger) {
    ensureDrawerStructure();
    if (!ui.drawer || !ui.panel) return;
    activeFocus = trigger || document.activeElement || null;
    ui.drawer.classList.add('is-open');
    document.body.classList.add(TAB_OPEN_CLASS);
    ui.panel.setAttribute('aria-hidden', 'false');
    updateBadgesAndOpeners();
    global.requestAnimationFrame(function focusClose() {
      if (ui.closeButton && typeof ui.closeButton.focus === 'function') {
        ui.closeButton.focus({ preventScroll: true });
      } else if (ui.panel && typeof ui.panel.focus === 'function') {
        ui.panel.focus({ preventScroll: true });
      }
    });
  }

  function closeDrawer() {
    if (!ui.drawer || !ui.panel) return;
    ui.drawer.classList.remove('is-open');
    document.body.classList.remove(TAB_OPEN_CLASS);
    ui.panel.setAttribute('aria-hidden', 'true');
    updateBadgesAndOpeners();
    if (activeFocus && typeof activeFocus.focus === 'function') {
      activeFocus.focus({ preventScroll: true });
    }
    activeFocus = null;
  }

  function tryResolveVariantId(button, payload) {
    var favorite = payload || {};
    if (toText(favorite.variant_id)) return Promise.resolve(favorite);
    var card = getCardElement(button);
    if (!card) return Promise.resolve(favorite);
    var addButton = card.querySelector('[data-add-to-cart]');
    var commerce = global.LDCCommerce;
    if (!addButton || !commerce || typeof commerce.resolveVariantId !== 'function') {
      return Promise.resolve(favorite);
    }
    return Promise.resolve(commerce.resolveVariantId(addButton))
      .then(function onResolved(variantId) {
        if (toText(variantId)) {
          favorite.variant_id = toText(variantId);
          card.dataset.selectedVariantId = toText(variantId);
        }
        return favorite;
      })
      .catch(function onError() {
        return favorite;
      });
  }

  function resolveVariantIdForMove(favorite) {
    var direct = toText(
      favorite && (
        favorite.variant_id ||
        favorite.variantId ||
        favorite.selected_variant_id ||
        favorite.selectedVariantId
      )
    );
    if (direct) return Promise.resolve(direct);

    var commerce = global.LDCCommerce;
    if (!commerce || typeof commerce.resolveVariantIdForFavorite !== 'function') {
      return Promise.resolve('');
    }

    return Promise.resolve(commerce.resolveVariantIdForFavorite(favorite))
      .then(function onResolved(variantId) {
        return toText(variantId);
      })
      .catch(function onError() {
        return '';
      });
  }

  function defaultMoveToCartAdapter(favorite, payload) {
    var buildCartItem = payload && typeof payload.buildCartItem === 'function'
      ? payload.buildCartItem
      : function identity(overrides) { return Object.assign({}, favorite, overrides || {}); };
    var commerce = global.LDCCommerce;
    if (commerce && commerce.enabled) {
      if (typeof commerce.addLineItem !== 'function') {
        return {
          ok: false,
          reason: 'commerce_add_unavailable',
          user_message: 'Cart service is unavailable on this page.',
          id: favorite.id
        };
      }

      return resolveVariantIdForMove(favorite).then(function onVariantResolved(variantId) {
        if (!variantId) {
          return {
            ok: false,
            reason: 'missing_variant_id',
            user_message: 'Select this product again before moving it to cart.',
            id: favorite.id
          };
        }

        favorite.variant_id = variantId;
        var cartItem = buildCartItem({
          id: variantId,
          variant_id: variantId,
          product_id: favorite.product_id || '',
          product_handle: favorite.product_handle || '',
          product_url: favorite.product_url || '',
          image: favorite.preview_image || favorite.image_url || '',
          previewStyle: favorite.preview_style || ''
        });

        return Promise.resolve(commerce.addLineItem(variantId, 1))
          .then(function onAdded() {
            var syncPromise = typeof commerce.syncBadges === 'function'
              ? Promise.resolve(commerce.syncBadges())
              : Promise.resolve();
            return syncPromise.then(function afterSync() {
              if (global.ldcCart && typeof global.ldcCart.open === 'function') {
                global.ldcCart.open();
              }
              return { ok: true, mode: 'medusa', variant_id: variantId, cart_item: cartItem };
            });
          })
          .catch(function onFailure(error) {
            return {
              ok: false,
              reason: 'medusa_add_failed',
              user_message: 'Unable to move this favorite to cart right now.',
              error: toText(error && error.message),
              id: favorite.id
            };
          });
      });
    }

    var cartItem = buildCartItem({
      id: favorite.variant_id || favorite.id,
      variant_id: favorite.variant_id || '',
      product_id: favorite.product_id || '',
      product_handle: favorite.product_handle || '',
      product_url: favorite.product_url || '',
      image: favorite.preview_image || favorite.image_url || '',
      previewStyle: favorite.preview_style || ''
    });

    if (global.ldcCart && typeof global.ldcCart.addProduct === 'function') {
      global.ldcCart.addProduct(cartItem);
      if (typeof global.ldcCart.open === 'function') {
        global.ldcCart.open();
      }
      return { ok: true, mode: 'ldcCart', cart_item: cartItem };
    }

    return {
      ok: false,
      reason: 'no_cart_bridge',
      user_message: 'Cart bridge is unavailable on this page.',
      id: favorite.id
    };
  }

  function getFavoriteIdFromControl(control) {
    if (!control) return '';
    var direct =
      toText(control.getAttribute('data-favorite-id')) ||
      toText(control.getAttribute('data-favorite-item')) ||
      toText(control.getAttribute('data-fav-add-cart')) ||
      toText(control.getAttribute('data-fav-remove'));
    if (direct) return direct;
    var row = control.closest('[data-favorite-id], [data-favorite-item]');
    if (!row) return '';
    return (
      toText(row.getAttribute('data-favorite-id')) ||
      toText(row.getAttribute('data-favorite-item'))
    );
  }

  function handleMoveToCart(id) {
    if (!id) return;
    Promise.resolve(api.moveFavoriteToCart(id, { source: 'favorites-drawer' }))
      .then(function onResult(result) {
        if (!result || !result.ok) {
          console.warn('[favorites] move-to-cart failed', {
            favorite_id: id,
            reason: result && result.reason,
            error: result && result.error
          });
        }
        try {
          document.dispatchEvent(new CustomEvent('ldc:favorites:move-to-cart', {
            detail: {
              favorite_id: id,
              result: result || {}
            }
          }));
        } catch (error) {
          // Keep non-blocking.
        }
      });
  }

  function syncUi() {
    ensureStyles();
    ensureDrawerStructure();
    renderDrawerItems();
    syncHeartButtons();
    updateBadgesAndOpeners();
  }

  function onDocumentClickCapture(event) {
    var opener = event.target && event.target.closest('[data-favorites-open]');
    if (opener) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openDrawer(opener);
      return;
    }

    var closeButton = event.target && event.target.closest('[data-favorites-close]');
    if (closeButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeDrawer();
      return;
    }

    var overlay = event.target && event.target.closest('[data-favorites-overlay]');
    if (overlay) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeDrawer();
      return;
    }

    var removeButton = event.target && event.target.closest('[data-favorite-remove], [data-fav-remove]');
    if (removeButton) {
      var removeId = getFavoriteIdFromControl(removeButton);
      event.preventDefault();
      event.stopImmediatePropagation();
      if (removeId) {
        api.removeFavorite(removeId);
      }
      return;
    }

    var cartButton = event.target && event.target.closest('[data-favorite-add-cart], [data-fav-add-cart]');
    if (cartButton) {
      var cartId = getFavoriteIdFromControl(cartButton);
      event.preventDefault();
      event.stopImmediatePropagation();
      if (cartId) {
        handleMoveToCart(cartId);
      }
      return;
    }

    var heartButton = event.target && event.target.closest('.tile-action-favorite');
    if (!heartButton) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (heartButton.dataset.favoriteBusy === 'true') return;
    heartButton.dataset.favoriteBusy = 'true';

    var payload = buildFavoritePayloadFromButton(heartButton);
    if (!payload) {
      heartButton.dataset.favoriteBusy = 'false';
      return;
    }

    Promise.resolve(tryResolveVariantId(heartButton, payload))
      .then(function afterVariant(resolvedPayload) {
        var result = api.toggleFavorite(resolvedPayload, {
          source_path: toText(global.location && global.location.pathname) || '/'
        });
        if (result && result.action === 'added') {
          openDrawer(heartButton);
        }
      })
      .finally(function cleanup() {
        heartButton.dataset.favoriteBusy = 'false';
        syncHeartButtons();
      });
  }

  function onDocumentKeydown(event) {
    if (event.key !== 'Escape') return;
    if (!ui.drawer || !ui.drawer.classList.contains('is-open')) return;
    event.preventDefault();
    closeDrawer();
  }

  function attachListeners() {
    api.setMoveToCartAdapter(defaultMoveToCartAdapter);
    api.subscribe(function onFavoritesChange() {
      syncUi();
    });
    document.addEventListener('click', onDocumentClickCapture, true);
    document.addEventListener('keydown', onDocumentKeydown);
    global.addEventListener('ldc:products:rendered', function onProductsRendered() {
      global.requestAnimationFrame(syncHeartButtons);
    });
    global.addEventListener('load', syncHeartButtons);
  }

  syncUi();
  attachListeners();

  global.ldcFavoritesUI = {
    openDrawer: openDrawer,
    closeDrawer: closeDrawer,
    sync: syncUi
  };
})(window);
