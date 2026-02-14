/**
 * TikTok Scraper for @oneminreviews
 *
 * Uses yt-dlp to fetch video metadata from a TikTok profile.
 * No browser required — fast, reliable, and hard to block.
 *
 * Features:
 * - yt-dlp based (no headless browser)
 * - Incremental updates (skips already-known videos)
 * - Fallback manual ingestion mode
 * - Crash-safe partial saves
 *
 * Prerequisites: yt-dlp must be installed (brew install yt-dlp)
 *
 * Usage: node scripts/scrape-tiktok.js [--max=50] [--manual]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DATA_DIR = resolve(ROOT, 'data');
const VIDEOS_PATH = resolve(DATA_DIR, 'videos.json');
const MANUAL_PATH = resolve(DATA_DIR, 'manual-videos.json');
const LOG_DIR = resolve(ROOT, 'logs');

// ---- Config ----

const TIKTOK_PROFILE = 'https://www.tiktok.com/@oneminreviews';
const MAX_VIDEOS = parseInt(getArg('--max') || process.env.SCRAPE_MAX || '50', 10);
const IS_MANUAL = process.argv.includes('--manual');

// ---- Helpers ----

function getArg(flag) {
  const arg = process.argv.find((a) => a.startsWith(flag + '='));
  return arg ? arg.split('=')[1] : null;
}

function log(msg) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}`;
  console.log(line);
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    writeFileSync(
      resolve(LOG_DIR, 'scrape.log'),
      line + '\n',
      { flag: 'a' }
    );
  } catch (e) {
    // Logging failure is non-fatal
  }
}

function loadExistingVideos() {
  if (!existsSync(VIDEOS_PATH)) return [];
  try {
    return JSON.parse(readFileSync(VIDEOS_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function saveVideos(videos) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(VIDEOS_PATH, JSON.stringify(videos, null, 2));
  log(`Saved ${videos.length} videos to ${VIDEOS_PATH}`);
}

// ---- Manual Mode ----

function runManualMode() {
  log('Running in manual ingestion mode');

  if (!existsSync(MANUAL_PATH)) {
    log(`No manual-videos.json found at ${MANUAL_PATH}`);
    log('Create data/manual-videos.json with an array of video objects to use manual mode.');
    process.exit(0);
  }

  const manualVideos = JSON.parse(readFileSync(MANUAL_PATH, 'utf-8'));
  const existing = loadExistingVideos();
  const existingIds = new Set(existing.map((v) => v.videoId));

  let added = 0;
  for (const video of manualVideos) {
    if (!existingIds.has(video.videoId)) {
      existing.push(video);
      existingIds.add(video.videoId);
      added++;
      log(`Added manual video: ${video.videoId}`);
    }
  }

  saveVideos(existing);
  log(`Manual mode complete. Added ${added} new videos.`);
}

// ---- yt-dlp Fetcher ----

/**
 * Check that yt-dlp is available on the system.
 */
function ensureYtDlp() {
  try {
    const version = execSync('yt-dlp --version', { encoding: 'utf-8' }).trim();
    log(`yt-dlp version: ${version}`);
    return true;
  } catch {
    log('ERROR: yt-dlp is not installed.');
    log('Install it with:  brew install yt-dlp  (macOS)');
    log('              or:  pip install yt-dlp');
    log('              or:  https://github.com/yt-dlp/yt-dlp#installation');
    return false;
  }
}

/**
 * Fetch video metadata from TikTok profile using yt-dlp.
 * Returns an array of raw yt-dlp JSON objects.
 */
function fetchVideosWithYtDlp(maxCount) {
  log(`Fetching up to ${maxCount} videos from ${TIKTOK_PROFILE}...`);

  // --flat-playlist: only metadata, don't download videos
  // --dump-json: output one JSON object per line
  // --playlist-items: limit how many videos to fetch (1-based, inclusive range)
  const cmd = [
    'yt-dlp',
    '--dump-json',
    '--flat-playlist',
    `--playlist-items 1:${maxCount}`,
    '--no-warnings',
    `"${TIKTOK_PROFILE}"`,
  ].join(' ');

  log(`Running: ${cmd}`);

  const raw = execSync(cmd, {
    encoding: 'utf-8',
    maxBuffer: 100 * 1024 * 1024, // 100 MB buffer for large playlists
    timeout: 120000, // 2 minute timeout
  });

  const lines = raw.trim().split('\n').filter(Boolean);
  const items = [];

  for (const line of lines) {
    try {
      items.push(JSON.parse(line));
    } catch (e) {
      log(`Warning: Could not parse yt-dlp JSON line: ${e.message}`);
    }
  }

  log(`yt-dlp returned ${items.length} videos`);
  return items;
}

// ---- Data Parsing ----

/**
 * Convert a yt-dlp JSON object into our video schema.
 */
function parseYtDlpItem(item) {
  if (!item || !item.id) return null;

  const videoId = item.id;

  // yt-dlp uses "title" for the short title, "description" for the full caption
  const caption = item.description || item.title || '';

  // yt-dlp provides "timestamp" (unix epoch) or "upload_date" (YYYYMMDD)
  let createTime;
  if (item.timestamp) {
    createTime = item.timestamp;
  } else if (item.upload_date) {
    const d = item.upload_date;
    createTime = Math.floor(
      new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`).getTime() / 1000
    );
  } else {
    createTime = Math.floor(Date.now() / 1000);
  }

  // Pick the best thumbnail — prefer originCover, then cover, then first available
  let thumbnailUrl = '';
  if (item.thumbnails && item.thumbnails.length > 0) {
    const origin = item.thumbnails.find((t) => t.id === 'originCover');
    const cover = item.thumbnails.find((t) => t.id === 'cover');
    thumbnailUrl = (origin || cover || item.thumbnails[0]).url || '';
  }

  // Fallback to local path if no remote thumbnail
  if (!thumbnailUrl) {
    thumbnailUrl = `/assets/images/${videoId}/frame-1.jpg`;
  }

  const stats = {
    likes: item.like_count || 0,
    comments: item.comment_count || 0,
    shares: item.repost_count || 0,
  };

  return {
    videoId,
    caption,
    createTime,
    thumbnailUrl,
    embedUrl: `https://www.tiktok.com/@oneminreviews/video/${videoId}`,
    restaurantSlug: '', // Will be filled by enrichment pipeline
    city: '',
    cuisine: '',
    stats,
  };
}

// ---- Scraper ----

function scrape() {
  if (!ensureYtDlp()) {
    process.exit(1);
  }

  let ytDlpItems;
  try {
    ytDlpItems = fetchVideosWithYtDlp(MAX_VIDEOS);
  } catch (error) {
    log(`ERROR fetching videos: ${error.message}`);
    if (error.stderr) {
      log(`yt-dlp stderr: ${error.stderr.toString().slice(0, 500)}`);
    }
    throw error;
  }

  if (ytDlpItems.length === 0) {
    log('No videos returned by yt-dlp. The profile may be empty or yt-dlp may need updating.');
    log('Try running: yt-dlp --update');
    return;
  }

  const existing = loadExistingVideos();
  const existingIds = new Set(existing.map((v) => v.videoId));
  let added = 0;
  let updated = 0;

  for (const item of ytDlpItems) {
    const video = parseYtDlpItem(item);
    if (!video) continue;

    if (existingIds.has(video.videoId)) {
      // Update stats for existing videos (likes/comments/shares change over time)
      const idx = existing.findIndex((v) => v.videoId === video.videoId);
      if (idx !== -1) {
        existing[idx].stats = video.stats;
        // Update thumbnail if we got a better one (remote URL vs local path)
        if (video.thumbnailUrl.startsWith('http') && !existing[idx].thumbnailUrl.startsWith('http')) {
          existing[idx].thumbnailUrl = video.thumbnailUrl;
        }
        updated++;
      }
    } else {
      existing.push(video);
      existingIds.add(video.videoId);
      added++;
      log(`New video: ${video.videoId} - ${video.caption.slice(0, 60)}...`);
    }
  }

  saveVideos(existing);
  log(`Scrape complete. Added ${added} new, updated ${updated} existing. Total: ${existing.length}`);
}

// ---- Main ----

function main() {
  log('=== OneMinReviews TikTok Scraper (yt-dlp) ===');
  log(`Max videos: ${MAX_VIDEOS}`);

  if (IS_MANUAL) {
    runManualMode();
    return;
  }

  try {
    scrape();
  } catch (error) {
    log(`Fatal error: ${error.message}`);
    process.exit(1);
  }
}

main();
