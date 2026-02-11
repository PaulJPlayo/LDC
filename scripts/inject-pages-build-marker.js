const fs = require("fs");
const { execSync } = require("child_process");

function tryCmd(cmd) {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

const envSha = (process.env.CF_PAGES_COMMIT_SHA || "").trim();
const envBranch = (process.env.CF_PAGES_BRANCH || "").trim();
const envUrl = (process.env.CF_PAGES_URL || "").trim();

// Prefer Cloudflare Pages env vars when present
const sha = (envSha ? envSha.slice(0, 7) : tryCmd("git rev-parse --short HEAD")) || "unknown";
const branch = (envBranch || tryCmd("git rev-parse --abbrev-ref HEAD")) || "unknown";
const url = envUrl || "";
const utc = new Date().toISOString();

const target = "commerce.js";
if (!fs.existsSync(target)) {
  console.error(`[inject-pages-build-marker] Missing ${target}`);
  process.exit(1);
}

let text = fs.readFileSync(target, "utf8");

// Replace existing const lines (must exist)
const shaRe = /const\s+STOREFRONT_BUILD_SHA\s*=\s*'[^']*';/;
const utcRe = /const\s+STOREFRONT_BUILD_UTC\s*=\s*'[^']*';/;

if (!shaRe.test(text) || !utcRe.test(text)) {
  console.error("[inject-pages-build-marker] Expected STOREFRONT_BUILD_SHA/UTC const lines not found in commerce.js");
  process.exit(1);
}

text = text.replace(shaRe, `const STOREFRONT_BUILD_SHA = '${sha}';`);
text = text.replace(utcRe, `const STOREFRONT_BUILD_UTC = '${utc}';`);

// Optional: also inject branch/url into the existing build log line if you want later.
// For now we keep this minimal.

fs.writeFileSync(target, text, "utf8");

console.log("[inject-pages-build-marker] injected", { sha, utc, branch, url });
