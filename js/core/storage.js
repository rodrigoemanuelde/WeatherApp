(function (global) {
  const storage = global.WandrStorage = global.WandrStorage || {};

  const KEYS = {
    trips: 'wandr_trips',
    theme: 'wandr_theme',
    routeCache: 'wandr_osrm_route_cache_v1',
    countryCodesProcessed: 'wandr_country_codes_processed',
    weatherCachePrefix: 'wandr_weather_cache_'
  };

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (error) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function loadTrips() {
    const parsed = readJson(KEYS.trips, []);
    return Array.isArray(parsed) ? parsed : [];
  }

  function saveTrips(trips) {
    writeJson(KEYS.trips, trips);
  }

  function loadTheme() {
    const value = localStorage.getItem(KEYS.theme);
    return value === 'light' || value === 'dark' ? value : null;
  }

  function saveTheme(theme) {
    localStorage.setItem(KEYS.theme, theme);
  }

  function loadRouteMetricsCache() {
    const parsed = readJson(KEYS.routeCache, {});
    return parsed && typeof parsed === 'object' ? parsed : {};
  }

  function saveRouteMetricsCache(cache) {
    writeJson(KEYS.routeCache, cache);
  }

  function weatherCacheKey(cityId) {
    return `${KEYS.weatherCachePrefix}${cityId}`;
  }

  function listWeatherCacheEntries() {
    const entries = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(KEYS.weatherCachePrefix)) continue;
        entries.push({
          key,
          cityId: key.slice(KEYS.weatherCachePrefix.length),
          value: readJson(key, null)
        });
      }
    } catch (error) {
      return [];
    }
    return entries;
  }

  function loadWeatherCache(cityId) {
    return readJson(weatherCacheKey(cityId), null);
  }

  function saveWeatherCache(cityId, payload) {
    writeJson(weatherCacheKey(cityId), payload);
  }

  function loadProcessedCountryCodes() {
    const parsed = readJson(KEYS.countryCodesProcessed, {});
    return parsed && typeof parsed === 'object' ? parsed : {};
  }

  function saveProcessedCountryCodes(value) {
    writeJson(KEYS.countryCodesProcessed, value);
  }

  storage.keys = KEYS;
  storage.readJson = readJson;
  storage.writeJson = writeJson;
  storage.loadTrips = loadTrips;
  storage.saveTrips = saveTrips;
  storage.loadTheme = loadTheme;
  storage.saveTheme = saveTheme;
  storage.loadRouteMetricsCache = loadRouteMetricsCache;
  storage.saveRouteMetricsCache = saveRouteMetricsCache;
  storage.listWeatherCacheEntries = listWeatherCacheEntries;
  storage.loadWeatherCache = loadWeatherCache;
  storage.saveWeatherCache = saveWeatherCache;
  storage.loadProcessedCountryCodes = loadProcessedCountryCodes;
  storage.saveProcessedCountryCodes = saveProcessedCountryCodes;
})(window);
