# Favorites Legacy Key and Payload Audit

## Scope
Phase 1 audit only. No storefront behavior changes.

## Audit method
- Reviewed current storefront favorites implementation in:
  - `favorites.js`
  - `favorites.html`
  - `index.html`
  - `cups.html`
  - `accessories.html`
  - `tumblers.html`
  - `commerce.js`
  - `docs/favorites-flow-implementation-plan.md`
  - `docs/favorites-flow-verification.md`
- Reviewed git history for favorites storage usage and payload evolution using commit- and patch-level searches (`git log -S/-G/-p`).

## Discovered localStorage keys (favorites-related)

| Key | Purpose | Found in current code | Found in git history | Evidence |
|---|---|---|---|---|
| `ldc:favorites` | Canonical favorites payload key | Yes | Yes | Current: `favorites.js` (`STORAGE_KEY`), static-page fallbacks (`FAVORITES_STORAGE_KEY` in `index.html`, `cups.html`, `accessories.html`, `tumblers.html`). History: present back to `20047d6`. |
| `__ldc_favorites_store_probe__` | Shared-store availability probe key (non-persistent check) | Yes | Yes | Current/history in `favorites.js` `hasStorage()` probe/write/remove path. |
| `__ldc_favorites_probe__` | Older favorites-page availability probe key (non-persistent check) | No | Yes | Historical `favorites.html` in `e3ae03f` used this probe before shared module adoption. |

## Alternate favorites payload keys found
- No alternate persisted favorites payload key was found in repo history.
- Historical and current payload writes are consistently to `ldc:favorites`.
- `LEGACY_KEYS` in `favorites.js` currently contains only `['ldc:favorites']`, so current "legacy key migration" is effectively normalize/rewrite-in-place, not cross-key migration.

## Historical payload shapes discovered

### Shape A: Legacy minimal page-local payload
Observed in early `index.html` + `favorites.html` flows (for example `20047d6`, `e3ae03f`).

```json
{
  "items": [
    {
      "id": "<title|price-derived>",
      "name": "<string>",
      "price": 0,
      "previewStyle": "<inline-css>"
    }
  ]
}
```

### Shape B: Legacy enriched page-local payload (still pre-shared canonical)
Observed as inline page runtimes expanded (`30701e2`, `9abf8ff`, and later static page fallbacks).

```json
{
  "items": [
    {
      "id": "<page-local favorite id>",
      "name": "<string>",
      "title": "<optional>",
      "price": 0,
      "quantity": 1,
      "image": "<optional>",
      "previewImage": "<optional>",
      "previewStyle": "<inline-css>",
      "accessoryOnly": false,
      "options": [
        {
          "label": "Color|Accessory|Wrap|Notes|...",
          "value": "<string>",
          "swatchStyle": "<inline-css>",
          "swatchGlyph": "<optional>"
        }
      ]
    }
  ]
}
```

### Shape C: Favorites-page reduced re-serialization shape
Observed in historical `favorites.html` (`e3ae03f`) where loaded favorites were deduped and narrowed, then re-saved. This dropped richer fields from Shape B.

```json
{
  "items": [
    {
      "id": "<string>",
      "name": "<string>",
      "price": 0,
      "previewStyle": "<inline-css>"
    }
  ]
}
```

### Shape D: Current canonical shared-store shape (v2)
Current `favorites.js` canonical state:

```json
{
  "version": 2,
  "storage_key": "ldc:favorites",
  "updated_at": "<iso>",
  "items": [
    {
      "id": "<stable favorite key>",
      "favorite_key": "<stable favorite key>",
      "product_id": "<string>",
      "product_handle": "<string>",
      "product_url": "<string>",
      "variant_id": "<string>",
      "title": "<string>",
      "variant_title": "<string>",
      "short_description": "<string>",
      "description": "<string>",
      "price": 0,
      "currency_code": "USD",
      "preview_image": "<string>",
      "image_url": "<string>",
      "preview_style": "<inline-css>",
      "selected_options": [
        {
          "label": "<string>",
          "value": "<string>",
          "swatch_style": "<inline-css>",
          "swatch_glyph": "<string>"
        }
      ],
      "options_summary": "<string>",
      "source_path": "/",
      "added_at": "<iso>",
      "updated_at": "<iso>"
    }
  ]
}
```

## Canonical schema status
- Current canonical schema is Shape D in `favorites.js` (`STORE_VERSION = 2`).
- Current normalizer already accepts and maps several legacy forms:
  - payload as array or object with `items`
  - `options`/`selectedOptions` -> `selected_options`
  - `previewStyle` -> `preview_style`
  - camel/snake variants for multiple fields

## Migration determination

### Is real alternate-key migration required?
- Not based on repository and git-history evidence.
- No historical persisted favorites payload key other than `ldc:favorites` was found.

### Is payload-shape migration required?
- Yes.
- Historical payload drift is significant (Shape A/B/C -> Shape D), especially due older reduced-shape rewrites that dropped metadata/options.

## Recommended Phase 2 implementation strategy
1. Keep `ldc:favorites` as the single persisted key.
2. Treat migration as payload-shape normalization only (not key remapping).
3. Keep `LEGACY_KEYS` support mechanism, but do not claim alternate-key migration unless a real alternate key is discovered from runtime evidence outside git history.
4. Strengthen normalization fixtures/tests against all discovered historical shapes:
   - Shape A minimal
   - Shape B enriched legacy (`options`, `previewStyle`, optional image/title/accessoryOnly)
   - Shape C reduced favorites-page rewrite shape
   - malformed JSON and unknown-field tolerance
5. Continue one-way rewrite to canonical v2 immediately after successful parse, preserving as much detail as present (never narrowing fields on read).
6. Add a lightweight migration reason marker in emitted change metadata (for diagnostics) when payload normalization materially changes stored structure.

## Final conclusion
- Discovered persisted favorites payload key count: **1** (`ldc:favorites`).
- Alternate persisted key migration: **not required from repo/history evidence**.
- Payload-shape migration: **required and should remain the Phase 2 focus**.
