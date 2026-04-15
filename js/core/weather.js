(function (global) {
  const appNs = global.Wandr = global.Wandr || {};
  const service = appNs.WeatherService = appNs.WeatherService || {};

  const WEATHER_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
  let _cache = {};
  let _deps = {
    storage: null,
    fetch: typeof global.fetch === 'function' ? global.fetch.bind(global) : null,
    openModal: typeof global.openModal === 'function' ? global.openModal : () => {},
    showToast: typeof global.showToast === 'function' ? global.showToast : () => {},
    esc: typeof global.esc === 'function' ? global.esc : value => String(value),
    document: global.document || null,
  };

  function init(config = {}) {
    _deps.storage = config.storage || global.WandrStorage || _deps.storage;
    _deps.fetch = config.fetch || _deps.fetch;
    _deps.openModal = config.openModal || _deps.openModal;
    _deps.showToast = config.showToast || _deps.showToast;
    _deps.esc = config.esc || _deps.esc;
    _deps.document = config.document || _deps.document || global.document || null;

    loadWeatherCache();
    return service;
  }

  function loadWeatherCache() {
    _cache = {};
    if (!_deps.storage || typeof _deps.storage.listWeatherCacheEntries !== 'function') {
      return;
    }

    try {
      const entries = _deps.storage.listWeatherCacheEntries();
      if (!Array.isArray(entries)) return;
      const now = Date.now();
      entries.forEach(({ cityId, value }) => {
        if (!cityId || !value || typeof value !== 'object') return;
        if (now - value.ts < WEATHER_CACHE_TTL) {
          _cache[cityId] = value.data;
        }
      });
    } catch (error) {
      // silently ignore cache initialization failures
    }
  }

  function loadWeatherCacheEntry(cityId) {
    if (!cityId || !_deps.storage || typeof _deps.storage.loadWeatherCache !== 'function') return null;
    try {
      const cached = _deps.storage.loadWeatherCache(cityId);
      if (!cached || typeof cached !== 'object') return null;
      if (Date.now() - cached.ts > WEATHER_CACHE_TTL) return null;
      return cached.data || null;
    } catch (error) {
      return null;
    }
  }

  function saveWeatherCacheEntry(cityId, data) {
    if (!cityId || !_deps.storage || typeof _deps.storage.saveWeatherCache !== 'function') return;
    try {
      _deps.storage.saveWeatherCache(cityId, { ts: Date.now(), data });
      _cache[cityId] = data;
    } catch (error) {
      // ignore storage errors
    }
  }

  function normalizeWmo(code) {
    if (code && typeof code === 'object') {
      return {
        icon: code.icon || '🌡️',
        desc: code.desc || code.description || 'Sin datos',
        cls: code.cls || 'weather-unknown'
      };
    }
    const numeric = Number(code);
    const map = {
      0: { icon: '☀️', desc: 'Despejado', cls: 'weather-clear' },
      1: { icon: '🌤️', desc: 'Mayormente despejado', cls: 'weather-mostly-clear' },
      2: { icon: '⛅', desc: 'Parcialmente nublado', cls: 'weather-partly-cloudy' },
      3: { icon: '☁️', desc: 'Nublado', cls: 'weather-overcast' },
      45: { icon: '🌫️', desc: 'Niebla', cls: 'weather-fog' },
      48: { icon: '🌫️', desc: 'Niebla con escarcha', cls: 'weather-fog-rime' },
      51: { icon: '🌦️', desc: 'Llovizna ligera', cls: 'weather-drizzle-light' },
      53: { icon: '🌦️', desc: 'Llovizna moderada', cls: 'weather-drizzle' },
      55: { icon: '🌦️', desc: 'Llovizna densa', cls: 'weather-drizzle-dense' },
      56: { icon: '🌧️', desc: 'Llovizna helante ligera', cls: 'weather-freezing-drizzle-light' },
      57: { icon: '🌧️', desc: 'Llovizna helante densa', cls: 'weather-freezing-drizzle-dense' },
      61: { icon: '🌧️', desc: 'Lluvia ligera', cls: 'weather-rain-light' },
      63: { icon: '🌧️', desc: 'Lluvia moderada', cls: 'weather-rain' },
      65: { icon: '🌧️', desc: 'Lluvia fuerte', cls: 'weather-rain-heavy' },
      66: { icon: '🌧️', desc: 'Lluvia helante ligera', cls: 'weather-freezing-rain-light' },
      67: { icon: '🌧️', desc: 'Lluvia helante fuerte', cls: 'weather-freezing-rain-heavy' },
      71: { icon: '🌨️', desc: 'Nieve ligera', cls: 'weather-snow-light' },
      73: { icon: '🌨️', desc: 'Nieve moderada', cls: 'weather-snow' },
      75: { icon: '🌨️', desc: 'Nieve fuerte', cls: 'weather-snow-heavy' },
      77: { icon: '🌨️', desc: 'Granizo de nieve', cls: 'weather-snow-grains' },
      80: { icon: '🌦️', desc: 'Chubascos ligeros', cls: 'weather-showers-light' },
      81: { icon: '🌧️', desc: 'Chubascos moderados', cls: 'weather-showers' },
      82: { icon: '🌧️', desc: 'Chubascos violentos', cls: 'weather-showers-violent' },
      85: { icon: '🌨️', desc: 'Chubascos de nieve ligeros', cls: 'weather-snow-showers-light' },
      86: { icon: '🌨️', desc: 'Chubascos de nieve fuertes', cls: 'weather-snow-showers-heavy' },
      95: { icon: '⛈️', desc: 'Tormenta', cls: 'weather-thunderstorm' },
      96: { icon: '⛈️', desc: 'Tormenta con granizo ligero', cls: 'weather-thunderstorm-hail-light' },
      99: { icon: '⛈️', desc: 'Tormenta con granizo fuerte', cls: 'weather-thunderstorm-hail-heavy' }
    };
    return map.hasOwnProperty(numeric) ? map[numeric] : { icon: '🌡️', desc: 'Sin datos', cls: 'weather-unknown' };
  }

  function buildPackingSuggestions(hottestMax, coldestMin, rainChance, maxWind) {
    const suggestions = [];
    if (typeof hottestMax === 'number' && hottestMax >= 30) {
      suggestions.push({ icon: '👕', text: 'Ropa bien liviana para el calor (shorts, remeras)' });
      suggestions.push({ icon: '🧴', text: 'Protector solar SPF 50+' });
      suggestions.push({ icon: '🕶️', text: 'Anteojos de sol y sombrero' });
      suggestions.push({ icon: '💧', text: 'Botella de agua' });
    } else if (typeof hottestMax === 'number' && hottestMax >= 25) {
      suggestions.push({ icon: '👕', text: 'Ropa liviana (remeras, pantalones finos)' });
      suggestions.push({ icon: '🧴', text: 'Protector solar' });
      suggestions.push({ icon: '🕶️', text: 'Anteojos de sol' });
    } else if (typeof hottestMax === 'number' && hottestMax >= 20) {
      suggestions.push({ icon: '👕', text: 'Ropa de entretiempo (remeras, pantalones largos)' });
    }

    if (typeof coldestMin === 'number' && coldestMin < 5) {
      suggestions.push({ icon: '🧥', text: 'Campera de invierno bien abrigada (para la noche/frío)' });
      suggestions.push({ icon: '🧣', text: 'Bufanda, guantes térmicos y gorro' });
      suggestions.push({ icon: '🧦', text: 'Medias térmicas gruesas' });
      suggestions.push({ icon: '👕', text: 'Ropa térmica de primera capa' });
    } else if (typeof coldestMin === 'number' && coldestMin < 10) {
      suggestions.push({ icon: '🧥', text: 'Campera abrigada o de invierno (para la noche)' });
      suggestions.push({ icon: '🧣', text: 'Bufanda y guantes' });
      suggestions.push({ icon: '🧢', text: 'Gorro abrigado' });
    } else if (typeof coldestMin === 'number' && coldestMin < 15) {
      suggestions.push({ icon: '🧥', text: 'Campera abrigada o buzo para la noche' });
      suggestions.push({ icon: '🧣', text: 'Bufanda o pañuelo' });
    } else if (typeof coldestMin === 'number' && coldestMin < 20) {
      suggestions.push({ icon: '🧥', text: 'Campera liviana o buzo para la noche' });
    }

    suggestions.push({ icon: '👟', text: 'Zapatillas cómodas para caminar' });

    if (typeof rainChance === 'number' && rainChance > 50) {
      suggestions.push({ icon: '☂️', text: 'Paraguas (alta probabilidad de lluvia)' });
      suggestions.push({ icon: '🧥', text: 'Campera impermeable o chubasquero' });
    } else if (typeof rainChance === 'number' && rainChance > 0) {
      suggestions.push({ icon: '☂️', text: 'Paraguas (opcional si vas a caminar)' });
    }

    if (typeof maxWind === 'number' && maxWind >= 40) {
      suggestions.push({ icon: '💨', text: 'Campera cortaviento (ráfagas fuertes)' });
    } else if (typeof maxWind === 'number' && maxWind >= 25) {
      suggestions.push({ icon: '🧥', text: 'Campera que corte el viento' });
    }

    return suggestions;
  }

  function buildWeatherHtml(dayData) {
    if (!dayData) return '';

    if (dayData.isHistorical) {
      const avgMax = typeof dayData.tempMax === 'number' ? Math.round(dayData.tempMax) + '°' : '';
      const avgMin = typeof dayData.tempMin === 'number' ? Math.round(dayData.tempMin) + '°' : '';
      const tempRange = avgMax && avgMin ? `${avgMax} / ${avgMin}` : avgMax || avgMin || '';
      const precip = typeof dayData.precipAvg === 'number' ? `${dayData.precipAvg}mm` : '';
      const wind = typeof dayData.windSpeed === 'number' ? Math.round(dayData.windSpeed) + ' km/h' : '';
      return `<div class="weather-line weather-historical">
        <span class="weather-icon">📊</span><span class="weather-desc">Clima histórico</span>
        ${tempRange ? `<span class="weather-temp">🌡️ ${tempRange}</span>` : ''}
        ${precip ? `<span class="weather-precip">🌧️ ${precip}</span>` : ''}
        ${wind ? `<span class="weather-wind">💨 ${wind}</span>` : ''}
        <button class="weather-packing-btn" onclick="window.Wandr && window.Wandr.WeatherService && window.Wandr.WeatherService.openPackingModal()">🧳 ¿Qué llevar?</button>
      </div>`;
    }

    if (dayData.outOfRange) {
      const start = dayData.cityStartDate ? formatDate(dayData.cityStartDate) : 'las fechas seleccionadas';
      return `<div class="weather-line weather-out-of-range">
        <span class="weather-icon">📅</span><span class="weather-desc">Pronóstico disponible ~1 semana antes de <strong>${start}</strong></span>
      </div>`;
    }

    if (dayData.wmoCode === null || dayData.wmoCode === undefined) return '';
    const wmo = normalizeWmo(dayData.wmoCode);
    const tempMax = typeof dayData.tempMax === 'number' ? Math.round(dayData.tempMax) + '°' : '';
    const tempMin = typeof dayData.tempMin === 'number' ? Math.round(dayData.tempMin) + '°' : '';
    const tempRange = tempMax && tempMin ? `${tempMax} / ${tempMin}` : tempMax || tempMin || '';
    const precip = typeof dayData.precipProb === 'number' ? `${dayData.precipProb}%` : '';
    const wind = typeof dayData.windSpeed === 'number' ? Math.round(dayData.windSpeed) + ' km/h' : '';
    return `<div class="weather-line">
      <span class="weather-icon">${wmo.icon}</span><span class="weather-desc">${_deps.esc(wmo.desc)}</span>
      ${tempRange ? `<span class="weather-temp">🌡️ ${tempRange}</span>` : ''}
      ${precip ? `<span class="weather-precip">🌧️ ${precip}</span>` : ''}
      ${wind ? `<span class="weather-wind">💨 ${wind}</span>` : ''}
      <button class="weather-packing-btn" onclick="window.Wandr && window.Wandr.WeatherService && window.Wandr.WeatherService.openPackingModal()">🧳 ¿Qué llevar?</button>
    </div>`;
  }

  function buildWeatherChipHtml(dayData) {
    if (!dayData || dayData.outOfRange) return '';
    if (dayData.isHistorical) {
      const tempMax = typeof dayData.tempMax === 'number' ? Math.round(dayData.tempMax) + '°' : '';
      return tempMax ? `<span class="weather-chip weather-historical-chip" title="Clima histórico">📊 ${tempMax}</span>` : '';
    }
    if (dayData.wmoCode === null || dayData.wmoCode === undefined) return '';
    const wmo = normalizeWmo(dayData.wmoCode);
    const tempMax = typeof dayData.tempMax === 'number' ? Math.round(dayData.tempMax) + '°' : '';
    return `<span class="weather-chip" title="${_deps.esc(wmo.desc)}">${_deps.esc(wmo.icon)} ${_deps.esc(tempMax)}</span>`;
  }

  async function fetchOpenMeteo(lat, lon) {
    if (!_deps.fetch) return null;
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max&timezone=auto&forecast_days=16`;
      const res = await _deps.fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || typeof data !== 'object' || !data.daily || typeof data.daily !== 'object') return null;
      const daily = data.daily;
      if (!Array.isArray(daily.time) || !Array.isArray(daily.weather_code) ||
          !Array.isArray(daily.temperature_2m_max) || !Array.isArray(daily.temperature_2m_min) ||
          !Array.isArray(daily.precipitation_probability_max) || !Array.isArray(daily.wind_speed_10m_max)) {
        return null;
      }
      const length = daily.time.length;
      if (daily.weather_code.length !== length || daily.temperature_2m_max.length !== length ||
          daily.temperature_2m_min.length !== length || daily.precipitation_probability_max.length !== length ||
          daily.wind_speed_10m_max.length !== length) {
        return null;
      }
      return data;
    } catch (error) {
      return null;
    }
  }

  async function fetchHistoricalWeather(lat, lon, startDate, endDate) {
    if (!_deps.fetch) return null;
    try {
      const start = new Date(startDate + 'T00:00:00');
      const end = new Date(endDate + 'T00:00:00');
      const historicalCalls = [];
      for (let i = 1; i <= 5; i += 1) {
        const yearStart = new Date(start);
        yearStart.setFullYear(yearStart.getFullYear() - i);
        const yearEnd = new Date(end);
        yearEnd.setFullYear(yearEnd.getFullYear() - i);
        const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${yearStart.toISOString().slice(0, 10)}&end_date=${yearEnd.toISOString().slice(0, 10)}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&timezone=auto`;
        historicalCalls.push(
          _deps.fetch(url)
            .then(r => r.ok ? r.json() : null)
            .catch(() => null)
        );
      }
      const results = await Promise.allSettled(historicalCalls);
      const values = results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
      return values.length ? values : null;
    } catch (error) {
      return null;
    }
  }

  function buildHistoricalAverages(allData, startDate, endDate) {
    if (!Array.isArray(allData) || allData.length === 0) return null;
    const byDay = {};
    allData.forEach(data => {
      if (!data || !data.daily) return;
      const daily = data.daily;
      if (!Array.isArray(daily.time)) return;
      for (let i = 0; i < daily.time.length; i += 1) {
        const date = daily.time[i];
        if (!date) continue;
        const key = date.slice(5);
        const item = byDay[key] = byDay[key] || { maxs: [], mins: [], precip: [], wind: [] };
        if (daily.temperature_2m_max?.[i] !== null && daily.temperature_2m_max?.[i] !== undefined) item.maxs.push(daily.temperature_2m_max[i]);
        if (daily.temperature_2m_min?.[i] !== null && daily.temperature_2m_min?.[i] !== undefined) item.mins.push(daily.temperature_2m_min[i]);
        if (daily.precipitation_sum?.[i] !== null && daily.precipitation_sum?.[i] !== undefined) item.precip.push(daily.precipitation_sum[i]);
        if (daily.wind_speed_10m_max?.[i] !== null && daily.wind_speed_10m_max?.[i] !== undefined) item.wind.push(daily.wind_speed_10m_max[i]);
      }
    });

    const days = {};
    let totalMax = 0;
    let totalMin = 0;
    let totalPrecip = 0;
    let rainyDays = 0;
    let count = 0;
    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');
    const current = new Date(start);

    while (current <= end) {
      const key = `${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
      const dayData = byDay[key];
      const dateKey = current.toISOString().slice(0, 10);
      if (dayData && dayData.maxs.length > 0) {
        const avgMax = Math.round(dayData.maxs.reduce((sum, value) => sum + value, 0) / dayData.maxs.length);
        const avgMin = Math.round(dayData.mins.reduce((sum, value) => sum + value, 0) / dayData.mins.length);
        const avgPrecip = dayData.precip.length > 0 ? Math.round((dayData.precip.reduce((sum, value) => sum + value, 0) / dayData.precip.length) * 10) / 10 : 0;
        const avgWind = dayData.wind.length > 0 ? Math.round(dayData.wind.reduce((sum, value) => sum + value, 0) / dayData.wind.length) : 0;
        const rainyCount = dayData.precip.filter(value => value > 0.5).length;
        days[dateKey] = {
          wmoCode: null,
          tempMax: avgMax,
          tempMin: avgMin,
          precipProb: null,
          windSpeed: avgWind,
          precipAvg: avgPrecip,
          rainyDays: rainyCount,
          totalDays: dayData.precip.length,
          isHistorical: true,
        };
        totalMax += avgMax;
        totalMin += avgMin;
        totalPrecip += avgPrecip;
        rainyDays += rainyCount > 0 ? 1 : 0;
        count += 1;
      }
      current.setDate(current.getDate() + 1);
    }
    if (count === 0) return null;
    return {
      days,
      cityAvg: {
        avgMax: Math.round(totalMax / count),
        avgMin: Math.round(totalMin / count),
        avgPrecip: Math.round((totalPrecip / count) * 10) / 10,
        rainyDays,
        totalDays: count,
      },
      isHistorical: true,
    };
  }

  async function resolveCoordinates(city, trip) {
    if (!city) return null;
    if (city.hotelLat && city.hotelLon) return { lat: city.hotelLat, lon: city.hotelLon };
    const days = Array.isArray(city.days) ? city.days : [];
    for (const day of days) {
      const stops = Array.isArray(day.stops) ? day.stops : [];
      for (const stop of stops) {
        if (stop.lat && stop.lon) return { lat: stop.lat, lon: stop.lon };
      }
    }
    if (!_deps.fetch) return null;
    if (!city.name) return null;
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(city.name)}&limit=1`;
      const res = await _deps.fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) return null;
      return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
    } catch (error) {
      return null;
    }
  }

  async function getWeatherForCity(city, trip) {
    if (!city || !city.id) return null;
    let cached = _cache[city.id] || loadWeatherCacheEntry(city.id);
    if (cached) return cached;

    if (!city.startDate) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const maxForecastDate = new Date(today);
    maxForecastDate.setDate(maxForecastDate.getDate() + 15);
    const cityStartDate = new Date(city.startDate + 'T00:00:00');

    const coords = await resolveCoordinates(city, trip);
    if (!coords) return null;

    if (cityStartDate > maxForecastDate) {
      const historicalData = await fetchHistoricalWeather(coords.lat, coords.lon, city.startDate, city.endDate);
      if (!historicalData) return null;
      const result = buildHistoricalAverages(historicalData, city.startDate, city.endDate);
      if (result) {
        saveWeatherCacheEntry(city.id, result);
        return result;
      }
      return null;
    }

    const data = await fetchOpenMeteo(coords.lat, coords.lon);
    if (!data || !data.daily) return null;

    const daily = data.daily;
    const result = { days: {}, cityAvg: null };
    const length = Array.isArray(daily.time) ? daily.time.length : 0;
    for (let i = 0; i < length; i += 1) {
      result.days[daily.time[i]] = {
        wmoCode: daily.weather_code?.[i] ?? null,
        tempMax: daily.temperature_2m_max?.[i] ?? null,
        tempMin: daily.temperature_2m_min?.[i] ?? null,
        precipProb: daily.precipitation_probability_max?.[i] ?? null,
        windSpeed: daily.wind_speed_10m_max?.[i] ?? null,
      };
    }

    const validMax = (daily.temperature_2m_max || []).filter(value => typeof value === 'number');
    const validMin = (daily.temperature_2m_min || []).filter(value => typeof value === 'number');
    if (validMax.length > 0 && validMin.length > 0) {
      result.cityAvg = {
        avgMax: Math.round(validMax.reduce((a, b) => a + b, 0) / validMax.length),
        avgMin: Math.round(validMin.reduce((a, b) => a + b, 0) / validMin.length),
      };
    }

    saveWeatherCacheEntry(city.id, result);
    return result;
  }

  async function prefetchWeather(trip) {
    if (typeof global.navigator !== 'undefined' && global.navigator.onLine === false) return;
    if (!trip || !Array.isArray(trip.cities)) return;
    const cities = trip.cities.filter(city => city && city.id);
    await Promise.allSettled(cities.map(city => getWeatherForCity(city, trip)));
  }

  function openPackingModal(trip, currentCityIdx, currentDayIdx) {
    const activeTrip = trip || (Array.isArray(global.trips) ? global.trips.find(t => t.id === global.currentTripId) : null);
    if (!activeTrip) return;
    const cityIndex = Number.isInteger(currentCityIdx) ? currentCityIdx : Number(global.currentCityIdx);
    const activeCity = activeTrip.cities?.[cityIndex];
    if (!activeCity) return;

    const cityWeather = _cache[activeCity.id] || loadWeatherCacheEntry(activeCity.id);
    if (!cityWeather) {
      _deps.showToast('⚠️ No hay datos de clima disponibles');
      return;
    }

    const doc = _deps.document;
    if (!doc) return;
    const cityNameEl = doc.getElementById('packing-city-name');
    const packingTempEl = doc.getElementById('packing-temp');
    const packingRainEl = doc.getElementById('packing-rain');
    const packingListEl = doc.getElementById('packing-list');
    if (cityNameEl) cityNameEl.textContent = activeCity.name;

    if (cityWeather.isHistorical) {
      const days = Object.values(cityWeather.days || {});
      const mins = days.map(d => d.tempMin).filter(value => typeof value === 'number');
      const maxs = days.map(d => d.tempMax).filter(value => typeof value === 'number');
      const winds = days.map(d => d.windSpeed).filter(value => typeof value === 'number');
      const precipAvgs = days.map(d => d.precipAvg).filter(value => typeof value === 'number');
      const coldestMin = mins.length ? Math.round(Math.min(...mins)) : null;
      const hottestMax = maxs.length ? Math.round(Math.max(...maxs)) : null;
      const maxWind = winds.length ? Math.round(Math.max(...winds)) : 0;
      const rainDaysCount = precipAvgs.filter(p => p > 1).length;
      const totalDays = precipAvgs.length;
      if (coldestMin === null || hottestMax === null) {
        _deps.showToast('⚠️ No hay datos suficientes');
        return;
      }
      const suggestions = buildPackingSuggestions(hottestMax, coldestMin, totalDays > 0 ? (rainDaysCount / totalDays) * 100 : 0, maxWind);
      if (packingTempEl) packingTempEl.textContent = `${hottestMax}° / ${coldestMin}°`;
      if (packingRainEl) packingRainEl.textContent = totalDays > 0 ? `~${rainDaysCount} de ${totalDays} días con lluvia (promedio histórico)` : 'Sin datos de lluvia';
      if (packingListEl) {
        packingListEl.innerHTML = suggestions.length > 0 ? suggestions.map(s => `<div class="packing-item"><span class="packing-icon">${_deps.esc(s.icon)}</span><span class="packing-text">${_deps.esc(s.text)}</span></div>`).join('') : '<p style="color:var(--text2);font-size:0.85rem">No hay sugerencias específicas.</p>';
      }
    } else {
      const activeDayIndex = Number.isInteger(currentDayIdx) ? currentDayIdx : Number(global.currentDayIdx);
      const day = activeCity.days?.[activeDayIndex];
      if (!day) return;
      const dayData = cityWeather.days?.[day.date];
      if (!dayData || dayData.wmoCode === null || dayData.wmoCode === undefined) {
        if (packingTempEl) packingTempEl.textContent = 'Sin datos';
        if (packingRainEl) packingRainEl.textContent = '';
        if (packingListEl) packingListEl.innerHTML = '<p style="color:var(--text2);font-size:0.85rem">No hay pronóstico para este día.</p>';
        _deps.openModal('modal-packing');
        return;
      }
      const wmo = normalizeWmo(dayData.wmoCode);
      const tempMax = typeof dayData.tempMax === 'number' ? Math.round(dayData.tempMax) + '°' : '';
      const tempMin = typeof dayData.tempMin === 'number' ? Math.round(dayData.tempMin) + '°' : '';
      const dateObj = new Date(day.date + 'T00:00:00');
      const weekday = dateObj.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
      const rainPct = typeof dayData.precipProb === 'number' ? dayData.precipProb : 0;
      const suggestions = buildPackingSuggestions(dayData.tempMax, dayData.tempMin, rainPct, dayData.windSpeed || 0);
      if (packingTempEl) packingTempEl.textContent = `${weekday} · ${wmo.icon} ${tempMax} / ${tempMin}`;
      if (packingRainEl) packingRainEl.textContent = typeof dayData.precipProb === 'number' ? `Probabilidad de lluvia: ${dayData.precipProb}%` : '';
      if (packingListEl) {
        packingListEl.innerHTML = suggestions.length > 0 ? suggestions.map(s => `<div class="packing-item"><span class="packing-icon">${_deps.esc(s.icon)}</span><span class="packing-text">${_deps.esc(s.text)}</span></div>`).join('') : '<p style="color:var(--text2);font-size:0.85rem">Clima agradable, sin recomendaciones especiales.</p>';
      }
    }
    _deps.openModal('modal-packing');
  }

  service.init = init;
  service.getWeatherForCity = getWeatherForCity;
  service.prefetchWeather = prefetchWeather;
  service.fetchOpenMeteo = fetchOpenMeteo;
  service.fetchHistoricalWeather = fetchHistoricalWeather;
  service.buildHistoricalAverages = buildHistoricalAverages;
  service.mapWmoCode = normalizeWmo;
  service.resolveCoordinates = resolveCoordinates;
  service.buildPackingSuggestions = buildPackingSuggestions;
  service.buildWeatherHtml = buildWeatherHtml;
  service.buildWeatherChipHtml = buildWeatherChipHtml;
  service.loadWeatherCache = loadWeatherCacheEntry;
  service.saveWeatherCache = saveWeatherCacheEntry;
  service.openPackingModal = openPackingModal;
})(window);
