/**
 * OG Image Generator
 *
 * Creates branded social preview images for each video:
 * - Best frame as background
 * - Restaurant name overlay
 * - Star rating overlay
 * - @oneminreviews branding
 *
 * Output: 1200x630 JPEG (OG standard) + WebP
 *
 * Uses Sharp for image compositing (no FFmpeg needed).
 * Usage: node scripts/generate-og-images.js
 */

import sharp from 'sharp';
import { readFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DATA_DIR = resolve(ROOT, 'data');
const IMAGES_DIR = resolve(ROOT, 'assets/images');

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

// ---- Helpers ----

function log(msg) {
  console.log(`[og-images] ${msg}`);
}

function renderStars(rating) {
  const full = Math.round(rating);
  return '★'.repeat(full) + '☆'.repeat(5 - full);
}

function findBestFrame(videoId) {
  const imageDir = resolve(IMAGES_DIR, videoId);
  if (!existsSync(imageDir)) return null;

  // Priority: scene-best > frame-3 (60%) > frame-2 (30%) > frame-1
  const candidates = ['scene-best.jpg', 'frame-3.jpg', 'frame-2.jpg', 'frame-1.jpg'];
  for (const candidate of candidates) {
    const path = resolve(imageDir, candidate);
    if (existsSync(path)) return path;
  }
  return null;
}

// ---- SVG Overlay ----

function createOverlaySVG(restaurantName, rating, city) {
  const stars = rating ? renderStars(rating) : '';
  const ratingText = rating ? `${rating.toFixed(1)} / 5` : '';

  // Escape XML entities
  const esc = (s) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  return Buffer.from(`
    <svg width="${OG_WIDTH}" height="${OG_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="overlay" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(0,0,0,0)" />
          <stop offset="40%" stop-color="rgba(0,0,0,0)" />
          <stop offset="100%" stop-color="rgba(0,0,0,0.85)" />
        </linearGradient>
      </defs>

      <!-- Gradient overlay -->
      <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#overlay)" />

      <!-- Branding top-left -->
      <rect x="24" y="24" width="200" height="36" rx="6" fill="rgba(0,0,0,0.6)" />
      <text x="36" y="48" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="700" fill="#ff3b5c">
        One<tspan fill="#ffffff">Min</tspan><tspan fill="#888888">Reviews</tspan>
      </text>

      <!-- Restaurant name -->
      <text x="40" y="${OG_HEIGHT - 100}" font-family="Arial Black, Arial, Helvetica, sans-serif" font-size="42" font-weight="900" fill="#ffffff">
        ${esc(restaurantName.length > 30 ? restaurantName.slice(0, 28) + '...' : restaurantName)}
      </text>

      <!-- Stars -->
      ${stars ? `<text x="40" y="${OG_HEIGHT - 58}" font-family="Arial, Helvetica, sans-serif" font-size="28" fill="#fbbf24">${stars}</text>` : ''}

      <!-- Rating + City -->
      <text x="40" y="${OG_HEIGHT - 28}" font-family="Arial, Helvetica, sans-serif" font-size="18" fill="#cccccc">
        ${ratingText ? `${esc(ratingText)}  ·  ` : ''}${esc(city)}  ·  @oneminreviews
      </text>
    </svg>
  `);
}

// ---- Generate OG Image ----

async function generateOGImage(video, restaurant) {
  const outputDir = resolve(IMAGES_DIR, video.videoId);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const ogJpgPath = resolve(outputDir, 'og.jpg');
  const ogWebpPath = resolve(outputDir, 'og.webp');

  // Skip if already exists
  if (existsSync(ogJpgPath) && existsSync(ogWebpPath)) {
    log(`${video.videoId}: OG images exist, skipping`);
    return;
  }

  const framePath = findBestFrame(video.videoId);

  if (framePath) {
    // Use actual frame as background
    const overlay = createOverlaySVG(
      restaurant?.name || video.restaurantSlug || 'Restaurant Review',
      restaurant?.google?.rating,
      video.city || ''
    );

    const baseImage = sharp(framePath)
      .resize(OG_WIDTH, OG_HEIGHT, { fit: 'cover', position: 'center' });

    await baseImage
      .composite([{ input: overlay, top: 0, left: 0 }])
      .jpeg({ quality: 85 })
      .toFile(ogJpgPath);

    // WebP version
    await sharp(ogJpgPath).webp({ quality: 80 }).toFile(ogWebpPath);
  } else {
    // No frame available — create a branded placeholder
    const overlay = createOverlaySVG(
      restaurant?.name || video.restaurantSlug || 'Restaurant Review',
      restaurant?.google?.rating,
      video.city || ''
    );

    // Dark background with overlay
    await sharp({
      create: {
        width: OG_WIDTH,
        height: OG_HEIGHT,
        channels: 4,
        background: { r: 20, g: 20, b: 20, alpha: 1 },
      },
    })
      .composite([{ input: overlay, top: 0, left: 0 }])
      .jpeg({ quality: 85 })
      .toFile(ogJpgPath);

    await sharp(ogJpgPath).webp({ quality: 80 }).toFile(ogWebpPath);
  }

  log(`${video.videoId}: Generated OG images`);
}

// ---- Main ----

async function main() {
  log('=== OG Image Generator ===');

  const videos = JSON.parse(readFileSync(resolve(DATA_DIR, 'videos.json'), 'utf-8'));
  const restaurants = JSON.parse(
    readFileSync(resolve(DATA_DIR, 'restaurants.json'), 'utf-8')
  );

  log(`Processing ${videos.length} videos`);

  for (const video of videos) {
    const restaurant = restaurants[video.restaurantSlug];
    try {
      await generateOGImage(video, restaurant);
    } catch (e) {
      log(`${video.videoId}: Error - ${e.message}`);
    }
  }

  log('Complete');
}

main().catch((e) => {
  log(`Fatal error: ${e.message}`);
  process.exit(1);
});
