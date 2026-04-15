(function (global) {
  const renderNs = global.WandrRender = global.WandrRender || {};

  function initDragDrop(containerSelector, callbacks) {
    // Phase 1.2: Parameter validation
    if (typeof containerSelector !== 'string') {
      console.error('[DragDrop] containerSelector must be a string');
      return;
    }
    if (!callbacks || typeof callbacks !== 'object') {
      console.error('[DragDrop] callbacks object required');
      return;
    }
    if (typeof callbacks.getItems !== 'function' || typeof callbacks.persistOrder !== 'function') {
      console.error('[DragDrop] callbacks must include getItems and persistOrder functions');
      return;
    }

    // Find container
    const list = document.querySelector(containerSelector);
    if (!list) {
      console.warn('[DragDrop] Container element not found:', containerSelector);
      return;
    }

    // Phase 1.1: Closure state isolation
    let dragEl = null;
    let ghost = null;
    let startY = 0;
    let offsetY = 0;
    let lastOver = null;
    let isDragging = false;

    // ──────────────────────────────────────
    // Phase 2.1: Helper — getClientY
    // ──────────────────────────────────────
    function getClientY(e) {
      return e.touches ? e.touches[0].clientY : e.clientY;
    }

    // ──────────────────────────────────────
    // Phase 2.2: Helper — createGhost
    // ──────────────────────────────────────
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

    // ──────────────────────────────────────
    // Phase 2.3: Handler — onDragStart
    // ──────────────────────────────────────
    function onDragStart(e) {
      const handle = e.target.closest('.drag-handle');
      if (!handle) return;
      const item = handle.closest('.stop-item[data-stopid]');
      if (!item) return;

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

    // ──────────────────────────────────────
    // Phase 2.4: Handler — onDragMove
    // ──────────────────────────────────────
    function onDragMove(e) {
      if (!dragEl || !ghost || !isDragging) return;
      e.preventDefault();

      const clientY = getClientY(e);
      ghost.style.top = (clientY - offsetY) + 'px';

      const items = callbacks.getItems();
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

    // ──────────────────────────────────────
    // Phase 2.5: Handler — onDragEnd
    // ──────────────────────────────────────
    function onDragEnd() {
      if (!dragEl) return;

      // Extract new order from DOM
      const items = callbacks.getItems();
      const newOrder = items.map(el => {
        // Map from data-stopid to stop objects by delegation to getItems callback
        // The caller is responsible for creating the mapping via their persistence callback
        return el.dataset.stopid;
      }).filter(Boolean);

      // Notify persistence layer with new order (caller extracts IDs → stops mapping)
      try {
        callbacks.persistOrder(newOrder);
      } catch (err) {
        console.error('[DragDrop] Error in persistOrder callback:', err);
      }

      // Clear visual state
      dragEl.classList.remove('dragging');
      if (lastOver) lastOver.classList.remove('drag-over');
      if (ghost) {
        ghost.remove();
        ghost = null;
      }

      // Reset closure state
      dragEl = null;
      lastOver = null;
      isDragging = false;

      // Detach listeners
      document.removeEventListener('touchmove', onDragMove);
      document.removeEventListener('touchend', onDragEnd);
      document.removeEventListener('mousemove', onDragMove);
      document.removeEventListener('mouseup', onDragEnd);
    }

    // Attach initial listeners to container
    list.addEventListener('touchstart', onDragStart, { passive: false });
    list.addEventListener('mousedown', onDragStart);
  }

  // Expose API on namespace
  renderNs.DragDrop = {
    init: initDragDrop
  };

}(window));
