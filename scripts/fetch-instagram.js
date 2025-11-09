#!/usr/bin/env node
/**
 * Fetch the latest Instagram posts via the Basic Display API
 * and persist a lightweight feed JSON that the front-end can consume.
 *
 * Required environment variables:
 *   INSTAGRAM_ACCESS_TOKEN  - Long-lived user token (from Instagram Basic Display)
 *
 * Optional environment variables:
 *   INSTAGRAM_MEDIA_LIMIT   - Number of posts to capture (default 6)
 *   INSTAGRAM_OUTPUT_PATH   - Relative/absolute path for JSON output
 *
 * Usage:
 *   INSTAGRAM_ACCESS_TOKEN=xxx node scripts/fetch-instagram.js
 *
 * Requires Node 18+ (for the built-in fetch API).
 */

const { writeFile } = require('node:fs/promises');
const path = require('node:path');

if (typeof fetch !== 'function') {
  console.error('This script requires Node 18+ (global fetch is unavailable).');
  process.exit(1);
}

const REQUIRED_ENV = ['INSTAGRAM_ACCESS_TOKEN'];
const missing = REQUIRED_ENV.filter(key => !process.env[key]);
if (missing.length) {
  console.error(
    `Missing required environment variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`
  );
  process.exit(1);
}

const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
const mediaLimit = Number.parseInt(process.env.INSTAGRAM_MEDIA_LIMIT || '6', 10) || 6;
const defaultOutputPath = path.join(__dirname, '..', 'assets', 'instagram-feed.json');
const outputPath = process.env.INSTAGRAM_OUTPUT_PATH || defaultOutputPath;

const BASE_URL = 'https://graph.instagram.com';
const FIELDS = ['id', 'caption', 'media_type', 'media_url', 'permalink', 'thumbnail_url'].join(',');

const fetchJson = async (url, label) => {
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Instagram ${label} request failed (${response.status}): ${body}`);
  }
  return response.json();
};

const resolveCarouselMedia = async (item) => {
  const url = new URL(`${BASE_URL}/${item.id}/children`);
  url.searchParams.set('fields', 'id,media_type,media_url,thumbnail_url');
  url.searchParams.set('access_token', accessToken);
  const payload = await fetchJson(url, 'carousel lookup');
  if (!Array.isArray(payload.data) || !payload.data.length) {
    return item.thumbnail_url || item.media_url;
  }
  const firstVisual =
    payload.data.find(child => child.media_type === 'IMAGE' || child.media_type === 'CAROUSEL_ALBUM') ||
    payload.data[0];
  return firstVisual.media_url || firstVisual.thumbnail_url || item.thumbnail_url || item.media_url;
};

const normaliseItem = async (item) => {
  let imageUrl = item.media_url;
  if (item.media_type === 'VIDEO') {
    imageUrl = item.thumbnail_url || item.media_url;
  } else if (item.media_type === 'CAROUSEL_ALBUM') {
    imageUrl = await resolveCarouselMedia(item);
  }

  if (!imageUrl) {
    return null;
  }

  return {
    id: item.id,
    permalink: item.permalink,
    caption: item.caption || '',
    imageUrl,
    mediaType: item.media_type,
  };
};

const main = async () => {
  const feedUrl = new URL(`${BASE_URL}/me/media`);
  feedUrl.searchParams.set('fields', FIELDS);
  feedUrl.searchParams.set('limit', String(mediaLimit));
  feedUrl.searchParams.set('access_token', accessToken);

  const payload = await fetchJson(feedUrl, 'feed');
  const candidates = Array.isArray(payload.data) ? payload.data : [];
  const resolved = [];

  for (const item of candidates) {
    try {
      const normalised = await normaliseItem(item);
      if (normalised) {
        resolved.push(normalised);
      }
    } catch (error) {
      console.warn(`Skipping media ${item.id}: ${error.message}`);
    }
    if (resolved.length >= mediaLimit) {
      break;
    }
  }

  if (!resolved.length) {
    throw new Error('No usable Instagram media returned.');
  }

  const output = {
    updatedAt: new Date().toISOString(),
    profile: 'https://instagram.com/lovetts._ldc',
    data: resolved,
  };

  await writeFile(outputPath, JSON.stringify(output, null, 2));
  console.log(`Instagram feed saved to ${outputPath}`);
};

main().catch(error => {
  console.error('Unable to refresh Instagram feed:', error);
  process.exit(1);
});
