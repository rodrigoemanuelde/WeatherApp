(function (global) {
  const stateNs = global.WandrState = global.WandrState || {};

  function createInitialUiState() {
    return {
      currentTripId: null,
      currentCityIdx: 0,
      currentDayIdx: 0,
      selectedType: 'attraction',
      selectedTransport: 'walking',
      currentDetailTab: 'itinerary',
      isLoadingCountryCodes: false,
      selectedTicketType: null,
      editingTicketId: null,
      pendingDeleteTicketId: null,
      pendingDeleteCityId: null,
      editingStopId: null,
      routeSeparatorRenderToken: 0
    };
  }

  function createAppStore(initialState) {
    const state = {
      trips: Array.isArray(initialState?.trips) ? initialState.trips : [],
      ui: {
        ...createInitialUiState(),
        ...(initialState?.ui || {})
      }
    };

    function getState() {
      return state;
    }

    function getTrips() {
      return state.trips;
    }

    function setTrips(nextTrips) {
      state.trips = Array.isArray(nextTrips) ? nextTrips : [];
      return state.trips;
    }

    function getUiValue(key) {
      return state.ui[key];
    }

    function setUiValue(key, value) {
      state.ui[key] = value;
      return state.ui[key];
    }

    function openTrip(tripId) {
      state.ui.currentTripId = tripId;
      state.ui.currentCityIdx = 0;
      state.ui.currentDayIdx = 0;
      state.ui.currentDetailTab = 'itinerary';
    }

    function setDetailTab(tab) {
      state.ui.currentDetailTab = tab;
    }

    function switchCity(index) {
      state.ui.currentCityIdx = index;
      state.ui.currentDayIdx = 0;
    }

    function switchDay(index) {
      state.ui.currentDayIdx = index;
    }

    function selectCityDay(cityIndex, dayIndex) {
      state.ui.currentCityIdx = cityIndex;
      if (typeof dayIndex === 'number' && dayIndex >= 0) {
        state.ui.currentDayIdx = dayIndex;
      } else {
        state.ui.currentDayIdx = 0;
      }
    }

    function ensureCurrentDayInRange(daysLength) {
      if (state.ui.currentDayIdx >= daysLength) {
        state.ui.currentDayIdx = 0;
      }
    }

    function beginAddTicket() {
      state.ui.editingTicketId = null;
      state.ui.selectedTicketType = null;
    }

    function beginEditTicket(ticketId, ticketType) {
      state.ui.editingTicketId = ticketId;
      state.ui.selectedTicketType = ticketType || null;
    }

    function setSelectedTicketType(ticketType) {
      state.ui.selectedTicketType = ticketType;
    }

    function markTicketPendingDelete(ticketId) {
      state.ui._pendingDeleteTicketId = ticketId;
    }

    function clearPendingDeleteTicket() {
      state.ui._pendingDeleteTicketId = null;
    }

    function markCityPendingDelete(cityId) {
      state.ui._pendingDeleteCityId = cityId;
    }

    function clearPendingDeleteCity() {
      state.ui._pendingDeleteCityId = null;
    }

    function syncAfterCityDeletion(remainingCitiesCount) {
      if (state.ui.currentCityIdx >= remainingCitiesCount) {
        state.ui.currentCityIdx = remainingCitiesCount - 1;
      }
      if (state.ui.currentCityIdx < 0) {
        state.ui.currentCityIdx = 0;
      }
      state.ui.currentDayIdx = 0;
    }

    return {
      getState,
      getTrips,
      setTrips,
      getUiValue,
      setUiValue,
      openTrip,
      setDetailTab,
      switchCity,
      switchDay,
      selectCityDay,
      ensureCurrentDayInRange,
      beginAddTicket,
      beginEditTicket,
      setSelectedTicketType,
      markTicketPendingDelete,
      clearPendingDeleteTicket,
      markCityPendingDelete,
      clearPendingDeleteCity,
      syncAfterCityDeletion
    };
  }

  function bindStateGlobals(target, store, uiKeys) {
    Object.defineProperty(target, 'trips', {
      configurable: true,
      enumerable: true,
      get() {
        return store.getTrips();
      },
      set(value) {
        store.setTrips(value);
      }
    });

    uiKeys.forEach(key => {
      Object.defineProperty(target, key, {
        configurable: true,
        enumerable: true,
        get() {
          return store.getUiValue(key);
        },
        set(value) {
          store.setUiValue(key, value);
        }
      });
    });
  }

  stateNs.createInitialUiState = createInitialUiState;
  stateNs.createAppStore = createAppStore;
  stateNs.bindStateGlobals = bindStateGlobals;
})(window);
