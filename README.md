# Weather Finder

Chase your weather. Pick a condition to find matching destinations nearby, or open a map of modeled weather around you. The app runs in the browser on GitHub Pages.

## Run and test

Run `python -m http.server 3000 --bind 127.0.0.1` and open `http://localhost:3000/`. Serving over HTTP on loopback enables browser geolocation for development. Run `node tests/weather.test.js` with current Node.js for the automated service and algorithm tests. A desktop/mobile browser and network access are needed to exercise the live application.

## Architecture

The HTML, CSS and native JavaScript modules require no production build or package installation. Hash navigation works when refreshing a feature or using browser Back on the GitHub Pages project path. The starting location and weather cache live in the tab. Geolocation is requested only when selected. Weather coordinates are rounded to a 0.05° grid before sending. GeoNames destinations ship as latitude-band JSON files. Open-Meteo geocoding receives city and postal searches, and OpenStreetMap receives tile requests for the map area. Google Maps directions send the destination on click.

## Search and interpretation

Search samples named, populated places using GeoNames, which avoids large numbers of ocean and otherwise unnamed grid points. Each stage filters by exact Haversine distance, checks the nearest places and a set of spaced destinations, then samples additional candidates around promising areas or checks more of the nearest places when the first pass finds none. Results are sorted by straight-line distance. A named place can still be difficult to reach. The index omits some small places, and the sparse sampling can miss closer destinations.

The user radius starts at 100 miles and ranges from 25 to 500. Unlimited expands through 25, 100, 250, 500, 850 and 1,200 miles until it finds matches or hits the distance or request budget. Each search considers at most 96 locations. Status shows the search radius while working and reports the number of destinations sampled and the latest completed radius. Cancel stops the workflow immediately. An already-started HTTP batch can finish and warm the shared cache.

Now uses the Open-Meteo current model fields, except snow depth uses the latest available hourly estimate. Today considers future hours remaining in the starting location’s local day. Tomorrow considers the next local calendar day. GPS uses the device’s time zone. A result shows the first matching hour, displayed in the destination’s local time. Directions are suppressed on potentially hazardous results.

| Category | Match rule |
| --- | --- |
| Sunny | Daylight, cloud cover ≤25%, and WMO code 0 or 1 |
| Rain | Rain plus showers ≥0.1 mm in the model interval |
| Snowfall | Snow falling ≥0.1 cm in the model interval |
| Stormy | WMO thunderstorm codes 95, 96 or 99 |
| Foggy | WMO fog codes 45 or 48 |
| Cloudy | Cloud cover ≥75% |
| Windy | Sustained 10 m wind ≥20 mph |
| Snow cover | Snow depth ≥1 cm |
| Temperature | Within 3°F of the target |

## Nearby weather map

The map defaults to Rain. The dropdown switches among the same nine categories as search, with an optional target for Temperature. The map applies the search thresholds to modeled current conditions on a zoom-dependent grid. Switching categories reuses the shared in-memory API cache, with hourly data required for snow cover. For Rain, the map samples current rain plus showers. Blue indicates modeled rain, pale solid cells indicate a sample below the rain threshold, and dashed outlines indicate unavailable data. Areas outside sampled cells also have no data. Opacity reflects the amount and a popup shows precipitation in millimeters over the model interval. Snowfall is excluded from the rain layer. These cells show approximate modeled coverage and may miss local showers. For other categories, blue marks matches and pale solid cells show other sampled conditions. The update time is the oldest successful retrieval shown in the current view.

The coverage fills in batches from the map center, with a maximum of 48 cells per view and a 420 ms delay after panning or zooming. Reused areas can load from the cache. Refresh bypasses cached entries for the current view at most once per minute. RainViewer’s free radar was evaluated. Its past radar tiles cover participating radars and would require separate coverage and interpretation logic. Modeled cells use the same source and budget as the weather search and work outside radar coverage.

## API usage and data sources

- [Open-Meteo forecast](https://open-meteo.com/en/docs) and [geocoding](https://open-meteo.com/en/docs/geocoding-api) use the free non-commercial tier. Model values are rounded for display, categorized and used to construct map cells. Attribution and [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) appear in the app. The published limits are 600 calls per minute, 5,000 per hour and 10,000 per day. See [pricing](https://open-meteo.com/en/pricing) and [terms](https://open-meteo.com/en/terms).
- Weather requests combine up to 12 coordinates. The rain map and most Now searches request current fields only and share those responses. Forecast searches and Now snow cover request hourly data too, and their cached responses can also serve current-only requests. The client budgets one effective call per current-only coordinate and two per coordinate with hourly fields and limits each tab to 240 weighted calls per minute, 900 per hour and 2,500 per day. A ten-minute, 650-entry shared cache deduplicates concurrent fetches. HTTP 429 pauses new requests for at least one minute or the provider’s Retry-After interval. Provider limits can still apply across users or tabs.
- [GeoNames](https://download.geonames.org/export/dump/readme.txt) provides the worldwide CC BY 4.0 `cities5000` extract. This snapshot includes name, country code, rounded latitude/longitude and time zone. Its source archive SHA-256 is `8fc499f24d383f1f8317975cb627dedc167a1290f5be92040f810058ab6fabfe`.
- [Leaflet 1.9.4](https://leafletjs.com/) is vendored with its BSD-2-Clause license. [OpenStreetMap](https://www.openstreetmap.org/copyright) serves tiles under its [tile usage policy](https://operations.osmfoundation.org/policies/tiles/). The app includes attribution and relies on normal browser caching with no tile prefetch. Web Mercator clips the map above approximately 85° latitude.
- Fredoka and Nunito are self-hosted Latin subsets with their SIL Open Font Licenses in `assets/fonts/`. System fallback handles other character sets.

## Deployment

Publish the repository on GitHub only after scanning all refs and reviewing changes for credentials and private data. In **Settings → Pages**, select **Deploy from a branch**, `main`, and `/ (root)`. The `.nojekyll` file serves the static files directly. Verify HTTPS, the home page, both hash URLs, and live weather behavior at the Pages URL.

## Design skills

The project-scoped installations are local environment files, excluded from Git.

| Skill | Local path | Audited revision |
| --- | --- | --- |
| [Anthropic Frontend Design](https://github.com/anthropics/skills/tree/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/frontend-design) | `.agents/skills/frontend-design` | `e4bb5d960d87126ff3b3a8af1a104b7db67560ba` |
| [UI/UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/tree/b244c0448bff0a891f972672d47df9c47d61ac31) | `.agents/skills/ui-ux-pro-max` | `b244c0448bff0a891f972672d47df9c47d61ac31` |

Anthropic’s package contains Markdown and its Apache 2.0 license. UI/UX Pro Max was installed as a documentation-only adaptation with its MIT license and static references. Its executable search and preview modules, tests, data catalogs, installer, platform files and integrations were excluded. The upstream installer can make network requests and invoke subprocesses. Generated previews can load fonts from Google. No bundled code or hooks ran, no skill dependencies were installed and no existing skills were replaced.
