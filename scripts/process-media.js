/**
 * Media Processing Pipeline
 *
 * For each video in videos.json:
 * 1. Extract keyframes at 10%, 30%, 60%, 85% of duration
 * 2. Extract sharpest frame via scene detection
 * 3. Convert all frames to WebP
 * 4. Skip already-processed videos (idempotent)
 *
 * Requires: FFmpeg installed on the system
 * Usage: node scripts/process-media.js
 */

import { execSync, exec } from 'child_process';
import { readFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DATA_DIR = resolve(ROOT, 'data');
const VIDEOS_DIR = resolve(ROOT, 'assets/videos');
const IMAGES_DIR = resolve(ROOT, 'assets/images');

// ---- Config ----

const KEYFRAME_POSITIONS = [0.1, 0.3, 0.6, 0.85]; // 10%, 30%, 60%, 85%
const SCENE_THRESHOLD = 0.4;
const MAX_WIDTH = 1200;

// ---- Helpers ----

function log(msg) {
  console.log(`[process-media] ${msg}`);
}

function execPromise(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
  });
}

function ffmpegAvailable() {
  try {
    execSync('ffmpeg -version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function getVideoDuration(videoPath) {
  try {
    const result = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${videoPath}"`,
      { encoding: 'utf-8' }
    ).trim();
    return parseFloat(result);
  } catch {
    return 0;
  }
}

// ---- Frame Extraction ----

async function extractKeyframes(videoPath, videoId) {
  const outputDir = resolve(IMAGES_DIR, videoId);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const duration = getVideoDuration(videoPath);
  if (duration <= 0) {
    log(`  Could not determine duration for ${videoId}, skipping keyframes`);
    return;
  }

  log(`  Duration: ${duration.toFixed(1)}s`);

  // Extract frames at percentage positions
  for (let i = 0; i < KEYFRAME_POSITIONS.length; i++) {
    const position = KEYFRAME_POSITIONS[i];
    const timestamp = duration * position;
    const outputPath = resolve(outputDir, `frame-${i + 1}.jpg`);

    if (existsSync(outputPath)) {
      log(`  frame-${i + 1}.jpg already exists, skipping`);
      continue;
    }

    try {
      await execPromise(
        `ffmpeg -ss ${timestamp.toFixed(2)} -i "${videoPath}" -vframes 1 -q:v 2 -vf "scale='min(${MAX_WIDTH},iw)':-1" "${outputPath}" -y`
      );
      log(`  Extracted frame-${i + 1}.jpg at ${(position * 100).toFixed(0)}%`);
    } catch (e) {
      log(`  Failed to extract frame-${i + 1}: ${e.message}`);
    }
  }

  // Scene detection for sharpest frame
  const sceneFramePath = resolve(outputDir, 'scene-best.jpg');
  if (!existsSync(sceneFramePath)) {
    try {
      await execPromise(
        `ffmpeg -i "${videoPath}" -vf "select='gt(scene,${SCENE_THRESHOLD})',scale='min(${MAX_WIDTH},iw)':-1" -vframes 1 -q:v 2 "${sceneFramePath}" -y`
      );
      log(`  Extracted scene-best.jpg`);
    } catch (e) {
      log(`  Scene detection failed: ${e.message}`);
    }
  }
}

// ---- WebP Conversion ----

async function convertToWebP(videoId) {
  const imageDir = resolve(IMAGES_DIR, videoId);
  if (!existsSync(imageDir)) return;

  const jpgFiles = readdirSync(imageDir).filter((f) => f.endsWith('.jpg'));

  for (const jpg of jpgFiles) {
    const webpPath = resolve(imageDir, jpg.replace('.jpg', '.webp'));
    if (existsSync(webpPath)) continue;

    const jpgPath = resolve(imageDir, jpg);
    try {
      await execPromise(
        `ffmpeg -i "${jpgPath}" -vf "scale='min(${MAX_WIDTH},iw)':-1" -quality 80 "${webpPath}" -y`
      );
      log(`  Converted ${jpg} to WebP`);
    } catch (e) {
      log(`  WebP conversion failed for ${jpg}: ${e.message}`);
    }
  }
}

// ---- Main ----

async function main() {
  log('=== Media Processing Pipeline ===');

  if (!ffmpegAvailable()) {
    log('ERROR: FFmpeg is not installed or not in PATH.');
    log('Install FFmpeg: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)');
    process.exit(1);
  }

  const videos = JSON.parse(readFileSync(resolve(DATA_DIR, 'videos.json'), 'utf-8'));
  log(`Processing ${videos.length} videos`);

  let processed = 0;
  let skipped = 0;

  for (const video of videos) {
    const videoPath = resolve(VIDEOS_DIR, `${video.videoId}.mp4`);
    const imageDir = resolve(IMAGES_DIR, video.videoId);

    // Check if video file exists
    if (!existsSync(videoPath)) {
      // Check if images already exist (from previous run or manual placement)
      if (existsSync(imageDir) && readdirSync(imageDir).length >= 4) {
        log(`${video.videoId}: Images exist, skipping`);
        skipped++;
        continue;
      }
      log(`${video.videoId}: No MP4 found at ${videoPath}, skipping`);
      skipped++;
      continue;
    }

    log(`Processing ${video.videoId}...`);

    // Extract keyframes
    await extractKeyframes(videoPath, video.videoId);

    // Convert to WebP
    await convertToWebP(video.videoId);

    processed++;
  }

  log(`\nComplete. Processed: ${processed}, Skipped: ${skipped}`);
}

main().catch((e) => {
  log(`Fatal error: ${e.message}`);
  process.exit(1);
});
