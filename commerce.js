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
    body.dataset.medusaPublishableKey || window.LDC_MEDUSA_PUBLISHABLE_KEY || '';

  const CART_ID_KEY = 'ldc:medusa:cart_id';
  const LEGACY_CART_KEY = 'ldc:cart';
  const badgeEls = Array.from(document.querySelectorAll('[data-cart-count]'));
  const productMapUrl = body.dataset.productMap || window.LDC_PRODUCT_MAP || 'product-map.json';
  let productMapPromise = null;
  let productMapCache = null;
  let storeProductsPromise = null;
  let productIndexPromise = null;
  let regionIdPromise = null;
  const missingSwatchMeta = new Set();

  const request = async (path, options = {}) => {
    const url = `${backendUrl}${path}`;
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(publishableKey ? { 'x-publishable-api-key': publishableKey } : {}),
        ...(options.headers || {})
      },
      credentials: 'include',
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

  const parseStorefrontList = raw => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.map(entry => String(entry)).filter(Boolean);
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.map(entry => String(entry)).filter(Boolean);
        if (parsed && typeof parsed === 'object') {
          return Object.keys(parsed).filter(key => parsed[key]).map(key => String(key));
        }
      } catch (error) {
        return raw
          .split(',')
          .map(entry => entry.trim())
          .filter(Boolean);
      }
    }
    if (raw && typeof raw === 'object') {
      return Object.keys(raw).filter(key => raw[key]).map(key => String(key));
    }
    return [];
  };

  const parseStorefrontHidden = raw => {
    if (!raw) return {};
    if (Array.isArray(raw)) {
      return raw.reduce((acc, key) => {
        if (key) acc[String(key)] = true;
        return acc;
      }, {});
    }
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return parseStorefrontHidden(parsed);
      } catch (error) {
        return raw
          .split(',')
          .map(entry => entry.trim())
          .filter(Boolean)
          .reduce((acc, key) => {
            acc[key] = true;
            return acc;
          }, {});
      }
    }
    if (raw && typeof raw === 'object') {
      return Object.entries(raw).reduce((acc, [key, value]) => {
        if (value) acc[String(key)] = true;
        return acc;
      }, {});
    }
    return {};
  };

  const getStorefrontSections = product => {
    const metadata = normalizeMetadata(product?.metadata);
    return parseStorefrontList(metadata?.storefront_sections);
  };

  const isStorefrontHidden = (product, sectionKey) => {
    const metadata = normalizeMetadata(product?.metadata);
    const hidden = parseStorefrontHidden(metadata?.storefront_hidden);
    return Boolean(hidden?.[sectionKey]);
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

  const formatCurrency = (amount, currencyCode = 'USD') => {
    const value = Number(amount);
    if (!Number.isFinite(value)) return '';
    const code = String(currencyCode || 'USD').toUpperCase();
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code
    }).format(value / 100);
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

  const fetchStoreProducts = async () => {
    const limit = 200;
    let offset = 0;
    let results = [];
    let hasMore = true;
    const regionId = await loadRegionId();

    while (hasMore) {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
        fields:
          '+variants,+variants.variant_rank,+variants.calculated_price,+variants.prices,+variants.metadata,+variants.thumbnail,+variants.options,+thumbnail,+images,+description,+subtitle,+collection,+tags,+metadata,+created_at'
      });
      if (regionId) {
        params.set('region_id', regionId);
      }
      let payload = null;
      try {
        payload = await request(`/store/products?${params.toString()}`);
      } catch (error) {
        try {
          payload = await request(`/store/products?limit=${limit}&offset=${offset}`);
        } catch (innerError) {
          console.warn('[commerce] Unable to fetch products:', innerError);
          return results;
        }
      }

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

  const updateProductCard = (container, product, preferredVariantId, sectionKey) => {
    if (!container || !product) return;
    const overrides = getStorefrontTileOverride(product, sectionKey);
    const title = overrides?.title || product.title || '';
    if (title) {
      const titleEls = container.querySelectorAll(
        '[data-product-title], .tile-title, .product-title, .hero-heading, h1, h2, h3'
      );
      titleEls.forEach(el => {
        if (!el) return;
        el.textContent = title;
      });
    }

    updateProductPrice(container, product, preferredVariantId, overrides);

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
      container.querySelector('.badge-custom');
    if (badgeEl) {
      if (overrides?.badge) {
        badgeEl.textContent = overrides.badge;
        badgeEl.style.display = '';
      } else {
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
      trackVariants.forEach((variant, index) => {
        const label = getVariantLabel(variant);
        const meta = getVariantSwatchMeta(variant);
        if (!meta.style && !meta.glyph && trackVariants.length > 1) {
          const handle = product?.handle || product?.id || 'unknown';
          missingSwatchMeta.add(handle);
        }
        const swatch = buildSwatchElement(variant, label, index);
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
      swatchTracks.slice(2).forEach(track => track.closest('[data-swatch-slider]')?.classList.add('hidden'));
    } else {
      fillTrack(swatchTracks[0], combinedVariants);
    }

    if (swatchSliders.length) {
      swatchSliders.forEach((slider, sliderIndex) => {
        const track = swatchTracks[sliderIndex] || null;
        const hasSwatches = Boolean(track && track.children.length);
        if (!hasSwatches) {
          slider.classList.add('hidden');
          if (swatchWindows[sliderIndex]) {
            swatchWindows[sliderIndex].style.display = 'none';
          }
          return;
        }
        slider.classList.remove('hidden');
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

    const newBadge = card.querySelector('.badge-new');
    if (newBadge) {
      const isNew = !overrides?.badge && getProductTags(product).includes('new-arrivals');
      newBadge.style.display = isNew ? 'inline-flex' : 'none';
    }
    const limitedBadge = card.querySelector('.badge-limited');
    if (limitedBadge) {
      const isLimited = !overrides?.badge && getProductTags(product).includes('limited');
      limitedBadge.style.display = isLimited ? 'inline-flex' : 'none';
    }

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

  const filterProductsForSection = (products, filters) => {
    if (!products?.length) return [];
    const { collectionHandles, tagHandles } = filters;
    return products.filter(product => {
      const sectionKey = filters.sectionKey;
      if (sectionKey && isStorefrontHidden(product, sectionKey)) {
        return false;
      }
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
    return [...products].sort((a, b) => {
      const aOrder = getStorefrontOrderValue(a, sectionKey);
      const bOrder = getStorefrontOrderValue(b, sectionKey);
      if (aOrder != null || bOrder != null) {
        if (aOrder == null) return 1;
        if (bOrder == null) return -1;
        if (aOrder !== bOrder) return aOrder - bOrder;
      }
      const aDate = new Date(a?.created_at || 0).getTime();
      const bDate = new Date(b?.created_at || 0).getTime();
      return bDate - aDate;
    });
  };

  const renderDynamicGrids = async () => {
    const containers = Array.from(
      document.querySelectorAll('[data-medusa-collection], [data-medusa-tag]')
    );
    if (!containers.length) return;
    const products = await loadStoreProducts();
    if (!products.length) return;

    containers.forEach(container => {
      const templateElement = container.querySelector('template[data-card-template]');
      const template =
        templateElement?.content?.firstElementChild ||
        container.querySelector('.product-card');
      if (!template) return;
      container.classList.add('product-grid');
      container.classList.remove('is-loaded');
      const filters = getSectionFilters(container);
      let sectionProducts = filterProductsForSection(products, filters);
      sectionProducts = sortProductsForSection(sectionProducts, filters.sectionKey);
      if (filters.limit) {
        sectionProducts = sectionProducts.slice(0, filters.limit);
      }
      if (!sectionProducts.length) {
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
    });

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
    const swatchLabel = label || getVariantLabel(variant) || 'Variant';
    swatch.className = 'swatch swatch-auto cursor-pointer';
    swatch.dataset.variantId = variant?.id || '';
    swatch.dataset.variantLabel = swatchLabel;
    if (meta.type) {
      swatch.dataset.swatchType = meta.type;
    }
    if (meta.style) {
      const baseStyle = String(meta.style || '').trim().replace(/;$/, '');
      const sizeStyle = 'width:1.25rem;height:1.25rem;border-radius:9999px;display:inline-flex;align-items:center;justify-content:center;';
      swatch.setAttribute('style', `${baseStyle};${sizeStyle}`);
    } else {
      swatch.classList.add('is-text');
      swatch.textContent = swatchLabel;
    }
    if (meta.glyph) {
      swatch.classList.add('is-glyph');
      swatch.textContent = meta.glyph;
    }
    if (meta.image) {
      swatch.dataset.variantImage = meta.image;
    }
    swatch.setAttribute('aria-label', swatchLabel);
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

      const getGap = () => {
        const styles = window.getComputedStyle(track);
        const gapValue = styles.columnGap || styles.gap || '0px';
        return parseFloat(gapValue) || 0;
      };

      const update = () => {
        const swatches = Array.from(track.children);
        const total = swatches.length;
        if (!total) return;
        const visible = Number(slider.dataset.visible || 4) || 4;
        const first = swatches[0];
        const swatchWidth =
          first.getBoundingClientRect().width ||
          parseFloat(window.getComputedStyle(first).width) ||
          0;
        const gap = getGap();
        const windowEl = slider.querySelector('[data-swatch-window]');
        if (windowEl && slider.closest('.product-card')) {
          const windowStyles = window.getComputedStyle(windowEl);
          const paddingLeft = parseFloat(windowStyles.paddingLeft || '0');
          const paddingRight = parseFloat(windowStyles.paddingRight || '0');
          const windowWidth =
            (swatchWidth + gap) * visible - gap + paddingLeft + paddingRight + 12;
          if (windowWidth > 0) {
            windowEl.style.width = `${windowWidth}px`;
            windowEl.style.overflow = 'hidden';
          }
        }
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
      const data = await request(`/store/carts/${id}`);
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

  const formatLegacyItem = (item, currencyCode) => {
    if (!item) return null;
    const rawUnitPrice = Number(item.unit_price || 0);
    const unitPrice = Number.isFinite(rawUnitPrice) ? rawUnitPrice : 0;
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
    const designAttachmentData =
      metadata.design_attachment_data ||
      metadata.designAttachmentData ||
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
        attachmentData: designAttachmentData
      });
    }
    return {
      id: String(item.id || displayTitle),
      name: String(displayTitle),
      price: unitPrice,
      quantity: Math.max(1, Number(item.quantity || 1)),
      previewStyle,
      options
    };
  };

  const syncLegacyCart = cart => {
    const items = Array.isArray(cart?.items)
      ? cart.items.map(item => formatLegacyItem(item, cart?.currency_code)).filter(Boolean)
      : [];
    try {
      localStorage.setItem(LEGACY_CART_KEY, JSON.stringify({ items }));
    } catch (error) {
      // Ignore storage errors.
    }
    try {
      document.dispatchEvent(new CustomEvent('cart:set', { detail: { items } }));
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

  const handleAddToCart = async button => {
    const variantId = await resolveVariantId(button);
    if (!variantId) {
      console.warn('[commerce] Missing variant ID for add-to-cart.');
      return;
    }
    const quantity = Number(button.dataset.quantity || 1) || 1;
    const metadata = buildLineItemMetadata(button);
    button.setAttribute('aria-busy', 'true');
    button.disabled = true;
    try {
      await addLineItem(variantId, quantity, metadata);
      await syncBadges();
      window.ldcCart?.open?.();
    } catch (error) {
      console.warn('[commerce] Unable to add to cart:', error);
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

  window.LDCCommerce = {
    enabled: true,
    backendUrl,
    request,
    getCustomer,
    getOrders,
    getOrCreateCart,
    addLineItem,
    syncBadges,
    syncLegacyCart,
    resolveVariantId,
    removeLineItem,
    updateLineItemQuantity,
    changeLineItemQuantity,
    resetCart,
    hydrateProductCards,
    renderDynamicGrids
  };

  syncBadges();
  hydrateProductCards();
  renderDynamicGrids();
})();
