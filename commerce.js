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
        .catch(error => {
          console.warn('[commerce] Product map unavailable:', error);
          return null;
        });
    }
    return productMapPromise;
  };
  loadProductMap();

  const slugify = value =>
    String(value || '')
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

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

  const getProductPrice = product => {
    const variants = Array.isArray(product?.variants) ? product.variants : [];
    const firstVariant = variants[0];
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

  const fetchStoreProducts = async () => {
    const limit = 200;
    let offset = 0;
    let results = [];
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
        fields: '+variants,+thumbnail,+images,+description,+subtitle'
      });
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

  const updateProductCard = (container, product) => {
    if (!container || !product) return;
    const title = product.title || '';
    if (title) {
      const titleEls = container.querySelectorAll(
        '[data-product-title], .tile-title, .product-title, .hero-heading, h1, h2, h3'
      );
      titleEls.forEach(el => {
        if (!el) return;
        el.textContent = title;
      });
    }

    const priceInfo = getProductPrice(product);
    if (priceInfo) {
      const formatted = formatCurrency(priceInfo.amount, priceInfo.currency);
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
      if (priceEl && formatted) {
        priceEl.textContent = formatted;
      }
    }

    const description = product.description || product.subtitle || '';
    if (description) {
      let descriptionEl =
        container.querySelector('[data-product-description]') ||
        container.querySelector('.product-description') ||
        container.querySelector('.tile-description') ||
        null;
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
  };

  const hydrateProductCards = async () => {
    const containers = getProductContainers();
    if (!containers.size) return;
    const products = await fetchStoreProducts();
    if (!products.length) return;
    const productByHandle = new Map(
      products.map(product => [product?.handle || product?.id, product])
    );

    containers.forEach((key, container) => {
      const product = productByHandle.get(key);
      if (product) {
        updateProductCard(container, product);
        return;
      }
      const fallbackKey = slugify(key);
      const fallback = productByHandle.get(fallbackKey);
      if (fallback) {
        updateProductCard(container, fallback);
      }
    });
  };

  const cleanVariantLabel = value =>
    String(value || '')
      .replace(/^\s*View\s+/i, '')
      .replace(/\s*(swatch|accent|option)\s*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();

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

  const resolveVariantId = async button => {
    const direct = button.dataset.variantId || button.dataset.medusaVariantId;
    if (direct) return direct;

    const explicitKey = button.dataset.productKey || button.closest('[data-product-key]')?.dataset.productKey;
    const key = explicitKey || deriveProductKey(button);
    if (!key) return null;

    const map = await loadProductMap();
    const entry = map?.products?.[key];
    const selectedLabel = getSelectedVariantLabel(button);
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
    const options = [];
    if (optionLabel) {
      options.push({
        label: metadataType === 'accessory' ? 'Accessory' : 'Color',
        value: optionLabel,
        swatchStyle: metadataStyle,
        swatchGlyph: metadataGlyph
      });
    } else if (candidateVariant && candidateVariant !== displayTitle) {
      options.push({ label: 'Variant', value: candidateVariant });
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
    syncBadges,
    syncLegacyCart,
    resolveVariantId,
    removeLineItem,
    updateLineItemQuantity,
    changeLineItemQuantity,
    resetCart,
    hydrateProductCards
  };

  syncBadges();
  hydrateProductCards();
})();
