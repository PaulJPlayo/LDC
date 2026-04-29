# Customer Saved Workspace Architecture Audit

Date: 2026-04-28
Branch: `audit/customer-saved-workspace-architecture`
Base: `origin/main` at `7c3a838f3421cb05e6dd9727b6214cdc64a600d0`

This is an architecture audit only. It does not implement customer saved data, account-bound favorites, saved carts, upload persistence changes, Admin Studio views, or any storefront runtime change.

## 1. Executive Summary

Architecture status for the next backend pilot: READY.

The preferred Option B architecture, a custom backend Customer Saved Workspace, is the safest direction for LDC. The current browser-local favorites runtime is centralized enough to integrate with a future authenticated saved-items API, and the Medusa backend already has the necessary v2 foundations: custom Store routes, custom modules, migrations, S3-backed upload handling, and customer session authentication through `req.auth_context.actor_id`.

The current implementation is not already account-bound. Favorites currently persist in browser `localStorage` under `ldc:favorites`, and custom-route uploads for Attire and Doormats are saved into favorite payloads as browser data URLs or temporary file-name references. Those are deliberate gaps for later implementation phases, not blockers to the backend foundation.

Recommended next phase: build the backend Customer Saved Workspace module and protected customer Store API routes first. Do not change the storefront favorites runtime until the account-scoped backend contract exists and can be validated.

## 2. Current Favorites Runtime Map

Source of truth:

- `favorites.js` owns the shared favorites runtime.
- The canonical storage key is `ldc:favorites`.
- The current store version is `2`.
- The runtime uses `window.localStorage` through `getStorage()`.
- If storage is unavailable, the runtime falls back to an in-memory normalized empty payload.
- The runtime listens for browser `storage` events on `ldc:favorites` and emits `ldc:favorites:change`.

Public API:

- `window.ldcFavorites.getSnapshot()`
- `window.ldcFavorites.getFavorites()`
- `window.ldcFavorites.getFavoriteById(id)`
- `window.ldcFavorites.hasFavorite(id)`
- `window.ldcFavorites.addFavorite(item)`
- `window.ldcFavorites.removeFavorite(id)`
- `window.ldcFavorites.toggleFavorite(item)`
- `window.ldcFavorites.clearFavorites()`
- `window.ldcFavorites.subscribe(listener)`
- `window.ldcFavorites.unsubscribe(listener)`
- `window.ldcFavorites.normalizeFavoriteItem(item)`
- `window.ldcFavorites.normalizeFavoritesPayload(payload)`
- `window.ldcFavorites.migrateFavoritesPayload(payload)`
- `window.ldcFavorites.buildFavoriteKey(item)`
- `window.ldcFavorites.buildCartItemFromFavorite(item)`
- `window.ldcFavorites.buildCommerceMetadataFromFavorite(item)`
- `window.ldcFavorites.setMoveToCartAdapter(adapter)`
- `window.ldcFavorites.moveFavoriteToCart(id)`
- `window.ldcFavorites.reloadFromStorage()`

Heart/tile wiring:

- `favorites.js` delegates click handling from `document`.
- Product tile favorite buttons use `.tile-action-favorite` and favorite data attributes.
- `buildFavoritePayloadFromButton(button)` reads the product card, selected swatches/options, link URL, image, title, price, and variant identifiers.
- `syncHeartButtons()` updates the visual heart state from the normalized favorites snapshot.

Drawer wiring:

- `ensureDrawerStructure()` creates or normalizes the shared drawer.
- `[data-favorites-open]` opens the drawer.
- `[data-favorites-close]` and the drawer overlay close it.
- `renderDrawerItems()` renders saved items from the shared snapshot.
- Drawer remove buttons use `[data-favorite-remove]`.
- Drawer move-to-cart buttons use `[data-favorite-add-cart]`.

Favorites page wiring:

- `favorites.html` loads the shared runtime and renders from `window.ldcFavorites`.
- The page renders `[data-favorites-items]` from the shared snapshot.
- Remove and move-to-cart actions call the shared API instead of owning a separate state model.

Move-to-cart wiring:

- `moveFavoriteToCart(id)` calls the configured move-to-cart adapter.
- The default adapter resolves a Medusa variant with `commerce.resolveCartEntryForFavorite()` or `commerce.resolveVariantIdForFavorite()`.
- If Medusa cart support is available, the adapter calls `commerce.addLineItem(variantId, quantity, metadata)`.
- `buildCommerceMetadataFromFavorite()` rebuilds line-item metadata from the favorite payload.
- A favorite is removed only after the add-to-cart adapter returns success.

Persistence classification:

- Current favorites are persistent browser-local `localStorage`.
- There is no account-bound saved favorites backend today.
- There is no session-only guest favorites behavior today.
- The future implementation must migrate away from `localStorage` as the guest source of truth.

Legacy storage note:

- Existing `ldc:favorites` data should be treated as legacy migration data in the account-bound rollout.
- It should not remain the long-term source of truth for guest favorites once guest session-only behavior is implemented.

## 3. Current Favorite Item Schema

The current normalized favorite object shape is versioned by `favorites.js` and is roughly:

```json
{
  "id": "stable favorite key",
  "favorite_key": "stable favorite key",
  "product_key": "",
  "product_id": "",
  "product_handle": "",
  "product_url": "",
  "variant_id": "",
  "title": "",
  "variant_title": "",
  "short_description": "",
  "description": "",
  "price": 0,
  "quantity": 1,
  "currency_code": "USD",
  "preview_image": "",
  "image_url": "",
  "preview_style": "",
  "selected_options": [
    {
      "label": "",
      "value": "",
      "swatch_style": "",
      "swatch_glyph": "",
      "attachment_data": "",
      "attachment_key": "",
      "layout": ""
    }
  ],
  "options_summary": "",
  "source_path": "/",
  "added_at": "ISO timestamp",
  "updated_at": "ISO timestamp"
}
```

Stable key behavior:

- `buildFavoriteKey()` creates a key in the form `fav|<product ref>|<variant ref>`.
- Product reference priority is product ID, product handle, product URL, title, then preview image.
- Variant reference priority is variant ID, variant title, selected-options summary, then `default`.
- The normalized payload uses aliases and the stable key to dedupe items.

Fields currently present:

- Product identity: `product_id`, `product_handle`, `product_key`, `product_url`.
- Variant identity: `variant_id`, `variant_title`.
- Display data: `title`, `short_description`, `description`, `preview_image`, `image_url`, `preview_style`.
- Price snapshot: `price`, `currency_code`.
- Quantity default: `quantity`.
- Route/source: `source_path`.
- Options: `selected_options`, `options_summary`.
- Timestamps: `added_at`, `updated_at`.

Fields missing or incomplete for enterprise account-bound saved data:

- No durable backend record ID.
- No authenticated `customer_id`.
- No typed saved-item category.
- No explicit `line_item_metadata` field is stored; metadata is reconstructed later.
- No persistent upload-reference model.
- No live price or live availability rehydration state beyond product/variant references.
- No soft-delete/archive state.
- No backend-scoped dedupe key.

## 4. Custom Product/Build Schema Map

Standard product favorites:

- Captured from route product tiles.
- Current payload includes title, description, price, image, product URL, product handle, variant ID when available, selected swatches/options, and source path.
- Future saved records must preserve both the display snapshot and live product/variant identifiers for rehydration.

Attire selections:

- Source file: `attire.html`.
- Customer selections include Style, Color, Size, Notes, Attachment, quantity, preview image/style, product key, product handle, product URL, product ID, and variant ID when resolved.
- Current favorite payload uses `product_key` and `product_handle` such as `attire-custom`, source path `/attire`, selected options, unit price, quantity, and preview data.
- Attachment handling currently reads the selected browser `File` into an option field as `attachmentData` when the file is small enough, or stores a file-name-only reference.
- Cart metadata can be rebuilt with `commerce.buildAttireLineItemMetadataFromLegacyItem()`.
- Future saved records need a typed item such as `attire_build`, persistent upload references, selected options, notes, product/variant references, and line-item metadata.

Doormat builds:

- Source file: `doormats.html`.
- Customer selections include Size, Color, Notes, Attachment, quantity, preview image/style, product key, product handle, product URL, product ID, and variant ID.
- Current favorite payload uses `product_key` such as `doormat-custom`, source path `/doormats`, selected options including explicit Quantity, unit price, quantity, and preview data.
- Attachment handling currently follows the same browser File to data URL or file-name-only pattern as Attire.
- Doormat line-item metadata includes design mode, product key/handle/title, preview data, selected size/color/notes, attachment data, and pricing.
- Future saved records need a typed item such as `doormat_build`, persistent upload references, selected options, notes, product/variant references, and line-item metadata.

Customization and design selections:

- Source files: `customization.html` and the design-launcher logic in `commerce.js`.
- `commerce.js` stores design launcher state in localStorage keys:
  - `ldcDesignSelection`
  - `ldcDesignSelectionPending`
  - `ldcDesignSelectionPendingAt`
- `customization.html` reads that selection and lets the customer choose Color, Accessory, Wrap/template, Notes, and Attachment.
- `buildDesignMetadata()` creates Medusa line-item metadata for custom designs, including preview URL/style/alt, product key/handle/id, variant ID, base/add-on/total price, color/accessory/wrap labels, notes, and attachment name/url/key.
- `uploadDesignAttachment()` already posts data URLs to `/store/design-attachments` and receives `{ key, filename, url }`.
- Non-Medusa fallback flows can still carry local attachment data in `ldc:cart` or session state.
- There is no first-class customization favorite/save button in the current source. Saved custom designs require a future capture UI and should reuse the existing design metadata shape.

Seasonal/custom designs:

- Seasonal/Holiday appears as a wrap/template option in the customization flow.
- There is no dedicated Seasonal saved-workspace model or route today.
- Future Seasonal saved designs should be represented as a typed custom design saved item with template/wrap references in `selected_options`, `item_payload`, and `line_item_metadata`.

Saved carts:

- Current active cart state uses:
  - Medusa cart ID key `ldc:medusa:cart_id`
  - legacy/local cart key `ldc:cart`
- `checkout.html` also reads legacy cart state from localStorage/sessionStorage.
- There is no saved-cart customer workspace model today.
- Saved carts should be implemented after saved items because saved cart restore must re-check live price, saleability, inventory, and custom metadata before restoring.

## 5. Upload/Reference Audit

Current upload surfaces:

- `attire.html` reads customer upload files into a browser data URL when the file is no larger than the page limit, otherwise it stores a file-name-only note.
- `doormats.html` uses the same browser-only data URL or file-name-only pattern.
- `customization.html` can upload design attachments through `POST /store/design-attachments` before adding to cart.
- `checkout.html` also has attachment upload support and can fall back to inline attachment data if upload fails.

Backend upload route:

- `medusa-backend/src/api/store/design-attachments/route.ts` accepts JSON `{ filename, content_type, data_url }`.
- The route validates the S3 bucket configuration and data URL.
- It writes the file to S3 under a key similar to `design-attachments/YYYY/MM/DD/<uuid>-filename`.
- It returns `{ key, filename, url }`.
- It has a matching `GET` path that can return a fresh URL for a key.
- `medusa-backend/src/api/middlewares.ts` sets a 10 MB body parser limit for `/store/design-attachments`.

Persistence finding:

- Customization can create persistent upload references through the backend route.
- Attire and Doormat favorites do not currently create persistent upload references before saving to favorites.
- Current favorite payloads can contain browser data URLs or temporary file-name-only references.
- Raw file blobs are not stored directly, but data URLs in browser storage are still not an acceptable account-bound persistence strategy.

Recommendation:

- Customer Saved Workspace records should store persistent upload references, not raw file blobs or data URLs.
- A saved item should store upload reference IDs or keys, plus safe display metadata: filename, content type, size, provider, and status.
- A future upload-reference route should be customer-scoped or should link uploaded keys to the authenticated customer when the item is saved.
- Signed URL refresh should happen through a protected route such as `GET /store/customers/me/saved-upload-references/:id/url`.
- Existing Attire and Doormat favorite flows need a later storefront upload step before account-bound save can preserve uploaded inspiration safely.

## 6. Backend Capability Audit

Medusa version:

- `medusa-backend/package.json` uses Medusa v2.12.3 packages, including `@medusajs/medusa`, `@medusajs/framework`, `@medusajs/admin-sdk`, and `@medusajs/cli`.

Existing backend patterns:

- Custom Store routes exist under `medusa-backend/src/api/store`.
- Custom Admin routes exist under `medusa-backend/src/api/admin`.
- A custom module exists at `medusa-backend/src/modules/gift-cards`.
- The gift-cards module uses `model.define`, `MedusaService`, a module entry point, and a migration.
- `medusa-backend/medusa-config.ts` registers the custom module.

Authenticated customer route capability:

- Installed Medusa Store customer and order routes use `authenticate("customer", ["session", "bearer"])`.
- Authenticated routes can read the customer actor from `req.auth_context.actor_id`.
- The current Account flow has already proven cookie-session auth with `/auth/session`, `/store/customers/me`, and `/store/orders`.
- New saved-workspace Store routes should use the same customer session model.

Recommended backend location:

- Module: `medusa-backend/src/modules/customer-saved-workspace`.
- Models:
  - `medusa-backend/src/modules/customer-saved-workspace/models/customer-saved-item.ts`
  - `medusa-backend/src/modules/customer-saved-workspace/models/customer-saved-cart.ts`
  - `medusa-backend/src/modules/customer-saved-workspace/models/customer-saved-upload-reference.ts`
- Service:
  - `medusa-backend/src/modules/customer-saved-workspace/service.ts`
- Module entry:
  - `medusa-backend/src/modules/customer-saved-workspace/index.ts`
- Migrations:
  - `medusa-backend/src/modules/customer-saved-workspace/migrations/...`
- Store routes:
  - `medusa-backend/src/api/store/customers/me/saved-items/route.ts`
  - `medusa-backend/src/api/store/customers/me/saved-items/[id]/route.ts`
  - `medusa-backend/src/api/store/customers/me/saved-items/merge/route.ts`
  - `medusa-backend/src/api/store/customers/me/saved-carts/route.ts`
  - `medusa-backend/src/api/store/customers/me/saved-carts/[id]/route.ts`

Authentication and scoping:

- Middleware should protect `/store/customers/me/saved-items*` and `/store/customers/me/saved-carts*` with `authenticate("customer", ["session", "bearer"])`.
- Routes must derive `customer_id` only from `req.auth_context.actor_id`.
- Request bodies must never be allowed to select or override `customer_id`.
- All queries, updates, deletes, and upload-reference lookups must include the authenticated customer scope.

Auth/CORS/session constraints:

- Existing CORS config includes the public storefront origins.
- Account requests already use cookie sessions with `credentials: "include"`.
- Saved-workspace Store API calls should also use `credentials: "include"`.
- Storefront requests should keep the publishable API key behavior used by other Store API calls.

Deployment implications:

- Phase 2 is a backend deployment, not a static storefront-only deployment.
- Medusa is systemd-managed for this project; PM2 must not be used.
- Migrations must be generated, reviewed, and applied as part of the backend deployment plan.
- Storefront integration should not ship until the protected routes are live and validated.

## 7. Recommended Backend Data Model

### `customer_saved_item`

Purpose:

- Stores account-owned favorites, product favorites, custom builds, notes, and saved design records.

Recommended fields:

- `id`: text primary key, generated with a stable prefix such as `csi_`.
- `customer_id`: text, required, indexed.
- `type`: text enum, required. Suggested values:
  - `product_favorite`
  - `attire_build`
  - `doormat_build`
  - `custom_design`
  - `seasonal_design`
  - `note`
- `source_path`: text, nullable.
- `favorite_key`: text, nullable.
- `dedupe_key`: text, required.
- `product_id`: text, nullable.
- `product_handle`: text, nullable.
- `product_key`: text, nullable.
- `variant_id`: text, nullable.
- `title`: text, required.
- `variant_title`: text, nullable.
- `description`: text, nullable.
- `short_description`: text, nullable.
- `image_url`: text, nullable.
- `preview_image`: text, nullable.
- `preview_style`: text, nullable.
- `quantity`: integer, default `1`.
- `currency_code`: text, default `USD`.
- `price_snapshot_amount`: integer, nullable, in minor units when possible.
- `price_snapshot_display`: text, nullable.
- `selected_options`: jsonb, default `[]`.
- `item_payload`: jsonb, required, stores the normalized saved item snapshot.
- `line_item_metadata`: jsonb, nullable, stores move-to-cart metadata.
- `notes`: text, nullable.
- `upload_references`: jsonb, default `[]`, for lightweight references or IDs.
- `live_reference`: jsonb, nullable, for rehydration references such as product ID, variant ID, product handle, product key, and route.
- `archived_at`: timestamp, nullable.
- `deleted_at`: timestamp, nullable.
- `created_at`: timestamp.
- `updated_at`: timestamp.

Recommended indexes:

- `customer_id`.
- `customer_id, type`.
- `customer_id, updated_at`.
- Active unique index on `customer_id, dedupe_key` where `deleted_at` is null.
- Optional lookup indexes on `product_id`, `variant_id`, and `product_handle`.

Dedupe rules:

- Dedupe keys should include customer, type, product/route identity, variant identity, and normalized selected options.
- Dedupe keys should not include timestamps.
- Notes should not force a duplicate unless the product/build options differ. If duplicate notes conflict, preserve the newest note or retain both through an explicit conflict field in `item_payload`.
- Upload references should be preserved and should not be silently dropped during upsert.

Privacy rules:

- Every route must scope by authenticated `customer_id`.
- Cross-customer reads, deletes, updates, and signed URL refreshes must be impossible by construction.

### `customer_saved_upload_reference`

Purpose:

- Stores persistent references to customer-uploaded inspiration or design files.

Recommended fields:

- `id`: text primary key, generated with a stable prefix such as `csu_`.
- `customer_id`: text, required, indexed.
- `saved_item_id`: text, nullable, indexed.
- `provider`: text, such as `s3`.
- `key`: text, required.
- `filename`: text, required.
- `content_type`: text, nullable.
- `size`: integer, nullable.
- `status`: text enum, suggested values `pending`, `active`, `deleted`.
- `metadata`: jsonb, nullable.
- `uploaded_at`: timestamp, nullable.
- `deleted_at`: timestamp, nullable.
- `created_at`: timestamp.
- `updated_at`: timestamp.

Recommended indexes:

- `customer_id`.
- `saved_item_id`.
- Unique `key` if the storage provider key is globally unique.

### `customer_saved_cart`

Purpose:

- Stores a named or automatic cart snapshot for later restore.

Recommended fields:

- `id`: text primary key, generated with a stable prefix such as `csc_`.
- `customer_id`: text, required, indexed.
- `name`: text, nullable.
- `status`: text enum, suggested values `active`, `archived`, `deleted`.
- `currency_code`: text, default `USD`.
- `region_id`: text, nullable.
- `cart_snapshot`: jsonb, required.
- `line_items`: jsonb, required.
- `item_count`: integer, default `0`.
- `subtotal_snapshot_amount`: integer, nullable, in minor units when possible.
- `dedupe_key`: text, nullable.
- `archived_at`: timestamp, nullable.
- `deleted_at`: timestamp, nullable.
- `created_at`: timestamp.
- `updated_at`: timestamp.

Recommended indexes:

- `customer_id, status`.
- `customer_id, updated_at`.
- Optional active unique index on `customer_id, dedupe_key` where `deleted_at` is null.

## 8. Recommended Store API Routes

All routes below should be Store API routes protected by customer session auth. All route handlers must derive `customer_id` from `req.auth_context.actor_id`.

### `GET /store/customers/me/saved-items`

Purpose:

- Return the authenticated customer's saved items.

Query:

- `type`, optional.
- `limit`, optional.
- `offset`, optional.

Response:

```json
{
  "saved_items": [],
  "count": 0,
  "limit": 50,
  "offset": 0
}
```

Validation:

- Require authenticated customer.
- Validate type against allowed values.
- Enforce reasonable limit bounds.

### `POST /store/customers/me/saved-items`

Purpose:

- Create or upsert one saved item for the authenticated customer.

Body:

```json
{
  "type": "product_favorite",
  "dedupe_key": "product_favorite|handle|variant|options",
  "favorite_key": "fav|...",
  "source_path": "/tumblers",
  "product_id": "prod_...",
  "product_handle": "example",
  "product_key": "example",
  "variant_id": "variant_...",
  "title": "Example Product",
  "quantity": 1,
  "currency_code": "USD",
  "price_snapshot_amount": 2500,
  "selected_options": [],
  "item_payload": {},
  "line_item_metadata": {},
  "notes": "",
  "upload_references": []
}
```

Response:

```json
{
  "saved_item": {}
}
```

Validation:

- Require authenticated customer.
- Reject request-body `customer_id`.
- Validate type, title, dedupe key, payload size, option shape, and upload-reference ownership.
- Sanitize notes and display strings.
- Preserve upload references only if owned by the same customer or safely claimable by the same authenticated customer.

### `DELETE /store/customers/me/saved-items/:id`

Purpose:

- Soft-delete one authenticated customer saved item.

Response:

```json
{
  "id": "csi_...",
  "deleted": true
}
```

Validation:

- Require authenticated customer.
- Delete only when `id` belongs to the authenticated customer.

### `POST /store/customers/me/saved-items/merge`

Purpose:

- Merge current-session guest favorites/builds into the authenticated customer's saved items after login.

Body:

```json
{
  "items": [],
  "strategy": "upsert_by_dedupe_key"
}
```

Response:

```json
{
  "saved_items": [],
  "merged": 0,
  "skipped": 0,
  "errors": []
}
```

Validation:

- Require authenticated customer.
- Validate every item as if it were posted individually.
- Return per-item failures without failing the entire merge when possible.

### `GET /store/customers/me/saved-carts`

Purpose:

- Return saved cart snapshots for the authenticated customer.

Response:

```json
{
  "saved_carts": [],
  "count": 0
}
```

### `POST /store/customers/me/saved-carts`

Purpose:

- Save an active cart snapshot for the authenticated customer.

Body:

```json
{
  "name": "Holiday cart",
  "currency_code": "USD",
  "region_id": "reg_...",
  "line_items": [],
  "cart_snapshot": {},
  "subtotal_snapshot_amount": 0
}
```

Validation:

- Require authenticated customer.
- Validate line item shape, metadata payload size, upload-reference ownership, and snapshot size.
- Do not store payment details.

### `DELETE /store/customers/me/saved-carts/:id`

Purpose:

- Soft-delete one saved cart owned by the authenticated customer.

Response:

```json
{
  "id": "csc_...",
  "deleted": true
}
```

Future upload-reference route:

- `GET /store/customers/me/saved-upload-references/:id/url`
- Returns a fresh signed URL for a customer-owned upload reference.
- This should be added when saved-item upload references are wired to the storefront.

## 9. Storefront Integration Plan

The storefront should move from browser-local favorites to auth-aware saved items after the backend routes exist.

Guest mode:

- Use session-only state for guest favorites.
- Store guest favorites in `sessionStorage`, not `localStorage`.
- If sessionStorage is unavailable, use memory only.
- Guest favorites should disappear after the active browsing session ends.

Logged-in account mode:

- On page load or auth-state refresh, call a protected saved-items route with `credentials: "include"`.
- Render hearts, drawer, and Favorites page from backend saved items.
- Keep a short-lived in-memory mirror for responsive UI.
- Use backend item IDs for deletes.
- Use dedupe keys for upserts.

Session restore:

- When the Account/homepage auth state indicates a signed-in customer, `favorites.js` should load customer saved items.
- The runtime should replace browser-local account data with backend data.
- The visible UI should reflect only customer-owned saved items and any current guest session items that have not yet merged.

Login merge:

- Successful login should emit or reuse an auth-change signal.
- `favorites.js` should collect current session guest favorites/builds and call the merge route.
- After successful merge, it should reload saved items from the backend and clear successfully merged guest session entries.

Logout privacy:

- On logout, clear account saved items from the visible UI and any in-memory account cache.
- Clear tile hearts and account-owned drawer/page items.
- Do not clear the cart.
- Do not clear Continue Shopping state.
- Do not clear unrelated session/local storage.

Favorites page and drawer rendering:

- Keep the current rendering surfaces.
- Change the data source to the auth-aware saved item store.
- Empty states should distinguish guest session empty from signed-in empty without exposing private data.

Move-to-cart:

- Move-to-cart should use backend saved item payload, live product/variant references, and stored line-item metadata.
- Before adding to cart, rehydrate against live product/variant availability and current price.
- If unavailable, keep the saved item and show a safe message.

Custom route saved builds:

- Attire and Doormat saved builds should be saved as typed saved items.
- Customization and Seasonal designs should be saved as typed design items after a save UI exists.
- Upload references must be persistent before account save.

## 10. Guest Favorites Non-Persistence Plan

Desired guest behavior:

- Guests can favorite during the active browsing session.
- Guest favorites should not persist after browser close and return.
- Guest favorites should not be written to persistent `localStorage`.

Recommended guest storage:

- Use a new sessionStorage key such as `ldc:favorites:guest-session`, or use the existing normalized schema under a session-only adapter.
- Keep the item schema compatible with backend merge payloads.
- Use memory fallback when sessionStorage is unavailable.

Legacy `ldc:favorites` migration:

- Treat existing localStorage `ldc:favorites` as migration data.
- On the first rollout phase that changes storage behavior, read and normalize it once.
- If the customer is logged out, import it into the current guest session only and then mark or remove the persistent localStorage value.
- If the customer logs in, offer it to the merge route and clear only entries that merge successfully.
- Do not let old localStorage continue as permanent guest favorites after the migration phase.

## 11. Login Merge Plan

Trigger:

- Run merge only after the customer session is established and `/store/customers/me` succeeds.
- Do not render logged-in saved data based only on a clicked Sign In button.

Payload:

- Normalize guest session favorites with the current `favorites.js` normalizer.
- Convert custom builds to typed saved item bodies.
- Include notes, selected options, route/source path, preview data, price snapshot, live product/variant references, and line-item metadata.
- Include only persistent upload references. If a guest item still has a data URL, the storefront must upload it or mark it as not mergeable before account save.

Dedupe:

- Backend should enforce active unique `customer_id + dedupe_key`.
- Identical product/variant/options should update the existing item rather than creating duplicates.
- Notes and upload references must not be dropped. If two records conflict, preserve the richer record or apply a documented last-write policy.

Partial failure:

- The merge route should report per-item success and failure.
- The storefront should clear only successfully merged guest entries.
- Failed entries should remain in the guest session for retry during that session.
- UI messaging should be non-blocking, such as "Some saved items could not be synced."

Privacy:

- Guest session data should not be associated with any account until login and merge succeed.
- Account data should not be visible after logout.

## 12. Logout Privacy Plan

Required logout behavior:

- Account favorites and saved builds disappear from visible browser UI on logout.
- Tile hearts clear.
- Favorites drawer clears or returns to the current guest session state.
- Favorites page clears or returns to the current guest session state.
- Private account notes, saved designs, upload references, and saved carts are not left visible on shared browsers.

State that must not be cleared:

- Active cart.
- Medusa cart ID.
- Current checkout cart state.
- Continue Shopping state.
- Non-auth storefront preferences unrelated to saved workspace.

Implementation approach:

- Reuse the existing Account/header auth-change behavior.
- Add a saved-workspace logout handler to the favorites runtime.
- Keep cart and favorites logic separated so logout privacy does not break cart state.

## 13. Saved Carts Plan

Saved carts are not the same as favorites.

Saved cart snapshot requirements:

- Cart name/title.
- Currency code.
- Region ID when available.
- Line item list.
- Product ID, product handle, product key, variant ID.
- Title and image/preview snapshot.
- Quantity.
- Selected options.
- Custom notes.
- Persistent upload references.
- Line-item metadata for Attire, Doormats, Customization, and Seasonal designs.
- Price snapshot in minor units.
- Live rehydration references for product, variant, price, and availability.

Restore requirements:

- Re-check live product and variant availability.
- Re-check live pricing before adding to a cart.
- Skip or flag unavailable items.
- Preserve custom metadata for valid items.
- Do not restore payment details.
- Do not assume an old cart ID is still valid.

Phase recommendation:

- Saved cart foundation should come after saved items and login/logout privacy are stable.
- Saved cart restore should be a later phase because it touches cart state, availability, and checkout risk.

## 14. Admin Studio Visibility Plan

Admin Studio visibility is future-scoped, not required for the first customer-facing saved workspace release.

Reason:

- The first release needs customer privacy, backend scoping, Store API parity, and storefront saved-item behavior.
- Admin Studio can safely follow after the backend model and storefront behavior are proven.

Future Admin views:

- Customer saved favorites.
- Customer saved Attire builds.
- Customer saved Doormat builds.
- Customer saved custom/Seasonal designs.
- Saved cart snapshots.
- Upload references.
- Most-favorited products/designs.
- Customer engagement timeline.

Current Admin capabilities relevant to future work:

- `admin-ui/src/lib/api.js` already uses cookie session auth with `credentials: "include"`.
- Admin resources already include Customers, Orders, and Uploads.
- Existing order detail UI can display design metadata, notes, and attachment references.
- No saved-workspace Admin resource exists today.

Recommendation:

- Do not block the customer-facing backend/storefront pilot on Admin Studio visibility.
- Add Admin Studio saved workspace visibility after customer routes and storefront parity are stable.

## 15. Recommended Phased Rollout

Phase 2: Backend foundation.

- Add `customer_saved_workspace` backend module.
- Add saved item, saved cart, and upload reference models.
- Add migrations.
- Add protected customer Store API routes.
- Add validation and customer scoping.
- Deploy backend and validate unauthenticated/authenticated behavior with an approved customer.

Phase 3: Storefront account favorites pilot.

- Teach `favorites.js` to load and save backend saved items while signed in.
- Keep guest behavior unchanged until the account path is stable.
- Validate hearts, drawer, Favorites page, and move-to-cart for standard products.

Phase 4: Guest session-only favorites.

- Move guest favorites from localStorage to sessionStorage.
- Add migration handling for old `ldc:favorites`.
- Confirm guest favorites disappear after session end.

Phase 5: Login merge.

- Merge guest session favorites into customer saved items after successful login.
- Add dedupe and partial-failure handling.

Phase 6: Logout privacy.

- Clear account-bound saved data from visible UI on logout.
- Preserve cart and Continue Shopping state.

Phase 7: Custom build/design parity.

- Add account save/restore for Attire, Doormats, Customization, and Seasonal designs.
- Add persistent upload-reference handling for Attire and Doormats before account save.

Phase 8: Saved cart foundation.

- Add saved cart create/list/delete.
- Delay restore until live price and availability checks are proven.

Phase 9: Drawer/page parity finish.

- Polish saved-items drawer and Favorites page parity across guest and authenticated states.
- Validate move-to-cart and empty states.

Phase 10: Admin planning.

- Add Admin Studio saved workspace views only after customer-facing behavior is stable.

Phase 11: Final live closeout.

- Verify account saved data, guest session-only behavior, login merge, logout privacy, saved build parity, saved carts, cart, checkout, Attire, Doormats, and Continue Shopping.

## 16. Risk Classification

High risks:

- Cross-customer saved data exposure.
- Private saved items visible after logout on shared browsers.
- Password/JWT storage in browser storage.
- Raw uploaded files or data URLs stored in long-term account records.
- Broken cart, checkout, Attire, Doormats, or Continue Shopping behavior.
- Upload reference loss for customer design inspiration.

Medium risks:

- Duplicate favorites after login merge.
- Stale price snapshots.
- Stale availability on move-to-cart or saved cart restore.
- Partial merge failures.
- Legacy `ldc:favorites` migration confusion.
- Custom build metadata loss.
- Large JSON payloads or oversized upload metadata.

Low risks:

- Empty-state copy polish.
- Saved item naming polish.
- Minor account/dashboard presentation polish.

Unknowns:

- Final migration command/deployment details until the backend implementation exists.
- Exact upload-provider retention policy.
- Whether Admin Studio should expose saved workspace records immediately after customer-facing release.
- Whether future saved cart restore needs additional Medusa workflow support.

## 17. Recommended Phase 2 Prompt Outline

Suggested next prompt title:

`LDC Customer Saved Workspace Backend Foundation Pilot`

Prompt outline:

- Implement a backend-only Medusa v2 Customer Saved Workspace foundation.
- Create a custom module under `medusa-backend/src/modules/customer-saved-workspace`.
- Add models and migrations for:
  - `customer_saved_item`
  - `customer_saved_cart`
  - `customer_saved_upload_reference`
- Register the module in `medusa-config.ts`.
- Add protected Store API routes under `/store/customers/me/saved-items` and `/store/customers/me/saved-carts`.
- Protect routes with customer session auth and derive customer ID from `req.auth_context.actor_id`.
- Validate request bodies, payload sizes, saved item types, dedupe keys, and upload-reference ownership.
- Do not modify storefront runtime in the backend pilot.
- Do not modify Admin Studio in the backend pilot.
- Run backend validation, migrations, and safe unauthenticated/authenticated route checks with an approved customer.

## 18. Evidence Summary

Files inspected:

- `README.md`
- `AGENTS.md`
- `docs/audits/legacy-favorites-fallback-audit-2026-03-29.md`
- `docs/audits/account-continue-shopping-audit-2026-04-02.md`
- `docs/favorites-flow-implementation-plan.md`
- `docs/favorites-flow-verification.md`
- `docs/favorites-legacy-key-audit.md`
- `docs/cart-audit.md`
- `docs/admin-parity-audit.md`
- `favorites.js`
- `favorites-theme.css`
- `favorites.html`
- `commerce.js`
- `account.html`
- `index.html`
- `checkout.html`
- `attire.html`
- `doormats.html`
- `customization.html`
- `tumblers.html`
- `cups.html`
- `accessories.html`
- `sale.html`
- `under-25.html`
- `last-chance.html`
- `new-arrivals.html`
- `best-sellers.html`
- `restock.html`
- `medusa-backend/package.json`
- `medusa-backend/medusa-config.ts`
- `medusa-backend/src/api/middlewares.ts`
- `medusa-backend/src/api/store/design-attachments/route.ts`
- `medusa-backend/src/api/store/custom/route.ts`
- `medusa-backend/src/api/admin/files/route.ts`
- `medusa-backend/src/modules/gift-cards/index.ts`
- `medusa-backend/src/modules/gift-cards/models/gift-card.ts`
- `medusa-backend/src/modules/gift-cards/service.ts`
- `medusa-backend/src/modules/gift-cards/migrations/Migration20260120182454.ts`
- `admin-ui/src/lib/api.js`
- `admin-ui/src/data/resources.js`
- `admin-ui/src/routes/ResourceDetail.jsx`
- `admin-ui/src/routes/ResourceList.jsx`
- `admin-ui/src/routes/StorefrontLayout.jsx`

Prior audit branches inspected without merging:

- `origin/audit/account-page-usability-data-handling`
- `origin/diagnosis/account-auth-session-contract`
- `origin/diagnosis/account-registration-401`

Live URLs checked:

- `https://lovettsldc.com/?verify=saved-workspace-audit`
- `https://lovettsldc.com/favorites?verify=saved-workspace-audit`
- `https://lovettsldc.com/account?verify=saved-workspace-audit`
- `https://lovettsldc.com/attire?verify=saved-workspace-audit`
- `https://lovettsldc.com/doormats?verify=saved-workspace-audit`
- `https://lovettsldc.com/customization?verify=saved-workspace-audit`
- `https://lovettsldc.com/checkout?verify=saved-workspace-audit`
- `https://lovettsldc.com/favorites.js?verify=saved-workspace-audit`
- `https://lovettsldc.com/commerce.js?verify=saved-workspace-audit`
- `https://api.lovettsldc.com/health`

Live status:

- All listed live URLs returned HTTP 200 during the audit.
- Live `commerce.js` reported `STOREFRONT_BUILD_SHA = '7c3a838'`.
- Live `favorites.js` contained the current canonical `ldc:favorites` runtime.

No live account sign-in, account creation, live order, upload, backend mutation, source-code change, deployment, or Admin Studio action was performed.
