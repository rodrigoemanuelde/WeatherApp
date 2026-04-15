(function (global) {
  const utils = global.WandrUtils = global.WandrUtils || {};

  function isValidCoord(lat, lon) {
    const latNum = parseFloat(lat);
    const lonNum = parseFloat(lon);
    if (Number.isNaN(latNum) || Number.isNaN(lonNum)) return false;
    return latNum >= -90 && latNum <= 90 && lonNum >= -180 && lonNum <= 180;
  }

  function isValidDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
    const date = new Date(dateStr);
    return date instanceof Date && !Number.isNaN(date.getTime());
  }

  function isValidTime(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return false;
    const match = timeStr.match(/^(\d{2}):(\d{2})$/);
    if (!match) return false;
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
  }

  function validateTripData(trip, limits) {
    const errors = [];

    if (!trip) {
      errors.push('Trip no existe');
      return { valid: false, errors };
    }

    const {
      maxStringLength,
      maxTripNameLength,
      maxCityNameLength,
      maxAddressLength,
      maxStopsPerDay,
      maxCitiesPerTrip,
      maxTicketsPerTrip
    } = limits;

    if (trip.name && trip.name.length > maxTripNameLength) {
      errors.push(`Nombre del viaje muy largo (max ${maxTripNameLength} caracteres)`);
    }

    if (!isValidDate(trip.startDate)) errors.push('Fecha de inicio invalida');
    if (!isValidDate(trip.endDate)) errors.push('Fecha de fin invalida');

    if (!trip.cities || !Array.isArray(trip.cities)) {
      errors.push('Cities no es un array');
    } else {
      if (trip.cities.length > maxCitiesPerTrip) {
        errors.push(`Demasiadas ciudades (max ${maxCitiesPerTrip})`);
      }

      trip.cities.forEach((city, idx) => {
        if (city.name && city.name.length > maxCityNameLength) {
          errors.push(`Ciudad ${idx + 1}: nombre muy largo`);
        }
        if (city.hotelLat != null && city.hotelLon != null && !isValidCoord(city.hotelLat, city.hotelLon)) {
          errors.push(`Ciudad ${city.name || idx + 1}: coordenadas del hotel invalidas`);
        }
        if (city.startDate && !isValidDate(city.startDate)) {
          errors.push(`Ciudad ${city.name || idx + 1}: fecha de inicio invalida`);
        }
        if (city.endDate && !isValidDate(city.endDate)) {
          errors.push(`Ciudad ${city.name || idx + 1}: fecha de fin invalida`);
        }

        if (!city.days || !Array.isArray(city.days)) return;

        city.days.forEach((day, dayIdx) => {
          if (!day.stops || !Array.isArray(day.stops)) return;

          if (day.stops.length > maxStopsPerDay) {
            errors.push(`Ciudad ${city.name}: dia ${dayIdx + 1}: demasiados stops (max ${maxStopsPerDay})`);
          }

          day.stops.forEach((stop, stopIdx) => {
            if (stop.name && stop.name.length > maxStringLength) {
              errors.push(`Stop ${stopIdx + 1}: nombre muy largo`);
            }
            if (stop.address && stop.address.length > maxAddressLength) {
              errors.push(`Stop ${stopIdx + 1}: direccion muy larga`);
            }
            if (stop.lat && stop.lon && !isValidCoord(stop.lat, stop.lon)) {
              errors.push(`Stop ${stop.name || stopIdx + 1}: coordenadas invalidas`);
            }
          });
        });
      });
    }

    if (trip.tickets && Array.isArray(trip.tickets)) {
      if (trip.tickets.length > maxTicketsPerTrip) {
        errors.push(`Demasiados tickets (max ${maxTicketsPerTrip})`);
      }

      trip.tickets.forEach((ticket, idx) => {
        if (ticket.fromCity && ticket.fromCity.length > maxCityNameLength) {
          errors.push(`Ticket ${idx + 1}: ciudad de origen muy larga`);
        }
        if (ticket.toCity && ticket.toCity.length > maxCityNameLength) {
          errors.push(`Ticket ${idx + 1}: ciudad de destino muy larga`);
        }
      });
    }

    return { valid: errors.length === 0, errors };
  }

  function sanitizeTripData(trip, limits) {
    if (!trip) return trip;

    const {
      maxStringLength,
      maxTripNameLength,
      maxCityNameLength,
      maxAddressLength,
      maxNoteLength
    } = limits;

    if (trip.name) trip.name = trip.name.trim().slice(0, maxTripNameLength);

    if (trip.cities && Array.isArray(trip.cities)) {
      trip.cities.forEach(city => {
        if (city.name) city.name = utils.sanitizeCityName(city.name, maxCityNameLength);
        if (city.hotelName) city.hotelName = utils.sanitizeInput(city.hotelName, maxCityNameLength);
        if (city.hotelAddr) city.hotelAddr = utils.sanitizeAddress(city.hotelAddr, maxAddressLength);
        if (city.note) city.note = utils.sanitizeNote(city.note, maxNoteLength);

        if (!city.days || !Array.isArray(city.days)) return;

        city.days.forEach(day => {
          if (!day.stops || !Array.isArray(day.stops)) return;

          day.stops.forEach(stop => {
            if (stop.name) stop.name = utils.sanitizeInput(stop.name, maxStringLength);
            if (stop.address) stop.address = utils.sanitizeAddress(stop.address, maxAddressLength);
            if (stop.note) stop.note = utils.sanitizeNote(stop.note, maxNoteLength);
            if (stop.category) stop.category = utils.sanitizeInput(stop.category, 30);
            if (stop.transport) stop.transport = utils.sanitizeInput(stop.transport, 20);
          });
        });
      });
    }

    if (trip.tickets && Array.isArray(trip.tickets)) {
      trip.tickets.forEach(ticket => {
        if (ticket.company) ticket.company = utils.sanitizeInput(ticket.company, 50);
        if (ticket.fromCity) ticket.fromCity = utils.sanitizeCityName(ticket.fromCity, maxCityNameLength);
        if (ticket.toCity) ticket.toCity = utils.sanitizeCityName(ticket.toCity, maxCityNameLength);
        if (ticket.depTerminal) ticket.depTerminal = utils.sanitizeAddress(ticket.depTerminal, maxAddressLength);
        if (ticket.arrTerminal) ticket.arrTerminal = utils.sanitizeAddress(ticket.arrTerminal, maxAddressLength);
        if (ticket.depGate) ticket.depGate = utils.sanitizeInput(ticket.depGate, 20);
        if (ticket.arrGate) ticket.arrGate = utils.sanitizeInput(ticket.arrGate, 20);
      });
    }

    return trip;
  }

  utils.isValidCoord = isValidCoord;
  utils.isValidDate = isValidDate;
  utils.isValidTime = isValidTime;
  utils.validateTripData = validateTripData;
  utils.sanitizeTripData = sanitizeTripData;
})(window);
