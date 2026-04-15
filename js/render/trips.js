(function (global) {
  const renderNs = global.WandrRender = global.WandrRender || {};

  function renderTrips() {
    const c = document.getElementById('trips-container');
    const today = new Date().toISOString().slice(0, 10);

    if (!trips.length) {
      c.innerHTML = `<div class="empty-state empty-state-rich">
        <div class="empty-state-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        </div>
        <p>Crea tu primer itinerario</p>
        <small>Empieza por las fechas y despues suma ciudades, hoteles y paradas.</small>
      </div>`;
      return;
    }

    c.innerHTML = '<div class="trips-grid">' + trips.map((t, idx) => {
      const cities = t.cities || [];
      const days = cities.reduce((a, ci) => a + (ci.days || []).length, 0);
      const stops = cities.reduce((a, ci) => a + (ci.days || []).reduce((b, d) => b + (d.stops || []).length, 0), 0);
      const totalNights = cities.reduce((acc, ci) => {
        if (ci.dayTrip) return acc;
        const s = new Date(ci.startDate + 'T00:00:00');
        const e = new Date(ci.endDate + 'T00:00:00');
        return acc + Math.round((e - s) / 86400000);
      }, 0);
      const ticketsCount = (t.tickets || []).filter(tk => !tk.stub).length;
      const isPast = t.endDate < today;
      const isOngoing = t.startDate <= today && t.endDate >= today;
      const citiesRow = cities.length
        ? cities.map(ci => cityPillHtml(ci)).join('')
        : `<span class="city-pill" style="opacity:0.5">Sin ciudades</span>`;

      return `<div class="trip-card${isPast ? ' trip-card-past' : ''}${isOngoing ? ' trip-card-ongoing' : ''}" draggable="true" data-trip-id="${t.id}" data-trip-index="${idx}"
        ondragstart="onDragTripStart(event)"
        ondragover="onDragTripOver(event)"
        ondrop="onDropTrip(event)"
        onclick="if(_justDragged){_justDragged=false;return;}openTrip('${t.id}')">
        ${isPast ? '<div class="trip-card-badge">Finalizado</div>' : ''}
        ${isOngoing ? '<div class="trip-card-badge trip-card-badge-ongoing">En curso</div>' : ''}
        <div class="trip-card-drag-handle">::</div>
        <div class="trip-card-accent"></div>
        <h3>${esc(t.name)}</h3>
        <div class="trip-card-meta">
          <span>${formatDate(t.startDate)} - ${formatDate(t.endDate)}</span>
        </div>
        <div class="trip-card-stats">
          <span>${days} dias</span>
          <span class="stat-dot"></span>
          <span>${totalNights} noches</span>
          <span class="stat-dot"></span>
          <span>${stops} paradas</span>
          ${ticketsCount > 0 ? `<span class="stat-dot"></span><span>${ticketsCount} pasajes</span>` : ''}
        </div>
        <div class="cities-pills">${citiesRow}</div>
        <button class="trip-card-delete" onclick="event.stopPropagation();deleteTrip('${t.id}')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
        </button>
      </div>`;
    }).join('') + '</div>';
  }

  renderNs.renderTrips = renderTrips;
})(window);
