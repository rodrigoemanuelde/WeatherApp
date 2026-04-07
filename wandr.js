
// ══════════════════════════════════════
// STATE
// ══════════════════════════════════════
let _rawTripsFromStorage = (() => {
  try {
    const parsed = JSON.parse(localStorage.getItem('wandr_trips') || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch(e) {
    return [];
  }
})();
let trips = _rawTripsFromStorage;
let currentTripId = null;
let currentCityIdx = 0;
let currentDayIdx = 0;
let selectedType = 'attraction';
let selectedTransport = 'walking';
let currentDetailTab = 'itinerary';
let isLoadingCountryCodes = false;
let selectedTicketType = null;
let editingTicketId = null;
let _pendingDeleteTicketId = null;
let editingStopId = null;

// ══════════════════════════════════════
// CITY WIZARD STORE (Zustand-like pattern)
// ══════════════════════════════════════
function createCityWizardStore() {
  let state = {
    cityEntries: [],
    cityEntryState: {},
    transitLegs: {}
  };
  let listeners = new Set();

  function getState() { return state; }

  function setState(partial) {
    state = typeof partial === 'function' ? partial(state) : { ...state, ...partial };
    listeners.forEach(fn => fn(state));
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  // Actions
  function addCityEntry(id) {
    setState(s => ({
      ...s,
      cityEntries: [...s.cityEntries, id],
      cityEntryState: {
        ...s.cityEntryState,
        [id]: { name: '', hotel: '', addr: '', start: '', end: '' }
      }
    }));
  }

  function removeCityEntry(id) {
    setState(s => {
      const newEntries = s.cityEntries.filter(c => c !== id);
      const newState = { ...s.cityEntryState };
      delete newState[id];
      return { ...s, cityEntries: newEntries, cityEntryState: newState };
    });
  }

  function updateCityField(id, field, value) {
    setState(s => ({
      ...s,
      cityEntryState: {
        ...s.cityEntryState,
        [id]: { ...s.cityEntryState[id], [field]: value }
      }
    }));
  }

  function syncFromDOM() {
    setState(s => {
      const newState = { ...s.cityEntryState };
      s.cityEntries.forEach(id => {
        const existing = newState[id] || { name: '', start: '', end: '' };
        const nameEl = document.getElementById('cn-' + id);
        const startEl = document.getElementById('cs-' + id);
        const endEl = document.getElementById('ce-' + id);
        newState[id] = {
          name: nameEl?.value || existing.name,
          hotel: existing.hotel || '',
          addr: existing.addr || '',
          start: startEl?.value || existing.start,
          end: endEl?.value || existing.end
        };
      });
      return { ...s, cityEntryState: newState };
    });
  }

  function reset() {
    setState({ cityEntries: [], cityEntryState: {}, transitLegs: {} });
  }

  return { getState, setState, subscribe, addCityEntry, removeCityEntry, updateCityField, syncFromDOM, reset };
}

const cityWizard = createCityWizardStore();

// ══════════════════════════════════════
// APP SHORTCUTS
// ══════════════════════════════════════

// Handle app shortcuts on launch
(function handleAppShortcuts() {
  const params = new URLSearchParams(window.location.search);
  const action = params.get('action');
  if (action === 'new-trip') {
    setTimeout(() => openNewTripModal(), 300);
  } else if (action === 'backup') {
    setTimeout(() => openModal('modal-backup'), 300);
  } else if (action === 'trips') {
    setTimeout(() => showScreen('trips'), 300);
  }
  if (action) {
    history.replaceState({}, '', './index.html');
  }
})();

// save() defined in HELPERS section below
function uid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for older environments
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// ══════════════════════════════════════
// SCREENS
// ══════════════════════════════════════
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  if (name === 'trips') {
    document.getElementById('btn-add-stop').classList.remove('visible');
    document.getElementById('btn-new-trip').style.display = '';
    renderTrips();
  } else {
    // In detail screen, FAB only shows on itinerary tab
    const showFab = currentDetailTab === 'itinerary';
    document.getElementById('btn-add-stop').classList.toggle('visible', showFab);
    document.getElementById('btn-new-trip').style.display = 'none';
  }
}
function goBack() { showScreen('trips'); }
function goHome() {
  if (document.getElementById('screen-trips').classList.contains('active')) {
    window.scrollTo(0, 0);
  } else {
    showScreen('trips');
  }
}

// ══════════════════════════════════════
// TRIPS LIST
// ══════════════════════════════════════
function renderTrips() {
  const c = document.getElementById('trips-container');
  if (!trips.length) {
    c.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
      <p>Aún no tenés viajes</p><small>Tocá "Nuevo viaje" para empezar</small></div>`;
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
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
      ? cities.map((ci, i) => cityPillHtml(ci)).join('')
      : `<span class="city-pill" style="opacity:0.5">Sin ciudades</span>`;
    
    return `<div class="trip-card${isPast ? ' trip-card-past' : ''}${isOngoing ? ' trip-card-ongoing' : ''}" draggable="true" data-trip-id="${t.id}" data-trip-index="${idx}"
      ondragstart="onDragTripStart(event)"
      ondragover="onDragTripOver(event)"
      ondrop="onDropTrip(event)"
      onclick="if(_justDragged){_justDragged=false;return;}openTrip('${t.id}')">
      ${isPast ? '<div class="trip-card-badge">✓ Finalizado</div>' : ''}
      ${isOngoing ? '<div class="trip-card-badge trip-card-badge-ongoing">En curso</div>' : ''}
      <div class="trip-card-drag-handle">⋮⋮</div>
      <div class="trip-card-accent"></div>
      <h3>${esc(t.name)}</h3>
      <div class="trip-card-meta">
        <span>📅 ${formatDate(t.startDate)} → ${formatDate(t.endDate)}</span>
      </div>
      <div class="trip-card-stats">
        <span>${days} días</span>
        <span class="stat-dot"></span>
        <span>${totalNights} noches</span>
        <span class="stat-dot"></span>
        <span>${stops} paradas</span>
        ${ticketsCount > 0 ? `<span class="stat-dot"></span><span>🎫 ${ticketsCount}</span>` : ''}
      </div>
      <div class="cities-pills">${citiesRow}</div>
      <button class="trip-card-delete" onclick="event.stopPropagation();deleteTrip('${t.id}')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
      </button>
    </div>`;
  }).join('') + '</div>';
}

let _draggedTripIndex = null;
let _justDragged = false;

function onDragTripStart(e) {
  _draggedTripIndex = parseInt(e.currentTarget.dataset.tripIndex);
  _justDragged = false;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function onDragTripOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function onDropTrip(e) {
  e.preventDefault();
  const targetCard = e.target.closest('.trip-card');
  if (!targetCard) return;
  
  const targetIndex = parseInt(targetCard.dataset.tripIndex);
  document.querySelectorAll('.trip-card.dragging').forEach(el => el.classList.remove('dragging'));
  
  if (_draggedTripIndex === null || _draggedTripIndex === targetIndex) return;
  
  const [movedTrip] = trips.splice(_draggedTripIndex, 1);
  trips.splice(targetIndex, 0, movedTrip);
  
  save();
  renderTrips();
  _draggedTripIndex = null;
  _justDragged = true;
}

let _pendingDeleteTripId = null;
let _pendingTransitLegKey = null;

function confirmDeleteTransitLegs() {
  if (!_pendingTransitLegKey) return;
  cityWizard.setState(s => {
    const newLegs = { ...s.transitLegs };
    delete newLegs[_pendingTransitLegKey];
    return { transitLegs: newLegs };
  });
  _pendingTransitLegKey = null;
  closeModal('modal-confirm-delete-transit');
  renderCityEntries();
  syncCityMins();
}

function deleteTrip(id) {
  const trip = trips.find(t => t.id === id);
  if (!trip) return;
  _pendingDeleteTripId = id;
  const totalStops = (trip.cities||[]).reduce((a,ci) => a + (ci.days||[]).reduce((b,d) => b + (d.stops||[]).length, 0), 0);
  document.getElementById('confirm-delete-trip-title').textContent = `¿Eliminar "${trip.name}"?`;
  document.getElementById('confirm-delete-trip-body').textContent = totalStops > 0
    ? `Se eliminarán ${trip.cities.length} ciudad${trip.cities.length!==1?'es':''} y ${totalStops} parada${totalStops!==1?'s':''}. Esta acción no se puede deshacer.`
    : 'Este viaje no tiene paradas cargadas. Esta acción no se puede deshacer.';
  openModal('modal-confirm-delete-trip');
}

function confirmDeleteTrip() {
  if (!_pendingDeleteTripId) return;
  trips = trips.filter(t => t.id !== _pendingDeleteTripId);
  _pendingDeleteTripId = null;
  save();
  closeModal('modal-confirm-delete-trip');
  renderTrips();
  showToast('🗑️ Viaje eliminado');
}

// ══════════════════════════════════════
// NEW TRIP — date validation
// ══════════════════════════════════════
function openNewTripModal() {
  cityWizard.reset();
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('trip-name').value = '';
  const si = document.getElementById('trip-start');
  const ei = document.getElementById('trip-end');
  // Start empty, set min to today (block past dates)
  si.value = '';
  si.min = today;
  si.max = '';
  // Return starts empty, min will be updated when start is picked
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
    <div class="trip-card" style="margin-bottom:16px">
      <div class="trip-card-accent"></div>
      <h3>${esc(name)}</h3>
      <div class="trip-card-meta">
        <span>📅 ${formatDate(start)} → ${formatDate(end)}</span>
        <span>🌤️ ${totalDays} días · ${state.cityEntries.length} ciudad${state.cityEntries.length !== 1 ? 'es' : ''}</span>
      </div>
      <div class="cities-pills">${citiesHtml || '<span class="city-pill" style="opacity:0.5">Sin ciudades</span>'}</div>
    </div>
    <div class="summary-detail">
      <div class="summary-detail-title">Detalle del viaje</div>
      ${renderWizardCitiesDetail()}
    </div>
  `;
}

function renderWizardCitiesDetail() {
  cityWizard.syncFromDOM();
  const state = cityWizard.getState();
  let html = '';
  state.cityEntries.forEach((id, i) => {
    const entry = state.cityEntryState[id] || {};
    const cityName = entry.name || '';
    const hotelName = entry.hotel || '';
    const hotelAddr = entry.addr || '';
    const cs = entry.start || '';
    const ce = entry.end || '';
    
    if (cityName && cs && ce) {
      const s = new Date(cs + 'T00:00:00');
      const e = new Date(ce + 'T00:00:00');
      const nights = Math.round((e - s) / 86400000);
      
      html += `
        <div class="summary-city-card">
          <div class="summary-city-header">
            <span class="summary-city-num">${i + 1}</span>
            <span class="summary-city-name">${esc(cityName)}</span>
            <span class="summary-city-nights">${nights} noche${nights !== 1 ? 's' : ''}</span>
          </div>
          <div class="summary-city-dates">${formatDate(cs)} → ${formatDate(ce)}</div>
          ${hotelName ? `<div class="summary-city-hotel">🏨 ${esc(hotelName)}${hotelAddr ? ` · ${esc(hotelAddr)}` : ''}</div>` : ''}
        </div>
      `;
    }
  });
  return html;
}

function onTripStartChange() {
  const startVal = document.getElementById('trip-start').value;
  const endEl = document.getElementById('trip-end');
  // Enforce: end cannot be before start
  endEl.min = startVal;
  if (endEl.value && endEl.value < startVal) {
    endEl.value = startVal;
  }
  endEl.classList.remove('error');
  document.getElementById('trip-end-error').classList.remove('visible');
  syncCityMins();
}

function onTripEndChange() {
  const startVal = document.getElementById('trip-start').value;
  const endEl = document.getElementById('trip-end');
  const errEl = document.getElementById('trip-end-error');
  if (endEl.value < startVal) {
    endEl.classList.add('error');
    errEl.classList.add('visible');
  } else {
    endEl.classList.remove('error');
    errEl.classList.remove('visible');
  }
  syncCityMins();
}

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
    // keep city-end min in sync with city-start
    if (csi.value) cei.min = csi.value;
  });
}

// ══════════════════════════════════════
// CITY ENTRIES (in form)
// ══════════════════════════════════════
function addCityEntry() {
  const id = uid();
  cityWizard.addCityEntry(id);
  renderCityEntries();
  syncCityMins();
  // Scroll to bottom of modal
  setTimeout(() => {
    const modal = document.querySelector('#modal-new-trip .modal');
    modal.scrollTop = modal.scrollHeight;
  }, 50);
}

let _pendingRemoveCityId = null;

function removeCityEntry(id) {
  const state = cityWizard.getState();
  if (state.cityEntries.length <= 1) { showToast('⚠️ Necesitás al menos una ciudad'); return; }
  const cityName = state.cityEntryState[id]?.name || 'esta ciudad';
  _pendingRemoveCityId = id;
  document.getElementById('confirm-delete-city-title').textContent = `¿Eliminar "${cityName}"?`;
  document.getElementById('confirm-delete-city-body').textContent = 'Esta acción no se puede deshacer.';
  openModal('modal-confirm-delete-city');
}

function confirmRemoveCityEntry() {
  const id = _pendingRemoveCityId;
  _pendingRemoveCityId = null;
  if (!id) return;
  cityWizard.removeCityEntry(id);
  closeModal('modal-confirm-delete-city');
  renderCityEntries();
  syncCityMins();
  showToast('Ciudad eliminada');
}

function renderCityEntries() {
  // Sync DOM values into store before re-rendering
  cityWizard.syncFromDOM();
  
  const state = cityWizard.getState();
  
  document.getElementById('cities-list').innerHTML = state.cityEntries.map((id, i) => {
    // Transit connector before each city (except the first)
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

function toggleTransitLegs(fromId, toId) {
  const legKey = fromId + '_' + toId;
  const state = cityWizard.getState();
  if (state.transitLegs[legKey] && state.transitLegs[legKey].length > 0) {
    // Ask to remove via custom modal instead of native confirm()
    _pendingTransitLegKey = legKey;
    openModal('modal-confirm-delete-transit');
  } else {
    // Add first leg
    cityWizard.setState(s => {
      const newLegs = { ...s.transitLegs };
      if (!newLegs[legKey]) newLegs[legKey] = [];
      newLegs[legKey].push({ type: 'flight', fromTerminal: '', toTerminal: '', depTime: '', arrTime: '', viaCity: '' });
      return { transitLegs: newLegs };
    });
    renderCityEntries();
    syncCityMins();
  }
}

function addTransitLeg(fromId, toId) {
  const legKey = fromId + '_' + toId;
  cityWizard.setState(s => {
    const newLegs = { ...s.transitLegs };
    if (!newLegs[legKey]) newLegs[legKey] = [];
    newLegs[legKey].push({ type: 'flight', fromTerminal: '', toTerminal: '', depTime: '', arrTime: '', viaCity: '' });
    return { transitLegs: newLegs };
  });
  renderCityEntries();
  syncCityMins();
}

let _pendingTransitLegRemove = null;

function removeTransitLeg(fromId, toId, idx) {
  _pendingTransitLegRemove = { fromId, toId, idx };
  const legKey = fromId + '_' + toId;
  const state = cityWizard.getState();
  const leg = state.transitLegs[legKey]?.[idx];
  const legType = leg?.type || 'tramo';
  document.getElementById('confirm-delete-transit-leg-title').textContent = `¿Eliminar ${legType}?`;
  document.getElementById('confirm-delete-transit-leg-body').textContent = 'Se eliminará este tramo de viaje. Esta acción no se puede deshacer.';
  openModal('modal-confirm-delete-transit-leg');
}

function confirmRemoveTransitLeg() {
  if (!_pendingTransitLegRemove) return;
  const { fromId, toId, idx } = _pendingTransitLegRemove;
  _pendingTransitLegRemove = null;
  const legKey = fromId + '_' + toId;
  cityWizard.setState(s => {
    if (!s.transitLegs[legKey]) return s;
    const newLegs = { ...s.transitLegs };
    newLegs[legKey].splice(idx, 1);
    if (newLegs[legKey].length === 0) delete newLegs[legKey];
    return { transitLegs: newLegs };
  });
  closeModal('modal-confirm-delete-transit-leg');
  renderCityEntries();
  syncCityMins();
}

function setLegType(fromId, toId, idx, type) {
  const legKey = fromId + '_' + toId;
  cityWizard.setState(s => {
    if (s.transitLegs[legKey] && s.transitLegs[legKey][idx]) {
      s.transitLegs[legKey][idx].type = type;
    }
    return s;
  });
  renderCityEntries();
  syncCityMins();
}

function updateLegField(fromId, toId, idx, field, value) {
  const legKey = fromId + '_' + toId;
  const state = cityWizard.getState();
  if (state.transitLegs[legKey] && state.transitLegs[legKey][idx]) {
    state.transitLegs[legKey][idx][field] = value;
  }
}

function renderTransitLegsSection(fromId, toId, legs) {
  const legKey = fromId + '_' + toId;
  const legsHtml = legs.map((leg, li) => `
    <div class="transit-leg" id="leg-${legKey}-${li}">
      <div class="transit-leg-header">
        <span>Tramo ${li + 1}</span>
        <button class="btn-remove-leg" onclick="removeTransitLeg('${fromId}','${toId}',${li})">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="transport-grid" style="margin-bottom:8px">
        ${['flight','bus','train','boat'].map(t =>
          `<div class="transport-option${leg.type === t ? ' selected' : ''}" onclick="setLegType('${fromId}','${toId}',${li},'${t}')">${ticketTypeIconStr(t)}<small>${ticketTypeLabelStr(t)}</small></div>`
        ).join('')}
      </div>
      <input type="text" id="leg-from-${legKey}-${li}" value="${esc(leg.fromTerminal||'')}" placeholder="Terminal / estación de salida" maxlength="100" oninput="updateLegField('${fromId}','${toId}',${li},'fromTerminal',this.value)" />
      <input type="text" id="leg-to-${legKey}-${li}" value="${esc(leg.toTerminal||'')}" placeholder="Terminal / estación de llegada" maxlength="100" oninput="updateLegField('${fromId}','${toId}',${li},'toTerminal',this.value)" />
      <div class="city-date-row" style="margin-top:6px">
        <div>
          <input type="time" id="leg-dep-${legKey}-${li}" value="${leg.depTime||''}" oninput="updateLegField('${fromId}','${toId}',${li},'depTime',this.value)" />
          <div style="font-size:0.68rem;color:var(--text2);margin-top:3px">Hora salida</div>
        </div>
        <div>
          <input type="time" id="leg-arr-${legKey}-${li}" value="${leg.arrTime||''}" oninput="updateLegField('${fromId}','${toId}',${li},'arrTime',this.value)" />
          <div style="font-size:0.68rem;color:var(--text2);margin-top:3px">Hora llegada</div>
        </div>
      </div>
      <input type="text" id="leg-via-${legKey}-${li}" value="${esc(leg.viaCity||'')}" placeholder="Ciudad de escala (ej: São Paulo)" maxlength="60" style="margin-top:6px" oninput="updateLegField('${fromId}','${toId}',${li},'viaCity',this.value)" />
    </div>
  `).join('');
  return `<div class="transit-legs-section">
    ${legsHtml}
  </div>`;
}

// Helper strings for use inside renderTransitLegsSection (not template context)
function ticketTypeIconStr(t) { return ({flight:'✈️',bus:'🚌',train:'🚆',boat:'⛴️'})[t]||'🎫'; }
function ticketTypeLabelStr(t) { return ({flight:'Vuelo',bus:'Bus',train:'Tren',boat:'Barco'})[t]||t; }

function onCityStartChange(id) {
  const tripStart = document.getElementById('trip-start').value;
  const tripEnd = document.getElementById('trip-end').value;
  const csi = document.getElementById('cs-' + id);
  const cei = document.getElementById('ce-' + id);
  const errS = document.getElementById('cs-err-' + id);
  const v = csi.value;

  // Validate within trip range
  if ((tripStart && v < tripStart) || (tripEnd && v > tripEnd)) {
    csi.classList.add('error');
    errS.textContent = '⚠️ Fuera del rango del viaje';
    errS.classList.add('visible');
  } else {
    csi.classList.remove('error');
    errS.classList.remove('visible');
  }

  // City end cannot be before city start
  cei.min = v;
  if (cei.value && cei.value < v) {
    cei.value = v;
    cei.classList.remove('error');
    document.getElementById('ce-err-' + id).classList.remove('visible');
  }
}

function onCityEndChange(id) {
  const csi = document.getElementById('cs-' + id);
  const cei = document.getElementById('ce-' + id);
  const tripEnd = document.getElementById('trip-end').value;
  const errE = document.getElementById('ce-err-' + id);

  if (csi.value && cei.value < csi.value) {
    cei.classList.add('error');
    errE.textContent = '⚠️ La salida debe ser posterior a la llegada';
    errE.classList.add('visible');
  } else if (tripEnd && cei.value > tripEnd) {
    cei.classList.add('error');
    errE.textContent = '⚠️ Supera el fin del viaje';
    errE.classList.add('visible');
  } else {
    cei.classList.remove('error');
    errE.classList.remove('visible');
  }
}

// ══════════════════════════════════════
// CREATE TRIP
// ══════════════════════════════════════
function createTrip() {
  // Sync DOM values into store before reading
  cityWizard.syncFromDOM();
  const state = cityWizard.getState();
  
  const name = document.getElementById('trip-name').value.trim();
  const start = document.getElementById('trip-start').value;
  const end = document.getElementById('trip-end').value;

  if (!name) { showToast('⚠️ Ingresá el nombre del viaje'); return; }
  if (!start || !end) { showToast('⚠️ Ingresá las fechas del viaje'); return; }
  if (end < start) { showToast('⚠️ La fecha fin no puede ser anterior al inicio'); return; }

  const cities = [];
  for (let i = 0; i < state.cityEntries.length; i++) {
    const id = state.cityEntries[i];
    const entry = state.cityEntryState[id] || {};
    const cityName = (entry.name || '').trim();
    const hotelName = (entry.hotel || '').trim();
    const hotelAddr = (entry.addr || '').trim();
    const cs = entry.start || '';
    const ce = entry.end || '';

    if (!cityName) { showToast(`⚠️ Ingresá el nombre de la ciudad ${i + 1}`); return; }
    if (!cs || !ce) { showToast(`⚠️ Completá las fechas de ${cityName}`); return; }
    if (ce < cs) { showToast(`⚠️ En ${cityName}: la salida debe ser igual o posterior a la llegada`); return; }

    // Use trip dates as fallback if city dates are outside (lenient — just warn don't block)
    const cityStart = cs < start ? start : cs;
    const cityEnd = ce > end ? end : ce;

    // Validate overlap against already-collected cities (allow shared day for check-out/check-in same day)
    const overlap = cities.find(c => cityStart < c.endDate && cityEnd > c.startDate);
    if (overlap) {
      showToast(`⚠️ Las fechas de "${cityName}" se solapan con "${overlap.name}" (${formatDate(overlap.startDate)} → ${formatDate(overlap.endDate)})`);
      return;
    }

    cities.push({ id: uid(), name: cityName, hotelName, hotelAddr, startDate: cityStart, endDate: cityEnd, days: buildDays(cityStart, cityEnd) });
  }

  const trip = { id: uid(), name, startDate: start, endDate: end, cities, tickets: [] };

  // Generate chained tickets from transitLegs
  for (let i = 0; i < state.cityEntries.length - 1; i++) {
    const fromId = state.cityEntries[i];
    const toId = state.cityEntries[i + 1];
    const legKey = fromId + '_' + toId;
    const legs = state.transitLegs[legKey];
    if (legs && legs.length > 0) {
      const fromEntry = state.cityEntryState[fromId] || {};
      const toEntry = state.cityEntryState[toId] || {};
      const fromCityName = (fromEntry.name || '').trim();
      const toCityName = (toEntry.name || '').trim();
      const fromCityEnd = fromEntry.end || '';
      const toCityStart = toEntry.start || '';
      // All legs in this connector share a chainId
      const chainId = uid();
      legs.forEach((leg, li) => {
        const isFirst = li === 0;
        const isLast  = li === legs.length - 1;
        trip.tickets.push({
          id: uid(),
          type: leg.type || 'flight',
          company: '',
          fromCity: isFirst ? fromCityName : (legs[li-1].viaCity || fromCityName),
          toCity:   isLast  ? toCityName   : (leg.viaCity || toCityName),
          depTerminal: leg.fromTerminal || '',
          arrTerminal: leg.toTerminal   || '',
          depGate: '', arrGate: '',
          depDate: isFirst ? fromCityEnd  : fromCityEnd,
          depTime: leg.depTime || '',
          arrDate: isLast  ? toCityStart  : toCityStart,
          arrTime: leg.arrTime || '',
          chainId: legs.length > 1 ? chainId : null,
          stub: false,
        });
      });
    }
  }

  // Auto-generate stub tickets for transitions without explicit legs
  trips.push(trip);
  save();
  ensureTransitionTickets(trip);
  save();
  closeModal('modal-new-trip');
  // Small delay so modal closes before navigating
  setTimeout(() => {
    renderTrips();
    openTrip(trip.id);
    showToast('✅ Viaje creado');
  }, 150);
}

function buildDays(start, end) {
  const days = [];
  let d = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  while (d <= e) {
    days.push({ date: d.toISOString().slice(0, 10), stops: [] });
    d.setDate(d.getDate() + 1);
  }
  return days;
}

// ══════════════════════════════════════
// TRIP DETAIL
// ══════════════════════════════════════
function openTrip(id) {
  currentTripId = id;
  currentCityIdx = 0;
  currentDayIdx = 0;
  currentDetailTab = 'itinerary';
  showScreen('detail');
  switchDetailTab('itinerary');
  renderDetail();
  renderTickets();
}

function switchDetailTab(tab) {
  currentDetailTab = tab;
  document.getElementById('dtab-itinerary').classList.toggle('active', tab === 'itinerary');
  document.getElementById('dtab-overview').classList.toggle('active', tab === 'overview');
  document.getElementById('dtab-tickets').classList.toggle('active', tab === 'tickets');
  document.getElementById('detail-content').style.display   = tab === 'itinerary' ? 'block' : 'none';
  document.getElementById('overview-content').style.display = tab === 'overview'  ? 'block' : 'none';
  document.getElementById('tickets-content').style.display  = tab === 'tickets'   ? 'block' : 'none';
  // FAB only visible on itinerary tab
  document.getElementById('btn-add-stop').style.display = tab === 'itinerary' ? '' : 'none';
  if (tab === 'tickets') renderTickets();
  if (tab === 'overview') renderOverview();
}

// ══════════════════════════════════════
// OVERVIEW TAB
// ══════════════════════════════════════
// Palette for city dots — cycles through accent colors
const _ovCityColors = ['#4A7BF7','#7fcfb8','#e8b86d','#e87d7d','#a78bfa','#38bdf8','#f472b6'];

function renderOverview() {
  const el = document.getElementById('overview-content');
  if (!el) return;
  const trip = trips.find(t => t.id === currentTripId);
  if (!trip) { el.innerHTML = '<p style="color:var(--danger);padding:20px">Error: viaje no encontrado.</p>'; return; }

  // ── Stats ──
  const sortedCities = [...(trip.cities || [])].filter(ci => !ci.dayTrip).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const totalCities  = sortedCities.length;
  const totalNights  = sortedCities.reduce((acc, ci) => {
    const s = new Date(ci.startDate + 'T00:00:00');
    const e = new Date(ci.endDate   + 'T00:00:00');
    return acc + Math.round((e - s) / 86400000);
  }, 0);
  const totalPassajes = (trip.tickets || []).filter(tk => !tk.stub).length;

  // ── Total days label ──
  const tripS = new Date(trip.startDate + 'T00:00:00');
  const tripE = new Date(trip.endDate   + 'T00:00:00');
  const totalDays = Math.round((tripE - tripS) / 86400000) + 1;

  // ── Build transit map: fromCity.name → ticket ──
  const ticketsByDep = {};
  (trip.tickets || []).forEach(tk => {
    if (!ticketsByDep[tk.fromCity]) ticketsByDep[tk.fromCity] = [];
    ticketsByDep[tk.fromCity].push(tk);
  });

  // ── Build set of transit dates per city (for chip colouring) ──
  function getTransitDates(city) {
    const set = new Set();
    (trip.tickets || []).forEach(tk => {
      if (tk.depDate >= city.startDate && tk.depDate <= city.endDate) set.add(tk.depDate);
      if (tk.arrDate >= city.startDate && tk.arrDate <= city.endDate) set.add(tk.arrDate);
    });
    return set;
  }

  // ── Render ──
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
    const color = _ovCityColors[ci % _ovCityColors.length];
    const transitDates = getTransitDates(city);
    const stopsByDate  = {};
    (city.days || []).forEach(d => { if (d.stops?.length) stopsByDate[d.date] = d.stops.length; });

    // Day chips
    const dayChips = (city.days || []).map(d => {
      const isTransit  = transitDates.has(d.date);
      const hasStops   = !!stopsByDate[d.date];
      const wd = new Date(d.date + 'T00:00:00').toLocaleDateString('es-AR', { weekday: 'short' }).slice(0, 3).toLowerCase();
      const dd = d.date.slice(8);
      const weatherData = _weatherCache && _weatherCache[city.id] && _weatherCache[city.id].days ? _weatherCache[city.id].days[d.date] : null;
      const weatherHtml = buildWeatherChipHtml(weatherData);
      const cls = ['ov-day-chip', isTransit ? 'transit' : (hasStops ? 'has' : '')].filter(Boolean).join(' ');
      const cityIdx = trip.cities.findIndex(c => c.id === city.id);
      const dayIdx  = (city.days || []).findIndex(d2 => d2.date === d.date);
      return `<div class="${cls}" onclick="ovGoToDay(${cityIdx},${dayIdx})">
        <span class="ov-dc-wd">${wd}</span>
        <span class="ov-dc-dd">${dd}</span>
        ${weatherHtml}
        <span class="ov-dc-dot"></span>
      </div>`;
    }).join('');

    // Nights count
    const nightCount = Math.round((new Date(city.endDate + 'T00:00:00') - new Date(city.startDate + 'T00:00:00')) / 86400000);

    // Hotel row
    let hotelHtml;
    if (city.hotelName) {
      const times = [
        city.checkInTime  ? `✅ ${city.checkInTime}`  : '',
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

    // Transit connector to next city
    if (ci < sortedCities.length - 1) {
      const nextCity  = sortedCities[ci + 1];
      const connector = (trip.tickets || []).find(tk =>
        tk.fromCity === city.name && tk.toCity === nextCity.name
      );
      let badgeContent, badgeClass = 'ov-tr-badge';
      if (connector && connector.type) {
        const icon  = ticketTypeIcon(connector.type);
        const label = ticketTypeLabel(connector.type);
        badgeContent = `${icon} ${label} · ${esc(city.name)} → ${esc(nextCity.name)}`;
      } else if (connector) {
        badgeContent = `🎫 Pasaje pendiente · ${esc(city.name)} → ${esc(nextCity.name)}`;
        badgeClass  += ' ov-tr-stub';
      } else {
        badgeContent = `${esc(city.name)} → ${esc(nextCity.name)}`;
        badgeClass  += ' ov-tr-stub';
      }
      html += `<div class="ov-transit-row">
        <div class="ov-tr-line"></div>
        <div class="${badgeClass}">${badgeContent}</div>
        <div class="ov-tr-line"></div>
      </div>`;
    }
  });

  // Legend
  html += `
    <div class="ov-legend">
      <div class="ov-leg-item"><span class="ov-leg-dot" style="background:var(--accent);opacity:0.9"></span>Con paradas</div>
      <div class="ov-leg-item"><span class="ov-leg-dot" style="background:rgba(232,184,109,0.3);border:1px solid var(--accent3)"></span>Tránsito</div>
      <div class="ov-leg-item"><span class="ov-leg-dot" style="background:var(--border)"></span>Sin paradas</div>
    </div>
  </div>`;

  el.innerHTML = html;

  // Fetch weather for each city async and update day chips (ONE call per city, NOT per day)
  sortedCities.forEach((city, ci) => {
    getWeatherForCity(city, trip).then(weatherData => {
      if (!weatherData || !weatherData.daily) return;
      const cityCards = el.querySelectorAll('.ov-city-card');
      if (!cityCards[ci]) return;
      const dayStrip = cityCards[ci].querySelector('.ov-day-strip');
      if (!dayStrip) return;
      const chips = dayStrip.querySelectorAll('.ov-day-chip');
      (city.days || []).forEach((d, dayIdx) => {
        if (dayIdx >= chips.length) return;
        const dateIndex = weatherData.daily.time.findIndex(date => date === d.date);
        if (dateIndex < 0) return;
        const wmo = mapWmoCode(weatherData.daily.weather_code[dateIndex]);
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
  currentCityIdx = cityIdx;
  currentDayIdx  = dayIdx;
  switchDetailTab('itinerary');
  renderDetail();
  window.scrollTo(0, 0);
}

function renderDetail() {
  try {
    const trip = trips.find(t => t.id === currentTripId);
    if (!trip) { document.getElementById('detail-content').innerHTML = '<p style="color:var(--danger);padding:20px">Error: viaje no encontrado.</p>'; return; }

    const city = trip.cities[currentCityIdx] || trip.cities[0];
    if (!city) { document.getElementById('detail-content').innerHTML = '<p style="color:var(--danger);padding:20px">Error: no hay ciudades en este viaje.</p>'; return; }

    // Always rebuild the days list from city.startDate/endDate as source of truth,
    // preserving any stops that fall within those dates
    const stopsMap = {};
    (city.days || []).forEach(d => { if (d.stops?.length) stopsMap[d.date] = d.stops; });
    const correctDays = buildDays(city.startDate, city.endDate).map(d => ({
      ...d, stops: stopsMap[d.date] || []
    }));
    // Only save if something actually changed
    if (JSON.stringify(city.days?.map(d => d.date)) !== JSON.stringify(correctDays.map(d => d.date))) {
      city.days = correctDays;
      save();
    } else {
      city.days = correctDays;
    }

    if (currentDayIdx >= city.days.length) currentDayIdx = 0;
    const day = city.days[currentDayIdx];
    if (!day) { document.getElementById('detail-content').innerHTML = '<p style="color:var(--danger);padding:20px">Error: día no encontrado.</p>'; return; }

    const stops = day.stops || [];

    // Detect which days are transit days for this city
    // A day is "transit" if tickets depart or arrive on that date involving this city
    const trip_tickets = trip.tickets || [];
    const transitDaysSet = new Set();
    trip_tickets.forEach(tk => {
      const depDate = tk.depDate;
      const arrDate = tk.arrDate;
      // If this city is the departure city and the dep date is in this city's range
      if (depDate >= city.startDate && depDate <= city.endDate) transitDaysSet.add(depDate);
      // If this city is the arrival city and arr date is in this city's range
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
        const flag = getCountryFlag(ci.countryCode);
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

    // Stops rendering
    let stopsHtml = '';

    // Declare today's arrival AND departure tickets here so they're available everywhere
    const todayArrivalTickets = trip_tickets.filter(tk =>
      tk.arrDate === day.date && tk.toCity === city.name
    );
    const todayArrival = todayArrivalTickets[0] || null;

    const todayDepartureTickets = trip_tickets.filter(tk =>
      tk.depDate === day.date && tk.fromCity === city.name
    );
    const todayDeparture = todayDepartureTickets[0] || null;

    // Check if this day has a *defined* arrival ticket → last stop needs connector line
    const dayHasArrival = !!(todayArrival && city.hotelName && (todayArrival.type || todayArrival.arrTerminal || todayArrival.toTerminal));

    // Si hay vuelo de llegada, mostrar: 1) Terminal 2) Hotel 3) Paradas
    if (todayArrival && (todayArrival.type || todayArrival.arrTerminal || todayArrival.toTerminal)) {
      // 1. Mostrar terminal de llegada
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
      
      // 2. Mostrar hotel después de la terminal
      if (city.hotelName) {
        const hotelRouteFromTerminal = terminalName && city.hotelAddr
          ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(terminalName)}&destination=${encodeURIComponent(city.hotelAddr)}&travelmode=transit`
          : null;
        
        // Determinar si es el primer o último día de la ciudad
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
      // Si no hay vuelo de llegada, mostrar hotel como primer elemento
      // Determinar si es el primer o último día de la ciudad
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

    stops.forEach((stop, idx) => {
      const isLast = idx === stops.length - 1;
      const isVisuallyLast = isLast && !dayHasArrival && !todayDeparture;
      
      // Primera parada: siempre desde el hotel
      // Segunda+: desde la parada anterior
      const prevStop = idx === 0 ? null : stops[idx - 1];
      const hotelOrigin = city.hotelAddr || city.hotelName || city.name;
      
      // Calcular distancia desde el origen (hotel o parada anterior)
      let distText = '';
      if (idx === 0 && city.hotelLat && city.hotelLon && stop.lat && stop.lon) {
        distText = formatDistance(haversine(city.hotelLat, city.hotelLon, stop.lat, stop.lon));
      } else if (prevStop && prevStop.lat && prevStop.lon && stop.lat && stop.lon) {
        distText = formatDistance(haversine(prevStop.lat, prevStop.lon, stop.lat, stop.lon));
      }
      
      // Transport label for the separator
      const tpLabel = transportLabel(stop.transport);
      const tpIconStr = transportIcon(stop.transport);
      
      // Distance separator bar (between cards)
      let distSeparator = '';
      if (distText) {
        const timeText = estimateTravelTime(
          idx === 0 && city.hotelLat && city.hotelLon && stop.lat && stop.lon
            ? haversine(city.hotelLat, city.hotelLon, stop.lat, stop.lon)
            : (prevStop && prevStop.lat && prevStop.lon && stop.lat && stop.lon
              ? haversine(prevStop.lat, prevStop.lon, stop.lat, stop.lon)
              : 0),
          stop.transport
        );
        const icon = idx === 0 ? '🏨' : tpIconStr;
        distSeparator = `<div class="stop-dist-separator">
          <div class="stop-dist-separator-line"></div>
          <span class="stop-dist-separator-text">${icon} ${distText} · ~${timeText} · ${tpLabel}</span>
          <div class="stop-dist-separator-line"></div>
        </div>`;
      }
      
      // Determinar origen: hotel para primera parada, parada anterior para las demás
      let originCoords = null;
      let originName = null;
      
      if (idx === 0) {
        // Primera parada: usar hotel
        originName = hotelOrigin;
        if (city.hotelLat && city.hotelLon) {
          originCoords = { lat: city.hotelLat, lon: city.hotelLon };
        }
      } else if (prevStop) {
        // Usar coords de la parada anterior si existen
        if (prevStop.lat && prevStop.lon) {
          originCoords = { lat: prevStop.lat, lon: prevStop.lon };
        } else {
          originName = prevStop.address || prevStop.name;
        }
      }
      
      const gmMode = googleMapsMode(stop.transport);
      
      // Generar URL de ruta
      let routeUrl = '';
      if (stop.lat && stop.lon && originCoords) {
        // Usar coordenadas para mejor precisión
        routeUrl = `https://www.google.com/maps/dir/?api=1&origin=${originCoords.lat},${originCoords.lon}&destination=${stop.lat},${stop.lon}&travelmode=${gmMode}`;
      } else if (originName && stop.address) {
        routeUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originName)}&destination=${encodeURIComponent(stop.address)}&travelmode=${gmMode}`;
      } else if (stop.address || stop.name) {
        routeUrl = mapsUrl(stop.address || stop.name);
      }

      // Generar URL para volver al hotel
      let returnToHotelUrl = '';
      if (city.hotelAddr || city.hotelName) {
        const hotelDest = city.hotelAddr || city.hotelName;
        if (stop.lat && stop.lon && city.hotelLat && city.hotelLon) {
          returnToHotelUrl = `https://www.google.com/maps/dir/?api=1&origin=${stop.lat},${stop.lon}&destination=${city.hotelLat},${city.hotelLon}&travelmode=transit`;
        } else {
          returnToHotelUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(stop.address || stop.name)}&destination=${encodeURIComponent(hotelDest)}&travelmode=transit`;
        }
      }
      
      stopsHtml += distSeparator;
      stopsHtml += `<div class="stop-item ${isVisuallyLast ? 'stop-last' : ''}" data-stopid="${stop.id}">
        <div class="drag-handle" title="Arrastrar para reordenar">
          <svg width="14" height="20" viewBox="0 0 14 20" fill="currentColor"><circle cx="4" cy="4" r="1.8"/><circle cx="10" cy="4" r="1.8"/><circle cx="4" cy="10" r="1.8"/><circle cx="10" cy="10" r="1.8"/><circle cx="4" cy="16" r="1.8"/><circle cx="10" cy="16" r="1.8"/></svg>
        </div>
        <div class="stop-connector">
          <div class="stop-dot ${typeDotClass(stop.type)}">${typeIcon(stop.type)}</div>
          ${!isVisuallyLast ? '<div class="stop-line"></div>' : ''}
        </div>
        <div class="stop-body">
          <span class="transport-badge ${transportClass(stop.transport)}">${transportIcon(stop.transport)} ${transportLabel(stop.transport)}</span>
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
            <button class="btn-edit-stop" onclick="openEditStopModal('${stop.id}')">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="btn-delete-stop" onclick="deleteStop('${stop.id}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>
      </div>`;
    });

    // ── Parada automática: terminal de salida si hay pasaje que sale hoy ──
    let departureTerminalHtml = '';
    // Only show if ticket has at least type or terminal defined (not a blank stub)
    if (todayDeparture && (todayDeparture.type || todayDeparture.depTerminal || todayDeparture.fromTerminal)) {
      const terminalName = todayDeparture.depTerminalFull || todayDeparture.depTerminal || todayDeparture.fromTerminal || null;
      const terminalLabel = terminalName || ticketTypeLabel(todayDeparture.type) + ' salida';
      const depTimeStr = todayDeparture.depTime ? ` · ${todayDeparture.depTime}` : '';
      const gateStr = todayDeparture.depGate ? ` · Puerta ${todayDeparture.depGate}` : '';
      // Origin: always the hotel (not the last stop)
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

    // ── Parada automática: hotel de llegada si hay pasaje que llega hoy ──
    // NOTA: Ya no se usa porque ahora el hotel se muestra inmediatamente después del vuelo de llegada
    // Esta lógica está comentada para evitar duplicación
    let arrivalHotelHtml = '';
    /*
    if (todayArrival && city.hotelName && (todayArrival.type || todayArrival.arrTerminal || todayArrival.toTerminal)) {
      // Origin: last user stop if any, otherwise the arrival terminal
      const lastStopAddr = stops.length > 0 ? (stops[stops.length-1].address || stops[stops.length-1].name) : null;
      const origin = lastStopAddr || todayArrival.arrTerminal || todayArrival.toTerminal || todayArrival.toCity;
      const dest = city.hotelAddr || city.hotelName;
      const routeToHotel = origin && dest
        ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(dest)}&travelmode=transit`
        : dest ? mapsUrl(dest) : '';

      arrivalHotelHtml = `<div class="stop-item stop-last arrival-hotel-stop">
        <div class="stop-connector">
          <div class="stop-line" style="min-height:14px"></div>
          <div class="stop-dot hotel">🏨</div>
        </div>
        <div class="stop-body" style="padding-top:4px">
          <div class="stop-name">${esc(city.hotelName)}</div>
          <div class="stop-meta">
            ${city.hotelAddr ? `<span>📍 ${esc(city.hotelAddr)}</span>` : ''}
            <span style="color:var(--accent3);font-size:0.7rem">Check-in</span>
          </div>
          <div class="stop-actions">
            ${city.hotelAddr ? `<a class="btn-maps" href="${mapsUrl(city.hotelAddr)}" target="_blank">📌 Ver en Maps</a>` : city.hotelName ? `<a class="btn-maps" href="${mapsUrl(city.hotelName)}" target="_blank">📌 Ver en Maps</a>` : ''}
          </div>
        </div>
      </div>`;
    }
    */

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
      const isOptimized = _originalStopOrder !== null;
      routeActionsHtml = `<div class="route-actions">
        <button class="btn-optimize" onclick="${isOptimized ? 'restoreStopOrder()' : 'optimizeCurrentStops()'}">
          ${isOptimized ? '↩️ Restaurar orden original' : '✨ Optimizar ruta'}
        </button>
        <a class="btn-full-route" href="${fullUrl}" target="_blank">🗺️ Ruta completa del día en Maps</a>
        <a class="btn-return-hotel" href="${retUrl}" target="_blank">🏨 Volver al hotel</a>
      </div>`;
    }

    // ── Gap detection ──────────────────────────────────────
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
        const isLastDay  = day.date === city.endDate;
        const hotelLabel = `<div class="section-label" style="margin-bottom:8px">Hotel</div>`;
        if (city.hotelName) {
          const tags = [];
          if (isFirstDay && city.checkInTime)   tags.push(`<span class="hotel-time-tag checkin">✅ Check-in ${city.checkInTime}</span>`);
          if (isFirstDay && !city.checkInTime)  tags.push(`<span class="hotel-time-tag checkin-empty" onclick="openEditHotelModal()">✅ Agregar check-in</span>`);
          if (isLastDay  && city.checkOutTime)  tags.push(`<span class="hotel-time-tag checkout">🚪 Check-out ${city.checkOutTime}</span>`);
          if (isLastDay  && !city.checkOutTime) tags.push(`<span class="hotel-time-tag checkout-empty" onclick="openEditHotelModal()">🚪 Agregar check-out</span>`);
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
        const cityWeather = _weatherCache && _weatherCache[city.id];
        let weatherData = null;
        if (cityWeather) {
          if (cityWeather.outOfRange) {
            weatherData = cityWeather;
          } else if (cityWeather.days) {
            weatherData = cityWeather.days[day.date] || null;
          }
        }
        const weatherHtml = buildWeatherHtml(weatherData);
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

    initDragDrop();
    setTimeout(updateDayScrollFades, 0);

    // Prefetch weather in background
    if (!_weatherPrefetching) {
      _weatherPrefetching = true;
      prefetchWeather(trip).then(() => {
        if (currentDetailTab === 'itinerary') renderDetail();
      });
    }

  } catch(err) {
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
  currentCityIdx = idx;
  currentDayIdx = 0;
  renderDetail();
  window.scrollTo(0, 0);
}
function switchDay(idx) {
  currentDayIdx = idx;
  renderDetail();
  window.scrollTo(0, 0);
}

// ══════════════════════════════════════
// TICKETS
// ══════════════════════════════════════
function ticketTypeIcon(t) { return ({flight:'✈️',bus:'🚌',train:'🚆',boat:'⛴️'})[t]||'🎫'; }
function ticketTypeLabel(t) { return ({flight:'Vuelo',bus:'Bus',train:'Tren',boat:'Barco'})[t]||'Sin definir'; }
function ticketTransportClass(t) {
  return ({flight:'transport-taxi', bus:'transport-transit', train:'transport-car', boat:'transport-walking'})[t] || 'transport-transit';
}
function terminalLabel(t) { return ({flight:'Aeropuerto',bus:'Terminal de bus',train:'Estación de tren',boat:'Puerto'})[t]||'Punto de salida / llegada'; }

function getTransitions(trip) {
  // Returns all city-to-city transitions sorted by departure date
  const cities = [...(trip.cities || [])].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const transitions = [];
  for (let i = 0; i < cities.length - 1; i++) {
    transitions.push({ fromCity: cities[i], toCity: cities[i + 1] });
  }
  return transitions;
}

function ensureTransitionTickets(trip) {
  if (!trip.tickets) trip.tickets = [];
  const transitions = getTransitions(trip);
  let changed = false;

  // Remove stubs whose transition no longer exists (city was deleted or renamed)
  const validTransitionKeys = new Set(transitions.map(({ fromCity, toCity }) => fromCity.name + '→' + toCity.name));
  const before = trip.tickets.length;
  trip.tickets = trip.tickets.filter(tk => !tk.stub || validTransitionKeys.has(tk.fromCity + '→' + tk.toCity));
  if (trip.tickets.length !== before) changed = true;

  transitions.forEach(({ fromCity, toCity }) => {
    const existing = trip.tickets.find(tk =>
      tk.fromCity === fromCity.name && tk.toCity === toCity.name
    );
    if (!existing) {
      trip.tickets.push({
        id: uid(),
        type: null,
        company: '',
        fromCity: fromCity.name,
        toCity: toCity.name,
        fromTerminal: '',
        toTerminal: '',
        depDate: fromCity.endDate,
        depTime: '',
        arrDate: toCity.startDate,
        arrTime: '',
        stub: true
      });
      changed = true;
    } else if (existing.stub) {
      // Always sync dates on pending stubs to current city dates
      if (existing.depDate !== fromCity.endDate || existing.arrDate !== toCity.startDate) {
        existing.depDate = fromCity.endDate;
        existing.arrDate = toCity.startDate;
        changed = true;
      }
    }
  });

  if (changed) {
    trip.tickets.sort((a, b) => (a.depDate + (a.depTime||'')).localeCompare(b.depDate + (b.depTime||'')));
    save();
  }
}

function ticketIsComplete(tk) {
  return !!(tk.depTime && tk.arrTime && (tk.depTerminal || tk.fromTerminal || tk.arrTerminal || tk.toTerminal || tk.company));
}

// Auto-detect combinations: tickets where arrCity of one matches depCity of next,
// AND the intermediate city is not a stay-city in the trip (i.e. it's a layover, not a destination).
function buildCombinations(tickets, trip) {
  if (!tickets.length) return [];

  // Build set of stay-city names (lowercase) from the trip — these break chains
  const stayCities = new Set(
    (trip?.cities || [])
      .filter(ci => !ci.dayTrip)
      .map(ci => (ci.name || '').trim().toLowerCase())
  );

  const sorted = [...tickets].sort((a, b) =>
    (a.depDate + (a.depTime||'00:00')).localeCompare(b.depDate + (b.depTime||'00:00'))
  );

  const groups = [];
  const used = new Set();

  sorted.forEach(tk => {
    if (used.has(tk.id)) return;
    const chain = [tk];
    used.add(tk.id);
    let current = tk;

    let safeGuard = 0;
    while (safeGuard++ < 10) {
      const arrCity = (current.toCity || '').trim().toLowerCase();
      const arrDT   = current.arrDate ? (current.arrDate + 'T' + (current.arrTime || '00:00')) : null;

      // If the arrival city of the current ticket is a stay-city, stop —
      // the traveller is staying there, so any departing ticket is a new independent trip.
      if (stayCities.has(arrCity)) break;

      const next = sorted.find(t => {
        if (used.has(t.id)) return false;
        const depCity = (t.fromCity || '').trim().toLowerCase();
        if (depCity !== arrCity || !arrCity) return false;
        if (arrDT && t.depDate) {
          const depDT = t.depDate + 'T' + (t.depTime || '00:00');
          if (depDT < arrDT) return false;
          // Reject if layover > 24h even for non-stay cities
          const diff = new Date(depDT) - new Date(arrDT);
          if (diff > 24 * 3600000) return false;
        }
        return true;
      });
      if (!next) break;
      chain.push(next);
      used.add(next.id);
      current = next;
    }
    groups.push(chain);
  });

  return groups;
}

function renderTickets() {
  const trip = trips.find(t => t.id === currentTripId);
  if (!trip) return;
  const el = document.getElementById('tickets-content');
  if (!el) return;

  ensureTransitionTickets(trip);

  const tickets = trip.tickets || [];
  const pending = tickets.filter(tk => tk.stub || !ticketIsComplete(tk)).length;

  let html = `<div class="trip-header">
    <div class="trip-title">${esc(trip.name)}</div>
    <div class="trip-subtitle">
      <span>🎫 ${tickets.length} pasaje${tickets.length !== 1 ? 's' : ''}</span>
      ${pending > 0 ? `<span class="tickets-pending-badge">${pending} sin completar</span>` : `<span class="tickets-complete-badge">✓ Todo completo</span>`}
    </div>
  </div>`;

  if (!tickets.length) {
    html += `<div class="empty-state" style="padding:40px 0">
      <p>Sin pasajes detectados</p>
      <small>Agregá al menos dos ciudades al viaje</small>
    </div>`;
  } else {
    const groups = buildCombinations(tickets, trip);
    html += `<div class="tickets-list">`;

    groups.forEach(group => {
      if (group.length === 1) {
        html += renderTicketCard(group[0]);
      } else {
        // Auto-detected combination group
        const first = group[0];
        const last  = group[group.length - 1];
        const anyStub = group.some(t => t.stub && !ticketIsComplete(t));
        html += `<div class="ticket-chain-group">
          <div class="ticket-chain-header">
            <span>🔗 Combinación · ${group.length} tramos</span>
            <small>${esc(first.fromCity)} → ${esc(last.toCity)}</small>
            ${anyStub
              ? `<span class="ticket-status-badge pending" style="margin-left:auto">Pendiente</span>`
              : `<span class="ticket-status-badge done" style="margin-left:auto">✓</span>`}
          </div>`;
        group.forEach((t, ci) => {
          if (ci > 0) {
            const prev = group[ci - 1];
            const waitStr = calcWaitTime(prev.arrDate, prev.arrTime, t.depDate, t.depTime);
            const layoverCity = (prev.toCity || '').trim();
            html += `<div class="ticket-chain-connector">
              <div class="ticket-chain-connector-line"></div>
              <span class="ticket-chain-wait">⏱ ${layoverCity ? esc(layoverCity) + ' · ' : ''}${waitStr || 'Conexión'}</span>
              <div class="ticket-chain-connector-line"></div>
            </div>`;
          }
          html += renderTicketCard(t);
        });
        html += `</div>`;
      }
    });

    html += `</div>`;
  }

  html += `<button class="btn-add-ticket" onclick="openAddTicketModal()">+ Agregar pasaje</button>`;
  el.innerHTML = html;
}

function calcWaitTime(date1, time1, date2, time2) {
  if (!date1 || !date2) return null;
  const t1 = new Date((date1 + 'T' + (time1 || '00:00')).replace('T', 'T'));
  const t2 = new Date((date2 + 'T' + (time2 || '00:00')).replace('T', 'T'));
  const diff = t2 - t1;
  if (isNaN(diff) || diff < 0) return null;
  const hrs = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hrs === 0) return `${mins}min de espera`;
  if (mins === 0) return `${hrs}h de espera`;
  return `${hrs}h ${mins}min de espera`;
}

function calcDuration(date1, time1, date2, time2) {
  if (!date1 || !date2 || !time1 || !time2) return null;
  const t1 = new Date(date1 + 'T' + time1);
  const t2 = new Date(date2 + 'T' + time2);
  const diff = t2 - t1;
  if (isNaN(diff) || diff < 0) return null;
  const hrs = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hrs === 0) return `${mins}min`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}min`;
}

function renderTicketCard(tk) {
  const icon = ticketTypeIcon(tk.type);
  const complete = ticketIsComplete(tk);
  const isStub = tk.stub && !complete;
  const duration = calcDuration(tk.depDate, tk.depTime, tk.arrDate, tk.arrTime);
  return `<div class="ticket-card ${isStub ? 'ticket-stub' : ''}">
    <div class="ticket-card-header">
      <div class="ticket-type-icon">${icon}</div>
      <div class="ticket-header-info">
        <div class="ticket-route">${esc(tk.fromCity)} → ${esc(tk.toCity)}</div>
        <div class="ticket-company">${ticketTypeLabel(tk.type)}${tk.company ? ' · ' + esc(tk.company) : ''}${duration ? ` · ⏱️ ${duration}` : ''}</div>
      </div>
      ${isStub
        ? `<span class="ticket-status-badge pending">Pendiente</span>`
        : `<span class="ticket-status-badge done">✓</span>`}
    </div>
    <div class="ticket-card-body">
      <div class="ticket-times">
        <div>
          <div class="ticket-time" style="${!tk.depTime ? 'opacity:.35' : ''}">${tk.depTime || '–'}</div>
          <div class="ticket-date-label">${tk.depDate ? formatDate(tk.depDate) : ''}</div>
          <div class="ticket-city-label">📍 ${esc(tk.fromCity)}</div>
          ${(tk.depTerminal||tk.fromTerminal) ? `<div class="ticket-terminal">🏛️ ${esc(tk.depTerminal||tk.fromTerminal)}</div>` : ''}
          ${tk.depGate ? `<div class="ticket-terminal">🚪 ${esc(tk.depGate)}</div>` : ''}
        </div>
        <div class="ticket-arrow"><div class="ticket-arrow-line"></div><span style="font-size:0.65rem;color:var(--text2);margin-top:3px">${icon}</span></div>
        <div style="display:flex;flex-direction:column;align-items:flex-end">
          <div class="ticket-time" style="${!tk.arrTime ? 'opacity:.35' : ''}">${tk.arrTime || '–'}</div>
          <div class="ticket-date-label">${tk.arrDate ? formatDate(tk.arrDate) : ''}</div>
          <div class="ticket-city-label" style="justify-content:flex-end">📍 ${esc(tk.toCity)}</div>
          ${(tk.arrTerminal||tk.toTerminal) ? `<div class="ticket-terminal" style="align-self:flex-end">🏛️ ${esc(tk.arrTerminal||tk.toTerminal)}</div>` : ''}
          ${tk.arrGate ? `<div class="ticket-terminal" style="align-self:flex-end">🚪 ${esc(tk.arrGate)}</div>` : ''}
        </div>
      </div>
      <div class="ticket-actions">
        <button class="btn-ticket-edit ${isStub ? 'btn-ticket-edit-highlight' : ''}" onclick="openEditTicketModal('${tk.id}')">
          ${isStub ? '+ Completar datos' : '✏️ Editar'}
        </button>
        <button class="btn-ticket-delete" onclick="deleteTicket('${tk.id}')">🗑️</button>
      </div>
    </div>
  </div>`;
}

function renderTransitCard(tk) {
  const icon = ticketTypeIcon(tk.type);
  const complete = ticketIsComplete(tk);
  const isStub = tk.stub && !complete;
  const duration = calcDuration(tk.depDate, tk.depTime, tk.arrDate, tk.arrTime);
  return `<div class="ticket-card ${isStub ? 'ticket-stub' : ''}">
    <div class="ticket-card-header">
      <div class="ticket-type-icon">${icon}</div>
      <div class="ticket-header-info">
        <div class="ticket-route">${esc(tk.fromCity)} → ${esc(tk.toCity)}</div>
        <div class="ticket-company">${ticketTypeLabel(tk.type)}${tk.company ? ' · ' + esc(tk.company) : ''}${duration ? ` · ⏱️ ${duration}` : ''}</div>
      </div>
      ${isStub
        ? `<span class="ticket-status-badge pending">Pendiente</span>`
        : `<span class="ticket-status-badge done">✓</span>`}
    </div>
    <div class="ticket-card-body">
      <div class="ticket-times">
        <div>
          <div class="ticket-time" style="${!tk.depTime ? 'opacity:.35' : ''}">${tk.depTime || '–'}</div>
          <div class="ticket-date-label">${tk.depDate ? formatDate(tk.depDate) : ''}</div>
          <div class="ticket-city-label">📍 ${esc(tk.fromCity)}</div>
          ${(tk.depTerminal||tk.fromTerminal) ? `<div class="ticket-terminal">🏛️ ${esc(tk.depTerminal||tk.fromTerminal)}</div>` : ''}
          ${tk.depGate ? `<div class="ticket-terminal">🚪 ${esc(tk.depGate)}</div>` : ''}
        </div>
        <div class="ticket-arrow"><div class="ticket-arrow-line"></div><span style="font-size:0.65rem;color:var(--text2);margin-top:3px">${icon}</span></div>
        <div style="display:flex;flex-direction:column;align-items:flex-end">
          <div class="ticket-time" style="${!tk.arrTime ? 'opacity:.35' : ''}">${tk.arrTime || '–'}</div>
          <div class="ticket-date-label">${tk.arrDate ? formatDate(tk.arrDate) : ''}</div>
          <div class="ticket-city-label" style="justify-content:flex-end">📍 ${esc(tk.toCity)}</div>
          ${(tk.arrTerminal||tk.toTerminal) ? `<div class="ticket-terminal" style="align-self:flex-end">🏛️ ${esc(tk.arrTerminal||tk.toTerminal)}</div>` : ''}
          ${tk.arrGate ? `<div class="ticket-terminal" style="align-self:flex-end">🚪 ${esc(tk.arrGate)}</div>` : ''}
        </div>
      </div>
    </div>
  </div>`;
}

function openAddTicketModal() {
  const trip = trips.find(t => t.id === currentTripId);
  editingTicketId = null;
  selectedTicketType = null;
  document.getElementById('ticket-modal-title').textContent = '🎫 Agregar pasaje';
  document.getElementById('ticket-company').value = '';
  document.getElementById('ticket-from-city').value = '';
  document.getElementById('ticket-to-city').value = '';
  document.getElementById('ticket-dep-terminal').value = '';
  document.getElementById('ticket-dep-terminal-lat').value = '';
  document.getElementById('ticket-dep-terminal-lon').value = '';
  document.getElementById('ticket-dep-terminal-full').value = '';
  document.getElementById('ticket-dep-gate').value = '';
  document.getElementById('ticket-arr-terminal').value = '';
  document.getElementById('ticket-arr-terminal-lat').value = '';
  document.getElementById('ticket-arr-terminal-lon').value = '';
  document.getElementById('ticket-arr-terminal-full').value = '';
  document.getElementById('ticket-arr-gate').value = '';
  document.getElementById('ticket-dep-date').value = trip?.startDate || '';
  document.getElementById('ticket-arr-date').value = trip?.startDate || '';
  setWheelTime('ticket-dep-time', '');
  setWheelTime('ticket-arr-time', '');
  document.querySelectorAll('#ticket-type-grid .transport-option').forEach(el => el.classList.remove('selected'));
  updateTicketFields(null);
  ticketWizardGoToStep(1);
  openModal('modal-ticket');
}

function openEditTicketModal(ticketId) {
  const trip = trips.find(t => t.id === currentTripId);
  if (!trip) return;
  const tk = (trip.tickets || []).find(t => t.id === ticketId);
  if (!tk) return;
  editingTicketId = ticketId;
  document.getElementById('ticket-modal-title').textContent = '🎫 Editar pasaje';
  selectedTicketType = tk.type || null;
  document.querySelectorAll('#ticket-type-grid .transport-option').forEach(el =>
    el.classList.toggle('selected', el.dataset.ttype === selectedTicketType)
  );
  document.getElementById('ticket-company').value = tk.company || '';
  document.getElementById('ticket-from-city').value = tk.fromCity || '';
  document.getElementById('ticket-to-city').value = tk.toCity || '';
  // Support both old field names and new ones
  document.getElementById('ticket-dep-terminal').value = tk.depTerminal || tk.fromTerminal || '';
  document.getElementById('ticket-dep-terminal-lat').value = tk.depTerminalLat || '';
  document.getElementById('ticket-dep-terminal-lon').value = tk.depTerminalLon || '';
  document.getElementById('ticket-dep-terminal-full').value = tk.depTerminalFull || '';
  document.getElementById('ticket-dep-gate').value = tk.depGate || '';
  document.getElementById('ticket-arr-terminal').value = tk.arrTerminal || tk.toTerminal || '';
  document.getElementById('ticket-arr-terminal-lat').value = tk.arrTerminalLat || '';
  document.getElementById('ticket-arr-terminal-lon').value = tk.arrTerminalLon || '';
  document.getElementById('ticket-arr-terminal-full').value = tk.arrTerminalFull || '';
  document.getElementById('ticket-arr-gate').value = tk.arrGate || '';
  document.getElementById('ticket-dep-date').value = tk.depDate || '';
  document.getElementById('ticket-arr-date').value = tk.arrDate || '';
  setWheelTime('ticket-dep-time', tk.depTime || '');
  setWheelTime('ticket-arr-time', tk.arrTime || '');
  if (selectedTicketType) {
    updateTicketFields(selectedTicketType);
  }
  ticketWizardGoToStep(1);
  openModal('modal-ticket');
}

function ticketWizardGoToStep(step) {
  document.querySelectorAll('#modal-ticket .wizard-step').forEach((el, i) => {
    el.classList.toggle('active', i + 1 <= step);
    el.classList.toggle('completed', i + 1 < step);
  });
  document.querySelectorAll('#modal-ticket .wizard-content').forEach((el, i) => {
    el.style.display = (i + 1 === step) ? 'block' : 'none';
  });
}

function ticketWizardNextStep(currentStep) {
  if (currentStep === 1) {
    const fromCity = document.getElementById('ticket-from-city').value.trim();
    const toCity = document.getElementById('ticket-to-city').value.trim();
    if (!fromCity) { showToast('⚠️ Ingresá la ciudad de salida'); return; }
    if (!toCity) { showToast('⚠️ Ingresá la ciudad de llegada'); return; }
    if (!selectedTicketType) { showToast('⚠️ Elegí el tipo de transporte'); return; }
  }
  ticketWizardGoToStep(currentStep + 1);
}

function ticketWizardPrevStep(currentStep) {
  ticketWizardGoToStep(currentStep - 1);
}

function selectTicketType(el, type) {
  selectedTicketType = type;
  document.querySelectorAll('#ticket-type-grid .transport-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  updateTicketFields(type);
}

const TICKET_CONFIG = {
  flight: {
    depSection: 'Salida',
    arrSection: 'Llegada',
    terminalLabel: 'Aeropuerto',
    depTerminalPh: 'Ej: Aeropuerto El Prat (BCN)',
    arrTerminalPh: 'Ej: Charles de Gaulle (CDG)',
    showGate: true,
    depGateLabel: 'Puerta de embarque',
    arrGateLabel: 'Puerta de desembarque',
    depGatePh: 'Ej: B22',
    arrGatePh: 'Ej: C14',
  },
  bus: {
    depSection: 'Salida',
    arrSection: 'Llegada',
    terminalLabel: 'Terminal de bus',
    depTerminalPh: 'Ej: Terminal Retiro, Buenos Aires',
    arrTerminalPh: 'Ej: Estación Eurolines, París',
    showGate: false,
  },
  train: {
    depSection: 'Salida',
    arrSection: 'Llegada',
    terminalLabel: 'Estación',
    depTerminalPh: 'Ej: Estación Constitución',
    arrTerminalPh: 'Ej: Gare du Nord, París',
    showGate: true,
    depGateLabel: 'Andén / Vagón',
    arrGateLabel: 'Andén / Vagón',
    depGatePh: 'Ej: Andén 3, Vagón 5',
    arrGatePh: 'Ej: Andén 7',
  },
  boat: {
    depSection: 'Embarque',
    arrSection: 'Desembarque',
    terminalLabel: 'Puerto / Terminal',
    depTerminalPh: 'Ej: Puerto de Barcelona, Terminal A',
    arrTerminalPh: 'Ej: Puerto de Civitavecchia',
    showGate: true,
    depGateLabel: 'Muelle / Puerta de embarque',
    arrGateLabel: 'Muelle / Puerta de desembarque',
    depGatePh: 'Ej: Muelle Sur',
    arrGatePh: 'Ej: Terminal 2',
  },
};

function updateTicketFields(type) {
  if (!type) return;

  const cfg = TICKET_CONFIG[type] || TICKET_CONFIG.flight;

  document.getElementById('ticket-dep-section-label').textContent = cfg.depSection;
  document.getElementById('ticket-arr-section-label').textContent = cfg.arrSection;

  // Siempre mostrar campos de terminal (son necesarios para el autocomplete)
  document.getElementById('ticket-dep-terminal-group').style.display = '';
  document.getElementById('ticket-arr-terminal-group').style.display = '';
  
  // Actualizar labels según el tipo de transporte
  if (type === 'flight') {
    document.getElementById('ticket-dep-terminal-label').textContent = 'Aeropuerto de salida';
    document.getElementById('ticket-arr-terminal-label').textContent = 'Aeropuerto de llegada';
    document.getElementById('ticket-dep-terminal').placeholder = 'Escribí el aeropuerto...';
    document.getElementById('ticket-arr-terminal').placeholder = 'Escribí el aeropuerto...';
    document.getElementById('ticket-dep-gate-label').innerHTML = 'Puerta de embarque <span class="label-optional">opcional</span>';
    document.getElementById('ticket-dep-gate').placeholder = 'Ej: B22';
    document.getElementById('ticket-arr-gate-label').innerHTML = 'Puerta de desembarque <span class="label-optional">opcional</span>';
    document.getElementById('ticket-arr-gate').placeholder = 'Ej: C14';
  } else if (type === 'bus') {
    document.getElementById('ticket-dep-terminal-label').textContent = 'Terminal de salida';
    document.getElementById('ticket-arr-terminal-label').textContent = 'Terminal de llegada';
    document.getElementById('ticket-dep-terminal').placeholder = 'Escribí la terminal de bus...';
    document.getElementById('ticket-arr-terminal').placeholder = 'Escribí la terminal de bus...';
    document.getElementById('ticket-dep-gate-group').style.display = 'none';
    document.getElementById('ticket-arr-gate-group').style.display = 'none';
  } else if (type === 'train') {
    document.getElementById('ticket-dep-terminal-label').textContent = 'Estación de salida';
    document.getElementById('ticket-arr-terminal-label').textContent = 'Estación de llegada';
    document.getElementById('ticket-dep-terminal').placeholder = 'Escribí la estación de tren...';
    document.getElementById('ticket-arr-terminal').placeholder = 'Escribí la estación de tren...';
    document.getElementById('ticket-dep-gate-label').innerHTML = 'Andén / Wagon <span class="label-optional">opcional</span>';
    document.getElementById('ticket-dep-gate').placeholder = 'Ej: Andén 3, Wagon 5';
    document.getElementById('ticket-arr-gate-label').innerHTML = 'Andén / Wagon <span class="label-optional">opcional</span>';
    document.getElementById('ticket-arr-gate').placeholder = 'Ej: Andén 4';
    document.getElementById('ticket-dep-gate-group').style.display = '';
    document.getElementById('ticket-arr-gate-group').style.display = '';
  } else if (type === 'boat') {
    document.getElementById('ticket-dep-terminal-label').textContent = 'Puerto de salida';
    document.getElementById('ticket-arr-terminal-label').textContent = 'Puerto de llegada';
    document.getElementById('ticket-dep-terminal').placeholder = 'Escribí el puerto...';
    document.getElementById('ticket-arr-terminal').placeholder = 'Escribí el puerto...';
    document.getElementById('ticket-dep-gate-group').style.display = 'none';
    document.getElementById('ticket-arr-gate-group').style.display = 'none';
  }

  const gateGroups = [
    document.getElementById('ticket-dep-gate-group'),
    document.getElementById('ticket-arr-gate-group'),
  ];
}

// Keep old name as alias for any remaining calls
function updateTerminalLabels(type) { updateTicketFields(type); }

function saveTicket() {
  const trip = trips.find(t => t.id === currentTripId);
  if (!trip) return;
  if (!selectedTicketType) { showToast('⚠️ Elegí el tipo de transporte'); return; }
  const fromCity = document.getElementById('ticket-from-city').value.trim();
  const toCity   = document.getElementById('ticket-to-city').value.trim();
  const depDate  = document.getElementById('ticket-dep-date').value;
  const arrDate  = document.getElementById('ticket-arr-date').value;
  if (!fromCity || !toCity) { showToast('⚠️ Ingresá las ciudades de origen y destino'); return; }
  if (!depDate || !arrDate) { showToast('⚠️ Ingresá las fechas de salida y llegada');    return; }

  const data = {
    type: selectedTicketType,
    company:      document.getElementById('ticket-company').value.trim(),
    fromCity, toCity,
    depTerminal:  document.getElementById('ticket-dep-terminal').value.trim(),
    depTerminalLat: document.getElementById('ticket-dep-terminal-lat').value.trim(),
    depTerminalLon: document.getElementById('ticket-dep-terminal-lon').value.trim(),
    depTerminalFull: document.getElementById('ticket-dep-terminal-full').value.trim(),
    depGate:      document.getElementById('ticket-dep-gate').value.trim(),
    arrTerminal:  document.getElementById('ticket-arr-terminal').value.trim(),
    arrTerminalLat: document.getElementById('ticket-arr-terminal-lat').value.trim(),
    arrTerminalLon: document.getElementById('ticket-arr-terminal-lon').value.trim(),
    arrTerminalFull: document.getElementById('ticket-arr-terminal-full').value.trim(),
    arrGate:      document.getElementById('ticket-arr-gate').value.trim(),
    depDate, depTime: getWheelTime('ticket-dep-time'),
    arrDate, arrTime: getWheelTime('ticket-arr-time'),
  };

  if (!trip.tickets) trip.tickets = [];
  if (editingTicketId) {
    const idx = trip.tickets.findIndex(t => t.id === editingTicketId);
    if (idx !== -1) trip.tickets[idx] = { ...trip.tickets[idx], ...data, stub: false };
  } else {
    trip.tickets.push({ id: uid(), ...data, stub: false });
  }
  trip.tickets.sort((a, b) => (a.depDate + (a.depTime||'')).localeCompare(b.depDate + (b.depTime||'')));
  save();
  closeModal('modal-ticket');
  renderTickets();
  renderDetail();
  showToast(editingTicketId ? '✅ Pasaje actualizado' : '✅ Pasaje agregado');
}

function deleteTicket(ticketId) {
  const trip = trips.find(t => t.id === currentTripId);
  if (!trip) return;
  const tk = (trip.tickets || []).find(t => t.id === ticketId);
  if (!tk) return;
  _pendingDeleteTicketId = ticketId;
  document.getElementById('confirm-delete-ticket-body').textContent =
    `${ticketTypeLabel(tk.type)} ${esc(tk.fromCity)} → ${esc(tk.toCity)}${tk.depDate ? ', ' + formatDate(tk.depDate) : ''}. Esta acción no se puede deshacer.`;
  openModal('modal-confirm-delete-ticket');
}

function confirmDeleteTicket() {
  const trip = trips.find(t => t.id === currentTripId);
  if (!trip || !_pendingDeleteTicketId) return;
  trip.tickets = (trip.tickets || []).filter(t => t.id !== _pendingDeleteTicketId);
  _pendingDeleteTicketId = null;
  save();
  closeModal('modal-confirm-delete-ticket');
  renderTickets();
  renderDetail();
  showToast('🗑️ Pasaje eliminado');
}

let _pendingDeleteCityId = null;

function deleteCity(cityId) {
  const trip = trips.find(t => t.id === currentTripId);
  if (!trip || trip.cities.length <= 1) { showToast('⚠️ El viaje debe tener al menos una ciudad'); return; }
  const city = trip.cities.find(c => c.id === cityId);
  if (!city) return;
  _pendingDeleteCityId = cityId;
  const totalStops = city.days.reduce((a, d) => a + d.stops.length, 0);
  document.getElementById('confirm-delete-city-title').textContent = `¿Eliminar ${city.name}?`;
  document.getElementById('confirm-delete-city-body').textContent = totalStops > 0
    ? `Se eliminarán también los ${totalStops} punto${totalStops!==1?'s':''} del itinerario de esta ciudad. Esta acción no se puede deshacer.`
    : 'Esta ciudad no tiene paradas cargadas. Esta acción no se puede deshacer.';
  openModal('modal-confirm-delete-city');
}

function confirmDeleteCity() {
  const trip = trips.find(t => t.id === currentTripId);
  if (!trip || !_pendingDeleteCityId) return;
  const city = trip.cities.find(c => c.id === _pendingDeleteCityId);
  const name = city?.name || 'Ciudad';
  const idx = trip.cities.findIndex(c => c.id === _pendingDeleteCityId);
  if (idx === -1) return;
  trip.cities.splice(idx, 1);
  if (currentCityIdx >= trip.cities.length) currentCityIdx = trip.cities.length - 1;
  if (currentCityIdx < 0) currentCityIdx = 0;
  currentDayIdx = 0; // Always reset day index — it may no longer be valid for the new city
  _pendingDeleteCityId = null;
  save();
  closeModal('modal-confirm-delete-city');
  renderDetail();
  showToast(`🗑️ ${name} eliminada`);
}

// ══════════════════════════════════════
// EDIT TRIP DATES
// ══════════════════════════════════════
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
          ${trip.cities.length > 1 ? `<button class="edit-city-delete-btn" onclick="openDeleteCityFromEditModal(${i})" title="Eliminar ciudad">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6M8,6V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2v2"/></svg>
          </button>` : ''}
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

function onEditTripStartChange() {
  const s = document.getElementById('edit-trip-start').value;
  const eEl = document.getElementById('edit-trip-end');
  eEl.min = s;
  if (eEl.value && eEl.value < s) { eEl.value = s; }
  document.getElementById('edit-trip-end-err').classList.remove('visible');
  document.querySelectorAll('[id^="edit-trip-city-start-"], [id^="edit-trip-city-end-"]').forEach(el => { el.min = s; });
}

function onEditTripEndChange() {
  const s = document.getElementById('edit-trip-start').value;
  const e = document.getElementById('edit-trip-end').value;
  const err = document.getElementById('edit-trip-end-err');
  err.classList.toggle('visible', !!(e && e < s));
  document.querySelectorAll('[id^="edit-trip-city-start-"], [id^="edit-trip-city-end-"]').forEach(el => { el.max = e; });
}

function saveEditTripDates() {
  const trip = trips.find(t => t.id === currentTripId);
  if (!trip) return;
  const name = document.getElementById('edit-trip-name').value.trim();
  const newStart = document.getElementById('edit-trip-start').value;
  const newEnd = document.getElementById('edit-trip-end').value;
  if (!name) { showToast('⚠️ El nombre no puede estar vacío'); return; }
  if (!newStart || !newEnd) { showToast('⚠️ Completá las fechas'); return; }
  if (newEnd < newStart) { showToast('⚠️ La fecha fin debe ser posterior al inicio'); return; }

  const oldStart = trip.startDate;
  const oldEnd = trip.endDate;
  trip.name = name;
  trip.startDate = newStart;
  trip.endDate = newEnd;

  // Auto-adjust city dates to fit within new global range
  (trip.cities || []).forEach((ci, i) => {
    const startEl = document.getElementById(`edit-trip-city-start-${i}`);
    const endEl = document.getElementById(`edit-trip-city-end-${i}`);
    let ciStart = startEl ? startEl.value : ci.startDate;
    let ciEnd = endEl ? endEl.value : ci.endDate;

    // If city was covering the whole trip, expand/shrink with new trip dates
    if (ci.startDate === oldStart && ci.endDate === oldEnd) {
      ciStart = newStart;
      ciEnd = newEnd;
    } else {
      // Clamp to new range
      if (ciStart < newStart) ciStart = newStart;
      if (ciEnd > newEnd) ciEnd = newEnd;
      if (ciStart > ciEnd) { ciStart = newStart; ciEnd = newEnd; }
    }

    if (ciStart !== ci.startDate || ciEnd !== ci.endDate) {
      const stopsMap = {};
      (ci.days || []).forEach(d => { if (d.stops?.length) stopsMap[d.date] = d.stops; });
      ci.days = buildDays(ciStart, ciEnd).map(d => ({ ...d, stops: stopsMap[d.date] || [] }));
      ci.startDate = ciStart;
      ci.endDate = ciEnd;
    }
  });

  save();
  closeModal('modal-edit-trip-dates');
  renderDetail();
  showToast('✅ Fechas del viaje actualizadas');
}

// ══════════════════════════════════════
// EDIT CITY NAME
// ══════════════════════════════════════
let _editingCityIndex = null;
let _editingCityId = null;

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

function confirmDeleteCityFromModal() {
  const trip = trips.find(t => t.id === currentTripId);
  if (!trip || _editingCityIndex === null) return;
  
  const city = trip.cities[_editingCityIndex];
  document.getElementById('confirm-delete-city-msg').textContent = `¿Estás seguro de eliminar "${city.name}" del viaje? Se eliminarán todos los días y paradas de esta ciudad.`;
  openModal('modal-confirm-delete-city');
}

function deleteCityFromModal() {
  const trip = trips.find(t => t.id === currentTripId);
  if (!trip || _editingCityId === null) return;
  
  const idx = trip.cities.findIndex(c => c.id === _editingCityId);
  if (idx !== -1) {
    trip.cities.splice(idx, 1);
    
    // Ajustar índice actual si es necesario
    if (currentCityIdx >= trip.cities.length) {
      currentCityIdx = Math.max(0, trip.cities.length - 1);
    }
    if (currentCityIdx < 0) currentCityIdx = 0;
    currentDayIdx = 0;
    
    save();
    closeModal('modal-confirm-delete-city');
    closeModal('modal-edit-city-name');
    renderDetail();
    showToast('✅ Ciudad eliminada');
  }
  
  _editingCityIndex = null;
  _editingCityId = null;
}

function openDeleteCityFromEditModal(cityIndex) {
  const trip = trips.find(t => t.id === currentTripId);
  if (!trip || cityIndex === null) return;
  
  const city = trip.cities[cityIndex];
  _editingCityIndex = cityIndex;
  _editingCityId = city.id;
  
  document.getElementById('confirm-delete-city-msg').textContent = `¿Estás seguro de eliminar "${city.name}" del viaje? Se eliminarán todos los días y paradas de esta ciudad.`;
  openModal('modal-confirm-delete-city');
}

function saveEditCityName() {
  const trip = trips.find(t => t.id === currentTripId);
  if (!trip || _editingCityIndex === null) return;
  
  const newName = document.getElementById('edit-city-name-input').value.trim();
  const newCountry = document.getElementById('edit-city-country-input').value.trim().toLowerCase();
  
  if (!newName) {
    showToast('⚠️ El nombre no puede estar vacío');
    return;
  }
  
  trip.cities[_editingCityIndex].name = newName;
  if (newCountry) {
    trip.cities[_editingCityIndex].countryCode = newCountry;
  }
  
  save();
  closeModal('modal-edit-city-name');
  _editingCityIndex = null;
  
  // Actualizar la vista
  renderDetail();
  showToast('✅ Ciudad actualizada');
}

// ══════════════════════════════════════
// EDIT CITY DATES
// ══════════════════════════════════════
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
    <div class="timeline-bar">`;
  
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

function jumpToCityFromTimeline(dateStr) {
  const trip = trips.find(t => t.id === currentTripId);
  if (!trip) return;
  const city = trip.cities.find(ci => dateStr >= ci.startDate && dateStr <= ci.endDate);
  if (city) {
    const cityIdx = trip.cities.findIndex(c => c.id === city.id);
    if (cityIdx !== -1) {
      currentCityIdx = cityIdx;
      const dayIdx = city.days.findIndex(d => d.date === dateStr);
      if (dayIdx !== -1) currentDayIdx = dayIdx;
      closeModal('modal-edit-city-dates');
      renderDetail();
    }
  }
}

function onEditCityStartChange() {
  const trip = trips.find(t => t.id === currentTripId);
  const s = document.getElementById('edit-city-start').value;
  const eEl = document.getElementById('edit-city-end');
  const err = document.getElementById('edit-city-start-err');
  eEl.min = s;
  if (eEl.value && eEl.value < s) eEl.value = s;
  const outOfRange = trip && (s < trip.startDate || s > trip.endDate);
  err.textContent = '⚠️ Fuera del rango del viaje';
  err.classList.toggle('visible', outOfRange);
}

function onEditCityEndChange() {
  const trip = trips.find(t => t.id === currentTripId);
  const s = document.getElementById('edit-city-start').value;
  const e = document.getElementById('edit-city-end').value;
  const err = document.getElementById('edit-city-end-err');
  if (e < s) {
    err.textContent = '⚠️ La salida debe ser posterior a la llegada';
    err.classList.add('visible');
  } else if (trip && e > trip.endDate) {
    err.textContent = `⚠️ Supera el fin del viaje (${formatDate(trip.endDate)})`;
    err.classList.add('visible');
  } else {
    err.classList.remove('visible');
  }
}

function saveEditCityDates() {
  const trip = trips.find(t => t.id === currentTripId);
  if (!trip) return;
  const city = trip.cities[currentCityIdx];
  const newStart = document.getElementById('edit-city-start').value;
  const newEnd = document.getElementById('edit-city-end').value;

  if (!newStart || !newEnd) { showToast('⚠️ Completá las fechas'); return; }
  if (newEnd < newStart) { showToast('⚠️ La salida debe ser posterior a la llegada'); return; }
  if (newStart < trip.startDate || newEnd > trip.endDate) {
    showToast(`⚠️ Las fechas deben estar dentro del viaje (${formatDate(trip.startDate)} – ${formatDate(trip.endDate)})`);
    return;
  }

  // Check overlap with other cities (not the current one, not day trips) - allow shared day for check-out/check-in
  const overlap = trip.cities.filter((ci, i) => i !== currentCityIdx && !ci.dayTrip).find(ci => {
    return newStart < ci.endDate && newEnd > ci.startDate;
  });
  if (overlap) {
    showToast(`⚠️ Se solapa con "${overlap.name}" (${formatDate(overlap.startDate)} → ${formatDate(overlap.endDate)})`);
    return;
  }

  // Rebuild days: keep existing stops for dates that survive, add empty days for new dates
  const existingByDate = {};
  city.days.forEach(d => { existingByDate[d.date] = d; });
  city.days = buildDays(newStart, newEnd).map(d =>
    existingByDate[d.date] ? existingByDate[d.date] : d
  );
  city.startDate = newStart;
  city.endDate = newEnd;

  // Also extend trip global dates if city goes beyond them
  if (newStart < trip.startDate) trip.startDate = newStart;
  if (newEnd > trip.endDate) trip.endDate = newEnd;

  if (currentDayIdx >= city.days.length) currentDayIdx = 0;
  save();
  closeModal('modal-edit-city-dates');
  renderDetail();
  showToast(`✅ Fechas de ${city.name} actualizadas`);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// ══════════════════════════════════════
// UNIVERSAL GEOCODER — 4 APIs en cadena
// Prioridad: Mapbox (si hay token) → geocode.xyz → Nominatim → Photon
// ══════════════════════════════════════

// ⚠️ Mapbox: Obtené tu token gratis en https://account.mapbox.com/ (requiere tarjeta para activación)
// Si no tenés token, el código salta automáticamente a las otras APIs
const MAPBOX_TOKEN = ''; // Dejá vacío si no tenés

async function searchAllGeocoders(query) {
  // 1. Mapbox (mejor autocomplete) - solo si hay token válido
  if (MAPBOX_TOKEN && MAPBOX_TOKEN.startsWith('pk.')) {
    try {
      const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&limit=8&language=es`);
      const json = await res.json();
      if (json && Array.isArray(json.features) && json.features.length > 0) {
        return json.features.map(f => ({
          display_name: f.place_name_es || f.place_name,
          lat: f.center[1],
          lon: f.center[0]
        }));
      }
    } catch(e) { /* continue */ }
  }

  // 2. geocode.xyz (100% gratis, sin signup, buena cobertura global)
  try {
    const res = await fetch(`https://geocode.xyz/?q=${encodeURIComponent(query)}&json=1&limit=8`);
    const json = await res.json();
    if (json && json.results && json.results.length > 0) {
      return json.results.map(r => ({
        display_name: r.formatted || r.display_name,
        lat: r.lat,
        lon: r.lon
      }));
    }
  } catch(e) { /* continue */ }

  // 3. Nominatim (OSM - gratuito, sin key)
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=8&addressdetails=1`, {
      headers: { 'User-Agent': 'Wandr/1.0 (https://wandr.travel; contact@wandr.travel)' }
    });
    const data = await res.json();
    if (data && Array.isArray(data) && data.length > 0) {
      return data.map(r => ({ 
        display_name: r.display_name, 
        lat: r.lat, 
        lon: r.lon,
        country_code: r.address?.country_code?.toLowerCase() || null
      }));
    }
  } catch(e) { /* continue */ }

  // 4. Photon (último recurso, sin key)
  try {
    const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=8`);
    const json = await res.json();
    if (json && Array.isArray(json.features) && json.features.length > 0) {
      return json.features.map(f => {
        const p = f.properties;
        const name = p.name || '';
        const street = p.street || '';
        const city = p.city || '';
        const state = p.state || '';
        const country = p.country || '';
        const countryCode = p.countrycode?.toLowerCase() || '';
        const parts = [name, street, city, state, country].filter(Boolean);
        const coords = f.geometry && f.geometry.coordinates;
        return {
          display_name: parts.join(', '),
          lat: coords ? coords[1] : null,
          lon: coords ? coords[0] : null,
          country_code: countryCode || null
        };
      }).filter(r => r.display_name);
    }
  } catch(e) { /* continue */ }

  return [];
}

// ── Stop name autocomplete (Agregar parada, Paso 1) ──────────
let _stopNameAcTimer = null;
let _stopNameAcResults = [];

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

async function runStopNameSearch(query, list, nameInput, addrInput) {
  _stopNameAcResults = [];
  list.innerHTML = '<li class="loading">Buscando...</li>';
  list.style.display = 'block';

  const data = await searchAllGeocoders(query);
  if (data.length > 0) {
    _stopNameAcResults = data;
    list.innerHTML = data.map((r, i) => {
      const parts = r.display_name.split(',');
      return `<li data-sni="${i}">
        <strong>${esc(parts[0].trim())}</strong><br>
        <small>${esc(parts.slice(1, 4).join(',').trim())}</small>
      </li>`;
    }).join('');
    list.querySelectorAll('li[data-sni]').forEach(li => {
      const handler = () => pickStopNameResult(parseInt(li.dataset.sni, 10), nameInput, addrInput);
      li.addEventListener('mousedown', handler);
      li.addEventListener('touchstart', (e) => { e.preventDefault(); handler(); }, { passive: false });
    });
  } else {
    list.innerHTML = '<li class="no-results">Sin resultados. Escribí el nombre a mano y seguí.</li>';
  }
}

function pickStopNameResult(index, nameInput, addrInput) {
  const result = _stopNameAcResults[index];
  if (!result) return;
  const parts = result.display_name.split(',');
  nameInput.value = parts[0].trim();
  addrInput.value = parts.slice(1).join(',').trim();
  stopSelectedLat = result.lat;
  stopSelectedLon = result.lon;
  const display = document.getElementById('selected-address-display');
  if (display) display.style.display = 'block';
  document.getElementById('stop-name-results').style.display = 'none';
}

// ── City name autocomplete (Agregar ciudad) ─────────────────────
let _cityAcTimer = null;
let _cityAcResults = [];

function initCityNameAutocomplete() {
  const input = document.getElementById('new-city-name');
  const list = document.getElementById('new-city-name-list');
  if (!input || !list) return;

  const newInput = input.cloneNode(true);
  input.parentNode.replaceChild(newInput, input);
  const el = document.getElementById('new-city-name');

  el.addEventListener('input', () => {
    clearTimeout(_cityAcTimer);
    const q = el.value.trim();
    if (q.length < 2) { list.classList.remove('open'); list.innerHTML = ''; return; }
    _cityAcTimer = setTimeout(() => runCitySearch(q, list, el), 350);
  });

  el.addEventListener('focus', () => {
    if (el.value.trim().length >= 2) runCitySearch(el.value.trim(), list, el);
  });

  document.addEventListener('click', (e) => {
    if (!el.contains(e.target) && !list.contains(e.target)) { list.classList.remove('open'); }
  });
}

async function runCitySearch(query, list, inputEl) {
  _cityAcResults = [];
  list.innerHTML = '<li class="ac-loading">Buscando...</li>';
  list.classList.add('open');

  const data = await searchAllGeocoders(query);
  if (data && data.length > 0) {
    _cityAcResults = data;
    list.innerHTML = data.map((r, i) => {
      const parts = r.display_name.split(',');
      const cityName = parts[0].trim();
      const country = parts.slice(1).join(',').trim().split(',')[0] || '';
      const flag = getCountryFlag(r.country_code);
      return `<li data-cni="${i}">
        <div class="ac-main">${flag}${esc(cityName)}</div>
        <div class="ac-sub">${esc(country)}</div>
      </li>`;
    }).join('');
    list.querySelectorAll('li[data-cni]').forEach(li => {
      const handler = () => pickCityResult(parseInt(li.dataset.cni, 10), inputEl);
      li.addEventListener('mousedown', handler);
      li.addEventListener('touchstart', (e) => { e.preventDefault(); handler(); }, { passive: false });
    });
  } else {
    list.innerHTML = '<li class="ac-loading">Sin resultados. Escribí el nombre a mano.</li>';
  }
}

function pickCityResult(index, inputEl) {
  const result = _cityAcResults[index];
  if (!result) return;
  const parts = result.display_name.split(',');
  inputEl.value = parts[0].trim();
  // Guardar country_code en un campo hidden
  const countryCodeField = document.getElementById('new-city-country-code');
  if (countryCodeField) countryCodeField.value = result.country_code || '';
  document.getElementById('new-city-name-list').classList.remove('open');
}

// ── Hotel name autocomplete (Agregar ciudad) ─────────────────
let _hotelAcTimer = null;
let _hotelAcResults = [];

function initHotelNameAutocomplete() {
  const input = document.getElementById('new-city-hotel-name');
  const list = document.getElementById('new-hotel-name-list');
  const addrInput = document.getElementById('new-city-hotel-addr');
  if (!input || !list) return;

  const newInput = input.cloneNode(true);
  input.parentNode.replaceChild(newInput, input);
  const el = document.getElementById('new-city-hotel-name');

  el.addEventListener('input', () => {
    clearTimeout(_hotelAcTimer);
    const q = el.value.trim();
    if (q.length < 3) { list.classList.remove('open'); list.innerHTML = ''; return; }
    _hotelAcTimer = setTimeout(() => runHotelSearch(q, list, el, addrInput), 350);
  });

  el.addEventListener('focus', () => {
    if (el.value.trim().length >= 3) runHotelSearch(el.value.trim(), list, el, addrInput);
  });

  document.addEventListener('click', (e) => {
    if (!el.contains(e.target) && !list.contains(e.target)) { list.classList.remove('open'); }
  });
}

async function runHotelSearch(query, list, nameInput, addrInput) {
  _hotelAcResults = [];
  list.innerHTML = '<li class="ac-loading">Buscando...</li>';
  list.classList.add('open');

  const data = await searchAllGeocoders(query);
  if (data.length > 0) {
    _hotelAcResults = data;
    list.innerHTML = data.map((r, i) => {
      const parts = r.display_name.split(',');
      return `<li data-hni="${i}">
        <div class="ac-main">${esc(parts[0].trim())}</div>
        <div class="ac-sub">${esc(parts.slice(1, 4).join(',').trim())}</div>
      </li>`;
    }).join('');
    list.querySelectorAll('li[data-hni]').forEach(li => {
      const handler = () => pickHotelResult(parseInt(li.dataset.hni, 10), nameInput, addrInput);
      li.addEventListener('mousedown', handler);
      li.addEventListener('touchstart', (e) => { e.preventDefault(); handler(); }, { passive: false });
    });
  } else {
    list.innerHTML = '<li class="ac-loading">Sin resultados. Escribí el nombre a mano y seguí.</li>';
  }
}

function pickHotelResult(index, nameInput, addrInput) {
  const result = _hotelAcResults[index];
  if (!result) return;
  const parts = result.display_name.split(',');
  nameInput.value = parts[0].trim();
  addrInput.value = parts.slice(1).join(',').trim();
  const latField = document.getElementById('new-city-hotel-lat');
  const lonField = document.getElementById('new-city-hotel-lon');
  if (latField) latField.value = result.lat || '';
  if (lonField) lonField.value = result.lon || '';
  document.getElementById('new-hotel-name-list').classList.remove('open');
}

// ── Hotel name autocomplete (Editar hotel) ───────────────────
let _editHotelAcTimer = null;
let _editHotelAcResults = [];

function initEditHotelNameAutocomplete() {
  const input = document.getElementById('edit-hotel-name');
  const list = document.getElementById('edit-hotel-name-list');
  const addrInput = document.getElementById('edit-hotel-addr');
  if (!input || !list) return;

  const newInput = input.cloneNode(true);
  input.parentNode.replaceChild(newInput, input);
  const el = document.getElementById('edit-hotel-name');

  el.addEventListener('input', () => {
    clearTimeout(_editHotelAcTimer);
    const q = el.value.trim();
    if (q.length < 3) { list.classList.remove('open'); list.innerHTML = ''; return; }
    _editHotelAcTimer = setTimeout(() => runEditHotelSearch(q, list, el, addrInput), 350);
  });

  el.addEventListener('focus', () => {
    if (el.value.trim().length >= 3) runEditHotelSearch(el.value.trim(), list, el, addrInput);
  });

  document.addEventListener('click', (e) => {
    if (!el.contains(e.target) && !list.contains(e.target)) { list.classList.remove('open'); }
  });
}

async function runEditHotelSearch(query, list, nameInput, addrInput) {
  _editHotelAcResults = [];
  list.innerHTML = '<li class="ac-loading">Buscando...</li>';
  list.classList.add('open');

  const data = await searchAllGeocoders(query);
  if (data.length > 0) {
    _editHotelAcResults = data;
    list.innerHTML = data.map((r, i) => {
      const parts = r.display_name.split(',');
      return `<li data-ehi="${i}">
        <div class="ac-main">${esc(parts[0].trim())}</div>
        <div class="ac-sub">${esc(parts.slice(1, 4).join(',').trim())}</div>
      </li>`;
    }).join('');
    list.querySelectorAll('li[data-ehi]').forEach(li => {
      const handler = () => pickEditHotelResult(parseInt(li.dataset.ehi, 10), nameInput, addrInput);
      li.addEventListener('mousedown', handler);
      li.addEventListener('touchstart', (e) => { e.preventDefault(); handler(); }, { passive: false });
    });
  } else {
    list.innerHTML = '<li class="ac-loading">Sin resultados. Escribí el nombre a mano y seguí.</li>';
  }
}

function pickEditHotelResult(index, nameInput, addrInput) {
  const result = _editHotelAcResults[index];
  if (!result) return;
  const parts = result.display_name.split(',');
  nameInput.value = parts[0].trim();
  addrInput.value = parts.slice(1).join(',').trim();
  const latField = document.getElementById('edit-hotel-lat');
  const lonField = document.getElementById('edit-hotel-lon');
  if (latField) latField.value = result.lat || '';
  if (lonField) lonField.value = result.lon || '';
  document.getElementById('edit-hotel-name-list').classList.remove('open');
}

// ══════════════════════════════════════
// EDIT HOTEL
// ══════════════════════════════════════

function openEditHotelModal() {
  const trip = trips.find(t => t.id === currentTripId);
  if (!trip) return;
  const city = trip.cities[currentCityIdx];
  document.getElementById('edit-hotel-city-name').textContent = city.name;
  document.getElementById('edit-hotel-name').value = city.hotelName || '';
  document.getElementById('edit-hotel-addr').value = city.hotelAddr || '';
  document.getElementById('edit-hotel-lat').value = city.hotelLat || '';
  document.getElementById('edit-hotel-lon').value = city.hotelLon || '';
  setWheelTime('edit-hotel-checkin', city.checkInTime || '15:00');
  setWheelTime('edit-hotel-checkout', city.checkOutTime || '10:00');
  openModal('modal-edit-hotel');
  setTimeout(() => { initEditHotelNameAutocomplete(); }, 150);
}

function saveEditHotel() {
  const trip = trips.find(t => t.id === currentTripId);
  if (!trip) return;
  const city = trip.cities[currentCityIdx];
  city.hotelName = document.getElementById('edit-hotel-name').value.trim();
  city.hotelAddr = document.getElementById('edit-hotel-addr').value.trim();
  city.hotelLat = parseFloat(document.getElementById('edit-hotel-lat').value) || null;
  city.hotelLon = parseFloat(document.getElementById('edit-hotel-lon').value) || null;
  city.checkInTime = getWheelTime('edit-hotel-checkin');
  city.checkOutTime = getWheelTime('edit-hotel-checkout');
  save();
  closeModal('modal-edit-hotel');
  renderDetail();
  showToast('✅ Hotel actualizado');
}

// ══════════════════════════════════════
// ADD CITY TO EXISTING TRIP
// ══════════════════════════════════════
let selectedCityType = 'stay';
let selectedDayTripTransport = 'walking';

function selectCityType(type) {
  selectedCityType = type;
  document.getElementById('city-type-stay').classList.toggle('selected', type === 'stay');
  document.getElementById('city-type-daytrip').classList.toggle('selected', type === 'daytrip');
  document.getElementById('new-city-stay-fields').style.display = type === 'stay' ? '' : 'none';
  document.getElementById('new-city-daytrip-fields').style.display = type === 'daytrip' ? '' : 'none';
  // Update labels
  const isDay = type === 'daytrip';
  document.getElementById('add-city-modal-title').textContent = isDay ? '🗺️ Agregar excursión' : '🏙️ Agregar ciudad';
  document.getElementById('new-city-name-label').textContent = isDay ? 'Destino de la excursión' : 'Ciudad';
  document.getElementById('new-city-date-label').textContent = isDay ? 'Fecha' : 'Fechas en esta ciudad';
  document.getElementById('new-city-start-label').textContent = isDay ? 'Día de excursión' : 'Llegada';
  // For day trips, end date = start date (same day), hide end col
  document.getElementById('new-city-end-col').style.display = isDay ? 'none' : '';
  if (isDay) {
    const startVal = document.getElementById('new-city-start').value;
    if (startVal) document.getElementById('new-city-end').value = startVal;
  }
}

function selectDayTripTransport(el, mode) {
  selectedDayTripTransport = mode;
  document.querySelectorAll('[data-dt]').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
}

function openAddCityModal() {
  const trip = trips.find(t => t.id === currentTripId);
  if (!trip) return;

  // Pre-fill dates with the first uncovered gap
  const covered = new Set();
  trip.cities.forEach(ci => {
    if (ci.dayTrip) return; // day trips don't "cover" days for gap detection
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

function onNewCityStartChange() {
  const trip = trips.find(t => t.id === currentTripId);
  const si = document.getElementById('new-city-start');
  const ei = document.getElementById('new-city-end');
  const errS = document.getElementById('new-city-start-err');
  const v = si.value;

  // For day trips, end = start
  if (selectedCityType === 'daytrip') { ei.value = v; }
  else { ei.min = v; if (ei.value && ei.value < v) { ei.value = v; } }

  if (trip && (v < trip.startDate || v > trip.endDate)) {
    si.classList.add('error');
    errS.textContent = `⚠️ Debe estar entre ${formatDate(trip.startDate)} y ${formatDate(trip.endDate)}`;
    errS.classList.add('visible');
  } else {
    si.classList.remove('error'); errS.classList.remove('visible');
  }
}

function onNewCityEndChange() {
  const trip = trips.find(t => t.id === currentTripId);
  const si = document.getElementById('new-city-start');
  const ei = document.getElementById('new-city-end');
  const errE = document.getElementById('new-city-end-err');

  if (ei.value < si.value) {
    ei.classList.add('error');
    errE.textContent = '⚠️ La salida debe ser igual o posterior a la llegada';
    errE.classList.add('visible');
  } else if (trip && ei.value > trip.endDate) {
    ei.classList.add('error');
    errE.textContent = `⚠️ No puede superar el fin del viaje (${formatDate(trip.endDate)})`;
    errE.classList.add('visible');
  } else {
    ei.classList.remove('error'); errE.classList.remove('visible');
  }
}

function saveNewCity() {
  const trip = trips.find(t => t.id === currentTripId);
  if (!trip) return;

  const isDayTrip = selectedCityType === 'daytrip';
  const name = document.getElementById('new-city-name').value.trim();
  const hotelName = isDayTrip ? '' : document.getElementById('new-city-hotel-name').value.trim();
  const hotelAddr = isDayTrip ? '' : document.getElementById('new-city-hotel-addr').value.trim();
  const cs = document.getElementById('new-city-start').value;
  // Day trip: end = start (same day)
  const ce = isDayTrip ? cs : document.getElementById('new-city-end').value;

  if (!name) { showToast(`⚠️ Ingresá el nombre del ${isDayTrip ? 'destino' : 'ciudad'}`); return; }
  if (!cs) { showToast('⚠️ Ingresá la fecha'); return; }
  if (!isDayTrip && ce < cs) { showToast('⚠️ La salida debe ser posterior a la llegada'); return; }
  if (cs < trip.startDate || ce > trip.endDate) {
    showToast(`⚠️ Las fechas deben estar dentro del viaje (${formatDate(trip.startDate)} – ${formatDate(trip.endDate)})`);
    return;
  }

  // Validate overlap with existing cities (excluding day trips) - allow shared day for check-out/check-in
  const overlap = trip.cities.filter(ci => !ci.dayTrip).find(ci => {
    return cs < ci.endDate && ce > ci.startDate;
  });
  if (overlap) {
    showToast(`⚠️ Las fechas se solapan con "${overlap.name}" (${formatDate(overlap.startDate)} → ${formatDate(overlap.endDate)})`);
    return;
  }

  const newCity = {
    id: uid(), name, hotelName, hotelAddr,
    hotelLat: isDayTrip ? null : parseFloat(document.getElementById('new-city-hotel-lat').value) || null,
    hotelLon: isDayTrip ? null : parseFloat(document.getElementById('new-city-hotel-lon').value) || null,
    startDate: cs, endDate: ce,
    countryCode: document.getElementById('new-city-country-code').value || null,
    days: buildDays(cs, ce),
    ...(isDayTrip ? {
      dayTrip: true,
      dayTripTransport: selectedDayTripTransport,
      dayTripDepartTime: getWheelTime('new-city-depart-time'),
      dayTripReturnTime: getWheelTime('new-city-return-time'),
    } : {})
  };
  trip.cities.push(newCity);
  trip.cities.sort((a, b) => a.startDate.localeCompare(b.startDate));
  if (!isDayTrip) ensureTransitionTickets(trip);
  save();
  closeModal('modal-add-city');
  currentCityIdx = trip.cities.findIndex(c => c.id === newCity.id);
  currentDayIdx = 0;
  renderDetail();
  showToast(`✅ ${isDayTrip ? 'Excursión' : name} agregada al viaje`);
}

// ══════════════════════════════════════
// ADD / DELETE STOP (WIZARD)
// ══════════════════════════════════════
let stopSelectedLat = null;
let stopSelectedLon = null;
let stopAutocompleteTimeout = null;

function openAddStopModal() {
  editingStopId = null;
  selectedType = 'attraction'; selectedTransport = 'walking';
  stopSelectedLat = null;
  stopSelectedLon = null;
  document.getElementById('stop-modal-title').textContent = '📍 Agregar parada';
  document.getElementById('stop-save-btn').textContent = 'Agregar parada';
  ['stop-name','stop-addr','stop-note'].forEach(id => document.getElementById(id).value = '');
  setWheelTime('stop-time-from', '');
  setWheelTime('stop-time-to', '');
  document.querySelectorAll('.type-option').forEach(e => e.classList.remove('selected'));
  document.querySelector('[data-type="attraction"]').classList.add('selected');
  document.querySelectorAll('.transport-option').forEach(e => e.classList.remove('selected'));
  document.querySelector('[data-mode="walking"]').classList.add('selected');
  document.getElementById('selected-address-display').style.display = 'none';
  document.getElementById('stop-addr-results').innerHTML = '';
  document.getElementById('stop-addr-results').style.display = 'none';
  document.getElementById('stop-name-results').innerHTML = '';
  document.getElementById('stop-name-results').style.display = 'none';
  stopWizardGoToStep(1);
  openModal('modal-add-stop');
  setTimeout(() => { initStopNameAutocomplete(); }, 150);
}

function openEditStopModal(stopId) {
  const trip = trips.find(t => t.id === currentTripId);
  const stop = trip.cities[currentCityIdx].days[currentDayIdx].stops.find(s => s.id === stopId);
  if (!stop) return;

  editingStopId = stopId;
  selectedType = stop.type || 'attraction';
  selectedTransport = stop.transport || 'walking';
  stopSelectedLat = stop.lat || null;
  stopSelectedLon = stop.lon || null;

  document.getElementById('stop-modal-title').textContent = '✏️ Editar parada';
  document.getElementById('stop-save-btn').textContent = 'Guardar cambios';
  document.getElementById('stop-name').value = stop.name || '';
  document.getElementById('stop-addr').value = stop.address || '';
  document.getElementById('stop-note').value = stop.note || '';
  setWheelTime('stop-time-from', stop.timeFrom || '');
  setWheelTime('stop-time-to', stop.timeTo || '');

  document.querySelectorAll('.type-option').forEach(e => e.classList.remove('selected'));
  const typeEl = document.querySelector(`[data-type="${selectedType}"]`);
  if (typeEl) typeEl.classList.add('selected');

  document.querySelectorAll('.transport-option').forEach(e => e.classList.remove('selected'));
  const transEl = document.querySelector(`[data-mode="${selectedTransport}"]`);
  if (transEl) transEl.classList.add('selected');

  if (stop.address) {
    document.getElementById('selected-address-display').style.display = 'block';
  } else {
    document.getElementById('selected-address-display').style.display = 'none';
  }
  document.getElementById('stop-addr-results').innerHTML = '';
  document.getElementById('stop-addr-results').style.display = 'none';

  stopWizardGoToStep(1);
  openModal('modal-add-stop');
}

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
  if (currentStep === 2) {
    // Address is optional, no validation needed
  }
  stopWizardGoToStep(currentStep + 1);
}

function stopWizardPrevStep(currentStep) {
  stopWizardGoToStep(currentStep - 1);
}

function initStopAddressAutocomplete() {
  const input = document.getElementById('stop-addr');
  const results = document.getElementById('stop-addr-results');
  if (!input || !results) return;

  // Remove existing listener to avoid duplicates
  const newInput = input.cloneNode(true);
  input.parentNode.replaceChild(newInput, input);
  const newInputEl = document.getElementById('stop-addr');

  newInputEl.addEventListener('input', (e) => {
    clearTimeout(stopAutocompleteTimeout);
    stopAutocompleteTimeout = setTimeout(() => {
      searchLocationIQ(e.target.value, results);
    }, 300);
  });

  newInputEl.addEventListener('focus', (e) => {
    if (e.target.value.length >= 3) {
      searchLocationIQ(e.target.value, results);
    }
  });

  document.addEventListener('click', (e) => {
    if (!newInputEl.contains(e.target) && !results.contains(e.target)) {
      results.style.display = 'none';
    }
  });
}

async function searchLocationIQ(query, resultsEl) {
  if (!query || query.length < 3) {
    resultsEl.innerHTML = '';
    resultsEl.style.display = 'none';
    return;
  }

  resultsEl.innerHTML = '<li class="loading">Buscando...</li>';
  resultsEl.style.display = 'block';

  const data = await searchAllGeocoders(query);
  if (data.length > 0) {
    resultsEl.innerHTML = data.map(place => 
      `<li onclick="selectStopAddress('${place.display_name.replace(/'/g, "\\'")}', '${place.lat}', '${place.lon}')">
        <strong>${esc(place.display_name.split(',')[0])}</strong><br>
        <small>${esc(place.display_name.split(',').slice(1, 4).join(','))}</small>
      </li>`
    ).join('');
  } else {
    resultsEl.innerHTML = '<li class="no-results">Sin resultados. Escribí la dirección a mano y seguí.</li>';
  }
}

function selectStopAddress(displayName, lat, lon) {
  const input = document.getElementById('stop-addr');
  const results = document.getElementById('stop-addr-results');
  const display = document.getElementById('selected-address-display');

  input.value = displayName;
  stopSelectedLat = lat;
  stopSelectedLon = lon;

  results.style.display = 'none';
  display.style.display = 'block';
}

// Autocomplete para terminales de pasajes
var terminalAutocompleteTimeouts = {};
var lastRequestTime = {};

function testTerminalAutocomplete(query, resultsId, inputId) {
  var resultsEl = document.getElementById(resultsId);
  if (!resultsEl) return;
  
  // Rate limiting: esperar al menos 1 segundo entre requests
  var now = Date.now();
  if (lastRequestTime[inputId] && (now - lastRequestTime[inputId]) < 1000) {
    return;
  }
  lastRequestTime[inputId] = now;
  
  clearTimeout(terminalAutocompleteTimeouts[inputId]);
  terminalAutocompleteTimeouts[inputId] = setTimeout(function() {
    searchTerminalLocationIQ(query, resultsEl, inputId);
  }, 800);
}

async function searchTerminalLocationIQ(query, resultsEl, inputId) {
  if (!query || query.length < 3) {
    resultsEl.innerHTML = '';
    resultsEl.style.display = 'none';
    return;
  }

  resultsEl.innerHTML = '<li class="loading">Buscando...</li>';
  resultsEl.style.display = 'block';

  const data = await searchAllGeocoders(query);
  if (data.length > 0) {
    resultsEl.innerHTML = data.map(function(place) { 
      return '<li onclick="selectTerminalAddress(\'' + place.display_name.replace(/'/g, "\\'") + '\', \'' + place.lat + '\', \'' + place.lon + '\', \'' + inputId + '\', \'' + inputId + '-results\')">' +
        '<strong>' + esc(place.display_name.split(',')[0]) + '</strong><br>' +
        '<small>' + esc(place.display_name.split(',').slice(1, 4).join(',')) + '</small>' +
      '</li>';
    }).join('');
  } else {
    resultsEl.innerHTML = '<li class="no-results">Sin resultados. Escribí la dirección a mano.</li>';
  }
}

function selectTerminalAddress(displayName, lat, lon, inputId, resultsId) {
  const input = document.getElementById(inputId);
  const results = document.getElementById(resultsId);
  const latInput = document.getElementById(inputId + '-lat');
  const lonInput = document.getElementById(inputId + '-lon');
  const fullInput = document.getElementById(inputId + '-full');

  // Truncar: mostrar solo lo antes de la primera coma
  const shortName = displayName.split(',')[0].trim();
  if (input) input.value = shortName;
  if (latInput) latInput.value = lat;
  if (lonInput) lonInput.value = lon;
  if (fullInput) fullInput.value = displayName;

  if (results) results.style.display = 'none';
}

function hideResults(resultsId) {
  const results = document.getElementById(resultsId);
  if (results) results.style.display = 'none';
}

function saveStop() {
  const name = document.getElementById('stop-name').value.trim();
  const address = document.getElementById('stop-addr').value.trim();
  const note = document.getElementById('stop-note').value.trim();
  const timeFrom = getWheelTime('stop-time-from');
  const timeTo = getWheelTime('stop-time-to');
  if (!name) { showToast('⚠️ Ingresá el nombre del lugar'); return; }

  const trip = trips.find(t => t.id === currentTripId);
  const stops = trip.cities[currentCityIdx].days[currentDayIdx].stops;

  const stopData = { name, address, note, timeFrom, timeTo, type: selectedType, transport: selectedTransport };

  if (stopSelectedLat && stopSelectedLon) {
    stopData.lat = stopSelectedLat;
    stopData.lon = stopSelectedLon;
  }

  if (editingStopId) {
    const idx = stops.findIndex(s => s.id === editingStopId);
    if (idx !== -1) {
      stops[idx] = { ...stops[idx], ...stopData };
    }
    save(); closeModal('modal-add-stop'); renderDetail();
    showToast('✅ Parada actualizada');
  } else {
    stops.push({ id: uid(), ...stopData });
    save(); closeModal('modal-add-stop'); renderDetail();
    showToast('✅ Parada agregada');
  }
  editingStopId = null;
  stopSelectedLat = null;
  stopSelectedLon = null;
}

let _pendingDeleteStopId = null;
let _originalStopOrder = null; // For stop optimization undo

function deleteStop(stopId) {
  const trip = trips.find(t => t.id === currentTripId);
  const stop = trip.cities[currentCityIdx].days[currentDayIdx].stops.find(s => s.id === stopId);
  const stopName = stop?.name || 'esta parada';
  _pendingDeleteStopId = stopId;
  document.getElementById('confirm-delete-stop-title').textContent = `¿Eliminar "${stopName}"?`;
  document.getElementById('confirm-delete-stop-body').textContent = 'Esta acción no se puede deshacer.';
  openModal('modal-confirm-delete-stop');
}

function confirmDeleteStop() {
  const stopId = _pendingDeleteStopId;
  _pendingDeleteStopId = null;
  if (!stopId) return;
  const trip = trips.find(t => t.id === currentTripId);
  const days = trip.cities[currentCityIdx].days;
  days[currentDayIdx].stops = days[currentDayIdx].stops.filter(s => s.id !== stopId);
  save();
  closeModal('modal-confirm-delete-stop');
  renderDetail();
  showToast('Parada eliminada');
}

function selectType(el, t) { selectedType = t; document.querySelectorAll('.type-option').forEach(e => e.classList.remove('selected')); el.classList.add('selected'); }
function selectTransport(el, t) { selectedTransport = t; document.querySelectorAll('.transport-option').forEach(e => e.classList.remove('selected')); el.classList.add('selected'); }

// ══════════════════════════════════════
// DRAG & DROP (touch + mouse)
// ══════════════════════════════════════
function initDragDrop() {
  const list = document.getElementById('stops-list-el');
  if (!list) return;

  let dragEl = null;
  let ghost = null;
  let startY = 0;
  let offsetY = 0;
  let lastOver = null;
  let isDragging = false;

  function getItems() {
    return Array.from(list.querySelectorAll('.stop-item[data-stopid]'));
  }

  function createGhost(el) {
    const rect = el.getBoundingClientRect();
    const g = el.cloneNode(true);
    g.style.cssText = `
      position: fixed;
      left: ${rect.left}px;
      top: ${rect.top}px;
      width: ${rect.width}px;
      z-index: 500;
      opacity: 0.92;
      pointer-events: none;
      background: var(--bg3);
      border-radius: 12px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.5);
      border: 1px solid var(--accent);
      transition: none;
    `;
    document.body.appendChild(g);
    return g;
  }

  function getClientY(e) {
    return e.touches ? e.touches[0].clientY : e.clientY;
  }

  function onDragStart(e) {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    const item = handle.closest('.stop-item[data-stopid]');
    if (!item) return;

    // Only prevent default scroll when starting drag from handle
    e.preventDefault();
    isDragging = true;
    dragEl = item;
    const rect = item.getBoundingClientRect();
    startY = getClientY(e);
    offsetY = startY - rect.top;

    dragEl.classList.add('dragging');
    ghost = createGhost(dragEl);

    document.addEventListener('touchmove', onDragMove, { passive: false });
    document.addEventListener('touchend', onDragEnd);
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
  }

  function onDragMove(e) {
    if (!dragEl || !ghost || !isDragging) return;
    e.preventDefault();

    const clientY = getClientY(e);
    ghost.style.top = (clientY - offsetY) + 'px';

    const items = getItems();
    let overEl = null;
    for (const item of items) {
      if (item === dragEl) continue;
      const r = item.getBoundingClientRect();
      if (clientY > r.top && clientY < r.bottom) {
        overEl = item;
        const mid = r.top + r.height / 2;
        if (clientY < mid) {
          list.insertBefore(dragEl, item);
        } else {
          list.insertBefore(dragEl, item.nextSibling);
        }
        break;
      }
    }

    items.forEach(i => i.classList.remove('drag-over'));
    if (overEl) overEl.classList.add('drag-over');
    lastOver = overEl;
  }

  function onDragEnd() {
    if (!dragEl) return;

    const items = getItems();
    const trip = trips.find(t => t.id === currentTripId);
    const stopsArr = trip.cities[currentCityIdx].days[currentDayIdx].stops;
    const newOrder = items.map(el => stopsArr.find(s => s.id === el.dataset.stopid)).filter(Boolean);
    trip.cities[currentCityIdx].days[currentDayIdx].stops = newOrder;
    save();

    dragEl.classList.remove('dragging');
    if (lastOver) lastOver.classList.remove('drag-over');
    if (ghost) { ghost.remove(); ghost = null; }
    dragEl = null; lastOver = null; isDragging = false;

    renderDetail();

    document.removeEventListener('touchmove', onDragMove);
    document.removeEventListener('touchend', onDragEnd);
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
  }

  // passive: true allows normal scrolling — only preventDefault inside onDragStart when handle is touched
  list.addEventListener('touchstart', onDragStart, { passive: false });
  list.addEventListener('mousedown', onDragStart);
}

// ══════════════════════════════════════
// GAP DETECTION
// ══════════════════════════════════════
function buildGapBanner(trip) {
  // Build a Set of all dates covered by cities
  const covered = new Set();
  trip.cities.forEach(ci => {
    let d = new Date(ci.startDate + 'T00:00:00');
    const e = new Date(ci.endDate + 'T00:00:00');
    while (d <= e) {
      covered.add(d.toISOString().slice(0, 10));
      d.setDate(d.getDate() + 1);
    }
  });

  // Find trip days that are NOT covered
  const gaps = [];
  let d = new Date(trip.startDate + 'T00:00:00');
  const e = new Date(trip.endDate + 'T00:00:00');
  while (d <= e) {
    const dateStr = d.toISOString().slice(0, 10);
    if (!covered.has(dateStr)) gaps.push(dateStr);
    d.setDate(d.getDate() + 1);
  }

  if (!gaps.length) return '';

  // Group consecutive gap days into ranges
  const ranges = [];
  let rangeStart = gaps[0], rangeEnd = gaps[0];
  for (let i = 1; i < gaps.length; i++) {
    const prev = new Date(gaps[i-1] + 'T00:00:00');
    const curr = new Date(gaps[i] + 'T00:00:00');
    if ((curr - prev) === 86400000) {
      rangeEnd = gaps[i];
    } else {
      ranges.push([rangeStart, rangeEnd]);
      rangeStart = rangeEnd = gaps[i];
    }
  }
  ranges.push([rangeStart, rangeEnd]);

  const rangeLabels = ranges.map(([s, e]) =>
    s === e
      ? `<span class="gap-date">${formatDate(s)}</span>`
      : `<span class="gap-date">${formatDate(s)} → ${formatDate(e)}</span>`
  ).join('');

  const totalDays = gaps.length;

  return `<div class="gap-banner">
    <div class="gap-banner-top">
      <div style="display:flex;align-items:center;gap:8px">
        <span class="gap-banner-icon">⚠️</span>
        <strong>${totalDays} día${totalDays !== 1 ? 's' : ''} sin ciudad asignada</strong>
      </div>
      <button class="btn-add-city-gap" onclick="openAddCityModal()">+ Ciudad</button>
    </div>
    <div class="gap-dates">${rangeLabels}</div>
  </div>`;
}

// ══════════════════════════════════════
// HELPERS
// ══════════════════════════════════════
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Función helper para obtener la bandera de un país (imagen)
function getCountryFlag(countryCode) {
  if (!countryCode) return '';
  const code = countryCode.toLowerCase();
  // Solo usar si el código tiene 2 letras
  if (code.length !== 2) return '';
  
  // Mapear códigos especiales
  const codeMap = {
    'uk': 'gb',
    'xk': 'xk'  // Kosovo
  };
  const mappedCode = codeMap[code] || code;
  
  // Usar imágenes de flagcdn
  return `<img src="https://flagcdn.com/w20/${mappedCode}.png" class="country-flag" alt="${code.toUpperCase()}" onerror="this.style.display='none'" />`;
}

// Generar HTML para el pill de ciudad con bandera
function cityPillHtml(ci) {
  const flag = getCountryFlag(ci.countryCode);
  return `<span class="city-pill">${flag}${esc(ci.name)}</span>`;
}

function save() {
  try {
    // Sanitizar todos los trips antes de guardar
    trips = trips.map(trip => sanitizeTripData(trip));
    
    // Validar datos (silencioso en producción)
    trips.forEach(trip => {
      const validation = validateTripData(trip);
      // Validation errors are silently ignored for now
    });
    
    localStorage.setItem('wandr_trips', JSON.stringify(trips));
    _showSaveIndicator('saved', '✓ Guardado');
  } catch(e) {
    if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
      showToast('⚠️ Almacenamiento lleno. No se pudo guardar.');
      _showSaveIndicator('error', '⚠️ Sin espacio');
    } else {
      showToast('⚠️ Error al guardar datos.');
      _showSaveIndicator('error', '⚠️ Error');
    }
  }
}

let _saveIndicatorTimer = null;
function _showSaveIndicator(type, text) {
  const el = document.getElementById('save-indicator');
  if (!el) return;
  clearTimeout(_saveIndicatorTimer);
  el.textContent = text;
  el.className = type; // 'saved' or 'error'
  _saveIndicatorTimer = setTimeout(() => { el.className = ''; }, type === 'error' ? 3500 : 2000);
}
function mapsUrl(q) { return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`; }

// ══════════════════════════════════════
// INPUT SANITIZATION & VALIDATION
// ══════════════════════════════════════

// Límites de datos para prevenir ataques de tamaño
const MAX_STRING_LENGTH = 200;
const MAX_TRIP_NAME_LENGTH = 100;
const MAX_CITY_NAME_LENGTH = 80;
const MAX_ADDRESS_LENGTH = 500;
const MAX_NOTE_LENGTH = 1000;
const MAX_STOPS_PER_DAY = 50;
const MAX_CITIES_PER_TRIP = 30;
const MAX_TICKETS_PER_TRIP = 50;

// Sanitizar strings para prevenir XSS
function sanitizeInput(str, maxLen = MAX_STRING_LENGTH) {
  if (str === null || str === undefined) return '';
  if (typeof str !== 'string') return String(str);
  // Eliminar caracteres peligrosos que podrían ser usados para XSS o injection
  return str
    .replace(/[<>'";&]/g, '') // Caracteres peligrosos: < > ' " ; &
    .replace(/\s+/g, ' ')   // Normalizar whitespace
    .trim()
    .slice(0, maxLen); // Limitar longitud
}

// Sanitizar nombres de ciudades (允许 acentos y algunos caracteres especiales)
function sanitizeCityName(str) {
  if (!str) return '';
  return str
    .replace(/[<>;"&]/g, '') // Solo eliminar caracteres peligrosos
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CITY_NAME_LENGTH);
}

// Sanitizar direcciones (más permisivo porque puede tener números, símbolos de calle)
function sanitizeAddress(str) {
  if (!str) return '';
  return str
    .replace(/[<>'"&]/g, '') // Eliminar solo caracteres claramente peligrosos
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_ADDRESS_LENGTH);
}

// Sanitizar notas (permite más caracteres pero limita longitud)
function sanitizeNote(str) {
  if (!str) return '';
  return str
    .replace(/[<>]/g, '') // Solo eliminar los más peligrosos
    .trim()
    .slice(0, MAX_NOTE_LENGTH);
}

// Validar coordenadas
function isValidCoord(lat, lon) {
  const latNum = parseFloat(lat);
  const lonNum = parseFloat(lon);
  if (isNaN(latNum) || isNaN(lonNum)) return false;
  return latNum >= -90 && latNum <= 90 && lonNum >= -180 && lonNum <= 180;
}

// Validar fecha ISO (YYYY-MM-DD)
function isValidDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return false;
  // Verificar formato YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const date = new Date(dateStr);
  return date instanceof Date && !isNaN(date.getTime());
}

// Validar time (HH:MM)
function isValidTime(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return false;
  const match = timeStr.match(/^(\d{2}):(\d{2})$/);
  if (!match) return false;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

// Validar todo el trip antes de guardar
function validateTripData(trip) {
  const errors = [];
  
  if (!trip) {
    errors.push('Trip no existe');
    return { valid: false, errors };
  }
  
  // Validar nombre del trip
  if (trip.name) {
    if (trip.name.length > MAX_TRIP_NAME_LENGTH) {
      errors.push(`Nombre del viaje muy largo (máx ${MAX_TRIP_NAME_LENGTH} caracteres)`);
    }
  }
  
  // Validar fechas del trip
  if (!isValidDate(trip.startDate)) {
    errors.push('Fecha de inicio inválida');
  }
  if (!isValidDate(trip.endDate)) {
    errors.push('Fecha de fin inválida');
  }
  
  // Validar cities
  if (!trip.cities || !Array.isArray(trip.cities)) {
    errors.push('Cities no es un array');
  } else {
    if (trip.cities.length > MAX_CITIES_PER_TRIP) {
      errors.push(`Demasiadas ciudades (máx ${MAX_CITIES_PER_TRIP})`);
    }
    
    trip.cities.forEach((city, idx) => {
      // Validar nombre
      if (city.name && city.name.length > MAX_CITY_NAME_LENGTH) {
        errors.push(`Ciudad ${idx + 1}: nombre muy largo`);
      }
      
      // Validar coordenadas del hotel
      if (city.hotelLat != null && city.hotelLon != null) {
        if (!isValidCoord(city.hotelLat, city.hotelLon)) {
          errors.push(`Ciudad ${city.name || idx + 1}: coordenadas del hotel inválidas`);
        }
      }
      
      // Validar fechas
      if (city.startDate && !isValidDate(city.startDate)) {
        errors.push(`Ciudad ${city.name || idx + 1}: fecha de inicio inválida`);
      }
      if (city.endDate && !isValidDate(city.endDate)) {
        errors.push(`Ciudad ${city.name || idx + 1}: fecha de fin inválida`);
      }
      
      // Validar días y stops
      if (city.days && Array.isArray(city.days)) {
        city.days.forEach((day, dayIdx) => {
          if (day.stops && Array.isArray(day.stops)) {
            if (day.stops.length > MAX_STOPS_PER_DAY) {
              errors.push(`Ciudad ${city.name}: día ${dayIdx + 1}: demasiados stops (máx ${MAX_STOPS_PER_DAY})`);
            }
            
            day.stops.forEach((stop, stopIdx) => {
              // Validar nombre y dirección
              if (stop.name && stop.name.length > MAX_STRING_LENGTH) {
                errors.push(`Stop ${stopIdx + 1}: nombre muy largo`);
              }
              if (stop.address && stop.address.length > MAX_ADDRESS_LENGTH) {
                errors.push(`Stop ${stopIdx + 1}: dirección muy larga`);
              }
              
              // Validar coordenadas
              if (stop.lat && stop.lon && !isValidCoord(stop.lat, stop.lon)) {
                errors.push(`Stop ${stop.name || stopIdx + 1}: coordenadas inválidas`);
              }
            });
          }
        });
      }
    });
  }
  
  // Validar tickets
  if (trip.tickets && Array.isArray(trip.tickets)) {
    if (trip.tickets.length > MAX_TICKETS_PER_TRIP) {
      errors.push(`Demasiados tickets (máx ${MAX_TICKETS_PER_TRIP})`);
    }
    
    trip.tickets.forEach((ticket, idx) => {
      if (ticket.fromCity && ticket.fromCity.length > MAX_CITY_NAME_LENGTH) {
        errors.push(`Ticket ${idx + 1}: ciudad de origen muy larga`);
      }
      if (ticket.toCity && ticket.toCity.length > MAX_CITY_NAME_LENGTH) {
        errors.push(`Ticket ${idx + 1}: ciudad de destino muy larga`);
      }
    });
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

// Aplicar sanitización a todos los campos de un trip antes de guardar
function sanitizeTripData(trip) {
  if (!trip) return trip;
  
  // Sanitizar nombre (usa trim + slice para permitir espacios pero limita longitud)
  if (trip.name) trip.name = trip.name.trim().slice(0, MAX_TRIP_NAME_LENGTH);
  
  // Sanitizar ciudades
  if (trip.cities && Array.isArray(trip.cities)) {
    trip.cities.forEach(city => {
      // Nombre - usa sanitizeCityName que permite acentos
      if (city.name) city.name = sanitizeCityName(city.name);
      
      // Hotel
      if (city.hotelName) city.hotelName = sanitizeInput(city.hotelName, MAX_CITY_NAME_LENGTH);
      if (city.hotelAddr) city.hotelAddr = sanitizeAddress(city.hotelAddr);
      
      // Notas
      if (city.note) city.note = sanitizeNote(city.note);
      
      // Días y stops
      if (city.days && Array.isArray(city.days)) {
        city.days.forEach(day => {
          if (day.stops && Array.isArray(day.stops)) {
            day.stops.forEach(stop => {
              if (stop.name) stop.name = sanitizeInput(stop.name, MAX_STRING_LENGTH);
              if (stop.address) stop.address = sanitizeAddress(stop.address);
              if (stop.note) stop.note = sanitizeNote(stop.note);
              if (stop.category) stop.category = sanitizeInput(stop.category, 30);
              if (stop.transport) stop.transport = sanitizeInput(stop.transport, 20);
            });
          }
        });
      }
    });
  }
  
  // Sanitizar tickets
  if (trip.tickets && Array.isArray(trip.tickets)) {
    trip.tickets.forEach(ticket => {
      if (ticket.company) ticket.company = sanitizeInput(ticket.company, 50);
      if (ticket.fromCity) ticket.fromCity = sanitizeCityName(ticket.fromCity);
      if (ticket.toCity) ticket.toCity = sanitizeCityName(ticket.toCity);
      if (ticket.depTerminal) ticket.depTerminal = sanitizeAddress(ticket.depTerminal);
      if (ticket.arrTerminal) ticket.arrTerminal = sanitizeAddress(ticket.arrTerminal);
      if (ticket.depGate) ticket.depGate = sanitizeInput(ticket.depGate, 20);
      if (ticket.arrGate) ticket.arrGate = sanitizeInput(ticket.arrGate, 20);
    });
  }
  
  return trip;
}

// Haversine formula for distance between two lat/lon points (returns km)
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function formatDistance(km) {
  if (km < 1) return `${Math.round(km * 1000)}m`;
  if (km < 10) return `${km.toFixed(1)}km`;
  return `${Math.round(km)}km`;
}

function estimateTravelTime(km, transport) {
  // Average speeds in km/h
  const speeds = { walking: 5, transit: 20, taxi: 30, driving: 40 };
  const speed = speeds[transport] || 5;
  const minutes = Math.round((km / speed) * 60);
  if (minutes < 1) return '<1min';
  if (minutes < 60) return `${minutes}min`;
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hrs}h ${mins}min` : `${hrs}h`;
}

// ── Stop optimization algorithms ──────────────────────────
function stopDistance(a, b) {
  if (!a.lat || !a.lon || !b.lat || !b.lon) return Infinity;
  return haversine(a.lat, a.lon, b.lat, b.lon);
}

function totalRouteDistance(stops, hotelLat, hotelLon) {
  let total = 0;
  let prev = { lat: hotelLat, lon: hotelLon };
  for (const stop of stops) {
    total += stopDistance(prev, stop);
    prev = stop;
  }
  return total;
}

// Brute force: try all permutations (for ≤8 stops)
function bruteForceOptimal(stops, hotelLat, hotelLon) {
  if (stops.length <= 1) return [...stops];
  
  // Generate all permutations
  const indices = stops.map((_, i) => i);
  const perms = permute(indices);
  
  let bestPerm = null;
  let bestDist = Infinity;
  
  for (const perm of perms) {
    const ordered = perm.map(i => stops[i]);
    const dist = totalRouteDistance(ordered, hotelLat, hotelLon);
    if (dist < bestDist) {
      bestDist = dist;
      bestPerm = ordered;
    }
  }
  
  return bestPerm || [...stops];
}

function permute(arr) {
  if (arr.length <= 1) return [arr];
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permute(rest)) {
      result.push([arr[i], ...p]);
    }
  }
  return result;
}

// Nearest neighbor: greedy approach (for >8 stops)
function nearestNeighborOrder(stops, hotelLat, hotelLon) {
  if (stops.length <= 1) return [...stops];
  
  const remaining = [...stops];
  const ordered = [];
  let current = { lat: hotelLat, lon: hotelLon };
  
  while (remaining.length > 0) {
    let nearestIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = stopDistance(current, remaining[i]);
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
}

// 2-opt improvement: swap pairs to reduce total distance
function twoOptImprove(stops, hotelLat, hotelLon) {
  if (stops.length <= 2) return [...stops];
  
  let improved = [...stops];
  let improvedDist = totalRouteDistance(improved, hotelLat, hotelLon);
  let changed = true;
  
  while (changed) {
    changed = false;
    for (let i = 0; i < improved.length - 1; i++) {
      for (let j = i + 1; j < improved.length; j++) {
        // Swap stops[i] and stops[j]
        const candidate = [...improved];
        [candidate[i], candidate[j]] = [candidate[j], candidate[i]];
        const candidateDist = totalRouteDistance(candidate, hotelLat, hotelLon);
        if (candidateDist < improvedDist) {
          improved = candidate;
          improvedDist = candidateDist;
          changed = true;
        }
      }
    }
  }
  
  return improved;
}

function optimizeCurrentStops() {
  const trip = trips.find(t => t.id === currentTripId);
  if (!trip) return;
  const city = trip.cities[currentCityIdx];
  if (!city) return;
  const day = city.days[currentDayIdx];
  if (!day || !day.stops || day.stops.length < 2) return;
  
  // Save original order if not already saved
  if (_originalStopOrder === null) {
    _originalStopOrder = JSON.parse(JSON.stringify(day.stops));
  }
  
  const hotelLat = city.hotelLat || 0;
  const hotelLon = city.hotelLon || 0;
  
  // Choose algorithm based on number of stops
  let optimized;
  if (day.stops.length <= 8) {
    optimized = bruteForceOptimal(day.stops, hotelLat, hotelLon);
  } else {
    optimized = nearestNeighborOrder(day.stops, hotelLat, hotelLon);
    optimized = twoOptImprove(optimized, hotelLat, hotelLon);
  }
  
  day.stops = optimized;
  save();
  renderDetail();
}

function restoreStopOrder() {
  if (_originalStopOrder === null) return;
  const trip = trips.find(t => t.id === currentTripId);
  if (!trip) return;
  const city = trip.cities[currentCityIdx];
  if (!city) return;
  const day = city.days[currentDayIdx];
  if (!day) return;
  
  day.stops = _originalStopOrder;
  _originalStopOrder = null;
  save();
  renderDetail();
}
function googleMapsMode(t) { return ({walking:'walking',transit:'transit',taxi:'driving',driving:'driving'})[t]||'transit'; }
function typeIcon(t) { return ({attraction:'🏛️',restaurant:'🍽️',museum:'🖼️',park:'🌿',hotel:'🏨'})[t]||'📍'; }
function typeDotClass(t) { return ({attraction:'attraction',restaurant:'restaurant',museum:'attraction',park:'restaurant'})[t]||'attraction'; }
function transportClass(t) { return ({walking:'transport-walking',transit:'transport-transit',taxi:'transport-taxi',driving:'transport-car'})[t]||'transport-transit'; }
function transportIcon(t) { return ({walking:'🚶',transit:'🚌',taxi:'🚕',driving:'🚗'})[t]||'🚌'; }
function transportLabel(t) { return ({walking:'Caminando',transit:'Transporte público',taxi:'Taxi/Uber',driving:'Auto'})[t]||'Transporte'; }
function formatDate(s) { if (!s) return ''; return new Date(s+'T00:00:00').toLocaleDateString('es-AR',{day:'numeric',month:'short'}); }
function getWeekday(s) { return new Date(s+'T00:00:00').toLocaleDateString('es-AR',{weekday:'short'}).slice(0,3); }
function getWeekdayFull(s) { return new Date(s+'T00:00:00').toLocaleDateString('es-AR',{weekday:'long'}).replace(/^\w/,c=>c.toUpperCase()); }

// ══════════════════════════════════════
// EXPORT / IMPORT
// ══════════════════════════════════════
let pendingImportData = null;

function exportTrips() {
  if (!trips.length) { showToast('⚠️ No hay viajes para exportar'); return; }
  const payload = {
    _wandr: true,
    _version: 1,
    _exported: new Date().toISOString(),
    trips
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `wandr-viajes-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('✅ Archivo exportado');
}

function onFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data._wandr || !Array.isArray(data.trips)) {
        showToast('⚠️ Archivo inválido o no es un respaldo de Wandr'); return;
      }
      pendingImportData = data.trips;
      // Show merge/replace options
      document.getElementById('import-warning').style.display = 'block';
    } catch {
      showToast('⚠️ No se pudo leer el archivo');
    }
  };
  reader.readAsText(file);
  // Reset input so same file can be re-selected
  e.target.value = '';
}

function confirmImport(mode) {
  if (!pendingImportData) return;
  if (mode === 'replace') {
    document.getElementById('confirm-import-count').textContent = pendingImportData.length;
    openModal('modal-confirm-import');
    return;
  }
  // Merge mode
  const existingIds = new Set(trips.map(t => t.id));
  const newTrips = pendingImportData.filter(t => t.id && !existingIds.has(t.id));
  const skipped = pendingImportData.length - newTrips.length;

  // Validate before merging
  const valid = newTrips.filter(t => t.name && t.startDate && t.endDate && Array.isArray(t.cities));
  const invalid = newTrips.length - valid.length;

  trips = [...trips, ...sanitizeTrips(valid)];
  save();
  pendingImportData = null;
  document.getElementById('import-warning').style.display = 'none';
  document.getElementById('import-file-input').value = '';
  closeModal('modal-backup');
  renderTrips();

  let msg = `✅ ${valid.length} viaje${valid.length !== 1 ? 's' : ''} agregado${valid.length !== 1 ? 's' : ''}`;
  if (skipped > 0) msg += ` · ${skipped} ya existía${skipped !== 1 ? 'n' : ''}`;
  if (invalid > 0) msg += ` · ${invalid} inválido${invalid !== 1 ? 's' : ''} ignorado${invalid !== 1 ? 's' : ''}`;
  if (valid.length === 0 && skipped > 0) msg = `⚠️ Todos los viajes del archivo ya existen`;
  showToast(msg);
  updateBackupCount();
}

function confirmImportReplace() {
  if (!pendingImportData) return;

  // Validate before replacing
  const valid = pendingImportData.filter(t => t.name && t.startDate && t.endDate && Array.isArray(t.cities));
  const invalid = pendingImportData.length - valid.length;

  trips = sanitizeTrips(valid);
  save();
  pendingImportData = null;
  document.getElementById('import-warning').style.display = 'none';
  document.getElementById('import-file-input').value = '';
  closeModal('modal-confirm-import');
  closeModal('modal-backup');
  renderTrips();

  let msg = `✅ ${trips.length} viaje${trips.length !== 1 ? 's' : ''} importado${trips.length !== 1 ? 's' : ''}`;
  if (invalid > 0) msg += ` · ${invalid} registro${invalid !== 1 ? 's' : ''} inválido${invalid !== 1 ? 's' : ''} ignorado${invalid !== 1 ? 's' : ''}`;
  showToast(msg);
  updateBackupCount();
}

function updateBackupCount() {
  const el = document.getElementById('backup-count-label');
  if (!el) return;
  const n = trips.length;
  el.textContent = n === 0 ? 'Sin viajes aún' : `${n} viaje${n !== 1 ? 's' : ''} guardado${n !== 1 ? 's' : ''}`;
}

// ══════════════════════════════════════
// MODAL
// ══════════════════════════════════════
function openModal(id) {
  document.getElementById(id).classList.add('open');
  if (id === 'modal-backup') {
    updateBackupCount();
    document.getElementById('import-warning').style.display = 'none';
    pendingImportData = null;
  }
}
function toggleHelpSection(el) {
  const section = el.parentElement;
  const isOpen = section.classList.contains('open');
  document.querySelectorAll('.help-section').forEach(s => s.classList.remove('open'));
  if (!isOpen) {
    section.classList.add('open');
  }
}

// Help cards content
const helpContent = {
  'Crear viaje': 'Tocá "Nuevo viaje". Ingresá el nombre y las fechas globales. Podés arrancar con una sola ciudad y agregar las demás después — no hace falta tener todo definido desde el principio.',
  'Ciudades': 'Usá los chips de ciudad para cambiar entre destinos. El botón <strong style="color:var(--accent)">+ Ciudad</strong> (al lado de "Destino") agrega una ciudad nueva en cualquier momento. Si quedan días sin ciudad asignada, aparece un aviso en dorado con un botón para cubrirlos. Podés editar las fechas de cada ciudad tocando el ícono 📅 junto al hotel.',
  'Excursiones': 'Si visitás una ciudad solo por el día sin pernoctar, elegí "Excursión" al agregar la ciudad. Podés indicar el medio de transporte y los horarios de salida/regreso. Las excursiones aparecen con el ícono 🗺️ y no cuentan noches de hotel.',
  'Hotel': 'Tocá el ícono ✏️ en el banner del hotel para editar nombre, dirección y horarios de check-in/check-out. Las horas se seleccionan con un selector de rueda (como Samsung Alarm). Si una ciudad no tiene hotel asignado, aparece un banner punteado con "＋ Agregar hotel".',
  'Paradas': 'Tocá el botón <strong style="color:var(--accent)">+</strong> para agregar atracciones, restaurantes, museos o parques. Elegí el medio de transporte desde la parada anterior. Podés reordenar las paradas arrastrando el ícono ⠿ de la izquierda. Con 2+ paradas podés usar "Optimizar orden" para que el recorrido sea más eficiente.',
  'Google Maps': 'Cada parada tiene "Cómo llegar" (ruta desde la parada anterior) y "Ver lugar". Al final del día podés ver la ruta completa o cómo volver al hotel.',
  'Pasajes': 'En la pestaña <strong style="color:var(--accent)">🎫 Pasajes</strong> encontrás los tramos entre ciudades generados automáticamente. Tocá "＋ Completar datos" para cargar vuelo, bus, tren o barco con compañía, horarios, terminal y puerta de embarque. Una vez cargado, el día de salida y el de llegada muestran automáticamente la terminal y el botón "Cómo llegar al hotel".',
  'Días tránsito': 'Si un día es compartido entre dos ciudades (salís a las 10hs de ciudad A y llegás a las 17hs a ciudad B), ese día aparece en ambas ciudades con un marcador ✈ en el tab. En ciudad A ves la terminal de salida al final del itinerario; en ciudad B ves la terminal de llegada al principio y el hotel al final.',
  'Resumen': 'En la pestaña <strong style="color:var(--accent)">🗺️ Resumen</strong> encontrás estadísticas del viaje: cantidad de días, ciudades, noches y pasajes. También podés ver cada ciudad con sus fechas, hotel, horarios de check-in/check-out y cómo llegar.',
  'Respaldo': 'En la pestaña "Respaldo" podés exportar todos tus viajes a un archivo .json para hacer copia de seguridad o pasarlos a otro dispositivo. También podés importar y elegir si reemplazar todo o agregar a los existentes.',
  'Tema': 'Tocá el botón de sol/luna en la barra inferior para alternar entre modo claro y modo oscuro. La preference se guarda en tu dispositivo.',
  'Instalar': 'En Chrome Android: menú (⋮) → "Añadir a pantalla de inicio". Los datos se guardan en el dispositivo — no hace falta conexión a internet para usar la app.'
};

// ── Stop optimization algorithms ──────────────────────────
function stopDistance(a, b) {
  if (!a.lat || !a.lon || !b.lat || !b.lon) return Infinity;
  return haversine(a.lat, a.lon, b.lat, b.lon);
}

function totalRouteDistance(stops, hotelLat, hotelLon) {
  let total = 0;
  let prev = { lat: hotelLat, lon: hotelLon };
  for (const stop of stops) {
    total += stopDistance(prev, stop);
    prev = stop;
  }
  return total;
}

// Brute force: try all permutations (for ≤8 stops)
function bruteForceOptimal(stops, hotelLat, hotelLon) {
  if (stops.length <= 1) return [...stops];
  
  // Generate all permutations
  const indices = stops.map((_, i) => i);
  const perms = permute(indices);
  
  let bestPerm = null;
  let bestDist = Infinity;
  
  for (const perm of perms) {
    const ordered = perm.map(i => stops[i]);
    const dist = totalRouteDistance(ordered, hotelLat, hotelLon);
    if (dist < bestDist) {
      bestDist = dist;
      bestPerm = ordered;
    }
  }
  
  return bestPerm || [...stops];
}

function permute(arr) {
  if (arr.length <= 1) return [arr];
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permute(rest)) {
      result.push([arr[i], ...p]);
    }
  }
  return result;
}

// Nearest neighbor: greedy approach (for >8 stops)
function nearestNeighborOrder(stops, hotelLat, hotelLon) {
  if (stops.length <= 1) return [...stops];
  
  const remaining = [...stops];
  const ordered = [];
  let current = { lat: hotelLat, lon: hotelLon };
  
  while (remaining.length > 0) {
    let nearestIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = stopDistance(current, remaining[i]);
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
}

// 2-opt improvement: swap pairs to reduce total distance
function twoOptImprove(stops, hotelLat, hotelLon) {
  if (stops.length <= 2) return [...stops];
  
  let improved = [...stops];
  let improvedDist = totalRouteDistance(improved, hotelLat, hotelLon);
  let changed = true;
  
  while (changed) {
    changed = false;
    for (let i = 0; i < improved.length - 1; i++) {
      for (let j = i + 1; j < improved.length; j++) {
        // Swap stops[i] and stops[j]
        const candidate = [...improved];
        [candidate[i], candidate[j]] = [candidate[j], candidate[i]];
        const candidateDist = totalRouteDistance(candidate, hotelLat, hotelLon);
        if (candidateDist < improvedDist) {
          improved = candidate;
          improvedDist = candidateDist;
          changed = true;
        }
      }
    }
  }
  
  return improved;
}

function optimizeCurrentStops() {
  const trip = trips.find(t => t.id === currentTripId);
  if (!trip) return;
  const city = trip.cities[currentCityIdx];
  if (!city) return;
  const day = city.days[currentDayIdx];
  if (!day || !day.stops || day.stops.length < 2) return;
  
  // Save original order if not already saved
  if (_originalStopOrder === null) {
    _originalStopOrder = JSON.parse(JSON.stringify(day.stops));
  }
  
  const hotelLat = city.hotelLat || 0;
  const hotelLon = city.hotelLon || 0;
  
  // Choose algorithm based on number of stops
  let optimized;
  if (day.stops.length <= 8) {
    optimized = bruteForceOptimal(day.stops, hotelLat, hotelLon);
  } else {
    optimized = nearestNeighborOrder(day.stops, hotelLat, hotelLon);
    optimized = twoOptImprove(optimized, hotelLat, hotelLon);
  }
  
  day.stops = optimized;
  save();
  renderDetail();
}

function restoreStopOrder() {
  if (_originalStopOrder === null) return;
  const trip = trips.find(t => t.id === currentTripId);
  if (!trip) return;
  const city = trip.cities[currentCityIdx];
  if (!city) return;
  const day = city.days[currentDayIdx];
  if (!day) return;
  
  day.stops = _originalStopOrder;
  _originalStopOrder = null;
  save();
  renderDetail();
}

function toggleHelpCard(el, title) {
  const content = helpContent[title] || '';
  
  // Find which group (row) we're in
  const group = el.closest('.help-group');
  const textEl = group.querySelector('.help-text');
  
  // Check if this card is already active in this group
  const isCurrentlyActive = el.classList.contains('active');
  
  // Close ALL help texts first
  document.querySelectorAll('.help-text').forEach(t => {
    t.classList.remove('open');
    t.innerHTML = '';
  });
  
  // Remove active from ALL cards
  document.querySelectorAll('.help-card').forEach(c => c.classList.remove('active'));
  
  // If it wasn't active before, activate it now
  if (!isCurrentlyActive) {
    el.classList.add('active');
    textEl.innerHTML = content;
    textEl.classList.add('open');
  }
}

window.toggleHelpCard = toggleHelpCard;
window.addCityEntry = addCityEntry;
window.removeCityEntry = removeCityEntry;
window.confirmRemoveCityEntry = confirmRemoveCityEntry;
window.confirmDeleteStop = confirmDeleteStop;
window.confirmRemoveTransitLeg = confirmRemoveTransitLeg;
window.optimizeCurrentStops = optimizeCurrentStops;
window.restoreStopOrder = restoreStopOrder;
window.openPackingModal = openPackingModal;
window.mapWmoCode = mapWmoCode;
window.getWeatherForCity = getWeatherForCity;
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  if (id === 'modal-backup') {
    pendingImportData = null;
    document.getElementById('import-warning').style.display = 'none';
    document.getElementById('import-file-input').value = '';
  }
}
document.querySelectorAll('.modal-overlay').forEach(o => o.addEventListener('click', e => { 
  if (e.target === o) {
    o.classList.remove('open');
    if (o.id === 'modal-backup') {
      pendingImportData = null;
      document.getElementById('import-warning').style.display = 'none';
      document.getElementById('import-file-input').value = '';
    }
  }
}));

// ══════════════════════════════════════
// TOAST
// ══════════════════════════════════════
function toggleTheme() {
  const isLight = document.documentElement.classList.toggle('light');
  localStorage.setItem('wandr_theme', isLight ? 'light' : 'dark');
  document.getElementById('theme-icon-dark').style.display  = isLight ? 'none' : '';
  document.getElementById('theme-icon-light').style.display = isLight ? '' : 'none';
  document.getElementById('theme-label').textContent = isLight ? 'Oscuro' : 'Claro';
  document.querySelector('meta[name="theme-color"]').content = '#4A7BF7';
}

function initTheme() {
  const saved = localStorage.getItem('wandr_theme');
  if (saved === 'light') {
    document.documentElement.classList.add('light');
    document.getElementById('theme-icon-dark').style.display  = 'none';
    document.getElementById('theme-icon-light').style.display = '';
    document.getElementById('theme-label').textContent = 'Oscuro';
  }
  document.querySelector('meta[name="theme-color"]').content = '#4A7BF7';
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

// ══════════════════════════════════════
// WEATHER SERVICE (Open-Meteo API)
// ══════════════════════════════════════

const WEATHER_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
let _weatherCache = null;
let _weatherPrefetching = false;

// Initialize weather cache from localStorage on load
(function initWeatherCache() {
  _weatherCache = {};
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('wandr_weather_cache_')) keys.push(key);
    }
    keys.forEach(key => {
      const raw = localStorage.getItem(key);
      if (raw) {
        const cached = JSON.parse(raw);
        if (Date.now() - cached.ts < WEATHER_CACHE_TTL) {
          const cityId = key.replace('wandr_weather_cache_', '');
          _weatherCache[cityId] = cached.data;
        }
      }
    });
  } catch(e) {}
})();

function mapWmoCode(code) {
  const map = {
    0:  { icon: '☀️', desc: 'Despejado', cls: 'weather-clear' },
    1:  { icon: '🌤️', desc: 'Mayormente despejado', cls: 'weather-mostly-clear' },
    2:  { icon: '⛅', desc: 'Parcialmente nublado', cls: 'weather-partly-cloudy' },
    3:  { icon: '☁️', desc: 'Nublado', cls: 'weather-overcast' },
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
    99: { icon: '⛈️', desc: 'Tormenta con granizo fuerte', cls: 'weather-thunderstorm-hail-heavy' },
  };
  return map[code] || { icon: '🌡️', desc: 'Sin datos', cls: 'weather-unknown' };
}

function getWeatherCache(cityId) {
  try {
    const raw = localStorage.getItem('wandr_weather_cache_' + cityId);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (Date.now() - cached.ts > WEATHER_CACHE_TTL) return null;
    return cached.data;
  } catch(e) { return null; }
}

function setWeatherCache(cityId, data) {
  try {
    localStorage.setItem('wandr_weather_cache_' + cityId, JSON.stringify({ ts: Date.now(), data }));
  } catch(e) {}
}

async function fetchOpenMeteo(lat, lon) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max&timezone=auto&forecast_days=16`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch(e) { return null; }
}

async function fetchHistoricalWeather(lat, lon, startDate, endDate) {
  try {
    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');
    const years = [];
    for (let y = 1; y <= 5; y++) {
      const hStart = new Date(start);
      hStart.setFullYear(hStart.getFullYear() - y);
      const hEnd = new Date(end);
      hEnd.setFullYear(hEnd.getFullYear() - y);
      years.push({
        start: hStart.toISOString().slice(0, 10),
        end: hEnd.toISOString().slice(0, 10),
      });
    }
    const promises = years.map(y => 
      fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${y.start}&end_date=${y.end}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&timezone=auto`)
        .then(r => r.ok ? r.json() : null)
        .catch(() => null)
    );
    const results = await Promise.allSettled(promises);
    const allData = results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
    return allData.length > 0 ? allData : null;
  } catch(e) { return null; }
}

function buildHistoricalAverages(allData, startDate, endDate) {
  if (!allData || allData.length === 0) return null;
  const byDay = {};
  allData.forEach(data => {
    const daily = data.daily;
    if (!daily) return;
    for (let i = 0; i < (daily.time || []).length; i++) {
      const dateStr = daily.time[i];
      const mmdd = dateStr.slice(5);
      if (!byDay[mmdd]) byDay[mmdd] = { maxs: [], mins: [], precip: [], wind: [] };
      if (daily.temperature_2m_max?.[i] !== null && daily.temperature_2m_max?.[i] !== undefined) 
        byDay[mmdd].maxs.push(daily.temperature_2m_max[i]);
      if (daily.temperature_2m_min?.[i] !== null && daily.temperature_2m_min?.[i] !== undefined) 
        byDay[mmdd].mins.push(daily.temperature_2m_min[i]);
      if (daily.precipitation_sum?.[i] !== null && daily.precipitation_sum?.[i] !== undefined) 
        byDay[mmdd].precip.push(daily.precipitation_sum[i]);
      if (daily.wind_speed_10m_max?.[i] !== null && daily.wind_speed_10m_max?.[i] !== undefined) 
        byDay[mmdd].wind.push(daily.wind_speed_10m_max[i]);
    }
  });
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  const days = {};
  let totalMax = 0, totalMin = 0, totalPrecip = 0, rainyDays = 0, count = 0;
  const current = new Date(start);
  while (current <= end) {
    const mmdd = String(current.getMonth() + 1).padStart(2, '0') + '-' + String(current.getDate()).padStart(2, '0');
    const dateKey = current.toISOString().slice(0, 10);
    const d = byDay[mmdd];
    if (d && d.maxs.length > 0) {
      const avgMax = Math.round(d.maxs.reduce((a, b) => a + b, 0) / d.maxs.length);
      const avgMin = Math.round(d.mins.reduce((a, b) => a + b, 0) / d.mins.length);
      const avgPrecip = d.precip.length > 0 ? Math.round(d.precip.reduce((a, b) => a + b, 0) / d.precip.length * 10) / 10 : 0;
      const avgWind = d.wind.length > 0 ? Math.round(d.wind.reduce((a, b) => a + b, 0) / d.wind.length) : 0;
      const rainyCount = d.precip.filter(p => p > 0.5).length;
      days[dateKey] = {
        wmoCode: null, tempMax: avgMax, tempMin: avgMin, precipProb: null, windSpeed: avgWind,
        precipAvg: avgPrecip, rainyDays: rainyCount, totalDays: d.precip.length, isHistorical: true,
      };
      totalMax += avgMax; totalMin += avgMin; totalPrecip += avgPrecip;
      if (rainyCount > 0) rainyDays++;
      count++;
    }
    current.setDate(current.getDate() + 1);
  }
  if (count === 0) return null;
  return {
    days, cityAvg: { avgMax: Math.round(totalMax / count), avgMin: Math.round(totalMin / count), avgPrecip: Math.round(totalPrecip / count * 10) / 10, rainyDays, totalDays: count },
    isHistorical: true,
  };
}

function buildPackingSuggestions(hottestMax, coldestMin, rainChance, maxWind) {
  const suggestions = [];
  if (hottestMax >= 30) {
    suggestions.push({ icon: '👕', text: 'Ropa bien liviana para el calor (shorts, remeras)' });
    suggestions.push({ icon: '🧴', text: 'Protector solar SPF 50+' });
    suggestions.push({ icon: '🕶️', text: 'Anteojos de sol y sombrero' });
    suggestions.push({ icon: '💧', text: 'Botella de agua' });
  } else if (hottestMax >= 25) {
    suggestions.push({ icon: '👕', text: 'Ropa liviana (remeras, pantalones finos)' });
    suggestions.push({ icon: '🧴', text: 'Protector solar' });
    suggestions.push({ icon: '🕶️', text: 'Anteojos de sol' });
  } else if (hottestMax >= 20) {
    suggestions.push({ icon: '👕', text: 'Ropa de entretiempo (remeras, pantalones largos)' });
  }
  if (coldestMin < 5) {
    suggestions.push({ icon: '🧥', text: 'Campera de invierno bien abrigada (para la noche/frío)' });
    suggestions.push({ icon: '🧣', text: 'Bufanda, guantes térmicos y gorro' });
    suggestions.push({ icon: '🧦', text: 'Medias térmicas gruesas' });
    suggestions.push({ icon: '👕', text: 'Ropa térmica de primera capa' });
  } else if (coldestMin < 10) {
    suggestions.push({ icon: '🧥', text: 'Campera abrigada o de invierno (para la noche)' });
    suggestions.push({ icon: '🧣', text: 'Bufanda y guantes' });
    suggestions.push({ icon: '🧢', text: 'Gorro abrigado' });
  } else if (coldestMin < 15) {
    suggestions.push({ icon: '🧥', text: 'Campera abrigada o buzo para la noche' });
    suggestions.push({ icon: '🧣', text: 'Bufanda o pañuelo' });
  } else if (coldestMin < 20) {
    suggestions.push({ icon: '🧥', text: 'Campera liviana o buzo para la noche' });
  }
  suggestions.push({ icon: '👟', text: 'Zapatillas cómodas para caminar' });
  if (rainChance > 50) {
    suggestions.push({ icon: '☂️', text: 'Paraguas (alta probabilidad de lluvia)' });
    suggestions.push({ icon: '🧥', text: 'Campera impermeable o chubasquero' });
  } else if (rainChance > 0) {
    suggestions.push({ icon: '☂️', text: 'Paraguas (opcional si vas a caminar)' });
  }
  if (maxWind >= 40) {
    suggestions.push({ icon: '💨', text: 'Campera cortaviento (ráfagas fuertes)' });
  } else if (maxWind >= 25) {
    suggestions.push({ icon: '🧥', text: 'Campera que corte el viento' });
  }
  return suggestions;
}

async function resolveCoordinates(city, trip) {
  if (city.hotelLat && city.hotelLon) return { lat: city.hotelLat, lon: city.hotelLon };
  for (const day of (city.days || [])) {
    for (const stop of (day.stops || [])) {
      if (stop.lat && stop.lon) return { lat: stop.lat, lon: stop.lon };
    }
  }
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(city.name)}&limit=1`);
    if (res.ok) { const data = await res.json(); if (data.length > 0) return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) }; }
  } catch(e) {}
  return null;
}

async function getWeatherForCity(city, trip) {
  if (!city || !city.id) return null;
  const cached = getWeatherCache(city.id);
  if (cached) { return cached; }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const maxForecastDate = new Date(today); maxForecastDate.setDate(maxForecastDate.getDate() + 15);
  const cityStartDate = new Date(city.startDate + 'T00:00:00');
  const coords = await resolveCoordinates(city, trip);
  if (!coords) { return null; }
  if (cityStartDate > maxForecastDate) {
    const historicalData = await fetchHistoricalWeather(coords.lat, coords.lon, city.startDate, city.endDate);
    if (historicalData) {
      const result = buildHistoricalAverages(historicalData, city.startDate, city.endDate);
      if (result) {
        setWeatherCache(city.id, result);
        if (_weatherCache) _weatherCache[city.id] = result;
        return result;
      }
    }
    return null;
  }
  const data = await fetchOpenMeteo(coords.lat, coords.lon);
  if (!data || !data.daily) return null;
  const daily = data.daily;
  const result = { days: {}, cityAvg: null };
  for (let i = 0; i < (daily.time || []).length; i++) {
    const date = daily.time[i];
    result.days[date] = {
      wmoCode: daily.weather_code?.[i] ?? null, tempMax: daily.temperature_2m_max?.[i] ?? null,
      tempMin: daily.temperature_2m_min?.[i] ?? null, precipProb: daily.precipitation_probability_max?.[i] ?? null,
      windSpeed: daily.wind_speed_10m_max?.[i] ?? null,
    };
  }
  const validTemps = (daily.temperature_2m_max || []).filter(t => t !== null);
  const validTempsMin = (daily.temperature_2m_min || []).filter(t => t !== null);
  if (validTemps.length > 0) {
    result.cityAvg = { avgMax: Math.round(validTemps.reduce((a, b) => a + b, 0) / validTemps.length), avgMin: Math.round(validTempsMin.reduce((a, b) => a + b, 0) / validTempsMin.length) };
  }
  setWeatherCache(city.id, result);
  if (_weatherCache) _weatherCache[city.id] = result;
  return result;
}

async function prefetchWeather(trip) {
  if (!navigator.onLine) return;
  if (!_weatherCache) _weatherCache = {};
  const cities = (trip.cities || []).filter(c => c.id);
  const results = await Promise.allSettled(cities.map(city => getWeatherForCity(city, trip)));
  results.forEach((r, i) => {
    // Silently handle weather fetch failures
  });
  if (currentDetailTab === 'itinerary') renderDetail();
  if (currentDetailTab === 'overview') renderOverview();
}

function buildWeatherHtml(dayData) {
  if (!dayData) return '';
  if (dayData.isHistorical) {
    const avgMax = dayData.tempMax !== null ? Math.round(dayData.tempMax) + '°' : '';
    const avgMin = dayData.tempMin !== null ? Math.round(dayData.tempMin) + '°' : '';
    const tempRange = (avgMax && avgMin) ? `${avgMax} / ${avgMin}` : (avgMax || avgMin || '');
    const precip = dayData.precipAvg !== null && dayData.precipAvg !== undefined ? dayData.precipAvg + 'mm' : '';
    const wind = dayData.windSpeed ? Math.round(dayData.windSpeed) + ' km/h' : '';
    return `<div class="weather-line weather-historical">
      <span class="weather-icon">📊</span><span class="weather-desc">Clima histórico</span>
      ${tempRange ? `<span class="weather-temp">🌡️ ${tempRange}</span>` : ''}
      ${precip ? `<span class="weather-precip">🌧️ ${precip}</span>` : ''}
      ${wind ? `<span class="weather-wind">💨 ${wind}</span>` : ''}
      <button class="weather-packing-btn" onclick="openPackingModal()">🧳 ¿Qué llevar?</button>
    </div>`;
  }
  if (dayData.outOfRange) {
    const start = dayData.cityStartDate ? formatDate(dayData.cityStartDate) : 'las fechas seleccionadas';
    return `<div class="weather-line weather-out-of-range">
      <span class="weather-icon">📅</span><span class="weather-desc">Pronóstico disponible ~1 semana antes de <strong>${start}</strong></span>
    </div>`;
  }
  if (dayData.wmoCode === null) return '';
  const wmo = mapWmoCode(dayData.wmoCode);
  const tempMax = dayData.tempMax !== null ? Math.round(dayData.tempMax) + '°' : '';
  const tempMin = dayData.tempMin !== null ? Math.round(dayData.tempMin) + '°' : '';
  const tempRange = (tempMin && tempMax) ? `${tempMax} / ${tempMin}` : (tempMax || tempMin || '');
  const precip = dayData.precipProb !== null ? `${dayData.precipProb}%` : '';
  const wind = dayData.windSpeed !== null ? Math.round(dayData.windSpeed) + ' km/h' : '';
  // Soportar ambos formatos de mapWmoCode (desc o description)
  const weatherDesc = wmo.desc || wmo.description || 'Sin datos';
  return `<div class="weather-line">
    <span class="weather-icon">${wmo.icon}</span><span class="weather-desc">${weatherDesc}</span>
    ${tempRange ? `<span class="weather-temp">🌡️ ${tempRange}</span>` : ''}
    ${precip ? `<span class="weather-precip">🌧️ ${precip}</span>` : ''}
    ${wind ? `<span class="weather-wind">💨 ${wind}</span>` : ''}
    <button class="weather-packing-btn" onclick="openPackingModal()">🧳 ¿Qué llevar?</button>
  </div>`;
}

function openPackingModal() {
  const trip = trips.find(t => t.id === currentTripId);
  if (!trip) return;
  const city = trip.cities[currentCityIdx];
  if (!city) return;
  const cityWeather = _weatherCache && _weatherCache[city.id];
  if (!cityWeather) { showToast('⚠️ No hay datos de clima disponibles'); return; }
  document.getElementById('packing-city-name').textContent = city.name;
  if (cityWeather.isHistorical) {
    const days = Object.values(cityWeather.days);
    const mins = days.map(d => d.tempMin).filter(t => t !== null);
    const maxs = days.map(d => d.tempMax).filter(t => t !== null);
    const winds = days.map(d => d.windSpeed).filter(w => w !== null);
    const precipAvgs = days.map(d => d.precipAvg).filter(p => p !== null && p !== undefined);
    const coldestMin = mins.length > 0 ? Math.round(Math.min(...mins)) : null;
    const hottestMax = maxs.length > 0 ? Math.round(Math.max(...maxs)) : null;
    const maxWind = winds.length > 0 ? Math.round(Math.max(...winds)) : 0;
    const rainDaysCount = precipAvgs.filter(p => p > 1).length;
    const totalDays = precipAvgs.length;
    if (coldestMin === null || hottestMax === null) { showToast('⚠️ No hay datos suficientes'); return; }
    const suggestions = buildPackingSuggestions(hottestMax, coldestMin, totalDays > 0 ? (rainDaysCount / totalDays) * 100 : 0, maxWind);
    document.getElementById('packing-temp').textContent = `${hottestMax}° / ${coldestMin}°`;
    document.getElementById('packing-rain').textContent = totalDays > 0 ? `~${rainDaysCount} de ${totalDays} días con lluvia (promedio histórico)` : 'Sin datos de lluvia';
    document.getElementById('packing-list').innerHTML = suggestions.length > 0 ? suggestions.map(s => `<div class="packing-item"><span class="packing-icon">${s.icon}</span><span class="packing-text">${s.text}</span></div>`).join('') : '<p style="color:var(--text2);font-size:0.85rem">No hay sugerencias específicas.</p>';
  } else if (cityWeather.days) {
    const day = (city.days || [])[currentDayIdx];
    if (!day) return;
    const dayData = cityWeather.days[day.date];
    if (!dayData || dayData.wmoCode === null) {
      document.getElementById('packing-temp').textContent = 'Sin datos';
      document.getElementById('packing-rain').textContent = '';
      document.getElementById('packing-list').innerHTML = '<p style="color:var(--text2);font-size:0.85rem">No hay pronóstico para este día.</p>';
      openModal('modal-packing'); return;
    }
    const wmo = mapWmoCode(dayData.wmoCode);
    const tempMax = dayData.tempMax !== null ? Math.round(dayData.tempMax) + '°' : '';
    const tempMin = dayData.tempMin !== null ? Math.round(dayData.tempMin) + '°' : '';
    const dateObj = new Date(day.date + 'T00:00:00');
    const weekday = dateObj.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
    const rainPct = dayData.precipProb || 0;
    const suggestions = buildPackingSuggestions(dayData.tempMax, dayData.tempMin, rainPct, dayData.windSpeed || 0);
    document.getElementById('packing-temp').textContent = `${weekday} · ${wmo.icon} ${tempMax} / ${tempMin}`;
    document.getElementById('packing-rain').textContent = dayData.precipProb !== null ? `Probabilidad de lluvia: ${dayData.precipProb}%` : '';
    document.getElementById('packing-list').innerHTML = suggestions.length > 0 ? suggestions.map(s => `<div class="packing-item"><span class="packing-icon">${s.icon}</span><span class="packing-text">${s.text}</span></div>`).join('') : '<p style="color:var(--text2);font-size:0.85rem">Clima agradable, sin recomendaciones especiales.</p>';
  }
  openModal('modal-packing');
}

function buildWeatherChipHtml(dayData) {
  if (!dayData || dayData.outOfRange) return '';
  if (dayData.isHistorical) {
    const tempMax = dayData.tempMax !== null ? Math.round(dayData.tempMax) + '°' : '';
    if (tempMax) return `<span class="weather-chip weather-historical-chip" title="Clima histórico">📊 ${tempMax}</span>`;
    return '';
  }
  if (dayData.wmoCode === null) return '';
  const wmo = mapWmoCode(dayData.wmoCode);
  const tempMax = dayData.tempMax !== null ? Math.round(dayData.tempMax) + '°' : '';
  return `<span class="weather-chip" title="${wmo.desc}">${wmo.icon} ${tempMax}</span>`;
}

// ══════════════════════════════════════
// INIT — migrate & sanitize old data
// ══════════════════════════════════════

function saveToWeatherCache(cityId, data) {
  try {
    localStorage.setItem(`wandr_weather_cache_${cityId}`, JSON.stringify({ data, timestamp: Date.now() }));
  } catch(e) { /* silently ignore cache errors */ }
}

function loadFromWeatherCache(cityId) {
  try {
    const raw = localStorage.getItem(`wandr_weather_cache_${cityId}`);
    if (!raw) return null;
    const { data, timestamp } = JSON.parse(raw);
    if (Date.now() - timestamp > 30 * 60 * 1000) return null; // 30 min TTL
    return data;
  } catch(e) { return null; }
}

function mapWmoCode(code) {
  const map = {
    0: { description: 'Despejado', icon: '☀️' },
    1: { description: 'Mayormente despejado', icon: '🌤️' },
    2: { description: 'Parcialmente nublado', icon: '⛅' },
    3: { description: 'Nublado', icon: '☁️' },
    45: { description: 'Niebla', icon: '🌫️' },
    48: { description: 'Niebla con escarcha', icon: '🌫️' },
    51: { description: 'Llovizna ligera', icon: '🌦️' },
    53: { description: 'Llovizna moderada', icon: '🌦️' },
    55: { description: 'Llovizna densa', icon: '🌧️' },
    56: { description: 'Llovizna helada ligera', icon: '🌧️' },
    57: { description: 'Llovizna helada densa', icon: '🌧️' },
    61: { description: 'Lluvia ligera', icon: '🌦️' },
    63: { description: 'Lluvia moderada', icon: '🌧️' },
    65: { description: 'Lluvia intensa', icon: '🌧️' },
    66: { description: 'Lluvia helada ligera', icon: '🌨️' },
    67: { description: 'Lluvia helada intensa', icon: '🌨️' },
    71: { description: 'Nieve ligera', icon: '❄️' },
    73: { description: 'Nieve moderada', icon: '❄️' },
    75: { description: 'Nieve intensa', icon: '❄️' },
    77: { description: 'Granos de nieve', icon: '🌨️' },
    80: { description: 'Chubascos ligeros', icon: '🌦️' },
    81: { description: 'Chubascos moderados', icon: '🌧️' },
    82: { description: 'Chubascos violentos', icon: '⛈️' },
    85: { description: 'Chubascos de nieve ligeros', icon: '🌨️' },
    86: { description: 'Chubascos de nieve intensos', icon: '🌨️' },
    95: { description: 'Tormenta', icon: '⛈️' },
    96: { description: 'Tormenta con granizo ligero', icon: '⛈️' },
    99: { description: 'Tormenta con granizo intenso', icon: '⛈️' }
  };
  return map[code] || { description: 'Desconocido', icon: '🌡️' };
}

async function getCoordinatesForCity(city, trip) {
  if (city.hotelLat && city.hotelLon) {
    return { lat: city.hotelLat, lon: city.hotelLon };
  }
  const days = city.days || [];
  for (const day of days) {
    const stops = day.stops || [];
    for (const stop of stops) {
      if (stop.lat && stop.lon) {
        return { lat: stop.lat, lon: stop.lon };
      }
    }
  }
  if (city.name) {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(city.name)}&limit=1`, {
        headers: { 'User-Agent': 'Wandr/1.0' }
      });
      const data = await res.json();
      if (data && data.length > 0) {
        return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
      }
    } catch(e) { /* silently ignore geocoding errors */ }
  }
  return null;
}

// ══════════════════════════════════════
// PACKING SUGGESTIONS
// ══════════════════════════════════════

function getPackingSuggestions(weatherDay) {
  const suggestions = [];
  const wmo = weatherDay.weather_code;
  const maxTemp = weatherDay.temperature_2m_max;
  const precip = weatherDay.precipitation_probability_max || 0;
  const wind = weatherDay.wind_speed_10m_max || 0;
  if (maxTemp < 10) {
    suggestions.push({ icon: '🧥', text: 'Abrigo pesado' });
    suggestions.push({ icon: '🧤', text: 'Guantes' });
    suggestions.push({ icon: '🧣', text: 'Bufanda' });
    suggestions.push({ icon: '🧢', text: 'Gorro' });
  } else if (maxTemp < 20) {
    suggestions.push({ icon: '🧥', text: 'Campera liviana' });
    suggestions.push({ icon: '🧶', text: 'Sweater' });
  } else {
    suggestions.push({ icon: '🧴', text: 'Protector solar' });
    suggestions.push({ icon: '🕶️', text: 'Gafas de sol' });
    suggestions.push({ icon: '👒', text: 'Sombrero' });
  }
  if (precip > 30) {
    suggestions.push({ icon: '☂️', text: 'Paraguas' });
    suggestions.push({ icon: '🧥', text: 'Impermeable' });
  }
  if (wind > 30) {
    suggestions.push({ icon: '🧥', text: 'Cortavientos' });
  }
  if ([71,73,75,77,85,86].includes(wmo)) {
    suggestions.push({ icon: '🥾', text: 'Botas impermeables' });
    suggestions.push({ icon: '🧣', text: 'Ropa térmica' });
  }
  suggestions.push({ icon: '🔌', text: 'Cargador de celular' });
  suggestions.push({ icon: '💧', text: 'Botella de agua' });
  suggestions.push({ icon: '📄', text: 'Documentos' });
  return suggestions;
}

// ══════════════════════════════════════
// INIT — migrate & sanitize old data
// ══════════════════════════════════════

// ══════════════════════════════════════
// WEATHER SERVICE
// ══════════════════════════════════════

function saveToWeatherCache(cityId, data) {
  try {
    localStorage.setItem(`wandr_weather_cache_${cityId}`, JSON.stringify({ data, timestamp: Date.now() }));
  } catch(e) { /* silently ignore */ }
}

function loadFromWeatherCache(cityId) {
  try {
    const raw = localStorage.getItem(`wandr_weather_cache_${cityId}`);
    if (!raw) return null;
    const { data, timestamp } = JSON.parse(raw);
    if (Date.now() - timestamp > 30 * 60 * 1000) return null;
    return data;
  } catch(e) { return null; }
}

function mapWmoCode(code) {
  const map = {
    0: { description: 'Despejado', icon: '☀️' },
    1: { description: 'Mayormente despejado', icon: '🌤️' },
    2: { description: 'Mayormente despejado', icon: '🌤️' },
    3: { description: 'Nublado', icon: '☁️' },
    45: { description: 'Niebla', icon: '🌫️' },
    48: { description: 'Niebla', icon: '🌫️' },
    51: { description: 'Llovizna', icon: '🌦️' },
    53: { description: 'Llovizna', icon: '🌦️' },
    55: { description: 'Llovizna', icon: '🌦️' },
    56: { description: 'Llovizna helada', icon: '🌧️' },
    57: { description: 'Llovizna helada', icon: '🌧️' },
    61: { description: 'Lluvia', icon: '🌧️' },
    63: { description: 'Lluvia', icon: '🌧️' },
    65: { description: 'Lluvia', icon: '🌧️' },
    66: { description: 'Lluvia helada', icon: '🌨️' },
    67: { description: 'Lluvia helada', icon: '🌨️' },
    71: { description: 'Nieve', icon: '❄️' },
    73: { description: 'Nieve', icon: '❄️' },
    75: { description: 'Nieve', icon: '❄️' },
    77: { description: 'Granos de nieve', icon: '🌨️' },
    80: { description: 'Chubascos', icon: '🌦️' },
    81: { description: 'Chubascos', icon: '🌦️' },
    82: { description: 'Chubascos', icon: '🌦️' },
    85: { description: 'Chubascos de nieve', icon: '🌨️' },
    86: { description: 'Chubascos de nieve', icon: '🌨️' },
    95: { description: 'Tormenta', icon: '⛈️' },
    96: { description: 'Tormenta con granizo', icon: '⛈️' },
    99: { description: 'Tormenta con granizo', icon: '⛈️' }
  };
  return map[code] || { description: 'Desconocido', icon: '🌡️' };
}

async function getCoordinatesForCity(city, trip) {
  if (city.hotelLat && city.hotelLon) {
    return { lat: city.hotelLat, lon: city.hotelLon };
  }
  const days = city.days || [];
  for (const day of days) {
    const stops = day.stops || [];
    for (const stop of stops) {
      if (stop.lat && stop.lon) {
        return { lat: stop.lat, lon: stop.lon };
      }
    }
  }
  if (city.name) {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(city.name)}&limit=1`, {
        headers: { 'User-Agent': 'Wandr/1.0' }
      });
      const data = await res.json();
      if (data && data.length > 0) {
        return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
      }
    } catch(e) { /* silently ignore geocoding errors */ }
  }
  return null;
}

// ══════════════════════════════════════
// PACKING SUGGESTIONS
// ══════════════════════════════════════

function getPackingSuggestions(weatherDay) {
  const suggestions = [];
  const wmo = weatherDay.weather_code;
  const maxTemp = weatherDay.temperature_2m_max;
  const precip = weatherDay.precipitation_probability_max || 0;
  const wind = weatherDay.wind_speed_10m_max || 0;
  if (maxTemp < 10) {
    suggestions.push({ icon: '🧥', text: 'Abrigo pesado' });
    suggestions.push({ icon: '🧤', text: 'Guantes' });
    suggestions.push({ icon: '🧣', text: 'Bufanda' });
    suggestions.push({ icon: '🧢', text: 'Gorro' });
  } else if (maxTemp < 20) {
    suggestions.push({ icon: '🧥', text: 'Campera liviana' });
    suggestions.push({ icon: '🧶', text: 'Sweater' });
  } else {
    suggestions.push({ icon: '🧴', text: 'Protector solar' });
    suggestions.push({ icon: '🕶️', text: 'Gafas de sol' });
    suggestions.push({ icon: '👒', text: 'Sombrero' });
  }
  if (precip > 30) {
    suggestions.push({ icon: '☂️', text: 'Paraguas' });
    suggestions.push({ icon: '🧥', text: 'Impermeable' });
  }
  if (wind > 30) {
    suggestions.push({ icon: '🧥', text: 'Cortavientos' });
  }
  if ([71,73,75,77,85,86].includes(wmo)) {
    suggestions.push({ icon: '🥾', text: 'Botas impermeables' });
    suggestions.push({ icon: '🧣', text: 'Ropa térmica' });
  }
  suggestions.push({ icon: '🔌', text: 'Cargador de celular' });
  suggestions.push({ icon: '💧', text: 'Botella de agua' });
  suggestions.push({ icon: '📄', text: 'Documentos' });
  return suggestions;
}

// ══════════════════════════════════════
// INIT — migrate & sanitize old data
// ══════════════════════════════════════

// Cargar country codes para ciudades existentes usando geocodificación
async function loadCountryCodesForExistingCities() {
  // Clave para guardar los country codes ya procesados
  const PROCESSED_KEY = 'wandr_country_codes_processed';
  const processedCities = JSON.parse(localStorage.getItem(PROCESSED_KEY) || '{}');
  
  const citiesWithoutCode = [];
  
  // Buscar ciudades sin countryCode Y que no hayan sido procesadas antes
  trips.forEach(trip => {
    (trip.cities || []).forEach(city => {
      // Si ya tiene countryCode O ya fue procesada antes, saltar
      if (city.countryCode || processedCities[city.id]) {
        return;
      }
      
      // Ciudad sin countryCode y no procesada antes
      // Prioridad 1: coordenadas del hotel
      if (city.hotelLat && city.hotelLon) {
        citiesWithoutCode.push({ city, trip, source: 'hotel' });
      } else {
        // Prioridad 2: coordenadas de stops
        const firstStopWithCoords = (city.days || []).flatMap(d => d.stops || []).find(s => s.lat && s.lon);
        if (firstStopWithCoords) {
          citiesWithoutCode.push({ city, trip, source: 'stop', lat: firstStopWithCoords.lat, lon: firstStopWithCoords.lon });
        } else {
          // Prioridad 3: buscar por nombre de ciudad
          citiesWithoutCode.push({ city, trip, source: 'name' });
        }
      }
    });
  });

  if (citiesWithoutCode.length === 0) {
    return;
  }

  // Iniciar loading
  isLoadingCountryCodes = true;
  if (currentTripId) {
    renderDetail();
  }
  
  let changed = false;
  
  for (let i = 0; i < citiesWithoutCode.length; i++) {
    const { city, trip, source, lat, lon } = citiesWithoutCode[i];
    let countryCode = null;
    let delay = 1000;

    try {
      if (source === 'name') {
        // Buscar por nombre de ciudad
        const data = await searchAllGeocoders(city.name);
        if (data && data.length > 0 && data[0].country_code) {
          countryCode = data[0].country_code;
          // También guardar coordenadas si no tiene
          if (!city.hotelLat && data[0].lat) {
            city.hotelLat = parseFloat(data[0].lat);
            city.hotelLon = parseFloat(data[0].lon);
          }
        }
      } else {
        // Reverse geocoding por coordenadas
        const coordLat = lat || city.hotelLat;
        const coordLon = lon || city.hotelLon;
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${coordLat}&lon=${coordLon}&format=json`,
          { headers: { 'User-Agent': 'Wandr/1.0 (https://wandr.travel; contact@wandr.travel)' } }
        );
        const json = await res.json();
        if (json?.address?.country_code) {
          countryCode = json.address.country_code;
        }
      }
    } catch(e) {
      /* silently ignore country code errors */
    }

    if (countryCode) {
      city.countryCode = countryCode;
      processedCities[city.id] = true;
      changed = true;
    } else {
      // Marcar como procesada aunque no se haya obtenido código (para no reintentar)
      processedCities[city.id] = true;
    }

    // Rate limiting
    if (i < citiesWithoutCode.length - 1) {
      await new Promise(r => setTimeout(r, delay));
    }
  }

  // Guardar el registro de ciudades procesadas
  localStorage.setItem(PROCESSED_KEY, JSON.stringify(processedCities));
  
  // Guardar trips si hubo cambios
  if (changed) {
    save();
  }
  
  // Terminar loading y re-renderizar si estamos en detail
  isLoadingCountryCodes = false;
  if (currentTripId) {
    renderDetail();
  }
  
  if (changed) save();
}

// INIT — migrate & sanitize old data
// ══════════════════════════════════════
function sanitizeTrips(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter(t => t && t.id && t.name).map(t => {
    // Apply full sanitization using the new function
    const sanitized = sanitizeTripData({
      id: t.id,
      name: t.name,
      startDate: t.startDate,
      endDate: t.endDate,
      cities: t.cities,
      tickets: t.tickets
    });
    
    // Old format: trip had city/hotel directly, no cities array
    if (!Array.isArray(t.cities)) {
      const city = {
        id: uid(),
        name: t.city || 'Ciudad',
        hotelName: t.hotelName || '',
        hotelAddr: t.hotelAddr || '',
        startDate: t.startDate,
        endDate: t.endDate,
        days: Array.isArray(t.days) ? t.days : buildDays(t.startDate, t.endDate)
      };
      return { 
        id: t.id, 
        name: sanitized.name || t.name, 
        startDate: t.startDate, 
        endDate: t.endDate, 
        cities: [city], 
        tickets: [] 
      };
    }
    
    // Ensure each city has valid days matching its own date range, preserving stops
    sanitized.cities = (t.cities || []).filter(ci => ci && ci.startDate && ci.endDate).map(ci => {
      const stopsMap = {};
      (ci.days || []).forEach(d => {
        if (d && d.date && Array.isArray(d.stops) && d.stops.length) {
          // Deep-sanitize each stop: ensure required fields exist and are safe strings
          const cleanStops = d.stops
            .filter(s => s && typeof s === 'object' && s.name)
            .map(s => ({
              id:        (typeof s.id === 'string' && s.id)        ? s.id        : uid(),
              name:      sanitizeInput(s.name, 200),
              address:   sanitizeAddress(s.address, 300),
              note:      sanitizeNote(s.note, 500),
              timeFrom:  typeof s.timeFrom  === 'string' ? s.timeFrom  : '',
              timeTo:    typeof s.timeTo    === 'string' ? s.timeTo    : '',
              type:      ['attraction','restaurant','museum','park','hotel'].includes(s.type) ? s.type : 'attraction',
              transport: ['walking','transit','taxi','driving'].includes(s.transport) ? s.transport : 'walking',
              lat:       typeof s.lat === 'number' ? s.lat : null,
              lon:       typeof s.lon === 'number' ? s.lon : null,
              order:     typeof s.order === 'number' ? s.order : 0,
            }));
          if (cleanStops.length) stopsMap[d.date] = cleanStops;
        }
      });
      ci.days = buildDays(ci.startDate, ci.endDate).map(d => ({
        date: d.date, stops: stopsMap[d.date] || []
      }));
      // Preserve hotel coordinates
      if (typeof ci.hotelLat === 'number') ci.hotelLat = ci.hotelLat;
      if (typeof ci.hotelLon === 'number') ci.hotelLon = ci.hotelLon;
      // Sanitize city fields
      ci.name = sanitizeCityName(ci.name);
      if (ci.hotelName) ci.hotelName = sanitizeInput(ci.hotelName, 80);
      if (ci.hotelAddr) ci.hotelAddr = sanitizeAddress(ci.hotelAddr);
      return ci;
    });
    if (!Array.isArray(sanitized.tickets)) sanitized.tickets = [];
    return sanitized;
  });
}

const _sanitized = sanitizeTrips(_rawTripsFromStorage);
// Only overwrite stored data if sanitization actually produced something useful,
// or if the original was already empty. This prevents a parse/sanitize bug from
// wiping all user data by replacing it with an empty array.
if (_rawTripsFromStorage.length === 0 || _sanitized.length > 0) {
  trips = _sanitized;
  // Only call save() if something actually changed to avoid unnecessary writes
  if (JSON.stringify(trips) !== JSON.stringify(_rawTripsFromStorage)) {
    save();
  }
} else {
  // Sanitization returned empty but original had data — keep original
  trips = _rawTripsFromStorage;
}
_rawTripsFromStorage = null; // free reference

// Cargar country codes para ciudades existentes que no lo tienen
loadCountryCodesForExistingCities();

renderTrips();
initTheme();
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  // Reload the page automatically when a new SW version takes control
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type === 'SW_UPDATED') {
      window.location.reload();
    }
  });
}

// ══════════════════════════════════════
// ADDRESS AUTOCOMPLETE (Nominatim/OSM)
// ══════════════════════════════════════
let _acTimer = null;
let _acAbort = null;
// Safe store for autocomplete results — avoids injecting values into inline handlers
const _acResults = {};

function addrAutocomplete(input, listId) {
  const q = input.value.trim();
  const list = document.getElementById(listId);
  if (!list) return;

  clearTimeout(_acTimer);
  if (q.length < 3) { hideList(listId); return; }

  list.innerHTML = '<li class="ac-loading">Buscando...</li>';
  list.classList.add('open');

  _acTimer = setTimeout(async () => {
    try {
      if (_acAbort) _acAbort.abort();
      _acAbort = new AbortController();
      const data = await searchAllGeocoders(q);
      
      if (!data || data.length === 0) {
        list.innerHTML = '<li class="ac-loading">Sin resultados</li>';
        return;
      }
      
      // Guardar resultados completos incluyendo lat/lon
      _acResults[listId] = data;
      
      list.innerHTML = data.map((r, i) => {
        const parts = r.display_name.split(',');
        const main = parts[0].trim();
        const sub = parts.slice(1, 4).join(',').trim();
        return `<li data-ac-index="${i}" data-ac-list="${esc(listId)}">
          <div class="ac-main">${esc(main)}</div>
          <div class="ac-sub">${esc(sub)}</div>
        </li>`;
      }).join('');
      // Attach events via JS, not inline handlers
      list.querySelectorAll('li[data-ac-index]').forEach(li => {
        li.addEventListener('mousedown', () => {
          const idx = parseInt(li.dataset.acIndex, 10);
          const lId = li.dataset.acList;
          pickAddr(lId, idx);
        });
        li.addEventListener('touchstart', (e) => {
          e.preventDefault();
          const idx = parseInt(li.dataset.acIndex, 10);
          const lId = li.dataset.acList;
          pickAddr(lId, idx);
        }, { passive: false });
      });
    } catch(e) {
      if (e.name !== 'AbortError') list.innerHTML = '<li class="ac-loading">Error al buscar</li>';
    }
  }, 350);
}

function pickAddr(listId, index) {
  const list = document.getElementById(listId);
  if (!list) return;
  const result = (_acResults[listId] || [])[index];
  if (!result) return;
  
  // Find the input that owns this list
  const wrap = list.closest('.autocomplete-wrap');
  if (wrap) {
    const input = wrap.querySelector('input[type="text"]');
    if (input) input.value = result.display_name;
    
    // Guardar coordenadas en campos ocultos si existen
    const latInput = wrap.querySelector('input[type="hidden"][id$="-lat"]');
    const lonInput = wrap.querySelector('input[type="hidden"][id$="-lon"]');
    if (latInput) latInput.value = result.lat || '';
    if (lonInput) lonInput.value = result.lon || '';
  }
  hideList(listId);
}

function hideList(listId) {
  setTimeout(() => {
    const list = document.getElementById(listId);
    if (list) list.classList.remove('open');
  }, 150);
}

// ══════════════════════════════════════
// TIME PICKER MODAL (drag + transform, works)
// ══════════════════════════════════════
const _TP_ITEM_H = 40;
let _tpTargetId = null;

class TpColumn {
  constructor(elId, count) {
    this.el = document.getElementById(elId);
    this.count = count;
    this.value = 0;
    this.offset = 0;
    this.dragging = false;
    this.startY = 0;
    this.startOffset = 0;
    this._onMove = this._move.bind(this);
    this._onEnd = this._end.bind(this);
  }

  build(startVal) {
    this.el.innerHTML = '';
    // 7 cycles: -3 to +3
    for (let c = -3; c <= 3; c++) {
      for (let i = 0; i < this.count; i++) {
        const item = document.createElement('div');
        item.className = 'tp-item';
        item.textContent = String(i).padStart(2, '0');
        item.dataset.value = i;
        this.el.appendChild(item);
      }
    }
    this.setPosition(startVal);
    this.el.addEventListener('mousedown', (e) => this._start(e));
    this.el.addEventListener('touchstart', (e) => this._start(e), { passive: true });
    document.addEventListener('mousemove', this._onMove);
    document.addEventListener('touchmove', this._onMove, { passive: false });
    document.addEventListener('mouseup', this._onEnd);
    document.addEventListener('touchend', this._onEnd);
    this.el.addEventListener('wheel', (e) => this._wheel(e), { passive: false });
  }

  setPosition(val) {
    const itemIndex = 3 * this.count + val;
    // Center the item: offset = itemPos - (containerHalf - itemHalf)
    this.offset = itemIndex * _TP_ITEM_H - 80;
    this.value = val;
    this.el.style.transform = `translateY(-${this.offset}px)`;
    this.el.style.transition = 'none';
  }

  _start(e) {
    this.dragging = true;
    this.startY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
    this.startOffset = this.offset;
    this.el.style.transition = 'none';
  }

  _move(e) {
    if (!this.dragging) return;
    if (e.type === 'touchmove') e.preventDefault();
    const y = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
    const diff = y - this.startY;
    this.offset = this.startOffset - diff;
    this.el.style.transform = `translateY(-${this.offset}px)`;
  }

  _end() {
    if (!this.dragging) return;
    this.dragging = false;
    this._snap();
  }

  _wheel(e) {
    e.preventDefault();
    this.offset += e.deltaY > 0 ? _TP_ITEM_H : -_TP_ITEM_H;
    this.el.style.transition = 'none';
    this.el.style.transform = `translateY(-${this.offset}px)`;
    setTimeout(() => this._snap(), 150);
  }

  _snap() {
    // Reverse the offset calculation: itemIndex = (offset + 80) / 40
    const closestIdx = Math.round((this.offset + 80) / _TP_ITEM_H);
    const cycleIdx = Math.floor(closestIdx / this.count);
    let valIdx = closestIdx % this.count;
    if (valIdx < 0) valIdx = this.count + valIdx;

    this.value = valIdx;
    this.offset = closestIdx * _TP_ITEM_H - 80;

    this.el.style.transition = 'transform 0.3s cubic-bezier(0.34,1.56,0.64,1)';
    this.el.style.transform = `translateY(-${this.offset}px)`;

    // Reset to center cycle if drifted too far
    setTimeout(() => {
      if (cycleIdx < 1 || cycleIdx > 5) {
        this.setPosition(this.value);
      }
    }, 300);
  }

  getValue() { return this.value; }
}

let _tpHour, _tpMin;

function openTimePicker(targetId) {
  _tpTargetId = targetId;
  const el = document.getElementById(targetId);
  const currentVal = el ? (el.dataset.value || '') : '';

  const h = currentVal ? parseInt(currentVal.split(':')[0], 10) : 0;
  const m = currentVal ? parseInt(currentVal.split(':')[1], 10) : 0;
  const hIdx = isNaN(h) ? 0 : h;
  const mIdx = isNaN(m) ? 0 : m;

  _tpHour = new TpColumn('tp-hour', 24);
  _tpMin = new TpColumn('tp-min', 60);
  _tpHour.build(hIdx);
  _tpMin.build(mIdx);

  openModal('modal-time-picker');
}

function closeTimePicker() {
  closeModal('modal-time-picker');
  _tpTargetId = null;
}

function confirmTimePicker() {
  if (!_tpTargetId || !_tpHour || !_tpMin) return;
  const h = String(_tpHour.getValue()).padStart(2, '0');
  const m = String(_tpMin.getValue()).padStart(2, '0');
  const val = `${h}:${m}`;
  const el = document.getElementById(_tpTargetId);
  if (el) {
    el.dataset.value = val;
    el.textContent = val;
    el.classList.add('has-value');
  }
  closeModal('modal-time-picker');
  _tpTargetId = null;
}

// Public API
function getWheelTime(id) {
  const el = document.getElementById(id);
  return el ? (el.dataset.value || '') : '';
}

function setWheelTime(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.dataset.value = value || '';
  el.textContent = value || '--:--';
  el.classList.toggle('has-value', !!value);
}

function _buildTpItems(count, fmt, copies, startVal) {
  // Build copies starting from startVal so it appears first
  // Structure: pad + pad + [startVal, startVal+1, ..., count-1, 0, 1, ..., startVal-1] × copies + pad + pad
  let html = '<div class="tp-item" style="visibility:hidden;pointer-events:none">&nbsp;</div>';
  html += '<div class="tp-item" style="visibility:hidden;pointer-events:none">&nbsp;</div>';
  for (let c = 0; c < copies; c++) {
    for (let i = 0; i < count; i++) {
      const val = (startVal + i) % count;
      html += `<div class="tp-item" data-val="${val}">${fmt(val)}</div>`;
    }
  }
  html += '<div class="tp-item" style="visibility:hidden;pointer-events:none">&nbsp;</div>';
  html += '<div class="tp-item" style="visibility:hidden;pointer-events:none">&nbsp;</div>';
  return html;
}

function _tpGetActiveIndex(col, count) {
  const viewportCenter = col.scrollTop + col.clientHeight / 2;
  const items = col.querySelectorAll('.tp-item[data-val]');
  let best = 0;
  let bestDist = Infinity;
  items.forEach(item => {
    const itemCenter = item.offsetTop + item.offsetHeight / 2;
    const dist = Math.abs(viewportCenter - itemCenter);
    if (dist < bestDist) {
      bestDist = dist;
      best = parseInt(item.dataset.val, 10);
    }
  });
  return best;
}

function _tpEnforceBound(col, count) {
  // No-op: with 5 copies there's enough room
}

function _tpUpdateActiveStates() {
  const hourCol = document.getElementById('tp-hour');
  const minCol  = document.getElementById('tp-min');
  if (!hourCol || !minCol) return;
  
  const h = _tpHour ? _tpHour.getValue() : 0;
  const m = _tpMin ? _tpMin.getValue() : 0;

  hourCol.querySelectorAll('.tp-item').forEach(item => {
    item.classList.toggle('tp-active', parseInt(item.dataset.value, 10) === h);
  });
  minCol.querySelectorAll('.tp-item').forEach(item => {
    item.classList.toggle('tp-active', parseInt(item.dataset.value, 10) === m);
  });
}

function closeTimePicker() {
  closeModal('modal-time-picker');
  _tpTargetId = null;
  _tpHour = null;
  _tpMin = null;
}

function confirmTimePicker() {
  if (!_tpTargetId || !_tpHour || !_tpMin) return;
  
  const h = String(_tpHour.getValue()).padStart(2, '0');
  const m = String(_tpMin.getValue()).padStart(2, '0');
  const val = `${h}:${m}`;

  const el = document.getElementById(_tpTargetId);
  if (el) {
    el.dataset.value = val;
    el.textContent = val;
    el.classList.add('has-value');
  }
  closeTimePicker();
  showToast(`Hora seleccionada: ${val}`);
}

// Public API: get/set time
function getWheelTime(id) {
  const el = document.getElementById(id);
  return el ? (el.dataset.value || '') : '';
}

function setWheelTime(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.dataset.value = value || '';
  el.textContent = value || '--:--';
  el.classList.toggle('has-value', !!value);
}
