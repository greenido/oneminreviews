import { describe, it, expect } from 'vitest';
import {
  slugify,
  videoSlug,
  videoPath,
  tiktokWatchUrl,
  tiktokEmbedUrl,
  getVideos,
  getVideoById,
  getRestaurants,
  getRestaurant,
  getVideosByRestaurant,
  getVideosByCity,
  getVideosByCuisine,
  citySlug,
  cityPath,
  cuisineSlug,
  cuisinePath,
  type Video,
} from '../src/lib/data';

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------
describe('slugify', () => {
  it('converts text to lowercase kebab-case', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('removes special characters', () => {
    expect(slugify('NYC #1 Pizza!')).toBe('nyc-1-pizza');
  });

  it('collapses multiple dashes into one', () => {
    expect(slugify('food - amazing - wow')).toBe('food-amazing-wow');
  });

  it('strips leading and trailing dashes', () => {
    expect(slugify('---hello---')).toBe('hello');
  });

  it('handles em-dashes (—) by removing them', () => {
    expect(slugify('Brighton Beach — the best')).toBe('brighton-beach-the-best');
  });

  it('preserves numbers', () => {
    expect(slugify('Top 10 NYC Restaurants 2024')).toBe('top-10-nyc-restaurants-2024');
  });

  it('handles empty string', () => {
    expect(slugify('')).toBe('');
  });

  it('handles emoji-heavy strings', () => {
    const result = slugify('🍕 Best Pizza 🍕 #foodie');
    expect(result).toBe('best-pizza-foodie');
  });

  it('handles captions with Georgian-Russian (hyphenated words)', () => {
    const result = slugify('Georgian-Russian fusion in NYC');
    expect(result).toBe('georgian-russian-fusion-in-nyc');
  });
});

// ---------------------------------------------------------------------------
// videoSlug
// ---------------------------------------------------------------------------
describe('videoSlug', () => {
  const makeVideo = (overrides: Partial<Video> = {}): Video => ({
    videoId: '7301234567890',
    caption: 'Tatiana in Brighton Beach — the most underrated restaurant in NYC. Georgian-Russian fusion that blew my mind 🥟 #nyc #tatiana #foodreview',
    createTime: 1706000000,
    thumbnailUrl: '/assets/images/7301234567890/frame-1.jpg',
    embedUrl: 'https://www.tiktok.com/@oneminreviews/video/7301234567890',
    restaurantSlug: 'tatiana-restaurant',
    city: 'New York',
    cuisine: 'Russian',
    stats: { likes: 29400, comments: 720, shares: 430 },
    ...overrides,
  });

  it('produces a slug with caption prefix and video ID suffix', () => {
    const video = makeVideo();
    const slug = videoSlug(video);
    expect(slug).toContain(video.videoId);
    expect(slug.endsWith(video.videoId)).toBe(true);
  });

  it('limits caption portion to 50 characters', () => {
    const video = makeVideo();
    const slug = videoSlug(video);
    // slug = captionSlug + '-' + videoId
    // captionSlug should be at most 50 chars
    const captionPart = slug.slice(0, slug.lastIndexOf(`-${video.videoId}`));
    expect(captionPart.length).toBeLessThanOrEqual(50);
  });

  it('does not end caption portion with a trailing dash', () => {
    const video = makeVideo();
    const slug = videoSlug(video);
    const captionPart = slug.slice(0, slug.lastIndexOf(`-${video.videoId}`));
    expect(captionPart.endsWith('-')).toBe(false);
  });

  it('produces expected slug for the Tatiana video', () => {
    const video = makeVideo();
    const slug = videoSlug(video);
    expect(slug).toBe(
      'tatiana-in-brighton-beach-the-most-underrated-rest-7301234567890'
    );
  });

  it('handles short captions', () => {
    const video = makeVideo({ caption: 'Great food', videoId: '123' });
    expect(videoSlug(video)).toBe('great-food-123');
  });
});

// ---------------------------------------------------------------------------
// videoPath
// ---------------------------------------------------------------------------
describe('videoPath', () => {
  it('includes restaurant slug, video slug, and trailing slash', () => {
    const video: Video = {
      videoId: '7301234567890',
      caption: 'Test video review',
      createTime: 1706000000,
      thumbnailUrl: '/thumb.jpg',
      embedUrl: 'https://www.tiktok.com/@oneminreviews/video/7301234567890',
      restaurantSlug: 'test-restaurant',
      city: 'NYC',
      cuisine: 'Pizza',
      stats: { likes: 100, comments: 10, shares: 5 },
    };
    const path = videoPath(video);
    expect(path).toContain('test-restaurant/');
    expect(path).toContain('7301234567890');
    expect(path.endsWith('/')).toBe(true);
  });

  it('constructs the path as baseURL + restaurantSlug + videoSlug', () => {
    const video: Video = {
      videoId: '999',
      caption: 'Great eats',
      createTime: 1700000000,
      thumbnailUrl: '/t.jpg',
      embedUrl: 'https://www.tiktok.com/@oneminreviews/video/999',
      restaurantSlug: 'my-place',
      city: 'LA',
      cuisine: 'Tacos',
      stats: { likes: 1, comments: 0, shares: 0 },
    };
    const path = videoPath(video);
    const expectedSlug = videoSlug(video);
    expect(path).toContain(`my-place/${expectedSlug}/`);
  });
});

// ---------------------------------------------------------------------------
// TikTok URL helpers
// ---------------------------------------------------------------------------
describe('tiktokWatchUrl', () => {
  it('builds a canonical TikTok watch URL', () => {
    expect(tiktokWatchUrl('7301234567890')).toBe(
      'https://www.tiktok.com/@oneminreviews/video/7301234567890'
    );
  });

  it('works with long (real) video IDs', () => {
    const url = tiktokWatchUrl('7606499639784705311');
    expect(url).toBe(
      'https://www.tiktok.com/@oneminreviews/video/7606499639784705311'
    );
  });

  it('always starts with https://www.tiktok.com', () => {
    expect(tiktokWatchUrl('123')).toMatch(/^https:\/\/www\.tiktok\.com\//);
  });

  it('includes the @oneminreviews handle', () => {
    expect(tiktokWatchUrl('123')).toContain('@oneminreviews');
  });
});

describe('tiktokEmbedUrl', () => {
  it('builds a TikTok embed iframe URL', () => {
    expect(tiktokEmbedUrl('7301234567890')).toBe(
      'https://www.tiktok.com/embed/v2/7301234567890'
    );
  });

  it('works with long (real) video IDs', () => {
    expect(tiktokEmbedUrl('7606499639784705311')).toBe(
      'https://www.tiktok.com/embed/v2/7606499639784705311'
    );
  });

  it('contains /embed/v2/ in the path', () => {
    expect(tiktokEmbedUrl('abc')).toContain('/embed/v2/');
  });
});

// ---------------------------------------------------------------------------
// Data integrity: videos
// ---------------------------------------------------------------------------
describe('getVideos', () => {
  it('returns a non-empty array', () => {
    const videos = getVideos();
    expect(Array.isArray(videos)).toBe(true);
    expect(videos.length).toBeGreaterThan(0);
  });

  it('every video has a non-empty videoId', () => {
    for (const v of getVideos()) {
      expect(v.videoId).toBeTruthy();
      expect(typeof v.videoId).toBe('string');
      expect(v.videoId.length).toBeGreaterThan(0);
    }
  });

  it('every video has a non-empty embedUrl', () => {
    for (const v of getVideos()) {
      expect(v.embedUrl).toBeTruthy();
      expect(v.embedUrl).toMatch(/^https:\/\/www\.tiktok\.com\/@\w+\/video\/\d+$/);
    }
  });

  it('every video embedUrl matches its videoId', () => {
    for (const v of getVideos()) {
      expect(v.embedUrl).toContain(v.videoId);
      expect(v.embedUrl).toBe(
        `https://www.tiktok.com/@oneminreviews/video/${v.videoId}`
      );
    }
  });

  it('every video has valid stats', () => {
    for (const v of getVideos()) {
      expect(v.stats).toBeDefined();
      expect(typeof v.stats.likes).toBe('number');
      expect(typeof v.stats.comments).toBe('number');
      expect(typeof v.stats.shares).toBe('number');
      expect(v.stats.likes).toBeGreaterThanOrEqual(0);
    }
  });

  it('every video has a restaurantSlug', () => {
    for (const v of getVideos()) {
      expect(v.restaurantSlug).toBeTruthy();
    }
  });

  it('every video has a thumbnailUrl', () => {
    for (const v of getVideos()) {
      expect(v.thumbnailUrl).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// getVideoById
// ---------------------------------------------------------------------------
describe('getVideoById', () => {
  it('finds a video by its ID', () => {
    const videos = getVideos();
    const first = videos[0];
    const found = getVideoById(first.videoId);
    expect(found).toBeDefined();
    expect(found!.videoId).toBe(first.videoId);
  });

  it('returns undefined for a non-existent ID', () => {
    expect(getVideoById('nonexistent_id_9999')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Data integrity: restaurants
// ---------------------------------------------------------------------------
describe('getRestaurants', () => {
  it('returns a non-empty object', () => {
    const restaurants = getRestaurants();
    expect(typeof restaurants).toBe('object');
    expect(Object.keys(restaurants).length).toBeGreaterThan(0);
  });

  it('every restaurant has a name and slug', () => {
    const restaurants = getRestaurants();
    for (const [key, r] of Object.entries(restaurants)) {
      expect(r.name).toBeTruthy();
      expect(r.slug).toBeTruthy();
      expect(r.slug).toBe(key);
    }
  });
});

// ---------------------------------------------------------------------------
// getRestaurant
// ---------------------------------------------------------------------------
describe('getRestaurant', () => {
  it('finds a restaurant by slug', () => {
    const all = getRestaurants();
    const firstSlug = Object.keys(all)[0];
    const found = getRestaurant(firstSlug);
    expect(found).toBeDefined();
    expect(found!.slug).toBe(firstSlug);
  });

  it('returns undefined for unknown slug', () => {
    expect(getRestaurant('nonexistent-slug')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Cross-reference: video → restaurant
// ---------------------------------------------------------------------------
describe('video ↔ restaurant cross-reference', () => {
  it('every video references an existing restaurant', () => {
    const restaurants = getRestaurants();
    for (const v of getVideos()) {
      expect(restaurants[v.restaurantSlug]).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// getVideosByRestaurant / City / Cuisine
// ---------------------------------------------------------------------------
describe('getVideosByRestaurant', () => {
  it('returns only videos matching the restaurant slug', () => {
    const videos = getVideos();
    const slug = videos[0].restaurantSlug;
    const filtered = getVideosByRestaurant(slug);
    expect(filtered.length).toBeGreaterThan(0);
    for (const v of filtered) {
      expect(v.restaurantSlug).toBe(slug);
    }
  });
});

describe('getVideosByCity', () => {
  it('returns videos matching the city (case-insensitive)', () => {
    const videos = getVideos().filter((v) => v.city);
    if (videos.length === 0) return; // skip if no cities
    const city = videos[0].city;
    const filtered = getVideosByCity(city);
    expect(filtered.length).toBeGreaterThan(0);
    for (const v of filtered) {
      expect(v.city.toLowerCase()).toBe(city.toLowerCase());
    }
  });
});

describe('getVideosByCuisine', () => {
  it('returns videos matching the cuisine (case-insensitive)', () => {
    const videos = getVideos().filter((v) => v.cuisine);
    if (videos.length === 0) return; // skip if no cuisines
    const cuisine = videos[0].cuisine;
    const filtered = getVideosByCuisine(cuisine);
    expect(filtered.length).toBeGreaterThan(0);
    for (const v of filtered) {
      expect(v.cuisine.toLowerCase()).toBe(cuisine.toLowerCase());
    }
  });
});

// ---------------------------------------------------------------------------
// Slug helpers: city and cuisine
// ---------------------------------------------------------------------------
describe('citySlug / cityPath', () => {
  it('slugifies city names', () => {
    expect(citySlug('New York')).toBe('new-york');
    expect(citySlug('Los Angeles')).toBe('los-angeles');
    expect(citySlug('Chicago')).toBe('chicago');
  });

  it('builds city paths with slug and trailing slash', () => {
    const path = cityPath('New York');
    expect(path).toContain('city/new-york/');
    expect(path.endsWith('/')).toBe(true);
  });
});

describe('cuisineSlug / cuisinePath', () => {
  it('slugifies cuisine names', () => {
    expect(cuisineSlug('Pizza')).toBe('pizza');
    expect(cuisineSlug('Mexican Food')).toBe('mexican-food');
  });

  it('builds cuisine paths with slug and trailing slash', () => {
    const path = cuisinePath('Pizza');
    expect(path).toContain('cuisine/pizza/');
    expect(path.endsWith('/')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TikTok URL consistency with data
// ---------------------------------------------------------------------------
describe('TikTok URL consistency', () => {
  it('tiktokWatchUrl output matches embedUrl field for every video', () => {
    for (const v of getVideos()) {
      expect(tiktokWatchUrl(v.videoId)).toBe(v.embedUrl);
    }
  });

  it('tiktokEmbedUrl constructs a different URL than the watch URL', () => {
    for (const v of getVideos()) {
      const watchUrl = tiktokWatchUrl(v.videoId);
      const embedUrl = tiktokEmbedUrl(v.videoId);
      expect(watchUrl).not.toBe(embedUrl);
      expect(embedUrl).toContain('/embed/v2/');
      expect(watchUrl).toContain('/@oneminreviews/video/');
    }
  });
});
