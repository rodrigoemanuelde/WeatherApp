(function (global) {
  const utils = global.WandrUtils = global.WandrUtils || {};

  function haversine(lat1, lon1, lat2, lon2) {
    const earthRadiusKm = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusKm * c;
  }

  function buildRouteCacheKey(fromLat, fromLon, toLat, toLon, transport) {
    return [
      transport,
      Number(fromLat).toFixed(5),
      Number(fromLon).toFixed(5),
      Number(toLat).toFixed(5),
      Number(toLon).toFixed(5)
    ].join(':');
  }

  utils.haversine = haversine;
  utils.buildRouteCacheKey = buildRouteCacheKey;
})(window);
