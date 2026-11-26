# Weather Finder project conventions

- Keep the app static and mobile-first. Use semantic HTML, CSS and small browser modules. Preserve hash routing and relative asset URLs for GitHub Pages.
- Use the illustrated outdoor palette, rounded type and two primary home actions. Keep the nearby weather view focused on the map. Default its weather picker to Rain. Preserve clear focus, labeled controls, readable contrast, touch targets and reduced-motion behavior.
- Route forecast calls through the shared weather service. Keep batching and cache keys consistent across features. Preserve bounded search and map budgets, 429 backoff and cancellation. Document threshold or source changes in the README.
- Identify data as modeled and forecasts as future estimates. Preserve the distinction between snowfall and snow cover, and between a dry sample and unavailable rain data. Show official-alert guidance on hazardous matches.
- Keep credentials, precise device locations, local skill installations, test artifacts and personal data out of Git and deployed files. Keep location and weather results in memory. Insert external place names into the DOM as text. Preserve provider links and third-party licenses.
- Run `node tests/weather.test.js` and exercise both features at a mobile size before deployment. Verify the project subpath, hash refresh, data-source connectivity and git history before a public release.
