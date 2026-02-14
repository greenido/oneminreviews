import videosData from '../../data/videos.json';
import restaurantsData from '../../data/restaurants.json';

// ---------- Types ----------

export interface VideoStats {
  likes: number;
  comments: number;
  shares: number;
}

export interface Video {
  videoId: string;
  caption: string;
  createTime: number;
  thumbnailUrl: string;
  embedUrl: string;
  restaurantSlug: string;
  city: string;
  cuisine: string;
  stats: VideoStats;
}

export interface ReviewEntry {
  source: 'google' | 'yelp';
  author: string;
  rating: number;
  text: string;
  date: string;
}

export interface RatingData {
  rating: number;
  reviewCount: number;
  placeId?: string;
  url?: string;
}

export interface Restaurant {
  name: string;
  slug: string;
  city: string;
  state: string;
  cuisine: string;
  address: string;
  lat: number;
  lng: number;
  google: RatingData;
  yelp?: RatingData;
  reviews: ReviewEntry[];
  videoIds: string[];
}

export type RestaurantMap = Record<string, Restaurant>;

// ---------- Data Access ----------

export function getVideos(): Video[] {
  return videosData as Video[];
}

export function getRestaurants(): RestaurantMap {
  return restaurantsData as RestaurantMap;
}

export function getRestaurant(slug: string): Restaurant | undefined {
  return getRestaurants()[slug];
}

export function getVideoById(videoId: string): Video | undefined {
  return getVideos().find((v) => v.videoId === videoId);
}

export function getVideosByRestaurant(slug: string): Video[] {
  return getVideos().filter((v) => v.restaurantSlug === slug);
}

export function getVideosByCity(city: string): Video[] {
  return getVideos().filter((v) => v.city.toLowerCase() === city.toLowerCase());
}

export function getVideosByCuisine(cuisine: string): Video[] {
  return getVideos().filter(
    (v) => v.cuisine.toLowerCase() === cuisine.toLowerCase()
  );
}

// ---------- Google Places Availability ----------

/** Returns true if this restaurant has real Google Places data (rating > 0 and a placeId). */
export function hasGoogleData(restaurant: Restaurant): boolean {
  return !!(restaurant.google && restaurant.google.rating > 0 && restaurant.google.placeId);
}

/** Returns true if this restaurant has real Yelp data (rating > 0). */
export function hasYelpData(restaurant: Restaurant): boolean {
  return !!(restaurant.yelp && restaurant.yelp.rating > 0);
}

/** Returns Google reviews for this restaurant (filtered from the reviews array). */
export function getGoogleReviews(restaurant: Restaurant): ReviewEntry[] {
  return restaurant.reviews.filter((r) => r.source === 'google');
}

// ---------- Aggregation ----------

export function getCities(): string[] {
  return [...new Set(getVideos().map((v) => v.city).filter(Boolean))].sort();
}

export function getCuisines(): string[] {
  return [...new Set(getVideos().map((v) => v.cuisine).filter(Boolean))].sort();
}

export function getTopRated(limit = 10): { video: Video; restaurant: Restaurant }[] {
  const restaurants = getRestaurants();
  return getVideos()
    .map((video) => ({
      video,
      restaurant: restaurants[video.restaurantSlug],
    }))
    .filter((item) => item.restaurant)
    .sort((a, b) => {
      // Sort by TikTok engagement (likes) — our own reviews metric
      const likesA = a.video.stats?.likes ?? 0;
      const likesB = b.video.stats?.likes ?? 0;
      return likesB - likesA;
    })
    .slice(0, limit);
}

export function getLatestVideos(limit = 10): Video[] {
  return [...getVideos()]
    .sort((a, b) => b.createTime - a.createTime)
    .slice(0, limit);
}

// ---------- Slug Helpers ----------

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function videoSlug(video: Video): string {
  const captionSlug = slugify(video.caption).slice(0, 50).replace(/-$/, '');
  return `${captionSlug}-${video.videoId}`;
}

export function videoPath(video: Video): string {
  return `${import.meta.env.BASE_URL}${video.restaurantSlug}/${videoSlug(video)}/`;
}

export function citySlug(city: string): string {
  return slugify(city);
}

export function cityPath(city: string): string {
  return `${import.meta.env.BASE_URL}city/${citySlug(city)}/`;
}

export function cuisineSlug(cuisine: string): string {
  return slugify(cuisine);
}

export function cuisinePath(cuisine: string): string {
  return `${import.meta.env.BASE_URL}cuisine/${cuisineSlug(cuisine)}/`;
}

// ---------- Thumbnail Helpers ----------

export const PLACEHOLDER_THUMBNAIL = '/assets/images/placeholder.svg';

/**
 * Resolve a thumbnailUrl to a usable value.
 * Prefer locally-generated OG images (og.webp) that ship with the repo in
 * public/assets/images/<videoId>/. Fall back to placeholder only when no
 * OG image exists for the given video.
 * Remote (http/https) URLs are returned as-is.
 */
export function resolveThumbnail(thumbnailUrl: string): string {
  if (!thumbnailUrl) return PLACEHOLDER_THUMBNAIL;
  // Remote URLs are fine
  if (thumbnailUrl.startsWith('http')) return thumbnailUrl;
  // Local per-video path — swap frame-*.jpg for og.webp which we ship in public/
  const match = thumbnailUrl.match(/^\/assets\/images\/(\d+)\//);
  if (match) {
    return `/assets/images/${match[1]}/og.webp`;
  }
  // Any other local path — keep as-is (it might be a real public file)
  return thumbnailUrl;
}

// ---------- TikTok URL Helpers ----------

const TIKTOK_HANDLE = 'oneminreviews';

/** Build the canonical TikTok watch URL for a given video ID. */
export function tiktokWatchUrl(videoId: string): string {
  return `https://www.tiktok.com/@${TIKTOK_HANDLE}/video/${videoId}`;
}

/** Build the TikTok embed iframe src URL for a given video ID. */
export function tiktokEmbedUrl(videoId: string): string {
  return `https://www.tiktok.com/embed/v2/${videoId}`;
}

// ---------- FAQ Generator ----------

export function generateFAQs(
  restaurant: Restaurant,
  video: Video
): { question: string; answer: string }[] {
  const name = restaurant.name;
  const likes = video.stats?.likes ?? 0;
  const hasGoogle = hasGoogleData(restaurant);
  const googleRating = restaurant.google?.rating ?? 0;
  const googleCount = restaurant.google?.reviewCount ?? 0;

  const faqs: { question: string; answer: string }[] = [
    {
      question: `Is ${name} worth it?`,
      answer: hasGoogle
        ? `With a ${googleRating}/5 rating on Google from ${googleCount.toLocaleString()} reviews, ${name} is highly regarded. Watch our honest one-minute @oneminreviews video to see for yourself — no sponsorships, just the truth.`
        : `Watch our honest one-minute video review to decide for yourself. @oneminreviews gives you an unfiltered, unsponsored look at the food, the vibe, and whether it's worth your money.`,
    },
    {
      question: `What does @oneminreviews think of ${name}?`,
      answer: `Our reviewer visited ${name} and captured the experience in a one-minute video. With ${likes.toLocaleString()} likes, it's one of our most engaging reviews. Watch above for the honest verdict.`,
    },
    {
      question: `Where is ${name} located?`,
      answer: `${name} is located at ${restaurant.address}. It serves ${restaurant.cuisine.toLowerCase()} cuisine in ${restaurant.city}, ${restaurant.state}.`,
    },
    {
      question: `Who reviews ${name}?`,
      answer: `${name} was reviewed by @oneminreviews — honest, one-minute video restaurant reviews with no sponsorships, no paid placements, just real opinions.`,
    },
    {
      question: `Is there a video review of ${name}?`,
      answer: `Yes! @oneminreviews posted an honest one-minute video review of ${name}. Watch it above to see the food, the vibe, and the verdict.`,
    },
  ];

  if (hasGoogle) {
    faqs.push({
      question: `What is ${name}'s Google rating?`,
      answer: `${name} has a ${googleRating}/5 rating on Google based on ${googleCount.toLocaleString()} reviews. Combined with our @oneminreviews video, you get the full picture before visiting.`,
    });
  }

  return faqs;
}
