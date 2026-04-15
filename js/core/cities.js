(function (global) {
  const Wandr = global.Wandr = global.Wandr || {};
  Wandr.Cities = Wandr.Cities || {};

  // ══════════════════════════════════════════════════════════════
  // CITY WIZARD STORE (Zustand-like pattern)
  // ══════════════════════════════════════════════════════════════
  
  function createCityWizardStore() {
    let state = {
      cityEntries: [],
      cityEntryState: {},
      transitLegs: {}
    };

    function getState() { return state; }

    function setState(partial) {
      state = typeof partial === 'function' ? partial(state) : { ...state, ...partial };
    }

    // City entry actions
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

    function reset() {
      setState({ cityEntries: [], cityEntryState: {}, transitLegs: {} });
    }

    // Transit leg actions
    function toggleTransitLegs(fromId, toId) {
      const legKey = fromId + '_' + toId;
      const currentState = getState();
      if (currentState.transitLegs[legKey] && currentState.transitLegs[legKey].length > 0) {
        // If legs exist, signal removal (caller handles confirmation)
        return false;
      } else {
        // Add first leg
        addTransitLeg(fromId, toId);
        return true;
      }
    }

    function addTransitLeg(fromId, toId) {
      const legKey = fromId + '_' + toId;
      setState(s => {
        const newLegs = { ...s.transitLegs };
        if (!newLegs[legKey]) newLegs[legKey] = [];
        newLegs[legKey].push({ type: 'flight', fromTerminal: '', toTerminal: '', depTime: '', arrTime: '', viaCity: '' });
        return { ...s, transitLegs: newLegs };
      });
    }

    function removeTransitLeg(fromId, toId, legIdx) {
      const legKey = fromId + '_' + toId;
      setState(s => {
        if (!s.transitLegs[legKey]) return s;
        const newLegs = { ...s.transitLegs };
        newLegs[legKey].splice(legIdx, 1);
        if (newLegs[legKey].length === 0) delete newLegs[legKey];
        return { ...s, transitLegs: newLegs };
      });
    }

    function setLegType(fromId, toId, legIdx, type) {
      const legKey = fromId + '_' + toId;
      setState(s => {
        if (s.transitLegs[legKey] && s.transitLegs[legKey][legIdx]) {
          const newLegs = { ...s.transitLegs };
          newLegs[legKey] = [...newLegs[legKey]];
          newLegs[legKey][legIdx] = { ...newLegs[legKey][legIdx], type };
          return { ...s, transitLegs: newLegs };
        }
        return s;
      });
    }

    function updateLegField(fromId, toId, legIdx, field, value) {
      const legKey = fromId + '_' + toId;
      setState(s => {
        if (s.transitLegs[legKey] && s.transitLegs[legKey][legIdx]) {
          const newLegs = { ...s.transitLegs };
          newLegs[legKey] = [...newLegs[legKey]];
          newLegs[legKey][legIdx] = { ...newLegs[legKey][legIdx], [field]: value };
          return { ...s, transitLegs: newLegs };
        }
        return s;
      });
    }

    return {
      getState,
      setState,
      addCityEntry,
      removeCityEntry,
      updateCityField,
      reset,
      toggleTransitLegs,
      addTransitLeg,
      removeTransitLeg,
      setLegType,
      updateLegField
    };
  }

  // ══════════════════════════════════════════════════════════════
  // VALIDATORS
  // ══════════════════════════════════════════════════════════════

  /**
   * Validate a single city's date range
   * @param {Object} city - City entry {name, start, end, ...}
   * @returns {Object} {valid: boolean, reason: string}
   */
  function validateCityDateRange(city) {
    const { start, end } = city;

    // Check for missing dates
    if (!start || !end) {
      return { valid: false, reason: 'Completá las fechas de la ciudad' };
    }

    // Check for invalid date format (basic check)
    if (isNaN(new Date(start + 'T00:00:00').getTime()) || isNaN(new Date(end + 'T00:00:00').getTime())) {
      return { valid: false, reason: 'Las fechas no son válidas' };
    }

    // Check that end is not before start
    if (end < start) {
      return { valid: false, reason: 'La fecha fin no puede ser anterior a la llegada' };
    }

    return { valid: true, reason: '' };
  }

  /**
   * Validate overlap between multiple cities
   * Adjacent dates (check-out same day as check-in) are allowed
   * @param {Array} cities - Array of city objects with startDate, endDate
   * @returns {Object} {valid: boolean, conflicts: [{idx1, idx2, reason}]}
   */
  function validateCityOverlap(cities) {
    const conflicts = [];

    for (let i = 0; i < cities.length; i++) {
      for (let j = i + 1; j < cities.length; j++) {
        const city1 = cities[i];
        const city2 = cities[j];

        // Overlap check: allow touching dates (same day check-out/check-in)
        // Overlap means: city2.start < city1.end AND city2.end > city1.start
        if (city2.start < city1.endDate && city2.endDate > city1.startDate) {
          conflicts.push({
            idx1: i,
            idx2: j,
            reason: `Las ciudades ${i + 1} y ${j + 1} tienen fechas solapadas`
          });
        }
      }
    }

    return {
      valid: conflicts.length === 0,
      conflicts
    };
  }

  /**
   * Identify gaps (unplanned time) between cities
   * @param {Array} cities - Array of city objects with startDate, endDate
   * @returns {Object} {gaps: [{start, end}]}
   */
  function getCityGapRanges(cities) {
    if (cities.length === 0) {
      return { gaps: [] };
    }

    // Sort cities by startDate
    const sorted = [...cities].sort((a, b) => a.startDate.localeCompare(b.startDate));
    const gaps = [];

    // Find gaps between consecutive cities
    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i];
      const next = sorted[i + 1];
      
      // If there's a gap (next.start > current.end):
      if (next.startDate > current.endDate) {
        gaps.push({
          start: current.endDate,
          end: next.startDate
        });
      }
    }

    return { gaps };
  }

  // ══════════════════════════════════════════════════════════════
  // TRIP BUILDER
  // ══════════════════════════════════════════════════════════════

  /**
   * Build an array of day objects for a date range
   * @param {string} startDate - YYYY-MM-DD format
   * @param {string} endDate - YYYY-MM-DD format
   * @returns {Array} [{date: 'YYYY-MM-DD', stops: []}]
   */
  function buildDays(startDate, endDate) {
    const days = [];
    let d = new Date(startDate + 'T00:00:00');
    const e = new Date(endDate + 'T00:00:00');
    while (d <= e) {
      days.push({ date: d.toISOString().slice(0, 10), stops: [] });
      d.setDate(d.getDate() + 1);
    }
    return days;
  }

  /**
   * Build a trip object from serialized wizard state
   * Pure function: never mutates input or produces side effects
   * @param {Object} wizardState - Serialized state from cityWizard.getState()
   * @param {Object} tripMetadata - {name, startDate, endDate}
   * @returns {Object} Fresh trip object with cities and tickets
   */
  function buildTripFromWizardState(wizardState, tripMetadata) {
    const { cityEntries, cityEntryState, transitLegs } = wizardState;
    const { name, startDate: tripStart, endDate: tripEnd } = tripMetadata;

    // Helper to generate unique IDs (local to this module)
    const uid = () => {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
      return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    };

    const cities = [];

    // Build cities from wizard state
    for (let i = 0; i < cityEntries.length; i++) {
      const id = cityEntries[i];
      const entry = cityEntryState[id] || {};
      const cityName = (entry.name || '').trim();
      const hotelName = (entry.hotel || '').trim();
      const hotelAddr = (entry.addr || '').trim();
      const cs = entry.start || '';
      const ce = entry.end || '';

      if (!cityName || !cs || !ce) continue;

      // Clamp city dates to trip range (lenient)
      const cityStart = cs < tripStart ? tripStart : cs;
      const cityEnd = ce > tripEnd ? tripEnd : ce;

      cities.push({
        id: uid(),
        name: cityName,
        hotelName,
        hotelAddr,
        startDate: cityStart,
        endDate: cityEnd,
        days: buildDays(cityStart, cityEnd)
      });
    }

    // Build trip with cities
    const trip = {
      id: uid(),
      name,
      startDate: tripStart,
      endDate: tripEnd,
      cities,
      tickets: []
    };

    // Generate tickets from transit legs
    for (let i = 0; i < cityEntries.length - 1; i++) {
      const fromId = cityEntries[i];
      const toId = cityEntries[i + 1];
      const legKey = fromId + '_' + toId;
      const legs = transitLegs[legKey];

      if (legs && legs.length > 0) {
        const fromEntry = cityEntryState[fromId] || {};
        const toEntry = cityEntryState[toId] || {};
        const fromCityName = (fromEntry.name || '').trim();
        const toCityName = (toEntry.name || '').trim();
        const fromCityEnd = fromEntry.end || '';
        const toCityStart = toEntry.start || '';

        const chainId = legs.length > 1 ? uid() : null;

        legs.forEach((leg, legIdx) => {
          const isFirst = legIdx === 0;
          const isLast = legIdx === legs.length - 1;

          trip.tickets.push({
            id: uid(),
            type: leg.type || 'flight',
            company: '',
            fromCity: isFirst ? fromCityName : (legs[legIdx - 1].viaCity || fromCityName),
            toCity: isLast ? toCityName : (leg.viaCity || toCityName),
            depTerminal: leg.fromTerminal || '',
            arrTerminal: leg.toTerminal || '',
            depGate: '',
            arrGate: '',
            depDate: fromCityEnd,
            depTime: leg.depTime || '',
            arrDate: toCityStart,
            arrTime: leg.arrTime || '',
            chainId,
            stub: false
          });
        });
      }
    }

    return trip;
  }

  // ══════════════════════════════════════════════════════════════
  // EXPORTS
  // ══════════════════════════════════════════════════════════════

  Wandr.Cities.createCityWizardStore = createCityWizardStore;
  Wandr.Cities.validateCityDateRange = validateCityDateRange;
  Wandr.Cities.validateCityOverlap = validateCityOverlap;
  Wandr.Cities.getCityGapRanges = getCityGapRanges;
  Wandr.Cities.buildDays = buildDays;
  Wandr.Cities.buildTripFromWizardState = buildTripFromWizardState;

})(window);
