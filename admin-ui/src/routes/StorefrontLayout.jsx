import React, { useEffect, useMemo, useState } from 'react';
import PageHeader from '../components/PageHeader.jsx';
import { formatApiError, getList, request } from '../lib/api.js';
import { STOREFRONT_SECTIONS } from '../data/storefrontSections.js';

const slugify = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

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

const parseStorefrontHidden = (raw) => {
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
    } catch (err) {
      return raw
        .split(',')
        .map((entry) => entry.trim())
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
  const metadata = normalizeMetadata(product?.metadata);
  const hiddenMap = parseStorefrontHidden(metadata?.storefront_hidden);
  if (hiddenMap[section.key]) return false;
  const explicitSections = parseStorefrontSections(metadata?.storefront_sections);
  if (explicitSections.length) {
    return explicitSections.includes(section.key);
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

const StorefrontLayout = () => {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sectionOrder, setSectionOrder] = useState({});
  const [sectionSaving, setSectionSaving] = useState({});
  const [actionState, setActionState] = useState({ savingId: null, error: '' });
  const [sectionSearch, setSectionSearch] = useState({});

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
        const ids = (sectionProducts[section.key] || []).map((product) => product.id);
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
  }, [sectionProducts]);

  const updateProductMetadata = async (productId, updater) => {
    const product = productById.get(productId);
    if (!product) return;
    const metadata = normalizeMetadata(product?.metadata);
    const nextMetadata = updater({ ...metadata });
    const payload = {
      metadata: Object.keys(nextMetadata).length ? nextMetadata : null
    };
    const response = await request(`/admin/products/${productId}`, {
      method: 'POST',
      body: payload
    });
    const updated = response?.product || response?.data?.product || response?.products?.[0] || null;
    if (!updated) {
      setProducts((prev) =>
        prev.map((item) => (item.id === productId ? { ...item, metadata: payload.metadata } : item))
      );
      return;
    }
    setProducts((prev) => prev.map((item) => (item.id === productId ? updated : item)));
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

  const handleSaveOrder = async (sectionKey) => {
    const order = sectionOrder[sectionKey] || [];
    if (!order.length) return;
    setSectionSaving((prev) => ({ ...prev, [sectionKey]: true }));
    setActionState({ savingId: null, error: '' });
    try {
      const updates = order.map((productId, index) => {
        const product = productById.get(productId);
        if (!product) return null;
        const existing = getStorefrontOrderValue(product, sectionKey);
        const nextValue = index + 1;
        if (existing === nextValue) return null;
        return updateProductMetadata(productId, (metadata) => {
          const next = { ...metadata };
          const storefrontOrder = normalizeMetadata(next.storefront_order);
          const nextOrder = { ...storefrontOrder, [sectionKey]: nextValue };
          next.storefront_order = nextOrder;
          return next;
        });
      });
      await Promise.all(updates.filter(Boolean));
    } catch (err) {
      setActionState({ savingId: null, error: formatApiError(err, 'Unable to save order.') });
    } finally {
      setSectionSaving((prev) => ({ ...prev, [sectionKey]: false }));
    }
  };

  const handleAddToSection = async (sectionKey, productId) => {
    setActionState({ savingId: productId, error: '' });
    try {
      await updateProductMetadata(productId, (metadata) => {
        const next = { ...metadata };
        const sections = parseStorefrontSections(next.storefront_sections);
        if (!sections.includes(sectionKey)) sections.push(sectionKey);
        next.storefront_sections = sections;
        const hiddenMap = parseStorefrontHidden(next.storefront_hidden);
        if (hiddenMap[sectionKey]) {
          const cleaned = { ...hiddenMap };
          delete cleaned[sectionKey];
          next.storefront_hidden = Object.keys(cleaned).length ? cleaned : undefined;
        }
        return next;
      });
      setSectionOrder((prev) => {
        const list = [...(prev[sectionKey] || [])];
        if (!list.includes(productId)) list.push(productId);
        return { ...prev, [sectionKey]: list };
      });
    } catch (err) {
      setActionState({ savingId: null, error: formatApiError(err, 'Unable to add product.') });
    } finally {
      setActionState((prev) => ({ ...prev, savingId: null }));
    }
  };

  const handleRemoveFromSection = async (sectionKey, productId) => {
    setActionState({ savingId: productId, error: '' });
    try {
      await updateProductMetadata(productId, (metadata) => {
        const next = { ...metadata };
        const sections = parseStorefrontSections(next.storefront_sections).filter(
          (key) => key !== sectionKey
        );
        if (sections.length) {
          next.storefront_sections = sections;
        } else {
          delete next.storefront_sections;
        }
        return next;
      });
      setSectionOrder((prev) => {
        const list = (prev[sectionKey] || []).filter((id) => id !== productId);
        return { ...prev, [sectionKey]: list };
      });
    } catch (err) {
      setActionState({ savingId: null, error: formatApiError(err, 'Unable to remove product.') });
    } finally {
      setActionState((prev) => ({ ...prev, savingId: null }));
    }
  };

  const handleToggleHidden = async (sectionKey, productId, hide) => {
    setActionState({ savingId: productId, error: '' });
    try {
      await updateProductMetadata(productId, (metadata) => {
        const next = { ...metadata };
        const hiddenMap = parseStorefrontHidden(next.storefront_hidden);
        if (hide) {
          hiddenMap[sectionKey] = true;
        } else {
          delete hiddenMap[sectionKey];
        }
        if (Object.keys(hiddenMap).length) {
          next.storefront_hidden = hiddenMap;
        } else {
          delete next.storefront_hidden;
        }
        return next;
      });
      if (hide) {
        setSectionOrder((prev) => {
          const list = (prev[sectionKey] || []).filter((id) => id !== productId);
          return { ...prev, [sectionKey]: list };
        });
      }
    } catch (err) {
      setActionState({ savingId: null, error: formatApiError(err, 'Unable to update visibility.') });
    } finally {
      setActionState((prev) => ({ ...prev, savingId: null }));
    }
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
        subtitle="Assign products, reorder tiles, and manage visibility for each page section."
      />

      {loading ? (
        <p className="text-sm text-ldc-ink/60">Loading products...</p>
      ) : error ? (
        <div className="ldc-card p-6 text-sm text-rose-600">{error}</div>
      ) : (
        <div className="space-y-6">
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
                    disabled={sectionSaving[section.key]}
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
                    list.map((productId, index) => {
                      const product = productById.get(productId);
                      if (!product) return null;
                      const metadata = normalizeMetadata(product.metadata);
                      const explicitSections = parseStorefrontSections(metadata?.storefront_sections);
                      const isExplicit = explicitSections.includes(section.key);
                      const hiddenMap = parseStorefrontHidden(metadata?.storefront_hidden);
                      const isHidden = hiddenMap[section.key];
                      return (
                        <div
                          key={productId}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/60 bg-white/70 px-4 py-3 text-sm text-ldc-ink"
                        >
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
                            <button
                              className="ldc-button-secondary"
                              onClick={() => handleMove(section.key, index, -1)}
                              disabled={index === 0}
                            >
                              Up
                            </button>
                            <button
                              className="ldc-button-secondary"
                              onClick={() => handleMove(section.key, index, 1)}
                              disabled={index === list.length - 1}
                            >
                              Down
                            </button>
                            {isExplicit ? (
                              <button
                                className="ldc-button-secondary"
                                onClick={() => handleRemoveFromSection(section.key, productId)}
                                disabled={actionState.savingId === productId}
                              >
                                {actionState.savingId === productId ? 'Removing...' : 'Remove'}
                              </button>
                            ) : null}
                            <button
                              className="ldc-button-secondary"
                              onClick={() => handleToggleHidden(section.key, productId, !isHidden)}
                              disabled={actionState.savingId === productId}
                            >
                              {actionState.savingId === productId
                                ? 'Saving...'
                                : isHidden
                                  ? 'Show'
                                  : 'Hide'}
                            </button>
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
