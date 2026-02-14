# OneMinReviews

**Honest restaurant reviews, one minute at a time.**

[OneMinReviews](https://oneminreviews.com) is a static site that archives and organizes the one-minute restaurant video reviews from the TikTok account **[@oneminreviews](https://www.tiktok.com/@oneminreviews)**. Real food. Real opinions. No sponsored content, no algorithms -- just honest takes on restaurants across the US.

---

## What You'll Find

- **21+ video reviews** from [@oneminreviews](https://www.tiktok.com/@oneminreviews) on TikTok
- **14 restaurants** across **5 cities**: New York, Los Angeles, Chicago, Austin, and the Bay Area
- **Curated review snippets** pulled from Google and Yelp, so you can see what other diners think alongside each video
- **Star ratings** from both Google and Yelp displayed on every restaurant page
- **Cuisines covered**: Pizza, Deli, Russian, Middle Eastern, American, BBQ, Vegetarian, and more

## Reviews & Ratings

Every restaurant page features:

- An embedded **TikTok video review** (deferred loading for performance)
- **Google and Yelp ratings** with review counts
- **Curated review snippets** from real diners -- quotes, star ratings, author, and date
- A **FAQ section** answering common questions like "Is this place worth it?" and "What do customers say?"

Restaurants include fan favorites like **Prince Street Pizza**, **Joe's Pizza**, **Tatiana**, **Langer's Delicatessen**, **Pizzana**, **Bavel**, **Portillo's**, **Lou Malnati's**, **Franklin Barbecue**, **Superiority Burger**, and more.

## Key Features

| Feature | Description |
| :--- | :--- |
| **Browse by City** | Filter reviews by city -- NYC, LA, Chicago, Austin, Bay Area |
| **Browse by Cuisine** | Find reviews by cuisine type -- pizza, BBQ, deli, and more |
| **Top Rated** | A ranked list of the highest-rated restaurants by combined Google & Yelp scores |
| **TikTok Embeds** | Click-to-load TikTok video embeds on every restaurant page |
| **SEO Optimized** | JSON-LD structured data (VideoObject, Restaurant, FAQPage), Open Graph tags, Twitter Cards, and XML sitemaps (including image and video sitemaps) |
| **Automated Pipeline** | Scrapes TikTok metadata, enriches restaurant data via Google Places & Yelp APIs, generates OG images, and builds -- all via GitHub Actions |

## Tech Stack

| Category | Technology |
| :--- | :--- |
| **Framework** | [Astro 5.x](https://astro.build) (static output) |
| **Language** | TypeScript + Astro components |
| **Styling** | CSS (global + component-scoped), Inter font via Google Fonts |
| **Scraping** | [yt-dlp](https://github.com/yt-dlp/yt-dlp) for TikTok video metadata |
| **NLP** | [compromise](https://github.com/spencermountain/compromise) for restaurant name extraction |
| **Image Processing** | [sharp](https://sharp.pixelplumbing.com/) for OG image generation |
| **Media** | [fluent-ffmpeg](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg) for media processing |
| **Deployment** | GitHub Pages via GitHub Actions |

## Project Structure

```text
/
├── data/
│   ├── videos.json           # TikTok video metadata
│   ├── restaurants.json      # Enriched restaurant data & review snippets
│   └── overrides.json        # Manual data overrides
├── scripts/
│   ├── scrape-tiktok.js      # Fetches video metadata from @oneminreviews
│   ├── enrich-restaurants.js # Google Places + Yelp enrichment
│   ├── process-media.js      # FFmpeg media processing
│   ├── generate-og-images.js # OG image generation with sharp
│   └── generate-sitemaps.js  # XML sitemap generation
├── src/
│   ├── components/
│   │   ├── FAQ.astro          # FAQ section with structured data
│   │   ├── ReviewSnippet.astro# Google/Yelp review quote cards
│   │   ├── StarRating.astro   # Star rating display
│   │   ├── TikTokEmbed.astro  # Click-to-load TikTok player
│   │   └── VideoCard.astro    # Video thumbnail card
│   ├── layouts/
│   │   └── Base.astro         # Base HTML layout with SEO meta
│   ├── lib/
│   │   └── data.ts            # Data loading & FAQ generation
│   ├── pages/
│   │   ├── index.astro        # Home page
│   │   ├── top-rated.astro    # Top-rated restaurants
│   │   ├── city/[city].astro  # City-filtered listings
│   │   ├── cuisine/[cuisine].astro # Cuisine-filtered listings
│   │   └── [restaurant]/[...slug].astro # Restaurant detail pages
│   └── styles/
│       └── global.css
├── astro.config.mjs
├── package.json
└── tsconfig.json
```

## Commands

All commands are run from the root of the project:

| Command | Action |
| :--- | :--- |
| `npm install` | Install dependencies |
| `npm run dev` | Start local dev server at `localhost:4321` |
| `npm run build` | Build the production site to `./dist/` |
| `npm run preview` | Preview the build locally before deploying |
| `npm run scrape` | Scrape latest video metadata from @oneminreviews |
| `npm run enrich` | Enrich restaurant data via Google Places & Yelp APIs |
| `npm run process-media` | Process media files with FFmpeg |
| `npm run generate-og` | Generate Open Graph images |
| `npm run generate-sitemaps` | Generate XML sitemaps |
| `npm run pipeline` | Run the full pipeline: scrape, process, enrich, build, sitemaps |

## Deployment

The site is deployed to **GitHub Pages** via a GitHub Actions workflow that triggers on:

- Pushes to `main`
- Weekly schedule (Sundays at 6:00 UTC) to pick up new TikTok videos
- Manual dispatch

The workflow handles the full pipeline automatically -- scraping new videos, enriching data, generating images, building the site, and deploying.

**Required secrets** for the full pipeline:
- `GOOGLE_PLACES_KEY` -- Google Places API key for restaurant data
- `YELP_API_KEY` -- Yelp Fusion API key for ratings and reviews
- `PROXY_URL` (optional) -- Proxy for TikTok scraping

## Follow @oneminreviews

Check out the latest reviews on TikTok: **[@oneminreviews](https://www.tiktok.com/@oneminreviews)**

Visit the site: **[oneminreviews.com](https://oneminreviews.com)**
