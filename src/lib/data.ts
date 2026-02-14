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

// ---------- Yelp Availability ----------

/** Returns true if this restaurant has real Yelp data (rating > 0). */
export function hasYelpData(restaurant: Restaurant): boolean {
  return !!(restaurant.yelp && restaurant.yelp.rating > 0);
}

/** Returns true if ANY restaurant in the dataset has real Yelp data. */
export function siteHasYelpData(): boolean {
  const restaurants = getRestaurants();
  return Object.values(restaurants).some((r) => hasYelpData(r));
}

/** Returns the ratings label string — "Google" or "Google and Yelp" depending on data. */
export function ratingsSourceLabel(): string {
  return siteHasYelpData() ? 'Google and Yelp' : 'Google';
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
      const ratingA = a.restaurant.google?.rating ?? 0;
      const ratingB = b.restaurant.google?.rating ?? 0;
      return ratingB - ratingA;
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
  return `/${video.restaurantSlug}/${videoSlug(video)}/`;
}

export function citySlug(city: string): string {
  return slugify(city);
}

export function cityPath(city: string): string {
  return `/city/${citySlug(city)}/`;
}

export function cuisineSlug(cuisine: string): string {
  return slugify(cuisine);
}

export function cuisinePath(cuisine: string): string {
  return `/cuisine/${cuisineSlug(cuisine)}/`;
}

// ---------- FAQ Generator ----------

export function generateFAQs(
  restaurant: Restaurant,
  video: Video
): { question: string; answer: string }[] {
  const name = restaurant.name;
  const hasYelp = hasYelpData(restaurant);
  const googleRating = restaurant.google?.rating ?? 0;
  const googleCount = restaurant.google?.reviewCount ?? 0;
  const yelpRating = hasYelp ? restaurant.yelp!.rating : 0;
  const yelpCount = hasYelp ? restaurant.yelp!.reviewCount : 0;
  const totalCount = googleCount + yelpCount;
  const avgRating = hasYelp
    ? (googleRating + yelpRating) / 2
    : googleRating;
  const sources = hasYelp ? 'Google and Yelp' : 'Google';

  return [
    {
      question: `Is ${name} worth it?`,
      answer: `Based on ${totalCount} ${hasYelp ? 'combined reviews across ' : 'reviews on '}${sources}, ${name} holds an average rating of ${avgRating.toFixed(
        1
      )} out of 5. Our video review gives you an honest, unfiltered look at the experience.`,
    },
    {
      question: `What do customers say about ${name}?`,
      answer:
        restaurant.reviews.length > 0
          ? `Recent reviews mention: "${restaurant.reviews[0].text}" — ${restaurant.reviews[0].author}`
          : hasYelp
            ? `${name} has strong ratings on both Google (${googleRating}) and Yelp (${yelpRating}). Check our video for a first-hand look.`
            : `${name} has a strong ${googleRating} rating on Google. Check our video for a first-hand look.`,
    },
    {
      question: `Where is ${name} located?`,
      answer: `${name} is located at ${restaurant.address}. It serves ${restaurant.cuisine.toLowerCase()} cuisine in ${restaurant.city}, ${restaurant.state}.`,
    },
    {
      question: `What is ${name}'s rating?`,
      answer: hasYelp
        ? `${name} has a ${googleRating} rating on Google (${googleCount.toLocaleString()} reviews) and a ${yelpRating} rating on Yelp (${yelpCount.toLocaleString()} reviews).`
        : `${name} has a ${googleRating} rating on Google (${googleCount.toLocaleString()} reviews).`,
    },
    {
      question: `Is there a video review of ${name}?`,
      answer: `Yes! @oneminreviews posted an honest one-minute video review of ${name}. Watch it above to see the food, the vibe, and the verdict.`,
    },
  ];
}
