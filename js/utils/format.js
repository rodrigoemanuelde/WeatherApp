(function (global) {
  const utils = global.WandrUtils = global.WandrUtils || {};

  function formatDistance(km) {
    if (km < 1) return `${Math.round(km * 1000)}m`;
    if (km < 10) return `${km.toFixed(1)}km`;
    return `${Math.round(km)}km`;
  }

  function formatDurationFromSeconds(seconds) {
    const minutes = Math.round(seconds / 60);
    if (minutes < 1) return '<1min';
    if (minutes < 60) return `${minutes}min`;
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hrs}h ${mins}min` : `${hrs}h`;
  }

  utils.formatDistance = formatDistance;
  utils.formatDurationFromSeconds = formatDurationFromSeconds;
})(window);
