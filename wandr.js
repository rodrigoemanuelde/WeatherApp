
// ══════════════════════════════════════
// STATE
// ══════════════════════════════════════
const _initialUiState = window.WandrState.createInitialUiState();
let _rawTripsFromStorage = window.WandrStorage.loadTrips();
const appStore = window.WandrState.createAppStore({
  trips: _rawTripsFromStorage,
  ui: _initialUiState
});
window.WandrState.bindStateGlobals(window, appStore, [
  'currentTripId',
  'currentCityIdx',
  'currentDayIdx',
  'selectedType',
  'selectedTransport',
  'currentDetailTab',
  'isLoadingCountryCodes',
  'selectedTicketType',
  'editingTicketId',
  '_pendingDeleteTicketId',
  '_pendingDeleteCityId',
  'editingStopId',
  '_routeSeparatorRenderToken',
  '_originalStopOrder'
]);
const OSRM_ROUTE_CACHE_KEY = 'wandr_osrm_route_cache_v1';
const OSRM_ROUTE_CACHE_TTL = 24 * 60 * 60 * 1000;
const _routeMetricsCache = window.WandrStorage.loadRouteMetricsCache();
const _routeMetricsInflight = new Map();
let _weatherCache = {};
// Initialize weather cache from storage
const weatherEntries = window.WandrStorage.listWeatherCacheEntries();
_weatherCache = weatherEntries.reduce((acc, entry) => {
  acc[entry.cityId] = entry.value;
  return acc;
}, {});
window._weatherCache = _weatherCache;
let _weatherPrefetching = false;

// Import routing module
const TSPSolver = window.Wandr.Routing.TSPSolver;
const RoutingMetrics = window.Wandr.Routing.RoutingMetrics;
const RouteState = window.Wandr.Routing.RouteState;

// Import cities module
const cityWizard = window.Wandr.Cities.createCityWizardStore();

// Add syncFromDOM helper (specific to modal UI interaction)
cityWizard.syncFromDOM = function() {
  this.setState(s => {
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
};

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
// SAFE ACCESSORS
// ══════════════════════════════════════
function getCurrentTrip() {
  if (!currentTripId) return null;
  return trips.find(t => t.id === currentTripId) || null;
}

function getCurrentCity() {
  const trip = getCurrentTrip();
  if (!trip) return null;
  if (currentCityIdx == null || currentCityIdx < 0) return null;
  return trip.cities?.[currentCityIdx] || null;
}

function getCurrentDay() {
  const city = getCurrentCity();
  if (!city) return null;
  if (currentDayIdx == null || currentDayIdx < 0) return null;
  return city.days?.[currentDayIdx] || null;
}

// ══════════════════════════════════════
// SCREENS
// ══════════════════════════════════════
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const screenEl = safeGet('screen-' + name);
  if (screenEl) screenEl.classList.add('active');
  if (name === 'trips') {
    const btnAddStop = safeGet('btn-add-stop');
    const btnNewTrip = safeGet('btn-new-trip');
    if (btnAddStop) btnAddStop.classList.remove('visible');
    if (btnNewTrip) btnNewTrip.style.display = '';
    renderTrips();
  } else {
    const showFab = currentDetailTab === 'itinerary';
    const btnAddStop = safeGet('btn-add-stop');
    const btnNewTrip = safeGet('btn-new-trip');
    if (btnAddStop) btnAddStop.classList.toggle('visible', showFab);
    if (btnNewTrip) btnNewTrip.style.display = 'none';
  }
}
function goBack() { showScreen('trips'); }
function goHome() {
  const screenTrips = safeGet('screen-trips');
  if (screenTrips && screenTrips.classList.contains('active')) {
    window.scrollTo(0, 0);
  } else {
    showScreen('trips');
  }
}

// ══════════════════════════════════════
// TRIPS LIST
// ══════════════════════════════════════
function renderTripsLegacy() {
  const c = document.getElementById('trips-container');
  if (!trips?.length) {
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

function renderTrips() {
  const c = document.getElementById('trips-container');
  const today = new Date().toISOString().slice(0, 10);

  if (!trips?.length) {
    c.innerHTML = `<section class="trips-hero trips-hero-empty">
      <div class="trips-hero-copy">
        <span class="eyebrow">Organiza mejor</span>
        <h1>Tu proximo viaje empieza aca</h1>
        <p>Guarda ciudades, hoteles, pasajes y planes diarios en una sola vista.</p>
      </div>
    </section>
    <div class="empty-state empty-state-rich">
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
    ? `Se eliminarán ${trip.cities.length} ciudad${trip.cities.length!==1?'es':''} y ${totalStops} parada${totalStops!==1?'s':''}. Esta accion no se puede deshacer.`
    : 'Este viaje no tiene paradas cargadas. Esta accion no se puede deshacer.';
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

function confirmRemoveCityEntry() {
  const id = _pendingRemoveCityId;
  _pendingRemoveCityId = null;
  if (!id) return;
  cityWizard.removeCityEntry(id);
  closeModal('modal-confirm-remove-city-entry');
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
  // Use store action; returns false if legs exist (caller shows delete modal)
  const hasLegs = !cityWizard.toggleTransitLegs(fromId, toId);
  if (hasLegs) {
    // Store has existing legs; ask user to delete
    _pendingTransitLegKey = fromId + '_' + toId;
    openModal('modal-confirm-delete-transit');
  } else {
    renderCityEntries();
    syncCityMins();
  }
}

function addTransitLeg(fromId, toId) {
  cityWizard.addTransitLeg(fromId, toId);
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
  document.getElementById('confirm-delete-transit-leg-body').textContent = 'Se eliminará este tramo de viaje. Esta accion no se puede deshacer.';
  openModal('modal-confirm-delete-transit-leg');
}

function confirmRemoveTransitLeg() {
  if (!_pendingTransitLegRemove) return;
  const { fromId, toId, idx } = _pendingTransitLegRemove;
  _pendingTransitLegRemove = null;
  cityWizard.removeTransitLeg(fromId, toId, idx);
  closeModal('modal-confirm-delete-transit-leg');
  renderCityEntries();
  syncCityMins();
}

function setLegType(fromId, toId, idx, type) {
  cityWizard.setLegType(fromId, toId, idx, type);
  renderCityEntries();
  syncCityMins();
}

function updateLegField(fromId, toId, idx, field, value) {
  cityWizard.updateLegField(fromId, toId, idx, field, value);
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

  // Validate all cities before building trip
  const citiesData = [];
  for (let i = 0; i < state.cityEntries.length; i++) {
    const id = state.cityEntries[i];
    const entry = state.cityEntryState[id] || {};
    const cityName = (entry.name || '').trim();

    if (!cityName) { showToast(`⚠️ Ingresá el nombre de la ciudad ${i + 1}`); return; }

    // Validate city date range
    const validation = window.Wandr.Cities.validateCityDateRange({
      name: cityName,
      start: entry.start || '',
      end: entry.end || ''
    });
    if (!validation.valid) {
      showToast(`⚠️ ${cityName}: ${validation.reason}`);
      return;
    }

    citiesData.push({
      name: cityName,
      start: entry.start,
      end: entry.end,
      startDate: entry.start < start ? start : entry.start,
      endDate: entry.end > end ? end : entry.end
    });
  }

  // Validate no overlaps in cities
  const overlapCheck = window.Wandr.Cities.validateCityOverlap(citiesData);
  if (!overlapCheck.valid) {
    const conflict = overlapCheck.conflicts[0];
    if (conflict) {
      const city1 = citiesData[conflict.idx1];
      const city2 = citiesData[conflict.idx2];
      showToast(`⚠️ Las fechas de "${city1.name}" se solapan con "${city2.name}"`);
    }
    return;
  }

  // Use cities module to build trip from wizard state
  const trip = window.Wandr.Cities.buildTripFromWizardState(state, {
    name,
    startDate: start,
    endDate: end
  });

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

// ══════════════════════════════════════
// TRIP DETAIL
// ══════════════════════════════════════
function openTrip(id) {
  appStore.openTrip(id);
  showScreen('detail');
  switchDetailTab('itinerary');
  renderDetail();
  renderTickets();
}

function switchDetailTab(tab) {
  appStore.setDetailTab(tab);
  const dtabItinerary = safeGet('dtab-itinerary');
  const dtabOverview = safeGet('dtab-overview');
  const dtabTickets = safeGet('dtab-tickets');
  const detailContent = safeGet('detail-content');
  const overviewContent = safeGet('overview-content');
  const ticketsContent = safeGet('tickets-content');
  const btnAddStop = safeGet('btn-add-stop');
  
  if (dtabItinerary) dtabItinerary.classList.toggle('active', tab === 'itinerary');
  if (dtabOverview) dtabOverview.classList.toggle('active', tab === 'overview');
  if (dtabTickets) dtabTickets.classList.toggle('active', tab === 'tickets');
  if (detailContent) detailContent.style.display = tab === 'itinerary' ? 'block' : 'none';
  if (overviewContent) overviewContent.style.display = tab === 'overview' ? 'block' : 'none';
  if (ticketsContent) ticketsContent.style.display = tab === 'tickets' ? 'block' : 'none';
  if (btnAddStop) btnAddStop.style.display = tab === 'itinerary' ? '' : 'none';
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
      const weatherHtml = window.Wandr && window.Wandr.WeatherService ? window.Wandr.WeatherService.buildWeatherChipHtml(weatherData) : '';
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

function renderDetail() {
  return window.WandrRender.Detail.renderDetail();
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
  const dateTimeStr1 = date1 + 'T' + (time1 || '00:00');
  const dateTimeStr2 = date2 + 'T' + (time2 || '00:00');
  const t1 = new Date(dateTimeStr1);
  const t2 = new Date(dateTimeStr2);
  if (isNaN(t1.getTime()) || isNaN(t2.getTime())) return null;
  const diff = t2 - t1;
  if (diff < 0) return null;
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
  appStore.beginAddTicket();
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
  appStore.beginEditTicket(ticketId, tk.type || null);
  document.getElementById('ticket-modal-title').textContent = '🎫 Editar pasaje';
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
  appStore.setSelectedTicketType(type);
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
  appStore.markTicketPendingDelete(ticketId);
  document.getElementById('confirm-delete-ticket-body').textContent =
    `${ticketTypeLabel(tk.type)} ${esc(tk.fromCity)} → ${esc(tk.toCity)}${tk.depDate ? ', ' + formatDate(tk.depDate) : ''}. Esta accion no se puede deshacer.`;
  openModal('modal-confirm-delete-ticket');
}

function confirmDeleteTicket() {
  const trip = trips.find(t => t.id === currentTripId);
  if (!trip || !_pendingDeleteTicketId) return;
  trip.tickets = (trip.tickets || []).filter(t => t.id !== _pendingDeleteTicketId);
  appStore.clearPendingDeleteTicket();
  save();
  closeModal('modal-confirm-delete-ticket');
  renderTickets();
  renderDetail();
  showToast('🗑️ Pasaje eliminado');
}

function deleteCity(cityId) {
  const trip = trips.find(t => t.id === currentTripId);
  if (!trip || trip.cities.length <= 1) { showToast('⚠️ El viaje debe tener al menos una ciudad'); return; }
  const city = trip.cities.find(c => c.id === cityId);
  if (!city) return;
  appStore.markCityPendingDelete(cityId);
  const totalStops = city.days.reduce((a, d) => a + d.stops.length, 0);
  document.getElementById('confirm-delete-city-title').textContent = `¿Eliminar ${city.name}?`;
  document.getElementById('confirm-delete-city-body').textContent = totalStops > 0
    ? `Se eliminarán también los ${totalStops} punto${totalStops!==1?'s':''} del itinerario de esta ciudad. Esta accion no se puede deshacer.`
    : 'Esta ciudad no tiene paradas cargadas. Esta accion no se puede deshacer.';
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
  appStore.syncAfterCityDeletion(trip.cities.length);
  currentDayIdx = 0; // Always reset day index — it may no longer be valid for the new city
  appStore.clearPendingDeleteCity();
  save();
  closeModal('modal-confirm-delete-city');
  closeModal('modal-edit-city-name');
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
      ci.days = window.Wandr.Cities.buildDays(ciStart, ciEnd).map(d => ({ ...d, stops: stopsMap[d.date] || [] }));
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

function removeCityEntry(id) {
  const state = cityWizard.getState();
  if (state.cityEntries.length <= 1) { showToast('Necesitas al menos una ciudad'); return; }
  const cityName = state.cityEntryState[id]?.name || 'esta ciudad';
  _pendingRemoveCityId = id;
  document.getElementById('confirm-remove-city-entry-msg').textContent = `Eliminar "${cityName}". Esta accion no se puede deshacer.`;
  openModal('modal-confirm-remove-city-entry');
}

function confirmDeleteCityFromModalLegacy() {
  const trip = trips.find(t => t.id === currentTripId);
  if (!trip || _editingCityIndex === null) return;

  const city = trip.cities[_editingCityIndex];
  document.getElementById('confirm-delete-city-title').textContent = `¿Eliminar ${city.name}?`;
  document.getElementById('confirm-delete-city-body').textContent = 'Se eliminarán todos los días y paradas de esta ciudad. Esta accion no se puede deshacer.';
  openModal('modal-confirm-delete-city');
}

function openDeleteCityFromEditModalLegacy(cityIndex) {
  const trip = trips.find(t => t.id === currentTripId);
  if (!trip || cityIndex === null) return;

  const city = trip.cities[cityIndex];
  _editingCityIndex = cityIndex;
  _editingCityId = city.id;

  document.getElementById('confirm-delete-city-title').textContent = `¿Eliminar ${city.name}?`;
  document.getElementById('confirm-delete-city-body').textContent = 'Se eliminarán todos los días y paradas de esta ciudad. Esta accion no se puede deshacer.';
  openModal('modal-confirm-delete-city');
}

function confirmDeleteCityFromModal() {
  const trip = trips.find(t => t.id === currentTripId);
  if (!trip || _editingCityIndex === null) return;

  const city = trip.cities[_editingCityIndex];
  appStore.markCityPendingDelete(city.id);
  document.getElementById('confirm-delete-city-title').textContent = `¿Eliminar ${city.name}?`;
  document.getElementById('confirm-delete-city-body').textContent = 'Se eliminarán todos los días y paradas de esta ciudad. Esta accion no se puede deshacer.';
  openModal('modal-confirm-delete-city');
}

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
  const trip = getCurrentTrip();
  if (!trip) return;
  const city = getCurrentCity();
  if (!city) return;
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
      const dayIdx = city.days.findIndex(d => d.date === dateStr);
      appStore.selectCityDay(cityIdx, dayIdx);
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
  const trip = getCurrentTrip();
  if (!trip) return;
  const city = getCurrentCity();
  if (!city) return;
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
  city.days = window.Wandr.Cities.buildDays(newStart, newEnd).map(d =>
    existingByDate[d.date] ? existingByDate[d.date] : d
  );
  city.startDate = newStart;
  city.endDate = newEnd;

  // Also extend trip global dates if city goes beyond them
  if (newStart < trip.startDate) trip.startDate = newStart;
  if (newEnd > trip.endDate) trip.endDate = newEnd;

  appStore.ensureCurrentDayInRange(city.days.length);
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
  const trip = getCurrentTrip();
  if (!trip) return;
  const city = getCurrentCity();
  if (!city) return;
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
  const trip = getCurrentTrip();
  if (!trip) return;
  const city = getCurrentCity();
  if (!city) return;
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
    days: window.Wandr.Cities.buildDays(cs, ce),
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
  appStore.selectCityDay(trip.cities.findIndex(c => c.id === newCity.id), 0);
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
  const day = getCurrentDay();
  if (!day) return;
  const stop = day.stops?.find(s => s.id === stopId);
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
    resultsEl.innerHTML = data.map((place, index) => 
      `<li data-place-index="${index}">
        <strong>${esc(place.display_name.split(',')[0])}</strong><br>
        <small>${esc(place.display_name.split(',').slice(1, 4).join(','))}</small>
      </li>`
    ).join('');
    
    // Attach click event listeners to the list items
    const listItems = resultsEl.querySelectorAll('li[data-place-index]');
    listItems.forEach(item => {
      item.addEventListener('click', () => {
        const index = parseInt(item.getAttribute('data-place-index'));
        const place = data[index];
        selectStopAddress(place.display_name, place.lat, place.lon);
      });
    });
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
    resultsEl.innerHTML = data.map((place, index) => 
      `<li data-place-index="${index}" data-input-id="${inputId}">
        <strong>${esc(place.display_name.split(',')[0])}</strong><br>
        <small>${esc(place.display_name.split(',').slice(1, 4).join(','))}</small>
      </li>`
    ).join('');
    
    // Attach click event listeners to the list items
    const listItems = resultsEl.querySelectorAll('li[data-place-index]');
    listItems.forEach(item => {
      item.addEventListener('click', () => {
        const index = parseInt(item.getAttribute('data-place-index'));
        const inputId = item.getAttribute('data-input-id');
        const place = data[index];
        selectTerminalAddress(place.display_name, place.lat, place.lon, inputId, inputId + '-results');
      });
    });
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

  const day = getCurrentDay();
  if (!day) return;
  const stops = day.stops || [];

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
  const day = getCurrentDay();
  const stop = day?.stops?.find(s => s.id === stopId);
  const stopName = stop?.name || 'esta parada';
  _pendingDeleteStopId = stopId;
  document.getElementById('confirm-delete-stop-title').textContent = `¿Eliminar "${stopName}"?`;
  document.getElementById('confirm-delete-stop-body').textContent = 'Esta accion no se puede deshacer.';
  openModal('modal-confirm-delete-stop');
}

function confirmDeleteStop() {
  const stopId = _pendingDeleteStopId;
  _pendingDeleteStopId = null;
  if (!stopId) return;
  const day = getCurrentDay();
  if (!day) return;
  day.stops = (day.stops || []).filter(s => s.id !== stopId);
  save();
  closeModal('modal-confirm-delete-stop');
  renderDetail();
  showToast('Parada eliminada');
}

function selectType(el, t) { selectedType = t; document.querySelectorAll('.type-option').forEach(e => e.classList.remove('selected')); el.classList.add('selected'); }
function selectTransport(el, t) { selectedTransport = t; document.querySelectorAll('.transport-option').forEach(e => e.classList.remove('selected')); el.classList.add('selected'); }

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

function safeGet(id) {
  if (!id) return null;
  return document.getElementById(id);
}
window.safeGet = safeGet;

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
    
    window.WandrStorage.saveTrips(trips);
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

// Validar import JSON trips data
function validateImportTrips(trips) {
  const errors = [];
  if (!Array.isArray(trips)) {
    errors.push('Trips no es un array');
    return errors;
  }
  
  trips.forEach((trip, idx) => {
    if (!trip.name) errors.push(`Trip ${idx + 1}: sin nombre`);
    if (!trip.startDate || !isValidDate(trip.startDate)) errors.push(`Trip ${idx + 1}: fecha inicio inválida`);
    if (!trip.endDate || !isValidDate(trip.endDate)) errors.push(`Trip ${idx + 1}: fecha fin inválida`);
    if (!Array.isArray(trip.cities)) errors.push(`Trip ${idx + 1}: cities no es array`);
  });
  
  return errors;
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
function osrmProfileForTransport(transport) {
  return ({ walking: 'foot', taxi: 'driving', driving: 'driving' })[transport] || null;
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

// Stage 1 bridge: keep global API stable while pure helpers live in js/utils and js/core.
({
  formatDate,
  getWeekday,
  getWeekdayFull,
  formatDistance,
  formatDurationFromSeconds,
  haversine,
  buildRouteCacheKey,
  estimateTravelTime,
  osrmProfileForTransport,
  googleMapsMode,
  transportClass,
  transportIcon,
  transportLabel
} = window.WandrUtils);

sanitizeInput = function (str, maxLen = MAX_STRING_LENGTH) {
  return window.WandrUtils.sanitizeInput(str, maxLen);
};

sanitizeCityName = function (str) {
  return window.WandrUtils.sanitizeCityName(str, MAX_CITY_NAME_LENGTH);
};

sanitizeAddress = function (str, maxLen = MAX_ADDRESS_LENGTH) {
  return window.WandrUtils.sanitizeAddress(str, maxLen);
};

sanitizeNote = function (str, maxLen = MAX_NOTE_LENGTH) {
  return window.WandrUtils.sanitizeNote(str, maxLen);
};

isValidCoord = function (lat, lon) {
  return window.WandrUtils.isValidCoord(lat, lon);
};

isValidDate = function (dateStr) {
  return window.WandrUtils.isValidDate(dateStr);
};

isValidTime = function (timeStr) {
  return window.WandrUtils.isValidTime(timeStr);
};

validateTripData = function (trip) {
  return window.WandrUtils.validateTripData(trip, {
    maxStringLength: MAX_STRING_LENGTH,
    maxTripNameLength: MAX_TRIP_NAME_LENGTH,
    maxCityNameLength: MAX_CITY_NAME_LENGTH,
    maxAddressLength: MAX_ADDRESS_LENGTH,
    maxStopsPerDay: MAX_STOPS_PER_DAY,
    maxCitiesPerTrip: MAX_CITIES_PER_TRIP,
    maxTicketsPerTrip: MAX_TICKETS_PER_TRIP
  });
};

sanitizeTripData = function (trip) {
  return window.WandrUtils.sanitizeTripData(trip, {
    maxStringLength: MAX_STRING_LENGTH,
    maxTripNameLength: MAX_TRIP_NAME_LENGTH,
    maxCityNameLength: MAX_CITY_NAME_LENGTH,
    maxAddressLength: MAX_ADDRESS_LENGTH,
    maxNoteLength: MAX_NOTE_LENGTH
  });
};

function persistRouteMetricsCache() {
  try {
    window.WandrStorage.saveRouteMetricsCache(_routeMetricsCache);
  } catch (e) {
    // Ignore cache persistence failures silently.
  }
}

function getCachedRouteMetrics(cacheKey) {
  const cached = _routeMetricsCache[cacheKey];
  if (!cached) return null;
  if ((Date.now() - cached.ts) > OSRM_ROUTE_CACHE_TTL) {
    delete _routeMetricsCache[cacheKey];
    persistRouteMetricsCache();
    return null;
  }
  return cached.data || null;
}

function setCachedRouteMetrics(cacheKey, data) {
  _routeMetricsCache[cacheKey] = { ts: Date.now(), data };
  persistRouteMetricsCache();
}

function formatDurationFromSeconds(seconds) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return '<1min';
  if (minutes < 60) return `${minutes}min`;
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hrs}h ${mins}min` : `${hrs}h`;
}

async function fetchRouteMetrics(fromLat, fromLon, toLat, toLon, transport) {
  const profile = osrmProfileForTransport(transport);
  if (!profile) return null;

  const cacheKey = buildRouteCacheKey(fromLat, fromLon, toLat, toLon, transport);
  const cached = getCachedRouteMetrics(cacheKey);
  if (cached) return cached;

  if (_routeMetricsInflight.has(cacheKey)) {
    return _routeMetricsInflight.get(cacheKey);
  }

  const request = fetch(
    `https://router.project-osrm.org/route/v1/${profile}/${fromLon},${fromLat};${toLon},${toLat}?overview=false`,
    { method: 'GET' }
  )
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
        distanceKm: route.distance / 1000,
        durationSeconds: route.duration
      };
      setCachedRouteMetrics(cacheKey, metrics);
      return metrics;
    })
    .catch(() => null)
    .finally(() => {
      _routeMetricsInflight.delete(cacheKey);
    });

  _routeMetricsInflight.set(cacheKey, request);
  return request;
}

function hydrateRouteSeparators(renderToken) {
  const detailRoot = document.getElementById('detail-content');
  if (!detailRoot) return;

  const trip = trips.find(t => t.id === currentTripId);
  if (!trip) return;
  const city = trip.cities[currentCityIdx] || trip.cities[0];
  if (!city || !city.days || !city.days[currentDayIdx]) return;

  const day = city.days[currentDayIdx];
  const stops = day.stops || [];
  const separators = Array.from(detailRoot.querySelectorAll('.stop-dist-separator-text[data-stop-id]'));

  separators.forEach(async el => {
    const stopId = el.dataset.stopId;
    const stopIndex = stops.findIndex(s => s.id === stopId);
    const stop = stopIndex >= 0 ? stops[stopIndex] : null;
    if (!stop || stop.transport === 'transit') return;

    const prevStop = stopIndex === 0 ? null : stops[stopIndex - 1];
    const fromLat = stopIndex === 0 ? Number(city.hotelLat) : Number(prevStop && prevStop.lat);
    const fromLon = stopIndex === 0 ? Number(city.hotelLon) : Number(prevStop && prevStop.lon);
    const toLat = Number(stop.lat);
    const toLon = Number(stop.lon);

    if (![fromLat, fromLon, toLat, toLon].every(Number.isFinite)) return;

    const profile = osrmProfileForTransport(stop.transport);
    if (!profile) return;

    const coordinates = [[fromLat, fromLon], [toLat, toLon]];

    const metrics = await RoutingMetrics.fetch(coordinates, profile);
    if (!metrics || renderToken !== _routeSeparatorRenderToken) return;
    if (!document.body.contains(el)) return;

    const distanceText = formatDistance(metrics.distance);
    const timeText = formatDurationFromSeconds(metrics.duration);
    const label = transportLabel(stop.transport);
    const separatorText = `${distanceText} - ~${timeText} - ${label}`;
    el.textContent = `${distanceText} · ~${timeText} · ${label}`;
  });
}

function stopDistanceLegacy(a, b) {
  if (!a.lat || !a.lon || !b.lat || !b.lon) return Infinity;
  return haversine(a.lat, a.lon, b.lat, b.lon);
}

function totalRouteDistanceLegacy(stops, hotelLat, hotelLon) {
  let total = 0;
  let prev = { lat: hotelLat, lon: hotelLon };
  for (const stop of stops) {
    total += stopDistanceLegacy(prev, stop);
    prev = stop;
  }
  return total;
}

// Brute force: try all permutations (for ≤8 stops)
function bruteForceOptimalLegacy(stops, hotelLat, hotelLon) {
  if (stops.length <= 1) return [...stops];
  
  // Generate all permutations
  const indices = stops.map((_, i) => i);
  const perms = permuteLegacy(indices);
  
  let bestPerm = null;
  let bestDist = Infinity;
  
  for (const perm of perms) {
    const ordered = perm.map(i => stops[i]);
    const dist = totalRouteDistanceLegacy(ordered, hotelLat, hotelLon);
    if (dist < bestDist) {
      bestDist = dist;
      bestPerm = ordered;
    }
  }
  
  return bestPerm || [...stops];
}

function permuteLegacy(arr) {
  if (arr.length <= 1) return [arr];
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permuteLegacy(rest)) {
      result.push([arr[i], ...p]);
    }
  }
  return result;
}

// Nearest neighbor: greedy approach (for >8 stops)
function nearestNeighborOrderLegacy(stops, hotelLat, hotelLon) {
  if (stops.length <= 1) return [...stops];
  
  const remaining = [...stops];
  const ordered = [];
  let current = { lat: hotelLat, lon: hotelLon };
  
  while (remaining.length > 0) {
    let nearestIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = stopDistanceLegacy(current, remaining[i]);
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
function twoOptImproveLegacy(stops, hotelLat, hotelLon) {
  if (stops.length <= 2) return [...stops];
  
  let improved = [...stops];
  let improvedDist = totalRouteDistanceLegacy(improved, hotelLat, hotelLon);
  let changed = true;
  
  while (changed) {
    changed = false;
    for (let i = 0; i < improved.length - 1; i++) {
      for (let j = i + 1; j < improved.length; j++) {
        // Swap stops[i] and stops[j]
        const candidate = [...improved];
        [candidate[i], candidate[j]] = [candidate[j], candidate[i]];
        const candidateDist = totalRouteDistanceLegacy(candidate, hotelLat, hotelLon);
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

function optimizeCurrentStopsLegacy() {
  const trip = getCurrentTrip();
  if (!trip) return;
  const city = getCurrentCity();
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
    optimized = bruteForceOptimalLegacy(day.stops, hotelLat, hotelLon);
  } else {
    optimized = nearestNeighborOrderLegacy(day.stops, hotelLat, hotelLon);
    optimized = twoOptImproveLegacy(optimized, hotelLat, hotelLon);
  }
  
  day.stops = optimized;
  save();
  renderDetail();
}

function restoreStopOrderLegacy() {
  if (_originalStopOrder === null) return;
  const trip = getCurrentTrip();
  if (!trip) return;
  const city = getCurrentCity();
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
function formatDate(s) { if (!s) return ''; const d = new Date(s+'T00:00:00'); const days = ['dom','lun','mar','mié','jue','vie','sáb']; const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']; return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`; }
function getWeekday(s) { return new Date(s+'T00:00:00').toLocaleDateString('es-AR',{weekday:'short'}).slice(0,3); }
function getWeekdayFull(s) { return new Date(s+'T00:00:00').toLocaleDateString('es-AR',{weekday:'long'}).replace(/^\w/,c=>c.toUpperCase()); }

// ══════════════════════════════════════
// EXPORT / IMPORT
// ══════════════════════════════════════
let pendingImportData = null;

function exportTrips() {
  if (!trips?.length) { showToast('⚠️ No hay viajes para exportar'); return; }
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
      
      // Validate import JSON schema
      const validationErrors = validateImportTrips(data.trips);
      if (validationErrors.length > 0) {
        showToast('⚠️ Archivo contiene datos inválidos: ' + validationErrors.join(', ')); 
        return;
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
  const trip = getCurrentTrip();
  if (!trip) return;
  const city = getCurrentCity();
  if (!city) return;
  const day = city.days[currentDayIdx];
  if (!day || !day.stops || day.stops.length < 2) return;
  
  // Save original order
  RouteState.saveOriginalOrder(day.stops);
  
  const origin = { lat: city.hotelLat || 0, lon: city.hotelLon || 0 };
  
  // Optimize using new module
  const optimized = TSPSolver.optimize(day.stops, origin);
  
  day.stops = optimized;
  save();
  renderDetail();
  
  // Async hydrate metrics
  hydrateRouteSeparators();
}

function restoreStopOrder() {
  try {
    const original = RouteState.restoreOriginalOrder();
    const trip = getCurrentTrip();
    if (!trip) return;
    const city = getCurrentCity();
    if (!city) return;
    const day = city.days[currentDayIdx];
    if (!day) return;
    
    day.stops = original;
    save();
    renderDetail();
  } catch (error) {
    console.warn('No saved order to restore');
  }
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
// Weather utilities have been moved to window.Wandr.WeatherService
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
  window.WandrStorage.saveTheme(isLight ? 'light' : 'dark');
  document.getElementById('theme-icon-dark').style.display  = isLight ? 'none' : '';
  document.getElementById('theme-icon-light').style.display = isLight ? '' : 'none';
  document.getElementById('theme-label').textContent = isLight ? 'Oscuro' : 'Claro';
  document.querySelector('meta[name="theme-color"]').content = '#4A7BF7';
}

function initTheme() {
  const saved = window.WandrStorage.loadTheme();
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

// Extracted to js/core/weather.js. Old weather helpers are now provided by window.Wandr.WeatherService.

// ══════════════════════════════════════
// INIT — migrate & sanitize old data
// ══════════════════════════════════════

function saveToWeatherCacheLegacy(cityId, data) {
  try {
    window.WandrStorage.saveWeatherCache(cityId, { data, timestamp: Date.now() });
  } catch(e) { /* silently ignore cache errors */ }
}

function loadFromWeatherCacheLegacy(cityId) {
  try {
    const cached = window.WandrStorage.loadWeatherCache(cityId);
    if (!cached) return null;
    const { data, timestamp } = cached;
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

async function getCoordinatesForCityLegacy(city, trip) {
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

function getPackingSuggestionsLegacy(weatherDay) {
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

// Extracted to js/core/weather.js. Legacy helpers no longer live in wandr.js.

// ══════════════════════════════════════
// INIT — migrate & sanitize old data
// ══════════════════════════════════════

// Cargar country codes para ciudades existentes usando geocodificación
async function loadCountryCodesForExistingCities() {
  const processedCities = window.WandrStorage.loadProcessedCountryCodes();
  
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
  window.WandrStorage.saveProcessedCountryCodes(processedCities);
  
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
        days: Array.isArray(t.days) ? t.days : window.Wandr.Cities.buildDays(t.startDate, t.endDate)
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
      ci.days = window.Wandr.Cities.buildDays(ci.startDate, ci.endDate).map(d => ({
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
// Stage 3 bridge: keep legacy global API stable while screen renderers live in js/render.
if (window.WandrRender) {
  renderTrips = window.WandrRender.renderTrips || renderTrips;
  renderOverview = window.WandrRender.renderOverview || renderOverview;
  ovGoToDay = window.WandrRender.ovGoToDay || ovGoToDay;
  renderDetail = window.WandrRender.renderDetail || renderDetail;
  updateDayScrollFades = window.WandrRender.updateDayScrollFades || updateDayScrollFades;
  switchCity = window.WandrRender.switchCity || switchCity;
  switchDay = window.WandrRender.switchDay || switchDay;
  renderTickets = window.WandrRender.renderTickets || renderTickets;
  calcWaitTime = window.WandrRender.calcWaitTime || calcWaitTime;
  calcDuration = window.WandrRender.calcDuration || calcDuration;
  renderTicketCard = window.WandrRender.renderTicketCard || renderTicketCard;
  renderTransitCard = window.WandrRender.renderTransitCard || renderTransitCard;
}
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
  const el = safeGet(targetId);
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

function closeTimePickerLegacy() {
  closeModal('modal-time-picker');
  _tpTargetId = null;
}

function confirmTimePickerLegacy() {
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
function getWheelTimeLegacy(id) {
  const el = document.getElementById(id);
  return el ? (el.dataset.value || '') : '';
}

function setWheelTimeLegacy(id, value) {
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

// ══ STAGE 3 BRIDGE: Backward Compatibility for Modal Functions ══
// Assign WandrRender.Modals functions to global scope for HTML onclick handlers

window.openModal = WandrRender.openModal;
window.closeModal = WandrRender.closeModal;
window.openNewTripModal = WandrRender.Modals.Trip.openNew;
window.openEditTripDatesModal = WandrRender.Modals.Trip.openEditDates;
window.openAddCityModal = WandrRender.Modals.City.openAdd;
window.openEditCityNameModal = WandrRender.Modals.City.openEditName;
window.openEditCityDatesModal = WandrRender.Modals.City.openEditDates;
window.openDeleteCityFromEditModal = WandrRender.Modals.City.openDeleteFromEdit;
window.openAddStopModal = WandrRender.Modals.Stop.openAdd;
window.openEditStopModal = WandrRender.Modals.Stop.openEdit;
window.openAddTicketModal = WandrRender.Modals.Ticket.openAdd;
window.openEditTicketModal = WandrRender.Modals.Ticket.openEdit;
window.openEditHotelModal = WandrRender.Modals.Hotel.openEdit;
window.openPackingModal = WandrRender.Modals.Packing.openModal;

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



