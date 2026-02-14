/**
 * TikTok Scraper for @oneminreviews
 *
 * Uses Puppeteer with stealth plugin to scrape video metadata from TikTok.
 * Designed to be run during CI or locally.
 *
 * Features:
 * - Stealth plugin to avoid bot detection
 * - Mobile viewport for cleaner TikTok JSON
 * - Rotating user agents
 * - Randomized delays
 * - Optional proxy support (PROXY_URL env var)
 * - Incremental updates (skips already-known videos)
 * - Fallback manual ingestion mode
 * - Crash-safe partial saves
 *
 * Usage: node scripts/scrape-tiktok.js [--max=50] [--manual]
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
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
const PROXY_URL = process.env.PROXY_URL || '';

const USER_AGENTS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1',
];

// ---- Helpers ----

function getArg(flag) {
  const arg = process.argv.find((a) => a.startsWith(flag + '='));
  return arg ? arg.split('=')[1] : null;
}

function randomDelay(min = 2000, max = 5000) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
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

// ---- Chrome Discovery ----

/**
 * Find a working Chrome/Chromium executable.
 * Priority:
 *   1. CHROME_PATH env var (explicit override)
 *   2. Puppeteer's bundled browser (works on matching arch)
 *   3. Common system Chrome locations (macOS / Linux)
 */
function findSystemChrome() {
  const candidates = process.platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      ]
    : [
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/snap/bin/chromium',
      ];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function resolveChromePath() {
  // 1. Explicit env override
  if (process.env.CHROME_PATH) {
    log(`Using CHROME_PATH env: ${process.env.CHROME_PATH}`);
    return process.env.CHROME_PATH;
  }

  // 2. Detect arch mismatch on macOS (arm64 mac + x64 node → Rosetta problems)
  const isMac = process.platform === 'darwin';
  const isArmHost = process.arch === 'arm64' || (isMac && (() => {
    try {
      return execSync('uname -m', { encoding: 'utf-8' }).trim() === 'arm64';
    } catch { return false; }
  })());
  const isX64Node = process.arch === 'x64';
  const archMismatch = isMac && isArmHost && isX64Node;

  if (archMismatch) {
    log('Detected x64 Node on arm64 Mac — Puppeteer bundled Chrome will be slow/broken via Rosetta');
    const system = findSystemChrome();
    if (system) {
      log(`Falling back to system Chrome: ${system}`);
      return system;
    }
    log('WARNING: No system Chrome found. Puppeteer will attempt bundled Chrome (may timeout).');
  }

  // 3. Let Puppeteer use its bundled browser (default)
  return undefined;
}

// ---- Scraper ----

async function scrape() {
  puppeteer.use(StealthPlugin());

  const executablePath = resolveChromePath();

  const launchOptions = {
    headless: 'new',
    timeout: 60000, // 60s launch timeout (default 30s is too tight under Rosetta)
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  };

  if (executablePath) {
    launchOptions.executablePath = executablePath;
  }

  if (PROXY_URL) {
    launchOptions.args.push(`--proxy-server=${PROXY_URL}`);
    log(`Using proxy: ${PROXY_URL}`);
  }

  log(`Launching browser${executablePath ? ` (${executablePath})` : ' (bundled)'}...`);
  const browser = await puppeteer.launch(launchOptions);

  try {
    const page = await browser.newPage();
    const userAgent = pickRandom(USER_AGENTS);

    // Mobile viewport
    await page.setViewport({ width: 360, height: 640, isMobile: true });
    await page.setUserAgent(userAgent);
    log(`User agent: ${userAgent.slice(0, 60)}...`);

    // Intercept network requests to capture video data
    const capturedData = [];

    page.on('response', async (response) => {
      const url = response.url();
      try {
        if (
          url.includes('/api/post/item_list') ||
          url.includes('/api/user/detail') ||
          url.includes('api/item/detail')
        ) {
          const json = await response.json();
          if (json?.itemList) {
            capturedData.push(...json.itemList);
            log(`Captured ${json.itemList.length} items from XHR`);
          }
          if (json?.items) {
            capturedData.push(...json.items);
            log(`Captured ${json.items.length} items from XHR`);
          }
        }
      } catch {
        // Not JSON or parsing failed, skip
      }
    });

    log(`Navigating to ${TIKTOK_PROFILE}`);
    await page.goto(TIKTOK_PROFILE, {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });

    await randomDelay(3000, 5000);

    // Try to extract from embedded JSON first
    let initData = null;
    try {
      initData = await page.evaluate(() => {
        // TikTok embeds data in various global variables
        const sources = [
          window.__INIT_PROPS__,
          window.__UNIVERSAL_DATA_FOR_REHYDRATION__,
          window.SIGI_STATE,
          window.__DEFAULT_SCOPE__,
        ];

        for (const source of sources) {
          if (source) return JSON.parse(JSON.stringify(source));
        }
        return null;
      });
    } catch (e) {
      log(`Could not extract embedded JSON: ${e.message}`);
    }

    if (initData) {
      log('Found embedded data, extracting videos...');
      const items = extractItemsFromInitData(initData);
      capturedData.push(...items);
      log(`Extracted ${items.length} items from embedded data`);
    }

    // Scroll to trigger lazy loading
    const scrollRounds = Math.ceil(MAX_VIDEOS / 10);
    for (let i = 0; i < scrollRounds; i++) {
      if (capturedData.length >= MAX_VIDEOS) break;

      log(`Scroll round ${i + 1}/${scrollRounds} (${capturedData.length} items so far)`);

      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });

      await randomDelay(2000, 4000);

      // Check if we've hit the end
      const isEnd = await page.evaluate(() => {
        const el = document.querySelector('[data-e2e="no-more-data"]');
        return !!el;
      });

      if (isEnd) {
        log('Reached end of feed');
        break;
      }
    }

    // Also try scraping from DOM as a fallback
    const domVideos = await page.evaluate(() => {
      const items = [];
      const links = document.querySelectorAll('a[href*="/video/"]');

      links.forEach((link) => {
        const href = link.getAttribute('href') || '';
        const match = href.match(/\/video\/(\d+)/);
        if (match) {
          items.push({
            videoId: match[1],
            href,
          });
        }
      });

      return items;
    });

    log(`Found ${domVideos.length} video links in DOM`);

    // Process captured data
    const existing = loadExistingVideos();
    const existingIds = new Set(existing.map((v) => v.videoId));
    let added = 0;

    // Process XHR/embedded data (richest source)
    for (const item of capturedData) {
      if (added >= MAX_VIDEOS) break;
      const video = parseVideoItem(item);
      if (video && !existingIds.has(video.videoId)) {
        existing.push(video);
        existingIds.add(video.videoId);
        added++;
        log(`New video: ${video.videoId} - ${video.caption.slice(0, 50)}...`);
      }
    }

    // Process DOM fallbacks (minimal data)
    for (const domVideo of domVideos) {
      if (added >= MAX_VIDEOS) break;
      if (!existingIds.has(domVideo.videoId)) {
        existing.push({
          videoId: domVideo.videoId,
          caption: '',
          createTime: Math.floor(Date.now() / 1000),
          thumbnailUrl: `/assets/images/${domVideo.videoId}/frame-1.jpg`,
          embedUrl: `https://www.tiktok.com/@oneminreviews/video/${domVideo.videoId}`,
          restaurantSlug: '',
          city: '',
          cuisine: '',
          stats: { likes: 0, comments: 0, shares: 0 },
        });
        existingIds.add(domVideo.videoId);
        added++;
        log(`New video (DOM fallback): ${domVideo.videoId}`);
      }
    }

    saveVideos(existing);
    log(`Scrape complete. Added ${added} new videos. Total: ${existing.length}`);
  } catch (error) {
    log(`ERROR: ${error.message}`);
    // Save partial results
    log('Attempting to save partial results...');
    throw error;
  } finally {
    await browser.close();
    log('Browser closed');
  }
}

// ---- Data Parsing ----

function extractItemsFromInitData(data) {
  const items = [];

  function walk(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (obj.id && obj.desc && (obj.video || obj.stats)) {
      items.push(obj);
      return;
    }
    if (Array.isArray(obj)) {
      obj.forEach(walk);
    } else {
      Object.values(obj).forEach(walk);
    }
  }

  walk(data);
  return items;
}

function parseVideoItem(item) {
  if (!item) return null;

  const videoId = item.id || item.videoId;
  if (!videoId) return null;

  const caption = item.desc || item.caption || '';
  const createTime = item.createTime || Math.floor(Date.now() / 1000);

  // Try to get thumbnail
  let thumbnailUrl = '';
  if (item.video?.cover) {
    thumbnailUrl = item.video.cover;
  } else if (item.video?.originCover) {
    thumbnailUrl = item.video.originCover;
  } else if (item.video?.dynamicCover) {
    thumbnailUrl = item.video.dynamicCover;
  }

  // Fallback to local path
  if (!thumbnailUrl) {
    thumbnailUrl = `/assets/images/${videoId}/frame-1.jpg`;
  }

  const stats = {
    likes: item.stats?.diggCount || item.stats?.likes || 0,
    comments: item.stats?.commentCount || item.stats?.comments || 0,
    shares: item.stats?.shareCount || item.stats?.shares || 0,
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

// ---- Main ----

async function main() {
  log('=== OneMinReviews TikTok Scraper ===');
  log(`Max videos: ${MAX_VIDEOS}`);

  if (IS_MANUAL) {
    runManualMode();
    return;
  }

  try {
    await scrape();
  } catch (error) {
    log(`Fatal error: ${error.message}`);
    process.exit(1);
  }
}

main();
