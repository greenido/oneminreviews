/**
 * Video Transcription & Blog Post Pipeline
 *
 * For each video in videos.json:
 * 1. Check for MP4 in assets/videos/
 * 2. Extract audio via FFmpeg
 * 3. Transcribe audio via OpenAI Whisper API
 * 4. Generate a blog-post-style review via GPT
 * 5. Save results to data/blog-posts.json
 *
 * Requires: FFmpeg installed, OPENAI_API_KEY env variable
 * Usage:    node scripts/transcribe-videos.js
 * Env:      OPENAI_API_KEY  — required
 *           TRANSCRIBE_MAX  — max videos to process (default: all)
 *           TRANSCRIBE_MODEL — GPT model for blog generation (default: gpt-4o-mini)
 */

import { execSync } from 'child_process';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
} from 'fs';
import { readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ---- Load .env file (no external dependencies) ----
const envPath = resolve(ROOT, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val; // don't override existing
  }
}
const DATA_DIR = resolve(ROOT, 'data');
const VIDEOS_DIR = resolve(ROOT, 'assets/videos');
const AUDIO_TMP_DIR = resolve(ROOT, 'tmp/audio');
const BLOG_POSTS_PATH = resolve(DATA_DIR, 'blog-posts.json');

// ---- Config ----

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TRANSCRIBE_MAX = parseInt(process.env.TRANSCRIBE_MAX || '0', 10) || Infinity;
const GPT_MODEL = process.env.TRANSCRIBE_MODEL || 'gpt-4o-mini';
const WHISPER_MODEL = 'whisper-1';
const OPENAI_BASE = 'https://api.openai.com/v1';

// ---- Helpers ----

function log(msg) {
  console.log(`[transcribe] ${msg}`);
}

function warn(msg) {
  console.warn(`[transcribe] WARN: ${msg}`);
}

function ffmpegAvailable() {
  try {
    execSync('ffmpeg -version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Download a TikTok video via yt-dlp when no local MP4 exists.
 * Returns the path to the downloaded file, or null on failure.
 */
function downloadVideo(embedUrl, outputPath) {
  try {
    log(`  Downloading video via yt-dlp...`);
    execSync(
      `yt-dlp -f "mp4" --no-playlist --no-warnings -o "${outputPath}" "${embedUrl}"`,
      { stdio: 'pipe', timeout: 120_000 }
    );
    if (existsSync(outputPath)) {
      log(`  Downloaded OK`);
      return outputPath;
    }
    return null;
  } catch (err) {
    warn(`  yt-dlp download failed: ${err.message?.split('\n')[0]}`);
    return null;
  }
}

/** Extract audio from video as MP3 (small, Whisper-compatible). */
function extractAudio(videoPath, outputPath) {
  execSync(
    `ffmpeg -i "${videoPath}" -vn -acodec libmp3lame -ar 16000 -ac 1 -q:a 6 "${outputPath}" -y`,
    { stdio: 'pipe' }
  );
}

/** Call OpenAI Whisper API to transcribe an audio file. */
async function transcribeAudio(audioPath) {
  const audioBuffer = await readFile(audioPath);
  const formData = new FormData();
  formData.append('model', WHISPER_MODEL);
  formData.append('language', 'en');
  formData.append('response_format', 'verbose_json');
  formData.append(
    'file',
    new Blob([audioBuffer], { type: 'audio/mpeg' }),
    'audio.mp3'
  );

  const res = await fetch(`${OPENAI_BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: formData,
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Whisper API error ${res.status}: ${errBody}`);
  }

  const data = await res.json();
  return {
    text: data.text,
    duration: data.duration ?? null,
    segments: data.segments ?? [],
  };
}

/**
 * Generate a blog post from caption + metadata only (no transcript).
 * Used as fallback when video can't be downloaded / transcribed.
 */
async function generateBlogPostFromCaption(video, restaurant) {
  const ratingInfo = restaurant?.google?.rating
    ? `Google Rating: ${restaurant.google.rating}/5 (${restaurant.google.reviewCount?.toLocaleString()} reviews)`
    : 'No Google rating available';

  const yelpInfo =
    restaurant?.yelp?.rating && restaurant.yelp.rating > 0
      ? `Yelp Rating: ${restaurant.yelp.rating}/5`
      : '';

  const prompt = `You are a food blogger writing for @oneminreviews — a TikTok channel that posts honest, unsponsored one-minute restaurant video reviews.

Based on the video caption and restaurant details below, write an engaging blog-post-style review.
Note: You do NOT have a transcript, so write based on the caption, restaurant info, and your knowledge of the restaurant.

## Restaurant Details
- Name: ${restaurant?.name ?? 'Unknown Restaurant'}
- City: ${video.city || 'Unknown'}${restaurant?.state ? `, ${restaurant.state}` : ''}
- Cuisine: ${video.cuisine || restaurant?.cuisine || 'Unknown'}
- Address: ${restaurant?.address || 'Not available'}
- ${ratingInfo}
${yelpInfo ? `- ${yelpInfo}` : ''}

## Video Info
- Caption: ${video.caption}
- Posted: ${new Date(video.createTime * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
- Engagement: ${video.stats?.likes?.toLocaleString() ?? 0} likes, ${video.stats?.comments?.toLocaleString() ?? 0} comments

## Instructions
Write a blog post that:
1. Has a catchy, SEO-friendly title (don't just repeat the restaurant name)
2. Opens with a hook that draws readers in
3. Describes the food, atmosphere, and overall experience based on the caption and your knowledge
4. Includes a clear verdict/recommendation
5. Ends with practical visiting info (location, cuisine type)
6. Uses a conversational, authentic tone — like talking to a friend
7. Is 300-500 words long
8. Includes 2-3 relevant subheadings (use ## for h2)

Return ONLY valid JSON with this exact structure (no markdown code fences):
{
  "title": "Blog post title here",
  "summary": "A 1-2 sentence summary for previews/SEO (max 160 chars)",
  "content": "Full blog post content in Markdown format"
}`;

  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GPT_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 1500,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Chat API error ${res.status}: ${errBody}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error('Empty response from Chat API');

  const cleaned = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    warn('Failed to parse GPT JSON response (caption fallback), using raw text');
    return {
      title: `${restaurant?.name ?? 'Restaurant'} Review — @oneminreviews`,
      summary: video.caption.slice(0, 160),
      content: raw,
    };
  }
}

/** Call OpenAI Chat API to generate a blog post from transcript + metadata. */
async function generateBlogPost(transcript, video, restaurant) {
  const ratingInfo = restaurant?.google?.rating
    ? `Google Rating: ${restaurant.google.rating}/5 (${restaurant.google.reviewCount?.toLocaleString()} reviews)`
    : 'No Google rating available';

  const yelpInfo =
    restaurant?.yelp?.rating && restaurant.yelp.rating > 0
      ? `Yelp Rating: ${restaurant.yelp.rating}/5`
      : '';

  const prompt = `You are a food blogger writing for @oneminreviews — a TikTok channel that posts honest, unsponsored one-minute restaurant video reviews.

Based on the video transcript and restaurant details below, write an engaging blog-post-style review.

## Restaurant Details
- Name: ${restaurant?.name ?? 'Unknown Restaurant'}
- City: ${video.city || 'Unknown'}${restaurant?.state ? `, ${restaurant.state}` : ''}
- Cuisine: ${video.cuisine || restaurant?.cuisine || 'Unknown'}
- Address: ${restaurant?.address || 'Not available'}
- ${ratingInfo}
${yelpInfo ? `- ${yelpInfo}` : ''}

## Video Info
- Caption: ${video.caption}
- Posted: ${new Date(video.createTime * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
- Engagement: ${video.stats?.likes?.toLocaleString() ?? 0} likes, ${video.stats?.comments?.toLocaleString() ?? 0} comments

## Video Transcript
${transcript}

## Instructions
Write a blog post that:
1. Has a catchy, SEO-friendly title (don't just repeat the restaurant name)
2. Opens with a hook that draws readers in
3. Describes the food, atmosphere, and overall experience based on what was said in the video
4. Includes a clear verdict/recommendation
5. Ends with practical visiting info (location, cuisine type)
6. Uses a conversational, authentic tone — like talking to a friend
7. Is 300-500 words long
8. Includes 2-3 relevant subheadings (use ## for h2)

Return ONLY valid JSON with this exact structure (no markdown code fences):
{
  "title": "Blog post title here",
  "summary": "A 1-2 sentence summary for previews/SEO (max 160 chars)",
  "content": "Full blog post content in Markdown format"
}`;

  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GPT_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 1500,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Chat API error ${res.status}: ${errBody}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content?.trim();

  if (!raw) throw new Error('Empty response from Chat API');

  // Parse the JSON response (strip markdown fences if present)
  const cleaned = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');

  try {
    return JSON.parse(cleaned);
  } catch {
    // If JSON parsing fails, create a structured response from raw text
    warn('Failed to parse GPT JSON response, using raw text');
    return {
      title: `${restaurant?.name ?? 'Restaurant'} Review — @oneminreviews`,
      summary: video.caption.slice(0, 160),
      content: raw,
    };
  }
}

// ---- Slug Helper ----

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ---- Main ----

async function main() {
  log('=== Video Transcription & Blog Post Pipeline ===');

  // Validate prerequisites
  if (!OPENAI_API_KEY) {
    log('ERROR: OPENAI_API_KEY environment variable is required.');
    log('Set it in .env or export it: export OPENAI_API_KEY=sk-...');
    process.exit(1);
  }

  if (!ffmpegAvailable()) {
    log('ERROR: FFmpeg is not installed or not in PATH.');
    log('Install FFmpeg: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)');
    process.exit(1);
  }

  // Load data
  const videos = JSON.parse(readFileSync(resolve(DATA_DIR, 'videos.json'), 'utf-8'));
  const restaurants = existsSync(resolve(DATA_DIR, 'restaurants.json'))
    ? JSON.parse(readFileSync(resolve(DATA_DIR, 'restaurants.json'), 'utf-8'))
    : {};

  // Load existing blog posts (or start fresh)
  let blogPosts = {};
  if (existsSync(BLOG_POSTS_PATH)) {
    try {
      blogPosts = JSON.parse(readFileSync(BLOG_POSTS_PATH, 'utf-8'));
      log(`Loaded ${Object.keys(blogPosts).length} existing blog posts`);
    } catch {
      warn('Could not parse existing blog-posts.json, starting fresh');
    }
  }

  // Ensure temp audio directory exists
  if (!existsSync(AUDIO_TMP_DIR)) mkdirSync(AUDIO_TMP_DIR, { recursive: true });

  log(`Found ${videos.length} videos, processing up to ${TRANSCRIBE_MAX === Infinity ? 'all' : TRANSCRIBE_MAX}`);

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const video of videos) {
    if (processed >= TRANSCRIBE_MAX) break;

    const { videoId } = video;

    // Skip already-transcribed videos
    if (blogPosts[videoId]) {
      log(`${videoId}: Already transcribed, skipping`);
      skipped++;
      continue;
    }

    // Check for MP4 file — try downloading if not present
    const videoPath = resolve(VIDEOS_DIR, `${videoId}.mp4`);
    let downloaded = false;
    if (!existsSync(videoPath)) {
      if (video.embedUrl) {
        const result = downloadVideo(video.embedUrl, videoPath);
        if (result) {
          downloaded = true;
        }
      }
    }

    const hasVideo = existsSync(videoPath);
    const restaurant = restaurants[video.restaurantSlug] || null;

    log(`\nProcessing ${videoId}...${hasVideo ? '' : ' (caption-only mode)'}`);
    const audioPath = resolve(AUDIO_TMP_DIR, `${videoId}.mp3`);

    try {
      let transcriptionText = null;
      let transcriptionDuration = null;
      let blogPost;
      let usedCaption = false;

      if (hasVideo) {
        // ---- Full pipeline: extract audio → Whisper → GPT ----
        try {
          // Step 1: Extract audio
          log(`  Extracting audio...`);
          extractAudio(videoPath, audioPath);

          // Step 2: Transcribe with Whisper
          log(`  Transcribing with Whisper...`);
          const transcription = await transcribeAudio(audioPath);
          transcriptionText = transcription.text;
          transcriptionDuration = transcription.duration;
          log(`  Transcript: "${transcriptionText.slice(0, 80)}..."`);

          // Step 3: Generate blog post with GPT (from transcript)
          log(`  Generating blog post with ${GPT_MODEL}...`);
          blogPost = await generateBlogPost(
            transcriptionText,
            video,
            restaurant
          );
        } catch (audioErr) {
          // Video has no audio stream or extraction failed — fall back to caption
          warn(`  Audio extraction/transcription failed: ${audioErr.message?.split('\n')[0]}`);
          log(`  Falling back to caption-only mode...`);
          usedCaption = true;
        }
      }

      if (!hasVideo || usedCaption) {
        // ---- Fallback: generate blog post from caption only ----
        log(`  No audio available — generating from caption + metadata...`);
        log(`  Generating blog post with ${GPT_MODEL} (caption mode)...`);
        blogPost = await generateBlogPostFromCaption(video, restaurant);
      }

      log(`  Title: "${blogPost.title}"`);

      // Step 4: Store result
      const slug = `${video.restaurantSlug || slugify(video.caption.slice(0, 40))}-review-${videoId}`;

      blogPosts[videoId] = {
        videoId,
        slug,
        restaurantSlug: video.restaurantSlug || '',
        restaurantName: restaurant?.name ?? '',
        city: video.city || '',
        cuisine: video.cuisine || '',
        title: blogPost.title,
        summary: blogPost.summary,
        content: blogPost.content,
        transcript: transcriptionText || '',
        transcriptDuration: transcriptionDuration,
        source: (hasVideo && !usedCaption) ? 'transcription' : 'caption',
        thumbnailUrl: video.thumbnailUrl || '',
        embedUrl: video.embedUrl || '',
        createTime: video.createTime,
        generatedAt: new Date().toISOString(),
      };

      processed++;
      log(`  Done (${processed} processed so far)`);
    } catch (err) {
      warn(`Failed to process ${videoId}: ${err.message}`);
      errors++;
    } finally {
      // Clean up temp audio file
      try {
        if (existsSync(audioPath)) unlinkSync(audioPath);
      } catch { /* ignore cleanup errors */ }
      // Clean up downloaded video to save disk space (optional — keep if you want cache)
      if (downloaded && existsSync(videoPath)) {
        try { unlinkSync(videoPath); } catch { /* ignore */ }
      }
    }
  }

  // Write results
  writeFileSync(BLOG_POSTS_PATH, JSON.stringify(blogPosts, null, 2));
  log(`\nSaved ${Object.keys(blogPosts).length} blog posts to data/blog-posts.json`);

  // Summary
  log('\n=== Summary ===');
  log(`Processed: ${processed}`);
  log(`Skipped:   ${skipped}`);
  log(`Errors:    ${errors}`);
  log(`Total:     ${Object.keys(blogPosts).length} blog posts`);

  // Clean up tmp dir if empty
  try {
    const { readdirSync } = await import('fs');
    if (readdirSync(AUDIO_TMP_DIR).length === 0) {
      const { rmdirSync } = await import('fs');
      rmdirSync(AUDIO_TMP_DIR);
    }
  } catch { /* ignore */ }
}

main().catch((e) => {
  log(`Fatal error: ${e.message}`);
  process.exit(1);
});
