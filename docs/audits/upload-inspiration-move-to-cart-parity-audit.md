# Upload Inspiration Move-to-Cart Parity Audit

Date: 2026-04-29
Branch: audit/upload-inspiration-move-to-cart-parity
Base: origin/main at b24ff4e7255e753feb45feac69fbaf0222fd4ff6

## 1. Executive summary

Current upload-bearing custom favorites are **DRIFT** for implementation as-is.

Doormats and Attire both collect Upload Inspiration as temporary browser data. For small files the route stores a data URL on the favorite/cart option. For larger files it stores only a filename-style "file reference" with no persistent backend key. The favorites drawer can display the Attachment option because that value is present in the favorite payload, but Move to Cart either sends raw attachment data into Medusa line-item metadata or drops the attachment data depending on route context.

The issue is a combination of:

- frontend metadata mapping that carries temporary `attachmentData` / `design_attachment_data` through favorites and cart metadata,
- no persistent upload-reference creation before favorite move-to-cart,
- checkout having a limited legacy upload bridge that is not used by favorites move-to-cart,
- no customer-scoped upload-reference Store route yet, despite the backend module having a `customer_saved_upload_reference` model.

Recommended next phase: **Option C - persistent upload-reference foundation plus frontend move-to-cart mapping**. A frontend-only fix could avoid the immediate cart failure by dropping raw upload data, but that would lose the customer attachment and would not satisfy checkout, account saved builds, order, or Admin fulfillment requirements.

## 2. Current upload flow map

### Doormats

Upload input:
- `doormats.html` contains `#doormatUpload` with label "Upload Inspiration".

Read behavior:
- `readAttachment()` reads `attachmentInput.files[0]`.
- Files at or below 1.5 MB are read with `FileReader.readAsDataURL`.
- Files over 1.5 MB return `{ name, type, size, dataUrl: "" }`.

Builder/favorite state:
- `buildOptions()` appends `{ label: "Attachment", value: filename, attachmentData: dataUrl }`.
- If no data URL exists, the displayed value receives " (file reference)".
- `buildDoormatFavoritePayload()` copies `attachmentData` / `attachmentKey` into `selected_options`.

Cart metadata:
- `buildDoormatLineItemMetadata()` maps attachment option to `design_attachment_name` and `design_attachment_data`.
- No persistent backend upload happens before Doormat favorite save or direct Doormat add-to-cart.

Current persistence status:
- Temporary data URL for small files.
- Filename-only reference for large files.
- No S3 key/customer upload-reference in the Doormat favorite payload.

### Attire

Upload input:
- `attire.html` contains `#attireUpload` with label "Upload Inspiration".

Read behavior:
- `readAttachment()` uses the same 1.5 MB data URL pattern as Doormats.
- Larger files become filename-only "file reference" values.

Builder/favorite state:
- `buildOptions()` appends `{ label: "Attachment", value: filename, attachmentData: dataUrl }`.
- `buildFavoritePayload()` stores those options in `selected_options`.

Cart metadata:
- `commerce.buildAttireLineItemMetadataFromLegacyItem()` maps the attachment option to `design_attachment_name`, `design_attachment_url`, `design_attachment_key`, and, when no URL/key exists, `design_attachment_data`.
- Attire route-level move-to-cart uses this metadata bridge and can therefore send raw data URL metadata.

Current persistence status:
- Temporary data URL for small files.
- Filename-only reference for large files.
- No persistent upload reference before favorite save or favorite move-to-cart.

## 3. Current favorites drawer upload behavior

Favorites receive Upload Inspiration through `selected_options`.

Relevant fields found:
- `selected_options[].label = "Attachment"`
- `selected_options[].value = filename or filename plus " (file reference)"`
- `selected_options[].attachmentData` / `attachment_data`
- `selected_options[].attachmentKey` / `attachment_key`

`favorites.js` normalizes `attachment_data` and `attachment_key` in options, and `renderFavoriteDetailsMarkup()` renders selected options into the drawer and Favorites page. The drawer/page can therefore show that an Attachment exists. Current `favorites.js` detail rendering treats Attachment as a text row rather than a first-class attachment link row, so display is based mostly on filename/value. Route-local legacy cart renderers have richer Attachment rows with "View" links when `attachmentData` exists.

This display depends on temporary browser data when `attachmentData` is a data URL. It is not a durable account or fulfillment reference.

## 4. Current move-to-cart failure path

No production upload reproduction was performed because the source identifies the unsafe path and a real/private file is not required for diagnosis.

### Doormats with Upload Inspiration

Path:
1. Doormat builder reads the file into `attachmentData`.
2. Favorite stores Attachment in `selected_options`.
3. Move to Cart resolves the variant and calls `buildCommerceMetadataFromFavorite()`.
4. For design/custom favorites, `buildCommerceMetadataFromFavorite()` maps Attachment to `design_attachment_name` and `design_attachment_data`.
5. `commerce.addLineItem()` sends the metadata directly to `/store/carts/:id/line-items`.

Expected failure mode:
- Raw data URL metadata can make the Store API mutation too large or invalid.
- If the file was too large for the route reader, only a filename-style reference exists, so there is no file content or persistent key to carry forward.

Observed source classification:
- The Move to Cart button can fire and variant resolution can succeed.
- The payload is unsafe before Medusa because it may include `design_attachment_data`.
- Medusa/cart mutation is the likely rejection point for small-file data URLs.
- Mini cart/checkout cannot receive a professional attachment reference because no persistent reference exists.

### Attire with Upload Inspiration

Path on `/attire`:
1. Attire builder reads the file into `attachmentData`.
2. Favorite stores Attachment in `selected_options`.
3. Attire installs a route-specific `setMoveToCartAdapter`.
4. `addAttireItemWithSharedCart()` builds metadata through `commerce.buildAttireLineItemMetadataFromLegacyItem()`.
5. If there is no uploaded URL/key, metadata includes `design_attachment_data`.
6. `commerce.addLineItem()` sends the metadata to the Store API.

Path on generic routes such as `/favorites`:
- `favorites.js` detects Attire and rebuilds selected options for metadata, but that mapping currently drops `attachment_data` / `attachmentData`.
- This can avoid the raw data failure but loses the attachment.

Observed source classification:
- Attire move-to-cart is inconsistent by route context: it can fail when route adapter sends raw data, or lose the attachment where the default adapter strips it.
- Neither path provides a durable upload reference.

## 5. Current mini cart and checkout attachment display

### Mini cart

`commerce.js` supports attachment display if line-item metadata can be normalized into display options:

- `formatLegacyItem()` reads `design_attachment_name`, `design_attachment_url`, `design_attachment_data`, and `design_attachment_key`.
- It emits an Attachment display option with `attachmentData` and `attachmentKey`.
- `normalizeDisplayOption()` classifies label `Attachment` as `kind: "attachment"`.
- The mini cart renders a "View" link when `attachmentData` exists.

Route-local Attire and Doormats legacy mini-cart renderers also display an Attachment row and "View" link when `attachmentData` exists.

Current gap:
- Display can work, but it is wired to `attachmentData`, which today may be a raw data URL.
- Mini cart needs to render from a safe persistent URL/key instead.

### Checkout

`checkout.html` supports attachment display:

- checkout option normalization preserves `attachmentData` and `attachmentKey`.
- checkout renders Attachment rows and a "View" link when `attachmentData` exists.
- `uploadCheckoutAttachment()` can POST a data URL to `/store/design-attachments` and convert it into `{ name, url, key }` during legacy Attire checkout reconciliation.

Current gap:
- That upload bridge is checkout-only legacy conversion logic.
- Favorites move-to-cart does not call it.
- It falls back to inline attachment data if upload fails, which is not acceptable for saved workspace/account persistence.
- Checkout display should receive a safe URL/key produced before cart mutation, not raw data.

## 6. Backend design-attachments capability

Route inspected:
- `medusa-backend/src/api/store/design-attachments/route.ts`
- middleware body limit in `medusa-backend/src/api/middlewares.ts`

Capabilities:
- `POST /store/design-attachments` accepts `filename`, `content_type`, and `data_url`.
- It parses a base64 data URL, enforces a max byte limit, writes to S3, and returns `{ key, filename, url }`.
- `GET /store/design-attachments?key=...` returns a URL for an existing key.
- The route uses S3 env configuration and does not store raw file data in the database.

Limitations:
- The route is not protected by customer authentication in middleware.
- It is not customer-scoped.
- It does not create or update `customer_saved_upload_reference`.
- It does not link uploads to a saved item, cart line item, route, or customer.
- It requires the storefront to send a data URL, so the route is a storage primitive, not a complete saved-workspace upload-reference contract.

Saved workspace capability:
- `customer_saved_upload_reference` model exists with `customer_id`, `saved_item_id`, `provider`, `key`, `filename`, `content_type`, `size`, `status`, `metadata`, and `uploaded_at`.
- Current saved-items validation rejects raw data URLs/base64 and unsafe upload keys in saved item payloads.
- No Store API route currently creates customer-scoped upload-reference rows.

Conclusion:
- `/store/design-attachments` can likely be reused as the upload-to-S3 primitive, but it is not sufficient by itself for account saved builds, customer privacy, or Admin/order traceability.

## 7. Persistent upload-reference recommendation

Use reference-only upload records. Do not save raw File objects, raw data URLs, base64 strings, or browser blob URLs in saved-items, cart snapshots, or long-term customer records.

Recommended reference shape:

```json
{
  "provider": "s3",
  "key": "design-attachments/yyyy/mm/dd/id-filename.ext",
  "filename": "customer-file.ext",
  "content_type": "image/png",
  "size": 12345,
  "url": "short-lived-or-public-display-url",
  "customer_id": "derived from auth when authenticated",
  "saved_item_id": "optional after saved item exists",
  "source_path": "/doormats",
  "route": "doormats",
  "status": "active",
  "metadata": {
    "label": "Upload Inspiration"
  }
}
```

Storefront shape passed through favorites/cart should be smaller:

```json
{
  "label": "Attachment",
  "value": "customer-file.ext",
  "attachment_key": "design-attachments/yyyy/mm/dd/id-filename.ext",
  "attachment_url": "safe display URL",
  "attachment_provider": "s3",
  "attachment_content_type": "image/png",
  "attachment_size": 12345
}
```

For authenticated account saved builds, the upload-reference record should be customer-scoped and derived from `req.auth_context.actor_id` on protected routes. For guests, the reference may be session-only until login merge if the upload route supports a safe guest token/reference handoff, or it should remain unmerged until a persistent reference exists.

## 8. Cart/checkout metadata recommendation

Cart line-item metadata should carry reference fields, not inline file data:

```json
{
  "design_attachment_name": "customer-file.ext",
  "design_attachment_provider": "s3",
  "design_attachment_key": "design-attachments/yyyy/mm/dd/id-filename.ext",
  "design_attachment_url": "safe display URL",
  "design_attachment_content_type": "image/png",
  "design_attachment_size": 12345
}
```

Display rules:
- Mini cart should render `design_attachment_name` as Attachment.
- Mini cart "View" should use `design_attachment_url` only when it is safe and expected to be customer-visible.
- Checkout should render the same Attachment row and preserve key/provider fields for order creation.
- Admin/order fulfillment should later read the key/provider and obtain a fresh signed URL server-side if private objects are used.

Do not use:
- `design_attachment_data`
- `attachmentData` containing a data URL
- filename-only references as proof of upload
- browser `File` or `Blob` objects

## 9. Implementation path recommendation

Recommended: **Option C - both upload-reference foundation and frontend move-to-cart mapping are required.**

Why not Option A:
- A frontend-only mapping fix could drop `design_attachment_data`, allowing cart mutation to succeed, but the upload would be lost.
- Keeping the raw data URL in metadata is unsafe and incompatible with saved-items validation.

Why not Option B alone:
- Creating persistent upload references is necessary, but Move to Cart, mini cart, checkout, favorites drawer, and saved-build mapping still need to consume the new reference shape.

Why not Option D as phrased:
- A backend upload primitive already exists, and the customer-saved module already has an upload-reference model. The missing piece is a safe, scoped upload-reference flow and storefront adoption, not necessarily a totally new upload service.

Recommended next implementation sequence:
1. Backend upload-reference pilot:
   - add a protected customer upload-reference route or extend the existing upload route with customer-scoped saved-upload-reference creation;
   - return provider/key/filename/content_type/size/status/url;
   - keep raw data URL only in the upload request, never in saved-items/cart metadata;
   - define guest behavior explicitly.
2. Storefront upload-reference adapter:
   - Attire/Doormats upload once before favorite save or move-to-cart;
   - replace `attachmentData` with `attachment_key` / `attachment_url` reference fields;
   - preserve filename display.
3. Move-to-cart parity:
   - map attachment reference fields into `design_attachment_*` metadata;
   - remove `design_attachment_data` from cart mutations.
4. Mini cart/checkout parity:
   - render from URL/key reference;
   - no inline data fallback for Customer Saved Workspace paths.
5. Account saved-build parity:
   - save references in `upload_references`;
   - link saved item and upload-reference rows after saved-item upsert.

## 10. Proposed next implementation prompt outline

Title: LDC Persistent Upload Reference Foundation for Custom Builds

Scope:
- backend upload-reference route and storefront reference mapping only;
- no Admin Studio;
- no live order;
- use dummy non-sensitive upload test file only if explicitly approved.

Implementation outline:
- inspect existing `/store/design-attachments` and `customer_saved_upload_reference`;
- add protected customer-scoped upload-reference creation or a safe wrapper around the existing S3 upload primitive;
- derive `customer_id` only from authenticated context where customer-scoped;
- update Attire and Doormats upload handling to produce persistent reference objects before account save/move-to-cart;
- update favorites move-to-cart metadata to use `design_attachment_key/url/name` and never `design_attachment_data`;
- update mini cart/checkout attachment rendering to prefer safe URL/key;
- preserve upload-free Doormat saved builds and standard product favorites;
- validate no raw upload data enters saved-items or cart line-item metadata.

## 11. Risk classification

High:
- raw data URL/base64 stored in saved-items, cart metadata, order metadata, or guest/account storage;
- private upload visible to the wrong customer;
- upload-bearing cart mutations break checkout;
- attachment is lost before fulfillment;
- account upload reference leaks into guest storage.

Medium:
- temporary signed URL becomes stale in cart/checkout display;
- duplicate upload-reference records for the same build;
- mini cart shows filename while checkout loses link;
- Doormats and Attire diverge in metadata field names;
- upload works on one route but not the other.

Low:
- Attachment label/copy mismatch;
- missing "View" link when the key is present but URL refresh is deferred;
- visual row layout polish.

Unknown:
- production S3 privacy/public URL policy;
- whether fulfillment/Admin should consume public URL, signed URL, or key-only;
- whether guest upload references should exist before login;
- exact Medusa line-item metadata size limit observed in production;
- upload behavior for files that exceed current 1.5 MB client data URL threshold but are under S3 max size.

## 12. Files and live URLs inspected

Files inspected:
- `README.md`
- `AGENTS.md`
- `docs/audits/customer-saved-workspace-architecture-audit.md` from the prior audit branch
- `docs/audits/custom-build-saved-design-parity-audit.md` from the prior audit branch
- `favorites.js`
- `favorites.html`
- `favorites-theme.css`
- `commerce.js`
- `attire.html`
- `doormats.html`
- `checkout.html`
- `account.html`
- `medusa-backend/src/api/store/design-attachments/route.ts`
- `medusa-backend/src/api/middlewares.ts`
- `medusa-backend/src/modules/customer-saved-workspace/validation.ts`
- `medusa-backend/src/modules/customer-saved-workspace/service.ts`
- `medusa-backend/src/modules/customer-saved-workspace/models/customer-saved-upload-reference.ts`

Live URLs checked, non-mutating:
- `https://lovettsldc.com/attire?verify=upload-parity-audit` -> 200
- `https://lovettsldc.com/doormats?verify=upload-parity-audit` -> 200
- `https://lovettsldc.com/favorites?verify=upload-parity-audit` -> 200
- `https://lovettsldc.com/checkout?verify=upload-parity-audit` -> 200
- `https://lovettsldc.com/favorites.js?verify=upload-parity-audit` -> 200
- `https://lovettsldc.com/commerce.js?verify=upload-parity-audit` -> 200
- `https://api.lovettsldc.com/health` -> 200

## 13. Validation notes

This audit did not:
- modify runtime/source files;
- upload files;
- create customer accounts;
- create saved-items;
- mutate backend data;
- place orders;
- deploy storefront, backend, or Admin Studio.

Validation performed for this doc:
- `git diff --check`
- `git status --short`
- confirm only this audit document changed.

## 14. Closure recommendation

Audit closure: **MATCH**.

Feature readiness: **DRIFT** until persistent upload references and frontend reference metadata mapping are implemented.
