
// ══════════════════════════════════════
// STATE
// ══════════════════════════════════════
let _rawTripsFromStorage = (() => {
  try {
    const parsed = JSON.parse(localStorage.getItem('wandr_trips') || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch(e) {
    console.error('wandr: error parsing localStorage data', e);
    return [];
  }
})();
let trips = _rawTripsFromStorage;
let currentTripId = null;
let currentCityIdx = 0;
let currentDayIdx = 0;
let selectedType = 'attraction';
let selectedTransport = 'walking';
let cityEntries = [];
let transitLegs = {}; // key: "fromId_toId" → array of leg objects
let currentDetailTab = 'itinerary';
let selectedTicketType = null;
let editingTicketId = null;
let _pendingDeleteTicketId = null;
let editingStopId = null;

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
      ? cities.map((ci, i) => `<span class="city-pill">📍 ${esc(ci.name)}</span>`).join('')
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
  delete transitLegs[_pendingTransitLegKey];
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
  cityEntries = [];
  transitLegs = {};
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('trip-name').value = '';
  const si = document.getElementById('trip-start');
  const ei = document.getElementById('trip-end');
  si.value = today; si.max = '';
  ei.value = today; ei.min = today;
  document.getElementById('trip-end-error').classList.remove('visible');
  ei.classList.remove('error');
  document.getElementById('cities-list').innerHTML = '';
  const id = uid();
  cityEntries.push(id);
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
  
  let citiesHtml = '';
  let totalDays = 0;
  cityEntries.forEach((id, i) => {
    const cityName = document.getElementById('cn-' + id)?.value || '';
    const hotelName = document.getElementById('chn-' + id)?.value || '';
    const cs = document.getElementById('cs-' + id)?.value || '';
    const ce = document.getElementById('ce-' + id)?.value || '';
    
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
        <span>🌤️ ${totalDays} días · ${cityEntries.length} ciudad${cityEntries.length !== 1 ? 'es' : ''}</span>
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
  let html = '';
  cityEntries.forEach((id, i) => {
    const cityName = document.getElementById('cn-' + id)?.value || '';
    const hotelName = document.getElementById('chn-' + id)?.value || '';
    const hotelAddr = document.getElementById('cha-' + id)?.value || '';
    const cs = document.getElementById('cs-' + id)?.value || '';
    const ce = document.getElementById('ce-' + id)?.value || '';
    
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
  cityEntries.forEach(id => {
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
  cityEntries.push(id);
  renderCityEntries();
  syncCityMins();
  // Scroll to bottom of modal
  setTimeout(() => {
    const modal = document.querySelector('#modal-new-trip .modal');
    modal.scrollTop = modal.scrollHeight;
  }, 50);
}

function toggleTransitLegs(fromId, toId) {
  const legKey = fromId + '_' + toId;
  if (transitLegs[legKey] && transitLegs[legKey].length > 0) {
    // Ask to remove via custom modal instead of native confirm()
    _pendingTransitLegKey = legKey;
    openModal('modal-confirm-delete-transit');
  } else {
    // Add first leg
    if (!transitLegs[legKey]) transitLegs[legKey] = [];
    transitLegs[legKey].push({ type: 'flight', fromTerminal: '', toTerminal: '', depTime: '', arrTime: '', viaCity: '' });
    renderCityEntries();
    syncCityMins();
  }
}

function addTransitLeg(fromId, toId) {
  const legKey = fromId + '_' + toId;
  if (!transitLegs[legKey]) transitLegs[legKey] = [];
  transitLegs[legKey].push({ type: 'flight', fromTerminal: '', toTerminal: '', depTime: '', arrTime: '', viaCity: '' });
  renderCityEntries();
  syncCityMins();
}

function removeTransitLeg(fromId, toId, idx) {
  const legKey = fromId + '_' + toId;
  if (!transitLegs[legKey]) return;
  transitLegs[legKey].splice(idx, 1);
  if (transitLegs[legKey].length === 0) delete transitLegs[legKey];
  renderCityEntries();
  syncCityMins();
}

function setLegType(fromId, toId, idx, type) {
  const legKey = fromId + '_' + toId;
  if (transitLegs[legKey] && transitLegs[legKey][idx]) {
    transitLegs[legKey][idx].type = type;
    renderCityEntries();
    syncCityMins();
  }
}

function updateLegField(fromId, toId, idx, field, value) {
  const legKey = fromId + '_' + toId;
  if (transitLegs[legKey] && transitLegs[legKey][idx]) {
    transitLegs[legKey][idx][field] = value;
  }
}

function removeCityEntry(id) {
  if (cityEntries.length <= 1) { showToast('⚠️ Necesitás al menos una ciudad'); return; }
  cityEntries = cityEntries.filter(c => c !== id);
  renderCityEntries();
}

function renderCityEntries() {
  document.getElementById('cities-list').innerHTML = cityEntries.map((id, i) => {
    // Transit connector before each city (except the first)
    let connectorHtml = '';
    if (i > 0) {
      const prevId = cityEntries[i - 1];
      const legKey = prevId + '_' + id;
      const legs = transitLegs[legKey] || [];
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
    return connectorHtml + `
    <div class="city-entry" id="ce-entry-${id}">
      <div class="city-entry-header">
        <span class="city-entry-num">Ciudad ${i + 1}</span>
        ${cityEntries.length > 1 ? `<button class="btn-remove-city" onclick="removeCityEntry('${id}')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>` : ''}
      </div>
      <input type="text" id="cn-${id}" placeholder="Nombre de la ciudad (ej: Bruselas)" maxlength="60" />
      <input type="text" id="chn-${id}" placeholder="Hotel / alojamiento" style="margin-top:8px" maxlength="80" />
      <input type="text" id="cha-${id}" placeholder="Dirección del hotel" style="margin-top:8px" maxlength="150" />
      <div class="city-date-row" style="margin-top:10px">
        <div class="city-date-col">
          <label>Llegada</label>
          <input type="date" id="cs-${id}" onchange="onCityStartChange('${id}')" />
          <div class="error-msg" id="cs-err-${id}"></div>
        </div>
        <div class="city-date-col">
          <label>Salida</label>
          <input type="date" id="ce-${id}" onchange="onCityEndChange('${id}')" />
          <div class="error-msg" id="ce-err-${id}"></div>
        </div>
      </div>
    </div>`;
  }).join('');
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
    <button class="btn-add-leg" onclick="addTransitLeg('${fromId}','${toId}')">+ Agregar tramo</button>
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
  const name = document.getElementById('trip-name').value.trim();
  const start = document.getElementById('trip-start').value;
  const end = document.getElementById('trip-end').value;

  if (!name) { showToast('⚠️ Ingresá el nombre del viaje'); return; }
  if (!start || !end) { showToast('⚠️ Ingresá las fechas del viaje'); return; }
  if (end < start) { showToast('⚠️ La fecha fin no puede ser anterior al inicio'); return; }

  const cities = [];
  for (let i = 0; i < cityEntries.length; i++) {
    const id = cityEntries[i];
    const cityName = (document.getElementById('cn-' + id)?.value || '').trim();
    const hotelName = (document.getElementById('chn-' + id)?.value || '').trim();
    const hotelAddr = (document.getElementById('cha-' + id)?.value || '').trim();
    const cs = document.getElementById('cs-' + id)?.value || '';
    const ce = document.getElementById('ce-' + id)?.value || '';

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
  for (let i = 0; i < cityEntries.length - 1; i++) {
    const fromId = cityEntries[i];
    const toId = cityEntries[i + 1];
    const legKey = fromId + '_' + toId;
    const legs = transitLegs[legKey];
    if (legs && legs.length > 0) {
      const fromCityName = (document.getElementById('cn-' + fromId)?.value || '').trim();
      const toCityName   = (document.getElementById('cn-' + toId)?.value   || '').trim();
      const fromCityEnd  = document.getElementById('ce-' + fromId)?.value || '';
      const toCityStart  = document.getElementById('cs-' + toId)?.value   || '';
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
          depDate: isFirst ? fromCityEnd  : (document.getElementById('ce-' + fromId)?.value || fromCityEnd),
          depTime: leg.depTime || '',
          arrDate: isLast  ? toCityStart  : (document.getElementById('cs-' + toId)?.value   || toCityStart),
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
  renderDetail();
  renderTickets();
}

function switchDetailTab(tab) {
  currentDetailTab = tab;
  document.getElementById('dtab-itinerary').classList.toggle('active', tab === 'itinerary');
  document.getElementById('dtab-overview').classList.toggle('active', tab === 'overview');
  document.getElementById('dtab-tickets').classList.toggle('active', tab === 'tickets');
  document.getElementById('detail-content').style.display   = tab === 'itinerary' ? '' : 'none';
  document.getElementById('overview-content').style.display = tab === 'overview'  ? '' : 'none';
  document.getElementById('tickets-content').style.display  = tab === 'tickets'   ? '' : 'none';
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
      const cls = ['ov-day-chip', isTransit ? 'transit' : (hasStops ? 'has' : '')].filter(Boolean).join(' ');
      // Clicking a chip switches to itinerary tab on that city+day
      const cityIdx = trip.cities.findIndex(c => c.id === city.id);
      const dayIdx  = (city.days || []).findIndex(d2 => d2.date === d.date);
      return `<div class="${cls}" onclick="ovGoToDay(${cityIdx},${dayIdx})">
        <span class="ov-dc-wd">${wd}</span>
        <span class="ov-dc-dd">${dd}</span>
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
    <div class="ov-city-card">
      <div class="ov-city-head">
        <div class="ov-city-dot" style="background:${color}"></div>
        <div class="ov-city-nm">${esc(city.name)}</div>
        <div class="ov-nights-badge">${nightCount} noche${nightCount !== 1 ? 's' : ''}</div>
      </div>
      <div class="ov-daterange">${formatDate(city.startDate)} → ${formatDate(city.endDate)}</div>
      <div class="ov-day-strip">${dayChips}</div>
      ${hotelHtml}
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

    const cityTabs = trip.cities.map((ci, i) => {
      const nightCount = ci.dayTrip ? 0
        : Math.round((new Date(ci.endDate + 'T00:00:00') - new Date(ci.startDate + 'T00:00:00')) / 86400000);
      const nightsLabel = ci.dayTrip ? 'excursión' : `${nightCount} noche${nightCount !== 1 ? 's' : ''}`;
      return `<div class="city-tab ${i === currentCityIdx ? 'active' : ''} ${ci.dayTrip ? 'daytrip' : ''}" onclick="switchCity(${i})">
        <span class="city-tab-name">${ci.dayTrip ? '🗺️ ' : ''}${esc(ci.name)}</span>
        <span class="city-tab-nights">${nightsLabel}</span>
        ${trip.cities.length > 1 ? `<button class="city-tab-del" onclick="event.stopPropagation();deleteCity('${ci.id}')" title="Eliminar">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>` : ''}
      </div>`;
    }).join('');

    const dayTabs = city.days.map((d, i) => {
      const isTransit = transitDaysSet.has(d.date);
      return `<div class="day-tab ${i === currentDayIdx ? 'active' : ''} ${isTransit ? 'transit' : ''}" onclick="switchDay(${i})">
        <small>${isTransit ? '✈' : getWeekday(d.date)}</small><strong>${d.date.slice(8)}</strong>
      </div>`;
    }).join('');

    // Build transit banner for current day if applicable
    const dayTickets = trip_tickets.filter(tk => tk.depDate === day.date || tk.arrDate === day.date);
    let transitBannerHtml = '';
    if (dayTickets.length) {
      const segs = dayTickets.map(tk => {
        const icon = ticketTypeIcon(tk.type);
        const isDep = tk.depDate === day.date;
        const isArr = tk.arrDate === day.date;
        const termDep = tk.depTerminal || tk.fromTerminal || '';
        const termArr = tk.arrTerminal || tk.toTerminal || '';
        const gateDep = tk.depGate || '';
        const gateArr = tk.arrGate || '';

        // Route label: always show origin → destination
        const routeLabel = `${esc(tk.fromCity)} → ${esc(tk.toCity)}`;
        const companyLabel = tk.company ? `<span class="transit-seg-company">${esc(tk.company)}</span>` : '';

        // Times row
        let timesHtml = '';
        if (tk.depTime || tk.arrTime) {
          const depBlock = `<div class="transit-time-block">
            <span class="transit-time-label">Salida</span>
            <span class="transit-time-value">${tk.depTime || '–'}</span>
            ${termDep ? `<span class="transit-time-sub">${esc(termDep)}${gateDep ? ' · ' + esc(gateDep) : ''}</span>` : ''}
          </div>`;
          const arrBlock = `<div class="transit-time-block transit-time-block-right">
            <span class="transit-time-label">Llegada</span>
            <span class="transit-time-value">${tk.arrTime || '–'}</span>
            ${termArr ? `<span class="transit-time-sub">${esc(termArr)}${gateArr ? ' · ' + esc(gateArr) : ''}</span>` : ''}
          </div>`;
          timesHtml = `<div class="transit-times-row">${depBlock}<div class="transit-times-arrow">${icon}</div>${arrBlock}</div>`;
        }

        return `<div class="transit-segment">
          <div class="transit-seg-header">
            <div class="transit-seg-icon">${icon}</div>
            <div class="transit-seg-route">${routeLabel}</div>
          </div>
          ${companyLabel}
          ${timesHtml}
        </div>`;
      }).join('');
      transitBannerHtml = `<div class="transit-banner">
        <div class="transit-banner-header"><strong>🎫 Día con pasaje</strong></div>
        ${segs}
      </div>`;
    }

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

    if (todayArrival && (todayArrival.type || todayArrival.arrTerminal || todayArrival.toTerminal)) {
      // Arrival day: show terminal as departure point, not hotel
      const terminalName = todayArrival.arrTerminal || todayArrival.toTerminal || null;
      const terminalLabel = terminalName || ticketTypeLabel(todayArrival.type) + ' llegada';
      const arrTimeStr = todayArrival.arrTime ? ` · ${todayArrival.arrTime}` : '';
      const dest = city.hotelAddr || city.hotelName;
      const routeTerminalToHotel = terminalName && dest
        ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(terminalName)}&destination=${encodeURIComponent(dest)}&travelmode=transit`
        : null;
      stopsHtml += `<div class="stop-item">
        <div class="stop-connector">
          <div class="stop-dot" style="background:rgba(127,207,184,0.2);border:2px solid var(--accent3);font-size:0.82rem">${ticketTypeIcon(todayArrival.type)}</div>
          ${(stops.length || dayHasArrival) ? '<div class="stop-line"></div>' : ''}
        </div>
        <div class="stop-body">
          <span class="transport-badge ${ticketTransportClass(todayArrival.type)}">${ticketTypeIcon(todayArrival.type)} ${ticketTypeLabel(todayArrival.type)}</span>
          <div class="stop-name" style="margin-top:6px">${esc(terminalLabel)}</div>
          <div class="stop-meta">
            <span style="color:var(--accent3)">Punto de llegada${arrTimeStr}</span>
            ${todayArrival.company ? `<span>${esc(todayArrival.company)}</span>` : ''}
          </div>
          <div class="stop-actions">
            ${terminalName ? `<a class="btn-maps" href="${mapsUrl(terminalName)}" target="_blank">📌 Ver en Maps</a>` : ''}
            ${routeTerminalToHotel ? `<a class="btn-maps btn-return-chip" href="${routeTerminalToHotel}" target="_blank">🏨 Cómo llegar al hotel</a>` : ''}
          </div>
        </div>
      </div>`;
    } else if (city.hotelName) {
      // Normal day: show hotel as departure point
      stopsHtml += `<div class="stop-item">
        <div class="stop-connector">
          <div class="stop-dot hotel">🏨</div>
          ${stops.length ? '<div class="stop-line"></div>' : ''}
        </div>
        <div class="stop-body">
          <div class="stop-name">${esc(city.hotelName)}</div>
          <div class="stop-meta"><span style="color:var(--accent2)">Punto de partida</span></div>
          ${city.hotelAddr ? `<div class="stop-actions"><a class="btn-maps" href="${mapsUrl(city.hotelAddr)}" target="_blank">📌 Ver en Maps</a></div>` : ''}
        </div>
      </div>`;
    }

    stops.forEach((stop, idx) => {
      const isLast = idx === stops.length - 1;
      const isVisuallyLast = isLast && !dayHasArrival && !todayDeparture;
      // On arrival day, first stop comes from the terminal, not the hotel
      const defaultOrigin = todayArrival
        ? (todayArrival.arrTerminal || todayArrival.toTerminal || todayArrival.toCity)
        : (city.hotelAddr || city.hotelName || city.name);
      const prevAddr = idx === 0 ? defaultOrigin : (stops[idx-1].address || stops[idx-1].name);
      const gmMode = googleMapsMode(stop.transport);
      const routeUrl = prevAddr && stop.address
        ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(prevAddr)}&destination=${encodeURIComponent(stop.address)}&travelmode=${gmMode}`
        : mapsUrl(stop.address || stop.name);

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
            ${city.hotelAddr ? `<a class="btn-maps btn-return-chip" href="https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(stop.address || stop.name)}&destination=${encodeURIComponent(city.hotelAddr)}&travelmode=transit" target="_blank">🏨 Volver al hotel</a>` : ''}
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
      const terminalName = todayDeparture.depTerminal || todayDeparture.fromTerminal || null;
      const terminalLabel = terminalName || ticketTypeLabel(todayDeparture.type) + ' salida';
      const depTimeStr = todayDeparture.depTime ? ` · ${todayDeparture.depTime}` : '';
      const gateStr = todayDeparture.depGate ? ` · Puerta ${todayDeparture.depGate}` : '';
      // Origin: last user stop if any, otherwise the hotel
      const lastStopAddr = stops.length > 0
        ? (stops[stops.length-1].address || stops[stops.length-1].name)
        : (city.hotelAddr || city.hotelName || null);
      const dest = terminalName || null;
      const routeToTerminal = lastStopAddr && dest
        ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(lastStopAddr)}&destination=${encodeURIComponent(dest)}&travelmode=transit`
        : dest ? mapsUrl(dest) : '';

      departureTerminalHtml = `<div class="stop-item stop-last arrival-hotel-stop">
        <div class="stop-connector">
          <div class="stop-line" style="min-height:14px"></div>
          <div class="stop-dot" style="background:rgba(232,184,109,0.2);border:2px solid var(--accent);font-size:0.82rem">${ticketTypeIcon(todayDeparture.type)}</div>
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
    let arrivalHotelHtml = '';
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
      routeActionsHtml = `<div class="route-actions">
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
      <div class="days-scroll">${dayTabs}</div>

      <div class="day-info-bar">
        <div>
          <div class="day-label">${getWeekdayFull(day.date)}</div>
          <div class="day-date">${formatDate(day.date)}</div>
        </div>
        <div class="stops-count">${stops.length} parada${stops.length !== 1 ? 's' : ''}</div>
      </div>

      <div class="stops-list" id="stops-list-el">${stopsHtml}${departureTerminalHtml}${arrivalHotelHtml}</div>
      ${transitBannerHtml}
      ${routeActionsHtml}
    `;

    initDragDrop();

  } catch(err) {
    document.getElementById('detail-content').innerHTML = `<div style="padding:20px;color:var(--danger)">
      <strong>Error al mostrar el viaje:</strong><br><small>${err.message}</small>
    </div>`;
    console.error('renderDetail error:', err);
  }
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

function renderTicketCard(tk) {
  const icon = ticketTypeIcon(tk.type);
  const complete = ticketIsComplete(tk);
  const isStub = tk.stub && !complete;
  return `<div class="ticket-card ${isStub ? 'ticket-stub' : ''}">
    <div class="ticket-card-header">
      <div class="ticket-type-icon">${icon}</div>
      <div class="ticket-header-info">
        <div class="ticket-route">${esc(tk.fromCity)} → ${esc(tk.toCity)}</div>
        <div class="ticket-company">${ticketTypeLabel(tk.type)}${tk.company ? ' · ' + esc(tk.company) : ''}</div>
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
          ${(tk.arrTerminal||tk.toTerminal) ? `<div class="ticket-terminal" style="align-self:flex-start">🏛️ ${esc(tk.arrTerminal||tk.toTerminal)}</div>` : ''}
          ${tk.arrGate ? `<div class="ticket-terminal" style="align-self:flex-start">🚪 ${esc(tk.arrGate)}</div>` : ''}
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

function openAddTicketModal() {
  const trip = trips.find(t => t.id === currentTripId);
  editingTicketId = null;
  selectedTicketType = null;
  document.getElementById('ticket-modal-title').textContent = '🎫 Agregar pasaje';
  document.getElementById('ticket-company').value = '';
  document.getElementById('ticket-from-city').value = '';
  document.getElementById('ticket-to-city').value = '';
  document.getElementById('ticket-dep-terminal').value = '';
  document.getElementById('ticket-dep-gate').value = '';
  document.getElementById('ticket-arr-terminal').value = '';
  document.getElementById('ticket-arr-gate').value = '';
  document.getElementById('ticket-dep-date').value = trip?.startDate || '';
  document.getElementById('ticket-arr-date').value = trip?.startDate || '';
  document.getElementById('ticket-dep-time').value = '';
  document.getElementById('ticket-arr-time').value = '';
  document.querySelectorAll('#ticket-type-grid .transport-option').forEach(el => el.classList.remove('selected'));
  updateTicketFields(null);
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
  document.getElementById('ticket-dep-gate').value = tk.depGate || '';
  document.getElementById('ticket-arr-terminal').value = tk.arrTerminal || tk.toTerminal || '';
  document.getElementById('ticket-arr-gate').value = tk.arrGate || '';
  document.getElementById('ticket-dep-date').value = tk.depDate || '';
  document.getElementById('ticket-arr-date').value = tk.arrDate || '';
  document.getElementById('ticket-dep-time').value = tk.depTime || '';
  document.getElementById('ticket-arr-time').value = tk.arrTime || '';
  updateTicketFields(selectedTicketType);
  openModal('modal-ticket');
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
  const show = !!type;
  document.getElementById('ticket-dep-fields').style.display = show ? '' : 'none';
  document.getElementById('ticket-arr-fields').style.display = show ? '' : 'none';
  if (!type) return;

  const cfg = TICKET_CONFIG[type] || TICKET_CONFIG.flight;

  document.getElementById('ticket-dep-section-label').textContent = cfg.depSection;
  document.getElementById('ticket-arr-section-label').textContent = cfg.arrSection;

  document.getElementById('ticket-dep-terminal-label').textContent = cfg.terminalLabel + ' de salida';
  document.getElementById('ticket-dep-terminal').placeholder = cfg.depTerminalPh;
  document.getElementById('ticket-arr-terminal-label').textContent = cfg.terminalLabel + ' de llegada';
  document.getElementById('ticket-arr-terminal').placeholder = cfg.arrTerminalPh;

  const gateGroups = [
    document.getElementById('ticket-dep-gate-group'),
    document.getElementById('ticket-arr-gate-group'),
  ];
  gateGroups.forEach(g => g.style.display = cfg.showGate ? '' : 'none');

  if (cfg.showGate) {
    document.getElementById('ticket-dep-gate-label').innerHTML = cfg.depGateLabel + ' <span class="label-optional">opcional</span>';
    document.getElementById('ticket-dep-gate').placeholder = cfg.depGatePh;
    document.getElementById('ticket-arr-gate-label').innerHTML = cfg.arrGateLabel + ' <span class="label-optional">opcional</span>';
    document.getElementById('ticket-arr-gate').placeholder = cfg.arrGatePh;
  }
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
    depGate:      document.getElementById('ticket-dep-gate').value.trim(),
    arrTerminal:  document.getElementById('ticket-arr-terminal').value.trim(),
    arrGate:      document.getElementById('ticket-arr-gate').value.trim(),
    depDate, depTime: document.getElementById('ticket-dep-time').value,
    arrDate, arrTime: document.getElementById('ticket-arr-time').value,
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
  openModal('modal-edit-trip-dates');
}

function onEditTripStartChange() {
  const s = document.getElementById('edit-trip-start').value;
  const eEl = document.getElementById('edit-trip-end');
  eEl.min = s;
  if (eEl.value && eEl.value < s) { eEl.value = s; }
  document.getElementById('edit-trip-end-err').classList.remove('visible');
}

function onEditTripEndChange() {
  const s = document.getElementById('edit-trip-start').value;
  const e = document.getElementById('edit-trip-end').value;
  const err = document.getElementById('edit-trip-end-err');
  err.classList.toggle('visible', !!(e && e < s));
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

  trip.name = name;
  const oldStart = trip.startDate;
  const oldEnd = trip.endDate;
  trip.startDate = newStart;
  trip.endDate = newEnd;

  // Extend cities that were at the boundary
  trip.cities.forEach(ci => {
    // If city started on old trip start and new start is earlier → extend city start
    if (ci.startDate === oldStart && newStart < oldStart) {
      const extraDays = buildDays(newStart, addDays(ci.startDate, -1));
      ci.days = [...extraDays, ...ci.days];
      ci.startDate = newStart;
    }
    // If city ended on old trip end and new end is later → extend city end
    if (ci.endDate === oldEnd && newEnd > oldEnd) {
      const extraDays = buildDays(addDays(ci.endDate, 1), newEnd);
      ci.days = [...ci.days, ...extraDays];
      ci.endDate = newEnd;
    }
  });

  save();
  closeModal('modal-edit-trip-dates');
  renderDetail();
  showToast('✅ Fechas del viaje actualizadas');
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
// EDIT HOTEL
// ══════════════════════════════════════
function openEditHotelModal() {
  const trip = trips.find(t => t.id === currentTripId);
  if (!trip) return;
  const city = trip.cities[currentCityIdx];
  document.getElementById('edit-hotel-city-name').textContent = city.name;
  document.getElementById('edit-hotel-name').value = city.hotelName || '';
  document.getElementById('edit-hotel-addr').value = city.hotelAddr || '';
  document.getElementById('edit-hotel-checkin').value = city.checkInTime || '';
  document.getElementById('edit-hotel-checkout').value = city.checkOutTime || '';
  openModal('modal-edit-hotel');
}

function saveEditHotel() {
  const trip = trips.find(t => t.id === currentTripId);
  if (!trip) return;
  const city = trip.cities[currentCityIdx];
  city.hotelName = document.getElementById('edit-hotel-name').value.trim();
  city.hotelAddr = document.getElementById('edit-hotel-addr').value.trim();
  city.checkInTime = document.getElementById('edit-hotel-checkin').value;
  city.checkOutTime = document.getElementById('edit-hotel-checkout').value;
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
  document.getElementById('new-city-depart-time').value = '';
  document.getElementById('new-city-return-time').value = '';
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
    startDate: cs, endDate: ce,
    days: buildDays(cs, ce),
    ...(isDayTrip ? {
      dayTrip: true,
      dayTripTransport: selectedDayTripTransport,
      dayTripDepartTime: document.getElementById('new-city-depart-time').value,
      dayTripReturnTime: document.getElementById('new-city-return-time').value,
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
// ADD / DELETE STOP
// ══════════════════════════════════════
function openAddStopModal() {
  editingStopId = null;
  selectedType = 'attraction'; selectedTransport = 'walking';
  document.getElementById('stop-modal-title').textContent = '📍 Agregar parada';
  document.getElementById('stop-save-btn').textContent = 'Agregar parada';
  ['stop-name','stop-addr','stop-note'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('stop-time-from').value = '';
  document.getElementById('stop-time-to').value = '';
  document.querySelectorAll('.type-option').forEach(e => e.classList.remove('selected'));
  document.querySelector('[data-type="attraction"]').classList.add('selected');
  document.querySelectorAll('.transport-option').forEach(e => e.classList.remove('selected'));
  document.querySelector('[data-mode="walking"]').classList.add('selected');
  openModal('modal-add-stop');
}

function openEditStopModal(stopId) {
  const trip = trips.find(t => t.id === currentTripId);
  const stop = trip.cities[currentCityIdx].days[currentDayIdx].stops.find(s => s.id === stopId);
  if (!stop) return;

  editingStopId = stopId;
  selectedType = stop.type || 'attraction';
  selectedTransport = stop.transport || 'walking';

  document.getElementById('stop-modal-title').textContent = '✏️ Editar parada';
  document.getElementById('stop-save-btn').textContent = 'Guardar cambios';
  document.getElementById('stop-name').value = stop.name || '';
  document.getElementById('stop-addr').value = stop.address || '';
  document.getElementById('stop-note').value = stop.note || '';
  document.getElementById('stop-time-from').value = stop.timeFrom || '';
  document.getElementById('stop-time-to').value = stop.timeTo || '';

  document.querySelectorAll('.type-option').forEach(e => e.classList.remove('selected'));
  const typeEl = document.querySelector(`[data-type="${selectedType}"]`);
  if (typeEl) typeEl.classList.add('selected');

  document.querySelectorAll('.transport-option').forEach(e => e.classList.remove('selected'));
  const transEl = document.querySelector(`[data-mode="${selectedTransport}"]`);
  if (transEl) transEl.classList.add('selected');

  openModal('modal-add-stop');
}

function saveStop() {
  const name = document.getElementById('stop-name').value.trim();
  const address = document.getElementById('stop-addr').value.trim();
  const note = document.getElementById('stop-note').value.trim();
  const timeFrom = document.getElementById('stop-time-from').value;
  const timeTo = document.getElementById('stop-time-to').value;
  if (!name) { showToast('⚠️ Ingresá el nombre del lugar'); return; }

  const trip = trips.find(t => t.id === currentTripId);
  const stops = trip.cities[currentCityIdx].days[currentDayIdx].stops;

  if (editingStopId) {
    const idx = stops.findIndex(s => s.id === editingStopId);
    if (idx !== -1) {
      stops[idx] = { ...stops[idx], name, address, note, timeFrom, timeTo, type: selectedType, transport: selectedTransport };
    }
    save(); closeModal('modal-add-stop'); renderDetail();
    showToast('✅ Parada actualizada');
  } else {
    stops.push({ id: uid(), name, address, note, timeFrom, timeTo, type: selectedType, transport: selectedTransport });
    save(); closeModal('modal-add-stop'); renderDetail();
    showToast('✅ Parada agregada');
  }
  editingStopId = null;
}

function deleteStop(stopId) {
  const trip = trips.find(t => t.id === currentTripId);
  const days = trip.cities[currentCityIdx].days;
  days[currentDayIdx].stops = days[currentDayIdx].stops.filter(s => s.id !== stopId);
  save(); renderDetail(); showToast('Parada eliminada');
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

function save() {
  try {
    localStorage.setItem('wandr_trips', JSON.stringify(trips));
    _showSaveIndicator('saved', '✓ Guardado');
  } catch(e) {
    if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
      showToast('⚠️ Almacenamiento lleno. No se pudo guardar.');
      _showSaveIndicator('error', '⚠️ Sin espacio');
    } else {
      showToast('⚠️ Error al guardar datos.');
      _showSaveIndicator('error', '⚠️ Error');
      console.error('save() error:', e);
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
// INIT — migrate & sanitize old data
// ══════════════════════════════════════
function sanitizeTrips(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter(t => t && t.id && t.name).map(t => {
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
      return { id: t.id, name: t.name, startDate: t.startDate, endDate: t.endDate, cities: [city], tickets: [] };
    }
    // Ensure each city has valid days matching its own date range, preserving stops
    t.cities = (t.cities || []).filter(ci => ci && ci.startDate && ci.endDate).map(ci => {
      const stopsMap = {};
      (ci.days || []).forEach(d => {
        if (d && d.date && Array.isArray(d.stops) && d.stops.length) {
          // Deep-sanitize each stop: ensure required fields exist and are safe strings
          const cleanStops = d.stops
            .filter(s => s && typeof s === 'object' && s.name)
            .map(s => ({
              id:        (typeof s.id === 'string' && s.id)        ? s.id        : uid(),
              name:      typeof s.name      === 'string' ? s.name.slice(0, 200)      : '',
              address:   typeof s.address   === 'string' ? s.address.slice(0, 300)   : '',
              note:      typeof s.note      === 'string' ? s.note.slice(0, 500)      : '',
              timeFrom:  typeof s.timeFrom  === 'string' ? s.timeFrom  : '',
              timeTo:    typeof s.timeTo    === 'string' ? s.timeTo    : '',
              type:      ['attraction','restaurant','museum','park','hotel'].includes(s.type) ? s.type : 'attraction',
              transport: ['walking','transit','taxi','driving'].includes(s.transport) ? s.transport : 'walking',
            }));
          if (cleanStops.length) stopsMap[d.date] = cleanStops;
        }
      });
      ci.days = buildDays(ci.startDate, ci.endDate).map(d => ({
        date: d.date, stops: stopsMap[d.date] || []
      }));
      return ci;
    });
    if (!Array.isArray(t.tickets)) t.tickets = [];
    return t;
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
  // Sanitization returned empty but original had data — keep original and warn
  console.warn('wandr: sanitizeTrips returned empty on non-empty input; keeping original data');
  trips = _rawTripsFromStorage;
}
_rawTripsFromStorage = null; // free reference
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
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5&addressdetails=1`;
      const res = await fetch(url, {
        signal: _acAbort.signal,
        headers: { 'Accept-Language': 'es', 'User-Agent': 'Wandr-TravelPlanner/1.0' }
      });
      const data = await res.json();
      if (!data.length) {
        list.innerHTML = '<li class="ac-loading">Sin resultados</li>';
        return;
      }
      // Store results safely — never interpolate raw values into HTML attributes
      _acResults[listId] = data.map(r => r.display_name);
      list.innerHTML = data.map((r, i) => {
        const parts = r.display_name.split(',');
        const main = parts[0].trim();
        const sub = parts.slice(1, 3).join(',').trim();
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
  const value = (_acResults[listId] || [])[index];
  if (value === undefined) return;
  // Find the input that owns this list
  const wrap = list.closest('.autocomplete-wrap');
  if (wrap) {
    const input = wrap.querySelector('input');
    if (input) input.value = value;
  }
  hideList(listId);
}

function hideList(listId) {
  setTimeout(() => {
    const list = document.getElementById(listId);
    if (list) list.classList.remove('open');
  }, 150);
}
