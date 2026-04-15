(function (global) {
  const renderNs = global.WandrRender = global.WandrRender || {};
  const ovCityColors = ['#4A7BF7','#7fcfb8','#e8b86d','#e87d7d','#a78bfa','#38bdf8','#f472b6'];

  function renderOverview() {
    const el = document.getElementById('overview-content');
    if (!el) return;
    const trip = trips.find(t => t.id === currentTripId);
    if (!trip) { el.innerHTML = '<p style="color:var(--danger);padding:20px">Error: viaje no encontrado.</p>'; return; }

    const sortedCities = [...(trip.cities || [])].filter(ci => !ci.dayTrip).sort((a, b) => a.startDate.localeCompare(b.startDate));
    const totalCities = sortedCities.length;
    const totalNights = sortedCities.reduce((acc, ci) => {
      const s = new Date(ci.startDate + 'T00:00:00');
      const e = new Date(ci.endDate + 'T00:00:00');
      return acc + Math.round((e - s) / 86400000);
    }, 0);
    const totalPassajes = (trip.tickets || []).filter(tk => !tk.stub).length;

    const tripS = new Date(trip.startDate + 'T00:00:00');
    const tripE = new Date(trip.endDate + 'T00:00:00');
    const totalDays = Math.round((tripE - tripS) / 86400000) + 1;

    function getTransitDates(city) {
      const set = new Set();
      (trip.tickets || []).forEach(tk => {
        if (tk.depDate >= city.startDate && tk.depDate <= city.endDate) set.add(tk.depDate);
        if (tk.arrDate >= city.startDate && tk.arrDate <= city.endDate) set.add(tk.arrDate);
      });
      return set;
    }

    let html = `
    <div class="ov-wrap">
      <div class="ov-trip-title">${esc(trip.name)}</div>
      <div class="ov-global-dates">
        <span>${formatDate(trip.startDate)}</span>
        <span class="ov-arrow">→</span>
        <span>${formatDate(trip.endDate)}</span>
        <span class="ov-days-pill">${totalDays} día${totalDays !== 1 ? 's' : ''}</span>
      </div>
      <div class="ov-stats">
        <div class="ov-stat"><div class="ov-stat-n">${totalCities}</div><div class="ov-stat-l">Ciudad${totalCities !== 1 ? 'es' : ''}</div></div>
        <div class="ov-stat"><div class="ov-stat-n">${totalNights}</div><div class="ov-stat-l">Noche${totalNights !== 1 ? 's' : ''}</div></div>
        <div class="ov-stat"><div class="ov-stat-n">${totalPassajes}</div><div class="ov-stat-l">Pasaje${totalPassajes !== 1 ? 's' : ''}</div></div>
      </div>`;

    sortedCities.forEach((city, ci) => {
      const color = ovCityColors[ci % ovCityColors.length];
      const transitDates = getTransitDates(city);
      const stopsByDate = {};
      (city.days || []).forEach(d => { if (d.stops?.length) stopsByDate[d.date] = d.stops.length; });

      const dayChips = (city.days || []).map(d => {
        const isTransit = transitDates.has(d.date);
        const hasStops = !!stopsByDate[d.date];
        const wd = new Date(d.date + 'T00:00:00').toLocaleDateString('es-AR', { weekday: 'short' }).slice(0, 3).toLowerCase();
        const dd = d.date.slice(8);
        const weatherData = window._weatherCache && window._weatherCache[city.id] && window._weatherCache[city.id].days ? window._weatherCache[city.id].days[d.date] : null;
        const weatherHtml = window.Wandr && window.Wandr.WeatherService ? window.Wandr.WeatherService.buildWeatherChipHtml(weatherData) : '';
        const cls = ['ov-day-chip', isTransit ? 'transit' : (hasStops ? 'has' : '')].filter(Boolean).join(' ');
        const cityIdx = trip.cities.findIndex(c => c.id === city.id);
        const dayIdx = (city.days || []).findIndex(d2 => d2.date === d.date);
        return `<div class="${cls}" onclick="ovGoToDay(${cityIdx},${dayIdx})">
          <span class="ov-dc-wd">${wd}</span>
          <span class="ov-dc-dd">${dd}</span>
          ${weatherHtml}
          <span class="ov-dc-dot"></span>
        </div>`;
      }).join('');

      const nightCount = Math.round((new Date(city.endDate + 'T00:00:00') - new Date(city.startDate + 'T00:00:00')) / 86400000);

      let hotelHtml;
      if (city.hotelName) {
        const times = [
          city.checkInTime ? `✅ ${city.checkInTime}` : '',
          city.checkOutTime ? `🚪 ${city.checkOutTime}` : '',
        ].filter(Boolean).join(' · ');
        const hotelMapsUrl = city.hotelAddr ? mapsUrl(city.hotelAddr) : (city.hotelName ? mapsUrl(city.hotelName) : '');
        hotelHtml = `<div class="ov-hotel-row">
          <span class="ov-h-icon">🏨</span>
          <div class="ov-h-info">
            <div class="ov-h-name">${esc(city.hotelName)}</div>
            ${city.hotelAddr ? `<div class="ov-h-addr">${esc(city.hotelAddr)}</div>` : ''}
          </div>
          ${times ? `<div class="ov-h-times">${times}</div>` : ''}
          ${hotelMapsUrl ? `<a class="ov-h-maps" href="${hotelMapsUrl}" target="_blank" title="Ver en Maps">📌</a>` : ''}
        </div>`;
      } else {
        hotelHtml = `<div class="ov-no-hotel">
          <span style="font-size:13px">🏨</span>
          <span class="ov-no-hotel-txt">Sin hotel asignado</span>
        </div>`;
      }

      html += `
      <div class="ov-city-card" onclick="this.classList.toggle('ov-city-open')">
        <div class="ov-city-head">
          <div class="ov-city-dot" style="background:${color}"></div>
          <div class="ov-city-nm">${esc(city.name)}</div>
          <div class="ov-nights-badge">${nightCount} noche${nightCount !== 1 ? 's' : ''}</div>
          <span class="ov-city-chevron">▼</span>
        </div>
        <div class="ov-city-dates">${formatDate(city.startDate)} → ${formatDate(city.endDate)}</div>
        <div class="ov-city-details">
          <div class="ov-day-strip">${dayChips}</div>
          ${hotelHtml}
        </div>
      </div>`;

      if (ci < sortedCities.length - 1) {
        const nextCity = sortedCities[ci + 1];
        const connector = (trip.tickets || []).find(tk =>
          tk.fromCity === city.name && tk.toCity === nextCity.name
        );
        let badgeContent, badgeClass = 'ov-tr-badge';
        if (connector && connector.type) {
          const icon = ticketTypeIcon(connector.type);
          const label = ticketTypeLabel(connector.type);
          badgeContent = `${icon} ${label} · ${esc(city.name)} → ${esc(nextCity.name)}`;
        } else if (connector) {
          badgeContent = `🎫 Pasaje pendiente · ${esc(city.name)} → ${esc(nextCity.name)}`;
          badgeClass += ' ov-tr-stub';
        } else {
          badgeContent = `${esc(city.name)} → ${esc(nextCity.name)}`;
          badgeClass += ' ov-tr-stub';
        }
        html += `<div class="ov-transit-row">
          <div class="ov-tr-line"></div>
          <div class="${badgeClass}">${badgeContent}</div>
          <div class="ov-tr-line"></div>
        </div>`;
      }
    });

    html += `
      <div class="ov-legend">
        <div class="ov-leg-item"><span class="ov-leg-dot" style="background:var(--accent);opacity:0.9"></span>Con paradas</div>
        <div class="ov-leg-item"><span class="ov-leg-dot" style="background:rgba(232,184,109,0.3);border:1px solid var(--accent3)"></span>Tránsito</div>
        <div class="ov-leg-item"><span class="ov-leg-dot" style="background:var(--border)"></span>Sin paradas</div>
      </div>
    </div>`;

    el.innerHTML = html;

    sortedCities.forEach((city, ci) => {
      (window.Wandr && window.Wandr.WeatherService ? window.Wandr.WeatherService.getWeatherForCity(city, trip) : Promise.resolve(null)).then(weatherData => {
        if (!weatherData || !weatherData.days) return;
        const cityCards = el.querySelectorAll('.ov-city-card');
        if (!cityCards[ci]) return;
        const dayStrip = cityCards[ci].querySelector('.ov-day-strip');
        if (!dayStrip) return;
        const chips = dayStrip.querySelectorAll('.ov-day-chip');
        (city.days || []).forEach((d, dayIdx) => {
          if (dayIdx >= chips.length) return;
          const dayData = weatherData.days[d.date];
          if (!dayData) return;
          const wmo = window.Wandr && window.Wandr.WeatherService ? window.Wandr.WeatherService.mapWmoCode(dayData.wmoCode) : { icon: '' };
          const chip = chips[dayIdx];
          const dot = chip.querySelector('.ov-dc-dot');
          if (dot) {
            dot.textContent = wmo.icon;
            dot.style.fontSize = '0.7rem';
          }
        });
      }).catch(() => {});
    });
  }

  function ovGoToDay(cityIdx, dayIdx) {
    appStore.selectCityDay(cityIdx, dayIdx);
    switchDetailTab('itinerary');
    renderDetail();
    window.scrollTo(0, 0);
  }

  renderNs.renderOverview = renderOverview;
  renderNs.ovGoToDay = ovGoToDay;
})(window);
