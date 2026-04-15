(function (global) {
  const utils = global.WandrUtils = global.WandrUtils || {};

  function estimateTravelTime(km, transport) {
    const speeds = { walking: 5, transit: 20, taxi: 30, driving: 40 };
    const speed = speeds[transport] || 5;
    const minutes = Math.round((km / speed) * 60);
    if (minutes < 1) return '<1min';
    if (minutes < 60) return `${minutes}min`;
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hrs}h ${mins}min` : `${hrs}h`;
  }

  function osrmProfileForTransport(transport) {
    return ({ walking: 'foot', taxi: 'driving', driving: 'driving' })[transport] || null;
  }

  function googleMapsMode(transport) {
    return ({
      walking: 'walking',
      transit: 'transit',
      taxi: 'driving',
      driving: 'driving'
    })[transport] || 'transit';
  }

  function transportClass(transport) {
    return ({
      walking: 'transport-walking',
      transit: 'transport-transit',
      taxi: 'transport-taxi',
      driving: 'transport-driving'
    })[transport] || 'transport-transit';
  }

  function transportIcon(transport) {
    return ({
      walking: '🚶',
      transit: '🚌',
      taxi: '🚕',
      driving: '🚗'
    })[transport] || '🚌';
  }

  function transportLabel(transport) {
    return ({
      walking: 'Caminando',
      transit: 'Transporte público',
      taxi: 'Taxi/Uber',
      driving: 'Auto'
    })[transport] || 'Transporte';
  }

  utils.estimateTravelTime = estimateTravelTime;
  utils.osrmProfileForTransport = osrmProfileForTransport;
  utils.googleMapsMode = googleMapsMode;
  utils.transportClass = transportClass;
  utils.transportIcon = transportIcon;
  utils.transportLabel = transportLabel;
})(window);
