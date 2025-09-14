Project: Static landing page scaffold

How to preview
- Open `index.html` directly in your browser, or
- Serve locally (any static server). For example: `python3 -m http.server` from this folder.

Stack
- HTML + Tailwind (local build) for layout and responsive styling.
- Minimal JS for mobile nav toggle.

Local development
- Install deps: `npm install`
- Build once: `npm run build` (outputs `styles.css` in project root)
- Watch during edits: `npm run dev`

Cloudflare Pages
- Create a new Pages project pointing to this repo
- Framework preset: `None`
- Build command: `npm install && npm run build`
- Build output directory: `.` (the repo root)
- Include `_headers` in the publish directory to set caching and security headers

Workflow
- Replace placeholder content in `index.html` with sections from screenshots 1–5.
- Add your hero and product images under `assets/`.
- For exact fonts, add self-hosted `.woff2` files and reference them from `styles.css`.
