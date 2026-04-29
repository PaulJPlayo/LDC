# Custom Build Saved Design Parity Audit

Date: 2026-04-29
Branch: `audit/custom-build-saved-design-parity`
Base: `origin/main` at `2727ba467db712b46ca423c35ee38f3d1bb7e483`

This is an audit-only document. It does not implement custom-build saving,
storefront runtime changes, backend changes, Admin Studio changes, migrations,
or deployment.

## 1. Executive Summary

Architecture status for the next implementation pilot: READY for a scoped
custom-build pilot, with an explicit upload-reference gate.

The safest first pilot route is Doormats saved builds. Doormats already builds a
favorite payload only after resolving a real Medusa variant ID, captures product
ID/product handle/product key, quantity, size, color, notes, price snapshot,
preview data, and has a direct add-to-cart path using the selected variant and
line-item metadata. This makes Doormats the lowest-risk route for account-bound
custom build persistence.

Full custom-build saved-design parity is not yet ready for upload-bearing
records. Attire and Doormats currently read selected files as browser data URLs
for smaller files, or as filename-only references for larger files. The live
Customer Saved Workspace backend correctly rejects raw data URLs, base64, and
attachment data in saved item payloads. Therefore, the first Doormats pilot
should either skip upload-bearing builds or first add a persistent
upload-reference step that reuses or extends `/store/design-attachments`.

Recommended pilot order:

1. Doormats saved builds without upload-bearing records, or Doormats saved
   builds after a small upload-reference foundation if uploads must be included.
2. Attire saved builds after the favorite payload captures a stable variant ID.
3. Customization saved designs after a first-class saved-design capture/restore
   surface is defined.
4. Seasonal saved designs only after dedicated Seasonal source or template
   rules are defined beyond the existing wrap option.

This audit closes as an implementation plan, not as a feature closeout.

## 2. Current Standard-Product Saved Favorite Baseline

The standard product account favorites path now works through `favorites.js` and
the live Customer Saved Workspace backend.

Current active behavior:

- Guests use session storage under `ldc:favorites:guest-session`.
- Historical `ldc:favorites` localStorage is treated as legacy and no longer
  restored as the active guest source.
- Logged-in account favorites are loaded from
  `GET /store/customers/me/saved-items?type=product_favorite&limit=200`.
- Standard product favorites are upserted through
  `POST /store/customers/me/saved-items`.
- Guest standard product favorites merge on login through
  `POST /store/customers/me/saved-items/merge`.
- Backend-loaded favorites delete by saved item identity through
  `DELETE /store/customers/me/saved-items/:id`.

Helpers to reuse:

- `getAccountCustomer()`
- `listAccountSavedItems()`
- `accountRequest()`
- `mapFavoriteToSavedItem()`
- `mapSavedItemToFavorite()`
- `buildAccountDedupeKey()`
- `sanitizeAccountPayload()`
- `hasRawAccountPayload()`
- `hasBackendSavedItemIdentity()`
- `queueAccountFavoriteDelete()`
- `refreshAccountFavorites()`
- `buildCommerceMetadataFromFavorite()`
- `moveFavoriteToCart()`
- `setMoveToCartAdapter()`

Behavior to preserve:

- No password, JWT, or auth token is stored in browser storage.
- Request bodies never send `customer_id`.
- Account favorites are not copied into guest storage on logout.
- Guest favorites remain active-session only.
- Standard product account add, load, delete, reload, fresh-session restore,
  guest merge, and backend delete parity must keep working.
- Cart, checkout, Account, homepage header, Continue Shopping, Attire, and
  Doormats must not regress.

Current limitation for this audit:

- `favorites.js` intentionally treats Attire, Doormats, and submitted design
  records as not account-syncable product favorites.
- `mapSavedItemToFavorite()` currently filters out non-`product_favorite`
  saved item types.
- The next pilot must add type-aware custom-build mapping without broadening the
  standard product path unintentionally.

## 3. Attire Saved-Data Map

Source files:

- `attire.html`
- `favorites.js`
- `commerce.js`

Current favorite capture:

- `attire.html` builds a favorite payload with `buildFavoritePayload()`.
- It saves through the shared `window.ldcFavorites.addFavorite(payload, {
  source_path })`.
- Attire installs a route-specific move-to-cart adapter with
  `window.ldcFavorites.setMoveToCartAdapter()`.

An Attire saved item must preserve:

- Saved item type: `attire_build`.
- Route/source path: `/attire`.
- Product key: current payload uses the add-to-cart button product key or
  `attire-custom`.
- Product handle: current payload mirrors the product key or `attire-custom`.
- Product ID: should be added when resolvable from Medusa/product map.
- Base variant ID or resolved variant ID: current favorite payload does not
  store this directly; move-to-cart resolves it later. This is the main reason
  Attire should not be the first pilot.
- Style: selected option label `Style`.
- Color: selected option label `Color`, including swatch style/glyph when
  present.
- Size: selected option label `Size`.
- Quantity.
- Notes: selected option label `Notes`.
- Attachment name and persistent upload reference once available.
- Preview image and `preview_style`.
- Title, short description, and description.
- Price snapshot and currency.
- `selected_options`.
- `item_payload`: normalized safe favorite snapshot.
- `line_item_metadata`: metadata equivalent to
  `commerce.buildAttireLineItemMetadataFromLegacyItem()`.
- `live_reference`: product key, handle, product ID, selected labels, and
  variant ID if known.

Current upload behavior:

- `readAttachment()` reads the selected browser `File`.
- Small files are read into `dataUrl`.
- Larger files are represented as filename-only references.
- The favorite option stores attachment data as `attachmentData`.
- This is not safe for backend saved items until converted to persistent upload
  references.

Move-to-cart requirements:

- For account-loaded Attire builds, the move path must resolve a live variant
  from saved variant ID, or from Style/Color/Size when the variant ID is absent.
- It must call `commerce.addLineItem(variantId, quantity, metadata)`.
- Metadata should use `commerce.buildAttireLineItemMetadataFromLegacyItem()` or
  a direct equivalent.
- If the product or variant is unavailable, the customer should be asked to
  reselect the Attire option instead of adding a stale item.

Implementation gap before Attire pilot:

- Capture and save a stable variant ID or base variant reference at favorite
  time.
- Convert or reject upload-bearing favorites before backend save.
- Ensure account-loaded Attire favorites can rehydrate builder heart state.

## 4. Doormats Saved-Data Map

Source files:

- `doormats.html`
- `favorites.js`
- `commerce.js`

Current favorite capture:

- `doormats.html` builds favorite payloads with
  `buildDoormatFavoritePayload()`.
- It first calls `ensureDoormatFavoriteSelection()` and requires
  `resolution.variantId`.
- It saves through the shared `window.ldcFavorites.addFavorite(payload, {
  source_path })`.

A Doormat saved item must preserve:

- Saved item type: `doormat_build`.
- Route/source path: `/doormats`.
- Product key: `doormat-custom`.
- Product handle: `doormat-custom`.
- Product ID: current payload stores `resolution.product.id`.
- Real variant ID: current payload stores `resolution.variantId`.
- Size: selected option label `Size`.
- Color: selected option label `Color`, including swatch style/glyph when
  present.
- Quantity: current payload stores quantity and also includes a `Quantity`
  selected option.
- Notes: selected option label `Notes`.
- Attachment name and persistent upload reference once available.
- Preview image and `preview_style`.
- Title: `Custom Doormat`.
- Variant title: size/color summary.
- Description and short description.
- Price snapshot and currency.
- `selected_options`.
- `item_payload`: normalized safe favorite snapshot.
- `line_item_metadata`: equivalent to `buildDoormatLineItemMetadata()`.
- `live_reference`: product key, product handle, product ID, variant ID, size,
  color, and route.

Current upload behavior:

- `readAttachment()` reads the selected browser `File`.
- Small files are read into `dataUrl`.
- Larger files are represented as filename-only references.
- `buildDoormatLineItemMetadata()` currently includes
  `design_attachment_data` when attachment data exists.
- This must not be sent to saved-items. The next pilot must skip upload-bearing
  Doormats or upload first and store only persistent references.

Move-to-cart requirements:

- Prefer the saved `variant_id`.
- Re-check the live product/variant before add-to-cart through existing
  saleability/variant resolution helpers.
- Use the saved quantity.
- Use saved selected options and line-item metadata.
- Carry notes and persistent upload references forward as metadata keys, not
  raw data.
- If the saved variant is unavailable, show a route-specific unavailable or
  reselect message.

Why Doormats are first:

- They already have the strongest product/variant identity.
- They already require a valid variant before favorite save.
- The add-to-cart path already uses the real variant ID and route metadata.
- Their saved build shape is smaller than Customization and more complete than
  Attire.

## 5. Customization / Design Saved-Data Map

Source files:

- `customization.html`
- `index.html`
- `commerce.js`

Current selection flow:

- Design launch state uses localStorage keys:
  - `ldcDesignSelection`
  - `ldcDesignSelectionPending`
  - `ldcDesignSelectionPendingAt`
- Product tiles and design buttons pass product/design context into the design
  surface.
- The customer can select Color, Accessory, Wrap/template, Notes, and
  Attachment.
- `customization.html` can add the design directly to cart through Medusa when
  a variant can be resolved.

A custom design saved item must preserve:

- Saved item type: `custom_design`.
- Design route: `/customization` or homepage design section source.
- Product key.
- Product handle.
- Product ID.
- Variant ID or selected base variant ID.
- Selected design name and description.
- Preview image, preview alt text, and preview style.
- Color label/style/glyph.
- Accessory label/style/glyph/image.
- Wrap/template key and label.
- Notes.
- Persistent upload reference for attachment/inspiration.
- Base price, add-on price, total price snapshot, and currency.
- `selected_options` covering Color, Accessory, Wrap, Notes, and Attachment.
- `item_payload` containing the normalized design selection.
- `line_item_metadata` matching `buildDesignMetadata()`.
- `live_reference` for product/variant rehydration.

Current upload behavior:

- `readDesignAttachment()` reads browser files into `dataUrl` only as an
  immediate upload input.
- `uploadDesignAttachment()` posts the data URL to
  `/store/design-attachments`.
- The route returns `{ key, filename, url }`.
- `buildDesignMetadata()` stores `design_attachment_name`,
  `design_attachment_url`, and `design_attachment_key` when an upload succeeds.

Current save/favorite gap:

- There is no first-class saved-design favorite button or account saved-design
  capture surface in the current source.
- Customization currently goes to cart/checkout rather than saved workspace.
- Restore-to-builder needs a deliberate UI path separate from standard favorite
  drawer rendering.

Move-to-cart or restore requirements:

- If all product/variant references are present, a saved design can move to cart
  by calling `commerce.addLineItem(variantId, 1, buildDesignMetadataEquivalent)`.
- If the selection is incomplete or stale, the safer first behavior is
  "restore to builder" and ask the customer to confirm before adding to cart.
- Saved design records must refresh signed URLs or use a safe public URL before
  showing uploaded references.

## 6. Seasonal / Explore Wrap Findings

Seasonal source exists as a wrap/template option in `customization.html` and
`index.html`:

- `data-wrap-option="seasonal-holiday"`
- Display label: `Seasonal / Holiday`
- It appears in the "Explore wrap templates" menu.

Other wrap/template families are present in source, including Women, Special
Characters / Designers, Drinks, Boys & Men, Supporting Causes, Careers &
Hobbies, Sports, and Religion.

There is no dedicated Seasonal saved-workspace route, model, or separate
Seasonal builder source in the inspected files. Seasonal should therefore not
be implemented as a standalone `seasonal_design` pilot yet. It can initially be
represented as a `custom_design` saved item with wrap/template metadata. Use
`seasonal_design` only after LDC defines dedicated Seasonal source assets,
template identity, restore behavior, and move-to-cart rules.

## 7. Upload/Reference Findings

Persistent upload path:

- `medusa-backend/src/api/store/design-attachments/route.ts` exists.
- It accepts `{ filename, content_type, data_url }`.
- It writes the file to S3 under a generated key.
- It returns `{ key, filename, url }`.
- It also supports `GET` by key to return a refreshed URL.
- The route is not currently customer-scoped.

Backend saved item safety:

- `medusa-backend/src/modules/customer-saved-workspace/validation.ts` rejects
  raw upload payloads in saved item data.
- Rejected patterns include `attachment_data`, `data_url`, `base64`, and blob
  style payloads.
- Saved items may only reference persistent uploads.

Route-specific upload findings:

- Attire: temporary browser File to data URL or filename-only reference.
- Doormats: temporary browser File to data URL or filename-only reference.
- Customization: persistent S3-backed design attachment path exists before cart
  submit.
- Seasonal: no separate upload path beyond Customization.

Safe upload-reference contract for saved items:

```json
{
  "provider": "s3",
  "key": "design-attachments/YYYY/MM/DD/id-filename.png",
  "filename": "filename.png",
  "content_type": "image/png",
  "size": 12345,
  "status": "active",
  "url": "optional display URL or refreshed signed URL"
}
```

Recommended upload path before full parity:

- Reuse or extend `/store/design-attachments` for Attire and Doormats uploads.
- Prefer a customer-scoped saved-upload-reference route before saving
  attachment-bearing account records.
- Store upload keys/references in `upload_references`.
- Store only safe display metadata in `item_payload` and `line_item_metadata`.
- Do not save raw data URLs, base64 strings, file blobs, or filename-only
  references as long-term account data.

## 8. Backend Saved-Item Type Recommendations

### `attire_build`

Recommended typed fields:

- `type`: `attire_build`
- `source_path`: `/attire`
- `product_key`: `attire-custom`
- `product_handle`: `attire-custom`
- `product_id`: Medusa product ID when known
- `variant_id`: resolved Medusa variant ID when known
- `title`: `L.A.W. Attire` or the route title
- `variant_title`: Style / Color / Size summary
- `quantity`
- `currency_code`
- `price_snapshot_amount`
- `price_snapshot_display`
- `selected_options`: Style, Color, Size, Notes, Attachment reference
- `notes`
- `upload_references`: persistent upload references only
- `item_payload`: normalized favorite/build snapshot
- `line_item_metadata`: metadata for add-to-cart
- `live_reference`: product/variant/selection references

### `doormat_build`

Recommended typed fields:

- `type`: `doormat_build`
- `source_path`: `/doormats`
- `product_key`: `doormat-custom`
- `product_handle`: `doormat-custom`
- `product_id`: resolved Medusa product ID
- `variant_id`: resolved Medusa variant ID
- `title`: `Custom Doormat`
- `variant_title`: Size / Color summary
- `quantity`
- `currency_code`
- `price_snapshot_amount`
- `price_snapshot_display`
- `selected_options`: Size, Color, Notes, Quantity, Attachment reference
- `notes`
- `upload_references`: persistent upload references only
- `item_payload`: normalized favorite/build snapshot
- `line_item_metadata`: doormat add-to-cart metadata
- `live_reference`: product/variant/selection references

### `custom_design`

Recommended typed fields:

- `type`: `custom_design`
- `source_path`: `/customization` or homepage design source path
- `product_key`
- `product_handle`
- `product_id`
- `variant_id`
- `title`: custom design name or selected product/design name
- `variant_title`: selected Color / Accessory / Wrap summary
- `quantity`: usually `1`
- `currency_code`
- `price_snapshot_amount`
- `price_snapshot_display`
- `selected_options`: Color, Accessory, Wrap, Notes, Attachment reference
- `notes`
- `upload_references`: persistent upload references only
- `item_payload`: normalized design state
- `line_item_metadata`: equivalent to `buildDesignMetadata()`
- `live_reference`: product/variant/template references

### `seasonal_design`

Use only after dedicated Seasonal source exists. Until then, save Seasonal /
Holiday wrap selections as `custom_design` with `design_wrap_key` and
`design_wrap_label` fields.

## 9. Dedupe and Identity Strategy

Standard rule:

- Dedupe keys must be scoped by customer in the backend and stable across
  reloads.
- Dedupe keys should include saved item type, route/product identity, variant
  identity, normalized selections, and a hash of notes/uploads when those create
  meaningfully different builds.
- Dedupe keys should not include timestamps or transient signed URLs.

Doormats:

```text
doormat_build|doormat-custom|variant:<variant_id>|size:<size>|color:<color>|notes:<notes_hash>|uploads:<upload_keys_hash_or_none>
```

Attire:

```text
attire_build|attire-custom|variant:<variant_id_or_none>|style:<style>|color:<color>|size:<size>|notes:<notes_hash>|uploads:<upload_keys_hash_or_none>
```

Custom designs:

```text
custom_design|product:<product_or_design_ref>|variant:<variant_id_or_none>|color:<color>|accessory:<accessory>|wrap:<wrap_key>|notes:<notes_hash>|uploads:<upload_keys_hash_or_none>
```

Seasonal:

```text
seasonal_design|template:<template_key>|product:<product_ref>|variant:<variant_id_or_none>|selections:<selection_hash>|uploads:<upload_keys_hash_or_none>
```

Notes recommendation:

- For custom builds, notes should affect dedupe by default because two saved
  builds with the same product options but different instructions may be
  intentionally distinct.
- If LDC wants "same configuration updates notes", omit notes from dedupe and
  update the existing record. That is a product decision and should be explicit.

Upload recommendation:

- Persistent upload keys should affect dedupe.
- Signed URLs should not affect dedupe because they can expire/change.
- Filename-only references should not be used as dedupe identity for account
  records.

## 10. Storefront Integration Plan

The next implementation should extend `favorites.js` type-by-type rather than
making every custom route account-syncable at once.

Recommended integration steps:

1. Add saved item type constants for the selected pilot, starting with
   `doormat_build`.
2. Update account saved item loading to request both `product_favorite` and the
   pilot type, or request all saved items and filter supported types locally.
3. Add a type-aware `mapCustomFavoriteToSavedItem()` for the pilot route.
4. Add a type-aware `mapSavedCustomItemToFavorite()` for drawer/page rendering.
5. Keep `mapFavoriteToSavedItem()` standard-product behavior unchanged.
6. Change `isAccountSyncableFavorite()` only for the selected pilot type and
   only when the payload is upload-safe.
7. Keep backend delete based on `saved_item_id`, `account_saved_item_id`, or
   `account_source === "backend"`.
8. Render drawer and Favorites page cards from the normalized favorite payload.
9. Sync builder/heart state by matching the saved build dedupe/favorite key.
10. Keep guest state session-only and do not copy account saved builds to guest
    storage on logout.

For Doormats specifically:

- Add a Doormats mapper that rejects upload-bearing payloads until persistent
  references are available.
- Preserve the existing Doormats favorite payload shape so drawer/page rendering
  and current guest behavior do not regress.
- Include backend `saved_item_id` on account-loaded Doormat favorites for delete
  parity.
- Use saved `variant_id` and `line_item_metadata` for move-to-cart.

## 11. Guest Behavior Plan

Guest custom builds should remain active-session only.

Rules:

- Store guest custom builds in `ldc:favorites:guest-session`.
- Do not write custom builds to legacy `ldc:favorites`.
- Do not call saved-items routes while logged out.
- Do not merge upload-bearing custom builds unless all upload references are
  persistent and safe.
- If a guest custom build is not safe to merge, keep it session-only and show a
  safe non-sensitive message when needed.
- Do not lose guest session builds silently on failed merge.

For the first Doormats pilot:

- Safe no-upload Doormat builds may be eligible for account save/merge.
- Upload-bearing Doormat builds should remain guest-session only until the
  upload-reference foundation is implemented.

## 12. Logout Privacy Plan

Logout behavior must preserve the current account privacy boundary:

- Clear in-memory account saved custom builds.
- Re-render from guest session state only.
- Do not copy account custom builds into `sessionStorage`.
- Do not copy account custom builds into legacy localStorage.
- Do not delete backend saved custom builds on logout.
- Do not clear cart.
- Do not clear Continue Shopping route state.
- Do not clear Account return URL state.
- Tile hearts and builder saved state must clear when they represent private
  account data.

## 13. Move-to-Cart Parity Plan

### Doormats

Move-to-cart from a saved Doormat build should:

- Use saved `variant_id` as the preferred variant.
- Re-check live product/variant availability before adding.
- Use saved quantity.
- Rebuild line-item metadata from saved fields:
  - `design_mode`
  - `design_product_key`
  - `design_product_handle`
  - `design_product_title`
  - `design_product_description`
  - `design_preview_url`
  - `design_preview_style`
  - `design_total_price`
  - `design_color_label`
  - `design_color_style`
  - `design_size_label`
  - `design_notes`
  - persistent `design_attachment_key` and `design_attachment_url` if present
- Call `commerce.addLineItem(variantId, quantity, metadata)`.
- Show an unavailable/reselect message if the product or variant cannot be
  resolved.

### Attire

Move-to-cart from a saved Attire build should:

- Prefer saved `variant_id`.
- If no variant ID exists, resolve from Style/Color/Size and product identity.
- Use `commerce.buildAttireLineItemMetadataFromLegacyItem()` or equivalent.
- Preserve notes and persistent upload references.
- Show "select this attire option again" when the variant cannot be resolved.

### Customization / Design

Move-to-cart from a saved custom design should:

- Prefer restore-to-builder for the first design phase unless all product,
  variant, pricing, and upload references are complete.
- If direct move-to-cart is enabled, use saved variant ID and metadata
  equivalent to `buildDesignMetadata()`.
- Refresh or validate attachment URLs from persistent keys.
- Re-check price and saleability before adding.

### Seasonal

Seasonal move-to-cart should follow the Customization rules until a dedicated
Seasonal flow exists.

## 14. Recommended Pilot Order

Recommended first pilot: Pilot A, Doormats saved builds first.

Reasoning:

- Doormats already require a real variant ID before saving a favorite.
- Doormats capture product ID, product handle, product key, source path,
  selected options, quantity, preview, and price snapshot.
- Doormats have a direct add-to-cart path that already builds route-specific
  line-item metadata.
- The remaining gap is upload-reference safety, which can be isolated by
  skipping upload-bearing records or by adding persistent upload references
  first.

Second pilot: Attire saved builds.

- Attire has a complete UI payload for Style, Color, Size, notes, quantity, and
  preview.
- It should capture a stable variant ID before account save to reduce
  move-to-cart ambiguity.

Third pilot: Customization saved designs.

- Customization has the best persistent attachment mechanism today, but it lacks
  a first-class saved-design favorite/capture UI and needs restore-to-builder
  design.

Fourth pilot: Seasonal saved designs.

- Seasonal currently exists as a wrap/template option, not a standalone saved
  design system.

If LDC requires uploaded inspiration references in the first customer-facing
custom-build release, run Pilot D, upload-reference foundation, immediately
before Doormats.

## 15. Phase 2 Implementation Prompt Outline

Suggested next prompt title:

`LDC Doormats Account Saved Build Pilot on Favorites Runtime Only`

Prompt outline:

- Confirm backend saved-items API is live.
- Scope to Doormats saved builds only.
- Do not change backend or Admin Studio.
- Reuse `favorites.js` account request/auth/delete helpers.
- Add support for `doormat_build` saved items.
- Map safe Doormat favorite payloads to saved item records.
- Reject or keep session-only any Doormat build with raw attachment data until
  persistent upload references exist.
- Load account `doormat_build` records alongside `product_favorite`.
- Render account Doormat builds in drawer and Favorites page.
- Sync Doormats heart/builder state.
- Delete by saved item ID.
- Move saved Doormat builds to cart using saved variant ID and metadata.
- Preserve guest session-only behavior.
- Preserve standard product account favorites and login merge.
- Validate no raw data URLs/base64 are sent to saved-items.
- Deploy storefront only after validation passes.

## 16. Risk Classification

High risks:

- Private saved custom builds leaking into guest storage.
- Wrong customer saved item read/write/delete.
- Raw data URLs, base64, or file blobs saved into account records.
- Broken Doormats or Attire custom route behavior.
- Broken move-to-cart for custom builds.
- Checkout metadata loss for notes, color, size, style, wrap, or attachments.
- Upload reference loss or stale signed URLs.

Medium risks:

- Duplicate saved builds when dedupe keys omit or over-include notes/uploads.
- Stale price snapshots.
- Stale availability or retired variants.
- Partial guest merge of custom builds.
- Builder heart state not matching drawer/page state.
- Filename-only attachment references creating false confidence.

Low risks:

- Empty-state copy polish.
- Drawer card label/detail presentation.
- Saved-build grouping or filtering UX.

Unknowns:

- Whether `/store/design-attachments` should become customer-scoped before
  Attire/Doormats account saved uploads.
- Whether upload signed URLs should be public, refreshed by key, or linked to
  `customer_saved_upload_reference`.
- Whether Seasonal should remain a Customization wrap option or become a
  distinct saved design type.
- Whether Customization should first restore to builder or move directly to
  cart from saved designs.
