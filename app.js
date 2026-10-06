(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ENTITY_WIDTH = 160;
  const HEADER_HEIGHT = 28;
  const ATTR_HEIGHT = 22;
  const DIAMOND_W = 140;
  const DIAMOND_H = 70;
  const IDENT_PAD = 6;

  const state = {
    elements: [],
    connections: [],
    nextId: 1,
    selectedId: null,
    selectedConnId: null,
    tool: 'select',
    connectFromId: null,
    drag: null,
    pan: null,
    viewBox: { x: -100, y: -50, w: 1800, h: 1200 }
  };

  let svg, elemLayer, connLayer, propsContent, erInput, schemaOutput;

  function init() {
    svg = document.getElementById('canvas');
    elemLayer = document.getElementById('elements-layer');
    connLayer = document.getElementById('connections-layer');
    propsContent = document.getElementById('props-content');
    erInput = document.getElementById('er-input');
    schemaOutput = document.getElementById('schema-output');

    setupToolbar();
    setupCanvasEvents();
    setupKeyboard();
    setupResizeHandle();
    setupTextToggle();
    setupTabs();
    setupTextResize();
    updateViewBox();
    loadState();
  }

  function setupResizeHandle() {
    const handle = document.getElementById('resize-handle');
    const panel = document.getElementById('side-panel');
    let startX, startW;
    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      startX = e.clientX; startW = panel.offsetWidth;
      handle.classList.add('active');
      const onMove = ev => { panel.style.width = Math.max(180, Math.min(600, startW - (ev.clientX - startX))) + 'px'; };
      const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); handle.classList.remove('active'); };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function setupTextToggle() {
    document.getElementById('text-toggle').addEventListener('click', () => {
      document.getElementById('text-section').classList.toggle('collapsed');
    });
  }

  function setupTextResize() {
    const handle = document.getElementById('text-resize-handle');
    const section = document.getElementById('text-section');
    let startY, startH;
    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      if (section.classList.contains('collapsed')) section.classList.remove('collapsed');
      startY = e.clientY; startH = section.offsetHeight;
      handle.classList.add('active');
      const onMove = ev => { section.style.height = Math.max(80, Math.min(500, startH - (ev.clientY - startY))) + 'px'; };
      const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); handle.classList.remove('active'); };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // ==================== TOOLBAR ====================
  function setupToolbar() {
    document.querySelectorAll('.tbtn[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => setTool(btn.dataset.tool));
    });
    document.getElementById('delete-btn').addEventListener('click', deleteSelected);
    document.getElementById('render-btn').addEventListener('click', parseAndRender);
    document.getElementById('export-btn').addEventListener('click', exportPNG);
    document.getElementById('clear-btn').addEventListener('click', () => {
      if (state.elements.length === 0 || confirm('Clear all elements?')) {
        state.elements = [];
        state.connections = [];
        state.selectedId = null;
        state.selectedConnId = null;
        state.nextId = 1;
        erInput.value = '';
        schemaOutput.value = '';
        render();
        showDefaultProps();
        saveState();
      }
    });
  }

  function setTool(tool) {
    state.tool = tool;
    state.connectFromId = null;
    document.querySelectorAll('.tbtn[data-tool]').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.tbtn[data-tool="${tool}"]`);
    if (btn) btn.classList.add('active');
    svg.className.baseVal = '';
    if (tool !== 'select') svg.classList.add('tool-' + tool);
  }

  function setStatus() {}

  // ==================== CANVAS EVENTS ====================
  function setupCanvasEvents() {
    svg.addEventListener('mousedown', onCanvasMouseDown);
    svg.addEventListener('mousemove', onCanvasMouseMove);
    svg.addEventListener('mouseup', onCanvasMouseUp);
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

  function onCanvasMouseDown(e) {
    const svgPt = screenToSVG(e.clientX, e.clientY);
    const elemG = e.target.closest('.er-element');
    const connG = e.target.closest('.er-connection');

    if (e.button === 0) {
      if (elemG) {
        const id = parseInt(elemG.dataset.id);
        if (state.tool === 'connect') {
          handleConnectClick(id);
        } else {
          selectElement(id);
          const el = getElement(id);
          if (el) state.drag = { id, startX: svgPt.x, startY: svgPt.y, origX: el.x, origY: el.y };
        }
        return;
      }
      if (connG) {
        selectConnection(parseInt(connG.dataset.connId));
        return;
      }
      // Empty canvas click
      if (state.tool === 'select' || state.tool === 'connect') {
        // Start panning with left click on empty canvas
        state.pan = { startX: e.clientX, startY: e.clientY, startVB: { ...state.viewBox } };
        deselectAll();
      } else {
        placeElement(state.tool, svgPt.x, svgPt.y);
        setTool('select');
      }
    } else if (e.button === 1 || e.button === 2) {
      state.pan = { startX: e.clientX, startY: e.clientY, startVB: { ...state.viewBox } };
      e.preventDefault();
    }
  }

  function onCanvasMouseMove(e) {
    if (state.pan) {
      const r = svg.getBoundingClientRect();
      const dx = (e.clientX - state.pan.startX) / r.width * state.pan.startVB.w;
      const dy = (e.clientY - state.pan.startY) / r.height * state.pan.startVB.h;
      state.viewBox.x = state.pan.startVB.x - dx;
      state.viewBox.y = state.pan.startVB.y - dy;
      updateViewBox();
      return;
    }
    if (state.drag) {
      const svgPt = screenToSVG(e.clientX, e.clientY);
      const el = getElement(state.drag.id);
      if (el) {
        el.x = Math.round((state.drag.origX + (svgPt.x - state.drag.startX)) / 10) * 10;
        el.y = Math.round((state.drag.origY + (svgPt.y - state.drag.startY)) / 10) * 10;
        render();
      }
    }
  }

  function onCanvasMouseUp() {
    if (state.drag) { state.drag = null; saveState(); }
    state.pan = null;
  }

  function onCanvasWheel(e) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.1 : 0.9;
    const svgPt = screenToSVG(e.clientX, e.clientY);
    const newW = state.viewBox.w * factor;
    if (newW < 400 || newW > 10000) return;
    state.viewBox.x = svgPt.x - (svgPt.x - state.viewBox.x) * factor;
    state.viewBox.y = svgPt.y - (svgPt.y - state.viewBox.y) * factor;
    state.viewBox.w *= factor;
    state.viewBox.h *= factor;
    updateViewBox();
  }

  function updateViewBox() {
    const v = state.viewBox;
    svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
  }

  function centerView() {
    if (state.elements.length === 0) {
      state.viewBox = { x: -100, y: -50, w: 1800, h: 1200 };
      updateViewBox();
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    state.elements.forEach(el => {
      const sz = elemSize(el);
      minX = Math.min(minX, el.x);
      minY = Math.min(minY, el.y);
      maxX = Math.max(maxX, el.x + sz.w);
      maxY = Math.max(maxY, el.y + sz.h);
    });
    const pad = 80;
    const cw = maxX - minX + pad * 2;
    const ch = maxY - minY + pad * 2;
    const aspect = svg.getBoundingClientRect().width / svg.getBoundingClientRect().height;
    let vw, vh;
    if (cw / ch > aspect) { vw = cw; vh = cw / aspect; }
    else { vh = ch; vw = ch * aspect; }
    state.viewBox = {
      x: minX - pad - (vw - cw) / 2,
      y: minY - pad - (vh - ch) / 2,
      w: vw, h: vh
    };
    updateViewBox();
  }

  function elemSize(el) {
    if (el.type === 'entity' || el.type === 'weak-entity') {
      const h = HEADER_HEIGHT + Math.max((el.attributes || []).length * ATTR_HEIGHT, ATTR_HEIGHT);
      return { w: ENTITY_WIDTH + 6, h: h + 6 };
    }
    return { w: DIAMOND_W + IDENT_PAD * 2, h: DIAMOND_H + IDENT_PAD * 2 + (el.attributes || []).length * 20 + 20 };
  }

  // ==================== KEYBOARD ====================
  function setupKeyboard() {
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); }
      else if (e.key === 'Escape') { deselectAll(); setTool('select'); }
      else if (e.key === 'v') setTool('select');
      else if (e.key === 'c') setTool('connect');
      else if (e.key === ' ') { e.preventDefault(); centerView(); }
    });
  }

  // ==================== ELEMENTS ====================
  function getElement(id) { return state.elements.find(e => e.id === id); }
  function getConnection(id) { return state.connections.find(c => c.id === id); }

  function placeElement(type, x, y) {
    const el = {
      id: state.nextId++, type, x: Math.round(x / 10) * 10, y: Math.round(y / 10) * 10,
      name: (type === 'entity' || type === 'weak-entity') ? 'Entity' : 'Rel',
      attributes: []
    };
    if (type === 'entity' || type === 'weak-entity')
      el.attributes.push({ name: 'id', pk: true, discriminator: false, multivalued: false, derived: false, dataType: '' });
    state.elements.push(el);
    selectElement(el.id);
    render(); saveState();
  }

  function deleteSelected() {
    if (state.selectedId !== null) {
      state.connections = state.connections.filter(c => c.fromId !== state.selectedId && c.toId !== state.selectedId);
      state.elements = state.elements.filter(e => e.id !== state.selectedId);
      state.selectedId = null;
    } else if (state.selectedConnId !== null) {
      state.connections = state.connections.filter(c => c.id !== state.selectedConnId);
      state.selectedConnId = null;
    }
    showDefaultProps(); render(); saveState();
  }

  function selectElement(id) {
    state.selectedId = id; state.selectedConnId = null;
    render();
    const el = getElement(id);
    if (el) showElementProps(el);
  }

  function selectConnection(id) {
    state.selectedConnId = id; state.selectedId = null;
    render();
    const conn = getConnection(id);
    if (conn) showConnectionProps(conn);
  }

  function deselectAll() {
    state.selectedId = null; state.selectedConnId = null; state.connectFromId = null;
    showDefaultProps(); render();
  }

  function handleConnectClick(id) {
    if (state.connectFromId === null) {
      state.connectFromId = id; render();
      setStatus('Click second element');
    } else if (state.connectFromId !== id) {
      const conn = { id: state.nextId++, fromId: state.connectFromId, toId: id,
        arrowFrom: false, arrowTo: false, isDouble: false, label: '', dashed: false };
      state.connections.push(conn);
      state.connectFromId = null;
      selectConnection(conn.id); render(); saveState();
    }
  }

  // ==================== RENDERING ====================
  function render() {
    while (elemLayer.firstChild) elemLayer.removeChild(elemLayer.firstChild);
    while (connLayer.firstChild) connLayer.removeChild(connLayer.firstChild);
    state.connections.forEach(c => { const g = renderConnection(c); if (g) connLayer.appendChild(g); });
    state.elements.forEach(el => elemLayer.appendChild(renderElement(el)));
  }

  function renderElement(el) {
    const g = createSVG('g', {
      class: 'er-element' + (el.id === state.selectedId ? ' selected' : '') +
        (el.id === state.connectFromId ? ' connect-highlight' : ''),
      'data-id': el.id, transform: `translate(${el.x}, ${el.y})`
    });
    if (el.type === 'entity' || el.type === 'weak-entity') renderEntityShape(g, el);
    else renderRelShape(g, el);
    return g;
  }

  function renderEntityShape(g, el) {
    const attrs = el.attributes || [];
    const bodyH = Math.max(attrs.length * ATTR_HEIGHT, ATTR_HEIGHT);
    const totalH = HEADER_HEIGHT + bodyH;
    const w = ENTITY_WIDTH;
    if (el.type === 'weak-entity')
      createSVG('rect', { x: -3, y: -3, width: w + 6, height: totalH + 6, fill: 'white', stroke: '#333', 'stroke-width': 1.5, rx: 1 }, g);
    createSVG('rect', { x: 0, y: 0, width: w, height: totalH, fill: 'white', stroke: '#333', 'stroke-width': 1.5, rx: 1 }, g);
    createSVG('rect', { x: 0, y: 0, width: w, height: HEADER_HEIGHT, fill: '#B8D4E8', stroke: 'none', rx: 1 }, g);
    createSVG('line', { x1: 0, y1: HEADER_HEIGHT, x2: w, y2: HEADER_HEIGHT, stroke: '#333', 'stroke-width': 1 }, g);
    createSVG('text', { x: w / 2, y: HEADER_HEIGHT / 2 + 1, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'font-size': '13px', 'font-style': 'italic', 'font-weight': '600', fill: '#222' }, g).textContent = el.name;
    attrs.forEach((attr, i) => {
      const y = HEADER_HEIGHT + 15 + i * ATTR_HEIGHT;
      let dn = attr.name;
      if (attr.multivalued) dn = '{' + dn + '}';
      if (attr.derived) dn = dn + '()';
      createSVG('text', { x: 10, y, 'font-size': '12px', fill: '#333', 'font-style': 'italic' }, g).textContent = dn;
      if (attr.pk) {
        const tl = dn.length * 7;
        createSVG('line', { x1: 10, y1: y + 3, x2: 10 + tl, y2: y + 3, stroke: '#333', 'stroke-width': 1 }, g);
      } else if (attr.discriminator) {
        const tl = dn.length * 7;
        createSVG('line', { x1: 10, y1: y + 3, x2: 10 + tl, y2: y + 3, stroke: '#333', 'stroke-width': 1, 'stroke-dasharray': '4,2' }, g);
      }
    });
  }

  function renderRelShape(g, el) {
    const hw = DIAMOND_W / 2, hh = DIAMOND_H / 2;
    const pts = `${hw},0 ${DIAMOND_W},${hh} ${hw},${DIAMOND_H} 0,${hh}`;
    if (el.type === 'identifying-rel') {
      const op = `${hw},${-IDENT_PAD} ${DIAMOND_W + IDENT_PAD},${hh} ${hw},${DIAMOND_H + IDENT_PAD} ${-IDENT_PAD},${hh}`;
      createSVG('polygon', { points: op, fill: '#D4E8D4', stroke: '#333', 'stroke-width': 1.5 }, g);
    }
    createSVG('polygon', { points: pts, fill: '#D4E8D4', stroke: '#333', 'stroke-width': 1.5 }, g);
    createSVG('text', { x: hw, y: hh + 1, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'font-size': '11px', 'font-style': 'italic', fill: '#222' }, g).textContent = el.name;
    if (el.attributes && el.attributes.length > 0) {
      el.attributes.forEach((attr, i) => {
        const ay = DIAMOND_H + 15 + i * 20;
        createSVG('line', { x1: hw, y1: DIAMOND_H, x2: hw, y2: ay - 8, stroke: '#666', 'stroke-width': 1, 'stroke-dasharray': '4,3' }, g);
        const aw = Math.max(attr.name.length * 7 + 16, 70);
        createSVG('rect', { x: hw - aw / 2, y: ay - 12, width: aw, height: 20, fill: 'white', stroke: '#666', 'stroke-width': 1, rx: 2 }, g);
        createSVG('text', { x: hw, y: ay + 1, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
          'font-size': '10px', 'font-style': 'italic', fill: '#444' }, g).textContent = attr.name;
      });
    }
  }

  function getElementCenter(el) {
    if (el.type === 'entity' || el.type === 'weak-entity') {
      const h = HEADER_HEIGHT + Math.max((el.attributes || []).length * ATTR_HEIGHT, ATTR_HEIGHT);
      return { x: el.x + ENTITY_WIDTH / 2, y: el.y + h / 2 };
    }
    return { x: el.x + DIAMOND_W / 2, y: el.y + DIAMOND_H / 2 };
  }

  function getEdgePt(el, tx, ty) {
    const c = getElementCenter(el);
    const dx = tx - c.x, dy = ty - c.y;
    if (dx === 0 && dy === 0) return c;
    if (el.type === 'entity' || el.type === 'weak-entity') {
      const h = HEADER_HEIGHT + Math.max((el.attributes || []).length * ATTR_HEIGHT, ATTR_HEIGHT);
      const hw = ENTITY_WIDTH / 2 + (el.type === 'weak-entity' ? 3 : 0);
      const hh = h / 2 + (el.type === 'weak-entity' ? 3 : 0);
      const t = Math.abs(dx) * hh > Math.abs(dy) * hw ? hw / Math.abs(dx) : hh / Math.abs(dy);
      return { x: c.x + dx * t, y: c.y + dy * t };
    }
    const hw = DIAMOND_W / 2 + (el.type === 'identifying-rel' ? IDENT_PAD : 0);
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
    createSVG('line', { x1: fp.x, y1: fp.y, x2: tp.x, y2: tp.y, stroke: 'transparent', 'stroke-width': 12 }, g);
    if (conn.isDouble) {
      const dx = tp.x - fp.x, dy = tp.y - fp.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = -dy / len * 2.5, ny = dx / len * 2.5;
      createSVG('line', { x1: fp.x + nx, y1: fp.y + ny, x2: tp.x + nx, y2: tp.y + ny, stroke: '#333', 'stroke-width': 1.5 }, g);
      createSVG('line', { x1: fp.x - nx, y1: fp.y - ny, x2: tp.x - nx, y2: tp.y - ny, stroke: '#333', 'stroke-width': 1.5 }, g);
    } else {
      const a = { x1: fp.x, y1: fp.y, x2: tp.x, y2: tp.y, stroke: '#333', 'stroke-width': 1.5 };
      if (conn.dashed) a['stroke-dasharray'] = '6,4';
      createSVG('line', a, g);
    }
    if (conn.arrowTo) drawArrow(g, fp.x, fp.y, tp.x, tp.y);
    if (conn.arrowFrom) drawArrow(g, tp.x, tp.y, fp.x, fp.y);
    if (conn.label) {
      const mx = (fp.x + tp.x) / 2, my = (fp.y + tp.y) / 2;
      const dx = tp.x - fp.x, dy = tp.y - fp.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
      createSVG('text', { x: mx + (-dy / len * 14), y: my + (dx / len * 14),
        'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': '12px', fill: '#666', 'font-weight': '600' }, g).textContent = conn.label;
    }
    return g;
  }

  function drawArrow(parent, fx, fy, tx, ty) {
    const dx = tx - fx, dy = ty - fy, len = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux = dx / len, uy = dy / len, sz = 10;
    const bx = tx - ux * sz, by = ty - uy * sz;
    createSVG('polygon', { points: `${tx},${ty} ${bx - uy * sz * 0.5},${by + ux * sz * 0.5} ${bx + uy * sz * 0.5},${by - ux * sz * 0.5}`, fill: '#333' }, parent);
  }

  // ==================== TEXT PARSER ====================
  function parseAndRender() {
    const text = erInput.value;
    if (!text.trim()) return;
    try {
      parseERText(text);
      centerView();
      saveState();
      setStatus('Rendered!');
    } catch (e) {
      setStatus('Parse error: ' + e.message);
      console.error(e);
    }
  }

  function parseERText(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    const entities = {};
    const rels = [];
    let nextId = 1;

    // Pass 1: Parse entities
    lines.forEach(line => {
      let m;
      if ((m = line.match(/^ENTITY\s+(\w+)\s*:\s*(.+)$/))) {
        const [, name, attrStr] = m;
        entities[name] = { id: nextId++, type: 'entity', x: 0, y: 0, name, attributes: parseAttrs(attrStr) };
      } else if ((m = line.match(/^WEAK\s+(\w+)\s*:\s*(.+)$/))) {
        const [, name, attrStr] = m;
        entities[name] = { id: nextId++, type: 'weak-entity', x: 0, y: 0, name, attributes: parseAttrs(attrStr) };
      }
    });

    // Pass 2: Parse relationships
    lines.forEach(line => {
      let m;
      if ((m = line.match(/^(REL|IDENT)\s+(\w+)\s*\((\w+)\s*,\s*(\w+)\)\s*(\S+)\s+(\S+)(?:\s*\[(.+)\])?$/))) {
        const [, relType, name, e1, e2, card, part, attrsStr] = m;
        const relAttrs = attrsStr ? attrsStr.split(',').map(a => ({ name: a.trim() })) : [];
        rels.push({ relType, name, e1, e2, card, part, attrs: relAttrs });
      }
    });

    // Auto-layout
    const entityNames = Object.keys(entities);
    const strongNames = entityNames.filter(n => entities[n].type === 'entity');
    const weakNames = entityNames.filter(n => entities[n].type === 'weak-entity');

    // Place strong entities in center row
    strongNames.forEach((n, i) => {
      entities[n].x = 80 + i * 600;
      entities[n].y = 520;
    });

    // Group weak entities by their identifying strong entity
    const weakGroups = {};
    rels.forEach(r => {
      if (r.relType === 'IDENT') {
        if (!weakGroups[r.e1]) weakGroups[r.e1] = [];
        weakGroups[r.e1].push(r.e2);
      }
    });

    // Place weak entities around their identifying entity
    Object.entries(weakGroups).forEach(([strongName, weakList]) => {
      const se = entities[strongName];
      if (!se) return;
      const positions = [
        { dx: -200, dy: -480 }, { dx: 200, dy: -480 },
        { dx: -200, dy: 500 }, { dx: 200, dy: 500 },
        { dx: -400, dy: -480 }, { dx: 400, dy: -480 },
        { dx: -400, dy: 500 }, { dx: 400, dy: 500 }
      ];
      weakList.forEach((wn, i) => {
        if (entities[wn]) {
          const pos = positions[i] || { dx: 200 * (i - 3), dy: -480 };
          entities[wn].x = se.x + pos.dx;
          entities[wn].y = se.y + pos.dy;
        }
      });
    });

    // Place unassigned weak entities
    weakNames.forEach(n => {
      if (entities[n].x === 0 && entities[n].y === 0) {
        entities[n].x = 400;
        entities[n].y = 200;
      }
    });

    // Build state
    state.elements = Object.values(entities);
    state.connections = [];

    // Create relationship elements and connections
    rels.forEach(r => {
      const e1 = entities[r.e1], e2 = entities[r.e2];
      if (!e1 || !e2) return;
      const c1 = getElementCenter(e1), c2 = getElementCenter(e2);
      const rx = (c1.x + c2.x) / 2 - DIAMOND_W / 2;
      const ry = (c1.y + c2.y) / 2 - DIAMOND_H / 2;

      const relEl = {
        id: nextId++,
        type: r.relType === 'IDENT' ? 'identifying-rel' : 'relationship',
        x: Math.round(rx / 10) * 10,
        y: Math.round(ry / 10) * 10,
        name: r.name,
        attributes: r.attrs
      };
      state.elements.push(relEl);

      // Parse cardinality (1:N, M:N, N:1, 1:1)
      const [leftCard, rightCard] = r.card.split(':');
      const arrowFrom = leftCard === '1';
      const arrowTo = rightCard === '1';

      // Parse participation (partial/total, total/partial, etc.)
      const [leftPart, rightPart] = r.part.split('/');

      // Connection from entity1 to relationship
      state.connections.push({
        id: nextId++, fromId: e1.id, toId: relEl.id,
        arrowFrom: arrowFrom, arrowTo: false,
        isDouble: leftPart === 'total', label: '', dashed: false
      });

      // Connection from relationship to entity2
      state.connections.push({
        id: nextId++, fromId: relEl.id, toId: e2.id,
        arrowFrom: false, arrowTo: arrowTo,
        isDouble: rightPart === 'total', label: '', dashed: false
      });
    });

    state.nextId = nextId;
    render();
  }

  function parseAttrs(str) {
    return str.split(',').map(a => a.trim()).filter(Boolean).map(a => {
      const attr = { name: a, pk: false, discriminator: false, multivalued: false, derived: false, dataType: '' };
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
    propsContent.innerHTML = '<p class="hint">Click an element to edit</p>';
  }

  function showElementProps(el) {
    const isEntity = el.type === 'entity' || el.type === 'weak-entity';
    let html = `<div class="prop-group"><label>Type</label>
      <select id="prop-type">
        <option value="entity" ${el.type === 'entity' ? 'selected' : ''}>Entity</option>
        <option value="weak-entity" ${el.type === 'weak-entity' ? 'selected' : ''}>Weak Entity</option>
        <option value="relationship" ${el.type === 'relationship' ? 'selected' : ''}>Relationship</option>
        <option value="identifying-rel" ${el.type === 'identifying-rel' ? 'selected' : ''}>Ident. Rel.</option>
      </select></div>`;
    html += `<div class="prop-group"><label>Name</label><input type="text" id="prop-name" value="${esc(el.name)}"></div>`;
    html += `<div class="prop-group"><label>Attributes</label><ul class="attr-list" id="attr-list">`;
    (el.attributes || []).forEach((attr, i) => {
      html += `<li class="attr-item"><input type="text" value="${esc(attr.name)}" class="attr-name-input" data-idx="${i}">
        <select class="attr-type-select" data-idx="${i}">
          <option value="" ${!attr.dataType ? 'selected' : ''}>Auto</option>
          <option value="INT" ${attr.dataType === 'INT' ? 'selected' : ''}>INT</option>
          <option value="SERIAL" ${attr.dataType === 'SERIAL' ? 'selected' : ''}>SERIAL</option>
          <option value="VARCHAR" ${attr.dataType === 'VARCHAR' ? 'selected' : ''}>VARCHAR</option>
          <option value="TEXT" ${attr.dataType === 'TEXT' ? 'selected' : ''}>TEXT</option>
          <option value="DATE" ${attr.dataType === 'DATE' ? 'selected' : ''}>DATE</option>
          <option value="TIMESTAMP" ${attr.dataType === 'TIMESTAMP' ? 'selected' : ''}>TIMESTAMP</option>
          <option value="DECIMAL" ${attr.dataType === 'DECIMAL' ? 'selected' : ''}>DECIMAL</option>
          <option value="BOOLEAN" ${attr.dataType === 'BOOLEAN' ? 'selected' : ''}>BOOLEAN</option>
          <option value="FLOAT" ${attr.dataType === 'FLOAT' ? 'selected' : ''}>FLOAT</option>
        </select>
        <div class="attr-flags">`;
      if (isEntity) {
        html += `<button class="attr-flag ${attr.pk ? 'active' : ''}" data-flag="pk" data-idx="${i}">PK</button>`;
        if (el.type === 'weak-entity') html += `<button class="attr-flag ${attr.discriminator ? 'active' : ''}" data-flag="discriminator" data-idx="${i}">D</button>`;
        html += `<button class="attr-flag ${attr.multivalued ? 'active' : ''}" data-flag="multivalued" data-idx="${i}">{}</button>`;
        html += `<button class="attr-flag ${attr.derived ? 'active' : ''}" data-flag="derived" data-idx="${i}">()</button>`;
      }
      html += `</div><button class="attr-remove" data-idx="${i}">&times;</button></li>`;
    });
    html += `</ul><button class="prop-btn" id="add-attr-btn">+ Add</button></div>`;
    html += `<div class="prop-group"><button class="prop-btn danger" id="prop-delete-btn">Delete</button></div>`;
    propsContent.innerHTML = html;

    document.getElementById('prop-type').onchange = e => { el.type = e.target.value; render(); showElementProps(el); saveState(); };
    document.getElementById('prop-name').oninput = e => { el.name = e.target.value; render(); saveState(); };
    document.querySelectorAll('.attr-name-input').forEach(inp => {
      inp.oninput = e => { const i = parseInt(e.target.dataset.idx); if (el.attributes[i]) { el.attributes[i].name = e.target.value; render(); saveState(); } };
    });
    document.querySelectorAll('.attr-type-select').forEach(sel => {
      sel.onchange = e => { const i = parseInt(e.target.dataset.idx); if (el.attributes[i]) { el.attributes[i].dataType = e.target.value; saveState(); } };
    });
    document.querySelectorAll('.attr-flag').forEach(btn => {
      btn.onclick = e => {
        const i = parseInt(e.target.dataset.idx), f = e.target.dataset.flag;
        if (el.attributes[i]) {
          el.attributes[i][f] = !el.attributes[i][f];
          if (f === 'pk' && el.attributes[i].pk) el.attributes[i].discriminator = false;
          if (f === 'discriminator' && el.attributes[i].discriminator) el.attributes[i].pk = false;
          render(); showElementProps(el); saveState();
        }
      };
    });
    document.querySelectorAll('.attr-remove').forEach(btn => {
      btn.onclick = e => { el.attributes.splice(parseInt(e.target.dataset.idx), 1); render(); showElementProps(el); saveState(); };
    });
    document.getElementById('add-attr-btn').onclick = () => {
      if (!el.attributes) el.attributes = [];
      el.attributes.push({ name: 'attr', pk: false, discriminator: false, multivalued: false, derived: false, dataType: '' });
      render(); showElementProps(el); saveState();
      setTimeout(() => { const inputs = document.querySelectorAll('.attr-name-input'); if (inputs.length) { inputs[inputs.length - 1].focus(); inputs[inputs.length - 1].select(); } }, 30);
    };
    document.getElementById('prop-delete-btn').onclick = deleteSelected;
  }

  function showConnectionProps(conn) {
    const fe = getElement(conn.fromId), te = getElement(conn.toId);
    let html = `<div class="prop-group"><p style="font-size:12px;color:#333">${esc(fe ? fe.name : '?')} &harr; ${esc(te ? te.name : '?')}</p></div>`;
    html += `<div class="conn-side"><h4>From: ${esc(fe ? fe.name : '?')}</h4>
      <div class="conn-options"><label><input type="checkbox" id="ca-from" ${conn.arrowFrom ? 'checked' : ''}> Arrow (one)</label></div></div>`;
    html += `<div class="conn-side"><h4>To: ${esc(te ? te.name : '?')}</h4>
      <div class="conn-options"><label><input type="checkbox" id="ca-to" ${conn.arrowTo ? 'checked' : ''}> Arrow (one)</label></div></div>`;
    html += `<div class="prop-group"><label><input type="checkbox" id="c-dbl" ${conn.isDouble ? 'checked' : ''}> Total Participation (double line)</label></div>`;
    html += `<div class="prop-group"><label>Label</label><input type="text" id="c-lbl" value="${esc(conn.label || '')}"></div>`;
    html += `<div class="prop-group"><button class="prop-btn" id="c-swap">Swap</button> <button class="prop-btn danger" id="c-del">Delete</button></div>`;
    propsContent.innerHTML = html;

    document.getElementById('ca-from').onchange = e => { conn.arrowFrom = e.target.checked; render(); saveState(); };
    document.getElementById('ca-to').onchange = e => { conn.arrowTo = e.target.checked; render(); saveState(); };
    document.getElementById('c-dbl').onchange = e => { conn.isDouble = e.target.checked; render(); saveState(); };
    document.getElementById('c-lbl').oninput = e => { conn.label = e.target.value; render(); saveState(); };
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
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        document.getElementById('pane-' + btn.dataset.tab).classList.add('active');
        renderBtn.style.display = btn.dataset.tab === 'er' ? '' : 'none';
      });
    });
    document.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = document.getElementById(btn.dataset.target);
        if (!target || !target.value) return;
        navigator.clipboard.writeText(target.value).then(() => {
          btn.textContent = 'Copied!';
          btn.classList.add('copied');
          setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1500);
        });
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
      if (el.type === 'entity' || el.type === 'weak-entity') entityMap[el.id] = el;
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
      const cardStr = (cards[0] === 'N' && cards[1] === 'N') ? 'M:N' : cards.join(':');
      let line = prefix + ' ' + rel.name + ' (' + ents[0].name + ', ' + ents[1].name + ') ' + cardStr + ' ' + parts.join('/');
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
      if (el.type === 'entity' || el.type === 'weak-entity') entityMap[el.id] = el;
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

  // ==================== SAVE/LOAD ====================
  function saveState() {
    try { localStorage.setItem('erDiagram', JSON.stringify({ elements: state.elements, connections: state.connections, nextId: state.nextId })); } catch (e) {}
    syncOutputs();
  }

  function loadState() {
    try {
      const d = JSON.parse(localStorage.getItem('erDiagram'));
      if (d && d.elements) { state.elements = d.elements; state.connections = d.connections || []; state.nextId = d.nextId || 1; render(); syncOutputs(); }
    } catch (e) {}
  }

  // ==================== EXPORT PNG ====================
  function exportPNG() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    state.elements.forEach(el => {
      const sz = elemSize(el);
      minX = Math.min(minX, el.x - 10); minY = Math.min(minY, el.y - 10);
      maxX = Math.max(maxX, el.x + sz.w + 10); maxY = Math.max(maxY, el.y + sz.h + 10);
    });
    if (state.elements.length === 0) { minX = 0; minY = 0; maxX = 800; maxY = 600; }
    const pad = 40, ew = maxX - minX + pad * 2, eh = maxY - minY + pad * 2;
    const c = svg.cloneNode(true);
    c.setAttribute('viewBox', `${minX - pad} ${minY - pad} ${ew} ${eh}`);
    c.setAttribute('width', ew * 2); c.setAttribute('height', eh * 2);
    c.querySelectorAll('.selected,.connect-highlight').forEach(e => { e.classList.remove('selected'); e.classList.remove('connect-highlight'); });
    const blob = new Blob([new XMLSerializer().serializeToString(c)], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const cvs = document.createElement('canvas'); cvs.width = ew * 2; cvs.height = eh * 2;
      const ctx = cvs.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, cvs.width, cvs.height);
      ctx.drawImage(img, 0, 0);
      const a = document.createElement('a'); a.href = cvs.toDataURL('image/png'); a.download = 'er-diagram.png';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url); setStatus('Exported!');
    };
    img.src = url;
  }

  window.ERApp = { state, render, saveState, setTool, deselectAll, showDefaultProps, updateViewBox, getElementCenter };
  document.addEventListener('DOMContentLoaded', init);
})();
