/*
 * Shared favorites store for the static storefront.
 *
 * Exposes: window.ldcFavorites
 * Guest session storage key: ldc:favorites:guest-session
 *
 * Supported migration path:
 * - historical guest favorites stored at ldc:favorites are cleared and no longer restored
 * - logged-in account favorites are sourced from the backend saved-items API
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
  var LEGACY_STORAGE_KEY = 'ldc:favorites';
  var STORAGE_KEY = 'ldc:favorites:guest-session';
  var CHANGE_EVENT = 'ldc:favorites:change';
  var AUTH_CHANGE_EVENT = 'ldc:auth:change';
  var ACCOUNT_FAVORITE_TYPE = 'product_favorite';
  var DOORMAT_BUILD_TYPE = 'doormat_build';
  var ATTIRE_BUILD_TYPE = 'attire_build';
  var CUSTOM_DESIGN_TYPE = 'custom_design';
  var SUPPORTED_ACCOUNT_SAVED_ITEM_TYPES = [ACCOUNT_FAVORITE_TYPE, DOORMAT_BUILD_TYPE, ATTIRE_BUILD_TYPE, CUSTOM_DESIGN_TYPE];
  var DEFAULT_MEDUSA_BACKEND = 'https://api.lovettsldc.com';
  var DEFAULT_MEDUSA_PUBLISHABLE_KEY = 'pk_427f7900e23e30a0e18feaf0604aa9caaa9d0cb21571889081d2cb93fb13ffb0';
  var LEGACY_KEYS = [LEGACY_STORAGE_KEY];

  var listeners = new Set();
  var moveToCartAdapter = null;
  var guestStorage = null;
  var legacyStorage = null;
  var accountMode = false;
  var accountLoaded = false;
  var accountLoadPromise = null;
  var accountRefreshVersion = 0;
  var state = {
    version: STORE_VERSION,
    storage_key: STORAGE_KEY,
    updated_at: isoNow(),
    items: []
  };

  function isoNow() {
    return new Date().toISOString();
  }

  function hasStorage(areaName) {
    try {
      var target = global && global[areaName];
      if (!target) return false;
      var probe = '__ldc_favorites_store_probe__';
      target.setItem(probe, '1');
      target.removeItem(probe);
      return true;
    } catch (error) {
      return false;
    }
  }

  function getGuestStorage() {
    if (guestStorage) return guestStorage;
    if (!hasStorage('sessionStorage')) return null;
    guestStorage = global.sessionStorage;
    return guestStorage;
  }

  function getLegacyStorage() {
    if (legacyStorage) return legacyStorage;
    if (!hasStorage('localStorage')) return null;
    legacyStorage = global.localStorage;
    return legacyStorage;
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

  function shortHash(value) {
    var text = toText(value);
    if (!text) return 'none';
    var hash = 0;
    for (var i = 0; i < text.length; i += 1) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
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

  function extractImageUrlFromStyle(styleValue) {
    var style = toText(styleValue);
    if (!style) return '';
    var match = style.match(/url\(["']?(.*?)["']?\)/i);
    return match ? toText(match[1]) : '';
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
        swatch_glyph: '',
        attachment_data: '',
        attachment_key: '',
        attachment_url: '',
        attachment_provider: '',
        attachment_content_type: '',
        attachment_size: '',
        layout: ''
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
      swatch_glyph: toText(rawOption.swatch_glyph || rawOption.swatchGlyph),
      attachment_data: toText(rawOption.attachment_data || rawOption.attachmentData),
      attachment_key: toText(rawOption.attachment_key || rawOption.attachmentKey),
      attachment_url: toText(rawOption.attachment_url || rawOption.attachmentUrl || rawOption.display_url || rawOption.displayUrl),
      attachment_provider: toText(rawOption.attachment_provider || rawOption.attachmentProvider || rawOption.provider),
      attachment_content_type: toText(rawOption.attachment_content_type || rawOption.attachmentContentType || rawOption.content_type || rawOption.contentType),
      attachment_size: toText(rawOption.attachment_size || rawOption.attachmentSize || rawOption.size),
      layout: toText(rawOption.layout)
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

  function normalizeLegacyId(value) {
    var text = toText(value);
    if (!text) return '';
    return 'legacy:' + toLowerSlug(text);
  }

  function hasCanonicalProductIdentity(item) {
    return Boolean(
      toText(item && item.product_id) ||
      toText(item && item.product_handle) ||
      toText(item && item.product_url)
    );
  }

  function hasCanonicalVariantIdentity(item) {
    return Boolean(
      toText(item && item.variant_id) ||
      toText(item && item.variant_title) ||
      (Array.isArray(item && item.selected_options) && item.selected_options.length) ||
      toText(item && item.options_summary)
    );
  }

  function buildLooseLegacySignature(item) {
    if (!item || typeof item !== 'object') return '';
    var parts = [];
    var title = toText(item.title);
    var variant = toText(item.options_summary || item.variant_title);
    var preview =
      toText(item.preview_image || item.image_url) ||
      extractImageUrlFromStyle(item.preview_style) ||
      toText(item.preview_style);
    var price = Number(item.price);

    if (title) parts.push(title);
    if (variant) parts.push(variant);
    if (Number.isFinite(price)) parts.push(String(price));
    if (preview) parts.push(preview);

    if (!parts.length) return '';
    return 'shape:' + toLowerSlug(parts.join('|'));
  }

  function collectFavoriteAliases(item, source) {
    var aliases = [];

    function push(value) {
      var text = toText(value);
      if (!text) return;
      if (aliases.indexOf(text) !== -1) return;
      aliases.push(text);
    }

    push(toText(source && (source.favorite_key || source.favoriteKey)));
    push(normalizeLegacyId(source && source.id));
    push(toText(source && (source.account_dedupe_key || source.accountDedupeKey || source.dedupe_key || source.dedupeKey)));
    push(toText(item && (item.account_dedupe_key || item.dedupe_key)));
    push(buildFavoriteKey(item));
    if (item && isAccountSyncableFavorite(item)) {
      push(buildSavedItemDedupeKey(item));
    }
    push(buildLooseLegacySignature(item));

    return aliases;
  }

  function hasAliasOverlap(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || !left.length || !right.length) {
      return false;
    }

    for (var i = 0; i < left.length; i += 1) {
      if (right.indexOf(left[i]) !== -1) return true;
    }

    return false;
  }

  function chooseStoredFavoriteId(item, source) {
    if (isCustomDesignFavoriteRecord(item)) {
      return buildFavoriteKey(item);
    }
    if (isAttireFavoriteRecord(item)) {
      return buildFavoriteKey(item);
    }

    var explicitKey = toText(source && (source.favorite_key || source.favoriteKey));
    if (explicitKey) return explicitKey;

    if (hasCanonicalProductIdentity(item) && hasCanonicalVariantIdentity(item)) {
      return buildFavoriteKey(item);
    }

    var explicitId = normalizeLegacyId(source && source.id);
    if (explicitId) return explicitId;

    if (hasCanonicalProductIdentity(item)) {
      return buildFavoriteKey(item);
    }

    return buildLooseLegacySignature(item) || buildFavoriteKey(item);
  }

  function scoreFavoriteIdentity(item, source) {
    var score = 0;
    if (toText(source && (source.favorite_key || source.favoriteKey))) score += 100;
    if (toText(item && item.product_id)) score += 40;
    if (toText(item && item.product_handle)) score += 30;
    if (toText(item && item.product_url)) score += 20;
    if (toText(item && item.variant_id)) score += 20;
    if (Array.isArray(item && item.selected_options) && item.selected_options.length) score += 15;
    if (toText(item && item.variant_title)) score += 10;
    if (toText(item && item.preview_image)) score += 5;
    if (toText(item && item.preview_style)) score += 3;
    return score;
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

  function buildAttireFavoriteUploadRef(item) {
    var uploadRef = getFavoriteUploadReference(item);
    if (uploadRef && uploadRef.key) return 'ref:' + shortHash(uploadRef.key);

    var attachmentOption = getFavoriteAttachmentOption(item);
    if (!attachmentOption) return 'none';

    var pendingRef = [
      stripAttachmentReferenceNote(attachmentOption.value),
      attachmentOption.attachment_content_type || attachmentOption.attachmentContentType,
      attachmentOption.attachment_size || attachmentOption.attachmentSize
    ].map(toText).filter(Boolean).join('|');

    return pendingRef ? 'pending:' + shortHash(pendingRef) : 'none';
  }

  function buildAttireFavoriteKey(item) {
    var productRef =
      toText(item && (item.product_key || item.productKey)) ||
      toText(item && (item.product_handle || item.productHandle)) ||
      buildProductRef(item || {});
    var variantRef = toText(item && item.variant_id) || 'none';
    var styleRef = getFavoriteOptionValue(item, 'Style') || 'none';
    var colorRef = getFavoriteOptionValue(item, 'Color') || 'none';
    var sizeRef = getFavoriteOptionValue(item, 'Size') || 'none';
    var notesRef = getFavoriteNotes(item);
    var uploadRef = buildAttireFavoriteUploadRef(item);

    return [
      'fav',
      ATTIRE_BUILD_TYPE,
      toLowerSlug(productRef || 'attire-custom'),
      'variant:' + toLowerSlug(variantRef),
      'style:' + toLowerSlug(styleRef),
      'color:' + toLowerSlug(colorRef),
      'size:' + toLowerSlug(sizeRef),
      'notes:' + shortHash(notesRef),
      'uploads:' + uploadRef
    ].join('|');
  }

  function getFavoriteItemPayload(favorite) {
    return isObject(favorite && favorite.item_payload) ? favorite.item_payload : {};
  }

  function getCustomDesignRestoreState(favorite) {
    var payload = getFavoriteItemPayload(favorite);
    if (isObject(payload.restore_state)) return payload.restore_state;
    if (isObject(payload.restoreState)) return payload.restoreState;
    if (isObject(favorite && favorite.restore_state)) return favorite.restore_state;
    if (isObject(favorite && favorite.restoreState)) return favorite.restoreState;
    return {};
  }

  function getCustomDesignField(favorite, keys) {
    var restoreState = getCustomDesignRestoreState(favorite);
    var liveReference = isObject(favorite && favorite.live_reference) ? favorite.live_reference : {};
    var sources = [favorite || {}, restoreState, liveReference];
    for (var sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
      var source = sources[sourceIndex];
      if (!isObject(source)) continue;
      for (var keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
        var key = keys[keyIndex];
        var value = toText(source[key]);
        if (value) return value;
      }
    }
    return '';
  }

  function getCustomDesignSelectionValue(favorite, selectionKey, label) {
    var restoreState = getCustomDesignRestoreState(favorite);
    var selection = isObject(restoreState && restoreState[selectionKey]) ? restoreState[selectionKey] : {};
    return (
      toText(selection.key) ||
      toText(selection.label) ||
      getFavoriteOptionValue(favorite, label) ||
      'none'
    );
  }

  function buildCustomDesignIdentityParts(favorite) {
    var productRef =
      getCustomDesignField(favorite, ['product_key', 'productKey']) ||
      getCustomDesignField(favorite, ['product_handle', 'productHandle']) ||
      getCustomDesignField(favorite, ['product_id', 'productId']) ||
      'customization';
    var variantRef =
      getCustomDesignField(favorite, ['variant_id', 'variantId', 'baseVariantId']) ||
      'none';
    var wrapRef = getCustomDesignSelectionValue(favorite, 'wrap', 'Wrap');
    var colorRef = getCustomDesignSelectionValue(favorite, 'color', 'Color');
    var accessoryRef = getCustomDesignSelectionValue(favorite, 'accessory', 'Accessory');
    var notesRef = getFavoriteNotes(favorite) || getCustomDesignField(favorite, ['notes', 'design_notes']);
    var uploadRef = getFavoriteUploadReference(favorite);
    return [
      'product:' + toLowerSlug(productRef),
      'variant:' + toLowerSlug(variantRef),
      'wrap:' + toLowerSlug(wrapRef),
      'color:' + toLowerSlug(colorRef),
      'accessory:' + toLowerSlug(accessoryRef),
      'notes:' + shortHash(notesRef),
      'uploads:' + (uploadRef ? shortHash(uploadRef.key) : 'none')
    ];
  }

  function buildCustomDesignFavoriteKey(item) {
    return ['fav', CUSTOM_DESIGN_TYPE].concat(buildCustomDesignIdentityParts(item)).join('|');
  }

  function buildFavoriteKey(item) {
    if (isCustomDesignFavoriteRecord(item)) {
      return buildCustomDesignFavoriteKey(item);
    }
    if (isAttireFavoriteRecord(item)) {
      return buildAttireFavoriteKey(item);
    }

    var productRef = buildProductRef(item);
    var variantRef = buildVariantRef(item);
    return 'fav|' + productRef + '|' + variantRef;
  }

  function cloneOption(option) {
    return {
      label: option.label,
      value: option.value,
      swatch_style: option.swatch_style || option.swatchStyle,
      swatch_glyph: option.swatch_glyph || option.swatchGlyph,
      attachment_data: option.attachment_data || option.attachmentData,
      attachment_key: option.attachment_key || option.attachmentKey,
      attachment_url: option.attachment_url || option.attachmentUrl,
      attachment_provider: option.attachment_provider || option.attachmentProvider,
      attachment_content_type: option.attachment_content_type || option.attachmentContentType,
      attachment_size: option.attachment_size || option.attachmentSize,
      layout: option.layout
    };
  }

  function cloneJsonValue(value, fallback) {
    if (value === null || value === undefined) return fallback;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      return fallback;
    }
  }

  function cloneFavorite(item) {
    return {
      id: item.id,
      favorite_key: item.favorite_key,
      product_key: item.product_key,
      product_id: item.product_id,
      product_handle: item.product_handle,
      product_url: item.product_url,
      variant_id: item.variant_id,
      title: item.title,
      variant_title: item.variant_title,
      short_description: item.short_description,
      description: item.description,
      price: item.price,
      quantity: item.quantity,
      currency_code: item.currency_code,
      preview_image: item.preview_image,
      image_url: item.image_url,
      preview_style: item.preview_style,
      selected_options: (item.selected_options || []).map(cloneOption),
      options_summary: item.options_summary,
      source_path: item.source_path,
      added_at: item.added_at,
      updated_at: item.updated_at,
      saved_item_id: item.saved_item_id,
      account_saved_item_id: item.account_saved_item_id,
      account_dedupe_key: item.account_dedupe_key,
      account_source: item.account_source,
      account_saved_item_type: item.account_saved_item_type,
      owner_scope: item.owner_scope,
      merged_to_account: item.merged_to_account === true,
      item_payload: cloneJsonValue(item.item_payload, null),
      line_item_metadata: cloneJsonValue(item.line_item_metadata, null),
      upload_references: cloneJsonValue(item.upload_references, []),
      live_reference: cloneJsonValue(item.live_reference, null)
    };
  }

  function normalizeOwnerScope(value) {
    var scope = toText(value).toLowerCase();
    if (scope === 'account' || scope === 'guest') return scope;
    return '';
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
      product_key: toText(
        source.product_key ||
          source.productKey ||
          (source.metadata && (source.metadata.product_key || source.metadata.productKey))
      ),
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
      quantity: Math.max(1, toNumber(source.quantity || source.qty || 1) || 1),
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
      updated_at: isoNow(),
      saved_item_id: toText(source.saved_item_id || source.savedItemId),
      account_saved_item_id: toText(source.account_saved_item_id || source.accountSavedItemId),
      account_dedupe_key: toText(source.account_dedupe_key || source.accountDedupeKey || source.dedupe_key || source.dedupeKey),
      account_source: toText(source.account_source || source.accountSource),
      account_saved_item_type: toText(source.account_saved_item_type || source.accountSavedItemType || source.saved_item_type || source.savedItemType || source.type),
      owner_scope: normalizeOwnerScope(source.owner_scope || source.ownerScope),
      merged_to_account: source.merged_to_account === true || source.mergedToAccount === true,
      item_payload: isObject(source.item_payload || source.itemPayload)
        ? cloneJsonValue(source.item_payload || source.itemPayload, null)
        : (isObject(source.restore_state || source.restoreState)
          ? { restore_state: cloneJsonValue(source.restore_state || source.restoreState, {}) }
          : null),
      line_item_metadata: isObject(source.line_item_metadata || source.lineItemMetadata)
        ? cloneJsonValue(source.line_item_metadata || source.lineItemMetadata, null)
        : null,
      upload_references: Array.isArray(source.upload_references || source.uploadReferences)
        ? cloneJsonValue(source.upload_references || source.uploadReferences, [])
        : [],
      live_reference: isObject(source.live_reference || source.liveReference)
        ? cloneJsonValue(source.live_reference || source.liveReference, null)
        : null
    };

    if (!canonical.short_description) {
      canonical.short_description = toText(source.subtitle || source.meta || source.note);
    }
    if (!canonical.description) {
      canonical.description = canonical.short_description;
    }

    if (!canonical.preview_image && canonical.preview_style) {
      canonical.preview_image = extractImageUrlFromStyle(canonical.preview_style);
    }

    canonical.image_url = canonical.preview_image;
    canonical.options_summary = optionsSummary(canonical.selected_options);

    if (!canonical.added_at) {
      canonical.added_at = canonical.updated_at;
    }

    var stableKey = chooseStoredFavoriteId(canonical, source);

    canonical.id = stableKey;
    canonical.favorite_key = stableKey;

    return canonical;
  }

  function mergeFavoriteRecords(current, incoming) {
    if (!current) return incoming;

    var merged = cloneFavorite(current);
    var fields = [
      'product_key',
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
      'added_at',
      'saved_item_id',
      'account_saved_item_id',
      'account_dedupe_key',
      'account_source',
      'account_saved_item_type',
      'owner_scope',
      'merged_to_account',
      'item_payload'
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
    if (Number.isFinite(incoming.quantity)) {
      merged.quantity = Math.max(1, incoming.quantity);
    }

    if (Array.isArray(incoming.selected_options) && incoming.selected_options.length) {
      merged.selected_options = incoming.selected_options.map(cloneOption);
      merged.options_summary = optionsSummary(merged.selected_options);
    }
    if (isObject(incoming.line_item_metadata)) {
      merged.line_item_metadata = cloneJsonValue(incoming.line_item_metadata, null);
    }
    if (Array.isArray(incoming.upload_references)) {
      merged.upload_references = cloneJsonValue(incoming.upload_references, []);
    }
    if (isObject(incoming.live_reference)) {
      merged.live_reference = cloneJsonValue(incoming.live_reference, null);
    }

    merged.updated_at = incoming.updated_at || isoNow();
    if (!merged.added_at) {
      merged.added_at = merged.updated_at;
    }

    return merged;
  }

  function mergeFavoriteRecordsWithSource(current, currentSource, incoming, incomingSource) {
    var merged = mergeFavoriteRecords(current, incoming);
    var currentScore = scoreFavoriteIdentity(current, currentSource);
    var incomingScore = scoreFavoriteIdentity(incoming, incomingSource);
    var preferredSource = incomingScore >= currentScore ? incomingSource : currentSource;
    var preferredId = chooseStoredFavoriteId(merged, preferredSource);

    if (preferredId) {
      merged.id = preferredId;
      merged.favorite_key = preferredId;
    }

    return merged;
  }

  function findFavoriteMatchInItems(items, rawInput) {
    var directId = '';
    var lookupAliases = [];

    if (typeof rawInput === 'string') {
      directId = toText(rawInput);
      if (directId) lookupAliases.push(directId);
    } else if (isObject(rawInput)) {
      var normalized = normalizeFavoriteItem(rawInput, {});
      lookupAliases = collectFavoriteAliases(normalized, rawInput);
      if (normalized.id) lookupAliases.push(normalized.id);
    } else {
      return null;
    }

    if (!directId && !lookupAliases.length) return null;

    var sourceItems = Array.isArray(items) ? items : [];
    for (var i = 0; i < sourceItems.length; i += 1) {
      var item = sourceItems[i];
      if (!item) continue;
      if (directId && (item.id === directId || item.favorite_key === directId)) {
        return item;
      }
      var itemAliases = collectFavoriteAliases(item, item);
      if (hasAliasOverlap(lookupAliases, itemAliases)) {
        return item;
      }
    }

    return null;
  }

  function findFavoriteMatch(rawInput) {
    return findFavoriteMatchInItems(state.items, rawInput);
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
    var aliasToId = new Map();
    var sourceById = new Map();
    // Historical payloads reused the same key with drifting shapes, so dedupe by alias set instead of exact id only.
    rawItems.forEach(function eachRaw(rawItem) {
      var normalized = normalizeFavoriteItem(rawItem, meta);
      if (!normalized.id) return;
      var aliases = collectFavoriteAliases(normalized, rawItem);
      var matchedId = '';

      for (var i = 0; i < aliases.length; i += 1) {
        var alias = aliases[i];
        var knownId = aliasToId.get(alias);
        if (knownId) {
          matchedId = knownId;
          break;
        }
      }

      var targetId = matchedId || normalized.id;
      var existing = byId.get(targetId);
      var existingSource = sourceById.get(targetId) || {};
      var preferredSource =
        scoreFavoriteIdentity(normalized, rawItem) >= scoreFavoriteIdentity(existing, existingSource)
          ? rawItem
          : existingSource;
      var merged = mergeFavoriteRecordsWithSource(existing, existingSource, normalized, rawItem);
      var finalId = merged.id || targetId;

      if (existing && finalId !== targetId) {
        aliasToId.forEach(function eachMappedId(mappedId, aliasKey) {
          if (mappedId === targetId) {
            aliasToId.set(aliasKey, finalId);
          }
        });
        byId.delete(targetId);
        sourceById.delete(targetId);
      }

      byId.set(finalId, merged);
      sourceById.set(finalId, preferredSource);

      aliases.push(targetId);
      aliases.push(finalId);
      aliases.forEach(function eachAlias(alias) {
        aliasToId.set(alias, finalId);
      });
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

  function hasAccountSourceMarker(favorite) {
    var source = toText(favorite && (favorite.account_source || favorite.accountSource)).toLowerCase();
    return Boolean(source && source !== 'guest' && source !== 'local');
  }

  function isAccountOwnedFavorite(favorite) {
    if (!favorite || typeof favorite !== 'object') return false;
    if (hasBackendSavedItemIdentity(favorite)) return true;
    if (normalizeOwnerScope(favorite.owner_scope || favorite.ownerScope) === 'account') return true;
    if (favorite.merged_to_account === true || favorite.mergedToAccount === true) return true;
    return hasAccountSourceMarker(favorite);
  }

  function isGuestScopedFavorite(favorite) {
    if (!favorite || typeof favorite !== 'object') return false;
    if (isAccountOwnedFavorite(favorite)) return false;
    var ownerScope = normalizeOwnerScope(favorite.owner_scope || favorite.ownerScope);
    return !ownerScope || ownerScope === 'guest';
  }

  function markGuestScopedFavorite(favorite) {
    var next = cloneFavorite(favorite);
    next.owner_scope = 'guest';
    next.merged_to_account = false;
    next.saved_item_id = '';
    next.account_saved_item_id = '';
    next.account_dedupe_key = '';
    next.account_source = '';
    next.account_saved_item_type = '';
    return next;
  }

  function markAccountScopedFavorite(favorite, source, type) {
    var next = cloneFavorite(favorite);
    next.owner_scope = 'account';
    next.account_source = toText(source) || toText(next.account_source) || 'account_deferred';
    if (type) {
      next.account_saved_item_type = type;
    }
    return next;
  }

  function filterGuestSessionState(nextState) {
    var payload = nextState || {};
    return {
      version: STORE_VERSION,
      storage_key: STORAGE_KEY,
      updated_at: payload.updated_at || isoNow(),
      items: (payload.items || [])
        .filter(isGuestScopedFavorite)
        .map(markGuestScopedFavorite)
    };
  }

  function writeGuestSessionState(nextState) {
    var guestState = filterGuestSessionState(nextState);
    guestState.updated_at = isoNow();
    if (guestState.items.length) {
      writeRawStorageValue(STORAGE_KEY, serializeState(guestState));
    } else {
      removeRawStorageValue(STORAGE_KEY);
    }
    cleanupLegacyFavoriteStorage();
    return guestState;
  }

  function buildFavoriteAliasMap(items) {
    return (Array.isArray(items) ? items : []).reduce(function buildMap(result, item) {
      if (!item) return result;
      collectFavoriteAliases(item, item).forEach(function eachAlias(alias) {
        if (alias) result[alias] = true;
      });
      if (toText(item.id)) result[toText(item.id)] = true;
      if (toText(item.favorite_key)) result[toText(item.favorite_key)] = true;
      return result;
    }, {});
  }

  function favoriteMatchesAliasMap(item, aliasMap) {
    if (!item || !aliasMap) return false;
    var aliases = collectFavoriteAliases(item, item);
    if (toText(item.id)) aliases.push(toText(item.id));
    if (toText(item.favorite_key)) aliases.push(toText(item.favorite_key));
    return aliases.some(function hasBlockedAlias(alias) {
      return Boolean(aliasMap[alias]);
    });
  }

  function readRawStorageValue(key, store) {
    var target = store || getGuestStorage();
    if (!target) return null;
    try {
      return target.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function writeRawStorageValue(key, value, store) {
    var target = store || getGuestStorage();
    if (!target) return false;
    try {
      target.setItem(key, value);
      return true;
    } catch (error) {
      return false;
    }
  }

  function removeRawStorageValue(key, store) {
    var target = store || getGuestStorage();
    if (!target) return false;
    try {
      target.removeItem(key);
      return true;
    } catch (error) {
      return false;
    }
  }

  function cleanupLegacyFavoriteStorage() {
    var store = getLegacyStorage();
    if (!store) return null;
    LEGACY_KEYS.forEach(function eachLegacyKey(key) {
      removeRawStorageValue(key, store);
    });
    return true;
  }

  function loadStateFromStorage(options) {
    var settings = isObject(options) ? options : {};
    cleanupLegacyFavoriteStorage();

    var store = getGuestStorage();
    if (!store) {
      return normalizeFavoritesPayload({ items: [] });
    }

    var rawText = readRawStorageValue(STORAGE_KEY, store);

    if (!rawText) {
      return normalizeFavoritesPayload({ items: [] });
    }

    var parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (error) {
      parsed = { items: [] };
    }

    var normalized = filterGuestSessionState(migratePayload(parsed, { source_path: getCurrentPath() }));
    var normalizedText = serializeState(normalized);

    if (!settings.readonly && rawText !== normalizedText) {
      writeRawStorageValue(STORAGE_KEY, normalizedText, store);
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
    if (!accountMode) {
      var guestState = filterGuestSessionState(state);
      if (guestState.items.length) {
        writeRawStorageValue(STORAGE_KEY, serializeState(guestState));
      } else {
        removeRawStorageValue(STORAGE_KEY);
      }
      state = guestState;
      cleanupLegacyFavoriteStorage();
    }
    emitChange(reason, meta);
  }

  function getSnapshot() {
    return {
      version: STORE_VERSION,
      storage_key: STORAGE_KEY,
      mode: accountMode ? 'account' : 'guest',
      account_loaded: Boolean(accountLoaded),
      updated_at: state.updated_at,
      items: state.items.map(cloneFavorite)
    };
  }

  function getFavorites() {
    return getSnapshot().items;
  }

  function getFavoriteById(id) {
    var match = findFavoriteMatch(id);
    return match ? cloneFavorite(match) : null;
  }

  function hasFavorite(id) {
    return Boolean(findFavoriteMatch(id));
  }

  function getStoreApiConfig() {
    var body = global.document && global.document.body ? global.document.body : null;
    var dataset = body && body.dataset ? body.dataset : {};
    var enabled = dataset.medusaEnabled === 'true' || global.LDC_MEDUSA_ENABLED === true;
    var backendUrl = toText(dataset.medusaBackend || global.LDC_MEDUSA_BACKEND || DEFAULT_MEDUSA_BACKEND).replace(/\/+$/, '');
    var publishableKey = toText(
      dataset.medusaPublishableKey ||
      global.LDC_MEDUSA_PUBLISHABLE_KEY ||
      DEFAULT_MEDUSA_PUBLISHABLE_KEY
    );
    return {
      enabled: Boolean(enabled && backendUrl),
      backendUrl: backendUrl,
      publishableKey: publishableKey
    };
  }

  function accountRequest(path, options) {
    var config = getStoreApiConfig();
    var requestOptions = isObject(options) ? options : {};
    if (!config.enabled) {
      return Promise.reject(new Error('Store API is unavailable for account favorites.'));
    }

    var headers = Object.assign({
      'Content-Type': 'application/json'
    }, requestOptions.headers || {});
    if (config.publishableKey) {
      headers['x-publishable-api-key'] = config.publishableKey;
    }

    return global.fetch(config.backendUrl + path, {
      method: requestOptions.method || 'GET',
      headers: headers,
      credentials: 'include',
      body: requestOptions.body ? JSON.stringify(requestOptions.body) : undefined
    }).then(function parseAccountResponse(response) {
      return response.text().then(function parseText(text) {
        var payload = {};
        if (text) {
          try {
            payload = JSON.parse(text);
          } catch (error) {
            payload = { message: text };
          }
        }
        if (!response.ok) {
          var requestError = new Error(
            toText(payload && (payload.message || payload.error)) ||
              'Account favorites request failed.'
          );
          requestError.status = response.status;
          requestError.payload = payload;
          throw requestError;
        }
        return payload;
      });
    });
  }

  function getAccountCustomer() {
    return accountRequest('/store/customers/me').then(function onCustomerResult(payload) {
      return payload && (payload.customer || payload);
    });
  }

  function isDataUrl(value) {
    return /^data:[^;]+;base64,/i.test(toText(value));
  }

  function stripAttachmentReferenceNote(value) {
    return toText(value).replace(/\s*\(file reference\)\s*$/i, '').trim();
  }

  function getDataUrlContentType(dataUrl) {
    var match = toText(dataUrl).match(/^data:([^;,]+)[;,]/i);
    return match ? toText(match[1]) : '';
  }

  function getDataUrlSize(dataUrl) {
    var raw = toText(dataUrl);
    var match = raw.match(/^data:[^;]+;base64,(.+)$/i);
    if (!match) return 0;
    var base64 = match[1].replace(/\s/g, '');
    if (!base64) return 0;
    var padding = base64.endsWith('==') ? 2 : (base64.endsWith('=') ? 1 : 0);
    return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
  }

  function getFavoriteAttachmentOption(favorite) {
    var selectedOptions = Array.isArray(favorite && favorite.selected_options) ? favorite.selected_options : [];
    return selectedOptions.find(function findAttachmentOption(option) {
      return normalizeFavoriteMetadataLabel(option && option.label).toLowerCase() === 'attachment';
    }) || null;
  }

  function normalizeUploadReference(value) {
    if (!value || typeof value !== 'object') return null;
    var key = toText(value.key || value.attachment_key || value.attachmentKey || value.id);
    var url = toText(
      value.display_url ||
      value.displayUrl ||
      value.url ||
      value.attachment_url ||
      value.attachmentUrl
    );
    var filename = stripAttachmentReferenceNote(
      value.filename ||
      value.name ||
      value.value ||
      value.attachment_name ||
      value.attachmentName ||
      'Attachment'
    ) || 'Attachment';
    if (!key) return null;
    return {
      provider: toText(value.provider || value.attachment_provider || value.attachmentProvider) || 's3',
      key: key,
      filename: filename,
      content_type: toText(value.content_type || value.contentType || value.attachment_content_type || value.attachmentContentType),
      size: toNumber(value.size || value.attachment_size || value.attachmentSize),
      display_url: url,
      url: url,
      route: toText(value.route || value.source_path || value.sourcePath),
      source: toText(value.source) || 'upload_inspiration',
      status: toText(value.status) || 'active'
    };
  }

  function getFavoriteUploadReference(favorite) {
    if (!favorite || typeof favorite !== 'object') return null;

    if (Array.isArray(favorite.upload_references)) {
      for (var i = 0; i < favorite.upload_references.length; i += 1) {
        var normalizedReference = normalizeUploadReference(favorite.upload_references[i]);
        if (normalizedReference) return normalizedReference;
      }
    }

    if (isObject(favorite.line_item_metadata)) {
      var metadata = favorite.line_item_metadata;
      var metadataReference = normalizeUploadReference({
        key: metadata.design_attachment_key || metadata.designAttachmentKey,
        filename: metadata.design_attachment_name || metadata.designAttachmentName,
        url: metadata.design_attachment_url || metadata.designAttachmentUrl,
        provider: metadata.design_attachment_provider || metadata.designAttachmentProvider,
        content_type: metadata.design_attachment_content_type || metadata.designAttachmentContentType,
        size: metadata.design_attachment_size || metadata.designAttachmentSize,
        route: metadata.design_source_path || metadata.designSourcePath || favorite.source_path
      });
      if (metadataReference) return metadataReference;
    }

    var attachmentOption = getFavoriteAttachmentOption(favorite);
    if (!attachmentOption) return null;
    return normalizeUploadReference({
      key: attachmentOption.attachment_key || attachmentOption.attachmentKey,
      filename: attachmentOption.value,
      url: attachmentOption.attachment_url || attachmentOption.attachmentUrl,
      provider: attachmentOption.attachment_provider || attachmentOption.attachmentProvider,
      content_type: attachmentOption.attachment_content_type || attachmentOption.attachmentContentType,
      size: attachmentOption.attachment_size || attachmentOption.attachmentSize,
      route: favorite.source_path || favorite.product_url
    });
  }

  function isPersistentUploadReference(value) {
    return Boolean(normalizeUploadReference(value));
  }

  function buildUploadAttachmentMetadata(uploadRef) {
    var ref = normalizeUploadReference(uploadRef);
    if (!ref) return {};
    var metadata = {
      design_attachment_name: ref.filename,
      design_attachment_provider: ref.provider,
      design_attachment_key: ref.key,
      design_attachment_url: ref.display_url || ref.url,
      design_attachment_content_type: ref.content_type,
      design_attachment_size: ref.size || undefined
    };
    return Object.keys(metadata).reduce(function reduceAttachmentMetadata(result, key) {
      var value = metadata[key];
      if (value !== undefined && value !== null && toText(value)) {
        result[key] = value;
      }
      return result;
    }, {});
  }

  function uploadDesignAttachment(dataUrl, details) {
    var config = getStoreApiConfig();
    var filename = stripAttachmentReferenceNote(details && details.filename) || 'attachment';
    var contentType = toText(details && details.content_type) || getDataUrlContentType(dataUrl) || 'application/octet-stream';
    if (!config.enabled) {
      return Promise.reject(new Error('Store API is unavailable for upload references.'));
    }
    if (!isDataUrl(dataUrl)) {
      return Promise.reject(new Error('Upload Inspiration must be reattached before it can move to cart.'));
    }
    var headers = { 'Content-Type': 'application/json' };
    if (config.publishableKey) {
      headers['x-publishable-api-key'] = config.publishableKey;
    }
    return global.fetch(config.backendUrl + '/store/design-attachments', {
      method: 'POST',
      headers: headers,
      credentials: 'omit',
      body: JSON.stringify({
        filename: filename,
        content_type: contentType,
        data_url: dataUrl
      })
    }).then(function parseUploadResponse(response) {
      return response.text().then(function parseText(text) {
        var payload = {};
        if (text) {
          try {
            payload = JSON.parse(text);
          } catch (error) {
            payload = { message: text };
          }
        }
        if (!response.ok) {
          var uploadError = new Error(toText(payload.message || payload.error) || 'Attachment upload failed.');
          uploadError.status = response.status;
          throw uploadError;
        }
        var reference = normalizeUploadReference({
          provider: 's3',
          key: payload.key || payload.id,
          filename: payload.filename || filename,
          url: payload.url,
          content_type: contentType,
          size: toNumber(details && details.size) || getDataUrlSize(dataUrl),
          route: details && details.route,
          source: 'upload_inspiration',
          status: 'active'
        });
        if (!reference) {
          throw new Error('Attachment upload did not return a persistent key.');
        }
        return reference;
      });
    });
  }

  function applyUploadReferenceToFavorite(favorite, uploadRef) {
    var ref = normalizeUploadReference(uploadRef);
    if (!ref) return cloneFavorite(favorite);
    var cloned = cloneFavorite(favorite);
    var attachmentOption = getFavoriteAttachmentOption(cloned);
    if (attachmentOption) {
      attachmentOption.value = ref.filename || stripAttachmentReferenceNote(attachmentOption.value) || 'Attachment';
      attachmentOption.attachment_data = '';
      attachmentOption.attachment_key = ref.key;
      attachmentOption.attachment_url = ref.display_url || ref.url || '';
      attachmentOption.attachment_provider = ref.provider || 's3';
      attachmentOption.attachment_content_type = ref.content_type || '';
      attachmentOption.attachment_size = ref.size ? String(ref.size) : '';
    }
    cloned.upload_references = [ref];
    cloned.line_item_metadata = Object.assign(
      {},
      isObject(cloned.line_item_metadata) ? cloned.line_item_metadata : {},
      buildUploadAttachmentMetadata(ref)
    );
    delete cloned.line_item_metadata.design_attachment_data;
    return cloned;
  }

  function ensurePersistentUploadReference(favorite) {
    var cloned = cloneFavorite(favorite || {});
    var existingReference = getFavoriteUploadReference(cloned);
    if (existingReference) {
      return Promise.resolve(applyUploadReferenceToFavorite(cloned, existingReference));
    }

    var attachmentOption = getFavoriteAttachmentOption(cloned);
    if (!attachmentOption) {
      return Promise.resolve(cloned);
    }

    var rawData = toText(attachmentOption.attachment_data || attachmentOption.attachmentData);
    if (!rawData) {
      var missingError = new Error('Reattach Upload Inspiration before moving this favorite to cart.');
      missingError.reason = 'upload_reference_missing';
      missingError.userMessage = 'Reattach Upload Inspiration before moving this favorite to cart.';
      return Promise.reject(missingError);
    }
    if (!isDataUrl(rawData)) {
      var unsafeError = new Error('Upload Inspiration must be converted to a persistent reference before moving to cart.');
      unsafeError.reason = 'upload_reference_unsafe';
      unsafeError.userMessage = 'Upload Inspiration must be reattached before moving this favorite to cart.';
      return Promise.reject(unsafeError);
    }

    return uploadDesignAttachment(rawData, {
      filename: stripAttachmentReferenceNote(attachmentOption.value) || 'attachment',
      content_type: attachmentOption.attachment_content_type || attachmentOption.attachmentContentType || getDataUrlContentType(rawData),
      size: toNumber(attachmentOption.attachment_size || attachmentOption.attachmentSize) || getDataUrlSize(rawData),
      route: cloned.source_path || cloned.product_url || getCurrentPath()
    }).then(function onUploaded(uploadRef) {
      return applyUploadReferenceToFavorite(cloned, uploadRef);
    });
  }

  function listAccountSavedItems() {
    return Promise.all(SUPPORTED_ACCOUNT_SAVED_ITEM_TYPES.map(function eachType(type) {
      return accountRequest('/store/customers/me/saved-items?type=' + encodeURIComponent(type) + '&limit=200')
        .then(function onSavedItems(payload) {
          return Array.isArray(payload && payload.saved_items) ? payload.saved_items : [];
        });
    })).then(function flattenSavedItems(results) {
      var byId = new Map();
      results.forEach(function eachResult(items) {
        (items || []).forEach(function eachItem(item) {
          var id = toText(item && item.id);
          if (id) byId.set(id, item);
        });
      });
      return Array.from(byId.values());
    });
  }

  function isUnsafeUploadKey(key) {
    return /^(attachment_data|attachmentdata|data_url|dataurl|base64|raw_file|rawfile|file_data|filedata|blob)$/i.test(toText(key));
  }

  function isInternalAccountPayloadKey(key) {
    return /^(owner_scope|ownerscope|merged_to_account|mergedtoaccount|account_source|accountsource|account_saved_item_id|accountsaveditemid|saved_item_id|saveditemid|account_dedupe_key|accountdedupekey|account_saved_item_type|accountsaveditemtype)$/i.test(toText(key));
  }

  function hasRawAccountPayload(value, depth, parentKey) {
    if (depth > 8) return false;
    if (value === null || value === undefined) return false;
    if ((global.File && value instanceof global.File) || (global.Blob && value instanceof global.Blob)) {
      return true;
    }
    if (typeof value === 'string') {
      var text = toText(value);
      if (!text) return false;
      if (/^data:/i.test(text)) return true;
      if (isUnsafeUploadKey(parentKey) && text) return true;
      return false;
    }
    if (typeof value !== 'object') return false;
    if (Array.isArray(value)) {
      return value.some(function eachEntry(entry) {
        return hasRawAccountPayload(entry, depth + 1, parentKey);
      });
    }
    return Object.keys(value).some(function eachKey(key) {
      return hasRawAccountPayload(value[key], depth + 1, key);
    });
  }

  function sanitizeAccountPayload(value, depth, parentKey) {
    if (depth > 8) return undefined;
    if (value === null || value === undefined) return value;
    if ((global.File && value instanceof global.File) || (global.Blob && value instanceof global.Blob)) return undefined;
    if (typeof value === 'string') {
      if (/^data:/i.test(toText(value))) return '';
      if (isUnsafeUploadKey(parentKey) && toText(value)) return '';
      return value;
    }
    if (typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      return value
        .map(function eachEntry(entry) {
          return sanitizeAccountPayload(entry, depth + 1, parentKey);
        })
        .filter(function keepEntry(entry) {
          return entry !== undefined;
        });
    }
    return Object.keys(value).reduce(function reduceSafe(result, key) {
      if (isUnsafeUploadKey(key) || isInternalAccountPayloadKey(key)) return result;
      var nextValue = sanitizeAccountPayload(value[key], depth + 1, key);
      if (nextValue !== undefined) result[key] = nextValue;
      return result;
    }, {});
  }

  function isAccountSyncableFavorite(favorite) {
    if (!favorite || typeof favorite !== 'object') return false;
    if (isDoormatFavoriteRecord(favorite)) {
      return isAccountSyncableDoormatBuild(favorite);
    }
    if (isAttireFavoriteRecord(favorite)) {
      return isAccountSyncableAttireBuild(favorite);
    }
    if (isCustomDesignFavoriteRecord(favorite)) {
      return isAccountSyncableCustomDesign(favorite);
    }
    if (isDesignSubmittedFavorite(favorite)) {
      return false;
    }
    if (hasRawAccountPayload(favorite, 0, '')) return false;
    return Boolean(
      toText(favorite.title) &&
      (
        toText(favorite.product_id) ||
        toText(favorite.product_handle) ||
        toText(favorite.product_key) ||
        toText(favorite.product_url) ||
        toText(favorite.variant_id)
      )
    );
  }

  function hasBackendSavedItemIdentity(favorite) {
    if (!favorite || typeof favorite !== 'object') return false;
    return Boolean(
      toText(favorite.saved_item_id) ||
      toText(favorite.account_saved_item_id) ||
      toText(favorite.account_source).toLowerCase() === 'backend'
    );
  }

  function getFavoriteNotes(favorite) {
    var selectedOptions = Array.isArray(favorite && favorite.selected_options) ? favorite.selected_options : [];
    var notes = selectedOptions.find(function findNotes(option) {
      return normalizeFavoriteMetadataLabel(option && option.label).toLowerCase() === 'notes';
    });
    return toText(notes && notes.value);
  }

  function buildAccountDedupeKey(favorite) {
    var productRef =
      toText(favorite.product_handle) ||
      toText(favorite.product_id) ||
      toText(favorite.product_key) ||
      normalizeUrl(favorite.product_url) ||
      toText(favorite.title) ||
      'product';
    var variantRef = toText(favorite.variant_id) || toText(favorite.variant_title) || 'default';
    var optionsRef = optionsSummary(favorite.selected_options || []) || toText(favorite.options_summary) || 'default';
    return [
      ACCOUNT_FAVORITE_TYPE,
      toLowerSlug(productRef),
      toLowerSlug(variantRef),
      toLowerSlug(optionsRef)
    ].join('|');
  }

  function getFavoriteOptionValue(favorite, label) {
    var option = findFavoriteOptionRecord(favorite, label);
    return toText(option && option.value);
  }

  function isUploadBearingFavorite(favorite) {
    if (!favorite || typeof favorite !== 'object') return false;
    if (hasRawAccountPayload(favorite, 0, '')) return true;
    if (Array.isArray(favorite.upload_references) && favorite.upload_references.length) return true;
    if (isObject(favorite.line_item_metadata)) {
      var metadata = favorite.line_item_metadata;
      if (
        toText(metadata.design_attachment_name) ||
        toText(metadata.designAttachmentName) ||
        toText(metadata.design_attachment_key) ||
        toText(metadata.designAttachmentKey) ||
        toText(metadata.design_attachment_url) ||
        toText(metadata.designAttachmentUrl)
      ) {
        return true;
      }
    }
    var selectedOptions = Array.isArray(favorite.selected_options) ? favorite.selected_options : [];
    return selectedOptions.some(function hasAttachmentOption(option) {
      var label = normalizeFavoriteMetadataLabel(option && option.label).toLowerCase();
      return label === 'attachment' && Boolean(
        toText(option && option.value) ||
        toText(option && (option.attachment_key || option.attachmentKey)) ||
        toText(option && (option.attachment_data || option.attachmentData))
      );
    });
  }

  function hasUnsafeUploadPayload(favorite) {
    if (!favorite || typeof favorite !== 'object') return false;
    if (hasRawAccountPayload(favorite, 0, '')) return true;
    var attachmentOption = getFavoriteAttachmentOption(favorite);
    if (!attachmentOption) return false;
    if (getFavoriteUploadReference(favorite)) return false;
    return Boolean(toText(attachmentOption.value));
  }

  function isAccountSyncableDoormatBuild(favorite) {
    if (!isDoormatFavoriteRecord(favorite)) return false;
    if (hasUnsafeUploadPayload(favorite)) return false;
    return Boolean(
      toText(favorite.title) &&
      toText(favorite.variant_id) &&
      getFavoriteOptionValue(favorite, 'Size') &&
      getFavoriteOptionValue(favorite, 'Color')
    );
  }

  function isAccountSyncableAttireBuild(favorite) {
    if (!isAttireFavoriteRecord(favorite)) return false;
    if (hasUnsafeUploadPayload(favorite)) return false;
    return Boolean(
      toText(favorite.title) &&
      toText(favorite.variant_id) &&
      (
        toText(favorite.product_handle) ||
        toText(favorite.product_key) ||
        toText(favorite.product_id)
      ) &&
      getFavoriteOptionValue(favorite, 'Style') &&
      getFavoriteOptionValue(favorite, 'Color') &&
      getFavoriteOptionValue(favorite, 'Size')
    );
  }

  function isAccountSyncableCustomDesign(favorite) {
    if (!isCustomDesignFavoriteRecord(favorite)) return false;
    if (hasUnsafeUploadPayload(favorite)) return false;
    return Boolean(
      toText(favorite.title) &&
      (
        getCustomDesignField(favorite, ['product_key', 'productKey']) ||
        getCustomDesignField(favorite, ['product_handle', 'productHandle']) ||
        getCustomDesignField(favorite, ['product_id', 'productId'])
      ) &&
      getCustomDesignField(favorite, ['variant_id', 'variantId', 'baseVariantId'])
    );
  }

  function buildDoormatAccountDedupeKey(favorite) {
    var variantRef = toText(favorite && favorite.variant_id) || 'none';
    var sizeRef = getFavoriteOptionValue(favorite, 'Size') || 'none';
    var colorRef = getFavoriteOptionValue(favorite, 'Color') || 'none';
    var notesRef = getFavoriteNotes(favorite);
    var uploadRef = getFavoriteUploadReference(favorite);
    return [
      DOORMAT_BUILD_TYPE,
      'doormat-custom',
      'variant:' + toLowerSlug(variantRef),
      'size:' + toLowerSlug(sizeRef),
      'color:' + toLowerSlug(colorRef),
      'notes:' + shortHash(notesRef),
      'uploads:' + (uploadRef ? shortHash(uploadRef.key) : 'none')
    ].join('|');
  }

  function buildAttireAccountDedupeKey(favorite) {
    var productRef =
      toText(favorite && (favorite.product_key || favorite.productKey)) ||
      toText(favorite && (favorite.product_handle || favorite.productHandle)) ||
      'attire-custom';
    var variantRef = toText(favorite && favorite.variant_id) || 'none';
    var styleRef = getFavoriteOptionValue(favorite, 'Style') || 'none';
    var colorRef = getFavoriteOptionValue(favorite, 'Color') || 'none';
    var sizeRef = getFavoriteOptionValue(favorite, 'Size') || 'none';
    var notesRef = getFavoriteNotes(favorite);
    var uploadRef = getFavoriteUploadReference(favorite);
    return [
      ATTIRE_BUILD_TYPE,
      toLowerSlug(productRef),
      'variant:' + toLowerSlug(variantRef),
      'style:' + toLowerSlug(styleRef),
      'color:' + toLowerSlug(colorRef),
      'size:' + toLowerSlug(sizeRef),
      'notes:' + shortHash(notesRef),
      'uploads:' + (uploadRef ? shortHash(uploadRef.key) : 'none')
    ].join('|');
  }

  function buildCustomDesignAccountDedupeKey(favorite) {
    return [CUSTOM_DESIGN_TYPE].concat(buildCustomDesignIdentityParts(favorite)).join('|');
  }

  function buildSavedItemDedupeKey(favorite) {
    if (isDoormatFavoriteRecord(favorite)) {
      return buildDoormatAccountDedupeKey(favorite);
    }
    if (isAttireFavoriteRecord(favorite)) {
      return buildAttireAccountDedupeKey(favorite);
    }
    if (isCustomDesignFavoriteRecord(favorite)) {
      return buildCustomDesignAccountDedupeKey(favorite);
    }
    return buildAccountDedupeKey(favorite);
  }

  function getAccountSavedItemTypeForFavorite(favorite) {
    if (isDoormatFavoriteRecord(favorite)) return DOORMAT_BUILD_TYPE;
    if (isAttireFavoriteRecord(favorite)) return ATTIRE_BUILD_TYPE;
    if (isCustomDesignFavoriteRecord(favorite)) return CUSTOM_DESIGN_TYPE;
    return ACCOUNT_FAVORITE_TYPE;
  }

  function getFavoritePriceSnapshotDisplay(favorite) {
    var price = toNumber(favorite && favorite.price);
    if (!Number.isFinite(price) || price <= 0) return '';
    var currency = toCurrencyCode(favorite && favorite.currency_code);
    if (currency === 'USD') return '$' + price.toFixed(2);
    return String(price);
  }

  function mapDoormatFavoriteToSavedItem(favorite) {
    if (!isAccountSyncableDoormatBuild(favorite)) return null;

    var cloned = cloneFavorite(favorite);
    var dedupeKey = toText(favorite.account_dedupe_key) || buildDoormatAccountDedupeKey(favorite);
    var safePayload = sanitizeAccountPayload(cloned, 0, '') || {};
    var safeMetadata = sanitizeAccountPayload(buildCommerceMetadataFromFavorite(favorite), 0, '') || {};
    var safeOptions = sanitizeAccountPayload(favorite.selected_options || [], 0, '') || [];
    var uploadRef = getFavoriteUploadReference(favorite);
    var price = toNumber(favorite.price);
    var priceAmount = Number.isFinite(price) ? Math.round(price * 100) : 0;
    var size = getFavoriteOptionValue(favorite, 'Size');
    var color = getFavoriteOptionValue(favorite, 'Color');

    return {
      type: DOORMAT_BUILD_TYPE,
      dedupe_key: dedupeKey,
      favorite_key: toText(favorite.favorite_key || favorite.id) || buildFavoriteKey(favorite),
      source_path: '/doormats',
      product_id: toText(favorite.product_id),
      product_handle: toText(favorite.product_handle) || 'doormat-custom',
      product_key: toText(favorite.product_key) || 'doormat-custom',
      variant_id: toText(favorite.variant_id),
      title: toText(favorite.title) || 'Custom Doormat',
      variant_title: toText(favorite.variant_title),
      description: toText(favorite.description),
      short_description: toText(favorite.short_description),
      image_url: toText(favorite.image_url || favorite.preview_image),
      preview_image: toText(favorite.preview_image || favorite.image_url),
      preview_style: toText(favorite.preview_style),
      quantity: Math.max(1, toNumber(favorite.quantity) || 1),
      currency_code: toCurrencyCode(favorite.currency_code),
      price_snapshot_amount: priceAmount,
      price_snapshot_display: getFavoritePriceSnapshotDisplay(favorite),
      selected_options: safeOptions,
      item_payload: safePayload,
      line_item_metadata: safeMetadata,
      notes: getFavoriteNotes(favorite),
      upload_references: uploadRef ? [uploadRef] : [],
      live_reference: {
        source_path: '/doormats',
        product_id: toText(favorite.product_id),
        product_handle: toText(favorite.product_handle) || 'doormat-custom',
        product_key: toText(favorite.product_key) || 'doormat-custom',
        variant_id: toText(favorite.variant_id),
        size: size,
        color: color,
        upload_reference_key: uploadRef ? uploadRef.key : ''
      }
    };
  }

  function mapAttireFavoriteToSavedItem(favorite) {
    if (!isAccountSyncableAttireBuild(favorite)) return null;

    var cloned = cloneFavorite(favorite);
    var dedupeKey = buildAttireAccountDedupeKey(favorite);
    var favoriteKey = buildFavoriteKey(favorite);
    cloned.id = favoriteKey;
    cloned.favorite_key = favoriteKey;
    var safePayload = sanitizeAccountPayload(cloned, 0, '') || {};
    var attireMetadata = buildAttireCommerceMetadataFromFavorite(favorite, favorite.variant_id, global.LDCCommerce);
    var safeMetadata = sanitizeAccountPayload(attireMetadata || buildCommerceMetadataFromFavorite(favorite), 0, '') || {};
    var safeOptions = sanitizeAccountPayload(favorite.selected_options || [], 0, '') || [];
    var uploadRef = getFavoriteUploadReference(favorite);
    var price = toNumber(favorite.price);
    var priceAmount = Number.isFinite(price) ? Math.round(price * 100) : 0;
    var style = getFavoriteOptionValue(favorite, 'Style');
    var color = getFavoriteOptionValue(favorite, 'Color');
    var size = getFavoriteOptionValue(favorite, 'Size');
    var productKey = toText(favorite.product_key || favorite.productKey) || 'attire-custom';
    var productHandle = toText(favorite.product_handle || favorite.productHandle) || productKey;

    return {
      type: ATTIRE_BUILD_TYPE,
      dedupe_key: dedupeKey,
      favorite_key: favoriteKey,
      source_path: '/attire',
      product_id: toText(favorite.product_id),
      product_handle: productHandle,
      product_key: productKey,
      variant_id: toText(favorite.variant_id),
      title: toText(favorite.title) || 'Custom Attire',
      variant_title: toText(favorite.variant_title) || [style, color, size].filter(Boolean).join(' | '),
      description: toText(favorite.description),
      short_description: toText(favorite.short_description),
      image_url: toText(favorite.image_url || favorite.preview_image),
      preview_image: toText(favorite.preview_image || favorite.image_url),
      preview_style: toText(favorite.preview_style),
      quantity: Math.max(1, toNumber(favorite.quantity) || 1),
      currency_code: toCurrencyCode(favorite.currency_code),
      price_snapshot_amount: priceAmount,
      price_snapshot_display: getFavoritePriceSnapshotDisplay(favorite),
      selected_options: safeOptions,
      item_payload: safePayload,
      line_item_metadata: safeMetadata,
      notes: getFavoriteNotes(favorite),
      upload_references: uploadRef ? [uploadRef] : [],
      live_reference: {
        source_path: '/attire',
        product_id: toText(favorite.product_id),
        product_handle: productHandle,
        product_key: productKey,
        variant_id: toText(favorite.variant_id),
        style: style,
        color: color,
        size: size,
        upload_reference_key: uploadRef ? uploadRef.key : ''
      }
    };
  }

  function mapCustomDesignFavoriteToSavedItem(favorite) {
    if (!isAccountSyncableCustomDesign(favorite)) return null;

    var cloned = cloneFavorite(favorite);
    var dedupeKey = buildCustomDesignAccountDedupeKey(favorite);
    var favoriteKey = buildFavoriteKey(favorite);
    cloned.id = favoriteKey;
    cloned.favorite_key = favoriteKey;
    cloned.account_dedupe_key = dedupeKey;
    cloned.account_saved_item_type = CUSTOM_DESIGN_TYPE;
    var restoreState = getCustomDesignRestoreState(favorite);
    var sourcePath = toText(favorite.source_path || favorite.sourcePath) || '/customization';
    var payloadSource = Object.assign({}, cloned, {
      type: CUSTOM_DESIGN_TYPE,
      source_path: sourcePath,
      restore_state: cloneJsonValue(restoreState, {})
    });
    delete payloadSource.item_payload;

    var safePayload = sanitizeAccountPayload(payloadSource, 0, '') || {};
    var customMetadata = isObject(favorite.line_item_metadata)
      ? favorite.line_item_metadata
      : buildCommerceMetadataFromFavorite(favorite);
    var safeMetadata = sanitizeAccountPayload(customMetadata || {}, 0, '') || {};
    var safeOptions = sanitizeAccountPayload(favorite.selected_options || [], 0, '') || [];
    var uploadRef = getFavoriteUploadReference(favorite);
    var price = toNumber(favorite.price);
    var priceAmount = Number.isFinite(price) ? Math.round(price * 100) : 0;
    var wrap = getFavoriteOptionValue(favorite, 'Wrap');
    var color = getFavoriteOptionValue(favorite, 'Color');
    var accessory = getFavoriteOptionValue(favorite, 'Accessory');
    var productKey = getCustomDesignField(favorite, ['product_key', 'productKey']) || 'customization';
    var productHandle = getCustomDesignField(favorite, ['product_handle', 'productHandle']) || productKey;
    var variantId = getCustomDesignField(favorite, ['variant_id', 'variantId', 'baseVariantId']);

    return {
      type: CUSTOM_DESIGN_TYPE,
      dedupe_key: dedupeKey,
      favorite_key: favoriteKey,
      source_path: sourcePath,
      product_id: getCustomDesignField(favorite, ['product_id', 'productId']),
      product_handle: productHandle,
      product_key: productKey,
      variant_id: variantId,
      title: toText(favorite.title) || 'Custom Design',
      variant_title: toText(favorite.variant_title) || [wrap, color, accessory].filter(Boolean).join(' | '),
      description: toText(favorite.description),
      short_description: toText(favorite.short_description),
      image_url: toText(favorite.image_url || favorite.preview_image),
      preview_image: toText(favorite.preview_image || favorite.image_url),
      preview_style: toText(favorite.preview_style),
      quantity: Math.max(1, toNumber(favorite.quantity) || 1),
      currency_code: toCurrencyCode(favorite.currency_code),
      price_snapshot_amount: priceAmount,
      price_snapshot_display: getFavoritePriceSnapshotDisplay(favorite),
      selected_options: safeOptions,
      item_payload: safePayload,
      line_item_metadata: safeMetadata,
      notes: getFavoriteNotes(favorite),
      upload_references: uploadRef ? [uploadRef] : [],
      live_reference: {
        source_path: sourcePath,
        product_id: getCustomDesignField(favorite, ['product_id', 'productId']),
        product_handle: productHandle,
        product_key: productKey,
        variant_id: variantId,
        wrap: wrap,
        color: color,
        accessory: accessory,
        upload_reference_key: uploadRef ? uploadRef.key : ''
      }
    };
  }

  function mapFavoriteToSavedItem(favorite) {
    if (isDoormatFavoriteRecord(favorite)) {
      return mapDoormatFavoriteToSavedItem(favorite);
    }
    if (isAttireFavoriteRecord(favorite)) {
      return mapAttireFavoriteToSavedItem(favorite);
    }
    if (isCustomDesignFavoriteRecord(favorite)) {
      return mapCustomDesignFavoriteToSavedItem(favorite);
    }
    if (!isAccountSyncableFavorite(favorite)) return null;

    var cloned = cloneFavorite(favorite);
    var dedupeKey = toText(favorite.account_dedupe_key) || buildAccountDedupeKey(favorite);
    var safePayload = sanitizeAccountPayload(cloned, 0, '') || {};
    var safeMetadata = sanitizeAccountPayload(buildCommerceMetadataFromFavorite(favorite), 0, '') || {};
    var price = toNumber(favorite.price);
    var priceAmount = Number.isFinite(price) ? Math.round(price * 100) : 0;

    return {
      type: ACCOUNT_FAVORITE_TYPE,
      dedupe_key: dedupeKey,
      favorite_key: toText(favorite.favorite_key || favorite.id) || buildFavoriteKey(favorite),
      source_path: toText(favorite.source_path) || getCurrentPath(),
      product_id: toText(favorite.product_id),
      product_handle: toText(favorite.product_handle),
      product_key: toText(favorite.product_key),
      variant_id: toText(favorite.variant_id),
      title: toText(favorite.title) || 'Favorite',
      variant_title: toText(favorite.variant_title),
      description: toText(favorite.description),
      short_description: toText(favorite.short_description),
      image_url: toText(favorite.image_url || favorite.preview_image),
      preview_image: toText(favorite.preview_image || favorite.image_url),
      preview_style: toText(favorite.preview_style),
      quantity: Math.max(1, toNumber(favorite.quantity) || 1),
      currency_code: toCurrencyCode(favorite.currency_code),
      price_snapshot_amount: priceAmount,
      price_snapshot_display: price ? String(price) : '',
      selected_options: sanitizeAccountPayload(favorite.selected_options || [], 0, '') || [],
      item_payload: safePayload,
      line_item_metadata: safeMetadata,
      notes: getFavoriteNotes(favorite),
      upload_references: []
    };
  }

  function clearGuestSessionFavoritesByIds(ids) {
    var idList = Array.isArray(ids) ? ids.map(toText).filter(Boolean) : [];
    if (!idList.length) return 0;

    var localState = loadStateFromStorage({ readonly: true });
    var removeMap = idList.reduce(function buildMap(result, id) {
      result[id] = true;
      return result;
    }, {});
    var originalLength = localState.items.length;

    localState.items = localState.items.filter(function keepItem(item) {
      return isGuestScopedFavorite(item) && !removeMap[toText(item && item.id)] && !removeMap[toText(item && item.favorite_key)];
    });
    if (localState.items.length === originalLength) return 0;

    writeGuestSessionState(localState);
    return originalLength - localState.items.length;
  }

  function clearGuestSessionFavoritesByItems(items) {
    var aliasMap = buildFavoriteAliasMap(items);
    if (!Object.keys(aliasMap).length) return 0;

    var localState = loadStateFromStorage({ readonly: true });
    var originalLength = localState.items.length;
    localState.items = localState.items.filter(function keepItem(item) {
      return isGuestScopedFavorite(item) && !favoriteMatchesAliasMap(item, aliasMap);
    });
    if (localState.items.length === originalLength) return 0;

    writeGuestSessionState(localState);
    return originalLength - localState.items.length;
  }

  function purgeAccountFavoritesFromGuestStorage(accountItems) {
    var accountOwnedItems = (Array.isArray(accountItems) ? accountItems : []).filter(isAccountOwnedFavorite);
    var localState = loadStateFromStorage({ readonly: true });
    var originalLength = localState.items.length;
    var aliasMap = buildFavoriteAliasMap(accountOwnedItems);

    localState.items = localState.items.filter(function keepItem(item) {
      return isGuestScopedFavorite(item) && !favoriteMatchesAliasMap(item, aliasMap);
    });

    if (accountOwnedItems.length || localState.items.length !== originalLength) {
      writeGuestSessionState(localState);
    }

    return Math.max(0, originalLength - localState.items.length);
  }

  function prepareFavoriteForAccountMerge(favorite) {
    var candidate = cloneFavorite(favorite || {});
    if (
      (isDoormatFavoriteRecord(candidate) || isAttireFavoriteRecord(candidate) || isCustomDesignFavoriteRecord(candidate)) &&
      hasUnsafeUploadPayload(candidate)
    ) {
      return ensurePersistentUploadReference(candidate)
        .catch(function onUploadReferenceFailed(error) {
          if (global.console && typeof global.console.warn === 'function') {
            global.console.warn('[favorites] Guest custom favorite upload reference failed before merge', {
              id: candidate.id,
              status: error && error.status,
              reason: toText(error && error.reason)
            });
          }
          return null;
        });
    }
    return Promise.resolve(candidate);
  }

  function mergeGuestSessionFavoritesIntoAccount() {
    var guestState = loadStateFromStorage({ readonly: true });
    var candidates = [];
    var preparedCandidates = [];
    var payloads = [];

    var prepareTasks = (guestState.items || []).map(function eachGuestFavorite(favorite) {
      if (!isGuestScopedFavorite(favorite)) return;
      return prepareFavoriteForAccountMerge(favorite).then(function onPrepared(prepared) {
        if (!prepared) return;
        var payload = mapFavoriteToSavedItem(prepared);
        if (!payload) return;
        candidates.push(favorite);
        preparedCandidates.push(prepared);
        payloads.push(payload);
      });
    });

    return Promise.all(prepareTasks).then(function onPreparedMergePayloads() {
      if (!payloads.length) {
        return { saved_items: [], merged: 0, skipped: 0, errors: [] };
      }
      return accountRequest('/store/customers/me/saved-items/merge', {
        method: 'POST',
        body: {
          items: payloads,
          strategy: 'upsert_by_dedupe_key'
        }
      });
    }).then(function onMerged(result) {
      var errors = Array.isArray(result && result.errors) ? result.errors : [];
      var failedIndexes = errors.reduce(function buildFailedIndexes(map, error) {
        var index = Number(error && error.index);
        if (Number.isFinite(index)) map[index] = true;
        return map;
      }, {});
      var successfulCandidates = candidates
        .filter(function keepSuccessfulCandidate(_favorite, index) {
          return !failedIndexes[index];
        });
      var successfulPreparedCandidates = preparedCandidates
        .filter(function keepSuccessfulPreparedCandidate(_favorite, index) {
          return !failedIndexes[index];
        });
      var mergedIds = successfulCandidates
        .map(function mapCandidateId(favorite) {
          return toText(favorite && favorite.id);
        })
        .filter(Boolean);

      var cleared = Math.max(
        clearGuestSessionFavoritesByIds(mergedIds),
        clearGuestSessionFavoritesByItems(successfulCandidates.concat(successfulPreparedCandidates))
      );
      emitChange('guest_merge_complete', {
        merged: Number(result && result.merged) || mergedIds.length,
        skipped: Number(result && result.skipped) || 0,
        cleared: cleared
      });
      return result;
    }).catch(function onMergeFailed(error) {
      if (global.console && typeof global.console.warn === 'function') {
        global.console.warn('[favorites] Guest favorites merge failed', {
          status: error && error.status
        });
      }
      emitChange('guest_merge_failed', {
        status: error && error.status,
        message: toText(error && error.message)
      });
      return { saved_items: [], merged: 0, skipped: payloads.length, errors: [{ message: toText(error && error.message) }] };
    });
  }

  function mapSavedItemToFavorite(savedItem) {
    if (!savedItem || typeof savedItem !== 'object') return null;
    var savedType = toText(savedItem.type) || ACCOUNT_FAVORITE_TYPE;
    if (SUPPORTED_ACCOUNT_SAVED_ITEM_TYPES.indexOf(savedType) === -1) return null;

    var payload = isObject(savedItem.item_payload) ? savedItem.item_payload : {};
    var defaultSourcePath = savedType === DOORMAT_BUILD_TYPE
      ? '/doormats'
      : (savedType === ATTIRE_BUILD_TYPE
        ? '/attire'
        : (savedType === CUSTOM_DESIGN_TYPE ? '/customization' : ''));
    var snapshotAmount = Number(savedItem.price_snapshot_amount);
    var mapped = Object.assign({}, payload, {
      product_id: toText(savedItem.product_id || payload.product_id),
      product_handle: toText(savedItem.product_handle || payload.product_handle),
      product_key: toText(savedItem.product_key || payload.product_key),
      product_url: defaultSourcePath
        ? toText(savedItem.source_path || payload.product_url || payload.productUrl || defaultSourcePath)
        : toText(payload.product_url || payload.productUrl),
      variant_id: toText(savedItem.variant_id || payload.variant_id),
      title: toText(savedItem.title || payload.title) || (
        savedType === ATTIRE_BUILD_TYPE
          ? 'Custom Attire'
          : (savedType === CUSTOM_DESIGN_TYPE ? 'Custom Design' : 'Favorite')
      ),
      variant_title: toText(savedItem.variant_title || payload.variant_title),
      short_description: toText(savedItem.short_description || payload.short_description),
      description: toText(savedItem.description || payload.description),
      price: Number.isFinite(snapshotAmount) && snapshotAmount > 0
        ? snapshotAmount / 100
        : toNumber(payload.price || 0),
      currency_code: toCurrencyCode(savedItem.currency_code || payload.currency_code),
      preview_image: toText(savedItem.preview_image || savedItem.image_url || payload.preview_image || payload.image_url),
      image_url: toText(savedItem.image_url || savedItem.preview_image || payload.image_url || payload.preview_image),
      preview_style: toText(savedItem.preview_style || payload.preview_style),
      selected_options: Array.isArray(savedItem.selected_options)
        ? savedItem.selected_options
        : (Array.isArray(payload.selected_options) ? payload.selected_options : []),
      source_path: toText(savedItem.source_path || payload.source_path) || defaultSourcePath || '/',
      added_at: toText(savedItem.created_at || payload.added_at),
      updated_at: toText(savedItem.updated_at || payload.updated_at),
      saved_item_id: toText(savedItem.id),
      account_saved_item_id: toText(savedItem.id),
      account_dedupe_key: toText(savedItem.dedupe_key),
      account_source: 'backend',
      account_saved_item_type: savedType,
      owner_scope: 'account',
      line_item_metadata: isObject(savedItem.line_item_metadata)
        ? cloneJsonValue(savedItem.line_item_metadata, null)
        : (isObject(payload.line_item_metadata) ? cloneJsonValue(payload.line_item_metadata, null) : null),
      upload_references: Array.isArray(savedItem.upload_references)
        ? cloneJsonValue(savedItem.upload_references, [])
        : [],
      live_reference: isObject(savedItem.live_reference)
        ? cloneJsonValue(savedItem.live_reference, null)
        : null
    });
    var favorite = normalizeFavoriteItem(mapped, { source_path: mapped.source_path });
    var favoriteKey = (savedType === ATTIRE_BUILD_TYPE || savedType === CUSTOM_DESIGN_TYPE)
      ? buildFavoriteKey(favorite)
      : toText(savedItem.favorite_key || payload.favorite_key || payload.id || favorite.id);
    if (favoriteKey) {
      favorite.id = favoriteKey;
      favorite.favorite_key = favoriteKey;
    }
    favorite.saved_item_id = toText(savedItem.id);
    favorite.account_saved_item_id = toText(savedItem.id);
    favorite.account_dedupe_key = toText(savedItem.dedupe_key);
    favorite.account_source = 'backend';
    favorite.account_saved_item_type = savedType;
    favorite.owner_scope = 'account';
    favorite.line_item_metadata = cloneJsonValue(mapped.line_item_metadata, null);
    favorite.upload_references = cloneJsonValue(mapped.upload_references, []);
    favorite.live_reference = cloneJsonValue(mapped.live_reference, null);
    return favorite;
  }

  function getDeferredLocalFavorites() {
    return loadStateFromStorage({ readonly: true }).items.filter(function keepDeferred(item) {
      return isGuestScopedFavorite(item) && !isAccountSyncableFavorite(item);
    });
  }

  function buildAccountStateFromSavedItems(savedItems) {
    var accountItems = (Array.isArray(savedItems) ? savedItems : [])
      .map(mapSavedItemToFavorite)
      .filter(Boolean);
    return normalizeFavoritesPayload({
      items: accountItems.concat(getDeferredLocalFavorites())
    }, { source_path: getCurrentPath() });
  }

  function applyAccountSavedItems(savedItems, reason) {
    accountMode = true;
    accountLoaded = true;
    state = buildAccountStateFromSavedItems(savedItems);
    emitChange(reason || 'account_load', { mode: 'account' });
    return getFavorites();
  }

  function exitAccountMode(reason) {
    accountRefreshVersion += 1;
    purgeAccountFavoritesFromGuestStorage(state.items);
    accountMode = false;
    accountLoaded = false;
    accountLoadPromise = null;
    state = loadStateFromStorage();
    emitChange(reason || 'account_logout', { mode: 'guest' });
    return getFavorites();
  }

  function refreshAccountFavorites(options) {
    var force = isObject(options) && options.force === true;
    if (accountLoadPromise && !force) return accountLoadPromise;
    if (!getStoreApiConfig().enabled) {
      return Promise.resolve(false);
    }

    var refreshId = accountRefreshVersion + 1;
    accountRefreshVersion = refreshId;

    var pending = getAccountCustomer()
      .then(function onCustomer(customer) {
        if (refreshId !== accountRefreshVersion) return accountMode;
        if (!customer || !toText(customer.id || customer.email)) {
          exitAccountMode('account_logged_out');
          return false;
        }
        return mergeGuestSessionFavoritesIntoAccount()
          .then(function afterGuestMerge() {
            if (refreshId !== accountRefreshVersion) return accountMode;
            return listAccountSavedItems();
          })
          .then(function onSavedItems(savedItems) {
            if (refreshId !== accountRefreshVersion) return accountMode;
            applyAccountSavedItems(savedItems, 'account_load');
            return true;
          });
      })
      .catch(function onAccountRefreshError(error) {
        if (refreshId !== accountRefreshVersion) return accountMode;
        if (error && (error.status === 401 || error.status === 403)) {
          exitAccountMode('account_logged_out');
        } else if (accountMode) {
          emitChange('account_load_failed', {
            status: error && error.status,
            message: toText(error && error.message)
          });
        }
        return false;
      });

    accountLoadPromise = pending.then(function cleanup(result) {
      if (refreshId === accountRefreshVersion) {
        accountLoadPromise = null;
      }
      return result;
    }, function cleanupError(error) {
      if (refreshId === accountRefreshVersion) {
        accountLoadPromise = null;
      }
      throw error;
    });

    return accountLoadPromise;
  }

  function upsertAccountSavedFavorite(favorite) {
    var payload = mapFavoriteToSavedItem(favorite);
    if (!payload) {
      return Promise.reject(new Error('Favorite is not eligible for account sync.'));
    }
    return accountRequest('/store/customers/me/saved-items', {
      method: 'POST',
      body: payload
    }).then(function onSaved(payloadResult) {
      return payloadResult && (payloadResult.saved_item || payloadResult.savedItem || payloadResult);
    });
  }

  function deleteAccountSavedFavorite(savedItemId) {
    var id = toText(savedItemId);
    if (!id) return Promise.reject(new Error('Missing saved item id.'));
    return accountRequest('/store/customers/me/saved-items/' + encodeURIComponent(id), {
      method: 'DELETE'
    });
  }

  function resolveSavedItemIdForFavorite(favorite) {
    var direct = toText(favorite && (favorite.account_saved_item_id || favorite.saved_item_id));
    if (direct) return Promise.resolve(direct);
    var dedupeKey = toText(favorite && favorite.account_dedupe_key) || buildSavedItemDedupeKey(favorite || {});
    return listAccountSavedItems().then(function findSavedItemId(savedItems) {
      var match = (savedItems || []).find(function findItem(item) {
        return toText(item && item.dedupe_key) === dedupeKey;
      });
      return toText(match && match.id);
    });
  }

  function queueAccountFavoriteUpsert(favorite) {
    var favoriteId = toText(favorite && favorite.id);
    upsertAccountSavedFavorite(favorite)
      .then(function onSaved(savedItem) {
        var mapped = mapSavedItemToFavorite(savedItem);
        if (!mapped) return;
        var existing = findFavoriteMatch(favoriteId) || findFavoriteMatch(mapped);
        var index = existing
          ? state.items.findIndex(function findIndex(item) { return item.id === existing.id; })
          : -1;
        if (index >= 0) {
          state.items.splice(index, 1, mergeFavoriteRecords(state.items[index], mapped));
        } else {
          state.items.push(mapped);
        }
        persistState('account_sync', { id: mapped.id, saved_item_id: mapped.saved_item_id });
      })
      .catch(function onSaveFailed(error) {
        var current = findFavoriteMatch(favoriteId);
        if (current && !toText(current.saved_item_id || current.account_saved_item_id)) {
          state.items = state.items.filter(function filterItem(item) {
            return item.id !== current.id;
          });
          persistState('account_sync_failed', {
            id: current.id,
            status: error && error.status,
            message: toText(error && error.message)
          });
        }
        if (global.console && typeof global.console.warn === 'function') {
          global.console.warn('[favorites] Account favorite save failed', {
            id: favoriteId,
            status: error && error.status
          });
        }
      });
  }

  function queueAccountFavoriteDelete(favorite) {
    resolveSavedItemIdForFavorite(favorite)
      .then(function onResolved(savedItemId) {
        if (!savedItemId) return null;
        return deleteAccountSavedFavorite(savedItemId);
      })
      .catch(function onDeleteFailed(error) {
        if (global.console && typeof global.console.warn === 'function') {
          global.console.warn('[favorites] Account favorite delete failed', {
            id: favorite && favorite.id,
            status: error && error.status
          });
        }
        refreshAccountFavorites();
      });
  }

  function upsertLocalFavoriteRecord(rawItem, meta) {
    var normalized = markGuestScopedFavorite(normalizeFavoriteItem(rawItem, meta));
    if (!normalized.id) return null;
    var localState = loadStateFromStorage();
    var existing = findFavoriteMatchInItems(localState.items, rawItem) || findFavoriteMatchInItems(localState.items, normalized.id);
    var existingIndex = existing
      ? localState.items.findIndex(function findIndex(item) { return item.id === existing.id; })
      : -1;
    var nextRecord = normalized;

    if (existingIndex >= 0) {
      nextRecord = mergeFavoriteRecordsWithSource(
        localState.items[existingIndex],
        localState.items[existingIndex],
        normalized,
        rawItem
      );
      nextRecord = markGuestScopedFavorite(nextRecord);
      localState.items.splice(existingIndex, 1, nextRecord);
    } else {
      localState.items.push(nextRecord);
    }

    writeGuestSessionState(localState);
    return cloneFavorite(nextRecord);
  }

  function removeLocalFavoriteRecord(rawInput) {
    var localState = loadStateFromStorage();
    var match = findFavoriteMatchInItems(localState.items, rawInput);
    var favoriteId = toText(match && match.id);
    if (!favoriteId) return false;
    localState.items = localState.items.filter(function filterItem(item) {
      return item.id !== favoriteId;
    });
    writeGuestSessionState(localState);
    return true;
  }

  function upsertFavorite(rawItem, meta) {
    var normalized = normalizeFavoriteItem(rawItem, meta);
    if (!normalized.id) return null;

    if (accountMode && !isAccountSyncableFavorite(normalized)) {
      if (isAttireFavoriteRecord(normalized)) {
        removeLocalFavoriteRecord(normalized);
        if (global.console && typeof global.console.warn === 'function') {
          global.console.warn('[favorites] Attire favorite was not saved because it is missing a safe account payload.', {
            id: normalized.id
          });
        }
        emitChange('account_attire_sync_blocked', { id: normalized.id, mode: 'account' });
        return null;
      }
      var accountFavoriteType = 'custom_deferred';
      var accountFavorite = markAccountScopedFavorite(normalized, 'account_deferred', accountFavoriteType);
      removeLocalFavoriteRecord(accountFavorite);
      var accountExisting = findFavoriteMatch(accountFavorite) || findFavoriteMatch(accountFavorite.id);
      var accountExistingIndex = accountExisting
        ? state.items.findIndex(function findIndex(item) { return item.id === accountExisting.id; })
        : -1;
      if (accountExistingIndex >= 0) {
        var mergedDeferred = markAccountScopedFavorite(
          mergeFavoriteRecords(state.items[accountExistingIndex], accountFavorite),
          'account_deferred',
          accountFavoriteType
        );
        state.items.splice(accountExistingIndex, 1, mergedDeferred);
        state.updated_at = isoNow();
        emitChange('account_deferred_update', { id: mergedDeferred.id, mode: 'account' });
        return cloneFavorite(mergedDeferred);
      } else {
        state.items.push(accountFavorite);
        state.updated_at = isoNow();
        emitChange('account_deferred_add', { id: accountFavorite.id, mode: 'account' });
        return cloneFavorite(accountFavorite);
      }
    }

    var existing = findFavoriteMatch(rawItem) || findFavoriteMatch(normalized.id);
    var existingIndex = existing
      ? state.items.findIndex(function findIndex(item) {
          return item.id === existing.id;
        })
      : -1;

    if (existingIndex >= 0) {
      var merged = mergeFavoriteRecordsWithSource(
        state.items[existingIndex],
        state.items[existingIndex],
        normalized,
        rawItem
      );
      if (accountMode) {
        merged.account_dedupe_key = (isAttireFavoriteRecord(merged) || isCustomDesignFavoriteRecord(merged))
          ? buildSavedItemDedupeKey(merged)
          : (toText(merged.account_dedupe_key) || buildSavedItemDedupeKey(merged));
        merged.account_source = toText(merged.account_source) || 'backend_pending';
        merged.account_saved_item_type = getAccountSavedItemTypeForFavorite(merged);
        merged.owner_scope = 'account';
      }
      state.items.splice(existingIndex, 1, merged);
      persistState(accountMode ? 'account_update' : 'update', { id: merged.id });
      if (accountMode) {
        queueAccountFavoriteUpsert(merged);
      }
      return cloneFavorite(merged);
    }

    if (accountMode) {
      normalized.account_dedupe_key = (isAttireFavoriteRecord(normalized) || isCustomDesignFavoriteRecord(normalized))
        ? buildSavedItemDedupeKey(normalized)
        : (toText(normalized.account_dedupe_key) || buildSavedItemDedupeKey(normalized));
      normalized.account_source = 'backend_pending';
      normalized.account_saved_item_type = getAccountSavedItemTypeForFavorite(normalized);
      normalized.owner_scope = 'account';
    } else {
      normalized.owner_scope = 'guest';
    }
    state.items.push(normalized);
    persistState(accountMode ? 'account_add' : 'add', { id: normalized.id });
    if (accountMode) {
      queueAccountFavoriteUpsert(normalized);
    }
    return cloneFavorite(normalized);
  }

  function removeFavorite(id) {
    var match = findFavoriteMatch(id);
    var favoriteId = toText(match && match.id) || toText(id);
    if (!favoriteId) return false;
    var nextItems = state.items.filter(function filterItem(item) {
      return item.id !== favoriteId;
    });
    if (nextItems.length === state.items.length) return false;
    state.items = nextItems;
    persistState(accountMode ? 'account_remove' : 'remove', { id: favoriteId });
    if (accountMode && match) {
      if (hasBackendSavedItemIdentity(match) || isAccountSyncableFavorite(match)) {
        queueAccountFavoriteDelete(match);
      } else if (isAccountOwnedFavorite(match)) {
        purgeAccountFavoritesFromGuestStorage([match]);
      } else {
        removeLocalFavoriteRecord(match);
      }
    }
    return true;
  }

  function toggleFavorite(rawItem, meta) {
    var normalized = normalizeFavoriteItem(rawItem, meta);
    if (!normalized.id) return { action: 'noop', item: null };

    var existing = findFavoriteMatch(rawItem) || findFavoriteMatch(normalized.id);
    if (existing) {
      removeFavorite(existing.id);
      return { action: 'removed', item: null, id: existing.id };
    }

    var added = upsertFavorite(normalized, meta);
    return { action: 'added', item: added, id: normalized.id };
  }

  function clearFavorites() {
    if (!state.items.length) return false;
    var removedItems = state.items.slice();
    state.items = [];
    persistState(accountMode ? 'account_clear' : 'clear', {});
    if (accountMode) {
      removedItems.forEach(function eachRemovedFavorite(item) {
        if (hasBackendSavedItemIdentity(item) || isAccountSyncableFavorite(item)) {
          queueAccountFavoriteDelete(item);
        } else if (isAccountOwnedFavorite(item)) {
          purgeAccountFavoritesFromGuestStorage([item]);
        } else {
          removeLocalFavoriteRecord(item);
        }
      });
    }
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

  function extractPreviewUrlFromStyle(styleValue) {
    var style = toText(styleValue);
    if (!style) return '';
    var match = style.match(/url\(["']?(.*?)["']?\)/i);
    return match ? match[1] : '';
  }

  function findFavoriteOptionRecord(favorite, targetLabel) {
    var normalizedTarget = normalizeFavoriteMetadataLabel(targetLabel).toLowerCase();
    if (!normalizedTarget) return null;
    var selectedOptions = Array.isArray(favorite && favorite.selected_options) ? favorite.selected_options : [];
    return selectedOptions.find(function findOption(option) {
      return normalizeFavoriteMetadataLabel(option && option.label).toLowerCase() === normalizedTarget;
    }) || null;
  }

  function getDoormatPreviewFillStyleForFavorite(favorite) {
    if (!isDoormatFavoriteRecord(favorite)) return '';
    var colorOption = findFavoriteOptionRecord(favorite, 'Color');
    var swatchStyle = toText(
      colorOption && (
        colorOption.swatch_style ||
        colorOption.swatchStyle
      )
    );
    var match = swatchStyle.match(/background(?:-color)?\s*:\s*([^;]+)/i);
    var fillColor = toText(match && match[1]) || '#d2b48c';
    return fillColor ? 'background-color:' + fillColor + ';' : '';
  }

  function buildSharedFavoritePreviewStyle(favorite) {
    var previewStyle = toText(favorite && favorite.preview_style);
    var fillStyle = getDoormatPreviewFillStyleForFavorite(favorite);
    if (previewStyle && (!fillStyle || /background(?:-color)?\s*:/i.test(previewStyle))) {
      return previewStyle;
    }
    if (previewStyle && fillStyle) {
      return fillStyle + ' ' + previewStyle;
    }
    var image = toText(
      favorite && (
        favorite.preview_image ||
        favorite.image_url
      )
    ) || extractPreviewUrlFromStyle(previewStyle);
    if (image) {
      return [
        fillStyle,
        "background-image:url('" + image.replace(/'/g, "\\'") + "')",
        'background-size:cover',
        'background-position:center',
        'background-repeat:no-repeat'
      ].filter(Boolean).join('; ') + ';';
    }
    return fillStyle;
  }

  function buildCartItemFromFavorite(favorite, overrides) {
    var source = favorite || {};
    var patch = isObject(overrides) ? overrides : {};
    var base = {
      id: source.id,
      name: source.title || 'Favorite',
      title: source.title || 'Favorite',
      price: Number(source.price || 0),
      quantity: Math.max(1, Number(source.quantity || 1) || 1),
      image: source.preview_image || source.image_url || '',
      previewStyle: buildSharedFavoritePreviewStyle(source),
      options: Array.isArray(source.selected_options)
        ? source.selected_options.map(cloneOption)
        : []
    };
    return Object.assign(base, patch);
  }

  function normalizeFavoriteMetadataLabel(value) {
    return toText(value)
      .replace(/^\s*view\s+/i, '')
      .replace(/\s+(swatch|option|accent)\s*$/i, '')
      .trim();
  }

  function isDesignSubmittedFavorite(favorite) {
    if (!favorite || typeof favorite !== 'object') return false;
    if (/^design-/i.test(toText(favorite.id))) return true;
    if (/custom design/i.test(toText(favorite.title || favorite.name))) return true;
    if (isDoormatFavoriteRecord(favorite)) return true;
    var selectedOptions = Array.isArray(favorite.selected_options) ? favorite.selected_options : [];
    return selectedOptions.some(function hasDesignOnlyRows(option) {
      var label = normalizeFavoriteMetadataLabel(option && option.label).toLowerCase();
      return label === 'wrap' || label === 'notes' || label === 'attachment';
    });
  }

  function isDoormatFavoriteRecord(favorite) {
    if (!favorite || typeof favorite !== 'object') return false;
    var productHandle = toText(favorite.product_handle || favorite.productHandle).toLowerCase();
    if (productHandle === 'doormat-custom' || productHandle === 'doormats-custom') {
      return true;
    }
    var productUrl = toText(
      favorite.product_url ||
      favorite.productUrl ||
      favorite.source_path
    )
      .split('?')[0]
      .split('#')[0]
      .toLowerCase();
    return productUrl === '/doormats' || productUrl === 'doormats.html';
  }

  function isAttireFavoriteRecord(favorite) {
    if (!favorite || typeof favorite !== 'object') return false;
    var productHandle = toText(favorite.product_handle || favorite.productHandle).toLowerCase();
    if (productHandle === 'attire-custom' || productHandle === 'attire-shirts-custom') {
      return true;
    }
    var productUrl = toText(
      favorite.product_url ||
      favorite.productUrl ||
      favorite.source_path
    )
      .split('?')[0]
      .split('#')[0]
      .toLowerCase();
    return productUrl === '/attire' || productUrl === 'attire.html';
  }

  function isCustomDesignFavoriteRecord(favorite) {
    if (!favorite || typeof favorite !== 'object') return false;
    if (isDoormatFavoriteRecord(favorite) || isAttireFavoriteRecord(favorite)) return false;
    var explicitType = toText(
      favorite.account_saved_item_type ||
        favorite.accountSavedItemType ||
        favorite.saved_item_type ||
        favorite.savedItemType ||
        favorite.type
    ).toLowerCase();
    if (explicitType === CUSTOM_DESIGN_TYPE) return true;
    var productUrl = toText(
      favorite.product_url ||
        favorite.productUrl ||
        favorite.source_path ||
        favorite.sourcePath
    )
      .split('?')[0]
      .split('#')[0]
      .toLowerCase();
    if (productUrl === '/customization' || productUrl === 'customization.html') return true;
    var payload = getFavoriteItemPayload(favorite);
    if (toText(payload.type).toLowerCase() === CUSTOM_DESIGN_TYPE) return true;
    if (isObject(payload.restore_state || payload.restoreState)) return true;
    return false;
  }

  function buildAttireCommerceMetadataFromFavorite(favorite, variantId, commerce) {
    if (!favorite || !commerce || typeof commerce.buildAttireLineItemMetadataFromLegacyItem !== 'function') {
      return null;
    }
    var uploadRef = getFavoriteUploadReference(favorite);
    return commerce.buildAttireLineItemMetadataFromLegacyItem({
      id: toText(variantId) || toText(favorite.variant_id) || favorite.id,
      variant_id: toText(variantId) || toText(favorite.variant_id),
      title: favorite.title || favorite.name || 'L.A.W. Attire',
      name: favorite.name || favorite.title || 'L.A.W. Attire',
      product_handle: toText(favorite.product_handle || favorite.productHandle) || 'attire-custom',
      product_url: toText(favorite.product_url || favorite.productUrl || favorite.source_path) || '/attire',
      variant_title: toText(favorite.variant_title || favorite.options_summary),
      price: toNumber(favorite.price),
      currency_code: toText(favorite.currency_code) || 'USD',
      quantity: Math.max(1, toNumber(favorite.quantity) || 1),
      image: toText(favorite.preview_image || favorite.image_url),
      description: toText(favorite.description || favorite.short_description),
      preview_style: toText(favorite.preview_style),
      selected_options: Array.isArray(favorite.selected_options)
        ? favorite.selected_options.map(cloneOption)
        : []
    }, uploadRef ? {
      name: uploadRef.filename,
      url: uploadRef.display_url || uploadRef.url,
      key: uploadRef.key,
      provider: uploadRef.provider,
      content_type: uploadRef.content_type,
      size: uploadRef.size
    } : {});
  }

  function buildCommerceMetadataFromFavorite(favorite) {
    if (!favorite || typeof favorite !== 'object') return {};

    var existingMetadata = isObject(favorite.line_item_metadata)
      ? sanitizeAccountPayload(favorite.line_item_metadata, 0, '')
      : null;
    var metadata = isObject(existingMetadata) ? cloneJsonValue(existingMetadata, {}) : {};
    var isDesign = isDesignSubmittedFavorite(favorite);
    var description = toText(favorite.short_description || favorite.description);
    var previewImage = toText(favorite.preview_image || favorite.image_url);
    var previewStyle = buildSharedFavoritePreviewStyle(favorite);
    var variantTitle = normalizeFavoriteMetadataLabel(favorite.variant_title || favorite.options_summary);
    var hasPrice =
      favorite.price !== null &&
      favorite.price !== undefined &&
      !(typeof favorite.price === 'string' && !toText(favorite.price));

    if (description) {
      metadata.product_description = description;
      if (isDesign) {
        metadata.design_product_description = description;
      }
    }

    if (previewImage) {
      metadata.preview_url = previewImage;
      if (isDesign) {
        metadata.design_preview_url = previewImage;
      }
    }

    if (previewStyle) {
      metadata.preview_style = previewStyle;
      if (isDesign) {
        metadata.design_preview_style = previewStyle;
      }
    }

    if (isDesign) {
      metadata.design_mode = 'custom';
      if (hasPrice) {
        metadata.design_total_price = toNumber(favorite.price);
      }
      if (toText(favorite.product_key || favorite.productKey)) {
        metadata.design_product_key = toText(favorite.product_key || favorite.productKey);
      }
      if (toText(favorite.product_handle)) {
        metadata.design_product_handle = toText(favorite.product_handle);
      }
      if (toText(favorite.product_id)) {
        metadata.design_product_id = toText(favorite.product_id);
      }
      if (toText(favorite.title || favorite.name)) {
        metadata.design_product_title = toText(favorite.title || favorite.name);
      }
      if (toText(favorite.variant_id)) {
        metadata.design_variant_id = toText(favorite.variant_id);
      }
    }

    var selectedOptions = Array.isArray(favorite.selected_options) ? favorite.selected_options : [];
    selectedOptions.forEach(function eachOption(option) {
      var label = normalizeFavoriteMetadataLabel(option && option.label).toLowerCase();
      var value = toText(option && option.value);
      var swatchStyle = toText(option && option.swatch_style);
      var swatchGlyph = toText(option && option.swatch_glyph);
      var attachmentKey = toText(option && (option.attachment_key || option.attachmentKey));
      if (!label || !value) return;

      if (isDesign) {
        if (label === 'color') {
          metadata.design_color_label = value;
          if (swatchStyle) metadata.design_color_style = swatchStyle;
          if (swatchGlyph) metadata.design_color_glyph = swatchGlyph;
          return;
        }
        if (label === 'accessory') {
          metadata.design_accessory_label = value;
          if (swatchStyle) metadata.design_accessory_style = swatchStyle;
          if (swatchGlyph) metadata.design_accessory_glyph = swatchGlyph;
          return;
        }
        if (label === 'wrap') {
          metadata.design_wrap_label = value;
          return;
        }
        if (label === 'size') {
          metadata.design_size_label = value;
          return;
        }
        if (label === 'notes') {
          metadata.design_notes = value;
          return;
        }
        if (label === 'attachment') {
          var uploadRef = getFavoriteUploadReference(favorite) || normalizeUploadReference({
            key: attachmentKey,
            filename: value,
            url: option && (option.attachment_url || option.attachmentUrl),
            provider: option && (option.attachment_provider || option.attachmentProvider),
            content_type: option && (option.attachment_content_type || option.attachmentContentType),
            size: option && (option.attachment_size || option.attachmentSize),
            route: favorite.source_path || favorite.product_url
          });
          metadata.design_attachment_name = stripAttachmentReferenceNote(value);
          if (uploadRef) {
            Object.assign(metadata, buildUploadAttachmentMetadata(uploadRef));
          }
        }
        return;
      }

      if (label === 'color') {
        metadata.selected_color_label = value;
        if (swatchStyle) metadata.selected_color_style = swatchStyle;
        if (swatchGlyph) metadata.selected_color_glyph = swatchGlyph;
        if (!metadata.variant_label) {
          metadata.variant_label = value;
          metadata.variant_type = 'color';
          if (swatchStyle) metadata.variant_style = swatchStyle;
          if (swatchGlyph) metadata.variant_glyph = swatchGlyph;
        }
        return;
      }

      if (label === 'accessory') {
        metadata.selected_accessory_label = value;
        if (swatchStyle) metadata.selected_accessory_style = swatchStyle;
        if (swatchGlyph) metadata.selected_accessory_glyph = swatchGlyph;
        if (!metadata.variant_label) {
          metadata.variant_label = value;
          metadata.variant_type = 'accessory';
          if (swatchStyle) metadata.variant_style = swatchStyle;
          if (swatchGlyph) metadata.variant_glyph = swatchGlyph;
        }
        return;
      }

      if (!metadata.variant_label) {
        metadata.variant_label = value;
      }
    });

    if (!isDesign && !metadata.variant_label && variantTitle) {
      metadata.variant_label = variantTitle;
    }

    return Object.keys(metadata).reduce(function reduceMetadata(result, key) {
      var value = metadata[key];
      if (value === null || value === undefined) return result;
      if (typeof value === 'string' && !toText(value)) return result;
      result[key] = value;
      return result;
    }, {});
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
    if (!event || event.key !== STORAGE_KEY) {
      if (event && event.key === LEGACY_STORAGE_KEY) cleanupLegacyFavoriteStorage();
      return;
    }
    if (accountMode) return;
    var nextState = loadStateFromStorage();
    var prevSerialized = serializeState(state);
    var nextSerialized = serializeState(nextState);
    if (prevSerialized === nextSerialized) return;
    state = nextState;
    emitChange('storage_sync', { key: STORAGE_KEY });
  }

  function handleAuthChange(event) {
    var detail = event && event.detail && typeof event.detail === 'object' ? event.detail : {};
    if (detail.state === 'logged-out') {
      exitAccountMode('account_logout');
      return;
    }
    refreshAccountFavorites({ force: true });
  }

  state = loadStateFromStorage();

  if (typeof global.addEventListener === 'function') {
    global.addEventListener('storage', handleStorageEvent);
    global.addEventListener(AUTH_CHANGE_EVENT, handleAuthChange);
  }

  var publicApi = {
    __sharedStore: true,
    version: STORE_VERSION,
    storageKey: STORAGE_KEY,
    legacyStorageKey: LEGACY_STORAGE_KEY,
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
    buildCommerceMetadataFromFavorite: buildCommerceMetadataFromFavorite,
    buildAttireCommerceMetadataFromFavorite: buildAttireCommerceMetadataFromFavorite,
    buildUploadAttachmentMetadata: buildUploadAttachmentMetadata,
    ensurePersistentUploadReference: ensurePersistentUploadReference,
    getFavoriteUploadReference: getFavoriteUploadReference,
    isPersistentUploadReference: isPersistentUploadReference,
    isCustomDesignFavorite: isCustomDesignFavoriteRecord,
    isAccountMode: function isAccountMode() {
      return Boolean(accountMode);
    },
    refreshAccountFavorites: refreshAccountFavorites,
    setMoveToCartAdapter: setMoveToCartAdapter,
    moveFavoriteToCart: moveFavoriteToCart,
    reloadFromStorage: function reloadFromStorage() {
      if (accountMode) {
        refreshAccountFavorites();
        return getFavorites();
      }
      state = loadStateFromStorage();
      emitChange('reload', {});
      return getFavorites();
    }
  };

  global.ldcFavorites = publicApi;

  if (getStoreApiConfig().enabled) {
    global.setTimeout(refreshAccountFavorites, 0);
  }
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
  var THEME_STYLESHEET_ID = 'ldc-favorites-theme-link';
  var THEME_STYLESHEET_HREF = 'favorites-theme.css';
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

  function isObject(value) {
    return !!value && Object.prototype.toString.call(value) === '[object Object]';
  }

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

  function ensureThemeStylesheet() {
    if (document.getElementById(THEME_STYLESHEET_ID)) return;
    var existing = document.querySelector('link[href*="' + THEME_STYLESHEET_HREF + '"]');
    if (existing) {
      existing.id = THEME_STYLESHEET_ID;
      return;
    }
    var link = document.createElement('link');
    link.id = THEME_STYLESHEET_ID;
    link.rel = 'stylesheet';
    link.href = THEME_STYLESHEET_HREF;
    document.head.appendChild(link);
  }

  function ensureStyles() {
    if (document.getElementById(UI_STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = UI_STYLE_ID;
    style.textContent = [
      '.ldc-favorites-drawer{position:fixed;inset:0;z-index:1300;pointer-events:none;}',
      '.ldc-favorites-drawer.is-open{pointer-events:auto;}',
      '.ldc-favorites-drawer .favorites-overlay{position:absolute;inset:0;}',
      '.ldc-favorites-drawer .favorites-panel{position:absolute;top:0;right:0;height:100%;width:min(28rem,94vw);display:flex;flex-direction:column;transform:translateX(108%);transition:transform 210ms ease;}',
      '.ldc-favorites-drawer.is-open .favorites-panel{transform:translateX(0);}',
      '.ldc-favorites-drawer .favorites-body{flex:1 1 auto;overflow:auto;}',
      '.tile-action-favorite.is-active,.tile-action-favorite.favorites-active,.ldc-home-tile .tile-action-favorite.is-active,.ldc-home-tile .tile-action-favorite.favorites-active{background:rgba(244,114,182,.18)!important;color:#e11d48!important;border-color:rgba(225,29,72,.45)!important;box-shadow:0 12px 28px rgba(255,92,168,.25)!important;}',
      '.tile-action-favorite.is-active svg,.tile-action-favorite.favorites-active svg,.ldc-home-tile .tile-action-favorite.is-active svg,.ldc-home-tile .tile-action-favorite.favorites-active svg{color:currentColor!important;fill:currentColor!important;}'
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
        '<div class="favorites-overlay" data-favorites-overlay></div>',
        '<aside class="favorites-panel favorites-card ldc-favorites-panel" data-favorites-panel role="dialog" aria-modal="true" aria-label="Favorites drawer" aria-hidden="true" tabindex="-1">',
        '  <header class="favorites-header">',
        '    <h2 class="favorites-title">Your Favorites</h2>',
        '    <button type="button" class="favorites-close-btn" data-favorites-close aria-label="Close favorites">×</button>',
        '  </header>',
        '  <div class="favorites-body" data-favorites-items aria-live="polite"></div>',
        '  <footer class="favorites-footer">',
        '    <a class="favorites-btn favorites-cta" data-favorites-cta href="favorites.html">Favorites</a>',
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
    var swatches = Array.prototype.slice.call(card ? card.querySelectorAll('.swatch') : []);
    var hasPrimarySwatches = swatches.some(function hasPrimary(swatch) {
      return toText(swatch && swatch.dataset && swatch.dataset.swatchType).toLowerCase() !== 'accessory';
    });
    var hasAccessorySwatches = swatches.some(function hasAccessory(swatch) {
      return toText(swatch && swatch.dataset && swatch.dataset.swatchType).toLowerCase() === 'accessory';
    });

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

    if (hasPrimarySwatches || !swatches.length) {
      pushOption('Color', card.dataset.selectedColorLabel || card.dataset.selectedColor, card.dataset.selectedColorStyle, card.dataset.selectedColorGlyph);
    }
    if (hasAccessorySwatches) {
      pushOption('Accessory', card.dataset.selectedAccessoryLabel || card.dataset.selectedAccessory, card.dataset.selectedAccessoryStyle, card.dataset.selectedAccessoryGlyph);
    }
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
    button.classList.toggle('favorites-active', Boolean(isActive));
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
      var matched = api.getFavoriteById(payload);
      var matchedId = toText(matched && (matched.id || matched.favorite_key));
      if (matchedId) {
        button.dataset.favoriteId = matchedId;
      } else if (favoriteId) {
        button.dataset.favoriteId = favoriteId;
      }
      setHeartState(button, Boolean(matched));
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

  function normalizeFavoriteDetailRow(rawRow) {
    if (!rawRow) return null;
    var label = cleanLabel(rawRow.label);
    var value = toText(rawRow.value);
    if (!label || !value) return null;
    var normalizedLabel = label.toLowerCase();
    var kind =
      normalizedLabel === 'color'
        ? 'color'
        : normalizedLabel === 'accessory'
          ? 'accessory'
          : 'text';
    var swatchStyle = toText(rawRow.swatch_style || rawRow.swatchStyle);
    var swatchGlyph = toText(rawRow.swatch_glyph || rawRow.swatchGlyph);
    if ((kind === 'color' || kind === 'accessory') && !swatchStyle) {
      swatchStyle = kind === 'accessory' ? 'background:#d8b4fe;' : 'background:#e2e8f0;';
    }
    return {
      label: label,
      value: value,
      kind: kind,
      swatch_style: swatchStyle,
      swatch_glyph: swatchGlyph,
      isTextSwatch: /[A-Za-z]/.test(swatchGlyph)
    };
  }

  function findFavoriteOption(item, targetLabel) {
    var normalizedTarget = cleanLabel(targetLabel).toLowerCase();
    if (!normalizedTarget) return null;
    var selectedOptions = Array.isArray(item && item.selected_options) ? item.selected_options : [];
    return selectedOptions.find(function findOption(option) {
      return cleanLabel(option && option.label).toLowerCase() === normalizedTarget;
    }) || null;
  }

  function isDoormatPreviewRecord(item) {
    if (!item || typeof item !== 'object') return false;
    var productHandle = toText(item.product_handle || item.productHandle).toLowerCase();
    if (productHandle === 'doormat-custom' || productHandle === 'doormats-custom') {
      return true;
    }
    var productUrl = toText(
      item.product_url ||
      item.productUrl ||
      item.source_path
    )
      .split('?')[0]
      .split('#')[0]
      .toLowerCase();
    return productUrl === '/doormats' || productUrl === 'doormats.html';
  }

  function getDoormatPreviewFillStyle(item) {
    if (!isDoormatPreviewRecord(item)) return '';
    var colorOption = findFavoriteOption(item, 'Color');
    var swatchStyle = toText(
      colorOption && (
        colorOption.swatch_style ||
        colorOption.swatchStyle
      )
    );
    var match = swatchStyle.match(/background(?:-color)?\s*:\s*([^;]+)/i);
    var fillColor = toText(match && match[1]) || '#d2b48c';
    return fillColor ? 'background-color:' + fillColor + ';' : '';
  }

  function buildFavoritePreviewStyle(item) {
    var image = getPreviewForItem(item);
    var previewStyle = toText(item && item.preview_style);
    var fillStyle = getDoormatPreviewFillStyle(item);
    if (previewStyle && (!fillStyle || /background(?:-color)?\s*:/i.test(previewStyle))) {
      return previewStyle;
    }
    if (previewStyle && fillStyle) {
      return fillStyle + ' ' + previewStyle;
    }
    if (image) {
      return [
        fillStyle,
        "background-image:url('" + image.replace(/'/g, "\\'") + "')",
        'background-size:cover',
        'background-position:center',
        'background-repeat:no-repeat'
      ].filter(Boolean).join('; ') + ';';
    }
    return fillStyle;
  }

  function getFavoriteDetailRows(item) {
    var rows = [];
    var description = toText(item && (item.short_description || item.description));
    if (description) {
      rows.push({ label: 'Description', value: description });
    }

    var selectedOptions = Array.isArray(item && item.selected_options) ? item.selected_options : [];
    selectedOptions.forEach(function eachOption(option) {
      var normalized = normalizeFavoriteDetailRow(option);
      if (normalized) rows.push(normalized);
    });

    if (!selectedOptions.length) {
      var variantText = toText(item && (item.options_summary || item.variant_title));
      if (variantText) {
        rows.push({ label: 'Variant', value: variantText });
      }
    }

    return rows
      .map(function mapRow(row) {
        return row && row.kind ? row : normalizeFavoriteDetailRow(row);
      })
      .filter(Boolean);
  }

  function renderFavoriteDetailsMarkup(item) {
    var rows = getFavoriteDetailRows(item);
    if (!rows.length) return '';
    return [
      '<ul class="favorites-item-details">',
      rows.map(function mapRow(row) {
        var rowClasses = ['favorites-item-detail'];
        if (row.kind === 'color' || row.kind === 'accessory') {
          rowClasses.push('is-icon-row', 'is-inline-row');
        } else {
          rowClasses.push('is-text-row');
        }
        var swatch = '';
        if (row.kind === 'color' || row.kind === 'accessory') {
          swatch = [
            '<span class="favorites-item-swatch',
            row.isTextSwatch ? ' is-text' : '',
            '" style="',
            escapeHtml(row.swatch_style),
            '">',
            escapeHtml(row.swatch_glyph),
            '</span>'
          ].join('');
        }
        return [
          '<li class="', rowClasses.join(' '), '">',
          '<span class="label">', escapeHtml(row.label), '</span>',
          '<span class="favorites-item-detail-body">',
          swatch,
          '<span class="value">', escapeHtml(row.value), '</span>',
          '</span>',
          '</li>'
        ].join('');
      }).join(''),
      '</ul>'
    ].join('');
  }

  function getPreviewForItem(item) {
    var image = toText(item.preview_image || item.image_url);
    var style = toText(item.preview_style);
    if (!image && style) {
      image = extractImageUrlFromStyle(style);
    }
    return image;
  }

  function getPrimaryActionLabel(item) {
    return 'Move to Cart';
  }

  function getPrimaryActionMarkup(item) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5"><path d="M2.25 2.25a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 .728.568l.432 1.864h13.134a.75.75 0 0 1 .732.928l-1.5 6a.75.75 0 0 1-.732.572H8.715l.3 1.5H18a.75.75 0 1 1 0 1.5H8.25a.75.75 0 0 1-.732-.568L5.4 3.75H3a.75.75 0 0 1-.75-.75Zm4.5 16.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Zm9 0a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Z" /></svg>';
  }

  function syncFavoritePreviewFrames(root) {
    var scope = root && typeof root.querySelectorAll === 'function' ? root : document;
    Array.prototype.slice.call(scope.querySelectorAll('[data-favorite-id]')).forEach(function eachCard(card) {
      var id = toText(card.getAttribute('data-favorite-id'));
      var preview = card.querySelector('.favorites-item-preview');
      if (!id || !preview) return;
      var item = api.getFavoriteById(id);
      if (!item) return;
      var previewStyle = buildFavoritePreviewStyle(item);
      if (previewStyle) {
        preview.setAttribute('style', previewStyle);
      } else {
        preview.removeAttribute('style');
      }
    });
  }

  var previewFrameSyncQueued = false;
  function queueFavoritePreviewFrameSync() {
    if (previewFrameSyncQueued) return;
    previewFrameSyncQueued = true;
    global.requestAnimationFrame(function syncPreviewFrames() {
      previewFrameSyncQueued = false;
      syncFavoritePreviewFrames(document);
    });
  }

  function renderDrawerItems() {
    if (!ui.itemsContainer) return;
    var items = api.getFavorites();
    if (!items.length) {
      ui.itemsContainer.innerHTML = '<div class="favorites-empty">No favorites yet.</div>';
      return;
    }

    var markup = items.map(function mapItem(item) {
      var id = escapeHtml(item.id);
      var title = escapeHtml(item.title || 'Favorite');
      var price = escapeHtml(formatPrice(item.price, item.currency_code));
      var image = getPreviewForItem(item);
      var previewFrameStyle = buildFavoritePreviewStyle(item);
      var imageHtml = image
        ? '<img src="' + escapeHtml(image) + '" alt="' + title + '" loading="lazy" />'
        : '';
      var productUrl = toText(item.product_url);
      var titleContent = productUrl
        ? '<a class="favorites-item-name" href="' + escapeHtml(productUrl) + '">' + title + '</a>'
        : '<div class="favorites-item-name">' + title + '</div>';
      var detailsMarkup = renderFavoriteDetailsMarkup(item);
      var actionLabel = escapeHtml(getPrimaryActionLabel(item));
      var actionMarkup = getPrimaryActionMarkup(item);
      return [
        '<article class="favorites-item" data-favorite-id="', id, '">',
        '  <div class="favorites-item-main">',
        '    <div class="favorites-item-preview"', previewFrameStyle ? ' style="' + escapeHtml(previewFrameStyle) + '"' : '', '>', imageHtml, '</div>',
        '    <div class="favorites-item-info">',
        '      ', titleContent,
        '      <div class="favorites-item-summary-row">',
        '        <div class="favorites-item-price">', price, '</div>',
        '        <div class="favorites-item-actions">',
        '          <button type="button" class="favorites-move-btn" data-favorite-add-cart aria-label="', actionLabel, ' ', title, '">',
        '            ', actionMarkup,
        '          </button>',
        '          <button type="button" class="favorites-remove-btn" data-favorite-remove aria-label="Remove ', title, '">×</button>',
        '        </div>',
        '      </div>',
        '    </div>',
        '  </div>',
        detailsMarkup ? '  ' + detailsMarkup : '',
        '</article>'
      ].join('');
    }).join('');

    ui.itemsContainer.innerHTML = markup;
    queueFavoritePreviewFrameSync();
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
    if (!addButton || !commerce) {
      return Promise.resolve(favorite);
    }
    var resolver = typeof commerce.resolveCartEntryForButton === 'function'
      ? commerce.resolveCartEntryForButton(addButton)
      : typeof commerce.resolveVariantId === 'function'
        ? commerce.resolveVariantId(addButton)
        : null;
    if (!resolver) {
      return Promise.resolve(favorite);
    }
    return Promise.resolve(resolver)
      .then(function onResolved(result) {
        var variantId = toText(isObject(result) ? result.variantId : result);
        if (toText(variantId)) {
          favorite.variant_id = variantId;
          card.dataset.selectedVariantId = variantId;
        }
        return favorite;
      })
      .catch(function onError() {
        return favorite;
      });
  }

  function resolveCartEntryForMove(favorite) {
    var commerce = global.LDCCommerce;
    var explicitVariantId = toText(
      favorite && (
        favorite.variant_id ||
        favorite.variantId ||
        favorite.selected_variant_id ||
        favorite.selectedVariantId
      )
    );
    var allowCustomDesignVariantFallback = Boolean(
      explicitVariantId &&
        api &&
        typeof api.isCustomDesignFavorite === 'function' &&
        api.isCustomDesignFavorite(favorite)
    );
    if (!commerce) {
      return Promise.resolve({
        variantId: explicitVariantId
      });
    }

    if (typeof commerce.resolveCartEntryForFavorite === 'function') {
      return Promise.resolve(commerce.resolveCartEntryForFavorite(favorite))
        .then(function onResolved(result) {
          var resolved = isObject(result)
            ? result
            : { variantId: toText(result) };
          if (!toText(resolved.variantId) && allowCustomDesignVariantFallback) {
            return Object.assign({}, resolved, {
              variantId: explicitVariantId,
              source: 'custom_design_variant_fallback'
            });
          }
          return resolved;
        })
        .catch(function onError() {
          return allowCustomDesignVariantFallback
            ? { variantId: explicitVariantId, source: 'custom_design_variant_fallback' }
            : { variantId: '' };
        });
    }

    if (typeof commerce.resolveVariantIdForFavorite !== 'function') {
      return Promise.resolve({
        variantId: allowCustomDesignVariantFallback ? explicitVariantId : ''
      });
    }

    return Promise.resolve(commerce.resolveVariantIdForFavorite(favorite))
      .then(function onResolved(variantId) {
        return {
          variantId: toText(variantId) || (allowCustomDesignVariantFallback ? explicitVariantId : '')
        };
      })
      .catch(function onError() {
        return {
          variantId: allowCustomDesignVariantFallback ? explicitVariantId : ''
        };
      });
  }

  function defaultMoveToCartAdapter(favorite, payload) {
    var buildCartItem = payload && typeof payload.buildCartItem === 'function'
      ? payload.buildCartItem
      : function identity(overrides) { return Object.assign({}, favorite, overrides || {}); };
    var context = payload && payload.context && typeof payload.context === 'object'
      ? payload.context
      : {};
    var commerce = global.LDCCommerce;
    var moveQuantity = Math.max(1, Number(favorite && favorite.quantity || 1) || 1);
    if (commerce && commerce.enabled) {
      if (typeof commerce.addLineItem !== 'function') {
        return {
          ok: false,
          reason: 'commerce_add_unavailable',
          user_message: 'Cart service is unavailable on this page.',
          id: favorite.id
        };
      }

      return resolveCartEntryForMove(favorite).then(function onVariantResolved(resolution) {
        var variantId = toText(resolution && resolution.variantId);
        if (!variantId) {
          var resolvedReason = toText(resolution && resolution.reason) || 'missing_variant_id';
          var resolvedMessage = toText(resolution && resolution.userMessage);
          return {
            ok: false,
            reason: resolvedReason,
            user_message: resolvedMessage || (
              resolvedReason === 'selection_required'
                ? 'Select this product again before moving it to cart.'
                : 'Unavailable'
            ),
            id: favorite.id
          };
        }

        favorite.variant_id = variantId;
        var uploadReferenceReady = typeof api.ensurePersistentUploadReference === 'function'
          ? api.ensurePersistentUploadReference(favorite)
          : Promise.resolve(favorite);
        return uploadReferenceReady
          .then(function onUploadReady(uploadReadyFavorite) {
            favorite = uploadReadyFavorite || favorite;
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
            var metadata = null;
            var attireProductHandle = toText(favorite.product_handle || favorite.productHandle).toLowerCase();
            var attireProductUrl = toText(
              favorite.product_url ||
              favorite.productUrl ||
              favorite.source_path
            )
              .split('?')[0]
              .split('#')[0]
              .toLowerCase();
            var isAttireFavorite =
              attireProductHandle === 'attire-custom' ||
              attireProductHandle === 'attire-shirts-custom' ||
              attireProductUrl === '/attire' ||
              attireProductUrl === 'attire.html';
            if (
              isAttireFavorite &&
              commerce &&
              typeof commerce.buildAttireLineItemMetadataFromLegacyItem === 'function' &&
              typeof api.buildAttireCommerceMetadataFromFavorite === 'function'
            ) {
              metadata = api.buildAttireCommerceMetadataFromFavorite(favorite, variantId, commerce);
            }
            if (!isObject(metadata)) {
              metadata = typeof api.buildCommerceMetadataFromFavorite === 'function'
                ? api.buildCommerceMetadataFromFavorite(favorite)
                : {};
            }

            return Promise.resolve(commerce.addLineItem(variantId, moveQuantity, metadata))
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
              });
          })
          .catch(function onFailure(error) {
            var classified = typeof commerce.classifyCartMutationError === 'function'
              ? commerce.classifyCartMutationError(error)
              : null;
            var reason = toText(error && error.reason) || toText(classified && classified.reason) || 'medusa_add_failed';
            var userMessage =
              toText(error && error.userMessage) ||
              toText(error && error.user_message) ||
              toText(classified && classified.userMessage) ||
              'Unable to move this favorite to cart right now.';
            return {
              ok: false,
              reason: reason,
              user_message: userMessage,
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
          var commerce = global.LDCCommerce;
          if (result && result.user_message && commerce && typeof commerce.showStatusMessage === 'function') {
            commerce.showStatusMessage(result.user_message, 'error');
          }
        } else if (result.redirect_url) {
          global.location.href = result.redirect_url;
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
    ensureThemeStylesheet();
    ensureStyles();
    ensureDrawerStructure();
    renderDrawerItems();
    syncHeartButtons();
    updateBadgesAndOpeners();
    queueFavoritePreviewFrameSync();
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
    global.addEventListener('load', function onWindowLoad() {
      syncHeartButtons();
      queueFavoritePreviewFrameSync();
    });
    global.requestAnimationFrame(queueFavoritePreviewFrameSync);
  }

  syncUi();
  api.getFavoriteDetailRows = getFavoriteDetailRows;
  api.renderFavoriteDetailsMarkup = renderFavoriteDetailsMarkup;
  api.getFavoritePrimaryActionLabel = getPrimaryActionLabel;
  attachListeners();

  global.ldcFavoritesUI = {
    openDrawer: openDrawer,
    closeDrawer: closeDrawer,
    sync: syncUi
  };
})(window);
