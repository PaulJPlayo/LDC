(() => {
  const body = document.body;
  if (!body) return;

  const enabled = body.dataset.medusaEnabled === 'true' || window.LDC_MEDUSA_ENABLED === true;
  if (!enabled) return;

  const backendUrlRaw = body.dataset.medusaBackend || window.LDC_MEDUSA_BACKEND || '';
  const backendUrl = backendUrlRaw.replace(/\/$/, '');
  if (!backendUrl) {
    console.warn('[commerce] Medusa backend URL is missing.');
    return;
  }
  const publishableKey =
    body.dataset.medusaPublishableKey ||
    window.LDC_MEDUSA_PUBLISHABLE_KEY ||
    'pk_427f7900e23e30a0e18feaf0604aa9caaa9d0cb21571889081d2cb93fb13ffb0';
  const debugEnabled = body.dataset.medusaDebug === 'true' || window.LDC_MEDUSA_DEBUG === true;
  const STOREFRONT_BUILD_SHA = '79b96bd';
  const STOREFRONT_BUILD_UTC = '2026-02-24T17:43:05.487Z';
  console.info(
    '[storefront-build]',
    STOREFRONT_BUILD_SHA,
    STOREFRONT_BUILD_UTC,
    `path=${window.location.pathname}`
  );

  const CART_ID_KEY = 'ldc:medusa:cart_id';
  const LEGACY_CART_KEY = 'ldc:cart';
  const CART_AUDIT_STORAGE_KEY = 'LDC_CART_ADD_FAILS';
  const CART_AUDIT_LIMIT = 200;
  const DEFAULT_LOCALE = 'en-US';
  const CART_DISPLAY_MONEY_FIELDS = [
    'subtotal',
    'total',
    'shipping_total',
    'tax_total',
    'discount_total',
    'item_subtotal'
  ];
  const LINE_ITEM_DISPLAY_MONEY_FIELDS = [
    'unit_price',
    'subtotal',
    'total',
    'tax_total',
    'discount_total'
  ];
  const badgeEls = Array.from(document.querySelectorAll('[data-cart-count]'));
  const productMapUrl = body.dataset.productMap || window.LDC_PRODUCT_MAP || 'product-map.json';
  let productMapPromise = null;
  let productMapCache = null;
  let storeProductsPromise = null;
  let productIndexPromise = null;
  let regionIdPromise = null;
  const missingSwatchMeta = new Set();
  let gridDiscoveryLogged = false;
  const managedSectionKeys = new Set([
    'home-tumblers',
    'home-cups',
    'home-accessories',
    'tumblers',
    'cups',
    'accessories',
    'new-arrivals',
    'best-sellers',
    'restock',
    'deals',
    'under-25',
    'last-chance'
  ]);
  const HOMEPAGE_TILE_STYLE_ID = 'ldc-home-tile-styles';
  const SWATCH_DOT_SIZE = '1.25rem';
  const MAX_VISIBLE_SWATCHES = 4;
  const ALLOWED_SWATCH_STYLE_PROPS = new Set([
    'background',
    'background-color',
    'background-image',
    'background-position',
    'background-repeat',
    'background-size',
    'border',
    'border-color',
    'box-shadow',
    'color',
    'opacity',
    'outline',
    'outline-color'
  ]);
  const BLOCKED_SWATCH_STYLE_VALUE_RE = /(javascript:|expression\s*\()/i;
  const HOMEPAGE_TILE_TEMPLATE_HTML = `
<div class="group relative product-card ldc-home-tile">
  <div class="aspect-[4/5] w-full rounded-lg ldc-tile-media tile-mauve border border-slate-200 flex items-center justify-center overflow-hidden relative">
    <div class="badge-stack">
      <span class="inline-block rounded bg-emerald-600 text-white px-3 py-0.5" data-product-badge style="display:none;"></span>
    </div>
    <img src="" alt="" class="h-full w-full object-cover" loading="lazy" data-product-image />
  </div>
  <div class="mt-4 w-full flex-1 flex flex-col" data-tile-body>
    <div class="w-full" data-tile-swatches>
      <div class="tile-swatches w-full flex flex-col gap-2">
        <div class="flex items-center gap-1 swatch-slider w-full" data-swatch-slider data-swatch-kind="primary" data-visible="4">
          <button type="button" class="w-8 h-8 inline-flex items-center justify-center" style="background:transparent;border:none;box-shadow:none;padding:0;color:inherit;" data-swatch-prev aria-label="Previous color">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m15 19-7-7 7-7"/></svg>
          </button>
          <div class="relative" data-swatch-window>
            <div class="flex items-center gap-2 transition-transform duration-200" data-swatch-track></div>
          </div>
          <button type="button" class="w-8 h-8 inline-flex items-center justify-center" style="background:transparent;border:none;box-shadow:none;padding:0;color:inherit;" data-swatch-next aria-label="Next color">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m9 5 7 7-7 7"/></svg>
          </button>
        </div>
        <div class="flex items-center gap-1 swatch-slider w-full mt-1" data-swatch-slider data-swatch-kind="accessory" data-visible="1">
          <button type="button" class="w-8 h-8 inline-flex items-center justify-center" style="background:transparent;border:none;box-shadow:none;padding:0;color:inherit;" data-swatch-prev aria-label="Previous accessory">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m15 19-7-7 7-7"/></svg>
          </button>
          <div class="relative" data-swatch-window>
            <div class="flex items-center gap-2 transition-transform duration-200" data-swatch-track></div>
          </div>
          <button type="button" class="w-8 h-8 inline-flex items-center justify-center" style="background:transparent;border:none;box-shadow:none;padding:0;color:inherit;" data-swatch-next aria-label="Next accessory">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m9 5 7 7-7 7"/></svg>
          </button>
        </div>
      </div>
    </div>
    <div class="w-full" data-tile-meta>
      <div class="mt-1 text-xs ldc-tile-kicker" data-product-description></div>
      <div class="mt-2 ldc-tile-title-row">
        <a href="#" class="block font-semibold tile-title ldc-tile-title" data-product-title data-product-link></a>
      </div>
      <div class="text-sm ldc-tile-price" data-product-price></div>
      <div class="mt-1 flex items-center gap-1 rating ldc-tile-rating">
        <span class="star">☆</span><span class="star">☆</span><span class="star">☆</span><span class="star">☆</span><span class="star">☆</span>
        <span class="text-xs ldc-tile-rating-value">0.0 (0)</span>
      </div>
      <div class="mt-3 flex items-center gap-2" data-tile-actions>
        <a href="#section-customization" class="icon-button tile-action-design inline-flex items-center justify-center w-9 h-9" aria-label="Explore design options" title="Explore design options" data-design-source="" data-tile-design-action>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4">
            <path fill-rule="evenodd" d="M16.862 2.487a2.25 2.25 0 0 1 3.182 0l1.11 1.11a3.75 3.75 0 0 1 0 5.303l-8.92 8.92a4.5 4.5 0 0 1-2.038 1.159l-3.026.757a.75.75 0 0 1-.908-.908l.757-3.026a4.5 4.5 0 0 1 1.159-2.038l8.92-8.92a2.25 2.25 0 0 0 0-3.182l-1.11-1.11a.75.75 0 0 1 1.06-1.06Z" clip-rule="evenodd" />
            <path d="M4.5 17.25c.414 0 .75.336.75.75a1.5 1.5 0 0 1-1.5 1.5H3a.75.75 0 0 1 0-1.5h1.5a.75.75 0 0 0 .75-.75Z" />
          </svg>
        </a>
        <button type="button" class="icon-button tile-action-favorite inline-flex items-center justify-center w-9 h-9" aria-label="Add to favorites">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4">
            <path fill-rule="evenodd" d="M11.998 21.003 5.155 14.16a5.25 5.25 0 0 1 7.425-7.425l.42.42.42-.42a5.25 5.25 0 0 1 7.425 7.425l-6.843 6.843a1.5 1.5 0 0 1-2.122 0Z" clip-rule="evenodd" />
          </svg>
        </button>
        <button type="button" class="icon-button tile-action-cart inline-flex items-center justify-center w-9 h-9" aria-label="Add to cart" data-add-to-cart>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4">
            <path d="M2.25 2.25a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 .728.568l.432 1.864h13.134a.75.75 0 0 1 .732.928l-1.5 6a.75.75 0 0 1-.732.572H8.715l.3 1.5H18a.75.75 0 1 1 0 1.5H8.25a.75.75 0 0 1-.732-.568L5.4 3.75H3a.75.75 0 0 1-.75-.75Zm4.5 16.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Zm9 0a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Z" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</div>
`.trim();
  let sharedCardTemplate = null;

  const ensureHomepageTileStyles = () => {
    if (document.getElementById(HOMEPAGE_TILE_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = HOMEPAGE_TILE_STYLE_ID;
    style.textContent = `
.ldc-home-tile.product-card {
  background: linear-gradient(145deg, #e7c8ff 0%, #dcb8fb 100%) !important;
  border: 1px solid rgba(255, 255, 255, 0.28) !important;
  border-radius: 1rem !important;
  padding: 0.95rem !important;
  box-shadow: 0 14px 30px rgba(88, 53, 133, 0.2) !important;
  color: #ffffff !important;
  display: flex !important;
  flex-direction: column !important;
  height: 100% !important;
}
.ldc-home-tile .ldc-tile-media {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.45) 0%, rgba(255, 255, 255, 0.2) 100%) !important;
  border-color: rgba(255, 255, 255, 0.36) !important;
}
.ldc-home-tile [data-tile-body] {
  width: 100% !important;
  display: flex !important;
  flex-direction: column !important;
  flex: 1 1 auto !important;
  min-height: 0 !important;
}
.ldc-home-tile [data-tile-swatches] {
  width: 100% !important;
}
.ldc-home-tile [data-tile-meta] {
  width: 100% !important;
  margin-top: auto !important;
  display: flex !important;
  flex-direction: column !important;
  align-items: flex-start !important;
}
.ldc-home-tile .badge-stack {
  position: absolute !important;
  top: 0.75rem !important;
  right: 0.75rem !important;
  z-index: 2 !important;
}
.ldc-home-tile .badge-stack [data-product-badge] {
  font-size: 0.68rem !important;
  line-height: 1rem !important;
}
.ldc-home-tile .ldc-tile-kicker {
  color: rgba(255, 255, 255, 0.88) !important;
}
.ldc-home-tile .ldc-tile-title {
  display: block !important;
  width: 100% !important;
  color: #ffffff !important;
  text-decoration: none !important;
  text-align: left !important;
  justify-content: flex-start !important;
  margin-left: 0 !important;
  margin-right: auto !important;
}
.ldc-home-tile .ldc-tile-title-row {
  width: 100% !important;
  text-align: left !important;
}
.ldc-home-tile .ldc-tile-price {
  color: #ffffff !important;
  font-weight: 600 !important;
}
.ldc-home-tile .ldc-tile-rating,
.ldc-home-tile .ldc-tile-rating .star,
.ldc-home-tile .ldc-tile-rating-value {
  color: rgba(255, 255, 255, 0.86) !important;
}
.ldc-home-tile [data-tile-actions] {
  justify-content: flex-start !important;
}
.ldc-home-tile [data-swatch-slider] {
  width: 100% !important;
  display: flex !important;
  justify-content: center !important;
  align-items: center !important;
  min-height: 2.15rem !important;
  margin-left: 0 !important;
}
.ldc-home-tile [data-swatch-slider].hidden {
  display: none !important;
}
.ldc-home-tile [data-swatch-window] {
  box-sizing: border-box !important;
  overflow-x: hidden !important;
  overflow-y: visible !important;
  padding-block: 0.3rem !important;
  margin-block: -0.12rem !important;
}
.ldc-home-tile .swatch,
.ldc-home-tile [data-swatch-track] > * {
  width: ${SWATCH_DOT_SIZE} !important;
  height: ${SWATCH_DOT_SIZE} !important;
  min-width: ${SWATCH_DOT_SIZE} !important;
  min-height: ${SWATCH_DOT_SIZE} !important;
  border-radius: 9999px !important;
  flex: 0 0 auto !important;
  aspect-ratio: 1 / 1 !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  box-sizing: border-box !important;
  overflow: hidden !important;
}
.ldc-home-tile .icon-button {
  border-radius: 999px !important;
  border: 1px solid rgba(255, 255, 255, 0.28) !important;
  color: #ffffff !important;
  background: rgba(43, 15, 78, 0.35) !important;
}
.ldc-home-tile .icon-button:hover {
  background: rgba(255, 255, 255, 0.22) !important;
  border-color: rgba(255, 255, 255, 0.5) !important;
}
`;
    document.head.appendChild(style);
  };

  const request = async (path, options = {}) => {
    const url = `${backendUrl}${path}`;
    if (path.startsWith('/store/')) {
      console.info('[verify-publishable-key] Attaching publishable key.', publishableKey);
    }
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(publishableKey ? { 'x-publishable-api-key': publishableKey } : {}),
        ...(options.headers || {})
      },
      credentials: options.credentials || 'omit',
      mode: options.mode || 'cors',
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const error = new Error(text || `Request failed: ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  };

  const loadProductMap = async () => {
    if (!productMapPromise) {
      productMapPromise = fetch(productMapUrl, { credentials: 'same-origin' })
        .then(response => {
          if (!response.ok) throw new Error('Unable to load product map.');
          return response.json();
        })
        .then(map => {
          productMapCache = map;
          return map;
        })
        .catch(error => {
          console.warn('[commerce] Product map unavailable:', error);
          productMapCache = null;
          return null;
        });
    }
    return productMapPromise;
  };
  loadProductMap();

  const loadRegionId = async () => {
    if (!regionIdPromise) {
      regionIdPromise = request('/store/regions')
        .then(payload => payload?.regions?.[0]?.id || '')
        .catch(error => {
          console.warn('[commerce] Unable to load regions:', error);
          return '';
        });
    }
    return regionIdPromise;
  };

  const slugify = value =>
    String(value || '')
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

  const parseNumeric = value => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  const sortVariantsByRank = variants => {
    if (!Array.isArray(variants)) return [];
    const withIndex = variants.map((variant, index) => {
      const rankValue = Number(variant?.variant_rank);
      return {
        variant,
        index,
        rank: Number.isFinite(rankValue) ? rankValue : null
      };
    });
    const hasRank = withIndex.some(item => item.rank != null);
    if (!hasRank) return variants;
    return withIndex
      .sort((a, b) => {
        const aRank = a.rank ?? a.index;
        const bRank = b.rank ?? b.index;
        return aRank - bRank;
      })
      .map(item => item.variant);
  };

  const getSortedVariants = product =>
    sortVariantsByRank(Array.isArray(product?.variants) ? product.variants : []);

  const normalizeMetadata = metadata => {
    if (!metadata) return {};
    if (typeof metadata === 'object') return metadata;
    if (typeof metadata === 'string') {
      try {
        const parsed = JSON.parse(metadata);
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch (error) {
        return {};
      }
    }
    return {};
  };

  const normalizeSectionKey = key => {
    const normalized = slugify(String(key || '').replace(/^page-/, ''));
    if (normalized === 'sale') return 'deals';
    return normalized;
  };

  const parseStorefrontList = raw => {
    if (!raw) return [];
    if (Array.isArray(raw)) {
      return raw.map(entry => normalizeSectionKey(entry)).filter(Boolean);
    }
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.map(entry => normalizeSectionKey(entry)).filter(Boolean);
        }
        if (parsed && typeof parsed === 'object') {
          return Object.keys(parsed)
            .filter(key => parsed[key])
            .map(key => normalizeSectionKey(key))
            .filter(Boolean);
        }
      } catch (error) {
        return raw
          .split(',')
          .map(entry => normalizeSectionKey(entry))
          .filter(Boolean);
      }
    }
    if (raw && typeof raw === 'object') {
      return Object.keys(raw)
        .filter(key => raw[key])
        .map(key => normalizeSectionKey(key))
        .filter(Boolean);
    }
    return [];
  };

  const getStorefrontSections = product => {
    const metadata = normalizeMetadata(product?.metadata);
    const raw = metadata?.storefront_sections;
    const parsed = parseStorefrontList(raw);
    return Array.from(new Set(parsed));
  };

  const getStorefrontTileOverride = (product, sectionKey) => {
    const metadata = normalizeMetadata(product?.metadata);
    const base = normalizeMetadata(metadata?.storefront_tile);
    const sectionOverrides = normalizeMetadata(metadata?.storefront_tile_sections);
    const scoped = sectionOverrides && typeof sectionOverrides === 'object'
      ? normalizeMetadata(sectionOverrides?.[sectionKey])
      : {};
    return { ...base, ...scoped };
  };

  const getStorefrontOrderValue = (product, sectionKey) => {
    const metadata = normalizeMetadata(product?.metadata);
    let raw = metadata?.storefront_order;
    if (!raw) return null;
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw);
      } catch (error) {
        return parseNumeric(raw);
      }
    }
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'object' && raw) {
      const direct = parseNumeric(raw?.[sectionKey]);
      if (direct != null) return direct;
      return parseNumeric(raw?.default);
    }
    return null;
  };

  const getProductCollectionHandle = product => {
    const handle = product?.collection?.handle || product?.collection?.title || '';
    return slugify(handle);
  };

  const getProductTags = product => {
    const tags = Array.isArray(product?.tags) ? product.tags : [];
    return tags
      .map(tag => {
        if (typeof tag === 'string') return tag;
        return tag?.value || tag?.handle || tag?.title || '';
      })
      .filter(Boolean)
      .map(tag => slugify(tag));
  };

  const getVariantLabel = variant => {
    if (!variant) return '';
    const options = Array.isArray(variant.options) ? variant.options : [];
    const optionMatch = options.find(optionValue => {
      const title =
        optionValue?.option?.title ||
        optionValue?.option_title ||
        optionValue?.optionTitle ||
        '';
      return /style|color|accent/i.test(title);
    });
    const label = cleanVariantLabel(optionMatch?.value || variant.title || '');
    return label || 'Default';
  };

  const getVariantSwatchMeta = variant => {
    const metadata = normalizeMetadata(variant?.metadata);
    const style =
      metadata?.swatchStyle ||
      metadata?.swatch_style ||
      metadata?.swatch ||
      '';
    const glyph =
      metadata?.swatchGlyph ||
      metadata?.swatch_glyph ||
      '';
    const type =
      metadata?.swatchType ||
      metadata?.swatch_type ||
      '';
    const image =
      metadata?.preview_image ||
      metadata?.previewImage ||
      metadata?.image ||
      '';
    return { style, glyph, type, image };
  };

  const currencyDivisorCache = new Map();

  const getCurrencyCode = source => {
    const code =
      source?.currency_code ||
      source?.currencyCode ||
      source?.region?.currency_code ||
      source?.region?.currencyCode ||
      source?.cart?.currency_code ||
      source?.cart?.currencyCode ||
      source ||
      'USD';
    return String(code || 'USD').toUpperCase();
  };

  const getCurrencyDivisor = (currencyCode, locale = DEFAULT_LOCALE) => {
    const code = getCurrencyCode(currencyCode);
    const cacheKey = `${locale}:${code}`;
    if (currencyDivisorCache.has(cacheKey)) {
      return currencyDivisorCache.get(cacheKey);
    }
    let digits = 2;
    try {
      digits = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: code
      }).resolvedOptions().maximumFractionDigits;
    } catch (error) {
      digits = 2;
    }
    const safeDigits = Number.isInteger(digits) && digits >= 0 ? digits : 2;
    const divisor = 10 ** safeDigits;
    currencyDivisorCache.set(cacheKey, divisor);
    return divisor;
  };

  const toMajorUnits = (amountMinor, currencyCode, locale = DEFAULT_LOCALE) => {
    const value = Number(amountMinor);
    if (!Number.isFinite(value)) return 0;
    const divisor = getCurrencyDivisor(currencyCode, locale);
    if (!Number.isFinite(divisor) || divisor <= 0) return value;
    return value / divisor;
  };

  const formatMoneyFromMinor = (amountMinor, currencyCode = 'USD', locale = DEFAULT_LOCALE) => {
    const code = getCurrencyCode(currencyCode);
    const amountMajor = toMajorUnits(amountMinor, code, locale);
    if (!Number.isFinite(amountMajor)) return '';
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: code
      }).format(amountMajor);
    } catch (error) {
      return '';
    }
  };

  const formatCurrency = (amountMinor, currencyCode = 'USD') =>
    formatMoneyFromMinor(amountMinor, currencyCode);

  const normalizeMoneyValueForDisplay = (value, currencyCode, locale = DEFAULT_LOCALE) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return value;
    return toMajorUnits(numeric, currencyCode, locale);
  };

  const normalizeEntryMoneyFields = (entry, fields, currencyCode) => {
    if (!entry || typeof entry !== 'object') return entry;
    const normalized = { ...entry };
    fields.forEach(field => {
      if (!(field in normalized)) return;
      normalized[field] = normalizeMoneyValueForDisplay(normalized[field], currencyCode);
    });
    return normalized;
  };

  const normalizeCartForDisplay = cart => {
    if (!cart || typeof cart !== 'object') return cart;
    const currencyCode = getCurrencyCode(cart);
    const normalizedCart = normalizeEntryMoneyFields(
      cart,
      CART_DISPLAY_MONEY_FIELDS,
      currencyCode
    );
    if (Array.isArray(cart.items)) {
      normalizedCart.items = cart.items.map(item =>
        normalizeEntryMoneyFields(item, LINE_ITEM_DISPLAY_MONEY_FIELDS, currencyCode)
      );
    }
    return normalizedCart;
  };

  const normalizeCommerceResponseForDisplay = payload => {
    if (!payload || typeof payload !== 'object') return payload;
    if (payload.cart && typeof payload.cart === 'object') {
      return { ...payload, cart: normalizeCartForDisplay(payload.cart) };
    }
    if (Array.isArray(payload.carts)) {
      return {
        ...payload,
        carts: payload.carts.map(cart => normalizeCartForDisplay(cart))
      };
    }
    if (Array.isArray(payload.items) && payload.id) {
      return normalizeCartForDisplay(payload);
    }
    return payload;
  };

  const resolveAssetUrl = src => {
    if (!src) return '';
    if (/^https?:\/\//i.test(src)) return src;
    if (src.startsWith('//')) return `https:${src}`;
    if (src.startsWith('/')) return `${backendUrl}${src}`;
    return src;
  };

  const updateProductImage = (container, imageUrl, title, label) => {
    if (!container || !imageUrl) return;
    const resolved = resolveAssetUrl(imageUrl);
    const imageEl =
      container.querySelector('[data-product-image]') ||
      container.querySelector('.tile-mauve img') ||
      container.querySelector('.product-media img') ||
      container.querySelector('img');
    if (imageEl && resolved) {
      imageEl.setAttribute('src', resolved);
      if (title) {
        const altLabel = label ? `${title} - ${label}` : `${title} thumbnail`;
        imageEl.setAttribute('alt', altLabel);
      }
    }
  };

  const updateAddToCartVariant = (container, variantId) => {
    if (!container || !variantId) return;
    container.dataset.selectedVariantId = variantId;
    const button =
      container.querySelector('[data-add-to-cart]') ||
      container.querySelector('[data-add-to-cart][data-product-key]');
    if (button) {
      button.dataset.variantId = variantId;
      button.dataset.medusaVariantId = variantId;
    }
  };

  const getVariantImage = (variant, product) => {
    if (!variant && !product) return '';
    const meta = getVariantSwatchMeta(variant);
    return (
      meta.image ||
      variant?.thumbnail ||
      product?.thumbnail ||
      product?.images?.[0]?.url ||
      product?.images?.[0] ||
      ''
    );
  };

  const getProductPrice = (product, preferredVariantId) => {
    const variants = getSortedVariants(product);
    const preferredVariant =
      preferredVariantId && variants.length
        ? variants.find(variant => variant?.id === preferredVariantId)
        : null;
    const firstVariant = preferredVariant || variants[0];
    const priceData = firstVariant?.calculated_price;
    const amount =
      priceData?.calculated_amount ??
      priceData?.original_amount ??
      firstVariant?.prices?.[0]?.amount ??
      null;
    const currency =
      priceData?.currency_code ||
      firstVariant?.prices?.[0]?.currency_code ||
      product?.currency_code ||
      'USD';
    return amount != null ? { amount, currency } : null;
  };

  const updateProductPrice = (container, product, preferredVariantId, override = {}) => {
    if (!container || !product) return;
    const priceCandidates = [
      container.querySelector('[data-product-price]'),
      container.querySelector('.price-line'),
      container.querySelector('.product-price'),
      container.querySelector('.tile-price'),
      container.querySelector('.arrival-price'),
      container.querySelector('[data-price-value]')
    ].filter(Boolean);
    let priceEl = priceCandidates[0];
    if (!priceEl) {
      priceEl = Array.from(container.querySelectorAll('span, div')).find(node =>
        /\$\s*\d/.test(node.textContent || '')
      );
    }
    if (!priceEl) return;
    if (override?.hide_price) {
      priceEl.style.display = 'none';
      return;
    }
    priceEl.style.display = '';
    if (override?.price) {
      priceEl.textContent = String(override.price);
      return;
    }
    const priceInfo = getProductPrice(product, preferredVariantId);
    if (!priceInfo) return;
    const formatted = formatCurrency(priceInfo.amount, priceInfo.currency);
    if (formatted) {
      priceEl.textContent = formatted;
    }
  };

  const productFields = '+metadata';
  const productExpand = '';

  const buildStoreProductsParams = ({ limit, offset, regionId }) => {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    if (productFields) {
      params.set('fields', productFields);
    }
    if (productExpand) {
      params.set('expand', productExpand);
    }
    if (regionId) {
      params.set('region_id', regionId);
    }
    return params;
  };

  const buildMetadataProductsParams = ({ limit, offset, regionId, includePlus }) => {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    const metadataFields = includePlus
      ? '+id,+title,+handle,+metadata'
      : 'id,title,handle,metadata';
    params.set('fields', metadataFields);
    if (regionId) {
      params.set('region_id', regionId);
    }
    return params;
  };

  const buildMinimalProductsParams = ({ limit, offset, regionId }) => {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset)
    });
    if (regionId) {
      params.set('region_id', regionId);
    }
    return params;
  };

  const requestStoreProductsPage = async (paramsList) => {
    for (let index = 0; index < paramsList.length; index += 1) {
      const params = paramsList[index];
      if (!params) continue;
      try {
        const payload = await request(`/store/products?${params.toString()}`);
        if (debugEnabled) {
          console.debug(
            '[commerce] Products page fetched.',
            params.toString(),
            `attempt=${index + 1}`
          );
        }
        return payload;
      } catch (error) {
        if (debugEnabled) {
          console.debug(
            '[commerce] Products page fetch failed.',
            params.toString(),
            error
          );
        }
      }
    }
    console.warn('[commerce] Unable to fetch products.');
    return null;
  };

  const fetchStoreProducts = async () => {
    const limit = 200;
    let offset = 0;
    let results = [];
    let hasMore = true;
    const regionId = await loadRegionId();

    while (hasMore) {
      const params = buildStoreProductsParams({ limit, offset, regionId });
      const metadataParams = buildMetadataProductsParams({ limit, offset, regionId, includePlus: true });
      const metadataFallbackParams = buildMetadataProductsParams({
        limit,
        offset,
        regionId,
        includePlus: false
      });
      const fallbackParams = buildMinimalProductsParams({ limit, offset, regionId });
      const payload = await requestStoreProductsPage([
        params,
        metadataParams,
        metadataFallbackParams,
        fallbackParams
      ]);
      if (!payload) return results;

      const products = payload?.products || payload?.data || [];
      results = results.concat(products);
      if (!Array.isArray(products) || products.length < limit) {
        hasMore = false;
      } else {
        offset += limit;
      }
    }

    return results;
  };

  const loadStoreProducts = async () => {
    if (!storeProductsPromise) {
      storeProductsPromise = fetchStoreProducts();
    }
    return storeProductsPromise;
  };

  const loadProductIndex = async () => {
    if (!productIndexPromise) {
      productIndexPromise = loadStoreProducts().then(products => {
        const byHandle = new Map();
        const byId = new Map();
        (products || []).forEach(product => {
          const handle = product?.handle || product?.id;
          if (handle) byHandle.set(handle, product);
          if (product?.id) byId.set(product.id, product);
        });
        return { products: products || [], byHandle, byId };
      });
    }
    return productIndexPromise;
  };

  const getProductContainers = () => {
    const containers = new Map();
    const triggers = Array.from(document.querySelectorAll('[data-product-key]'));
    triggers.forEach(trigger => {
      const key = trigger.dataset.productKey || trigger.closest('[data-product-key]')?.dataset.productKey;
      if (!key) return;
      const container = getVariantContainer(trigger) || trigger.closest('.product-card') || trigger.closest('.group');
      if (container) {
        containers.set(container, key);
      }
    });
    return containers;
  };

  const getProductKeyFromContainer = container => {
    if (!container) return '';
    return (
      container.dataset.productKey ||
      container.querySelector('[data-product-key]')?.dataset.productKey ||
      ''
    );
  };

  const getSharedCardTemplate = () => {
    if (sharedCardTemplate) return sharedCardTemplate;
    ensureHomepageTileStyles();
    const wrapper = document.createElement('template');
    wrapper.innerHTML = HOMEPAGE_TILE_TEMPLATE_HTML;
    sharedCardTemplate = wrapper.content.firstElementChild || null;
    return sharedCardTemplate;
  };

  const resolveBadgeText = (overrides, metadata) => {
    const candidates = [
      overrides?.badge,
      overrides?.tile_badge,
      metadata?.storefront_badge,
      metadata?.tile_badge
    ];
    for (const value of candidates) {
      const text = String(value || '').trim();
      if (text) return text;
    }
    return '';
  };

  const isAccessoryProduct = (product, sectionKey) => {
    const metadata = normalizeMetadata(product?.metadata);
    const productKey = String(
      metadata?.product_key || metadata?.productKey || product?.handle || ''
    ).toLowerCase();
    if (productKey.startsWith('accessory-')) return true;
    if (getProductCollectionHandle(product) === 'accessories') return true;

    const normalizedSectionKey = normalizeSectionKey(sectionKey);
    if (normalizedSectionKey === 'accessories' || normalizedSectionKey === 'home-accessories') {
      return true;
    }
    return getStorefrontSections(product).some(
      section => section === 'accessories' || section === 'home-accessories'
    );
  };

  const updateProductCard = (container, product, preferredVariantId, sectionKey) => {
    if (!container || !product) return;
    const overrides = getStorefrontTileOverride(product, sectionKey);
    const metadata = normalizeMetadata(product?.metadata);
    const title = overrides?.title || product.title || '';
    if (title) {
      const titleEls = container.querySelectorAll(
        '[data-product-title], .tile-title, .product-title, .arrival-title, .hero-heading, h1, h2, h3'
      );
      titleEls.forEach(el => {
        if (!el) return;
        el.textContent = title;
      });
    }

    updateProductPrice(container, product, preferredVariantId, overrides);

    const linkUrl =
      overrides?.url ||
      overrides?.link ||
      metadata?.storefront_url ||
      metadata?.storefront_link ||
      '';
    if (linkUrl) {
      const linkEls = container.querySelectorAll(
        '[data-product-link], a.tile-title, a.product-title, a.arrival-title'
      );
      linkEls.forEach(el => {
        if (!el) return;
        el.setAttribute('href', linkUrl);
        if (title) {
          el.setAttribute('aria-label', `View ${title}`);
        }
      });
    }

    const description =
      overrides?.description ||
      overrides?.subtitle ||
      product.description ||
      product.subtitle ||
      '';
    if (description) {
      let descriptionEl =
        container.querySelector('[data-product-description]') ||
        container.querySelector('.product-description') ||
        container.querySelector('.product-details') ||
        container.querySelector('.tile-description') ||
        container.querySelector('.arrival-meta') ||
        null;
      if (!descriptionEl) {
        const meta = container.querySelector('.product-meta');
        if (meta) {
          descriptionEl = meta.querySelector('span') || meta;
        }
      }
      if (!descriptionEl) {
        const candidates = Array.from(
          container.querySelectorAll('div.text-xs.text-slate-600')
        );
        descriptionEl = candidates.find(el => !el.closest('.rating')) || null;
      }
      if (descriptionEl) {
        descriptionEl.textContent = description;
      }
    }

    const imageUrl =
      overrides?.image ||
      product.thumbnail ||
      product?.images?.[0]?.url ||
      product?.images?.[0] ||
      '';
    if (imageUrl) {
      const resolved = resolveAssetUrl(imageUrl);
      const imageEl =
        container.querySelector('[data-product-image]') ||
        container.querySelector('.tile-mauve img') ||
        container.querySelector('.product-media img') ||
        container.querySelector('img');
      if (imageEl && resolved) {
        imageEl.setAttribute('src', resolved);
        if (title) {
          imageEl.setAttribute('alt', `${title} thumbnail`);
        }
      }
    }

    const badgeEl =
      container.querySelector('[data-product-badge]') ||
      container.querySelector('.badge-custom') ||
      container.querySelector('.arrival-card .badge') ||
      container.querySelector('.arrival-body .badge');
    if (badgeEl) {
      const badgeText = resolveBadgeText(overrides, metadata);
      if (badgeText) {
        badgeEl.textContent = badgeText;
        badgeEl.style.display = '';
      } else {
        badgeEl.textContent = '';
        badgeEl.style.display = 'none';
      }
    }
  };

  const hydrateProductCards = async () => {
    const containers = getProductContainers();
    if (!containers.size) return;
    const [map, index] = await Promise.all([loadProductMap(), loadProductIndex()]);
    const productByHandle = index?.byHandle;
    if (!productByHandle || !productByHandle.size) return;

    containers.forEach((key, container) => {
      const fallbackKey = slugify(key);
      const product = productByHandle.get(key) || productByHandle.get(fallbackKey);
      if (!product) return;
      const entry = map?.products?.[key] || map?.products?.[fallbackKey] || null;
      const preferredVariantId = entry?.variantId || entry?.variant_id || null;
      const sectionKey = container?.dataset?.sectionKey || '';
      updateProductCard(container, product, preferredVariantId, sectionKey);
    });
  };

  const buildDynamicCard = (template, product, sectionKey) => {
    const card = template.cloneNode(true);
    if (card?.removeAttribute) {
      card.removeAttribute('id');
    }
    if (card?.classList) {
      card.classList.add('card-fade');
    }
    card.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
    card.dataset.productHandle = product?.handle || product?.id || '';
    card.dataset.productId = product?.id || '';
    if (sectionKey) {
      card.dataset.sectionKey = sectionKey;
    }
    if (isAccessoryProduct(product, sectionKey)) {
      card.querySelectorAll('[data-tile-design-action]').forEach(button => button.remove());
    }

    const addButton = card.querySelector('[data-add-to-cart]');
    if (addButton) {
      addButton.dataset.productKey = product?.handle || product?.id || '';
      addButton.dataset.productHandle = product?.handle || '';
      addButton.dataset.productId = product?.id || '';
    }

    const designButtons = Array.from(card.querySelectorAll('[data-design-source]'));
    designButtons.forEach(button => {
      button.dataset.productKey = product?.handle || product?.id || '';
      button.dataset.productHandle = product?.handle || '';
      button.dataset.productId = product?.id || '';
    });

    const variants = getSortedVariants(product);
    const swatchTracks = Array.from(card.querySelectorAll('[data-swatch-track]'));
    const swatchSliders = Array.from(card.querySelectorAll('[data-swatch-slider]'));
    const swatchWindows = Array.from(card.querySelectorAll('[data-swatch-window]'));

    swatchTracks.forEach(track => {
      track.innerHTML = '';
    });

    const accessoryVariants = [];
    const primaryVariants = [];
    variants.forEach(variant => {
      const meta = getVariantSwatchMeta(variant);
      if (meta.type === 'accessory') {
        accessoryVariants.push(variant);
      } else {
        primaryVariants.push(variant);
      }
    });

    const hasMultipleTracks = swatchTracks.length > 1;
    const resolvedPrimary =
      primaryVariants.length > 0 ? primaryVariants : accessoryVariants;
    const resolvedAccessory =
      hasMultipleTracks && primaryVariants.length > 0 ? accessoryVariants : [];
    const combinedVariants = hasMultipleTracks
      ? []
      : [...resolvedPrimary, ...resolvedAccessory];

    const fillTrack = (track, trackVariants) => {
      if (!track) return;
      trackVariants.forEach((variant) => {
        const label = getVariantLabel(variant);
        const meta = getVariantSwatchMeta(variant);
        const metaRaw = normalizeMetadata(variant?.metadata);
        if (metaRaw?.swatch_hide || metaRaw?.swatchHide) {
          return;
        }
        if (isDefaultVariantLabel(label) && !meta.style && !meta.glyph) {
          return;
        }
        if (!meta.style && !meta.glyph && trackVariants.length > 1) {
          const handle = product?.handle || product?.id || 'unknown';
          missingSwatchMeta.add(handle);
        }
        const swatch = buildSwatchElement(variant, label, track.children.length);
        if (!swatch) {
          return;
        }
        if (!swatch.dataset.variantImage) {
          const variantImage = getVariantImage(variant, product);
          if (variantImage) {
            swatch.dataset.variantImage = variantImage;
          }
        }
        track.appendChild(swatch);
      });
    };

    if (hasMultipleTracks) {
      fillTrack(swatchTracks[0], resolvedPrimary);
      fillTrack(swatchTracks[1], resolvedAccessory);
      swatchTracks.slice(2).forEach(track => {
        const slider = track.closest('[data-swatch-slider]');
        if (!slider) return;
        slider.classList.add('hidden');
        slider.style.setProperty('display', 'none', 'important');
      });
    } else {
      fillTrack(swatchTracks[0], combinedVariants);
    }

    if (swatchSliders.length) {
      swatchSliders.forEach((slider, sliderIndex) => {
        const track = swatchTracks[sliderIndex] || null;
        const hasSwatches = Boolean(track && track.children.length);
        if (!hasSwatches) {
          slider.classList.add('hidden');
          slider.style.setProperty('display', 'none', 'important');
          if (swatchWindows[sliderIndex]) {
            swatchWindows[sliderIndex].style.display = 'none';
          }
          return;
        }
        slider.classList.remove('hidden');
        slider.style.removeProperty('display');
        slider.style.opacity = '1';
        slider.style.pointerEvents = 'auto';
        if (swatchWindows[sliderIndex]) {
          swatchWindows[sliderIndex].style.display = '';
        }
      });
    }

    const defaultVariant = variants[0] || null;
    const defaultLabel = defaultVariant ? getVariantLabel(defaultVariant) : '';
    const overrides = getStorefrontTileOverride(product, sectionKey);
    const defaultImage = overrides?.image || getVariantImage(defaultVariant, product);
    updateProductCard(card, product, defaultVariant?.id || null, sectionKey);
    updateProductImage(card, defaultImage, product?.title || '', defaultLabel);
    updateAddToCartVariant(card, defaultVariant?.id || null);
    card.dataset.selectedColor = defaultLabel;
    card.dataset.selectedColorLabel = defaultLabel;

    return card;
  };

  const getSectionFilters = container => {
    const collectionRaw =
      container.dataset.medusaCollection || container.dataset.collectionHandle || '';
    const tagRaw = container.dataset.medusaTag || container.dataset.tagHandle || '';
    const sectionKey =
      container.dataset.sectionKey ||
      collectionRaw ||
      tagRaw ||
      '';
    const limitValue = parseNumeric(container.dataset.gridLimit || container.dataset.limit);
    return {
      collectionHandles: collectionRaw
        .split(',')
        .map(handle => slugify(handle))
        .filter(Boolean),
      tagHandles: tagRaw
        .split(',')
        .map(handle => slugify(handle))
        .filter(Boolean),
      sectionKey: slugify(sectionKey),
      limit: limitValue && limitValue > 0 ? Math.floor(limitValue) : null
    };
  };

  const summarizeGridElement = container => {
    const tag = container?.tagName ? container.tagName.toLowerCase() : 'unknown';
    const idPart = container?.id ? `#${container.id}` : '';
    const classes = String(container?.className || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2);
    const classPart = classes.length ? `.${classes.join('.')}` : '';
    return `${tag}${idPart}${classPart}`;
  };

  const filterProductsForSection = (products, filters) => {
    if (!products?.length) return [];
    const { collectionHandles, tagHandles } = filters;
    const sectionKey = normalizeSectionKey(filters.sectionKey);
    if (!sectionKey) return [];
    const isManagedSection = managedSectionKeys.has(sectionKey);
    if (isManagedSection) {
      return products.filter(product => {
        const explicitSections = getStorefrontSections(product);
        return explicitSections.includes(sectionKey);
      });
    }

    return products.filter(product => {
      const explicitSections = getStorefrontSections(product);
      if (explicitSections.length) {
        return explicitSections.includes(sectionKey);
      }
      if (collectionHandles.length) {
        const handle = getProductCollectionHandle(product);
        if (!collectionHandles.includes(handle)) {
          return false;
        }
      }
      if (tagHandles.length) {
        const tags = getProductTags(product);
        const matches = tagHandles.some(tag => tags.includes(tag));
        if (!matches) return false;
      }
      return true;
    });
  };

  const sortProductsForSection = (products, sectionKey) => {
    const safeSectionKey = normalizeSectionKey(sectionKey);
    return [...products].sort((a, b) => {
      const aOrder = getStorefrontOrderValue(a, safeSectionKey);
      const bOrder = getStorefrontOrderValue(b, safeSectionKey);
      if (aOrder != null || bOrder != null) {
        if (aOrder == null) return 1;
        if (bOrder == null) return -1;
        if (aOrder !== bOrder) return aOrder - bOrder;
      }
      return 0;
    });
  };

  const renderDynamicGrids = async () => {
    const containers = Array.from(
      document.querySelectorAll('[data-medusa-collection], [data-medusa-tag]')
    );
    const gridEntries = containers.map(container => {
      const filters = getSectionFilters(container);
      const normalizedSectionKey = normalizeSectionKey(filters.sectionKey);
      const isManaged = managedSectionKeys.has(normalizedSectionKey);
      if (isManaged) {
        container.setAttribute('data-storefront-managed-grid', 'true');
        container.setAttribute('data-storefront-grid-state', 'loading');
      }
      return { container, filters, normalizedSectionKey, isManaged };
    });
    if (!gridDiscoveryLogged) {
      gridDiscoveryLogged = true;
      const grids = gridEntries.map(({ container, normalizedSectionKey }) => ({
        sectionKey: normalizedSectionKey,
        el: summarizeGridElement(container)
      }));
      console.info(
        '[storefront-grids]',
        `path=${window.location.pathname}`,
        `grids=${JSON.stringify(grids)}`
      );
    }
    if (!gridEntries.length) return;

    await Promise.all(gridEntries.map(async entry => {
      const { container, filters, normalizedSectionKey, isManaged } = entry;
      let renderedCount = 0;
      const sharedTemplate = getSharedCardTemplate();
      const templateElement = container.querySelector('template[data-card-template]');
      const template =
        sharedTemplate ||
        templateElement?.content?.firstElementChild ||
        container.querySelector('.product-card');
      try {
        if (!template) return;
        container.classList.add('product-grid');
        container.classList.remove('is-loaded');
        const products = await loadStoreProducts();
        if (!products.length) {
          container.querySelectorAll('.product-card').forEach(card => card.remove());
          return;
        }
        let sectionProducts = filterProductsForSection(products, filters);
        sectionProducts = sortProductsForSection(sectionProducts, filters.sectionKey);
        if (debugEnabled && normalizedSectionKey) {
          const sectionTitles = sectionProducts.map(
            product => product?.title || product?.handle || product?.id
          );
          console.info(
            '[storefront-section]',
            normalizedSectionKey,
            `assigned=${sectionProducts.length}`,
            `titles=${JSON.stringify(sectionTitles)}`
          );
        }
        if (filters.limit) {
          sectionProducts = sectionProducts.slice(0, filters.limit);
        }
        renderedCount = sectionProducts.length;
        if (!sectionProducts.length) {
          container.querySelectorAll('.product-card').forEach(card => card.remove());
          return;
        }

        container
          .querySelectorAll('.product-card')
          .forEach(card => card.remove());
        const fragment = document.createDocumentFragment();
        sectionProducts.forEach(product => {
          const card = buildDynamicCard(template, product, filters.sectionKey);
          fragment.appendChild(card);
        });
        container.appendChild(fragment);
        initSwatchSliders(container);
        const loading = container
          .closest('section')
          ?.querySelector(
            `[data-products-loading][data-loading-for="${filters.sectionKey}"]`
          );
        if (loading) {
          loading.style.display = 'none';
        }
        container.classList.add('is-loaded');
      } finally {
        if (isManaged) {
          container.setAttribute('data-storefront-grid-state', 'ready');
          console.info(
            '[storefront-grid-ready]',
            normalizedSectionKey,
            `rendered=${renderedCount}`,
            `path=${window.location.pathname}`
          );
        }
      }
    }));

    if (missingSwatchMeta.size) {
      console.warn(
        '[commerce] Missing swatch metadata for products:',
        Array.from(missingSwatchMeta)
      );
    }

    window.dispatchEvent(new Event('resize'));
    try {
      window.dispatchEvent(new Event('ldc:products:rendered'));
    } catch {}
  };

  const cleanVariantLabel = value =>
    String(value || '')
      .replace(/^\s*View\s+/i, '')
      .replace(/\s*(swatch|accent|option)\s*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();

  const isDefaultVariantLabel = value => {
    const label = cleanVariantLabel(value);
    return !label || /^default$/i.test(label);
  };

  const sanitizeSwatchStyle = styleValue => {
    if (!styleValue) return '';
    const declarations = String(styleValue)
      .split(';')
      .map(chunk => chunk.trim())
      .filter(Boolean)
      .map(chunk => {
        const separatorIndex = chunk.indexOf(':');
        if (separatorIndex <= 0) return null;
        const property = chunk.slice(0, separatorIndex).trim().toLowerCase();
        const value = chunk.slice(separatorIndex + 1).trim();
        if (!ALLOWED_SWATCH_STYLE_PROPS.has(property)) return null;
        if (!value || BLOCKED_SWATCH_STYLE_VALUE_RE.test(value)) return null;
        return `${property}:${value}`;
      })
      .filter(Boolean);
    return declarations.join(';');
  };

  const enforceSwatchDotGeometry = swatch => {
    if (!swatch?.style) return;
    swatch.style.setProperty('width', SWATCH_DOT_SIZE, 'important');
    swatch.style.setProperty('height', SWATCH_DOT_SIZE, 'important');
    swatch.style.setProperty('min-width', SWATCH_DOT_SIZE, 'important');
    swatch.style.setProperty('min-height', SWATCH_DOT_SIZE, 'important');
    swatch.style.setProperty('border-radius', '9999px', 'important');
    swatch.style.setProperty('flex', '0 0 auto', 'important');
    swatch.style.setProperty('aspect-ratio', '1 / 1', 'important');
    swatch.style.setProperty('display', 'inline-flex', 'important');
    swatch.style.setProperty('align-items', 'center', 'important');
    swatch.style.setProperty('justify-content', 'center', 'important');
    swatch.style.setProperty('box-sizing', 'border-box', 'important');
    swatch.style.setProperty('overflow', 'hidden', 'important');
  };

  const getSwatchLabel = swatch => {
    if (!swatch) return '';
    const raw =
      swatch.dataset.colorLabel ||
      swatch.dataset.accessoryLabel ||
      swatch.getAttribute('aria-label') ||
      swatch.getAttribute('data-image-alt') ||
      swatch.getAttribute('title') ||
      swatch.textContent ||
      '';
    return cleanVariantLabel(raw);
  };

  const buildSwatchElement = (variant, label, index) => {
    const swatch = document.createElement('span');
    const meta = getVariantSwatchMeta(variant);
    const swatchLabel = cleanVariantLabel(label || getVariantLabel(variant) || '');
    if (isDefaultVariantLabel(swatchLabel) && !meta.style && !meta.glyph) {
      return null;
    }
    const resolvedLabel = swatchLabel || 'Variant';
    swatch.className = 'swatch swatch-auto cursor-pointer';
    swatch.dataset.variantId = variant?.id || '';
    swatch.dataset.variantLabel = resolvedLabel;
    if (meta.type) {
      swatch.dataset.swatchType = meta.type;
    }
    if (meta.style) {
      const baseStyle = sanitizeSwatchStyle(meta.style);
      if (baseStyle) {
        swatch.setAttribute('style', `${baseStyle};`);
      }
    } else {
      swatch.classList.add('is-text');
      swatch.textContent = resolvedLabel;
    }
    if (meta.glyph) {
      swatch.classList.add('is-glyph');
      swatch.textContent = meta.glyph;
    }
    if (meta.image) {
      swatch.dataset.variantImage = meta.image;
    }
    enforceSwatchDotGeometry(swatch);
    swatch.setAttribute('aria-label', resolvedLabel);
    swatch.setAttribute('role', 'button');
    swatch.setAttribute('tabindex', '0');
    if (index === 0) {
      swatch.classList.add('is-active');
    }
    return swatch;
  };

  const findVariantSwatch = (container, label) => {
    if (!container || !label) return null;
    const labelKey = slugify(label);
    const swatches = Array.from(container.querySelectorAll('.swatch'));
    return (
      swatches.find(swatch => {
        const raw =
          swatch.dataset.colorLabel ||
          swatch.dataset.accessoryLabel ||
          swatch.getAttribute('aria-label') ||
          swatch.getAttribute('data-image-alt') ||
          '';
        return slugify(cleanVariantLabel(raw)) === labelKey;
      }) || null
    );
  };

  const getVariantContainer = button =>
    button.closest('.product-card') ||
    button.closest('.attire-form') ||
    button.closest('.attire-layout') ||
    button.closest('[data-product-key]');

  const getSelectedVariantSwatch = button => {
    const container = getVariantContainer(button);
    if (!container) return null;
    let label = getSelectedVariantLabel(button);
    const fallbackSwatch =
      container.querySelector('.swatch.is-active') ||
      container.querySelector('.swatch[aria-pressed="true"]') ||
      container.querySelector('.swatch');
    if (!label && fallbackSwatch) {
      const raw =
        fallbackSwatch.dataset.colorLabel ||
        fallbackSwatch.dataset.accessoryLabel ||
        fallbackSwatch.getAttribute('aria-label') ||
        fallbackSwatch.getAttribute('data-image-alt') ||
        '';
      label = cleanVariantLabel(raw);
    }
    if (!label) return null;
    const swatch = findVariantSwatch(container, label) || fallbackSwatch;
    const style =
      swatch?.getAttribute('style') ||
      container.dataset.selectedColorStyle ||
      container.dataset.selectedAccessoryStyle ||
      '';
    const glyph =
      (swatch?.textContent || '').trim() ||
      container.dataset.selectedColorGlyph ||
      container.dataset.selectedAccessoryGlyph ||
      '';
    let type = swatch?.dataset?.swatchType || '';
    if (!type) {
      if (swatch?.dataset?.accessoryLabel || container.dataset.selectedAccessory) {
        type = 'accessory';
      } else {
        type = 'color';
      }
    }
    return {
      label,
      style,
      glyph,
      type
    };
  };

  const deriveProductKey = button => {
    const container =
      button.closest('[data-product-key]') ||
      button.closest('.product-card') ||
      button.closest('.attire-form') ||
      button.closest('.attire-layout');

    if (!container) return null;
    const titleEl =
      container.querySelector('.product-title') ||
      container.querySelector('.tile-title') ||
      container.querySelector('.hero-heading') ||
      container.querySelector('h1') ||
      container.querySelector('h2') ||
      container.querySelector('h3');

    const title = titleEl?.textContent?.trim();
    if (!title) return null;
    return slugify(title);
  };

  const getSelectedVariantLabel = button => {
    const container = getVariantContainer(button);
    if (!container) return null;
    const activeSwatch =
      container.querySelector('.swatch.is-active') ||
      container.querySelector('.swatch[aria-pressed="true"]');
    const activeLabel =
      activeSwatch?.dataset?.colorLabel ||
      activeSwatch?.dataset?.accessoryLabel ||
      activeSwatch?.getAttribute('aria-label') ||
      activeSwatch?.getAttribute('data-image-alt') ||
      '';
    const dataLabel =
      container.dataset.selectedColor ||
      container.dataset.selectedAccessory ||
      '';
    let label = activeLabel || dataLabel;
    if (!label) {
      const activeImage = container.querySelector('.tile-mauve img, .product-media img, img');
      label = activeImage?.getAttribute('alt') || '';
    }
    label = cleanVariantLabel(label);
    return label || null;
  };

  const resolveVariantFromEntry = (entry, label) => {
    if (!entry || !label) return null;
    const labelKey = slugify(label);
    const variants = entry.variants;
    if (Array.isArray(variants)) {
      const match = variants.find(variant => {
        const variantLabel = variant?.label || variant?.title || '';
        return slugify(variantLabel) === labelKey;
      });
      return match?.variantId || match?.variant_id || null;
    }
    if (variants && typeof variants === 'object') {
      const match = variants[labelKey] || variants[label] || null;
      return match?.variantId || match?.variant_id || null;
    }
    return null;
  };

  const resolveVariantFromProduct = (product, label) => {
    if (!product) return null;
    const variants = getSortedVariants(product);
    if (!variants.length) return null;
    if (!label) return variants[0]?.id || null;
    const labelKey = slugify(label);
    const match = variants.find(variant => {
      const variantLabel = getVariantLabel(variant);
      return slugify(variantLabel) === labelKey;
    });
    return match?.id || variants[0]?.id || null;
  };

  const updateCardPriceForSwatch = async swatch => {
    const container = getVariantContainer(swatch);
    if (!container) return;
    const swatchGroup =
      swatch.closest('[data-swatch-track]') ||
      swatch.closest('.swatch-slider') ||
      container;
    if (swatchGroup) {
      swatchGroup.querySelectorAll('.swatch.is-active').forEach(active => {
        if (active !== swatch) active.classList.remove('is-active');
      });
      swatch.classList.add('is-active');
    }
    const key = getProductKeyFromContainer(container);
    if (!key) return;
    const [map, index] = await Promise.all([loadProductMap(), loadProductIndex()]);
    const product =
      index?.byHandle?.get(key) || index?.byHandle?.get(slugify(key)) || null;
    if (!product) return;
    const entry = map?.products?.[key] || map?.products?.[slugify(key)] || null;
    const label = getSwatchLabel(swatch) || getSelectedVariantLabel(swatch);
    if (label) {
      const isAccessory =
        swatch.dataset.swatchType === 'accessory' || swatch.dataset.accessoryLabel;
      if (isAccessory) {
        container.dataset.selectedAccessory = label;
        container.dataset.selectedAccessoryLabel = label;
      } else {
        container.dataset.selectedColor = label;
        container.dataset.selectedColorLabel = label;
      }
    }
    let variantId = swatch.dataset.variantId || null;
    if (!variantId && label && entry) {
      variantId = resolveVariantFromEntry(entry, label);
    }
    if (!variantId && entry) {
      variantId = entry?.variantId || entry?.variant_id || null;
    }
    const variants = getSortedVariants(product);
    const variant = variantId ? variants.find(item => item?.id === variantId) : null;
    const sectionKey = container?.dataset?.sectionKey || '';
    const overrides = getStorefrontTileOverride(product, sectionKey);
    const imageUrl = overrides?.image || getVariantImage(variant, product);
    updateProductPrice(container, product, variantId, overrides);
    updateProductImage(container, imageUrl, product?.title || '', label);
    updateAddToCartVariant(container, variantId);
  };

  const scheduleSwatchPriceUpdate = swatch => {
    if (!swatch) return;
    requestAnimationFrame(() => {
      updateCardPriceForSwatch(swatch).catch(error => {
        console.warn('[commerce] Unable to update swatch price:', error);
      });
    });
  };

  const finalizeSwatchSlider = slider => {
    const track = slider?.querySelector?.('[data-swatch-track]');
    const windowEl = slider?.querySelector?.('[data-swatch-window]');
    const prev = slider?.querySelector?.('[data-swatch-prev]');
    const next = slider?.querySelector?.('[data-swatch-next]');
    const swatchCount = track?.children?.length || 0;
    if (!track || !windowEl) return { swatchCount: 0, visible: 0 };

    if (swatchCount === 0) {
      slider.classList.add('hidden');
      slider.style.setProperty('display', 'none', 'important');
      return { swatchCount: 0, visible: 0 };
    }

    slider.classList.remove('hidden');
    slider.style.removeProperty('display');
    const desiredVisible = Math.min(MAX_VISIBLE_SWATCHES, swatchCount);
    const firstSwatch = track.children[0];
    const measuredSwatchWidth =
      firstSwatch?.getBoundingClientRect?.().width ||
      parseFloat(window.getComputedStyle(firstSwatch).width || '0') ||
      0;
    const swatchWidth =
      Number.isFinite(measuredSwatchWidth) && measuredSwatchWidth >= 12
        ? measuredSwatchWidth
        : 20;
    const trackStyles = window.getComputedStyle(track);
    const measuredGap = parseFloat(trackStyles.gap || trackStyles.columnGap || '0');
    const gap =
      Number.isFinite(measuredGap) && measuredGap >= 4
        ? measuredGap
        : 8;
    const safetyPadding = 5;
    const windowWidth =
      desiredVisible * swatchWidth +
      Math.max(0, desiredVisible - 1) * gap +
      safetyPadding * 2 +
      2;
    windowEl.style.width = `${Math.ceil(windowWidth)}px`;
    windowEl.style.paddingInline = `${safetyPadding}px`;
    windowEl.style.overflow = 'hidden';

    const shouldHideArrows = swatchCount <= desiredVisible;
    [prev, next].forEach(button => {
      if (!button) return;
      button.style.display = shouldHideArrows ? 'none' : '';
      button.disabled = shouldHideArrows;
    });

    return { swatchCount, visible: desiredVisible, swatchWidth, gap };
  };

  const initSwatchSliders = (scope) => {
    const root = scope || document;
    const sliders = Array.from(root.querySelectorAll('[data-swatch-slider]'));
    sliders.forEach((slider) => {
      if (slider.dataset.swatchInit === 'true') return;
      slider.dataset.swatchInit = 'true';
      const track = slider.querySelector('[data-swatch-track]');
      const prev = slider.querySelector('[data-swatch-prev]');
      const next = slider.querySelector('[data-swatch-next]');
      if (!track || !prev || !next) return;
      let index = 0;

      const update = () => {
        const finalized = finalizeSwatchSlider(slider);
        const total = finalized.swatchCount;
        const visible = finalized.visible;
        const swatchWidth = finalized.swatchWidth || 0;
        const gap = finalized.gap || 0;
        if (!total || !visible || !swatchWidth) return;
        const maxIndex = Math.max(0, total - visible);
        index = Math.max(0, Math.min(index, maxIndex));
        const offset = (swatchWidth + gap) * index;
        track.style.transform = `translateX(-${offset}px)`;
        prev.style.opacity = index === 0 ? '0.4' : '1';
        next.style.opacity = index >= maxIndex ? '0.4' : '1';
      };

      const step = (direction) => {
        index += direction;
        update();
      };

      prev.addEventListener('click', (event) => {
        event.preventDefault();
        step(-1);
      });
      next.addEventListener('click', (event) => {
        event.preventDefault();
        step(1);
      });
      window.addEventListener('resize', update);
      update();
      requestAnimationFrame(update);
    });
  };

  const resolveVariantId = async button => {
    const direct = button.dataset.variantId || button.dataset.medusaVariantId;
    if (direct) return direct;

    const container = getVariantContainer(button);
    const selectedVariantId = container?.dataset?.selectedVariantId;
    if (selectedVariantId) return selectedVariantId;

    const explicitKey = button.dataset.productKey || button.closest('[data-product-key]')?.dataset.productKey;
    const key = explicitKey || deriveProductKey(button);
    const productHandle =
      button.dataset.productHandle || container?.dataset?.productHandle || null;
    const productId =
      button.dataset.productId || container?.dataset?.productId || null;
    if (!key && !productHandle && !productId) return null;

    const selectedLabel = getSelectedVariantLabel(button);
    if (productHandle || productId) {
      const index = await loadProductIndex();
      const product =
        (productId && index?.byId?.get(productId)) ||
        (productHandle && (index?.byHandle?.get(productHandle) || index?.byHandle?.get(slugify(productHandle)))) ||
        null;
      const resolved = resolveVariantFromProduct(product, selectedLabel);
      if (resolved) return resolved;
    }

    if (!key) return null;

    const map = await loadProductMap();
    const entry = map?.products?.[key];
    const mappedVariant =
      selectedLabel ? resolveVariantFromEntry(entry, selectedLabel) : null;
    const variantId =
      mappedVariant || entry?.variantId || entry?.variant_id;
    if (!variantId) {
      console.warn(`[commerce] Missing variant ID for key: ${key}`);
    }
    return variantId || null;
  };

  const readCartId = () => {
    try {
      return localStorage.getItem(CART_ID_KEY);
    } catch (error) {
      return null;
    }
  };

  const writeCartId = id => {
    try {
      localStorage.setItem(CART_ID_KEY, id);
    } catch (error) {
      // Ignore storage failures; cart will still work in-session.
    }
  };

  const clearCartId = () => {
    try {
      localStorage.removeItem(CART_ID_KEY);
    } catch (error) {
      // Ignore.
    }
  };

  const normalizeCart = data => data?.cart || data;

  const getCart = async id => {
    if (!id) return null;
    try {
      const data = await request(`/store/carts/${id}?fields=+items.metadata`);
      return normalizeCart(data);
    } catch (error) {
      clearCartId();
      return null;
    }
  };

  const createCart = async () => {
    const data = await request('/store/carts', { method: 'POST' });
    const cart = normalizeCart(data);
    if (cart?.id) writeCartId(cart.id);
    return cart;
  };

  const getOrCreateCart = async () => {
    const storedId = readCartId();
    if (storedId) {
      const existing = await getCart(storedId);
      if (existing) return existing;
    }
    return createCart();
  };

  const getItemCount = cart => {
    const items = cart?.items || [];
    return items.reduce((sum, item) => sum + (item.quantity || 0), 0);
  };

  const updateBadges = count => {
    badgeEls.forEach(el => {
      el.textContent = count > 0 ? String(count) : '';
      el.hidden = count === 0;
    });
  };

  const applyCartUpdate = cart => {
    if (!cart) {
      updateBadges(0);
      syncLegacyCart(null);
      return;
    }
    updateBadges(getItemCount(cart));
    syncLegacyCart(cart);
  };

  const buildPreviewStyle = src =>
    src
      ? `background-color: #ffffff; background-image: url("${src}"); background-size: cover; background-position: center; background-repeat: no-repeat;`
      : '';

  const extractImageFromCard = card => {
    if (!card) return '';
    const img =
      card.querySelector('.tile-mauve img') ||
      card.querySelector('.product-media img') ||
      card.querySelector('img');
    if (img) {
      return img.getAttribute('src') || img.getAttribute('data-src') || img.currentSrc || '';
    }
    const bgEl = card.querySelector('[style*="background-image"]');
    if (bgEl) {
      const style = bgEl.getAttribute('style') || '';
      const match = style.match(/background-image:\s*url\((['"]?)(.*?)\1\)/i);
      if (match && match[2]) return match[2];
    }
    return '';
  };

  const buildLineItemMetadata = button => {
    const metadata = {};
    const sourceId = button?.dataset?.designSource || button?.getAttribute('data-design-source');
    if (sourceId) {
      const sourceImage = document.getElementById(sourceId);
      const src = sourceImage?.getAttribute('src') || sourceImage?.getAttribute('data-src') || sourceImage?.currentSrc || '';
      if (src) metadata.preview_url = src;
    }
    const swatchData = getSelectedVariantSwatch(button);
    if (swatchData?.label) {
      metadata.variant_label = swatchData.label;
      metadata.variant_style = swatchData.style || '';
      metadata.variant_glyph = swatchData.glyph || '';
      metadata.variant_type = swatchData.type || 'color';
    }
    if (!metadata.preview_url) {
      const card = button?.closest('.product-card, .group, .attire-form, .attire-layout');
      const src = extractImageFromCard(card);
      if (src) {
        metadata.preview_url = src;
      } else if (card) {
        const styleEl = card.querySelector('[style*="background-image"]');
        const style = styleEl?.getAttribute('style') || '';
        if (style) metadata.preview_style = style;
      }
    }
    return metadata;
  };

  const formatLegacyItem = (item, currencySource) => {
    if (!item) return null;
    const resolvedCurrency = getCurrencyCode(currencySource || item?.currency_code);
    const rawUnitPriceMinor = Number(item.unit_price || 0);
    const unitPriceMinor = Number.isFinite(rawUnitPriceMinor) ? rawUnitPriceMinor : 0;
    const unitPrice = toMajorUnits(unitPriceMinor, resolvedCurrency);
    const productTitle =
      item.product_title || item.product?.title || item.productTitle || '';
    const lineTitle = item.title || '';
    const variantTitleFromItem = item.variant_title || item.variantTitle || '';
    const variantTitle =
      item.variant?.title && item.variant.title !== 'Default'
        ? item.variant.title
        : '';
    const displayTitle =
      productTitle || lineTitle || variantTitleFromItem || variantTitle || 'Item';
    const metadata = item.metadata || {};
    const previewUrl =
      metadata.design_preview_url ||
      metadata.designPreviewUrl ||
      metadata.preview_url ||
      metadata.previewUrl ||
      metadata.preview_image ||
      metadata.previewImage ||
      '';
    const previewStyle =
      (previewUrl ? buildPreviewStyle(previewUrl) : '') ||
      (item.thumbnail ? buildPreviewStyle(item.thumbnail) : '') ||
      (metadata.preview_style || metadata.previewStyle || '');
    const metadataLabel = cleanVariantLabel(
      metadata.variant_label ||
        metadata.color_label ||
        metadata.selected_color ||
        metadata.selectedColor ||
        ''
    );
    const metadataStyle =
      metadata.variant_style ||
      metadata.color_style ||
      metadata.selected_color_style ||
      metadata.selectedColorStyle ||
      '';
    const metadataGlyph =
      metadata.variant_glyph ||
      metadata.color_glyph ||
      metadata.selected_color_glyph ||
      metadata.selectedColorGlyph ||
      '';
    const metadataType = (metadata.variant_type || '').toLowerCase();
    const candidateVariant = variantTitleFromItem || variantTitle || lineTitle || '';
    let derivedLabel = '';
    if (!metadataLabel && candidateVariant && displayTitle) {
      const normalizedTitle = String(displayTitle).trim();
      if (candidateVariant.startsWith(`${normalizedTitle} - `)) {
        derivedLabel = candidateVariant.slice(normalizedTitle.length + 3);
      } else if (candidateVariant.includes(' - ')) {
        derivedLabel = candidateVariant.split(' - ').slice(1).join(' - ');
      } else if (candidateVariant !== normalizedTitle) {
        derivedLabel = candidateVariant;
      }
    }
    const optionLabel = metadataLabel || derivedLabel;
    const designColorLabel =
      metadata.design_color_label ||
      metadata.designColorLabel ||
      metadata.design_color ||
      metadata.designColor ||
      '';
    const designColorStyle =
      metadata.design_color_style ||
      metadata.designColorStyle ||
      metadata.design_color_swatch ||
      '';
    const designColorGlyph =
      metadata.design_color_glyph ||
      metadata.designColorGlyph ||
      '';
    const designAccessoryLabel =
      metadata.design_accessory_label ||
      metadata.designAccessoryLabel ||
      metadata.design_accessory ||
      metadata.designAccessory ||
      '';
    const designAccessoryStyle =
      metadata.design_accessory_style ||
      metadata.designAccessoryStyle ||
      metadata.design_accessory_swatch ||
      '';
    const designAccessoryGlyph =
      metadata.design_accessory_glyph ||
      metadata.designAccessoryGlyph ||
      '';
    const designWrapLabel =
      metadata.design_wrap_label ||
      metadata.designWrapLabel ||
      metadata.design_wrap ||
      metadata.designWrap ||
      '';
    const designNotes =
      metadata.design_notes ||
      metadata.designNotes ||
      '';
    const designAttachmentName =
      metadata.design_attachment_name ||
      metadata.designAttachmentName ||
      '';
    const designAttachmentUrl =
      metadata.design_attachment_url ||
      metadata.designAttachmentUrl ||
      metadata.design_attachment_data ||
      metadata.designAttachmentData ||
      '';
    const designAttachmentKey =
      metadata.design_attachment_key ||
      metadata.designAttachmentKey ||
      '';
    const hasDesign =
      Boolean(designColorLabel || designAccessoryLabel || designWrapLabel || designNotes || designAttachmentName);
    const options = [];
    if (optionLabel && !hasDesign) {
      options.push({
        label: metadataType === 'accessory' ? 'Accessory' : 'Color',
        value: optionLabel,
        swatchStyle: metadataStyle,
        swatchGlyph: metadataGlyph
      });
    } else if (candidateVariant && candidateVariant !== displayTitle) {
      options.push({ label: 'Variant', value: candidateVariant });
    }
    if (designColorLabel) {
      options.push({
        label: 'Color',
        value: designColorLabel,
        swatchStyle: designColorStyle,
        swatchGlyph: designColorGlyph
      });
    }
    if (designAccessoryLabel) {
      options.push({
        label: 'Accessory',
        value: designAccessoryLabel,
        swatchStyle: designAccessoryStyle,
        swatchGlyph: designAccessoryGlyph
      });
    }
    if (designWrapLabel) {
      options.push({ label: 'Wrap', value: designWrapLabel });
    }
    if (designNotes) {
      options.push({ label: 'Notes', value: designNotes });
    }
    if (designAttachmentName) {
      options.push({
        label: 'Attachment',
        value: designAttachmentName,
        attachmentData: designAttachmentUrl,
        attachmentKey: designAttachmentKey
      });
    }
    return {
      id: String(item.id || displayTitle),
      name: String(displayTitle),
      price: unitPrice,
      price_minor: unitPriceMinor,
      currency_code: resolvedCurrency,
      quantity: Math.max(1, Number(item.quantity || 1)),
      previewStyle,
      options
    };
  };

  const syncLegacyCart = cart => {
    const currencyCode = getCurrencyCode(cart);
    const items = Array.isArray(cart?.items)
      ? cart.items.map(item => formatLegacyItem(item, currencyCode)).filter(Boolean)
      : [];
    const payload = { items, currency_code: currencyCode };
    try {
      localStorage.setItem(LEGACY_CART_KEY, JSON.stringify(payload));
    } catch (error) {
      // Ignore storage errors.
    }
    try {
      document.dispatchEvent(new CustomEvent('cart:set', { detail: payload }));
    } catch (error) {
      // Ignore if CustomEvent is unavailable.
    }
  };

  const syncBadges = async () => {
    const storedId = readCartId();
    if (!storedId) {
      applyCartUpdate(null);
      return;
    }
    const cart = await getCart(storedId);
    if (!cart) {
      applyCartUpdate(null);
      return;
    }
    applyCartUpdate(cart);
  };

  const addLineItem = async (variantId, quantity = 1, metadata = {}) => {
    const cart = await getOrCreateCart();
    if (!cart?.id) throw new Error('Unable to create cart.');
    const data = await request(`/store/carts/${cart.id}/line-items`, {
      method: 'POST',
      body: {
        variant_id: variantId,
        quantity: quantity,
        metadata: metadata
      }
    });
    return normalizeCart(data);
  };

  const removeLineItem = async lineItemId => {
    const cartId = readCartId();
    if (!cartId) return null;
    const data = await request(`/store/carts/${cartId}/line-items/${lineItemId}`, {
      method: 'DELETE'
    });
    let cart = normalizeCart(data);
    if (!Array.isArray(cart?.items)) {
      cart = await getCart(cartId);
    }
    applyCartUpdate(cart);
    return cart;
  };

  const resetCart = async () => {
    const cartId = readCartId();
    if (cartId) {
      try {
        await request(`/store/carts/${cartId}`, { method: 'DELETE' });
      } catch (error) {
        try {
          const cart = await getCart(cartId);
          const items = Array.isArray(cart?.items) ? cart.items : [];
          await Promise.all(
            items.map(item =>
              request(`/store/carts/${cartId}/line-items/${item.id}`, {
                method: 'DELETE'
              })
            )
          );
        } catch {}
      }
    }
    clearCartId();
    applyCartUpdate(null);
    try {
      document.dispatchEvent(new CustomEvent('cart:reset'));
    } catch {}
  };

  const updateLineItemQuantity = async (lineItemId, quantity) => {
    const cartId = readCartId();
    if (!cartId) return null;
    if (quantity <= 0) {
      return removeLineItem(lineItemId);
    }
    const data = await request(`/store/carts/${cartId}/line-items/${lineItemId}`, {
      method: 'POST',
      body: { quantity }
    });
    const cart = normalizeCart(data);
    applyCartUpdate(cart);
    return cart;
  };

  const changeLineItemQuantity = async (lineItemId, delta) => {
    const cartId = readCartId();
    if (!cartId) return null;
    const cart = await getCart(cartId);
    const item = cart?.items?.find(entry => entry.id === lineItemId);
    if (!item) return cart;
    const nextQty = Math.max(0, Number(item.quantity || 0) + Number(delta || 0));
    return updateLineItemQuantity(lineItemId, nextQty);
  };

  const setFormMessage = (form, message, tone) => {
    if (!form) return;
    let node = form.querySelector('.auth-message');
    if (!node) {
      node = document.createElement('div');
      node.className = 'auth-message';
      node.style.marginTop = '0.75rem';
      node.style.fontSize = '0.85rem';
      form.appendChild(node);
    }
    node.textContent = message;
    node.style.color = tone === 'error' ? '#b91c1c' : '#0f172a';
  };

  const announceAuthChange = () => {
    try {
      window.dispatchEvent(new CustomEvent('ldc:auth:change'));
    } catch (error) {
      // Ignore if CustomEvent is unavailable.
    }
  };

  const handleSignIn = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const email = form.querySelector('#signInEmail')?.value?.trim();
    const password = form.querySelector('#signInPassword')?.value || '';
    if (!email || !password) {
      setFormMessage(form, 'Email and password are required.', 'error');
      return;
    }
    try {
      await request('/store/auth', {
        method: 'POST',
        body: { email, password }
      });
      setFormMessage(form, 'Signed in successfully.', 'success');
      announceAuthChange();
    } catch (error) {
      setFormMessage(form, 'Unable to sign in. Please check your details.', 'error');
    }
  };

  const handleSignUp = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const name = form.querySelector('#signUpName')?.value?.trim() || '';
    const email = form.querySelector('#signUpEmail')?.value?.trim();
    const password = form.querySelector('#signUpPassword')?.value || '';
    const confirm = form.querySelector('#signUpConfirm')?.value || '';

    if (!email || !password) {
      setFormMessage(form, 'Email and password are required.', 'error');
      return;
    }
    if (password !== confirm) {
      setFormMessage(form, 'Passwords do not match.', 'error');
      return;
    }

    const [firstName, ...rest] = name.split(' ').filter(Boolean);
    const lastName = rest.join(' ');

    try {
      await request('/store/customers', {
        method: 'POST',
        body: {
          email,
          password,
          first_name: firstName || 'Customer',
          last_name: lastName || ''
        }
      });
      await request('/store/auth', {
        method: 'POST',
        body: { email, password }
      });
      setFormMessage(form, 'Account created. You are now signed in.', 'success');
      announceAuthChange();
    } catch (error) {
      setFormMessage(form, 'Unable to create account. Please try again.', 'error');
    }
  };

  const getCustomer = async () => {
    const data = await request('/store/customers/me');
    return data?.customer || data;
  };

  const getOrders = async () => {
    const data = await request('/store/customers/me/orders');
    return data?.orders || data;
  };

  const sanitizeAuditText = value =>
    String(value || '')
      .replace(/cart_[A-Za-z0-9]+/g, '[redacted-cart-id]')
      .replace(/\s+/g, ' ')
      .trim();

  const readStoredCartFailures = () => {
    try {
      const raw = localStorage.getItem(CART_AUDIT_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.slice(-CART_AUDIT_LIMIT) : [];
    } catch (error) {
      return [];
    }
  };

  const ensureCartAuditBuffer = () => {
    const existing =
      window.__LDC_CART_AUDIT && typeof window.__LDC_CART_AUDIT === 'object'
        ? window.__LDC_CART_AUDIT
        : {};
    if (!Array.isArray(existing.adds)) existing.adds = [];
    if (!Array.isArray(existing.fails)) existing.fails = readStoredCartFailures();
    window.__LDC_CART_AUDIT = existing;
    return existing;
  };
  ensureCartAuditBuffer();

  const appendCappedEntry = (entries, value) => {
    if (!Array.isArray(entries)) return;
    entries.push(value);
    if (entries.length > CART_AUDIT_LIMIT) {
      entries.splice(0, entries.length - CART_AUDIT_LIMIT);
    }
  };

  const persistAuditFailures = failures => {
    try {
      localStorage.setItem(CART_AUDIT_STORAGE_KEY, JSON.stringify(failures.slice(-CART_AUDIT_LIMIT)));
    } catch (error) {
      // Ignore storage errors.
    }
  };

  const recordCartAddAttempt = entry => {
    const audit = ensureCartAuditBuffer();
    appendCappedEntry(audit.adds, entry);
  };

  const recordCartAddFailure = entry => {
    const audit = ensureCartAuditBuffer();
    appendCappedEntry(audit.fails, entry);
    persistAuditFailures(audit.fails);
  };

  const getSelectedSwatchLabelsForAudit = button => {
    const container = getVariantContainer(button);
    if (!container) return [];
    const labels = [];
    const tracks = Array.from(container.querySelectorAll('[data-swatch-track]'));
    tracks.forEach(track => {
      const active =
        track.querySelector('.swatch.is-active') ||
        track.querySelector('.swatch[aria-pressed="true"]') ||
        track.querySelector('.swatch');
      if (!active) return;
      const label = cleanVariantLabel(getSwatchLabel(active));
      if (!label || isDefaultVariantLabel(label)) return;
      const kind =
        active.dataset.swatchType ||
        track.closest('[data-swatch-slider]')?.dataset?.swatchKind ||
        '';
      labels.push(kind ? `${kind}:${label}` : label);
    });
    return labels;
  };

  const buildAddToCartContext = (button, variantId = null) => {
    const container = getVariantContainer(button);
    const titleEl =
      container?.querySelector('[data-product-title]') ||
      container?.querySelector('.product-title') ||
      container?.querySelector('.tile-title') ||
      container?.querySelector('h1, h2, h3');
    const quantityRaw = Number(button?.dataset?.quantity || 1);
    const quantity = Number.isFinite(quantityRaw) && quantityRaw > 0 ? quantityRaw : 1;
    return {
      timestamp: new Date().toISOString(),
      path: window.location.pathname,
      product_title: sanitizeAuditText(
        button?.dataset?.productTitle ||
          container?.dataset?.productTitle ||
          titleEl?.textContent ||
          ''
      ),
      product_handle: sanitizeAuditText(
        button?.dataset?.productHandle ||
          container?.dataset?.productHandle ||
          getProductKeyFromContainer(container) ||
          deriveProductKey(button) ||
          ''
      ),
      variant_id:
        variantId ||
        button?.dataset?.variantId ||
        button?.dataset?.medusaVariantId ||
        container?.dataset?.selectedVariantId ||
        null,
      swatches: getSelectedSwatchLabelsForAudit(button),
      quantity
    };
  };

  const getAddToCartErrorDetails = error => {
    const status = Number(error?.status);
    const rawMessage = sanitizeAuditText(error?.message || String(error || ''));
    let detail = rawMessage;
    let message = rawMessage || 'Unable to add item to cart.';
    let code = '';
    try {
      const parsed = JSON.parse(error?.message || '');
      const parsedMessage = sanitizeAuditText(parsed?.message || '');
      if (parsedMessage) {
        message = parsedMessage;
      }
      code = sanitizeAuditText(parsed?.type || parsed?.code || '');
      detail = sanitizeAuditText(JSON.stringify(parsed));
    } catch (parseError) {
      // Ignore parse errors and keep raw message.
    }
    if (!code && error?.code) {
      code = sanitizeAuditText(error.code);
    }
    return {
      status: Number.isFinite(status) ? status : null,
      message: message.slice(0, 300),
      detail: detail.slice(0, 700),
      code
    };
  };

  const classifyAddToCartFailure = details => {
    const status = Number(details?.status);
    const code = String(details?.code || '').toLowerCase();
    const message = String(details?.message || '').toLowerCase();
    const detail = String(details?.detail || '').toLowerCase();
    const combined = `${code} ${message} ${detail}`;

    if (
      /not associated with any stock location/.test(combined) ||
      (/sales channel/.test(combined) && /stock location/.test(combined))
    ) {
      return {
        key: 'unavailable_stock_location',
        userMessage: 'This option is unavailable right now. Please choose another option.'
      };
    }

    if (/out of stock|not enough inventory|insufficient inventory|inventory item/.test(combined)) {
      return {
        key: 'out_of_stock',
        userMessage: 'This option is currently out of stock. Please choose another option.'
      };
    }

    if (/do not exist|does not exist|not published|variant .* not found|invalid_data/.test(combined)) {
      return {
        key: 'unavailable_variant',
        userMessage: 'This option is unavailable right now. Please choose another option.'
      };
    }

    if (/missing price|no price|not priced|price list|price.*region|region.*price/.test(combined)) {
      return {
        key: 'missing_price',
        userMessage: 'This option is not priced yet for your region. Please choose another option.'
      };
    }

    if (status >= 500) {
      return {
        key: 'server_error',
        userMessage: 'The cart service is temporarily unavailable. Please try again.'
      };
    }

    return {
      key: 'unknown_add_failure',
      userMessage: 'Unable to add this item right now. Please try again.'
    };
  };

  let cartToastEl = null;
  let cartToastTimeout = null;

  const ensureCartToast = () => {
    if (cartToastEl && document.body?.contains(cartToastEl)) return cartToastEl;
    const toast = document.createElement('div');
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.style.position = 'fixed';
    toast.style.left = '50%';
    toast.style.bottom = '1.5rem';
    toast.style.transform = 'translateX(-50%)';
    toast.style.maxWidth = 'min(90vw, 32rem)';
    toast.style.padding = '0.75rem 1rem';
    toast.style.borderRadius = '0.75rem';
    toast.style.background = '#7f1d1d';
    toast.style.color = '#ffffff';
    toast.style.fontSize = '0.9rem';
    toast.style.fontWeight = '600';
    toast.style.lineHeight = '1.3';
    toast.style.boxShadow = '0 12px 30px rgba(15, 23, 42, 0.25)';
    toast.style.opacity = '0';
    toast.style.pointerEvents = 'none';
    toast.style.zIndex = '9999';
    toast.style.transition = 'opacity 160ms ease';
    document.body.appendChild(toast);
    cartToastEl = toast;
    return toast;
  };

  const showCartToast = (message, tone = 'error') => {
    const toast = ensureCartToast();
    if (!toast) return;
    toast.textContent = message;
    toast.style.background = tone === 'error' ? '#7f1d1d' : '#065f46';
    toast.style.opacity = '1';
    if (cartToastTimeout) {
      window.clearTimeout(cartToastTimeout);
    }
    cartToastTimeout = window.setTimeout(() => {
      toast.style.opacity = '0';
    }, 4500);
  };

  const handleAddToCart = async button => {
    if (!button || button.disabled || button.getAttribute('aria-busy') === 'true') return;
    const variantId = await resolveVariantId(button);
    const context = buildAddToCartContext(button, variantId);
    recordCartAddAttempt(context);
    if (!variantId) {
      const failure = {
        ...context,
        reason: 'missing_variant_id',
        failure_type: 'selection_required',
        user_message: 'Please select an option before adding to cart.',
        status: null,
        error_message: 'Missing variant ID for add-to-cart.',
        response_detail: ''
      };
      recordCartAddFailure(failure);
      console.error('[commerce][add-to-cart]', failure);
      showCartToast('Please select an option before adding to cart.', 'error');
      return;
    }
    const quantity = context.quantity;
    const metadata = buildLineItemMetadata(button);
    button.setAttribute('aria-busy', 'true');
    button.disabled = true;
    try {
      await addLineItem(variantId, quantity, metadata);
      await syncBadges();
      window.ldcCart?.open?.();
    } catch (error) {
      const details = getAddToCartErrorDetails(error);
      const classified = classifyAddToCartFailure(details);
      const failure = {
        ...context,
        variant_id: variantId,
        reason: 'add_line_item_failed',
        failure_type: classified.key,
        user_message: classified.userMessage,
        error_code: details.code || '',
        status: details.status,
        error_message: details.message,
        response_detail: details.detail
      };
      recordCartAddFailure(failure);
      console.error('[commerce][add-to-cart]', failure);
      showCartToast(classified.userMessage, 'error');
    } finally {
      button.removeAttribute('aria-busy');
      button.disabled = false;
    }
  };

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-add-to-cart]');
    if (!button) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    handleAddToCart(button);
  }, true);

  document.addEventListener('click', event => {
    const swatch = event.target.closest('.swatch');
    if (!swatch) return;
    scheduleSwatchPriceUpdate(swatch);
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const swatch = event.target.closest('.swatch');
    if (!swatch) return;
    scheduleSwatchPriceUpdate(swatch);
  });

  const signInForm = document.querySelector('[data-signin-form]');
  if (signInForm) signInForm.addEventListener('submit', handleSignIn);

  const signUpForm = document.querySelector('[data-signup-form]');
  if (signUpForm) signUpForm.addEventListener('submit', handleSignUp);

  const requestForUi = async (path, options = {}) => {
    const payload = await request(path, options);
    return normalizeCommerceResponseForDisplay(payload);
  };

  const getOrCreateCartForUi = async () => {
    const cart = await getOrCreateCart();
    return normalizeCartForDisplay(cart);
  };

  window.LDCCommerce = {
    enabled: true,
    backendUrl,
    request: requestForUi,
    getCustomer,
    getOrders,
    getOrCreateCart: getOrCreateCartForUi,
    addLineItem,
    syncBadges,
    syncLegacyCart,
    resolveVariantId,
    removeLineItem,
    updateLineItemQuantity,
    changeLineItemQuantity,
    resetCart,
    hydrateProductCards,
    renderDynamicGrids,
    getCurrencyCode,
    getCurrencyDivisor,
    formatMoneyFromMinor
  };

  const initStorefront = () => {
    syncBadges();
    hydrateProductCards();
    renderDynamicGrids();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initStorefront);
  } else {
    initStorefront();
  }
})();
