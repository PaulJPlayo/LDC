import React, { useEffect, useMemo, useRef, useState } from 'react';
import PageHeader from '../components/PageHeader.jsx';
import { formatApiError, getList, request } from '../lib/api.js';
import { STOREFRONT_SECTIONS } from '../data/storefrontSections.js';

const slugify = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const normalizeSectionKey = (key) => String(key || '').replace(/^page-/, '');

const normalizeMetadata = (metadata) => {
  if (!metadata) return {};
  if (typeof metadata === 'object') return metadata;
  if (typeof metadata === 'string') {
    try {
      const parsed = JSON.parse(metadata);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
      return {};
    }
  }
  return {};
};

const parseStorefrontSections = (raw) => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((entry) => String(entry)).filter(Boolean);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((entry) => String(entry)).filter(Boolean);
      if (parsed && typeof parsed === 'object') {
        return Object.keys(parsed).filter((key) => parsed[key]).map((key) => String(key));
      }
    } catch (err) {
      return raw
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
  }
  if (raw && typeof raw === 'object') {
    return Object.keys(raw).filter((key) => raw[key]).map((key) => String(key));
  }
  return [];
};

const getStorefrontOrderValue = (product, sectionKey) => {
  const metadata = normalizeMetadata(product?.metadata);
  let raw = metadata?.storefront_order;
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch (err) {
      const numeric = Number(raw);
      return Number.isFinite(numeric) ? numeric : null;
    }
  }
  if (typeof raw === 'number') return raw;
  if (raw && typeof raw === 'object') {
    const direct = Number(raw?.[sectionKey]);
    if (Number.isFinite(direct)) return direct;
    const fallback = Number(raw?.default);
    return Number.isFinite(fallback) ? fallback : null;
  }
  return null;
};

const setStorefrontOrder = (metadata, sectionKey, value) => {
  const next = { ...metadata };
  const current = normalizeMetadata(next.storefront_order);
  if (current && typeof current === 'object' && !Array.isArray(current)) {
    next.storefront_order = { ...current, [sectionKey]: value };
    return next;
  }
  next.storefront_order = value;
  return next;
};

const removeStorefrontOrder = (metadata, sectionKey) => {
  const next = { ...metadata };
  const current = normalizeMetadata(next.storefront_order);
  if (current && typeof current === 'object' && !Array.isArray(current)) {
    const cleaned = { ...current };
    delete cleaned[sectionKey];
    next.storefront_order = Object.keys(cleaned).length ? cleaned : null;
    return next;
  }
  next.storefront_order = null;
  return next;
};

const getProductTags = (product) => {
  const tags = Array.isArray(product?.tags) ? product.tags : [];
  return tags
    .map((tag) => {
      if (typeof tag === 'string') return tag;
      return tag?.value || tag?.handle || tag?.title || '';
    })
    .filter(Boolean)
    .map((tag) => slugify(tag));
};

const getProductCollectionHandle = (product) => {
  const handle = product?.collection?.handle || product?.collection?.title || '';
  return slugify(handle);
};

const productMatchesSection = (product, section) => {
  const safeSectionKey = normalizeSectionKey(section.key);
  const metadata = normalizeMetadata(product?.metadata);
  const explicitSections = parseStorefrontSections(metadata?.storefront_sections);
  if (explicitSections.length) {
    return explicitSections.includes(safeSectionKey);
  }
  const filter = section?.filter || {};
  if (filter.collection) {
    const handle = getProductCollectionHandle(product);
    if (handle !== slugify(filter.collection)) return false;
  }
  if (filter.tag) {
    const tags = getProductTags(product);
    if (!tags.includes(slugify(filter.tag))) return false;
  }
  return true;
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
    const aDate = new Date(a?.created_at || 0).getTime();
    const bDate = new Date(b?.created_at || 0).getTime();
    return bDate - aDate;
  });
};

const StorefrontLayout = () => {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sectionOrder, setSectionOrder] = useState({});
  const [sectionSaving, setSectionSaving] = useState({});
  const [actionState, setActionState] = useState({ savingId: null, error: '' });
  const [sectionSearch, setSectionSearch] = useState({});
  const [dragState, setDragState] = useState({ sectionKey: '', productId: '' });
  const [lastSavedMeta, setLastSavedMeta] = useState(null);
  const [pendingRemovals, setPendingRemovals] = useState({});
  const savingSectionsRef = useRef(new Set());

  const productById = useMemo(() => {
    const map = new Map();
    products.forEach((product) => {
      if (product?.id) map.set(product.id, product);
    });
    return map;
  }, [products]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const limit = 100;
        let offset = 0;
        let all = [];
        while (true) {
          const payload = await getList('/admin/products', {
            limit,
            offset,
            expand: 'collection,tags'
          });
          const batch = payload?.products || payload?.data || [];
          all = all.concat(batch);
          if (!Array.isArray(batch) || batch.length < limit) break;
          offset += batch.length;
        }
        if (!mounted) return;
        setProducts(all);
      } catch (err) {
        if (!mounted) return;
        setError(formatApiError(err, 'Unable to load products.'));
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const sectionProducts = useMemo(() => {
    const map = {};
    STOREFRONT_SECTIONS.forEach((section) => {
      const filtered = products.filter((product) => productMatchesSection(product, section));
      map[section.key] = sortProductsForSection(filtered, section.key);
    });
    return map;
  }, [products]);

  useEffect(() => {
    setSectionOrder((prev) => {
      const next = { ...prev };
      STOREFRONT_SECTIONS.forEach((section) => {
        const current = next[section.key] || [];
        const removed = new Set(pendingRemovals[section.key] || []);
        const ids = (sectionProducts[section.key] || [])
          .map((product) => product.id)
          .filter((id) => !removed.has(id));
        if (!current.length) {
          next[section.key] = ids;
        } else {
          const remaining = current.filter((id) => ids.includes(id));
          const missing = ids.filter((id) => !remaining.includes(id));
          next[section.key] = [...remaining, ...missing];
        }
      });
      return next;
    });
  }, [pendingRemovals, sectionProducts]);

  const updateProductMetadata = async (productId, updater) => {
    const product = productById.get(productId);
    if (!product) return;
    const metadata = normalizeMetadata(product?.metadata);
    const nextMetadata = updater({ ...metadata });
    const payload = {
      metadata: Object.keys(nextMetadata).length ? nextMetadata : null
    };
    try {
      console.info('[StorefrontLayout] Saving metadata payload.', productId, payload.metadata);
      const response = await request(`/admin/products/${productId}`, {
        method: 'POST',
        body: payload
      });
      const updated = response?.product || response?.data?.product || response?.products?.[0] || null;
      if (!updated) {
        setProducts((prev) =>
          prev.map((item) => (item.id === productId ? { ...item, metadata: payload.metadata } : item))
        );
        console.info('[StorefrontLayout] Metadata saved (fallback).', productId, payload.metadata);
        setLastSavedMeta({
          productId,
          metadata: payload.metadata || {}
        });
        try {
          const verify = await request(`/admin/products/${productId}`);
          const live = verify?.product || verify?.data?.product || verify?.products?.[0] || null;
          console.info('[StorefrontLayout] Live metadata verification.', productId, live?.metadata);
        } catch (verifyError) {
          console.warn('[StorefrontLayout] Live metadata verification failed.', productId, verifyError);
        }
        return;
      }
      setProducts((prev) => prev.map((item) => (item.id === productId ? updated : item)));
      console.info('[StorefrontLayout] Metadata saved.', productId, updated?.metadata || payload.metadata);
      setLastSavedMeta({
        productId,
        metadata: updated?.metadata || payload.metadata || {}
      });
      try {
        const verify = await request(`/admin/products/${productId}`);
        const live = verify?.product || verify?.data?.product || verify?.products?.[0] || null;
        console.info('[StorefrontLayout] Live metadata verification.', productId, live?.metadata);
      } catch (verifyError) {
        console.warn('[StorefrontLayout] Live metadata verification failed.', productId, verifyError);
      }
    } catch (err) {
      console.warn('[StorefrontLayout] Metadata save failed.', productId, err);
      throw err;
    }
  };

  const handleMove = (sectionKey, index, direction) => {
    setSectionOrder((prev) => {
      const list = [...(prev[sectionKey] || [])];
      const target = index + direction;
      if (target < 0 || target >= list.length) return prev;
      [list[index], list[target]] = [list[target], list[index]];
      return { ...prev, [sectionKey]: list };
    });
  };

  const moveItem = (list, fromIndex, toIndex) => {
    if (fromIndex === toIndex) return list;
    const next = [...list];
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    return next;
  };

  const handleDragStart = (sectionKey, productId) => (event) => {
    setDragState({ sectionKey, productId });
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', productId);
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (sectionKey, targetId) => (event) => {
    event.preventDefault();
    const productId = dragState.productId || event.dataTransfer.getData('text/plain');
    if (!productId) return;
    setSectionOrder((prev) => {
      const list = [...(prev[sectionKey] || [])];
      const fromIndex = list.indexOf(productId);
      const toIndex = list.indexOf(targetId);
      if (fromIndex === -1 || toIndex === -1) return prev;
      return { ...prev, [sectionKey]: moveItem(list, fromIndex, toIndex) };
    });
    setDragState({ sectionKey: '', productId: '' });
  };

  const handleSaveOrder = async (sectionKey) => {
    const safeSectionKey = normalizeSectionKey(sectionKey);
    const order = sectionOrder[sectionKey] || [];
    const removals = pendingRemovals[sectionKey] || [];
    if (!order.length && !removals.length) return;
    if (sectionSaving[sectionKey]) return;
    if (savingSectionsRef.current.has(sectionKey)) return;
    savingSectionsRef.current.add(sectionKey);
    setSectionSaving((prev) => ({ ...prev, [sectionKey]: true }));
    setActionState({ savingId: null, error: '' });
    try {
      const removalSet = new Set(removals);
      const updates = order.map((productId, index) => {
        if (removalSet.has(productId)) return null;
        const product = productById.get(productId);
        if (!product) return null;
        const existing = getStorefrontOrderValue(product, safeSectionKey);
        const nextValue = index + 1;
        if (existing === nextValue) return null;
        return updateProductMetadata(productId, (metadata) => {
          const next = setStorefrontOrder(metadata, safeSectionKey, nextValue);
          console.info('[FixSectionKey] Final metadata:', safeSectionKey, next);
          return next;
        });
      });
      const removalUpdates = removals.map((productId) =>
        updateProductMetadata(productId, (metadata) => {
          let next = { ...metadata };
          const existingSections = parseStorefrontSections(next.storefront_sections);
          const remainingSections = existingSections.filter((key) => {
            const raw = String(key || "").trim();
            if (!raw) return false;
            const normalized = normalizeSectionKey(raw);
            return normalized !== safeSectionKey;
          });
          next.storefront_sections = remainingSections;
          next = removeStorefrontOrder(next, safeSectionKey);
          console.info("[StorefrontLayout] Removing section from product", productId, safeSectionKey);
          console.info("[StorefrontLayout] Before sections", existingSections);
          console.info("[StorefrontLayout] After sections", remainingSections);
          console.info('[FixSectionKey] Final metadata:', safeSectionKey, next);
          return next;
        })
      );
      await Promise.all([...updates, ...removalUpdates].filter(Boolean));
      setPendingRemovals((prev) => {
        if (!prev[sectionKey]) return prev;
        const next = { ...prev };
        delete next[sectionKey];
        return next;
      });
      console.info('[StorefrontLayout] Order saved.', safeSectionKey);
    } catch (err) {
      console.warn('[StorefrontLayout] Order save failed.', safeSectionKey, err);
      setActionState({ savingId: null, error: formatApiError(err, 'Unable to save order.') });
    } finally {
      setSectionSaving((prev) => ({ ...prev, [sectionKey]: false }));
      savingSectionsRef.current.delete(sectionKey);
    }
  };

  const handleAddToSection = async (sectionKey, productId) => {
    const safeSectionKey = normalizeSectionKey(sectionKey);
    setActionState({ savingId: productId, error: '' });
    try {
      await updateProductMetadata(productId, (metadata) => {
        let next = { ...metadata };
        const sections = parseStorefrontSections(next.storefront_sections);
        if (!sections.includes(safeSectionKey)) sections.push(safeSectionKey);
        next.storefront_sections = sections;
        const nextOrderValue = (sectionOrder[sectionKey] || []).length + 1;
        next = setStorefrontOrder(next, safeSectionKey, nextOrderValue);
        console.info('[FixSectionKey] Final metadata:', safeSectionKey, next);
        return next;
      });
      setSectionOrder((prev) => {
        const list = [...(prev[sectionKey] || [])];
        if (!list.includes(productId)) list.push(productId);
        return { ...prev, [sectionKey]: list };
      });
      setPendingRemovals((prev) => {
        if (!prev[sectionKey]) return prev;
        const next = { ...prev };
        const remaining = prev[sectionKey].filter((id) => id !== productId);
        if (remaining.length) {
          next[sectionKey] = remaining;
        } else {
          delete next[sectionKey];
        }
        return next;
      });
      console.info('[StorefrontLayout] Added product to section.', safeSectionKey, productId);
    } catch (err) {
      console.warn('[StorefrontLayout] Add product failed.', safeSectionKey, productId, err);
      setActionState({ savingId: null, error: formatApiError(err, 'Unable to add product.') });
    } finally {
      setActionState((prev) => ({ ...prev, savingId: null }));
    }
  };

  const handleRemoveFromSection = (sectionKey, productId) => {
    const safeSectionKey = normalizeSectionKey(sectionKey);
    setSectionOrder((prev) => {
      const list = (prev[sectionKey] || []).filter((id) => id !== productId);
      return { ...prev, [sectionKey]: list };
    });
    setPendingRemovals((prev) => {
      const next = { ...prev };
      const current = new Set(next[sectionKey] || []);
      current.add(productId);
      next[sectionKey] = Array.from(current);
      return next;
    });
    console.info('[StorefrontLayout] Queued removal from section.', safeSectionKey, productId);
  };

  const getSectionSearchResults = (sectionKey) => {
    const query = String(sectionSearch[sectionKey] || '').trim().toLowerCase();
    if (!query) return [];
    const assigned = new Set(sectionOrder[sectionKey] || []);
    return products
      .filter((product) => {
        if (!product) return false;
        const title = String(product.title || '').toLowerCase();
        const handle = String(product.handle || '').toLowerCase();
        return title.includes(query) || handle.includes(query);
      })
      .filter((product) => !assigned.has(product.id))
      .slice(0, 8);
  };

  return (
    <div>
      <PageHeader
        eyebrow="Storefront"
        title="Storefront Layout"
        subtitle="Assign products and reorder tiles for each page section."
      />

      {loading ? (
        <p className="text-sm text-ldc-ink/60">Loading products...</p>
      ) : error ? (
        <div className="ldc-card p-6 text-sm text-rose-600">{error}</div>
      ) : (
        <div className="space-y-6">
          {lastSavedMeta ? (
            <div className="ldc-card p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                Last Metadata Save
              </div>
              <div className="mt-2 text-xs text-ldc-ink/60">
                Product ID: {lastSavedMeta.productId}
              </div>
              <pre className="mt-3 whitespace-pre-wrap break-words rounded-2xl border border-white/60 bg-white/70 p-3 text-xs text-ldc-ink">
                {JSON.stringify(
                  {
                    storefront_sections: lastSavedMeta.metadata?.storefront_sections ?? null,
                    storefront_order: lastSavedMeta.metadata?.storefront_order ?? null
                  },
                  null,
                  2
                )}
              </pre>
            </div>
          ) : null}
          {actionState.error ? (
            <div className="ldc-card p-4 text-sm text-rose-600">{actionState.error}</div>
          ) : null}
          {STOREFRONT_SECTIONS.map((section) => {
            const list = sectionOrder[section.key] || [];
            const matches = getSectionSearchResults(section.key);
            return (
              <div key={section.key} className="ldc-card p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-heading text-xl text-ldc-ink">{section.label}</h3>
                    <p className="mt-1 text-xs uppercase tracking-[0.2em] text-ldc-ink/50">
                      Section key: {section.key}
                    </p>
                    <p className="mt-2 text-sm text-ldc-ink/60">
                      Source: {section.filter?.collection ? `Collection "${section.filter.collection}"` : `Tag "${section.filter.tag}"`}
                    </p>
                  </div>
                  <button
                    className="ldc-button-secondary"
                    onClick={() => handleSaveOrder(section.key)}
                    disabled={sectionSaving[section.key] || Boolean(dragState.productId)}
                  >
                    {sectionSaving[section.key] ? 'Saving order...' : 'Save order'}
                  </button>
                </div>

                <div className="mt-4">
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Add product to this section
                    <input
                      className="ldc-input mt-2"
                      placeholder="Search by product title or handle"
                      value={sectionSearch[section.key] || ''}
                      onChange={(event) =>
                        setSectionSearch((prev) => ({ ...prev, [section.key]: event.target.value }))
                      }
                    />
                  </label>
                  {matches.length ? (
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      {matches.map((product) => (
                        <div
                          key={product.id}
                          className="flex items-center justify-between rounded-2xl border border-white/60 bg-white/70 px-3 py-2 text-sm text-ldc-ink"
                        >
                          <div>
                            <div className="font-semibold">
                              {product.title || product.handle || product.id}
                            </div>
                            <div className="text-xs text-ldc-ink/50">
                              Handle {product.handle || '-'}
                            </div>
                          </div>
                          <button
                            className="ldc-button-secondary"
                            onClick={() => handleAddToSection(section.key, product.id)}
                            disabled={actionState.savingId === product.id}
                          >
                            {actionState.savingId === product.id ? 'Adding...' : 'Add'}
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="mt-6 space-y-3">
                  {!list.length ? (
                    <p className="text-sm text-ldc-ink/60">
                      No products assigned yet. Add products above or use tags/collections to populate.
                    </p>
                  ) : (
                    list.map((productId) => {
                      const product = productById.get(productId);
                      if (!product) return null;
                      const metadata = normalizeMetadata(product.metadata);
                      const explicitSections = parseStorefrontSections(metadata?.storefront_sections);
                      const safeSectionKey = normalizeSectionKey(section.key);
                      const isExplicit = explicitSections.includes(safeSectionKey);
                      return (
                        <div
                          key={productId}
                          className={`relative flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/60 bg-white/70 px-4 py-3 text-sm text-ldc-ink ${
                            dragState.productId === productId ? 'shadow-glow' : ''
                          }`}
                          draggable
                          onDragStart={handleDragStart(section.key, productId)}
                          onDragOver={handleDragOver}
                          onDrop={handleDrop(section.key, productId)}
                        >
                          <button
                            type="button"
                            aria-label="Remove from section"
                            className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full border border-white/70 bg-white/90 text-[0.7rem] font-semibold text-ldc-ink shadow-sm transition hover:bg-white"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              handleRemoveFromSection(section.key, productId);
                            }}
                          >
                            X
                          </button>
                          <div className="min-w-[220px]">
                            <div className="font-semibold">
                              {product.title || product.handle || product.id}
                            </div>
                            <div className="text-xs text-ldc-ink/50">
                              {product.handle ? `Handle ${product.handle}` : product.id}
                            </div>
                            <div className="mt-1 text-xs text-ldc-ink/60">
                              {isExplicit ? 'Manual tile' : 'Auto from collection/tag'}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-white/80 bg-white px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                              Drag to reorder
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default StorefrontLayout;
