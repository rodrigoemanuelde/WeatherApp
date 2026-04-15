(function (global) {
  const renderNs = global.WandrRender = global.WandrRender || {};

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

  renderNs.renderTickets = renderTickets;
  renderNs.calcWaitTime = calcWaitTime;
  renderNs.calcDuration = calcDuration;
  renderNs.renderTicketCard = renderTicketCard;
  renderNs.renderTransitCard = renderTransitCard;
})(window);
