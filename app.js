(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ENTITY_WIDTH = 160;
  const HEADER_HEIGHT = 28;
  const ATTR_HEIGHT = 22;
  const DIAMOND_W = 140;
  const DIAMOND_H = 70;
  const IDENT_PAD = 6;
  const MIN_VIEW_W = 300;
  const MAX_VIEW_W = 12000;
  const TYPES = ['entity', 'weak-entity', 'relationship', 'identifying-rel'];
  const SQL_TYPES = ['INT', 'SERIAL', 'VARCHAR', 'TEXT', 'DATE', 'TIMESTAMP', 'DECIMAL', 'BOOLEAN', 'FLOAT'];

  const state = {
    elements: [],
    connections: [],
    nextId: 1,
    selectedId: null,
    selectedIds: [],
    selectedConnId: null,
    tool: 'select',
    connectFromId: null,
    drag: null,
    marquee: null,
    pan: null,
    pinch: null,
    viewBox: { x: -100, y: -50, w: 1800, h: 1200 }
  };

  // Undo keeps whole-diagram snapshots. `last` is the current diagram; typing
  // into the same field within a moment folds into one step instead of one per key.
  const history = { undo: [], redo: [], last: null, key: null, at: 0 };

  const pointers = new Map();
  let lastTap = { id: null, at: 0 };
  let statusTimer = null;
  let svg, elemLayer, connLayer, overlayLayer, propsContent, erInput, schemaOutput;

  function init() {
    svg = document.getElementById('canvas');
    elemLayer = document.getElementById('elements-layer');
    connLayer = document.getElementById('connections-layer');
    overlayLayer = document.getElementById('overlay-layer');
    propsContent = document.getElementById('props-content');
    erInput = document.getElementById('er-input');
    schemaOutput = document.getElementById('schema-output');

    setupToolbar();
    setupMenus();
    setupCanvasEvents();
    setupKeyboard();
    setupResizeHandle();
    setupTextToggle();
    setupTabs();
    setupTextResize();
    window.addEventListener('resize', updateViewBox);
    updateViewBox();
    loadState();
    history.last = docSnapshot();
    updateUndoButtons();
    updateThemeButton();
    showDefaultProps();
    if (state.elements.length) centerView();
  }

  function setupResizeHandle() {
    const handle = document.getElementById('resize-handle');
    const panel = document.getElementById('side-panel');
    dragHandle(handle, () => panel.offsetWidth, (start, dx) => {
      panel.style.width = Math.max(180, Math.min(600, start - dx)) + 'px';
      updateViewBox();
    }, 'x');
  }

  function setupTextToggle() {
    const toggle = document.getElementById('text-toggle');
    const flip = () => {
      const section = document.getElementById('text-section');
      section.classList.toggle('collapsed');
      toggle.setAttribute('aria-expanded', String(!section.classList.contains('collapsed')));
    };
    toggle.addEventListener('click', flip);
    toggle.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); }
    });
  }

  function setupTextResize() {
    const handle = document.getElementById('text-resize-handle');
    const section = document.getElementById('text-section');
    dragHandle(handle, () => {
      if (section.classList.contains('collapsed')) {
        section.classList.remove('collapsed');
        document.getElementById('text-toggle').setAttribute('aria-expanded', 'true');
      }
      return section.offsetHeight;
    }, (start, d) => {
      section.style.height = Math.max(80, Math.min(500, start - d)) + 'px';
    }, 'y');
  }

  // Shared pointer logic for the two panel splitters (mouse, pen or touch).
  function dragHandle(handle, getStart, onMove, axis) {
    handle.addEventListener('pointerdown', e => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const origin = axis === 'x' ? e.clientX : e.clientY;
      const start = getStart();
      handle.classList.add('active');
      const move = ev => onMove(start, (axis === 'x' ? ev.clientX : ev.clientY) - origin);
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        handle.classList.remove('active');
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }

  // ==================== TOOLBAR ====================
  function setupToolbar() {
    document.querySelectorAll('.tbtn[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => setTool(btn.dataset.tool));
    });
    document.getElementById('undo-btn').addEventListener('click', undo);
    document.getElementById('redo-btn').addEventListener('click', redo);
    document.getElementById('delete-btn').addEventListener('click', deleteSelected);
    document.getElementById('layout-btn').addEventListener('click', autoLayout);
    document.getElementById('render-btn').addEventListener('click', parseAndRender);
    document.getElementById('export-png-btn').addEventListener('click', exportPNG);
    document.getElementById('export-svg-btn').addEventListener('click', exportSVG);
    document.getElementById('export-sql-btn').addEventListener('click', exportSQL);
    document.getElementById('save-btn').addEventListener('click', saveFile);
    document.getElementById('open-btn').addEventListener('click', () => document.getElementById('open-input').click());
    document.getElementById('open-input').addEventListener('change', openFile);
    document.getElementById('example-btn').addEventListener('click', () => {
      erInput.value = loadMLBText();
      parseAndRender();
    });
    document.getElementById('theme-btn').addEventListener('click', toggleTheme);
    document.getElementById('zoom-in-btn').addEventListener('click', () => zoomAt(0.8));
    document.getElementById('zoom-out-btn').addEventListener('click', () => zoomAt(1.25));
    document.getElementById('zoom-fit-btn').addEventListener('click', centerView);
    document.getElementById('clear-btn').addEventListener('click', () => {
      if (state.elements.length === 0) return;
      if (!confirm('Clear all elements?')) return;
      state.elements = [];
      state.connections = [];
      clearSelection();
      state.nextId = 1;
      render();
      showDefaultProps();
      saveState();
      setStatus('Canvas cleared. Undo brings it back.');
    });
  }

  // File / Export dropdowns: one open at a time, close on outside click or a choice.
  function setupMenus() {
    const menus = document.querySelectorAll('.tmenu');
    menus.forEach(m => {
      m.addEventListener('toggle', () => {
        if (m.open) menus.forEach(o => { if (o !== m) o.open = false; });
      });
      m.querySelectorAll('.tmenu-list button').forEach(b => b.addEventListener('click', () => { m.open = false; }));
    });
    document.addEventListener('pointerdown', e => {
      if (!e.target.closest('.tmenu')) closeMenus();
    });
  }

  function closeMenus() {
    document.querySelectorAll('.tmenu[open]').forEach(m => { m.open = false; });
  }

  function setTool(tool) {
    state.tool = tool;
    state.connectFromId = null;
    document.querySelectorAll('.tbtn[data-tool]').forEach(b => {
      const on = b.dataset.tool === tool;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    svg.className.baseVal = '';
    if (tool !== 'select') svg.classList.add('tool-' + tool);
    render();
  }

  function isLightTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light';
  }

  // Light is data-theme="light" on <html>, dark is no attribute, saved under the
  // same 'theme' key the rest of j4den.com reads.
  function toggleTheme() {
    const next = isLightTheme() ? 'dark' : 'light';
    if (next === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('theme', next); } catch (e) {}
    updateThemeButton();
  }

  function updateThemeButton() {
    const btn = document.getElementById('theme-btn');
    const light = isLightTheme();
    btn.setAttribute('aria-label', light ? 'Switch to dark theme' : 'Switch to light theme');
    btn.title = light ? 'Switch to dark theme' : 'Switch to light theme';
  }

  function setStatus(msg, isError) {
    const box = document.getElementById('status');
    box.textContent = msg;
    box.classList.toggle('error', !!isError);
    box.classList.add('show');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => box.classList.remove('show'), isError ? 6000 : 2500);
  }

  // ==================== CANVAS EVENTS ====================
  // Pointer events cover mouse, pen and touch. One finger pans or drags,
  // two fingers pinch-zoom.
  function setupCanvasEvents() {
    svg.addEventListener('pointerdown', onPointerDown);
    svg.addEventListener('pointermove', onPointerMove);
    svg.addEventListener('pointerup', onPointerUp);
    svg.addEventListener('pointercancel', onPointerUp);
    svg.addEventListener('wheel', onCanvasWheel, { passive: false });
    svg.addEventListener('contextmenu', e => e.preventDefault());
  }

  function screenToSVG(cx, cy) {
    const r = svg.getBoundingClientRect();
    return {
      x: state.viewBox.x + (cx - r.left) / r.width * state.viewBox.w,
      y: state.viewBox.y + (cy - r.top) / r.height * state.viewBox.h
    };
  }

  function onPointerDown(e) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { svg.setPointerCapture(e.pointerId); } catch (err) {}
    svg.focus({ preventScroll: true });

    if (pointers.size === 2) {
      // second finger: whatever the first one started becomes a pinch
      if (state.drag) { state.drag = null; saveState(); }
      if (state.marquee) { state.marquee = null; drawMarquee(); }
      state.pan = null;
      const [a, b] = [...pointers.values()];
      state.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, vb: { ...state.viewBox } };
      return;
    }
    if (pointers.size > 2) return;

    const svgPt = screenToSVG(e.clientX, e.clientY);
    const elemG = e.target.closest('.er-element');
    const connG = e.target.closest('.er-connection');

    if (e.button === 0) {
      if (elemG) {
        const id = parseInt(elemG.dataset.id);
        if (state.tool === 'connect') {
          handleConnectClick(id);
        } else if (e.shiftKey) {
          toggleSelected(id);
        } else {
          const now = Date.now();
          const again = lastTap.id === id && now - lastTap.at < 400;
          lastTap = { id, at: now };
          // pressing one of several selected keeps the group so they drag together;
          // if it turns out to be just a click, pointerup narrows down to that one
          const inGroup = isSelected(id) && state.selectedIds.length > 1;
          if (!inGroup) selectElement(id);
          state.drag = {
            startX: svgPt.x, startY: svgPt.y, moved: false, clickOnly: inGroup ? id : null,
            items: state.selectedIds.map(i => { const el = getElement(i); return { id: i, origX: el.x, origY: el.y }; })
          };
          if (again) focusNameField();
        }
        return;
      }
      if (connG) {
        selectConnection(parseInt(connG.dataset.connId));
        return;
      }
      // Empty canvas
      if (state.tool === 'select' && e.shiftKey) {
        startMarquee(svgPt);
      } else if (state.tool === 'select' || state.tool === 'connect') {
        startPan(e);
        deselectAll();
      } else {
        placeElement(state.tool, svgPt.x, svgPt.y);
        setTool('select');
      }
    } else if (e.button === 1 || e.button === 2) {
      startPan(e);
      e.preventDefault();
    }
  }

  function startPan(e) {
    state.pan = { startX: e.clientX, startY: e.clientY, startVB: { ...state.viewBox } };
    svg.classList.add('panning');
  }

  // Shift+drag on empty canvas draws a box; everything it touches gets selected.
  function startMarquee(pt) {
    state.marquee = { x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y };
    drawMarquee();
  }

  function marqueeRect() {
    const m = state.marquee;
    return { x: Math.min(m.x0, m.x1), y: Math.min(m.y0, m.y1), w: Math.abs(m.x1 - m.x0), h: Math.abs(m.y1 - m.y0) };
  }

  function drawMarquee() {
    let r = overlayLayer.querySelector('.marquee');
    if (!state.marquee) { if (r) r.remove(); return; }
    if (!r) r = createSVG('rect', { class: 'marquee' }, overlayLayer);
    const b = marqueeRect();
    r.setAttribute('x', b.x); r.setAttribute('y', b.y);
    r.setAttribute('width', b.w); r.setAttribute('height', b.h);
  }

  function finishMarquee() {
    const b = marqueeRect();
    state.marquee = null;
    drawMarquee();
    const hits = state.elements.filter(el => {
      const e = elemBox(el);
      return e.x < b.x + b.w && e.x + e.w > b.x && e.y < b.y + b.h && e.y + e.h > b.y;
    }).map(el => el.id);
    if (hits.length) setSelection(hits);
    else deselectAll();
  }

  // Dragging only moves the groups that changed and redraws the lines, instead
  // of rebuilding every element on every pointer event.
  function renderMoved(moved) {
    moved.forEach(el => {
      const g = elemLayer.querySelector(`.er-element[data-id="${el.id}"]`);
      if (g) g.setAttribute('transform', `translate(${el.x}, ${el.y})`);
    });
    renderConnections();
  }

  function onPointerMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (state.pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const p = state.pinch;
      const r = svg.getBoundingClientRect();
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const w = clamp(p.vb.w * p.dist / dist, MIN_VIEW_W, MAX_VIEW_W);
      const h = w * p.vb.h / p.vb.w;
      // keep the diagram point that was under the fingers under them
      const ax = p.vb.x + (p.mx - r.left) / r.width * p.vb.w;
      const ay = p.vb.y + (p.my - r.top) / r.height * p.vb.h;
      state.viewBox = { x: ax - (mx - r.left) / r.width * w, y: ay - (my - r.top) / r.height * h, w, h };
      updateViewBox();
      return;
    }
    if (state.pan) {
      const r = svg.getBoundingClientRect();
      const dx = (e.clientX - state.pan.startX) / r.width * state.pan.startVB.w;
      const dy = (e.clientY - state.pan.startY) / r.height * state.pan.startVB.h;
      state.viewBox.x = state.pan.startVB.x - dx;
      state.viewBox.y = state.pan.startVB.y - dy;
      updateViewBox();
      return;
    }
    if (state.marquee) {
      const svgPt = screenToSVG(e.clientX, e.clientY);
      state.marquee.x1 = svgPt.x; state.marquee.y1 = svgPt.y;
      drawMarquee();
      return;
    }
    if (state.drag) {
      const svgPt = screenToSVG(e.clientX, e.clientY);
      const dx = svgPt.x - state.drag.startX, dy = svgPt.y - state.drag.startY;
      const moved = [];
      state.drag.items.forEach(it => {
        const el = getElement(it.id);
        if (!el) return;
        const nx = Math.round((it.origX + dx) / 10) * 10;
        const ny = Math.round((it.origY + dy) / 10) * 10;
        if (nx !== el.x || ny !== el.y) { el.x = nx; el.y = ny; moved.push(el); }
      });
      if (moved.length) { state.drag.moved = true; renderMoved(moved); }
    }
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    if (state.pinch) {
      if (pointers.size < 2) state.pinch = null;
      return;
    }
    if (state.drag) {
      const d = state.drag;
      state.drag = null;
      // a click on one element of a group, with no drag, means "just this one"
      if (!d.moved && d.clickOnly !== null) selectElement(d.clickOnly);
      else saveState();  // a plain click leaves the snapshot alone, so no undo step
    }
    if (state.marquee) finishMarquee();
    state.pan = null;
    svg.classList.remove('panning');
  }

  function onCanvasWheel(e) {
    e.preventDefault();
    // proportional to the scroll distance, so trackpads don't zoom ten steps per flick
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomAt(Math.exp(clamp(delta, -100, 100) * 0.002), e.clientX, e.clientY);
  }

  // factor < 1 zooms in. Anchored on a screen point, or the canvas centre.
  function zoomAt(factor, cx, cy) {
    const r = svg.getBoundingClientRect();
    if (cx === undefined) { cx = r.left + r.width / 2; cy = r.top + r.height / 2; }
    const pt = screenToSVG(cx, cy);
    const w = clamp(state.viewBox.w * factor, MIN_VIEW_W, MAX_VIEW_W);
    const f = w / state.viewBox.w;
    state.viewBox.x = pt.x - (pt.x - state.viewBox.x) * f;
    state.viewBox.y = pt.y - (pt.y - state.viewBox.y) * f;
    state.viewBox.w = w;
    state.viewBox.h *= f;
    updateViewBox();
  }

  // The viewBox always takes the canvas's own aspect ratio. Before, it stayed
  // 3:2 while the canvas didn't, so the browser letterboxed it and clicks
  // landed away from the cursor.
  function updateViewBox() {
    const v = state.viewBox;
    const r = svg.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) v.h = v.w * r.height / r.width;
    svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
  }

  function centerView() {
    if (state.elements.length === 0) {
      state.viewBox = { x: -100, y: -50, w: 1800, h: 1200 };
      updateViewBox();
      return;
    }
    const b = diagramBounds();
    const pad = 80;
    const cw = b.maxX - b.minX + pad * 2;
    const ch = b.maxY - b.minY + pad * 2;
    const r = svg.getBoundingClientRect();
    const aspect = r.width && r.height ? r.width / r.height : 1.5;
    let vw, vh;
    if (cw / ch > aspect) { vw = cw; vh = cw / aspect; }
    else { vh = ch; vw = ch * aspect; }
    vw = Math.max(vw, MIN_VIEW_W);
    state.viewBox = {
      x: b.minX - pad - (vw - cw) / 2,
      y: b.minY - pad - (vh - ch) / 2,
      w: vw, h: vh
    };
    updateViewBox();
  }

  function diagramBounds() {
    return boundsOf(state.elements);
  }

  function boundsOf(elements) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    elements.forEach(el => {
      const b = elemBox(el);
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    });
    return { minX, minY, maxX, maxY };
  }

  function isEntity(el) { return el.type === 'entity' || el.type === 'weak-entity'; }

  function entityHeight(el) {
    return HEADER_HEIGHT + Math.max((el.attributes || []).length * ATTR_HEIGHT, ATTR_HEIGHT);
  }

  // The rectangle an element actually paints, outer border included, so
  // fitting, exporting, box-selecting and aligning all agree on its edges.
  function elemBox(el) {
    const attrs = el.attributes || [];
    if (isEntity(el)) {
      const pad = el.type === 'weak-entity' ? 3 : 0;
      return { x: el.x - pad, y: el.y - pad, w: entityWidth(el) + pad * 2, h: entityHeight(el) + pad * 2 };
    }
    const dw = diamondWidth(el);
    const pad = el.type === 'identifying-rel' ? IDENT_PAD : 0;
    let widest = dw + pad * 2;
    attrs.forEach(a => { widest = Math.max(widest, relAttrWidth(a)); });
    // attribute boxes hang under the diamond, 20px each, starting 3px below it
    const bottom = attrs.length ? DIAMOND_H + 3 + attrs.length * 20 : DIAMOND_H + pad;
    return { x: el.x + dw / 2 - widest / 2, y: el.y - pad, w: widest, h: bottom + pad };
  }

  // ==================== TEXT MEASURING ====================
  let measureCtx = null, measureFont = '';
  function textWidth(text, size, weight) {
    if (!measureCtx) {
      measureCtx = document.createElement('canvas').getContext('2d');
      measureFont = getComputedStyle(document.body).fontFamily;
    }
    measureCtx.font = `italic ${weight || 'normal'} ${size}px ${measureFont}`;
    return measureCtx.measureText(String(text)).width;
  }

  function attrLabel(attr) {
    let dn = attr.name;
    if (attr.multivalued) dn = '{' + dn + '}';
    if (attr.derived) dn = dn + '()';
    return dn;
  }

  // Entities grow to fit long names instead of letting text spill out the side.
  function entityWidth(el) {
    let w = Math.max(ENTITY_WIDTH, textWidth(el.name, 13, 600) + 24);
    (el.attributes || []).forEach(a => { w = Math.max(w, textWidth(attrLabel(a), 12) + 22); });
    return Math.ceil(w / 10) * 10;
  }

  function relAttrWidth(attr) {
    return Math.max(textWidth(attr.name, 10) + 16, 70);
  }

  // A diamond narrows above and below its centre line, so a long name needs
  // more than its own width of room.
  function diamondWidth(el) {
    return Math.max(DIAMOND_W, Math.ceil((textWidth(el.name, 11) * 1.2 + 30) / 10) * 10);
  }

  // ==================== KEYBOARD ====================
  function setupKeyboard() {
    document.addEventListener('keydown', e => {
      const t = e.target;
      const typing = t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

      if (mod && !e.altKey && (key === 'z' || key === 'y')) {
        if (typing) return;  // leave text fields their own undo
        e.preventDefault();
        if (key === 'y' || e.shiftKey) redo(); else undo();
        return;
      }
      if (mod && !e.altKey && !typing && (key === 'a' || key === 'd')) {
        e.preventDefault();
        if (key === 'a') setSelection(state.elements.map(el => el.id));
        else duplicateSelected();
        return;
      }
      if (key === 'Escape') {
        closeMenus();
        if (!typing) { deselectAll(); setTool('select'); }
        return;
      }
      // Cmd+C / Ctrl+V used to switch tools; only bare keys are shortcuts now
      if (typing || mod || e.altKey) return;
      // Space and Enter belong to whatever button has focus
      const onControl = t.tagName === 'BUTTON' || t.tagName === 'SUMMARY' || t.getAttribute('role') === 'button';
      if (onControl && (key === ' ' || key === 'Enter')) return;

      const tools = { v: 'select', c: 'connect', e: 'entity', w: 'weak-entity', r: 'relationship', i: 'identifying-rel' };
      const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (key === 'Delete' || key === 'Backspace') {
        if (state.selectedIds.length || state.selectedConnId !== null) { e.preventDefault(); deleteSelected(); }
      } else if (tools[key]) {
        setTool(tools[key]);
      } else if (key === ' ') {
        e.preventDefault(); centerView();
      } else if (key === '+' || key === '=') {
        zoomAt(0.8);
      } else if (key === '-' || key === '_') {
        zoomAt(1.25);
      } else if (key === ']' || key === '[') {
        cycleSelection(key === ']' ? 1 : -1);
      } else if (key === 'l') {
        autoLayout();
      } else if (nudge[key] && state.selectedIds.length) {
        e.preventDefault();
        const step = e.shiftKey ? 50 : 10;
        state.selectedIds.forEach(id => {
          const el = getElement(id);
          el.x += nudge[key][0] * step;
          el.y += nudge[key][1] * step;
        });
        render();
        saveState('nudge-' + state.selectedIds.join(','));
      }
    });
  }

  function cycleSelection(dir) {
    if (!state.elements.length) return;
    const cur = state.selectedIds.length ? state.selectedIds[state.selectedIds.length - 1] : null;
    const i = state.elements.findIndex(e => e.id === cur);
    const next = state.elements[(i + dir + state.elements.length) % state.elements.length];
    selectElement(next.id);
    setStatus(next.name + ' selected');
  }

  // ==================== ELEMENTS ====================
  function getElement(id) { return state.elements.find(e => e.id === id); }
  function getConnection(id) { return state.connections.find(c => c.id === id); }

  function newAttr(name, pk) {
    return { name, pk: !!pk, discriminator: false, multivalued: false, derived: false, dataType: '' };
  }

  function placeElement(type, x, y) {
    const el = {
      id: state.nextId++, type, x: Math.round(x / 10) * 10, y: Math.round(y / 10) * 10,
      name: isEntity({ type }) ? 'Entity' : 'Rel',
      attributes: []
    };
    if (isEntity(el)) el.attributes.push(newAttr('id', true));
    state.elements.push(el);
    selectElement(el.id);
    render(); saveState();
  }

  function deleteSelected() {
    if (state.selectedIds.length) {
      const gone = new Set(state.selectedIds);
      state.connections = state.connections.filter(c => !gone.has(c.fromId) && !gone.has(c.toId));
      state.elements = state.elements.filter(e => !gone.has(e.id));
      state.selectedId = null; state.selectedIds = [];
    } else if (state.selectedConnId !== null) {
      state.connections = state.connections.filter(c => c.id !== state.selectedConnId);
      state.selectedConnId = null;
    } else {
      return;
    }
    showDefaultProps(); render(); saveState();
  }

  // selectedIds is every selected element; selectedId is the single one whose
  // properties are showing, or null when several are selected at once.
  function setSelection(ids) {
    state.selectedIds = ids.filter(id => getElement(id));
    state.selectedId = state.selectedIds.length === 1 ? state.selectedIds[0] : null;
    state.selectedConnId = null;
    render();
    if (state.selectedId !== null) showElementProps(getElement(state.selectedId));
    else if (state.selectedIds.length) showMultiProps();
    else showDefaultProps();
  }

  function selectElement(id) { setSelection([id]); }

  function isSelected(id) { return state.selectedIds.includes(id); }

  function toggleSelected(id) {
    const ids = state.selectedIds.filter(i => i !== id);
    if (ids.length === state.selectedIds.length) ids.push(id);
    setSelection(ids);
  }

  function selectConnection(id) {
    state.selectedConnId = id; state.selectedId = null; state.selectedIds = [];
    render();
    const conn = getConnection(id);
    if (conn) showConnectionProps(conn);
  }

  function clearSelection() {
    state.selectedId = null; state.selectedIds = []; state.selectedConnId = null; state.connectFromId = null;
  }

  function deselectAll() {
    const had = state.selectedIds.length || state.selectedConnId !== null || state.connectFromId !== null;
    clearSelection();
    if (had) { showDefaultProps(); render(); }
  }

  function focusNameField() {
    const inp = document.getElementById('prop-name');
    if (inp) { inp.focus(); inp.select(); }
  }

  function duplicateSelected() {
    if (!state.selectedIds.length) return;
    const newId = {};
    const copies = state.selectedIds.map(id => {
      const copy = JSON.parse(JSON.stringify(getElement(id)));
      copy.id = state.nextId++;
      copy.x += 40; copy.y += 40;
      newId[id] = copy.id;
      return copy;
    });
    state.elements.push(...copies);
    // a line between two copied elements comes along too
    state.connections.filter(c => newId[c.fromId] && newId[c.toId]).forEach(c => {
      state.connections.push({ ...c, id: state.nextId++, fromId: newId[c.fromId], toId: newId[c.toId] });
    });
    setSelection(copies.map(c => c.id));
    saveState();
    setStatus(copies.length === 1 ? 'Duplicated ' + copies[0].name : 'Duplicated ' + copies.length + ' elements');
  }

  // Align and distribute use the painted boxes, so a weak entity's outer border counts.
  function alignSelected(how) {
    const els = state.selectedIds.map(id => getElement(id));
    const b = boundsOf(els);
    els.forEach(el => {
      const box = elemBox(el);
      if (how === 'left') el.x += b.minX - box.x;
      if (how === 'right') el.x += b.maxX - (box.x + box.w);
      if (how === 'center') el.x += (b.minX + b.maxX) / 2 - (box.x + box.w / 2);
      if (how === 'top') el.y += b.minY - box.y;
      if (how === 'bottom') el.y += b.maxY - (box.y + box.h);
      if (how === 'middle') el.y += (b.minY + b.maxY) / 2 - (box.y + box.h / 2);
      el.x = Math.round(el.x); el.y = Math.round(el.y);
    });
    render(); saveState();
  }

  // Even gaps between neighbours along one axis; the two on the outside stay put.
  function distributeSelected(axis) {
    const els = state.selectedIds.map(id => getElement(id));
    if (els.length < 3) return;
    const pos = axis === 'x' ? 'x' : 'y', size = axis === 'x' ? 'w' : 'h';
    const items = els.map(el => ({ el, box: elemBox(el) })).sort((a, b) => a.box[pos] - b.box[pos]);
    const first = items[0].box, last = items[items.length - 1].box;
    const span = last[pos] + last[size] - first[pos];
    const used = items.reduce((sum, it) => sum + it.box[size], 0);
    const gap = (span - used) / (items.length - 1);
    let cursor = first[pos];
    items.forEach(it => {
      it.el[pos] += Math.round(cursor - it.box[pos]);
      cursor += it.box[size] + gap;
    });
    render(); saveState();
  }

  function handleConnectClick(id) {
    if (state.connectFromId === null) {
      state.connectFromId = id; render();
      setStatus('Now click the second element');
    } else if (state.connectFromId !== id) {
      const conn = { id: state.nextId++, fromId: state.connectFromId, toId: id,
        arrowFrom: false, arrowTo: false, isDouble: false, label: '', dashed: false };
      state.connections.push(conn);
      state.connectFromId = null;
      selectConnection(conn.id); saveState();
    }
  }

  // ==================== RENDERING ====================
  function render() {
    while (elemLayer.firstChild) elemLayer.removeChild(elemLayer.firstChild);
    renderConnections();
    state.elements.forEach(el => elemLayer.appendChild(renderElement(el)));
  }

  function renderConnections() {
    while (connLayer.firstChild) connLayer.removeChild(connLayer.firstChild);
    state.connections.forEach(c => { const g = renderConnection(c); if (g) connLayer.appendChild(g); });
  }

  function renderElement(el) {
    const g = createSVG('g', {
      class: 'er-element' + (isSelected(el.id) ? ' selected' : '') +
        (el.id === state.connectFromId ? ' connect-highlight' : ''),
      'data-id': el.id, transform: `translate(${el.x}, ${el.y})`
    });
    if (isEntity(el)) renderEntityShape(g, el);
    else renderRelShape(g, el);
    return g;
  }

  function renderEntityShape(g, el) {
    const attrs = el.attributes || [];
    const bodyH = Math.max(attrs.length * ATTR_HEIGHT, ATTR_HEIGHT);
    const totalH = HEADER_HEIGHT + bodyH;
    const w = entityWidth(el);
    if (el.type === 'weak-entity')
      createSVG('rect', { class: 'shape', x: -3, y: -3, width: w + 6, height: totalH + 6, fill: 'white', stroke: '#333', 'stroke-width': 1.5, rx: 1 }, g);
    createSVG('rect', { class: 'shape', x: 0, y: 0, width: w, height: totalH, fill: 'white', stroke: '#333', 'stroke-width': 1.5, rx: 1 }, g);
    createSVG('rect', { class: 'hdr', x: 0, y: 0, width: w, height: HEADER_HEIGHT, fill: '#B8D4E8', stroke: 'none', rx: 1 }, g);
    createSVG('line', { class: 'ink', x1: 0, y1: HEADER_HEIGHT, x2: w, y2: HEADER_HEIGHT, stroke: '#333', 'stroke-width': 1 }, g);
    createSVG('text', { class: 'lbl', x: w / 2, y: HEADER_HEIGHT / 2 + 1, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'font-size': '13px', 'font-style': 'italic', 'font-weight': '600', fill: '#222' }, g).textContent = el.name;
    attrs.forEach((attr, i) => {
      const y = HEADER_HEIGHT + 15 + i * ATTR_HEIGHT;
      const dn = attrLabel(attr);
      createSVG('text', { class: 'lbl', x: 10, y, 'font-size': '12px', fill: '#333', 'font-style': 'italic' }, g).textContent = dn;
      if (attr.pk || attr.discriminator) {
        // measured, so the underline matches the word instead of guessing 7px a letter
        const line = { class: 'ink', x1: 10, y1: y + 3, x2: 10 + textWidth(dn, 12), y2: y + 3, stroke: '#333', 'stroke-width': 1 };
        if (attr.discriminator && !attr.pk) line['stroke-dasharray'] = '4,2';
        createSVG('line', line, g);
      }
    });
  }

  function renderRelShape(g, el) {
    const dw = diamondWidth(el);
    const hw = dw / 2, hh = DIAMOND_H / 2;
    const pts = `${hw},0 ${dw},${hh} ${hw},${DIAMOND_H} 0,${hh}`;
    if (el.type === 'identifying-rel') {
      const op = `${hw},${-IDENT_PAD} ${dw + IDENT_PAD},${hh} ${hw},${DIAMOND_H + IDENT_PAD} ${-IDENT_PAD},${hh}`;
      createSVG('polygon', { class: 'rel', points: op, fill: '#D4E8D4', stroke: '#333', 'stroke-width': 1.5 }, g);
    }
    createSVG('polygon', { class: 'rel', points: pts, fill: '#D4E8D4', stroke: '#333', 'stroke-width': 1.5 }, g);
    createSVG('text', { class: 'lbl', x: hw, y: hh + 1, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'font-size': '11px', 'font-style': 'italic', fill: '#222' }, g).textContent = el.name;
    (el.attributes || []).forEach((attr, i) => {
      const ay = DIAMOND_H + 15 + i * 20;
      // the boxes stack edge to edge, so only the first needs a tether
      if (i === 0) createSVG('line',{ class: 'ink', x1: hw, y1: DIAMOND_H, x2: hw, y2: ay - 8, stroke: '#666', 'stroke-width': 1, 'stroke-dasharray': '4,3' }, g);
      const aw = relAttrWidth(attr);
      createSVG('rect', { class: 'attr-box', x: hw - aw / 2, y: ay - 12, width: aw, height: 20, fill: 'white', stroke: '#666', 'stroke-width': 1, rx: 2 }, g);
      createSVG('text', { class: 'soft', x: hw, y: ay + 1, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
        'font-size': '10px', 'font-style': 'italic', fill: '#444' }, g).textContent = attr.name;
    });
  }

  function getElementCenter(el) {
    if (isEntity(el)) return { x: el.x + entityWidth(el) / 2, y: el.y + entityHeight(el) / 2 };
    return { x: el.x + diamondWidth(el) / 2, y: el.y + DIAMOND_H / 2 };
  }

  function getEdgePt(el, tx, ty) {
    const c = getElementCenter(el);
    const dx = tx - c.x, dy = ty - c.y;
    if (dx === 0 && dy === 0) return c;
    if (isEntity(el)) {
      const hw = entityWidth(el) / 2 + (el.type === 'weak-entity' ? 3 : 0);
      const hh = entityHeight(el) / 2 + (el.type === 'weak-entity' ? 3 : 0);
      const t = Math.abs(dx) * hh > Math.abs(dy) * hw ? hw / Math.abs(dx) : hh / Math.abs(dy);
      return { x: c.x + dx * t, y: c.y + dy * t };
    }
    const hw = diamondWidth(el) / 2 + (el.type === 'identifying-rel' ? IDENT_PAD : 0);
    const hh = DIAMOND_H / 2 + (el.type === 'identifying-rel' ? IDENT_PAD : 0);
    const t = 1.0 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
    return { x: c.x + dx * t, y: c.y + dy * t };
  }

  function renderConnection(conn) {
    const fromEl = getElement(conn.fromId), toEl = getElement(conn.toId);
    if (!fromEl || !toEl) return null;
    const fc = getElementCenter(fromEl), tc = getElementCenter(toEl);
    const fp = getEdgePt(fromEl, tc.x, tc.y), tp = getEdgePt(toEl, fc.x, fc.y);
    const g = createSVG('g', { class: 'er-connection' + (conn.id === state.selectedConnId ? ' selected' : ''), 'data-conn-id': conn.id });
    createSVG('line', { class: 'hit', x1: fp.x, y1: fp.y, x2: tp.x, y2: tp.y, stroke: 'transparent', 'stroke-width': 14 }, g);
    if (conn.isDouble) {
      const dx = tp.x - fp.x, dy = tp.y - fp.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = -dy / len * 2.5, ny = dx / len * 2.5;
      createSVG('line', { class: 'ink', x1: fp.x + nx, y1: fp.y + ny, x2: tp.x + nx, y2: tp.y + ny, stroke: '#333', 'stroke-width': 1.5 }, g);
      createSVG('line', { class: 'ink', x1: fp.x - nx, y1: fp.y - ny, x2: tp.x - nx, y2: tp.y - ny, stroke: '#333', 'stroke-width': 1.5 }, g);
    } else {
      const a = { class: 'ink', x1: fp.x, y1: fp.y, x2: tp.x, y2: tp.y, stroke: '#333', 'stroke-width': 1.5 };
      if (conn.dashed) a['stroke-dasharray'] = '6,4';
      createSVG('line', a, g);
    }
    if (conn.arrowTo) drawArrow(g, fp.x, fp.y, tp.x, tp.y);
    if (conn.arrowFrom) drawArrow(g, tp.x, tp.y, fp.x, fp.y);
    if (conn.label) {
      const mx = (fp.x + tp.x) / 2, my = (fp.y + tp.y) / 2;
      const dx = tp.x - fp.x, dy = tp.y - fp.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
      createSVG('text', { class: 'soft', x: mx + (-dy / len * 14), y: my + (dx / len * 14),
        'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': '12px', fill: '#666', 'font-weight': '600' }, g).textContent = conn.label;
    }
    return g;
  }

  function drawArrow(parent, fx, fy, tx, ty) {
    const dx = tx - fx, dy = ty - fy, len = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux = dx / len, uy = dy / len, sz = 10;
    const bx = tx - ux * sz, by = ty - uy * sz;
    createSVG('polygon', { class: 'ink-fill', points: `${tx},${ty} ${bx - uy * sz * 0.5},${by + ux * sz * 0.5} ${bx + uy * sz * 0.5},${by - ux * sz * 0.5}`, fill: '#333' }, parent);
  }

  // ==================== TEXT PARSER ====================
  function parseAndRender() {
    const text = erInput.value;
    if (!text.trim()) { setStatus('Type or paste some ER notation first.', true); return; }
    const result = parseERText(text);
    if (!result.entityCount) {
      setStatus('No ENTITY or WEAK lines found. ' + (result.problems[0] || ''), true);
      return;
    }
    state.elements = result.elements;
    state.connections = result.connections;
    state.nextId = result.nextId;
    clearSelection();
    render();
    showDefaultProps();
    centerView();
    saveState();
    const summary = `Rendered ${result.entityCount} entities and ${result.relCount} relationships.`;
    if (result.problems.length) {
      const more = result.problems.length > 1 ? ` (+${result.problems.length - 1} more)` : '';
      setStatus(summary + ' Skipped ' + result.problems[0] + more, true);
    } else {
      setStatus(summary + ' Undo brings back the old diagram.');
    }
  }

  // Builds a fresh diagram from the text format without touching state, and
  // reports lines it couldn't use instead of dropping them silently.
  function parseERText(text) {
    const entities = {};
    const rels = [];
    const problems = [];
    let nextId = 1;

    const lines = text.split('\n').map((l, i) => ({ text: l.trim(), num: i + 1 }))
      .filter(l => l.text && !l.text.startsWith('#'));

    // Pass 1: entities
    lines.forEach(l => {
      const m = l.text.match(/^(ENTITY|WEAK)\s+(\w+)\s*(?::\s*(.*))?$/i);
      if (!m) return;
      l.used = true;
      const [, kind, name, attrStr] = m;
      if (entities[name]) { problems.push(`line ${l.num}: ${name} is defined twice`); return; }
      entities[name] = { id: nextId++, type: kind.toUpperCase() === 'WEAK' ? 'weak-entity' : 'entity',
        x: 0, y: 0, name, attributes: parseAttrs(attrStr || '') };
    });

    // Pass 2: relationships
    lines.forEach(l => {
      if (l.used) return;
      const m = l.text.match(/^(REL|IDENT)\s+(\w+)\s*\(\s*(\w+)\s*,\s*(\w+)\s*\)\s*(\S+)\s+(\S+)(?:\s*\[(.*)\])?$/i);
      if (!m) { problems.push(`line ${l.num}: "${l.text.slice(0, 40)}" isn't ENTITY, WEAK, REL or IDENT syntax`); return; }
      const [, relType, name, e1, e2, card, part, attrsStr] = m;
      if (!/^[1MN]:[1MN]$/i.test(card)) { problems.push(`line ${l.num}: cardinality "${card}" should look like 1:N or M:N`); return; }
      if (!/^(partial|total)\/(partial|total)$/i.test(part)) { problems.push(`line ${l.num}: participation "${part}" should look like partial/total`); return; }
      const missing = [e1, e2].filter(n => !entities[n]);
      if (missing.length) { problems.push(`line ${l.num}: ${name} uses undefined ${missing.join(' and ')}`); return; }
      const relAttrs = attrsStr ? attrsStr.split(',').map(a => a.trim()).filter(Boolean).map(a => newAttr(a)) : [];
      rels.push({ relType: relType.toUpperCase(), name, e1, e2, card: card.toUpperCase(), part: part.toLowerCase(), attrs: relAttrs });
    });

    layoutEntities(entities, rels);

    const elements = Object.values(entities);
    const connections = [];
    const placed = [];

    rels.forEach(r => {
      const e1 = entities[r.e1], e2 = entities[r.e2];
      const relEl = {
        id: nextId++,
        type: r.relType === 'IDENT' ? 'identifying-rel' : 'relationship',
        x: 0, y: 0, name: r.name, attributes: r.attrs
      };
      placeRelationship(relEl, e1, e2, placed);
      elements.push(relEl);

      // Cardinality (1:N, M:N, N:1, 1:1): an arrow points at each "one" side
      const [leftCard, rightCard] = r.card.split(':');
      const [leftPart, rightPart] = r.part.split('/');
      connections.push({
        id: nextId++, fromId: e1.id, toId: relEl.id,
        arrowFrom: leftCard === '1', arrowTo: false,
        isDouble: leftPart === 'total', label: '', dashed: false
      });
      connections.push({
        id: nextId++, fromId: relEl.id, toId: e2.id,
        arrowFrom: false, arrowTo: rightCard === '1',
        isDouble: rightPart === 'total', label: '', dashed: false
      });
    });

    return { elements, connections, nextId, problems,
      entityCount: Object.keys(entities).length, relCount: rels.length };
  }

  // A relationship sits halfway between its two entities. `placed` remembers
  // where earlier ones went, so two between the same pair don't stack.
  function placeRelationship(relEl, e1, e2, placed) {
    const c1 = getElementCenter(e1), c2 = getElementCenter(e2);
    const dw = diamondWidth(relEl);
    let rx = Math.round(((c1.x + c2.x) / 2 - dw / 2) / 10) * 10;
    let ry = Math.round(((c1.y + c2.y) / 2 - DIAMOND_H / 2) / 10) * 10;
    // a recursive relationship (both ends on one entity) goes just under it
    if (e1 === e2) ry = Math.round((elemBox(e1).y + elemBox(e1).h + 60) / 10) * 10;
    while (placed.some(p => Math.abs(p.x - rx) < DIAMOND_W && Math.abs(p.y - ry) < DIAMOND_H)) ry += DIAMOND_H + 20;
    placed.push({ x: rx, y: ry });
    relEl.x = rx; relEl.y = ry;
  }

  // Strong entities go in a row, each with its weak entities fanned out above
  // and below. Each slot is as wide as its fan, so neighbouring groups don't
  // land on top of each other. `entities` is keyed however the caller likes
  // (names from the parser, ids from auto-layout); rels refer to those keys.
  function layoutEntities(entities, rels) {
    const GAP_X = 380;
    const weakGroups = {};
    const owned = new Set();
    rels.forEach(r => {
      if (r.relType !== 'IDENT') return;
      const [strong, weak] = entities[r.e1].type === 'weak-entity' ? [r.e2, r.e1] : [r.e1, r.e2];
      if (owned.has(weak) || entities[weak].type !== 'weak-entity' || entities[strong].type === 'weak-entity') return;
      owned.add(weak);
      (weakGroups[strong] = weakGroups[strong] || []).push(weak);
    });

    const names = Object.keys(entities);
    const height = n => elemBox(entities[n]).h;
    let cursor = 0, rowBottom = 0;
    names.filter(n => entities[n].type === 'entity').forEach(n => {
      const group = weakGroups[n] || [];
      const above = group.filter((_, i) => i % 2 === 0);
      const below = group.filter((_, i) => i % 2 === 1);
      const slotW = Math.max(1, above.length, below.length) * GAP_X;
      const se = entities[n];
      se.x = Math.round((cursor + slotW / 2 - entityWidth(se) / 2) / 10) * 10;
      se.y = 0;
      const fan = (list, top) => list.forEach((wn, k) => {
        const we = entities[wn];
        we.x = Math.round((se.x + (k - (list.length - 1) / 2) * GAP_X) / 10) * 10;
        we.y = Math.round((top ? -220 - height(wn) : height(n) + 220) / 10) * 10;
        rowBottom = Math.max(rowBottom, we.y + height(wn));
      });
      fan(above, true);
      fan(below, false);
      rowBottom = Math.max(rowBottom, height(n));
      cursor += slotW + 120;
    });

    // Weak entities with no identifying relationship: a row underneath
    let x = 0;
    names.filter(n => entities[n].type === 'weak-entity' && !owned.has(n)).forEach(n => {
      entities[n].x = x;
      entities[n].y = rowBottom + 200;
      x += GAP_X;
    });
  }

  // ==================== AUTO-LAYOUT ====================
  // Entities a relationship is wired to, one entry per connection, so a
  // recursive relationship lists its entity twice.
  function connectedEntities(rel) {
    const out = [];
    state.connections.forEach(c => {
      if (c.fromId !== rel.id && c.toId !== rel.id) return;
      const other = getElement(c.fromId === rel.id ? c.toId : c.fromId);
      if (other && isEntity(other)) out.push(other);
    });
    return out;
  }

  // Re-runs the parser's layout on whatever is on the canvas. Ids and
  // everything else stay put, only positions change, so one undo reverts it.
  function autoLayout() {
    if (!state.elements.length) { setStatus('Nothing to arrange yet.', true); return; }
    const entities = {};
    state.elements.filter(isEntity).forEach(el => { entities[el.id] = el; });
    const rels = [], loose = [];
    state.elements.filter(el => !isEntity(el)).forEach(rel => {
      const ends = connectedEntities(rel);
      if (ends.length >= 2) {
        rels.push({ relType: rel.type === 'identifying-rel' ? 'IDENT' : 'REL', e1: String(ends[0].id), e2: String(ends[1].id), el: rel });
      } else {
        loose.push(rel);
      }
    });
    layoutEntities(entities, rels);
    const placed = [];
    rels.forEach(r => placeRelationship(r.el, entities[r.e1], entities[r.e2], placed));
    // relationships not wired to two entities line up under everything else
    if (loose.length) {
      const b = boundsOf(state.elements.filter(el => !loose.includes(el)));
      let x = isFinite(b.minX) ? b.minX : 0;
      const y = isFinite(b.maxY) ? Math.round((b.maxY + 100) / 10) * 10 : 0;
      loose.forEach(rel => { rel.x = x; rel.y = y; x += diamondWidth(rel) + 60; });
    }
    render(); centerView(); saveState();
    setStatus('Arranged ' + state.elements.length + ' elements. Undo puts them back.');
  }

  function parseAttrs(str) {
    return str.split(',').map(a => a.trim()).filter(Boolean).map(a => {
      const attr = newAttr(a);
      if (a.startsWith('*')) { attr.pk = true; attr.name = a.slice(1); }
      else if (a.startsWith('~')) { attr.discriminator = true; attr.name = a.slice(1); }
      if (attr.name.startsWith('{') && attr.name.endsWith('}')) {
        attr.multivalued = true; attr.name = attr.name.slice(1, -1);
      }
      if (attr.name.endsWith('()')) { attr.derived = true; attr.name = attr.name.slice(0, -2); }
      const colonIdx = attr.name.indexOf(':');
      if (colonIdx > 0) { attr.dataType = attr.name.slice(colonIdx + 1); attr.name = attr.name.slice(0, colonIdx); }
      return attr;
    });
  }

  // ==================== PROPERTIES ====================
  function showDefaultProps() {
    propsContent.innerHTML = `
      <p class="hint">Click an element to edit it. Double-click to rename.</p>
      <p class="hint hint-head"><b>Tips:</b></p>
      <p class="hint"><kbd>V</kbd> <b>Select</b> &ndash; click to select, drag to move, drag empty space to pan. <kbd>Shift</kbd>+click or <kbd>Shift</kbd>+drag picks several</p>
      <p class="hint"><kbd>C</kbd> <b>Connect</b> &ndash; click first element, then second to draw line</p>
      <p class="hint"><kbd>E</kbd> <kbd>W</kbd> <kbd>R</kbd> <kbd>I</kbd> <b>Entity / Weak / Rel / Ident</b> &ndash; click canvas to place</p>
      <p class="hint"><kbd>Space</kbd> fit view &nbsp; <kbd>+</kbd><kbd>&minus;</kbd> or scroll / pinch to zoom</p>
      <p class="hint"><kbd>[</kbd><kbd>]</kbd> step through elements &nbsp; arrows move, <kbd>Shift</kbd> for bigger steps</p>
      <p class="hint"><kbd>Ctrl/Cmd+Z</kbd> undo &nbsp; <kbd>Ctrl/Cmd+Shift+Z</kbd> redo</p>
      <p class="hint">File &rsaquo; <b>Load MLB example</b> to see the text format in action.</p>`;
  }

  function showElementProps(el) {
    const entity = isEntity(el);
    let html = `<div class="prop-group"><label for="prop-type">Type</label>
      <select id="prop-type">
        <option value="entity" ${el.type === 'entity' ? 'selected' : ''}>Entity</option>
        <option value="weak-entity" ${el.type === 'weak-entity' ? 'selected' : ''}>Weak Entity</option>
        <option value="relationship" ${el.type === 'relationship' ? 'selected' : ''}>Relationship</option>
        <option value="identifying-rel" ${el.type === 'identifying-rel' ? 'selected' : ''}>Ident. Rel.</option>
      </select></div>`;
    html += `<div class="prop-group"><label for="prop-name">Name</label><input type="text" id="prop-name" value="${esc(el.name)}"></div>`;
    html += `<div class="prop-group"><label>Attributes</label><ul class="attr-list" id="attr-list">`;
    (el.attributes || []).forEach((attr, i) => {
      // a type typed in the text format (e.g. VARCHAR(40)) gets its own option
      // instead of the dropdown claiming it's "Auto"
      const types = attr.dataType && !SQL_TYPES.includes(attr.dataType) ? SQL_TYPES.concat(attr.dataType) : SQL_TYPES;
      html += `<li class="attr-item"><input type="text" value="${esc(attr.name)}" class="attr-name-input" data-idx="${i}" aria-label="Attribute ${i + 1} name">
        <select class="attr-type-select" data-idx="${i}" aria-label="Attribute ${i + 1} SQL type">
          <option value="" ${!attr.dataType ? 'selected' : ''}>Auto</option>
          ${types.map(t => `<option value="${esc(t)}" ${attr.dataType === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
        </select>
        <div class="attr-flags">`;
      if (entity) {
        html += `<button class="attr-flag ${attr.pk ? 'active' : ''}" data-flag="pk" data-idx="${i}" aria-pressed="${!!attr.pk}" title="Primary key">PK</button>`;
        if (el.type === 'weak-entity') html += `<button class="attr-flag ${attr.discriminator ? 'active' : ''}" data-flag="discriminator" data-idx="${i}" aria-pressed="${!!attr.discriminator}" title="Discriminator (partial key)">D</button>`;
        html += `<button class="attr-flag ${attr.multivalued ? 'active' : ''}" data-flag="multivalued" data-idx="${i}" aria-pressed="${!!attr.multivalued}" title="Multivalued">{}</button>`;
        html += `<button class="attr-flag ${attr.derived ? 'active' : ''}" data-flag="derived" data-idx="${i}" aria-pressed="${!!attr.derived}" title="Derived">()</button>`;
      }
      html += `</div><button class="attr-remove" data-idx="${i}" aria-label="Remove attribute ${i + 1}" title="Remove">&times;</button></li>`;
    });
    html += `</ul><button class="prop-btn" id="add-attr-btn">+ Add</button></div>`;
    html += `<div class="prop-group"><button class="prop-btn" id="prop-dup-btn" title="Duplicate (Ctrl/Cmd+D)">Duplicate</button> <button class="prop-btn danger" id="prop-delete-btn">Delete</button></div>`;
    propsContent.innerHTML = html;

    document.getElementById('prop-type').onchange = e => { el.type = e.target.value; render(); showElementProps(el); saveState(); };
    document.getElementById('prop-name').oninput = e => { el.name = e.target.value; render(); saveState('name-' + el.id); };
    document.querySelectorAll('.attr-name-input').forEach(inp => {
      inp.oninput = e => {
        const i = parseInt(e.target.dataset.idx);
        if (el.attributes[i]) { el.attributes[i].name = e.target.value; render(); saveState('attr-' + el.id + '-' + i); }
      };
    });
    document.querySelectorAll('.attr-type-select').forEach(sel => {
      sel.onchange = e => { const i = parseInt(e.target.dataset.idx); if (el.attributes[i]) { el.attributes[i].dataType = e.target.value; saveState(); } };
    });
    document.querySelectorAll('.attr-flag').forEach(btn => {
      btn.onclick = e => {
        const i = parseInt(e.currentTarget.dataset.idx), f = e.currentTarget.dataset.flag;
        if (el.attributes[i]) {
          el.attributes[i][f] = !el.attributes[i][f];
          if (f === 'pk' && el.attributes[i].pk) el.attributes[i].discriminator = false;
          if (f === 'discriminator' && el.attributes[i].discriminator) el.attributes[i].pk = false;
          render(); showElementProps(el); saveState();
        }
      };
    });
    document.querySelectorAll('.attr-remove').forEach(btn => {
      btn.onclick = e => { el.attributes.splice(parseInt(e.currentTarget.dataset.idx), 1); render(); showElementProps(el); saveState(); };
    });
    document.getElementById('add-attr-btn').onclick = () => {
      if (!el.attributes) el.attributes = [];
      el.attributes.push(newAttr('attr'));
      render(); showElementProps(el); saveState();
      const inputs = document.querySelectorAll('.attr-name-input');
      if (inputs.length) { inputs[inputs.length - 1].focus(); inputs[inputs.length - 1].select(); }
    };
    document.getElementById('prop-dup-btn').onclick = duplicateSelected;
    document.getElementById('prop-delete-btn').onclick = deleteSelected;
  }

  function showMultiProps() {
    const n = state.selectedIds.length;
    const few = n < 3 ? 'disabled' : '';
    propsContent.innerHTML = `
      <p class="prop-pair"><b>${n} elements selected</b></p>
      <div class="prop-group"><label>Align</label>
        <div class="btn-row">
          <button class="prop-btn" data-align="left">Left</button><button class="prop-btn" data-align="center">Center</button><button class="prop-btn" data-align="right">Right</button>
        </div>
        <div class="btn-row">
          <button class="prop-btn" data-align="top">Top</button><button class="prop-btn" data-align="middle">Middle</button><button class="prop-btn" data-align="bottom">Bottom</button>
        </div>
      </div>
      <div class="prop-group"><label>Distribute</label>
        <div class="btn-row">
          <button class="prop-btn" data-dist="x" ${few}>Horizontally</button><button class="prop-btn" data-dist="y" ${few}>Vertically</button>
        </div>
        ${few ? '<p class="hint">Select three or more to distribute.</p>' : ''}
      </div>
      <div class="prop-group"><button class="prop-btn" id="multi-dup" title="Duplicate (Ctrl/Cmd+D)">Duplicate</button> <button class="prop-btn danger" id="multi-del">Delete all</button></div>
      <p class="hint"><kbd>Shift</kbd>+click adds or removes one. Drag, or use the arrow keys, to move them together.</p>`;
    propsContent.querySelectorAll('[data-align]').forEach(b => { b.onclick = () => alignSelected(b.dataset.align); });
    propsContent.querySelectorAll('[data-dist]').forEach(b => { b.onclick = () => distributeSelected(b.dataset.dist); });
    document.getElementById('multi-dup').onclick = duplicateSelected;
    document.getElementById('multi-del').onclick = deleteSelected;
  }

  function showConnectionProps(conn) {
    const fe = getElement(conn.fromId), te = getElement(conn.toId);
    let html = `<div class="prop-group"><p class="prop-pair">${esc(fe ? fe.name : '?')} &harr; ${esc(te ? te.name : '?')}</p></div>`;
    html += `<div class="conn-side"><h4>From: ${esc(fe ? fe.name : '?')}</h4>
      <div class="conn-options"><label><input type="checkbox" id="ca-from" ${conn.arrowFrom ? 'checked' : ''}> Arrow (one)</label></div></div>`;
    html += `<div class="conn-side"><h4>To: ${esc(te ? te.name : '?')}</h4>
      <div class="conn-options"><label><input type="checkbox" id="ca-to" ${conn.arrowTo ? 'checked' : ''}> Arrow (one)</label></div></div>`;
    html += `<div class="prop-group"><label><input type="checkbox" id="c-dbl" ${conn.isDouble ? 'checked' : ''}> Total Participation (double line)</label></div>`;
    html += `<div class="prop-group"><label for="c-lbl">Label</label><input type="text" id="c-lbl" value="${esc(conn.label || '')}"></div>`;
    html += `<div class="prop-group"><button class="prop-btn" id="c-swap">Swap</button> <button class="prop-btn danger" id="c-del">Delete</button></div>`;
    propsContent.innerHTML = html;

    document.getElementById('ca-from').onchange = e => { conn.arrowFrom = e.target.checked; render(); saveState(); };
    document.getElementById('ca-to').onchange = e => { conn.arrowTo = e.target.checked; render(); saveState(); };
    document.getElementById('c-dbl').onchange = e => { conn.isDouble = e.target.checked; render(); saveState(); };
    document.getElementById('c-lbl').oninput = e => { conn.label = e.target.value; render(); saveState('label-' + conn.id); };
    document.getElementById('c-swap').onclick = () => {
      const t = conn.fromId; conn.fromId = conn.toId; conn.toId = t;
      const ta = conn.arrowFrom; conn.arrowFrom = conn.arrowTo; conn.arrowTo = ta;
      render(); showConnectionProps(conn); saveState();
    };
    document.getElementById('c-del').onclick = deleteSelected;
  }

  // ==================== TABS ====================
  function setupTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const renderBtn = document.getElementById('render-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        document.getElementById('pane-' + btn.dataset.tab).classList.add('active');
        renderBtn.style.display = btn.dataset.tab === 'er' ? '' : 'none';
      });
    });
    document.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = document.getElementById(btn.dataset.target);
        if (!target || !target.value) return;
        const done = () => {
          btn.textContent = 'Copied!';
          btn.classList.add('copied');
          setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1500);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(target.value).then(done, () => setStatus('Copy was blocked. Select the text and copy it by hand.', true));
        } else {
          target.select();
          try { document.execCommand('copy'); done(); } catch (e) {}
        }
      });
    });
  }

  // ==================== SYNC OUTPUTS ====================
  function syncOutputs() {
    if (state.elements.length === 0) { erInput.value = ''; schemaOutput.value = ''; return; }
    erInput.value = generateERText();
    schemaOutput.value = generateSchema();
  }

  function generateERText() {
    if (state.elements.length === 0) return '';
    const entityMap = {};
    const relEls = [];
    state.elements.forEach(el => {
      if (isEntity(el)) entityMap[el.id] = el;
      else relEls.push(el);
    });
    const lines = [];
    Object.values(entityMap).forEach(el => {
      const prefix = el.type === 'weak-entity' ? 'WEAK' : 'ENTITY';
      const attrs = (el.attributes || []).map(a => {
        let n = a.name;
        if (a.dataType) n += ':' + a.dataType;
        if (a.derived) n += '()';
        if (a.multivalued) n = '{' + n + '}';
        if (a.pk) n = '*' + n;
        else if (a.discriminator) n = '~' + n;
        return n;
      });
      lines.push(prefix + ' ' + el.name + ': ' + attrs.join(', '));
    });
    if (relEls.length > 0) lines.push('');
    relEls.forEach(rel => {
      const conns = state.connections.filter(c => c.fromId === rel.id || c.toId === rel.id);
      const ents = [], cards = [], parts = [];
      conns.forEach(c => {
        const otherId = c.fromId === rel.id ? c.toId : c.fromId;
        const otherEl = entityMap[otherId];
        if (!otherEl) return;
        ents.push(otherEl);
        if (c.fromId === rel.id) cards.push(c.arrowTo ? '1' : 'N');
        else cards.push(c.arrowFrom ? '1' : 'N');
        parts.push(c.isDouble ? 'total' : 'partial');
      });
      if (ents.length < 2) return;
      const prefix = rel.type === 'identifying-rel' ? 'IDENT' : 'REL';
      const cardStr = (cards[0] === 'N' && cards[1] === 'N') ? 'M:N' : cards.slice(0, 2).join(':');
      let line = prefix + ' ' + rel.name + ' (' + ents[0].name + ', ' + ents[1].name + ') ' + cardStr + ' ' + parts.slice(0, 2).join('/');
      if (rel.attributes && rel.attributes.length > 0)
        line += ' [' + rel.attributes.map(a => a.name).join(', ') + ']';
      lines.push(line);
    });
    return lines.join('\n');
  }

  function generateSchema() {
    if (state.elements.length === 0) return '';
    const entityMap = {};
    const relEls = [];
    state.elements.forEach(el => {
      if (isEntity(el)) entityMap[el.id] = el;
      else relEls.push(el);
    });
    // Find weak entity owners via identifying relationships
    const weakOwner = {};
    relEls.forEach(rel => {
      if (rel.type !== 'identifying-rel') return;
      const conns = state.connections.filter(c => c.fromId === rel.id || c.toId === rel.id);
      let strongEl = null, weakEl = null;
      conns.forEach(c => {
        const otherId = c.fromId === rel.id ? c.toId : c.fromId;
        const el = entityMap[otherId];
        if (!el) return;
        if (el.type === 'weak-entity') weakEl = el;
        else if (!strongEl) strongEl = el;
      });
      if (weakEl && strongEl) weakOwner[weakEl.id] = strongEl;
    });
    const out = ['-- Generated SQL Schema from ER Diagram', ''];
    // Strong entities
    Object.values(entityMap).filter(e => e.type === 'entity').forEach(el => {
      const cols = [], pks = [], mv = [];
      (el.attributes || []).forEach(a => {
        if (a.derived) return;
        if (a.multivalued) { mv.push(a); return; }
        cols.push('  ' + toSnakeCase(a.name) + ' ' + sqlType(a) + (a.pk ? ' NOT NULL' : ''));
        if (a.pk) pks.push(toSnakeCase(a.name));
      });
      if (pks.length) cols.push('  PRIMARY KEY (' + pks.join(', ') + ')');
      out.push('CREATE TABLE ' + toSnakeCase(el.name) + ' (');
      out.push(cols.join(',\n'));
      out.push(');');
      out.push('');
      mv.forEach(a => {
        const pk = pks[0] || toSnakeCase(el.name) + '_id';
        out.push('CREATE TABLE ' + toSnakeCase(el.name) + '_' + toSnakeCase(a.name) + ' (');
        out.push('  ' + pk + ' INT NOT NULL,');
        out.push('  ' + toSnakeCase(a.name) + ' VARCHAR(255) NOT NULL,');
        out.push('  PRIMARY KEY (' + pk + ', ' + toSnakeCase(a.name) + '),');
        out.push('  FOREIGN KEY (' + pk + ') REFERENCES ' + toSnakeCase(el.name) + '(' + pk + ')');
        out.push(');');
        out.push('');
      });
    });
    // Weak entities
    Object.values(entityMap).filter(e => e.type === 'weak-entity').forEach(el => {
      const cols = [], pks = [], fks = [];
      const owner = weakOwner[el.id];
      if (owner) {
        const ownerPk = (owner.attributes || []).find(a => a.pk);
        const fkName = toSnakeCase(owner.name) + '_' + (ownerPk ? toSnakeCase(ownerPk.name) : 'id');
        cols.push('  ' + fkName + ' INT NOT NULL');
        pks.push(fkName);
        fks.push('  FOREIGN KEY (' + fkName + ') REFERENCES ' + toSnakeCase(owner.name) + '(' + (ownerPk ? toSnakeCase(ownerPk.name) : 'id') + ')');
      }
      (el.attributes || []).forEach(a => {
        if (a.derived || a.multivalued) return;
        cols.push('  ' + toSnakeCase(a.name) + ' ' + sqlType(a) + ((a.pk || a.discriminator) ? ' NOT NULL' : ''));
        if (a.discriminator || a.pk) pks.push(toSnakeCase(a.name));
      });
      if (pks.length) cols.push('  PRIMARY KEY (' + pks.join(', ') + ')');
      fks.forEach(fk => cols.push(fk));
      out.push('CREATE TABLE ' + toSnakeCase(el.name) + ' (');
      out.push(cols.join(',\n'));
      out.push(');');
      out.push('');
    });
    // Regular relationships
    relEls.forEach(rel => {
      if (rel.type === 'identifying-rel') return;
      const conns = state.connections.filter(c => c.fromId === rel.id || c.toId === rel.id);
      const ents = [], cards = [];
      conns.forEach(c => {
        const otherId = c.fromId === rel.id ? c.toId : c.fromId;
        const el = entityMap[otherId];
        if (!el) return;
        ents.push(el);
        if (c.fromId === rel.id) cards.push(c.arrowTo ? '1' : 'N');
        else cards.push(c.arrowFrom ? '1' : 'N');
      });
      if (ents.length < 2) return;
      if (cards[0] !== '1' && cards[1] !== '1') {
        // M:N junction table
        const cols = [], pkParts = [], fkParts = [];
        ents.forEach(ent => {
          const pk = (ent.attributes || []).find(a => a.pk || a.discriminator);
          const fkName = toSnakeCase(ent.name) + '_' + (pk ? toSnakeCase(pk.name) : 'id');
          cols.push('  ' + fkName + ' INT NOT NULL');
          pkParts.push(fkName);
          fkParts.push('  FOREIGN KEY (' + fkName + ') REFERENCES ' + toSnakeCase(ent.name) + '(' + (pk ? toSnakeCase(pk.name) : 'id') + ')');
        });
        (rel.attributes || []).forEach(a => {
          cols.push('  ' + toSnakeCase(a.name) + ' ' + sqlType(a));
        });
        cols.push('  PRIMARY KEY (' + pkParts.join(', ') + ')');
        fkParts.forEach(fk => cols.push(fk));
        out.push('-- M:N relationship: ' + rel.name);
        out.push('CREATE TABLE ' + toSnakeCase(rel.name) + ' (');
        out.push(cols.join(',\n'));
        out.push(');');
        out.push('');
      } else {
        // 1:N or 1:1 — FK on the many side
        let oneSide, manySide;
        if (cards[0] === '1') { oneSide = ents[0]; manySide = ents[1]; }
        else { oneSide = ents[1]; manySide = ents[0]; }
        const pk = (oneSide.attributes || []).find(a => a.pk || a.discriminator);
        const fkName = toSnakeCase(oneSide.name) + '_' + (pk ? toSnakeCase(pk.name) : 'id');
        const refCol = pk ? toSnakeCase(pk.name) : 'id';
        out.push('-- ' + cards.join(':') + ' relationship: ' + rel.name);
        out.push('ALTER TABLE ' + toSnakeCase(manySide.name));
        out.push('  ADD ' + fkName + ' INT REFERENCES ' + toSnakeCase(oneSide.name) + '(' + refCol + ');');
        (rel.attributes || []).forEach(a => {
          out.push('ALTER TABLE ' + toSnakeCase(manySide.name));
          out.push('  ADD ' + toSnakeCase(a.name) + ' ' + sqlType(a) + ';');
        });
        out.push('');
      }
    });
    return out.join('\n');
  }

  function sqlType(attr) {
    if (attr.dataType) {
      if (attr.dataType === 'VARCHAR') return 'VARCHAR(255)';
      if (attr.dataType === 'DECIMAL') return 'DECIMAL(10,2)';
      return attr.dataType;
    }
    return inferSqlType(attr.name);
  }

  function inferSqlType(name) {
    const n = name.toLowerCase();
    if (n === 'id' || n.endsWith('_id')) return 'INT';
    if (n.includes('date')) return 'DATE';
    if (n === 'year' || n === 'age') return 'INT';
    if (n.includes('price') || n.includes('salary') || n.includes('cost') || n.includes('amount')) return 'DECIMAL(10,2)';
    return 'VARCHAR(255)';
  }

  function toSnakeCase(str) {
    return str.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().replace(/\s+/g, '_');
  }

  // ==================== HELPERS ====================
  function createSVG(tag, attrs, parent) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    if (parent) parent.appendChild(el);
    return el;
  }

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function download(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ==================== SAVE / LOAD / UNDO ====================
  function docSnapshot() {
    return JSON.stringify({ elements: state.elements, connections: state.connections, nextId: state.nextId });
  }

  function saveState(key) {
    const snap = docSnapshot();
    if (snap !== history.last) {
      const now = Date.now();
      const merge = key && key === history.key && now - history.at < 1500;
      if (!merge && history.last !== null) {
        history.undo.push(history.last);
        if (history.undo.length > 100) history.undo.shift();
      }
      history.redo = [];
      history.last = snap;
      history.key = key || null;
      history.at = now;
    }
    try { localStorage.setItem('erDiagram', snap); } catch (e) {}
    syncOutputs();
    updateUndoButtons();
  }

  function undo() {
    if (!history.undo.length) return;
    history.redo.push(history.last);
    restore(history.undo.pop());
  }

  function redo() {
    if (!history.redo.length) return;
    history.undo.push(history.last);
    restore(history.redo.pop());
  }

  function restore(snap) {
    history.last = snap;
    history.key = null;
    applyDoc(JSON.parse(snap));
    state.connectFromId = null;
    state.drag = null;
    // keep the selection if the things still exist, re-pointing the props panel at the new copies
    const kept = state.selectedIds.filter(id => getElement(id));
    if (kept.length) setSelection(kept);
    else if (state.selectedConnId !== null && getConnection(state.selectedConnId)) selectConnection(state.selectedConnId);
    else { clearSelection(); showDefaultProps(); render(); }
    try { localStorage.setItem('erDiagram', snap); } catch (e) {}
    syncOutputs();
    updateUndoButtons();
  }

  function updateUndoButtons() {
    document.getElementById('undo-btn').disabled = !history.undo.length;
    document.getElementById('redo-btn').disabled = !history.redo.length;
  }

  function applyDoc(d) {
    state.elements = d.elements;
    state.connections = d.connections;
    state.nextId = d.nextId;
  }

  // Anything loaded from storage or a file goes through here, so a hand-edited
  // or foreign JSON file can't put odd types or shapes into the state.
  function cleanDoc(d) {
    if (!d || !Array.isArray(d.elements)) return null;
    const num = v => (typeof v === 'number' && isFinite(v) ? Math.round(v) : 0);
    const str = (v, max) => String(v == null ? '' : v).slice(0, max);
    const ids = new Set();
    const elements = [];
    d.elements.forEach(e => {
      if (!e || !TYPES.includes(e.type) || !Number.isInteger(e.id) || ids.has(e.id)) return;
      ids.add(e.id);
      elements.push({
        id: e.id, type: e.type, x: num(e.x), y: num(e.y), name: str(e.name, 80),
        attributes: (Array.isArray(e.attributes) ? e.attributes : []).slice(0, 200).filter(a => a).map(a => ({
          name: str(a.name, 80), pk: !!a.pk, discriminator: !!a.discriminator,
          multivalued: !!a.multivalued, derived: !!a.derived,
          dataType: /^[A-Za-z][\w(), ]{0,30}$/.test(a.dataType || '') ? a.dataType : ''
        }))
      });
    });
    const connections = [];
    (Array.isArray(d.connections) ? d.connections : []).forEach(c => {
      if (!c || !Number.isInteger(c.id) || ids.has(c.id) || !ids.has(c.fromId) || !ids.has(c.toId)) return;
      ids.add(c.id);
      connections.push({ id: c.id, fromId: c.fromId, toId: c.toId, arrowFrom: !!c.arrowFrom, arrowTo: !!c.arrowTo,
        isDouble: !!c.isDouble, label: str(c.label, 60), dashed: !!c.dashed });
    });
    const maxId = ids.size ? Math.max(...ids) : 0;
    const nextId = Number.isInteger(d.nextId) && d.nextId > maxId ? d.nextId : maxId + 1;
    return { elements, connections, nextId };
  }

  function loadState() {
    try {
      const d = cleanDoc(JSON.parse(localStorage.getItem('erDiagram')));
      if (d) { applyDoc(d); render(); syncOutputs(); }
    } catch (e) {}
  }

  function saveFile() {
    if (!state.elements.length) { setStatus('Nothing to save yet.', true); return; }
    const doc = { format: 'er-diagram', version: 1, elements: state.elements, connections: state.connections, nextId: state.nextId };
    download('er-diagram.json', new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
    setStatus('Saved er-diagram.json');
  }

  function openFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setStatus('That file is too big to be a diagram.', true); return; }
    const reader = new FileReader();
    reader.onload = () => {
      let d = null;
      try { d = cleanDoc(JSON.parse(reader.result)); } catch (err) {}
      if (!d || !d.elements.length) { setStatus(file.name + " isn't a diagram saved from this app.", true); return; }
      applyDoc(d);
      clearSelection();
      render(); showDefaultProps(); centerView(); saveState();
      setStatus('Opened ' + file.name);
    };
    reader.onerror = () => setStatus("Couldn't read " + file.name, true);
    reader.readAsText(file);
  }

  // ==================== EXPORT ====================
  // A trimmed copy of the canvas: no grid, no selection, fitted to the diagram,
  // light colours whatever theme is on screen.
  function buildExportSVG(scale) {
    let b = { minX: 0, minY: 0, maxX: 800, maxY: 600 };
    if (state.elements.length) b = diagramBounds();
    const pad = 40, ew = b.maxX - b.minX + pad * 2, eh = b.maxY - b.minY + pad * 2;
    const c = svg.cloneNode(true);
    c.removeAttribute('class'); c.removeAttribute('tabindex'); c.removeAttribute('role'); c.removeAttribute('aria-label');
    const grid = c.querySelector('#grid-bg');
    if (grid) grid.remove();
    const defs = c.querySelector('defs');
    if (defs) defs.remove();
    c.querySelectorAll('.selected,.connect-highlight').forEach(e => { e.classList.remove('selected'); e.classList.remove('connect-highlight'); });
    c.setAttribute('viewBox', `${b.minX - pad} ${b.minY - pad} ${ew} ${eh}`);
    c.setAttribute('width', ew * scale); c.setAttribute('height', eh * scale);
    c.setAttribute('font-family', measureFont || 'sans-serif');
    const bg = createSVG('rect', { x: b.minX - pad, y: b.minY - pad, width: ew, height: eh, fill: 'white' });
    c.insertBefore(bg, c.firstChild);
    return { node: c, w: ew * scale, h: eh * scale };
  }

  function exportSVG() {
    if (!state.elements.length) { setStatus('Nothing to export yet.', true); return; }
    const out = buildExportSVG(1);
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(out.node);
    download('er-diagram.svg', new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
    setStatus('Exported er-diagram.svg');
  }

  function exportPNG() {
    if (!state.elements.length) { setStatus('Nothing to export yet.', true); return; }
    const out = buildExportSVG(2);
    const blob = new Blob([new XMLSerializer().serializeToString(out.node)], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const cvs = document.createElement('canvas'); cvs.width = out.w; cvs.height = out.h;
      const ctx = cvs.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, cvs.width, cvs.height);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      cvs.toBlob(png => {
        if (!png) { setStatus('This diagram is too large for a PNG. Try SVG.', true); return; }
        download('er-diagram.png', png);
        setStatus('Exported er-diagram.png');
      }, 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); setStatus('PNG export failed. Try SVG.', true); };
    img.src = url;
  }

  function exportSQL() {
    const sql = generateSchema();
    if (!sql) { setStatus('Nothing to export yet.', true); return; }
    download('schema.sql', new Blob([sql + '\n'], { type: 'text/plain;charset=utf-8' }));
    setStatus('Exported schema.sql');
  }

  window.ERApp = { state, render, saveState, setTool, deselectAll, setSelection, showDefaultProps, updateViewBox, getElementCenter,
    elemBox, undo, redo, parseERText, cleanDoc, duplicateSelected, alignSelected, distributeSelected, autoLayout };
  document.addEventListener('DOMContentLoaded', init);
})();
