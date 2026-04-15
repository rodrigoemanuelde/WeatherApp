(function (global) {
  const Wandr = global.Wandr = global.Wandr || {};
  Wandr.Routing = Wandr.Routing || {};

  // Private state for RoutingMetrics
  const _routeMetricsCache = global.WandrStorage ? global.WandrStorage.loadRouteMetricsCache() : {};
  const _routeMetricsInflight = new Map();
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  // Private state for RouteState
  let _originalStopOrder = null;

  const TSPSolver = {
    calculateDistance: function(stop1, stop2) {
      if (!stop1.lat || !stop1.lon || !stop2.lat || !stop2.lon) return Infinity;
      const dist = window.WandrUtils.haversine(stop1.lat, stop1.lon, stop2.lat, stop2.lon);
      return Math.round(dist * 100) / 100; // clamp to 2 decimal places
    },
    calculateTotalDistance: function(stops, origin) {
      if (stops.length === 0) return 0;
      let total = 0;
      let prev = origin;
      for (const stop of stops) {
        total += this.calculateDistance(prev, stop);
        prev = stop;
      }
      total += this.calculateDistance(prev, origin); // back to origin
      return total;
    },
    permute: function(arr) {
      if (arr.length <= 1) return [arr];
      const result = [];
      for (let i = 0; i < arr.length; i++) {
        const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
        for (const p of this.permute(rest)) {
          result.push([arr[i], ...p]);
        }
      }
      return result;
    },
    bruteForce: function(stops, origin) {
      if (stops.length <= 1) return [...stops];
      const indices = stops.map((_, i) => i);
      const perms = this.permute(indices);
      let bestPerm = null;
      let bestDist = Infinity;
      for (const perm of perms) {
        const ordered = perm.map(i => stops[i]);
        const dist = this.calculateTotalDistance(ordered, origin);
        if (dist < bestDist) {
          bestDist = dist;
          bestPerm = ordered;
        }
      }
      return bestPerm || [...stops];
    },
    nearestNeighbor: function(stops, origin) {
      if (stops.length <= 1) return [...stops];
      const remaining = [...stops];
      const ordered = [];
      let current = origin;
      while (remaining.length > 0) {
        let nearestIdx = 0;
        let nearestDist = Infinity;
        for (let i = 0; i < remaining.length; i++) {
          const d = this.calculateDistance(current, remaining[i]);
          if (d < nearestDist) {
            nearestDist = d;
            nearestIdx = i;
          }
        }
        const next = remaining.splice(nearestIdx, 1)[0];
        ordered.push(next);
        current = next;
      }
      return ordered;
    },
    twoOptImprove: function(stops, origin) {
      if (stops.length <= 2) return [...stops];
      let improved = [...stops];
      let improvedDist = this.calculateTotalDistance(improved, origin);
      let changed = true;
      let iterations = 0;
      const MAX_ITERATIONS = 1000;
      while (changed && iterations < MAX_ITERATIONS) {
        changed = false;
        for (let i = 0; i < improved.length - 1; i++) {
          for (let j = i + 1; j < improved.length; j++) {
            const candidate = [...improved];
            [candidate[i], candidate[j]] = [candidate[j], candidate[i]];
            const candidateDist = this.calculateTotalDistance(candidate, origin);
            if (candidateDist < improvedDist) {
              improved = candidate;
              improvedDist = candidateDist;
              changed = true;
            }
          }
        }
        iterations++;
      }
      return improved;
    },
    optimize: function(stops, origin) {
      if (stops.length <= 8) {
        return this.bruteForce(stops, origin);
      } else {
        let optimized = this.nearestNeighbor(stops, origin);
        optimized = this.twoOptImprove(optimized, origin);
        return optimized;
      }
    }
  };

  const RoutingMetrics = {
    buildCacheKey: function(coordinates, profile) {
      // coordinates: [[lat,lon], [lat,lon]]
      const [from, to] = coordinates;
      return [
        profile,
        Number(from[0]).toFixed(5),
        Number(from[1]).toFixed(5),
        Number(to[0]).toFixed(5),
        Number(to[1]).toFixed(5)
      ].join(':');
    },
    getCached: function(cacheKey) {
      const cached = _routeMetricsCache[cacheKey];
      if (!cached) return null;
      if ((Date.now() - cached.ts) > CACHE_TTL_MS) {
        delete _routeMetricsCache[cacheKey];
        if (global.WandrStorage) global.WandrStorage.saveRouteMetricsCache(_routeMetricsCache);
        return null;
      }
      return cached.data || null;
    },
    setCached: function(cacheKey, metrics) {
      _routeMetricsCache[cacheKey] = { ts: Date.now(), data: metrics };
      if (global.WandrStorage) global.WandrStorage.saveRouteMetricsCache(_routeMetricsCache);
    },
    fetch: async function(coordinates, profile) {
      const cacheKey = this.buildCacheKey(coordinates, profile);
      const cached = this.getCached(cacheKey);
      if (cached) return cached;

      if (_routeMetricsInflight.has(cacheKey)) {
        return _routeMetricsInflight.get(cacheKey);
      }

      const [from, to] = coordinates;
      const url = `https://router.project-osrm.org/route/v1/${profile}/${from[1]},${from[0]};${to[1]},${to[0]}?overview=false`;

      const request = fetch(url, { method: 'GET' })
        .then(resp => {
          if (!resp.ok) throw new Error(`OSRM ${resp.status}`);
          return resp.json();
        })
        .then(data => {
          const route = data && data.routes && data.routes[0];
          if (!route || typeof route.distance !== 'number' || typeof route.duration !== 'number') {
            throw new Error('OSRM invalid response');
          }
          const metrics = {
            distance: route.distance / 1000, // km
            duration: route.duration // seconds
          };
          this.setCached(cacheKey, metrics);
          return metrics;
        })
        .catch(error => {
          console.warn('OSRM fetch failed:', error);
          // Graceful degradation: return null
          return null;
        })
        .finally(() => {
          _routeMetricsInflight.delete(cacheKey);
        });

      _routeMetricsInflight.set(cacheKey, request);
      return request;
    },
    hydrateSeparators: function(stops, transport, origin) {
      // This will be called from wandr.js after optimization
      // For now, stub - implementation in wandr.js will call fetch for each pair
      return Promise.resolve();
    }
  };

  const RouteState = {
    saveOriginalOrder: function(stops) {
      _originalStopOrder = JSON.parse(JSON.stringify(stops)); // deep copy
    },
    restoreOriginalOrder: function() {
      if (!_originalStopOrder) {
        throw new Error('No saved original order to restore');
      }
      const original = [..._originalStopOrder];
      _originalStopOrder = null; // single-use undo
      return original;
    },
    isOptimized: function(currentStops) {
      return _originalStopOrder !== null;
    }
  };

  Wandr.Routing.TSPSolver = TSPSolver;
  Wandr.Routing.RoutingMetrics = RoutingMetrics;
  Wandr.Routing.RouteState = RouteState;
})(window);