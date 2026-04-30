# Customization And Seasonal Saved Designs Runtime Audit

Date: 2026-04-30
Branch: `audit/customization-seasonal-saved-designs`
Base: `origin/main` at `86f8da5afdffba1bbeba216c3eb3a50211726b5a`
Status: DRIFT

## 1. Executive summary

Customization saved designs are DRIFT for immediate implementation. The backend saved-items contract already supports `custom_design` and `seasonal_design`, and the Customization route already captures product identity, selected design/color/accessory/wrap fields, notes, preview data, price context, cart metadata, and persistent S3 attachment key/url data during submit. The missing runtime pieces are the saved-design capture surface, `favorites.js` support for `custom_design`, account load/save/delete/merge mapping, and a restore-to-builder path that can rehydrate the builder without immediately adding to cart.

Seasonal / Explore Wrap saved designs are UNKNOWN as a standalone implementation target. Source inspection found a `Seasonal / Holiday` wrap option inside the Design builder and a `last-chance.html` seasonal product collection, but no dedicated `/seasonal`, `/explore-wrap`, or `/wraps` route/source model. Live checks for those candidate routes returned the homepage fallback. Do not implement `seasonal_design` as a separate saved item type until LDC supplies or confirms a first-class Seasonal/Explore Wrap source.

Safest next implementation target: Customization saved designs pilot with restore-to-builder first. Direct move-to-cart can be added for records whose product/variant, live pricing, selected options, and upload references rehydrate cleanly. Seasonal should remain future/pending source.

## 2. Current Customization route map

Route status: `customization.html` is a live static page and `https://lovettsldc.com/customization?verify=custom-design-audit` returned `200 text/html`.

Customer journey:
- Customer launches Design from a product tile. `commerce.js` builds a `ldcDesignSelection` localStorage payload with preview image, product key/handle/id, variant id, selected swatch, price, description, and swatches.
- `customization.html` reads `ldcDesignSelection`, restores preview/product context, applies pending color/accessory selections, and lets the customer select Color, Accessory, Wrap Template, Customer Notes, and Upload Inspiration.
- Submit adds a line item to the Medusa cart when Medusa is enabled, then sends the customer to checkout.

Builder/options available:
- Color swatches from `[data-design-colors-source]`.
- Accessory swatches from `[data-design-accessories-source]`.
- Wrap templates from `[data-wrap-option]`, including `seasonal-holiday`, `women`, `special-designers`, `drinks`, `boys-men`, `supporting-causes`, `careers-hobbies`, `sports`, and `religion`.
- Customer Notes via `#design-notes-customization`.
- Upload Inspiration via `#designUploadCustomization`.

Product/variant references:
- Stored design launch payload can include `productKey`, `productHandle`, `productId`, and `variantId`.
- Runtime state stores `selectedDesignProductKey`, `selectedDesignProductHandle`, `selectedDesignProductId`, `selectedDesignVariantId`, and `selectedDesignBaseVariantId`.
- On submit, the route resolves a Medusa variant from the selected product context if `selectedDesignVariantId` is missing.

Metadata created:
- `design_mode`, preview URL/style/alt, product key/handle/id/description, variant id, base/addon/total price, color/accessory/wrap labels and swatch data, notes, attachment filename/url/key.
- This metadata already feeds mini-cart and checkout display through `commerce.js` and `checkout.html`.

Notes behavior:
- Notes are captured from `#design-notes-customization` into `design_notes` and into legacy fallback cart `notes`.

Upload behavior:
- `readDesignAttachment()` reads the browser File as a data URL only transiently.
- `uploadDesignAttachment()` POSTs the data URL to `/store/design-attachments` before cart add.
- Cart metadata receives only returned `design_attachment_url` and `design_attachment_key` plus filename. The raw data URL is not intended to enter cart metadata.

Preview/image behavior:
- Preview comes from the launched product image or an updated swatch/artwork preview and is saved as `design_preview_url`, `preview_url`, `design_preview_style`, and `preview_style`.

Cart behavior:
- Medusa path calls `commerce.addLineItem(resolvedVariantId, 1, metadata)`.
- Fallback local cart path stores a legacy `design-${Date.now()}` product with options and notes.

Favorites behavior:
- There is no first-class Customization save/favorite button on the route.
- `favorites.js` currently treats design-submitted favorites as not account-syncable unless they are specifically Doormat or Attire records.
- `favorites.js` only loads `product_favorite`, `doormat_build`, and `attire_build`; it does not load or map `custom_design` or `seasonal_design`.

## 3. Current Customization saved-data requirements

A `custom_design` saved item must preserve:
- `source_path`: `/customization`.
- Product identity: product key, product handle, product ID, and selected product title/description.
- Variant identity: selected/resolved variant ID, plus base variant ID when distinct.
- Selected design/template/wrap: wrap option key and label, not only display text. Current route stores label; next phase should also capture the stable `data-wrap-option` key.
- Selected colors/options/accessories: labels, swatch styles, glyphs, image src/alt for accessories, and variant ID if a swatch maps to a variant.
- Notes: full customer notes, with notes included in dedupe.
- Upload references: persistent references only, with provider/key/filename/content type/size/display URL when safe.
- Preview/image: preview URL, preview style, preview alt, and enough information to refresh or rebuild preview.
- Price snapshot: base price, addon price, total price, display price, currency, and live reprice input.
- Selected options: display rows for Favorites drawer/Favorites page.
- `line_item_metadata`: the exact safe metadata needed by mini-cart, checkout, and later order/Admin fulfillment.
- `item_payload`: builder restore payload, including selected color/accessory/wrap keys, labels, swatches, preview state, product context, notes, and upload references.
- `live_reference`: source path, product key/handle/id, variant ID, wrap key, selected option keys, and upload reference keys for rehydration.

## 4. Seasonal / Explore Wrap source findings

Dedicated routes:
- No `seasonal.html`, `explore-wrap.html`, or `wraps.html` route file exists in the repo.
- Live `/seasonal`, `/explore-wrap`, and `/wraps` requests returned `200 text/html` but the content title was `Home`, indicating Cloudflare fallback to `index.html`, not dedicated route source.

Existing seasonal/wrap source:
- `customization.html` and `index.html` contain a Design builder wrap menu with a `Seasonal / Holiday` option keyed as `data-wrap-option="seasonal-holiday"`.
- `scripts/wrap-videos.js` enhances `[data-wrap-option]` items and can load direct video sources, Cloudflare Stream URLs, posters, or prompt-only entries.
- Local MOV assets exist for non-seasonal wrap categories: `women`, `supporting-causes`, `sports`, `religion`, `drinks`, `careers-hobbies`, and `boys-men`.
- `last-chance.html` is a seasonal/last-chance product collection page, not a saved-design builder source.

Seasonal status:
- Mark Seasonal / Explore Wrap saved designs as future/pending source.
- Until a dedicated source exists, the `Seasonal / Holiday` wrap choice should be saved as a `custom_design` wrap selection, not as `seasonal_design`.

## 5. Upload/reference findings

Customization upload handling has a persistent-reference bridge but not a customer-scoped upload reference record:
- `/store/design-attachments` accepts a transient `data_url`, writes the file to S3, and returns `{ key, filename, url }`.
- The route uses S3 key generation under a `design-attachments/YYYY/MM/DD/<uuid>-<filename>` prefix.
- It returns either a public-base URL or a signed URL depending on backend configuration.
- It does not require customer auth and does not create `customer_saved_upload_reference` rows.

Saved-items validation:
- Backend saved item types include `custom_design` and `seasonal_design`.
- Validation rejects `customer_id` in client payloads.
- Validation rejects raw upload keys and raw data URL/base64 content in `selected_options`, `item_payload`, `line_item_metadata`, `upload_references`, and `live_reference`.

Safe upload-reference shape for saved designs:
```json
{
  "provider": "s3",
  "key": "design-attachments/YYYY/MM/DD/<uuid>-filename.ext",
  "filename": "filename.ext",
  "content_type": "image/png",
  "size": 12345,
  "display_url": "https://...",
  "route": "customization",
  "source": "upload_inspiration",
  "status": "active",
  "metadata": {
    "source_path": "/customization"
  }
}
```

Raw browser File objects, raw data URLs, base64 strings, blobs, and filename-only references must not be stored in saved-items or long-term customer records.

## 6. Backend saved-item type recommendation

Customization:
- Type: `custom_design`.
- Typed fields: `source_path`, `product_id`, `product_handle`, `product_key`, `variant_id`, `title`, `variant_title`, `quantity`, `currency_code`, `price_snapshot_amount`, `price_snapshot_display`, `notes`.
- `selected_options`: Color, Accessory, Wrap, Notes, Attachment display rows.
- `item_payload`: builder restore state with product context, preview state, selected color/accessory/wrap keys and labels, swatch style/glyph/image data, notes, upload reference summaries, and source route.
- `line_item_metadata`: safe cart/checkout metadata currently produced by `buildDesignMetadata()`.
- `upload_references`: persistent upload references only.
- `live_reference`: product key/handle/id, variant id, selected wrap key, selected swatch identifiers, upload reference keys, and source path.
- `favorite_key` pattern: `custom_design|<product_key>|variant:<variant_id>|wrap:<wrap_key>|color:<color_key>|accessory:<accessory_key>|notes:<hash>|uploads:<upload_hash_or_none>`.
- `dedupe_key` pattern: same identity fields as `favorite_key`, prefixed with `custom_design`, normalized and stable.

Seasonal:
- Type: `seasonal_design` only after a dedicated Seasonal/Explore Wrap route/source exists.
- Required fields should mirror `custom_design` plus Seasonal-specific template/source identifiers such as `seasonal_collection_key`, `template_key`, `template_version`, `asset_key`, and active date/availability metadata.
- Until then, do not create `seasonal_design` records for the existing `Seasonal / Holiday` wrap menu item.

## 7. Dedupe and identity strategy

Customization dedupe should use stable selected design identity:
- Same product + variant + design/template/wrap + color + accessory + notes hash + upload reference hash should upsert the existing saved design.
- Same design with different notes should create a separate saved design.
- Same design with different upload reference keys should create a separate saved design.
- Same customer may save multiple versions of one design; differences in notes, upload references, color/accessory/wrap, or product/variant should produce distinct keys.
- Do not include timestamps, transient signed URLs, display-only URLs, or raw upload content in identity.
- Use upload reference keys for upload identity. If the only available value is a filename or data URL, the record is unsafe for account persistence.

Seasonal dedupe should remain undefined until Seasonal source exists. When implemented, use product + variant + seasonal source/template key + option selections + notes hash + upload reference hash.

## 8. Storefront integration plan

`favorites.js` account mode:
- Add `CUSTOM_DESIGN_TYPE = "custom_design"` to supported saved item types.
- Map safe Customization design payloads to backend saved-items.
- Map backend `custom_design` records back to the shared favorite shape.
- Preserve existing `product_favorite`, `doormat_build`, and `attire_build` behavior.

Guest session-only mode:
- Allow guest custom designs only in `ldc:favorites:guest-session`.
- Do not write to persistent `ldc:favorites`.
- Do not merge or account-save unsafe payloads.

Guest-to-account merge:
- Merge only safe `custom_design` records with complete product/variant identity and persistent upload references.
- Clear successfully merged guest records by favorite key, dedupe key, saved item identity, and normalized design identity aliases.
- Keep unsafe/unmerged guest designs in session only and report/defer without silent deletion.

Favorites drawer and Favorites page:
- Render Customization saved designs using existing detail rows: Color, Accessory, Wrap, Notes, Attachment.
- Show preview image/style and price snapshot.
- Provide Restore to Builder as the primary CTA for saved designs.
- Provide Move to Cart only when live product/variant and metadata revalidation succeed.

Builder save/heart state:
- Add a save/favorite control to Customization only in the implementation phase.
- The control should classify true guest vs account-owned saved designs and observe logout privacy.

## 9. Guest behavior plan

Guests can save custom designs during the active session if the payload is complete enough to restore the builder. Guest designs should remain under `ldc:favorites:guest-session` and should not survive a new browser session.

Guest designs can merge on login only when:
- product/variant identity is present,
- selected design/color/accessory/wrap fields are present,
- upload references are persistent or no upload exists,
- payload contains no raw data URL/base64/File/blob fields.

If uploads are temporary or incomplete, keep the guest session item and show/defer safe messaging in the implementation phase. Do not convert unsafe guest designs into account-owned UI.

## 10. Logout privacy plan

On logout:
- Clear in-memory account `custom_design` records from drawer/page/hearts.
- Rehydrate only true guest-session records.
- Exclude records with backend saved item identity, `owner_scope: "account"`, `account_source: "backend"`, or `merged_to_account`.
- Do not copy account saved designs into guest sessionStorage or localStorage.
- Do not delete backend saved design records.
- Do not clear cart or Continue Shopping route state.

## 11. Move-to-cart and restore-to-builder plan

Primary behavior should be Restore to Builder:
- Write a safe builder restore payload into `ldcDesignSelection`.
- Include product context, preview state, selected color/accessory/wrap keys and labels, notes, upload reference summaries, and variant ID.
- Navigate to `/customization`.
- Reapply color/accessory/wrap selections and preview without requiring an immediate cart add.

Direct Move to Cart can be enabled only when:
- variant ID is valid and live saleability/availability checks pass,
- product/variant pricing is refreshed,
- `line_item_metadata` is complete and safe,
- upload references are persistent and no raw upload payload exists.

If product/template/variant is unavailable:
- show a reselect/restore-to-builder message,
- do not add a stale item to cart,
- preserve the saved design record.

Mini-cart and checkout:
- Continue using design metadata display rows for Color, Accessory, Wrap, Notes, and Attachment.
- Checkout should continue to request `+items.metadata` and render attachment filename/link only when URL/reference is safe.

## 12. Admin Studio / fulfillment visibility note

Admin Studio visibility is not required for the next storefront saved-design pilot, but fulfillment will eventually need:
- customer saved design list,
- saved date and customer/account identity,
- preview image/style,
- product/variant identity,
- selected color/accessory/wrap/template details,
- customer notes,
- upload reference key/filename/display URL,
- move-to-cart/order metadata,
- restore payload for support review.

Do not implement Admin Studio visibility in the next Customization pilot unless explicitly scoped.

## 13. Recommended next implementation prompt outline

Next prompt should be a Customization saved designs restore-to-builder pilot:
- Branch from `origin/main`.
- Change only `favorites.js` and `customization.html` unless a narrow `commerce.js` helper is required.
- Add `custom_design` support to account saved-items load/save/delete/merge.
- Add a Customization save control that captures a safe builder payload.
- Use persistent upload references only; reject/defer raw upload payloads.
- Add Restore to Builder from Favorites drawer/Favorites page.
- Add direct Move to Cart only for safe/live revalidated records.
- Validate with source checks, `node --check favorites.js`, route smoke tests, and live account tests only after deploy approval.

Do not include Seasonal in that pilot.

## 14. Risk classification

High:
- raw upload/base64/data URL stored in saved-items,
- private saved design visible to the wrong customer,
- broken cart/checkout metadata,
- inability to restore the saved design,
- wrong product/variant identity.

Medium:
- duplicate saved designs due to incomplete dedupe,
- stale price snapshot,
- stale unavailable templates/products,
- incomplete preview or missing swatch restore,
- signed URL expiry if display URL is treated as identity.

Low:
- copy/empty-state polish,
- CTA label choice between Save Design, Favorite, Restore, and Move to Cart.

Unknown:
- dedicated Seasonal/Explore Wrap source,
- seasonal template asset model,
- customer-scoped upload-reference records versus current reference-only S3 key/url route,
- exact Admin fulfillment expectations.
