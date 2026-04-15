// ══════════════════════════════════════════════════════════════
// MODALS RENDER MODULE
// Domain-organized modal builders and infrastructure
// ══════════════════════════════════════════════════════════════

(function (window) {
  // Initialize namespace
  window.WandrRender = window.WandrRender || {};
  window.WandrRender.Modals = {};

  // ══ BASE INFRASTRUCTURE ══════════════════════════════════════
  
  /**
   * @public Opens a modal by ID (adds 'open' class)
   */
  function openModal(id) {
    document.getElementById(id).classList.add('open');
    if (id === 'modal-backup') {
      updateBackupCount();
      document.getElementById('import-warning').style.display = 'none';
      pendingImportData = null;
    }
  }

  /**
   * @public Closes a modal by ID (removes 'open' class)
   */
  function closeModal(id) {
    document.getElementById(id).classList.remove('open');
    if (id === 'modal-backup') {
      pendingImportData = null;
      document.getElementById('import-warning').style.display = 'none';
      document.getElementById('import-file-input').value = '';
    }
  }

  // ══ TRIP MODALS ══════════════════════════════════════════════
  
  /**
   * @private Wizard step navigation for trip creation
   */
  function wizardGoToStep(step) {
    document.querySelectorAll('.wizard-step').forEach((el, i) => {
      el.classList.toggle('active', i + 1 <= step);
      el.classList.toggle('completed', i + 1 < step);
    });
    document.querySelectorAll('.wizard-content').forEach((el, i) => {
      el.style.display = (i + 1 === step) ? 'block' : 'none';
    });
    if (step === 3) wizardRenderSummary();
  }

  function wizardNextStep(currentStep) {
    if (currentStep === 1) {
      const name = document.getElementById('trip-name').value.trim();
      const start = document.getElementById('trip-start').value;
      const end = document.getElementById('trip-end').value;
      if (!name) { showToast('⚠️ Ingresá el nombre del viaje'); return; }
      if (!start || !end) { showToast('⚠️ Elegí las fechas del viaje'); return; }
      if (end < start) { showToast('⚠️ La fecha fin no puede ser anterior'); return; }
    }
    wizardGoToStep(currentStep + 1);
  }

  function wizardPrevStep(currentStep) {
    wizardGoToStep(currentStep - 1);
  }

  function wizardRenderSummary() {
    const name = document.getElementById('trip-name').value.trim();
    const start = document.getElementById('trip-start').value;
    const end = document.getElementById('trip-end').value;
    
    // Sync DOM values into store
    cityWizard.syncFromDOM();
    const state = cityWizard.getState();
    
    let citiesHtml = '';
    let totalDays = 0;
    state.cityEntries.forEach((id, i) => {
      const entry = state.cityEntryState[id] || {};
      const cityName = entry.name || '';
      const cs = entry.start || '';
      const ce = entry.end || '';
      
      if (cityName && cs && ce) {
        const s = new Date(cs + 'T00:00:00');
        const e = new Date(ce + 'T00:00:00');
        const days = Math.round((e - s) / 86400000) + 1;
        totalDays += days;
        
        citiesHtml += `<span class="city-pill">📍 ${esc(cityName)}</span>`;
      }
    });
    
    document.getElementById('wizard-summary').innerHTML = `
      <div class="wizard-summary-content">
        <div class="summary-section">
          <div class="summary-label">Viaje</div>
          <div class="summary-value">${esc(name)}</div>
        </div>
        <div class="summary-section">
          <div class="summary-label">Fechas</div>
          <div class="summary-value">${formatDate(start)} → ${formatDate(end)}</div>
        </div>
        <div class="summary-section">
          <div class="summary-label">Duración</div>
          <div class="summary-value">${totalDays} día${totalDays !== 1 ? 's' : ''}</div>
        </div>
        <div class="summary-section full-width">
          <div class="summary-label">Ciudades</div>
          <div class="summary-value cities-wrap">${citiesHtml || '<em>Sin ciudades</em>'}</div>
        </div>
      </div>
    `;
  }

  /**
   * Opens modal to create a new trip
   */
  function openNewTripModal() {
    cityWizard.reset();
    const today = new Date().toISOString().slice(0, 10);
    document.getElementById('trip-name').value = '';
    const si = document.getElementById('trip-start');
    const ei = document.getElementById('trip-end');
    si.value = '';
    si.min = today;
    si.max = '';
    ei.value = '';
    ei.min = today;
    ei.max = '';
    document.getElementById('trip-end-error').classList.remove('visible');
    ei.classList.remove('error');
    document.getElementById('cities-list').innerHTML = '';
    const id = uid();
    cityWizard.addCityEntry(id);
    renderCityEntries();
    syncCityMins();
    wizardGoToStep(1);
    openModal('modal-new-trip');
  }

  /**
   * Opens modal to edit trip dates and name
   */
  function openEditTripDatesModal() {
    const trip = trips.find(t => t.id === currentTripId);
    if (!trip) return;
    document.getElementById('edit-trip-name').value = trip.name;
    document.getElementById('edit-trip-start').value = trip.startDate;
    document.getElementById('edit-trip-end').value = trip.endDate;
    document.getElementById('edit-trip-end').min = trip.startDate;
    document.getElementById('edit-trip-end-err').classList.remove('visible');
    
    // Build city date editors
    const section = document.getElementById('edit-trip-cities-section');
    const list = document.getElementById('edit-trip-cities-list');
    if ((trip.cities || []).length > 0) {
      section.style.display = '';
      list.innerHTML = (trip.cities || []).map((ci, i) => `
        <div class="edit-city-date-row">
          <div class="edit-city-name-wrap">
            <span class="edit-city-label">${esc(ci.name)}</span>
            <button class="edit-city-name-btn" onclick="openEditCityNameModal(${i})" title="Editar nombre">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
          </div>
          <div class="edit-city-dates">
            <input type="date" id="edit-trip-city-start-${i}" value="${ci.startDate}" min="${trip.startDate}" max="${trip.endDate}" />
            <span class="edit-city-arrow">→</span>
            <input type="date" id="edit-trip-city-end-${i}" value="${ci.endDate}" min="${trip.startDate}" max="${trip.endDate}" />
          </div>
        </div>
      `).join('');
    } else {
      section.style.display = 'none';
    }
    
    openModal('modal-edit-trip-dates');
  }

  // ══ CITY MODALS ══════════════════════════════════════════════
  
  /**
   * @private Sync city date field constraints with global trip dates
   */
  function syncCityMins() {
    const tripStart = document.getElementById('trip-start').value;
    const tripEnd = document.getElementById('trip-end').value;
    const state = cityWizard.getState();
    state.cityEntries.forEach(id => {
      const csi = document.getElementById('cs-' + id);
      const cei = document.getElementById('ce-' + id);
      if (!csi || !cei) return;
      if (tripStart) csi.min = tripStart;
      if (tripEnd) { csi.max = tripEnd; cei.max = tripEnd; }
      if (csi.value) cei.min = csi.value;
    });
  }

  /**
   * @private Render city entries in the trip creation form
   */
  function renderCityEntries() {
    cityWizard.syncFromDOM();
    
    const state = cityWizard.getState();
    
    document.getElementById('cities-list').innerHTML = state.cityEntries.map((id, i) => {
      let connectorHtml = '';
      if (i > 0) {
        const prevId = state.cityEntries[i - 1];
        const legKey = prevId + '_' + id;
        const legs = state.transitLegs[legKey] || [];
        const hasLegs = legs.length > 0;
        connectorHtml = `
          <div class="transit-connector">
            <div class="transit-connector-line"></div>
            <button class="btn-transit-toggle ${hasLegs ? 'has-legs' : ''}" onclick="toggleTransitLegs('${prevId}','${id}')">
              ${hasLegs ? `✈ ${legs.length} tramo${legs.length > 1 ? 's' : ''}` : '+ Agregar tramos de viaje'}
            </button>
            <div class="transit-connector-line"></div>
          </div>
          ${hasLegs ? renderTransitLegsSection(prevId, id, legs) : ''}
        `;
      }
      const entry = state.cityEntryState[id] || { name: '', hotel: '', addr: '', start: '', end: '' };
      return connectorHtml + `
      <div class="city-entry" id="ce-entry-${id}">
        <div class="city-entry-header">
          <span class="city-entry-num">Ciudad ${i + 1}</span>
          ${state.cityEntries.length > 1 ? `<button class="btn-remove-city" onclick="removeCityEntry('${id}')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>` : ''}
        </div>
        <input type="text" id="cn-${id}" placeholder="Nombre de la ciudad (ej: Bruselas)" maxlength="60" value="${esc(entry.name)}" />
        <div class="city-date-row" style="margin-top:10px">
          <div class="city-date-col">
            <label>Llegada</label>
            <input type="date" id="cs-${id}" onchange="onCityStartChange('${id}')" value="${entry.start}" />
            <div class="error-msg" id="cs-err-${id}"></div>
          </div>
          <div class="city-date-col">
            <label>Salida</label>
            <input type="date" id="ce-${id}" onchange="onCityEndChange('${id}')" value="${entry.end}" />
            <div class="error-msg" id="ce-err-${id}"></div>
          </div>
        </div>
      </div>`;
    }).join('') + `<button class="btn-add-city-inline full" onclick="addCityEntry()">+ Ciudad</button>`;
  }

  /**
   * Opens modal to edit city name and country
   */
  function openEditCityNameModal(cityIndex) {
    const trip = trips.find(t => t.id === currentTripId);
    if (!trip) return;
    
    _editingCityIndex = cityIndex;
    _editingCityId = trip.cities[cityIndex].id;
    const city = trip.cities[cityIndex];
    
    document.getElementById('edit-city-name-input').value = city.name || '';
    document.getElementById('edit-city-country-input').value = city.countryCode || '';
    openModal('modal-edit-city-name');
  }

  /**
   * Opens modal to delete a city from edit view
   */
  function openDeleteCityFromEditModal(cityIndex) {
    const trip = trips.find(t => t.id === currentTripId);
    if (!trip || cityIndex === null) return;

    const city = trip.cities[cityIndex];
    _editingCityIndex = cityIndex;
    _editingCityId = city.id;
    appStore.markCityPendingDelete(city.id);

    document.getElementById('confirm-delete-city-title').textContent = `¿Eliminar ${city.name}?`;
    document.getElementById('confirm-delete-city-body').textContent = 'Se eliminarán todos los días y paradas de esta ciudad. Esta accion no se puede deshacer.';
    openModal('modal-confirm-delete-city');
  }

  /**
   * Opens modal to edit city dates
   */
  function openEditCityDatesModal() {
    const trip = trips.find(t => t.id === currentTripId);
    if (!trip) return;
    const city = trip.cities[currentCityIdx];
    document.getElementById('edit-city-dates-name').textContent = city.name;
    document.getElementById('edit-city-start').value = city.startDate;
    document.getElementById('edit-city-start').min = trip.startDate;
    document.getElementById('edit-city-start').max = trip.endDate;
    document.getElementById('edit-city-end').value = city.endDate;
    document.getElementById('edit-city-end').min = city.startDate;
    document.getElementById('edit-city-end').max = trip.endDate;
    ['edit-city-start-err','edit-city-end-err'].forEach(id =>
      document.getElementById(id).classList.remove('visible')
    );
    document.getElementById('city-dates-timeline').innerHTML = renderCityDatesTimeline(trip, city);
    openModal('modal-edit-city-dates');
  }

  /**
   * @private Render city dates timeline visualization
   */
  function renderCityDatesTimeline(trip, currentCity) {
    if (!trip || !trip.cities || !trip.cities.length) return '';
    
    const tripStart = new Date(trip.startDate + 'T00:00:00');
    const tripEnd = new Date(trip.endDate + 'T00:00:00');
    const totalDays = Math.round((tripEnd - tripStart) / 86400000) + 1;
    
    if (totalDays <= 0 || totalDays > 60) return '';
    
    const sortedCities = [...trip.cities].sort((a, b) => a.startDate.localeCompare(b.startDate));
    const currentCityId = currentCity.id;
    
    let html = `<div class="timeline-container">
      <div class="timeline-label">Viaje: ${formatDate(trip.startDate)} → ${formatDate(trip.endDate)}</div>
      <div class="timeline-bar" style="overflow-x: auto; overflow-y: hidden; white-space: nowrap; padding-bottom: 5px;">`;
    
    for (let i = 0; i < totalDays; i++) {
      const currentDate = new Date(tripStart);
      currentDate.setDate(currentDate.getDate() + i);
      const dateStr = currentDate.toISOString().slice(0, 10);
      const dayNum = currentDate.getDate();
      const weekday = currentDate.toLocaleDateString('es-AR', { weekday: 'short' }).slice(0, 2);
      
      let segmentClass = 'timeline-segment';
      let title = '';
      
      const cityForDay = sortedCities.find(ci => dateStr >= ci.startDate && dateStr <= ci.endDate);
      if (cityForDay) {
        if (cityForDay.id === currentCityId) {
          segmentClass += ' city-active';
          title = currentCity.name;
        } else {
          segmentClass += ' other-city';
          title = cityForDay.name + (cityForDay.dayTrip ? ' (excursión)' : '');
        }
      }
      
      html += `<div class="${segmentClass}" title="${title}" onclick="jumpToCityFromTimeline('${dateStr}')">
        <span class="tl-day">${dayNum}</span>
        <span class="tl-wd">${weekday}</span>
      </div>`;
    }
    
    html += `</div>
      <div class="timeline-legend">
        <span class="tl-leg-item"><span class="tl-dot active"></span> ${esc(currentCity.name)}</span>
        <span class="tl-leg-item"><span class="tl-dot other"></span> Otra ciudad</span>
        <span class="tl-leg-item"><span class="tl-dot empty"></span> Sin asignar</span>
      </div>
    </div>`;
    
    return html;
  }

  /**
   * Opens modal to add a new city to existing trip
   */
  function openAddCityModal() {
    const trip = trips.find(t => t.id === currentTripId);
    if (!trip) return;

    // Pre-fill dates with the first uncovered gap
    const covered = new Set();
    trip.cities.forEach(ci => {
      if (ci.dayTrip) return;
      let d = new Date(ci.startDate + 'T00:00:00');
      const e = new Date(ci.endDate + 'T00:00:00');
      while (d <= e) { covered.add(d.toISOString().slice(0,10)); d.setDate(d.getDate()+1); }
    });
    const gaps = [];
    let d = new Date(trip.startDate + 'T00:00:00');
    const e = new Date(trip.endDate + 'T00:00:00');
    while (d <= e) {
      const s = d.toISOString().slice(0,10);
      if (!covered.has(s)) gaps.push(s);
      d.setDate(d.getDate()+1);
    }

    // Reset type to stay
    selectedCityType = 'stay';
    selectedDayTripTransport = 'walking';
    selectCityType('stay');
    document.querySelectorAll('[data-dt]').forEach(o => o.classList.toggle('selected', o.dataset.dt === 'walking'));

    // Clear fields
    document.getElementById('new-city-name').value = '';
    document.getElementById('new-city-hotel-name').value = '';
    document.getElementById('new-city-hotel-addr').value = '';
    setWheelTime('new-city-depart-time', '');
    setWheelTime('new-city-return-time', '');
    ['new-city-start','new-city-end'].forEach(id => {
      const el = document.getElementById(id);
      el.value = ''; el.classList.remove('error');
      el.min = trip.startDate; el.max = trip.endDate;
    });
    ['new-city-start-err','new-city-end-err'].forEach(id =>
      document.getElementById(id).classList.remove('visible')
    );

    // Pre-fill first gap range
    if (gaps.length) {
      document.getElementById('new-city-start').value = gaps[0];
      document.getElementById('new-city-end').value = gaps[gaps.length - 1];
      document.getElementById('new-city-end').min = gaps[0];
    }

    // Hint text
    const hint = document.getElementById('add-city-gap-hint');
    hint.textContent = gaps.length
      ? `El viaje cubre del ${formatDate(trip.startDate)} al ${formatDate(trip.endDate)}. Faltan cubrir ${gaps.length} día${gaps.length!==1?'s':''}.`
      : `El viaje cubre del ${formatDate(trip.startDate)} al ${formatDate(trip.endDate)}.`;

    openModal('modal-add-city');
    setTimeout(() => { 
      initCityNameAutocomplete(); 
      initHotelNameAutocomplete(); 
    }, 150);
  }

  // ══ STOP/ACTIVITY MODALS ═════════════════════════════════════
  
  /**
   * @private Wizard step navigation for stop modal
   */
  function stopWizardGoToStep(step) {
    document.querySelectorAll('#modal-add-stop .wizard-step').forEach((el, i) => {
      el.classList.toggle('active', i + 1 <= step);
      el.classList.toggle('completed', i + 1 < step);
    });
    document.querySelectorAll('#modal-add-stop .wizard-content').forEach((el, i) => {
      el.style.display = (i + 1 === step) ? 'block' : 'none';
    });

    if (step === 2) {
      setTimeout(() => initStopAddressAutocomplete(), 100);
    }
  }

  function stopWizardNextStep(currentStep) {
    if (currentStep === 1) {
      const name = document.getElementById('stop-name').value.trim();
      if (!name) { showToast('⚠️ Ingresá el nombre del lugar'); return; }
    }
    stopWizardGoToStep(currentStep + 1);
  }

  function stopWizardPrevStep(currentStep) {
    stopWizardGoToStep(currentStep - 1);
  }

  /**
   * @private Setup autocomplete for stop name search
   */
  function initStopNameAutocomplete() {
    const input = document.getElementById('stop-name');
    const list = document.getElementById('stop-name-results');
    const addrInput = document.getElementById('stop-addr');
    if (!input || !list) return;

    const newInput = input.cloneNode(true);
    input.parentNode.replaceChild(newInput, input);
    const el = document.getElementById('stop-name');

    el.addEventListener('input', () => {
      clearTimeout(_stopNameAcTimer);
      const q = el.value.trim();
      if (q.length < 3) { list.style.display = 'none'; list.innerHTML = ''; return; }
      _stopNameAcTimer = setTimeout(() => runStopNameSearch(q, list, el, addrInput), 350);
    });

    el.addEventListener('focus', () => {
      if (el.value.trim().length >= 3) runStopNameSearch(el.value.trim(), list, el, addrInput);
    });

    document.addEventListener('click', (e) => {
      if (!el.contains(e.target) && !list.contains(e.target)) { list.style.display = 'none'; }
    });
  }

  /**
   * Opens modal to add a new stop/activity to current day
   */
  function openAddStopModal() {
    // Reset modal title
    document.getElementById('stop-modal-title').textContent = '📍 Agregar parada';
    
    // Reset form state
    document.getElementById('stop-name').value = '';
    document.getElementById('stop-addr').value = '';
    document.getElementById('stop-note').value = '';
    selectedType = 'attraction';
    selectedTransport = 'walking';
    document.querySelectorAll('#modal-add-stop [data-type]').forEach(o => o.classList.toggle('selected', o.dataset.type === 'attraction'));
    document.querySelectorAll('#modal-add-stop [data-transport]').forEach(o => o.classList.toggle('selected', o.dataset.transport === 'walking'));
    editingStopId = null;
    stopSelectedLat = null;
    stopSelectedLon = null;
    document.getElementById('stop-name-results').innerHTML = '';
    document.getElementById('stop-name-results').style.display = 'none';
    stopWizardGoToStep(1);
    openModal('modal-add-stop');
    setTimeout(() => initStopNameAutocomplete(), 150);
  }

  /**
   * Opens modal to edit an existing stop
   */
  function openEditStopModal(stopId) {
    const trip = trips.find(t => t.id === currentTripId);
    if (!trip) return;
    const city = trip.cities[currentCityIdx];
    if (!city) return;
    const day = city.days[currentDayIdx];
    if (!day) return;
    const stop = day.stops.find(s => s.id === stopId);
    if (!stop) return;

    // Change modal title for editing
    document.getElementById('stop-modal-title').textContent = '✏️ Editar parada';

    // Populate form
    document.getElementById('stop-name').value = stop.name || '';
    document.getElementById('stop-addr').value = stop.addr || '';
    document.getElementById('stop-note').value = stop.notes || '';
    selectedType = stop.type || 'attraction';
    selectedTransport = stop.transport || 'walking';
    document.querySelectorAll('#modal-add-stop [data-type]').forEach(o => o.classList.toggle('selected', o.dataset.type === selectedType));
    document.querySelectorAll('#modal-add-stop [data-transport]').forEach(o => o.classList.toggle('selected', o.dataset.transport === selectedTransport));
    editingStopId = stopId;
    stopSelectedLat = stop.lat;
    stopSelectedLon = stop.lon;
    document.getElementById('stop-name-results').innerHTML = '';
    document.getElementById('stop-name-results').style.display = 'none';
    stopWizardGoToStep(1);
    openModal('modal-add-stop');
    setTimeout(() => initStopNameAutocomplete(), 150);
  }

  // ══ TICKET MODALS ════════════════════════════════════════════
  
  /**
   * @private Wizard step navigation for ticket modal
   */
  function ticketWizardGoToStep(step) {
    document.querySelectorAll('#modal-add-ticket .wizard-step').forEach((el, i) => {
      el.classList.toggle('active', i + 1 <= step);
      el.classList.toggle('completed', i + 1 < step);
    });
    document.querySelectorAll('#modal-add-ticket .wizard-content').forEach((el, i) => {
      el.style.display = (i + 1 === step) ? 'block' : 'none';
    });
  }

  function ticketWizardNextStep(currentStep) {
    if (currentStep === 1) {
      const type = selectedTicketType;
      if (!type) { showToast('⚠️ Elegí el tipo de pasaje'); return; }
    }
    ticketWizardGoToStep(currentStep + 1);
  }

  function ticketWizardPrevStep(currentStep) {
    ticketWizardGoToStep(currentStep - 1);
  }

  /**
   * @private Update ticket form fields based on selected transport type
   */
  function updateTicketFields(type) {
    selectedTicketType = type;
    const fields = document.querySelectorAll('#modal-add-ticket .ticket-field');
    fields.forEach(f => f.style.display = 'none');
    const showFields = {
      flight: ['ticket-flight-number', 'ticket-depart-city', 'ticket-arrive-city', 'ticket-depart-time', 'ticket-arrive-time', 'ticket-seat', 'ticket-gate'],
      train: ['ticket-train-number', 'ticket-depart-city', 'ticket-arrive-city', 'ticket-depart-time', 'ticket-arrive-time', 'ticket-seat', 'ticket-platform'],
      bus: ['ticket-bus-company', 'ticket-depart-city', 'ticket-arrive-city', 'ticket-depart-time', 'ticket-arrive-time', 'ticket-seat', 'ticket-platform'],
      ferry: ['ticket-ferry-company', 'ticket-depart-city', 'ticket-arrive-city', 'ticket-depart-time', 'ticket-arrive-time', 'ticket-seat', 'ticket-platform'],
      other: ['ticket-other-desc', 'ticket-depart-city', 'ticket-arrive-city', 'ticket-depart-time', 'ticket-arrive-time']
    };
    (showFields[type] || []).forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = '';
    });
  }

  /**
   * Opens modal to add a new ticket/transit
   */
  function openAddTicketModal() {
    // Reset form
    document.querySelectorAll('#modal-add-ticket input, #modal-add-ticket textarea').forEach(el => el.value = '');
    selectedTicketType = null;
    document.querySelectorAll('#modal-add-ticket .ticket-type-btn').forEach(btn => btn.classList.remove('selected'));
    document.querySelectorAll('#modal-add-ticket .ticket-field').forEach(f => f.style.display = 'none');
    appStore.beginAddTicket();
    ticketWizardGoToStep(1);
    openModal('modal-add-ticket');
  }

  /**
   * Opens modal to edit an existing ticket
   */
  function openEditTicketModal(ticketId) {
    const trip = trips.find(t => t.id === currentTripId);
    if (!trip) return;
    const ticket = trip.tickets.find(t => t.id === ticketId);
    if (!ticket) return;

    // Populate form
    selectedTicketType = ticket.type;
    document.querySelectorAll('#modal-add-ticket .ticket-type-btn').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.type === ticket.type);
    });
    updateTicketFields(ticket.type);
    
    // Fill fields
    Object.keys(ticket).forEach(key => {
      const el = document.getElementById('ticket-' + key);
      if (el) el.value = ticket[key] || '';
    });
    
    appStore.beginEditTicket(ticketId);
    ticketWizardGoToStep(1);
    openModal('modal-add-ticket');
  }

  // ══ HOTEL MODALS ═════════════════════════════════════════════
  
  /**
   * Opens modal to edit hotel details for current city
   */
  function openEditHotelModal() {
    const trip = trips.find(t => t.id === currentTripId);
    if (!trip) return;
    const city = trip.cities[currentCityIdx];
    if (!city) return;

    // Populate form
    document.getElementById('edit-hotel-name').value = city.hotelName || '';
    document.getElementById('edit-hotel-addr').value = city.hotelAddr || '';
    setWheelTime('edit-hotel-checkin', city.checkInTime || '');
    setWheelTime('edit-hotel-checkout', city.checkOutTime || '');
    
    openModal('modal-edit-hotel');
    setTimeout(() => initEditHotelNameAutocomplete(), 150);
  }

  // ══ PACKING MODALS ═══════════════════════════════════════════
  
  /**
   * Opens packing list modal with weather-based suggestions
   */
  function openPackingModal() {
    if (window.Wandr && window.Wandr.WeatherService && typeof window.Wandr.WeatherService.openPackingModal === 'function') {
      window.Wandr.WeatherService.openPackingModal();
    }
  }

  // ══ EXPORT DOMAIN-ORGANIZED MODALS ═══════════════════════════
  
  window.WandrRender.Modals = {
    // Base infrastructure
    openModal: openModal,
    closeModal: closeModal,
    
    // Trip domain
    Trip: {
      openNew: openNewTripModal,
      openEditDates: openEditTripDatesModal
    },
    
    // City domain
    City: {
      openAdd: openAddCityModal,
      openEditName: openEditCityNameModal,
      openEditDates: openEditCityDatesModal,
      openDeleteFromEdit: openDeleteCityFromEditModal
    },
    
    // Stop domain
    Stop: {
      openAdd: openAddStopModal,
      openEdit: openEditStopModal
    },
    
    // Ticket domain
    Ticket: {
      openAdd: openAddTicketModal,
      openEdit: openEditTicketModal
    },
    
    // Hotel domain
    Hotel: {
      openEdit: openEditHotelModal
    },
    
    // Packing domain
    Packing: {
      openModal: openPackingModal
    }
  };

  // Assign base functions to WandrRender namespace
  window.WandrRender.openModal = openModal;
  window.WandrRender.closeModal = closeModal;

})(window);