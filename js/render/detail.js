(function (global) {
  const renderNs = global.WandrRender = global.WandrRender || {};

  function renderDetail() {
    try {
      const trip = trips.find(t => t.id === currentTripId);
      if (!trip) { document.getElementById('detail-content').innerHTML = '<p style="color:var(--danger);padding:20px">Error: viaje no encontrado.</p>'; return; }

      const city = trip.cities[currentCityIdx] || trip.cities[0];
      if (!city) { document.getElementById('detail-content').innerHTML = '<p style="color:var(--danger);padding:20px">Error: no hay ciudades en este viaje.</p>'; return; }

      const stopsMap = {};
      (city.days || []).forEach(d => { if (d.stops?.length) stopsMap[d.date] = d.stops; });
      const correctDays = window.Wandr.Cities.buildDays(city.startDate, city.endDate).map(d => ({
        ...d, stops: stopsMap[d.date] || []
      }));
      if (JSON.stringify(city.days?.map(d => d.date)) !== JSON.stringify(correctDays.map(d => d.date))) {
        city.days = correctDays;
        save();
      } else {
        city.days = correctDays;
      }

      appStore.ensureCurrentDayInRange(city.days.length);
      const day = city.days[currentDayIdx];
      if (!day) { document.getElementById('detail-content').innerHTML = '<p style="color:var(--danger);padding:20px">Error: día no encontrado.</p>'; return; }

      const stops = day.stops || [];
      const tripTickets = trip.tickets || [];
      const transitDaysSet = new Set();
      tripTickets.forEach(tk => {
        const depDate = tk.depDate;
        const arrDate = tk.arrDate;
        if (depDate >= city.startDate && depDate <= city.endDate) transitDaysSet.add(depDate);
        if (arrDate >= city.startDate && arrDate <= city.endDate) transitDaysSet.add(arrDate);
      });

      const cityTabs = isLoadingCountryCodes
        ? trip.cities.map((ci, i) => `
          <div class="city-tab city-tab-skeleton ${i === currentCityIdx ? 'active' : ''}" onclick="switchCity(${i})">
            <div class="city-tab-content">
              <div class="city-info">
                <div class="skeleton-flag"></div>
                <div class="skeleton-name"></div>
              </div>
              <div class="skeleton-duration"></div>
            </div>
          </div>
        `).join('')
        : trip.cities.map((ci, i) => {
          const nightCount = ci.dayTrip ? 0
            : Math.round((new Date(ci.endDate + 'T00:00:00') - new Date(ci.startDate + 'T00:00:00')) / 86400000);
          const nightsLabel = ci.dayTrip ? 'excursión' : `${nightCount} noche${nightCount !== 1 ? 's' : ''}`;
          const flagImg = ci.countryCode ? `<img src="https://flagcdn.com/w20/${ci.countryCode.toLowerCase()}.png" class="city-flag" alt="${ci.countryCode.toUpperCase()}" onerror="this.style.display='none'" />` : '';
          return `<div class="city-tab ${i === currentCityIdx ? 'active' : ''} ${ci.dayTrip ? 'daytrip' : ''}" onclick="switchCity(${i})">
            <div class="city-tab-content">
              <div class="city-info">
                ${flagImg}
                <span class="city-name">${ci.dayTrip ? '🗺️ ' : ''}${esc(ci.name)}</span>
              </div>
              <div class="city-duration">${nightsLabel}</div>
            </div>
          </div>`;
        }).join('');

      const dayTabs = city.days.map((d, i) => {
        const isTransit = transitDaysSet.has(d.date);
        return `<div class="day-tab ${i === currentDayIdx ? 'active' : ''} ${isTransit ? 'transit' : ''}" onclick="switchDay(${i})">
          <small>${isTransit ? '✈' : getWeekday(d.date)}</small><strong>${d.date.slice(8)}</strong>
        </div>`;
      }).join('');

      let stopsHtml = '';

      const todayArrivalTickets = tripTickets.filter(tk =>
        tk.arrDate === day.date && tk.toCity === city.name
      );
      const todayArrival = todayArrivalTickets[0] || null;

      const todayDepartureTickets = tripTickets.filter(tk =>
        tk.depDate === day.date && tk.fromCity === city.name
      );
      const todayDeparture = todayDepartureTickets[0] || null;

      const dayHasArrival = !!(todayArrival && city.hotelName && (todayArrival.type || todayArrival.arrTerminal || todayArrival.toTerminal));

      if (todayArrival && (todayArrival.type || todayArrival.arrTerminal || todayArrival.toTerminal)) {
        const terminalName = todayArrival.arrTerminalFull || todayArrival.arrTerminal || todayArrival.toTerminal || null;
        const terminalLabel = terminalName || ticketTypeLabel(todayArrival.type) + ' llegada';
        const arrTimeStr = todayArrival.arrTime ? ` · ${todayArrival.arrTime}` : '';
        const dest = city.hotelAddr || city.hotelName;
        const routeTerminalToHotel = terminalName && dest
          ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(terminalName)}&destination=${encodeURIComponent(dest)}&travelmode=transit`
          : null;
        stopsHtml += `<div class="transit-separator">
          <div class="transit-separator-label">Llegada a la ciudad</div>
        </div>
        <div class="stop-item stop-transit">
          <div class="stop-connector">
            <div class="stop-dot transit-dot" style="background:rgba(127,207,184,0.2);border:2px solid var(--accent2);font-size:0.82rem">${ticketTypeIcon(todayArrival.type)}</div>
            ${(stops.length || dayHasArrival) ? '<div class="stop-line"></div>' : ''}
          </div>
          <div class="stop-body">
            <span class="transport-badge ${ticketTransportClass(todayArrival.type)}">${ticketTypeIcon(todayArrival.type)} ${ticketTypeLabel(todayArrival.type)}</span>
            <div class="stop-name" style="margin-top:6px">${esc(terminalLabel)}</div>
            <div class="stop-meta">
              <span style="color:var(--accent2)">Punto de llegada${arrTimeStr}</span>
              ${todayArrival.company ? `<span>${esc(todayArrival.company)}</span>` : ''}
            </div>
            <div class="stop-actions">
              ${terminalName ? `<a class="btn-maps" href="${mapsUrl(terminalName)}" target="_blank">📌 Ver en Maps</a>` : ''}
              ${routeTerminalToHotel ? `<a class="btn-maps btn-return-chip" href="${routeTerminalToHotel}" target="_blank">🏨 Cómo llegar al hotel</a>` : ''}
            </div>
          </div>
        </div>`;

        if (city.hotelName) {
          const hotelRouteFromTerminal = terminalName && city.hotelAddr
            ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(terminalName)}&destination=${encodeURIComponent(city.hotelAddr)}&travelmode=transit`
            : null;
          const isFirstDayOfTrip = day.date === city.startDate;
          const isLastDayOfTrip = day.date === city.endDate;

          let hotelMeta = '';
          if (isFirstDayOfTrip && city.checkInTime) {
            hotelMeta = `<span class="hotel-time-tag checkin">✅ Check-in ${city.checkInTime}</span>`;
          } else if (isFirstDayOfTrip && !city.checkInTime) {
            hotelMeta = `<span class="hotel-time-tag checkin-empty" onclick="openEditHotelModal()">✅ Agregar check-in</span>`;
          } else if (isLastDayOfTrip && city.checkOutTime) {
            hotelMeta = `<span class="hotel-time-tag checkout">🚪 Check-out ${city.checkOutTime}</span>`;
          } else if (isLastDayOfTrip && !city.checkOutTime) {
            hotelMeta = `<span class="hotel-time-tag checkout-empty" onclick="openEditHotelModal()">🚪 Agregar check-out</span>`;
          } else {
            hotelMeta = `<span style="color:var(--accent2)">Hotel</span>`;
          }

          stopsHtml += `<div class="stop-item">
            <div class="stop-connector">
              <div class="stop-dot hotel">🏨</div>
              ${stops.length ? '<div class="stop-line"></div>' : ''}
            </div>
            <div class="stop-body">
              <div class="stop-name">${esc(city.hotelName)}</div>
              <div class="stop-meta">
                ${hotelMeta}
                ${city.hotelAddr ? `<span>📍 ${esc(city.hotelAddr)}</span>` : ''}
              </div>
              <div class="stop-actions">
                ${city.hotelAddr ? `<a class="btn-maps" href="${mapsUrl(city.hotelAddr)}" target="_blank">📌 Ver en Maps</a>` : ''}
                ${hotelRouteFromTerminal ? `<a class="btn-maps btn-return-chip" href="${hotelRouteFromTerminal}" target="_blank">📍 Cómo llegar</a>` : ''}
              </div>
            </div>
          </div>`;
        }
      } else if (city.hotelName) {
        const isFirstDayOfTrip = day.date === city.startDate;
        const isLastDayOfTrip = day.date === city.endDate;

        let hotelMeta = '';
        if (isFirstDayOfTrip && city.checkInTime) {
          hotelMeta = `<span class="hotel-time-tag checkin">✅ Check-in ${city.checkInTime}</span>`;
        } else if (isFirstDayOfTrip && !city.checkInTime) {
          hotelMeta = `<span class="hotel-time-tag checkin-empty" onclick="openEditHotelModal()">✅ Agregar check-in</span>`;
        } else if (isLastDayOfTrip && city.checkOutTime) {
          hotelMeta = `<span class="hotel-time-tag checkout">🚪 Check-out ${city.checkOutTime}</span>`;
        } else if (isLastDayOfTrip && !city.checkOutTime) {
          hotelMeta = `<span class="hotel-time-tag checkout-empty" onclick="openEditHotelModal()">🚪 Agregar check-out</span>`;
        } else {
          hotelMeta = `<span style="color:var(--accent2)">Punto de partida</span>`;
        }

        stopsHtml += `<div class="stop-item">
          <div class="stop-connector">
            <div class="stop-dot hotel">🏨</div>
            ${stops.length ? '<div class="stop-line"></div>' : ''}
          </div>
          <div class="stop-body">
            <div class="stop-name">${esc(city.hotelName)}</div>
            <div class="stop-meta">
              ${hotelMeta}
              ${city.hotelAddr ? `<span>📍 ${esc(city.hotelAddr)}</span>` : ''}
            </div>
            <div class="stop-actions">
              ${city.hotelAddr ? `<a class="btn-maps" href="${mapsUrl(city.hotelAddr)}" target="_blank">📌 Ver en Maps</a></div>` : ''}
            </div>
          </div>
        </div>`;
      }

      // Render stops with separators between them
      stops.forEach((stop, idx) => {
        const isLast = idx === stops.length - 1;
        const isVisuallyLast = isLast && !dayHasArrival && !todayDeparture;
        const hotelOrigin = city.hotelAddr || city.hotelName || city.name;

        // ALWAYS render separator before this stop
        if (idx === 0) {
          // First stop: separator from hotel
          if (city.hotelLat && city.hotelLon && stop.lat && stop.lon) {
            const distText = formatDistance(haversine(city.hotelLat, city.hotelLon, stop.lat, stop.lon));
            const timeText = estimateTravelTime(haversine(city.hotelLat, city.hotelLon, stop.lat, stop.lon), stop.transport);
            const tpLabel = transportLabel(stop.transport);
            stopsHtml += `<div class="stop-dist-separator">
              <div class="stop-dist-separator-line"></div>
              <span class="stop-dist-separator-text" data-stop-id="${stop.id}" data-from-id="hotel">🏨 ${distText} · ~${timeText} · ${tpLabel}</span>
              <div class="stop-dist-separator-line"></div>
            </div>`;
          }
        } else {
          // Other stops: separator from previous stop
          const prevStop = stops[idx - 1];
          if (prevStop && prevStop.lat && prevStop.lon && stop.lat && stop.lon) {
            const distText = formatDistance(haversine(prevStop.lat, prevStop.lon, stop.lat, stop.lon));
            const timeText = estimateTravelTime(haversine(prevStop.lat, prevStop.lon, stop.lat, stop.lon), stop.transport);
            const tpLabel = transportLabel(stop.transport);
            stopsHtml += `<div class="stop-dist-separator">
              <div class="stop-dist-separator-line"></div>
              <span class="stop-dist-separator-text" data-stop-id="${stop.id}" data-from-id="${prevStop.id}">${transportIcon(stop.transport)} ${distText} · ~${timeText} · ${tpLabel}</span>
              <div class="stop-dist-separator-line"></div>
            </div>`;
          }
        }

        // NOW render the stop
        let originCoords = null;
        let originName = null;

        if (idx === 0) {
          originName = hotelOrigin;
          if (city.hotelLat && city.hotelLon) {
            originCoords = { lat: city.hotelLat, lon: city.hotelLon };
          }
        } else {
          const prevStop = stops[idx - 1];
          if (prevStop && prevStop.lat && prevStop.lon) {
            originCoords = { lat: prevStop.lat, lon: prevStop.lon };
          } else if (prevStop) {
            originName = prevStop.address || prevStop.name;
          }
        }

        const gmMode = googleMapsMode(stop.transport);
        let routeUrl = '';
        if (stop.lat && stop.lon && originCoords) {
          routeUrl = `https://www.google.com/maps/dir/?api=1&origin=${originCoords.lat},${originCoords.lon}&destination=${stop.lat},${stop.lon}&travelmode=${gmMode}`;
        } else if (originName && stop.address) {
          routeUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originName)}&destination=${encodeURIComponent(stop.address)}&travelmode=${gmMode}`;
        } else if (stop.address || stop.name) {
          routeUrl = mapsUrl(stop.address || stop.name);
        }

        let returnToHotelUrl = '';
        if (city.hotelAddr || city.hotelName) {
          const hotelDest = city.hotelAddr || city.hotelName;
          if (stop.lat && stop.lon && city.hotelLat && city.hotelLon) {
            returnToHotelUrl = `https://www.google.com/maps/dir/?api=1&origin=${stop.lat},${stop.lon}&destination=${city.hotelLat},${city.hotelLon}&travelmode=transit`;
          } else {
            returnToHotelUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(stop.address || stop.name)}&destination=${encodeURIComponent(hotelDest)}&travelmode=transit`;
          }
        }

        stopsHtml += `<div class="stop-item ${isVisuallyLast ? 'stop-last' : ''}" data-stopid="${stop.id}">
          <div class="drag-handle" title="Arrastrar para reordenar">
            <svg width="14" height="20" viewBox="0 0 14 20" fill="currentColor"><circle cx="4" cy="4" r="1.8"/><circle cx="10" cy="4" r="1.8"/><circle cx="4" cy="10" r="1.8"/><circle cx="10" cy="10" r="1.8"/><circle cx="4" cy="16" r="1.8"/><circle cx="10" cy="16" r="1.8"/></svg>
          </div>
          <div class="stop-connector">
            <div class="stop-dot ${typeDotClass(stop.type)}">${typeIcon(stop.type)}</div>
            ${!isVisuallyLast ? '<div class="stop-line"></div>' : ''}
          </div>
          <div class="stop-body">
            <div class="stop-name" style="margin-top:6px">${esc(stop.name)}</div>
            <div class="stop-meta">
              ${stop.address ? `<span>📍 ${esc(stop.address)}</span>` : ''}
              ${(stop.timeFrom || stop.timeTo) ? `<span>🕐 ${stop.timeFrom || ''}${stop.timeFrom && stop.timeTo ? ' — ' : ''}${stop.timeTo || ''}</span>` : ''}
              ${stop.note ? `<span>💬 ${esc(stop.note)}</span>` : ''}
            </div>
            <div class="stop-actions">
              <a class="btn-maps" href="${routeUrl}" target="_blank">🗺️ Cómo llegar</a>
              <a class="btn-maps" href="${mapsUrl(stop.address || stop.name)}" target="_blank">📌 Ver lugar</a>
              ${returnToHotelUrl ? `<a class="btn-maps btn-return-chip" href="${returnToHotelUrl}" target="_blank">🏨 Volver al hotel</a>` : ''}
              <button class="btn-edit-stop" data-stop-id="${stop.id}" onclick="openEditStopModal(this.dataset.stopId)">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="btn-delete-stop" data-stop-id="${stop.id}" onclick="deleteStop(this.dataset.stopId)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>
        </div>`;
      });

      // Add separator for return to hotel after last stop
      if (stops.length > 0) {
        const lastStop = stops[stops.length - 1];
        if (lastStop.lat && lastStop.lon && city.hotelLat && city.hotelLon) {
          const distText = formatDistance(haversine(lastStop.lat, lastStop.lon, city.hotelLat, city.hotelLon));
          const timeText = estimateTravelTime(haversine(lastStop.lat, lastStop.lon, city.hotelLat, city.hotelLon), lastStop.transport);
          const icon = transportIcon(lastStop.transport);
          const tpLabel = transportLabel(lastStop.transport);
          stopsHtml += `<div class="stop-dist-separator">
            <div class="stop-dist-separator-line"></div>
            <span class="stop-dist-separator-text" data-stop-id="return" data-from-id="${lastStop.id}">${icon} ${distText} · ~${timeText} · ${tpLabel}</span>
            <div class="stop-dist-separator-line"></div>
          </div>`;
        }
      }

      let departureTerminalHtml = '';
      if (todayDeparture && (todayDeparture.type || todayDeparture.depTerminal || todayDeparture.fromTerminal)) {
        const terminalName = todayDeparture.depTerminalFull || todayDeparture.depTerminal || todayDeparture.fromTerminal || null;
        const terminalLabel = terminalName || ticketTypeLabel(todayDeparture.type) + ' salida';
        const depTimeStr = todayDeparture.depTime ? ` · ${todayDeparture.depTime}` : '';
        const gateStr = todayDeparture.depGate ? ` · Puerta ${todayDeparture.depGate}` : '';
        const hotelOrigin = city.hotelAddr || city.hotelName || null;
        const dest = terminalName || null;
        const routeToTerminal = hotelOrigin && dest
          ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(hotelOrigin)}&destination=${encodeURIComponent(dest)}&travelmode=transit`
          : dest ? mapsUrl(dest) : '';

        departureTerminalHtml = `<div class="transit-separator">
          <div class="transit-separator-label">Salida de la ciudad</div>
        </div>
        <div class="stop-item stop-transit">
          <div class="stop-connector">
            <div class="stop-line" style="min-height:14px"></div>
            <div class="stop-dot transit-dot" style="background:rgba(232,184,109,0.2);border:2px solid var(--accent3);font-size:0.82rem">${ticketTypeIcon(todayDeparture.type)}</div>
          </div>
          <div class="stop-body" style="padding-top:4px">
            <span class="transport-badge ${ticketTransportClass(todayDeparture.type)}">${ticketTypeIcon(todayDeparture.type)} ${ticketTypeLabel(todayDeparture.type)}</span>
            <div class="stop-name" style="margin-top:6px">${esc(terminalLabel)}</div>
            <div class="stop-meta">
              ${terminalName ? `<span>📍 ${esc(terminalName)}</span>` : ''}
              <span style="color:var(--accent)">${todayDeparture.company ? esc(todayDeparture.company) + ' · ' : ''}Salida${depTimeStr}${gateStr}</span>
            </div>
            <div class="stop-actions">
              ${routeToTerminal ? `<a class="btn-maps" href="${routeToTerminal}" target="_blank">🗺️ Cómo llegar a la terminal</a>` : ''}
              ${terminalName ? `<a class="btn-maps" href="${mapsUrl(terminalName)}" target="_blank">📌 Ver terminal</a>` : ''}
            </div>
          </div>
        </div>`;
      }

      let arrivalHotelHtml = '';

      if (!stops.length && !city.hotelName && !arrivalHotelHtml && !departureTerminalHtml) {
        stopsHtml = `<div class="empty-state" style="padding:30px 0"><p>Sin paradas aún</p><small>Tocá + para agregar</small></div>`;
      } else if (!stops.length && !city.hotelName && (arrivalHotelHtml || departureTerminalHtml)) {
        stopsHtml = '';
      }

      let routeActionsHtml = '';
      if (stops.length >= 1 && city.hotelAddr) {
        const lastStop = stops[stops.length - 1];
        const midStops = stops.slice(0, -1);
        const wps = midStops.map(s => encodeURIComponent(s.address || s.name)).join('|');
        const mode = googleMapsMode(stops[0].transport);
        const fullUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(city.hotelAddr)}&destination=${encodeURIComponent(lastStop.address || lastStop.name)}${wps ? `&waypoints=${wps}` : ''}&travelmode=${mode}`;
        const retUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(stops[stops.length-1].address || stops[stops.length-1].name)}&destination=${encodeURIComponent(city.hotelAddr)}&travelmode=transit`;
        const isOptimized = window.Wandr && window.Wandr.Routing && window.Wandr.Routing.RouteState 
          ? window.Wandr.Routing.RouteState.isOptimized() 
          : false;
        routeActionsHtml = `<div class="route-actions">
          <button class="btn-optimize" onclick="${isOptimized ? 'restoreStopOrder()' : 'optimizeCurrentStops()'}">
            ${isOptimized ? '↩️ Restaurar orden original' : '✨ Optimizar ruta'}
          </button>
          <a class="btn-full-route" href="${fullUrl}" target="_blank">🗺️ Ruta completa del día en Maps</a>
          <a class="btn-return-hotel" href="${retUrl}" target="_blank">🏨 Volver al hotel</a>
        </div>`;
      }

      const gapBanner = buildGapBanner(trip);

      document.getElementById('detail-content').innerHTML = `
        <div class="trip-header">
          <div class="trip-header-top">
            <div>
              <div class="trip-title">${esc(trip.name)}</div>
              <div class="trip-subtitle">
                <span>📅 ${formatDate(trip.startDate)} → ${formatDate(trip.endDate)}</span>
                <span>🏙️ ${trip.cities.length} ciudad${trip.cities.length !== 1 ? 'es' : ''}</span>
              </div>
            </div>
            <button class="btn-edit-trip-dates" onclick="openEditTripDatesModal()" title="Editar fechas del viaje">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              <span>Editar</span>
            </button>
          </div>
        </div>

        ${gapBanner}

        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div class="section-label" style="margin-top:0">Destino</div>
          ${!gapBanner ? `<button class="btn-add-city-inline" onclick="openAddCityModal()" title="Agregar ciudad o excursión">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Ciudad
          </button>` : ''}
        </div>
        <div class="city-selector-wrap"><div class="city-selector">${cityTabs}</div></div>

        ${(() => {
          if (city.dayTrip) {
            return `<div class="daytrip-banner">
              <div class="daytrip-banner-icon">🗺️</div>
              <div class="daytrip-banner-info">
                <strong>Excursión de día · ${esc(city.name)}</strong>
                <small>${formatDate(city.startDate)}${city.dayTripTransport ? ' · ' + transportIcon(city.dayTripTransport) + ' ' + transportLabel(city.dayTripTransport) : ''}${city.dayTripDepartTime ? ' · Salida ' + city.dayTripDepartTime : ''}${city.dayTripReturnTime ? ' · Regreso ' + city.dayTripReturnTime : ''}</small>
              </div>
            </div>`;
          }
          const isFirstDay = day.date === city.startDate;
          const isLastDay = day.date === city.endDate;
          const hotelLabel = `<div class="section-label" style="margin-bottom:8px">Hotel</div>`;
          if (city.hotelName) {
            const tags = [];
            if (isFirstDay && city.checkInTime) tags.push(`<span class="hotel-time-tag checkin">✅ Check-in ${city.checkInTime}</span>`);
            if (isFirstDay && !city.checkInTime) tags.push(`<span class="hotel-time-tag checkin-empty" onclick="openEditHotelModal()">✅ Agregar check-in</span>`);
            if (isLastDay && city.checkOutTime) tags.push(`<span class="hotel-time-tag checkout">🚪 Check-out ${city.checkOutTime}</span>`);
            if (isLastDay && !city.checkOutTime) tags.push(`<span class="hotel-time-tag checkout-empty" onclick="openEditHotelModal()">🚪 Agregar check-out</span>`);
            return hotelLabel + `<div class="hotel-banner">
              <div class="hotel-banner-icon">🏨</div>
              <div class="hotel-banner-info">
                <strong>${esc(city.hotelName)}</strong>
                <small>${city.hotelAddr ? esc(city.hotelAddr) + ' · ' : ''}${formatDate(city.startDate)} → ${formatDate(city.endDate)}</small>
                ${tags.length ? `<div class="hotel-time-tags">${tags.join('')}</div>` : ''}
              </div>
              <div style="display:flex;gap:6px;flex-shrink:0">
                <button class="btn-edit-hotel" onclick="openEditCityDatesModal()" title="Editar fechas de ${esc(city.name)}">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                </button>
                <button class="btn-edit-hotel" onclick="openEditHotelModal()" title="Editar hotel">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
              </div>
            </div>`;
          }
          return hotelLabel + `<div class="hotel-missing-banner">
            <div style="display:flex;align-items:center;gap:8px;flex:1" onclick="openEditHotelModal()">
              <span>🏨 Sin hotel · ${formatDate(city.startDate)} → ${formatDate(city.endDate)}</span>
              <span class="hotel-missing-add">+ Agregar hotel</span>
            </div>
            <button class="btn-edit-hotel" onclick="openEditCityDatesModal()" title="Editar fechas de ${esc(city.name)}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            </button>
          </div>`;
        })()}

        <div class="section-label" style="margin-bottom:8px">Día</div>
        <div class="days-scroll-wrap">
          <div class="days-scroll" id="days-scroll-el" onscroll="updateDayScrollFades()">${dayTabs}</div>
        </div>

${(() => {
          const cityWeather = window._weatherCache && window._weatherCache[city.id];
          let weatherData = null;
          if (cityWeather) {
            if (cityWeather.outOfRange) {
              weatherData = cityWeather;
            } else if (cityWeather.days) {
              weatherData = cityWeather.days[day.date] || null;
            }
          }
          const weatherHtml = window.Wandr && window.Wandr.WeatherService ? window.Wandr.WeatherService.buildWeatherHtml(weatherData) : '';
          if (weatherHtml) {
            return `<div class="day-info-bar day-info-bar-weather">
              <div>
                <div class="day-label">${getWeekdayFull(day.date)}</div>
                <div class="day-date">${formatDate(day.date)}</div>
              </div>
              <div class="stops-count">${stops.length} parada${stops.length !== 1 ? 's' : ''}</div>
              ${weatherHtml}
            </div>`;
          }
          return `<div class="day-info-bar">
            <div>
              <div class="day-label">${getWeekdayFull(day.date)}</div>
              <div class="day-date">${formatDate(day.date)}</div>
            </div>
            <div class="stops-count">${stops.length} parada${stops.length !== 1 ? 's' : ''}</div>
          </div>`;
        })()}

        <div class="stops-list" id="stops-list-el">${stopsHtml}${routeActionsHtml}${departureTerminalHtml}${arrivalHotelHtml}</div>
      `;

      window.WandrRender.DragDrop.init('#stops-list-el', {
        getItems: () => Array.from(document.querySelectorAll('#stops-list-el .stop-item[data-stopid]')),
        persistOrder: (newOrderIds) => {
          const trip = trips.find(t => t.id === currentTripId);
          const city = trip.cities[currentCityIdx];
          const day = city.days[currentDayIdx];
          // Map IDs back to stop objects
          const newOrder = newOrderIds.map(stopId => 
            day.stops.find(s => s.id === stopId)
          ).filter(Boolean);
          day.stops = newOrder;
          save();
          renderDetail();
        }
      });
      setTimeout(updateDayScrollFades, 0);
      _routeSeparatorRenderToken += 1;
      hydrateRouteSeparators(_routeSeparatorRenderToken);

      if (!window._weatherPrefetching) {
        window._weatherPrefetching = true;
        window.Wandr && window.Wandr.WeatherService ? window.Wandr.WeatherService.prefetchWeather(trip).then(() => {
          if (currentDetailTab === 'itinerary') renderDetail();
        }) : Promise.resolve();
      }
    } catch (err) {
      document.getElementById('detail-content').innerHTML = `<div style="padding:20px;color:var(--danger)">
        <strong>Error al mostrar el viaje:</strong><br><small>${err.message}</small>
      </div>`;
    }
  }

  function updateDayScrollFades() {
    const el = document.getElementById('days-scroll-el');
    if (!el) return;
    const wrap = el.parentElement;
    if (!wrap) return;
    const atStart = el.scrollLeft <= 2;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
    wrap.classList.toggle('scroll-at-start', atStart);
    wrap.classList.toggle('scroll-at-end', atEnd);
  }

  function switchCity(idx) {
    appStore.switchCity(idx);
    renderDetail();
    window.scrollTo(0, 0);
  }

  function switchDay(idx) {
    appStore.switchDay(idx);
    renderDetail();
    window.scrollTo(0, 0);
  }

  renderNs.renderDetail = renderDetail;
  renderNs.updateDayScrollFades = updateDayScrollFades;
  renderNs.switchCity = switchCity;
  renderNs.switchDay = switchDay;
})(window);
