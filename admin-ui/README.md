# LDC Admin UI

Custom LDC-branded admin panel for the Medusa backend.

## Local development

```bash
cd admin-ui
npm install
npm run dev
```

Environment
- `VITE_MEDUSA_BACKEND_URL` (defaults to `https://api.lovettsldc.com`)

Create a local `.env` using the example:

```bash
cp .env.example .env
```

## Build

```bash
npm run build
```

Output is in `admin-ui/dist`.

## Cloudflare Pages

- Framework preset: `Vite`
- Build command: `npm install && npm run build`
- Build output directory: `dist`
- Root directory: `admin-ui`
- Set `VITE_MEDUSA_BACKEND_URL=https://api.lovettsldc.com` in the Pages environment variables.
