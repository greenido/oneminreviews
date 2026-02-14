/**
 * Restaurant Enrichment Pipeline
 *
 * 1. NLP: Extract restaurant names from video captions
 * 2. Google Places API: Get ratings, address, reviews
 * 3. Yelp Fusion API: Get ratings, review count
 * 4. Merge everything into restaurants.json
 *
 * Graceful degradation: works without API keys, just uses NLP extraction.
 *
 * Env vars:
 *   GOOGLE_PLACES_KEY - Google Places API key
 *   YELP_API_KEY      - Yelp Fusion API key
 *
 * Usage: node scripts/enrich-restaurants.js [--dry-run] [--skip-api]
 */

import nlp from 'compromise';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DATA_DIR = resolve(ROOT, 'data');
const VIDEOS_PATH = resolve(DATA_DIR, 'videos.json');
const RESTAURANTS_PATH = resolve(DATA_DIR, 'restaurants.json');
const OVERRIDES_PATH = resolve(DATA_DIR, 'overrides.json');

const GOOGLE_PLACES_KEY = process.env.GOOGLE_PLACES_KEY || '';
const YELP_API_KEY = process.env.YELP_API_KEY || '';
const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_API = process.argv.includes('--skip-api');

// ---- Helpers ----

function log(msg) {
  console.log(`[enrich] ${msg}`);
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function loadJSON(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

// ---- NLP Restaurant Name Extraction ----

/**
 * Extract restaurant name from a TikTok caption.
 * Strategy:
 * 1. Check overrides first
 * 2. Look for patterns like "Restaurant Name in City" or "at Restaurant Name"
 * 3. Use compromise NER as fallback
 * 4. Clean up hashtags and common words
 */
function extractRestaurantName(caption, videoId, overrides) {
  // Check overrides
  if (overrides?.overrides?.[videoId]) {
    return overrides.overrides[videoId];
  }

  // Remove hashtags, emoji, and URLs
  let cleaned = caption
    .replace(/#\w+/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^\w\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Pattern: "X in City" or "at X" or "X —" or "X -"
  const patterns = [
    // "Restaurant Name in City"
    /^(.+?)\s+in\s+(?:the\s+)?(?:East\s+|West\s+|North\s+|South\s+)?[A-Z][a-z]+/,
    // "at Restaurant Name"
    /\bat\s+([A-Z][A-Za-z'\s]+?)(?:\s+[-—]|\s+is|\s+has|\s*$)/,
    // Starting with name, then dash
    /^([A-Z][A-Za-z'\s]+?)\s+[-—]/,
    // "Restaurant Name has the best..."
    /^([A-Z][A-Za-z'\s]+?)\s+has\s+the\s+best/,
    // "Is Restaurant Name worth..."
    /^Is\s+(.+?)\s+worth/,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match && match[1]) {
      const name = match[1]
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/^(Is|At|The)\s+/i, '');

      if (name.length >= 3 && name.length <= 50) {
        return name;
      }
    }
  }

  // Fallback: use compromise NER
  const doc = nlp(cleaned);

  // Try to find organization/place names
  const orgs = doc.organizations().out('array');
  if (orgs.length > 0) return orgs[0];

  const places = doc.places().out('array');
  if (places.length > 0) return places[0];

  // Last resort: take first 2-3 capitalized words
  const words = cleaned.split(/\s+/);
  const capitalizedWords = [];
  for (const word of words) {
    if (word[0] && word[0] === word[0].toUpperCase() && word.length > 1) {
      capitalizedWords.push(word);
      if (capitalizedWords.length >= 3) break;
    } else if (capitalizedWords.length > 0) {
      break;
    }
  }

  if (capitalizedWords.length > 0) {
    return capitalizedWords.join(' ');
  }

  return null;
}

/**
 * Detect city from caption using common city names and patterns.
 */
function extractCity(caption) {
  const cityPatterns = {
    'New York': /\b(?:NYC|New York|Manhattan|Brooklyn|Queens|Bronx|Staten Island)\b/i,
    'Los Angeles': /\b(?:LA|Los Angeles|Brentwood|Hollywood|Beverly Hills|Arts District)\b/i,
    Chicago: /\b(?:Chicago|Wicker Park|Lincoln Park|River North)\b/i,
    Austin: /\b(?:Austin)\b/i,
    'San Francisco': /\b(?:SF|San Francisco|Mission District)\b/i,
    Miami: /\b(?:Miami|Wynwood|South Beach)\b/i,
    Houston: /\b(?:Houston)\b/i,
    Nashville: /\b(?:Nashville)\b/i,
    Portland: /\b(?:Portland)\b/i,
    Seattle: /\b(?:Seattle)\b/i,
    Philadelphia: /\b(?:Philly|Philadelphia)\b/i,
    Dallas: /\b(?:Dallas)\b/i,
    Denver: /\b(?:Denver)\b/i,
    Atlanta: /\b(?:Atlanta|ATL)\b/i,
  };

  for (const [city, pattern] of Object.entries(cityPatterns)) {
    if (pattern.test(caption)) return city;
  }
  return '';
}

/**
 * Detect cuisine type from caption.
 */
function extractCuisine(caption) {
  const lower = caption.toLowerCase();
  const cuisineKeywords = {
    Pizza: ['pizza', 'slice', 'neapolitan', 'deep dish', 'pie'],
    BBQ: ['bbq', 'barbecue', 'brisket', 'pulled pork', 'ribs', 'smoker'],
    'Mexican': ['taco', 'burrito', 'mexican', 'torta', 'quesadilla', 'enchilada'],
    'Chinese': ['chinese', 'dim sum', 'dumpling', 'noodle', 'wonton'],
    'Japanese': ['sushi', 'ramen', 'japanese', 'izakaya', 'omakase'],
    'Italian': ['pasta', 'italian', 'risotto', 'gnocchi'],
    'Indian': ['curry', 'indian', 'naan', 'tandoori', 'biryani'],
    'Thai': ['thai', 'pad thai', 'green curry'],
    'Korean': ['korean', 'bibimbap', 'kimchi', 'kbbq'],
    'Deli': ['deli', 'pastrami', 'corned beef', 'sandwich'],
    'Burger': ['burger', 'smash burger'],
    'Seafood': ['seafood', 'lobster', 'crab', 'oyster', 'shrimp'],
    'Middle Eastern': ['shawarma', 'falafel', 'hummus', 'middle eastern', 'kebab'],
    'Vegetarian': ['vegan', 'vegetarian', 'veggie', 'plant-based'],
    'American': ['american', 'comfort food', 'diner'],
    'French': ['french', 'bistro', 'croissant', 'brasserie'],
    'Russian': ['russian', 'georgian', 'pelmeni', 'khachapuri'],
  };

  for (const [cuisine, keywords] of Object.entries(cuisineKeywords)) {
    for (const keyword of keywords) {
      if (lower.includes(keyword)) return cuisine;
    }
  }
  return '';
}

// ---- Google Places API ----

async function searchGooglePlaces(restaurantName, city) {
  if (!GOOGLE_PLACES_KEY || SKIP_API) return null;

  const query = `${restaurantName} restaurant ${city}`;
  const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(query)}&inputtype=textquery&fields=place_id,name,formatted_address,geometry,rating,user_ratings_total&key=${GOOGLE_PLACES_KEY}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'OK' || !data.candidates?.length) {
      log(`  Google Places: no results for "${query}"`);
      return null;
    }

    const place = data.candidates[0];

    // Get detailed info + reviews
    const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,rating,user_ratings_total,formatted_address,geometry,reviews&key=${GOOGLE_PLACES_KEY}`;

    const detailsResponse = await fetch(detailsUrl);
    const detailsData = await detailsResponse.json();

    if (detailsData.status !== 'OK') return null;

    const detail = detailsData.result;
    const reviews = (detail.reviews || []).slice(0, 5).map((r) => ({
      source: 'google',
      author: r.author_name,
      rating: r.rating,
      text: r.text?.slice(0, 300) || '',
      date: new Date(r.time * 1000).toISOString().split('T')[0],
    }));

    return {
      google: {
        rating: detail.rating || 0,
        reviewCount: detail.user_ratings_total || 0,
        placeId: place.place_id,
      },
      address: detail.formatted_address || '',
      lat: detail.geometry?.location?.lat || 0,
      lng: detail.geometry?.location?.lng || 0,
      reviews,
    };
  } catch (e) {
    log(`  Google Places error: ${e.message}`);
    return null;
  }
}

// ---- Yelp Fusion API ----

async function searchYelp(restaurantName, city) {
  if (!YELP_API_KEY || SKIP_API) return null;

  const url = `https://api.yelp.com/v3/businesses/search?term=${encodeURIComponent(restaurantName)}&location=${encodeURIComponent(city)}&limit=1&categories=restaurants`;

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${YELP_API_KEY}` },
    });
    const data = await response.json();

    if (!data.businesses?.length) {
      log(`  Yelp: no results for "${restaurantName}" in ${city}`);
      return null;
    }

    const biz = data.businesses[0];
    return {
      yelp: {
        rating: biz.rating || 0,
        reviewCount: biz.review_count || 0,
        url: biz.url || '',
      },
    };
  } catch (e) {
    log(`  Yelp error: ${e.message}`);
    return null;
  }
}

// ---- State Mapping ----

function getState(city) {
  const stateMap = {
    'New York': 'NY',
    'Los Angeles': 'CA',
    Chicago: 'IL',
    Austin: 'TX',
    'San Francisco': 'CA',
    Miami: 'FL',
    Houston: 'TX',
    Nashville: 'TN',
    Portland: 'OR',
    Seattle: 'WA',
    Philadelphia: 'PA',
    Dallas: 'TX',
    Denver: 'CO',
    Atlanta: 'GA',
  };
  return stateMap[city] || '';
}

// ---- Main Pipeline ----

async function main() {
  log('=== Restaurant Enrichment Pipeline ===');
  log(`Google Places API: ${GOOGLE_PLACES_KEY ? 'configured' : 'not configured'}`);
  log(`Yelp Fusion API: ${YELP_API_KEY ? 'configured' : 'not configured'}`);
  log(`Dry run: ${DRY_RUN}`);
  log(`Skip API: ${SKIP_API}`);

  const videos = loadJSON(VIDEOS_PATH);
  if (!videos) {
    log('No videos.json found');
    process.exit(1);
  }

  const existingRestaurants = loadJSON(RESTAURANTS_PATH) || {};
  const overrides = loadJSON(OVERRIDES_PATH) || { overrides: {} };

  const updatedVideos = [];
  const updatedRestaurants = { ...existingRestaurants };

  let extracted = 0;
  let enriched = 0;

  for (const video of videos) {
    // Skip if already has a valid restaurant slug and restaurant exists
    if (
      video.restaurantSlug &&
      existingRestaurants[video.restaurantSlug] &&
      video.city
    ) {
      log(`${video.videoId}: Already enriched (${video.restaurantSlug})`);
      updatedVideos.push(video);
      continue;
    }

    // Step 1: Extract restaurant name
    const name = extractRestaurantName(video.caption, video.videoId, overrides);
    if (!name) {
      log(`${video.videoId}: Could not extract restaurant name from caption`);
      updatedVideos.push(video);
      continue;
    }

    const slug = slugify(name);
    const city = video.city || extractCity(video.caption);
    const cuisine = video.cuisine || extractCuisine(video.caption);
    const state = getState(city);

    log(`${video.videoId}: Extracted "${name}" (${slug}) — ${city}, ${cuisine}`);
    extracted++;

    // Update video record
    video.restaurantSlug = slug;
    video.city = city;
    video.cuisine = cuisine;

    // Step 2: Enrich with APIs (if not already in restaurants.json)
    if (!updatedRestaurants[slug]) {
      updatedRestaurants[slug] = {
        name,
        slug,
        city,
        state,
        cuisine,
        address: '',
        lat: 0,
        lng: 0,
        google: { rating: 0, reviewCount: 0 },
        yelp: { rating: 0, reviewCount: 0 },
        reviews: [],
        videoIds: [],
      };
    }

    const restaurant = updatedRestaurants[slug];

    // Google Places
    if (city && (!restaurant.google?.placeId || restaurant.google?.rating === 0)) {
      const googleData = await searchGooglePlaces(name, city);
      if (googleData) {
        restaurant.google = googleData.google;
        restaurant.address = googleData.address || restaurant.address;
        restaurant.lat = googleData.lat || restaurant.lat;
        restaurant.lng = googleData.lng || restaurant.lng;
        restaurant.reviews = [
          ...googleData.reviews,
          ...restaurant.reviews.filter((r) => r.source !== 'google'),
        ];
        enriched++;
        log(`  Google Places: ${restaurant.google.rating}/5 (${restaurant.google.reviewCount} reviews)`);
        await delay(200); // Rate limiting
      }
    }

    // Yelp
    if (city && (!restaurant.yelp?.url || restaurant.yelp?.rating === 0)) {
      const yelpData = await searchYelp(name, city);
      if (yelpData) {
        restaurant.yelp = yelpData.yelp;
        enriched++;
        log(`  Yelp: ${restaurant.yelp.rating}/5 (${restaurant.yelp.reviewCount} reviews)`);
        await delay(200);
      }
    }

    // Add video ID to restaurant
    if (!restaurant.videoIds.includes(video.videoId)) {
      restaurant.videoIds.push(video.videoId);
    }

    updatedVideos.push(video);
  }

  // Save
  if (!DRY_RUN) {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(VIDEOS_PATH, JSON.stringify(updatedVideos, null, 2));
    writeFileSync(RESTAURANTS_PATH, JSON.stringify(updatedRestaurants, null, 2));
    log(`Saved ${updatedVideos.length} videos and ${Object.keys(updatedRestaurants).length} restaurants`);
  } else {
    log('Dry run — no files written');
  }

  log(`\nComplete. Extracted: ${extracted}, API-enriched: ${enriched}`);
}

main().catch((e) => {
  log(`Fatal error: ${e.message}`);
  process.exit(1);
});
