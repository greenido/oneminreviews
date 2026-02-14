/**
 * Generate video-sitemap.xml and image-sitemap.xml
 * Run after `astro build` to add these to the dist/ folder.
 *
 * Usage: node scripts/generate-sitemaps.js
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');
const SITE_URL = 'https://greenido.github.io';
const BASE_PATH = '/oneminreviews/';

// Load data
const videos = JSON.parse(readFileSync(resolve(ROOT, 'data/videos.json'), 'utf-8'));
const restaurants = JSON.parse(readFileSync(resolve(ROOT, 'data/restaurants.json'), 'utf-8'));

// ---------- Helpers ----------

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function videoSlug(video) {
  const captionSlug = slugify(video.caption).slice(0, 50).replace(/-$/, '');
  return `${captionSlug}-${video.videoId}`;
}

function videoPath(video) {
  return `${BASE_PATH}${video.restaurantSlug}/${videoSlug(video)}/`;
}

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ---------- Video Sitemap ----------

function generateVideoSitemap() {
  const entries = videos.map((video) => {
    const restaurant = restaurants[video.restaurantSlug];
    const url = `${SITE_URL}${videoPath(video)}`;
    const isoDate = new Date(video.createTime * 1000).toISOString();
    const title = restaurant
      ? `${restaurant.name} Review by @oneminreviews`
      : video.caption.slice(0, 100);

    return `  <url>
    <loc>${escapeXml(url)}</loc>
    <video:video>
      <video:thumbnail_loc>${escapeXml(video.thumbnailUrl.startsWith('http') ? video.thumbnailUrl : SITE_URL + (video.thumbnailUrl.startsWith('/') ? BASE_PATH + video.thumbnailUrl.slice(1) : BASE_PATH + video.thumbnailUrl))}</video:thumbnail_loc>
      <video:title>${escapeXml(title)}</video:title>
      <video:description>${escapeXml(video.caption)}</video:description>
      <video:content_loc>${escapeXml(video.embedUrl)}</video:content_loc>
      <video:player_loc>${escapeXml(video.embedUrl)}</video:player_loc>
      <video:publication_date>${isoDate}</video:publication_date>
      <video:family_friendly>yes</video:family_friendly>
      <video:tag>restaurant review</video:tag>
      <video:tag>food review</video:tag>
      <video:tag>${escapeXml(video.city)}</video:tag>
      <video:tag>${escapeXml(video.cuisine)}</video:tag>
      ${restaurant ? `<video:tag>${escapeXml(restaurant.name)}</video:tag>` : ''}
    </video:video>
  </url>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
${entries.join('\n')}
</urlset>`;
}

// ---------- Image Sitemap ----------

function generateImageSitemap() {
  const entries = videos.map((video) => {
    const restaurant = restaurants[video.restaurantSlug];
    const url = `${SITE_URL}${videoPath(video)}`;
    const imageUrl = video.thumbnailUrl.startsWith('http') ? video.thumbnailUrl : `${SITE_URL}${BASE_PATH}${video.thumbnailUrl.startsWith('/') ? video.thumbnailUrl.slice(1) : video.thumbnailUrl}`;
    const caption = restaurant
      ? `${restaurant.name} food review photo`
      : `Restaurant review photo`;
    const title = restaurant
      ? `${restaurant.name} by @oneminreviews`
      : video.caption.slice(0, 80);

    return `  <url>
    <loc>${escapeXml(url)}</loc>
    <image:image>
      <image:loc>${escapeXml(imageUrl)}</image:loc>
      <image:caption>${escapeXml(caption)}</image:caption>
      <image:title>${escapeXml(title)}</image:title>
    </image:image>
  </url>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${entries.join('\n')}
</urlset>`;
}

// ---------- Write ----------

if (!existsSync(DIST)) {
  console.error('dist/ directory not found. Run `astro build` first.');
  process.exit(1);
}

writeFileSync(resolve(DIST, 'video-sitemap.xml'), generateVideoSitemap());
console.log('✓ Generated video-sitemap.xml');

writeFileSync(resolve(DIST, 'image-sitemap.xml'), generateImageSitemap());
console.log('✓ Generated image-sitemap.xml');

console.log(`✓ ${videos.length} videos indexed in sitemaps`);
