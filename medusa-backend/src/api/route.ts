import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

const landingHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Lovetts LDC Studio</title>
    <meta name="description" content="Lovetts LDC storefront and admin access." />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Montserrat:wght@400;500;600&display=swap"
      rel="stylesheet"
    />
    <style>
      :root {
        --pink: #f6a7d8;
        --mauve: #d8b4fe;
        --peach: #ffd3c4;
        --plum: #5b2d6f;
        --cream: #fff7ef;
        --shadow: rgba(91, 45, 111, 0.18);
        --glass: rgba(255, 255, 255, 0.7);
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: "Montserrat", "Helvetica Neue", Arial, sans-serif;
        color: var(--plum);
        background:
          radial-gradient(circle at 12% 12%, rgba(255, 255, 255, 0.7), transparent 40%),
          radial-gradient(circle at 88% 20%, rgba(246, 167, 216, 0.45), transparent 45%),
          linear-gradient(145deg, #f9c9e9 0%, #e6c5ff 45%, #ffd7c8 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2.5rem 1.5rem;
      }
      .card {
        width: min(980px, 95vw);
        background: var(--glass);
        border-radius: 28px;
        padding: clamp(2rem, 4vw, 3.5rem);
        box-shadow: 0 30px 60px var(--shadow);
        border: 1px solid rgba(255, 255, 255, 0.6);
        backdrop-filter: blur(18px);
        position: relative;
        overflow: hidden;
      }
      .card::before,
      .card::after {
        content: "";
        position: absolute;
        border-radius: 999px;
        opacity: 0.5;
        filter: blur(0);
      }
      .card::before {
        width: 240px;
        height: 240px;
        background: rgba(255, 211, 196, 0.6);
        top: -120px;
        right: -80px;
      }
      .card::after {
        width: 200px;
        height: 200px;
        background: rgba(216, 180, 254, 0.6);
        bottom: -110px;
        left: -60px;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.45rem 0.9rem;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.6);
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.24em;
        font-weight: 600;
      }
      h1 {
        font-family: "Cormorant Garamond", Georgia, "Times New Roman", serif;
        font-size: clamp(2.2rem, 5vw, 3.8rem);
        margin: 1.2rem 0 0.5rem;
      }
      p {
        margin: 0.5rem 0 1.5rem;
        line-height: 1.6;
        font-size: clamp(1rem, 2vw, 1.15rem);
        max-width: 46rem;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        margin-top: 1.5rem;
      }
      .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0.95rem 1.7rem;
        border-radius: 999px;
        font-weight: 600;
        text-decoration: none;
        color: var(--plum);
        background: var(--cream);
        box-shadow: 0 14px 30px rgba(91, 45, 111, 0.2);
        border: 2px solid transparent;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }
      .button:hover {
        transform: translateY(-2px);
        box-shadow: 0 18px 35px rgba(91, 45, 111, 0.25);
      }
      .button--primary {
        background: linear-gradient(130deg, #f8b4dc, #dab3ff);
        color: #fff;
      }
      .meta {
        margin-top: 2rem;
        display: grid;
        gap: 0.75rem;
        font-size: 0.9rem;
        color: rgba(91, 45, 111, 0.75);
      }
      .meta strong {
        color: var(--plum);
        font-weight: 600;
      }
      .meta a {
        color: inherit;
      }
      @media (max-width: 600px) {
        .actions {
          flex-direction: column;
          align-items: stretch;
        }
        .button {
          width: 100%;
        }
      }
    </style>
  </head>
  <body>
    <main class="card">
      <span class="badge">Lovetts LDC</span>
      <h1>Handcrafted, vibrant, and ready to ship.</h1>
      <p>
        Welcome to the Lovetts LDC experience. Shop the latest designs, or sign
        in to manage orders and products.
      </p>
      <div class="actions">
        <a class="button button--primary" href="https://lovettsldc.com">
          Visit the Storefront
        </a>
        <a class="button" href="/app">Admin Login</a>
      </div>
      <div class="meta">
        <div><strong>Storefront:</strong> https://lovettsldc.com</div>
        <div><strong>Admin:</strong> https://api.lovettsldc.com/app</div>
      </div>
    </main>
  </body>
</html>`

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  res.setHeader("Content-Type", "text/html; charset=utf-8")
  res.status(200).send(landingHtml)
}
