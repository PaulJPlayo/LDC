# Account Continue Shopping Audit (2026-04-02)

## 1. Scope
- Define the safest implementation for replacing the Account page `Back to Home` action with `Continue Shopping`.
- Keep this audit limited to the public storefront Account/Favorites/Checkout return-target behavior.
- No runtime changes were made in this audit.

## 2. Current Account button state
- `DRIFT`: `account.html` currently renders:
  - selector/class: `.account-back`
  - element: `<a>`
  - href: `index.html`
  - label: `Back to Home`
- Current behavior is static home fallback only. It does not restore the page the shopper was on before entering `/account`.

## 3. Existing shared continue-shopping state
- `MATCH` for Favorites/Checkout, but not for Account.
- `commerce.js` currently defines a browse-target policy for Favorites/Checkout:
  - storage key: `ldc:continue-shopping:return-url`
  - browse-path allowlist:
    - `/`
    - `/customization`
    - `/tumblers`
    - `/cups`
    - `/accessories`
    - `/sale`
    - `/under-25`
    - `/last-chance`
    - `/new-arrivals`
    - `/best-sellers`
    - `/restock`
  - excluded paths:
    - `/favorites`
    - `/checkout`
- `favorites.html` and `checkout.html` use `data-continue-shopping-target`.
- Current helper purpose: return to the last safe browse route. It is intentionally not designed to remember `/favorites` or `/checkout`.

## 4. Recommended Account-specific return-target policy
- Recommended approach: `A` = a dedicated Account return-target helper in `commerce.js`.
- Reason:
  - Account semantics differ from Favorites/Checkout semantics.
  - Account must restore the immediately previous safe in-site page before `/account`.
  - That includes `/favorites` and `/checkout`, which the existing browse helper intentionally excludes.
  - Reusing the existing helper by loosening its policy would risk changing already-correct Favorites/Checkout behavior.
- Recommended behavior:
  - Store a separate Account return target under a dedicated session key.
  - Capture it on safe storefront pages before Account is entered.
  - Never overwrite it while already on `/account`.
  - Apply it only to the Account page’s continue-shopping control.

## 5. Safe / unsafe target rules
- Safe target rules:
  - same-origin only
  - relative storefront destination only
  - preserve `pathname + search + hash`
  - normalized path handling should match the existing helper
  - `/account` is excluded from capture and excluded from resolved targets
  - `/favorites` is allowed
  - `/checkout` is allowed
  - other public storefront routes should be allowed, including:
    - `/`
    - `/customization`
    - `/tumblers`
    - `/cups`
    - `/accessories`
    - `/attire`
    - `/doormats`
    - `/sale`
    - `/under-25`
    - `/last-chance`
    - `/new-arrivals`
    - `/best-sellers`
    - `/restock`
- Unsafe target rules:
  - external origins
  - protocol-relative URLs
  - malformed URLs
  - `/account`
  - non-storefront asset-like paths or unknown paths outside the approved storefront route set

## 6. Fallback rules
- If no valid stored Account return target exists, resolve to `/`.
- If the stored target is invalid or unsafe, resolve to `/`.
- If `/account` is opened directly in a fresh session, resolve to `/`.
- If the shopper flow is `/restock -> /favorites -> /checkout -> /account`, Account `Continue Shopping` should resolve to `/checkout` only if `/checkout` was the immediate safe page before entering `/account`.
- If the shopper flow is `/restock -> /account`, Account `Continue Shopping` should resolve to `/restock`.

## 7. Recommended implementation file set
- `commerce.js`
  - add dedicated Account return-target storage key
  - add Account-specific sanitize/capture/resolve/apply helpers
  - reuse existing normalization helpers where appropriate
- `account.html`
  - change the current `.account-back` control from `Back to Home` to `Continue Shopping`
  - replace static `href="index.html"` with an Account-specific data hook driven by `commerce.js`
- No page-local changes should be needed in:
  - `favorites.html`
  - `checkout.html`

## 8. Recommended rollout order
1. Add the shared Account-specific helper in `commerce.js`.
2. Update the single Account page control in `account.html`.
3. Verify live flows:
   - `/new-arrivals -> /account -> Continue Shopping`
   - `/favorites -> /account -> Continue Shopping`
   - `/checkout -> /account -> Continue Shopping`
   - direct `/account` fresh-session fallback
   - invalid-target fallback

## 9. Final recommendation
- Implement this as one shared helper update plus one `account.html` update.
- Do not repurpose the existing Favorites/Checkout browse helper for Account.
- Keep the Favorites/Checkout helper unchanged so current continue-shopping behavior there remains stable.
