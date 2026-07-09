/*
  Astrocade Field Guide - reusable drawn PCB widget
  CACHE-BUSTER BUILD 20260709_rombuilder
  No canvas, no generated images. Pure HTML/CSS/SVG from data.
*/
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';

  const defaultBoardData = {
    ramCard: buildRamCardBoard(),
    blank: {
      title: 'Blank Astrocade PCB',
      subtitle: 'Reusable board shell - no parts placed yet',
      tag: 'template',
      width: 1000,
      height: 680,
      legend: ['green PCB', 'fixed corner holes', 'fixed perf areas', 'explicit components'],
      traces: [],
      vias: [],
      components: [],
      labels: [],
      pcbLabels: []
    }
  };

  function buildRamCardBoard() {
    // Base board only. No demo/random ICs, resistors, sticker, right-side label,
    // fake routed component buses, custom holes, or custom perf areas.
    // Components and PCB labels now belong in the page-specific board data.
    return {
      title: 'Astrocade RAM Card',
      subtitle: 'Drawn PCB widget - bare board shell, explicit component placement only',
      tag: 'HTML/CSS/JS',
      width: 1000,
      height: 680,
      legend: ['bare board shell', 'fixed corner holes', 'fixed perf areas', 'explicit components only'],
      edgeConnector: { fingers: 24,   padWidthPct: 50 },
      traces: [],
      vias: [],
      components: [],
      labels: [],
      pcbLabels: []
    };
  }

  function busPath(x1, y1, x2, y2) {
    const bend = x1 + Math.max(32, Math.min(82, (x2 - x1) * 0.25));
    return `M ${x1} ${y1} C ${bend} ${y1}, ${bend} ${y2}, ${x2} ${y2}`;
  }

  function pct(value, total) {
    return `${(Number(value || 0) / total) * 100}%`;
  }

  function px(value) {
    return `${Number(value || 0)}px`;
  }

  function createSvgEl(name, attrs = {}) {
    const el = document.createElementNS(NS, name);
    Object.entries(attrs).forEach(([key, value]) => {
      if (value !== undefined && value !== null) el.setAttribute(key, String(value));
    });
    return el;
  }

  function div(className, text) {
    const el = document.createElement('div');
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = String(text);
    return el;
  }

  function span(className, text) {
    const el = document.createElement('span');
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = String(text);
    return el;
  }

  function setBox(el, item, board) {
    const x = item.x ?? 0;
    const y = item.y ?? 0;
    const w = item.w ?? 10;
    const h = item.h ?? 10;
    el.style.left = pct(x, board.width);
    el.style.top = pct(y, board.height);
    el.style.width = pct(w, board.width);
    el.style.height = pct(h, board.height);
    if (item.rotation) el.style.setProperty('--component-rotation', `${item.rotation}deg`);
  }


  function defaultMountHoles(board) {
    const left = 70;
    const right = Math.max(left + 120, board.width - 70);
    const top = 89;
    const bottom = Math.max(top + 120, board.height - 88);
    return [
      { x: left, y: top },
      { x: left, y: bottom },
      { x: right, y: top },
      { x: right, y: bottom }
    ];
  }

  function defaultPerfAreas(board) {
    return [
      { x: 105, y: 82, w: 230, h: 105 },
      { x: 105, y: 250, w: 150, h: 102 },
      { x: 105, y: 470, w: 222, h: 100 },
      { x: Math.max(620, board.width - 205), y: 74, w: 118, h: 96 },
      { x: Math.max(620, board.width - 160), y: 258, w: 76, h: 206 }
    ];
  }

  function getBoardBodyRight(board) {
    // Must match the right edge used by defaultBoardPath(). The edge connector
    // tab starts here and extends OUTSIDE the board body.
    return board.width - 44;
  }

  function normalizeEdgeConnector(edgeConnector, board) {
    if (!edgeConnector) return null;

    const cfg = typeof edgeConnector === 'number'
      ? { fingers: edgeConnector }
      : edgeConnector === true
        ? {}
        : { ...edgeConnector };

    const fingers = Math.max(1, Math.min(80, Math.round(Number(cfg.fingers || 20))));
    const holes = defaultMountHoles(board);
    const bottomRight = holes.reduce((best, hole) => {
      if (!best) return hole;
      if (hole.x > best.x) return hole;
      if (hole.x === best.x && hole.y > best.y) return hole;
      return best;
    }, null);

    const fingerPitch = Number(cfg.fingerPitch ?? 8.2);
    const defaultHeight = Math.max(54, fingers * fingerPitch + 18);
    const h = Number(cfg.h ?? defaultHeight);
    const w = Number(cfg.w ?? 25);
    const bottom = Number(cfg.bottom ?? ((bottomRight?.y ?? board.height - 88) - 24));
    const minTop = 50;
    const y = Math.max(minTop, Number(cfg.y ?? (bottom - h)));
    const boardRight = getBoardBodyRight(board);

    return {
      ...cfg,
      fingers,
      x: Number(cfg.x ?? boardRight),
      y,
      w,
      h: Number(cfg.h ?? (bottom - y))
    };
  }

  function edgeConnectorReserve(edgeConnector, board) {
    const cfg = normalizeEdgeConnector(edgeConnector, board);
    if (!cfg) return null;

    // Reserve only the part that protrudes past the widget's coordinate box.
    // The tab itself starts at the board body's right edge, but most of it
    // lives in the normal right-side drawing margin. Only the overhang needs
    // layout space so it does not clip or create a scrollbar.
    const overhang = Math.max(0, cfg.x + cfg.w - board.width);
    const reservePct = overhang > 0 ? (overhang / (board.width + overhang)) * 100 : 0;
    return { cfg, reservePct };
  }

  function resolvePcbLabelColor(color) {
    const key = String(color || 'silk').trim().toLowerCase();
    const colors = {
      silk: 'var(--pcb-silk)',
      white: 'rgba(232, 255, 245, .86)',
      cyan: 'var(--cyan, #72d8ff)',
      blue: 'var(--cyan, #72d8ff)',
      gold: 'var(--gold, #ffd166)',
      yellow: 'var(--gold, #ffd166)',
      green: 'var(--green, #7ee787)',
      red: 'var(--red, #ff4f64)',
      violet: 'var(--violet, #c39cff)',
      muted: 'var(--dim, #8b96ad)'
    };
    return colors[key] || color || 'var(--pcb-silk)';
  }

  function renderBoardLabels(layer, board) {
    const labels = [
      ...(Array.isArray(board.pcbLabels) ? board.pcbLabels : []),
      ...(Array.isArray(board.boardLabels) ? board.boardLabels : [])
    ];

    labels.forEach((label) => {
      if (!label || !label.text) return;
      const el = div('pcb-board-label', label.text);
      const position = String(label.position || label.pos || 'top-left').toLowerCase();
      el.classList.add(`is-${position}`);
      el.style.setProperty('--pcb-board-label-color', resolvePcbLabelColor(label.color));
      if (label.size) el.style.setProperty('--pcb-board-label-size', px(label.size));
      if (label.opacity !== undefined) el.style.opacity = String(label.opacity);
      layer.append(el);
    });
  }

  function defaultBoardPath(w, h) {
    // Simple board outline: no left mounting ears and no embedded/right edge
    // connector nose. The eventual edge connector will be drawn as a separate
    // part that extends off the board.
    const left = 44;
    const right = w - 44;
    const top = 38;
    const bottom = h - 38;
    const radius = 24;

    return [
      `M ${left + radius} ${top}`,
      `L ${right - radius} ${top}`,
      `Q ${right} ${top} ${right} ${top + radius}`,
      `L ${right} ${bottom - radius}`,
      `Q ${right} ${bottom} ${right - radius} ${bottom}`,
      `L ${left + radius} ${bottom}`,
      `Q ${left} ${bottom} ${left} ${bottom - radius}`,
      `L ${left} ${top + radius}`,
      `Q ${left} ${top} ${left + radius} ${top}`,
      'Z'
    ].join(' ');
  }

  let pcbRenderId = 0;

  function renderBoardSvg(board, renderId) {
    const svg = createSvgEl('svg', {
      class: 'pcb-svg pcb-board-base',
      viewBox: `0 0 ${board.width} ${board.height}`,
      preserveAspectRatio: 'none',
      'aria-hidden': 'true'
    });

    const defs = createSvgEl('defs');
    const gradientId = `pcbBoardGreenGradient-${renderId}`;
    const gradient = createSvgEl('linearGradient', { id: gradientId, x1: '0%', y1: '0%', x2: '100%', y2: '100%' });
    gradient.append(
      createSvgEl('stop', { offset: '0%', 'stop-color': '#06513a' }),
      createSvgEl('stop', { offset: '42%', 'stop-color': '#087653' }),
      createSvgEl('stop', { offset: '100%', 'stop-color': '#0a8f66' })
    );
    defs.append(gradient);
    svg.append(defs);

    const path = board.path || defaultBoardPath(board.width, board.height);
    const fillPath = createSvgEl('path', { class: 'pcb-board-fill', d: path });
    fillPath.style.fill = `url(#${gradientId})`;
    svg.append(fillPath);
    svg.append(createSvgEl('path', { class: 'pcb-board-rim', d: path }));

    // A soft high-light patch over the upper half.
    svg.append(createSvgEl('path', {
      class: 'pcb-board-shine',
      d: `M 82 55 L ${board.width - 120} 55 C ${board.width - 165} ${board.height * .36}, ${board.width * .35} ${board.height * .18}, 82 ${board.height * .34} Z`
    }));

    return svg;
  }

  function renderTraceLayer(board) {
    const svg = createSvgEl('svg', {
      class: 'pcb-svg pcb-trace-layer',
      viewBox: `0 0 ${board.width} ${board.height}`,
      preserveAspectRatio: 'none',
      'aria-hidden': 'true'
    });

    (board.traces || []).forEach((trace) => {
      const d = trace.d || pathFromPoints(trace.points || []);
      if (!d) return;
      const shadow = createSvgEl('path', { class: 'pcb-trace-shadow', d });
      shadow.style.setProperty('--trace-width', String(trace.width || 3));
      svg.append(shadow);

      const path = createSvgEl('path', { class: ['pcb-trace', trace.className || ''].filter(Boolean).join(' '), d });
      path.style.setProperty('--trace-width', String(trace.width || 3));
      if (trace.opacity !== undefined) path.style.setProperty('--trace-opacity', String(trace.opacity));
      svg.append(path);
    });

    return svg;
  }

  function pathFromPoints(points) {
    if (!Array.isArray(points) || points.length < 2) return '';
    return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point[0]} ${point[1]}`).join(' ');
  }

  function renderPerfAreas(layer, board) {
    defaultPerfAreas(board).forEach((area) => {
      const el = div('pcb-perf-area');
      setBox(el, area, board);
      layer.append(el);
    });
  }

  function renderEdgeConnector(layer, board) {
    const cfg = normalizeEdgeConnector(board.edgeConnector, board);
    if (!cfg) return;

    const root = div('pcb-edge-connector');
    setBox(root, cfg, board);
    root.style.setProperty('--edge-finger-count', String(cfg.fingers));

    const fingers = cfg.fingers;
    const gap = Number(cfg.gap || 2.2);
    const padH = Math.max(1, (100 - gap * (fingers + 1)) / fingers);
    const padW = Number(cfg.padWidthPct || 100);

    for (let i = 0; i < fingers; i += 1) {
      const finger = div('pcb-edge-finger');
      finger.style.top = `${gap + i * (padH + gap)}%`;
      finger.style.height = `${padH}%`;
      finger.style.width = `${padW}%`;
      root.append(finger);
    }

    layer.append(root);
  }

  function renderMountHoles(layer, board) {
    defaultMountHoles(board).forEach((hole) => {
      const el = div('pcb-mount-hole');
      el.style.left = pct(hole.x, board.width);
      el.style.top = pct(hole.y, board.height);
      if (hole.size) el.style.width = pct(hole.size, board.width);
      layer.append(el);
    });
  }

  function renderVias(layer, board) {
    (board.vias || []).forEach((via) => {
      const el = div('pcb-via');
      el.style.left = pct(via.x, board.width);
      el.style.top = pct(via.y, board.height);
      if (via.size) el.style.setProperty('--via-size', pct(via.size, board.width));
      layer.append(el);
    });
  }

  function renderLabels(layer, board) {
    (board.labels || []).forEach((label) => {
      if (label.type === 'white-label') {
        const el = div('pcb-white-label', label.text || '');
        setBox(el, label, board);
        el.style.setProperty('--label-rotation', `${label.rotation || 0}deg`);
        layer.append(el);
        return;
      }

      if (label.type === 'box') {
        const el = div('pcb-silk-box');
        setBox(el, label, board);
        layer.append(el);
        return;
      }

      const el = div('pcb-silk-text', label.text || '');
      el.style.left = pct(label.x, board.width);
      el.style.top = pct(label.y, board.height);
      if (label.size) el.style.setProperty('--silk-size', px(label.size));
      if (label.rotation) el.style.transform = `rotate(${label.rotation}deg)`;
      if (label.style === 'script') el.style.fontFamily = 'cursive';
      layer.append(el);
    });
  }

  function renderComponent(layer, item, board) {
    switch (item.type) {
      case 'resistor':
        return renderResistor(layer, item, board);
      case 'capacitor':
        return renderCapacitor(layer, item, board);
      case 'ic':
      default:
        return renderIc(layer, item, board);
    }
  }

  function renderIc(layer, item, board) {
    const el = div(['pcb-ic', item.socket ? 'is-socketed' : ''].filter(Boolean).join(' '));
    setBox(el, item, board);
    el.style.setProperty('--component-rotation', `${item.rotation || 0}deg`);
    el.title = [item.ref, item.label, item.sublabel, item.footer].filter(Boolean).join(' · ');

    if (item.ref) el.append(span('pcb-ic-ref', item.ref));
    if (item.notch !== false) el.append(span('pcb-ic-notch'));
    if (item.pin1 !== false) el.append(span('pcb-pin-one'));

    const pinsPerSide = Math.max(4, Math.round(Number(item.pins || 16) / 2));
    const step = Math.max(.26, Math.min(.58, 2.86 / pinsPerSide));
    const on = Math.max(.12, step * .48);

    const pinsL = span('pcb-ic-pins-left');
    const pinsR = span('pcb-ic-pins-right');
    pinsL.style.setProperty('--pin-step', `${step}em`);
    pinsR.style.setProperty('--pin-step', `${step}em`);
    pinsL.style.setProperty('--pin-on', `${on}em`);
    pinsR.style.setProperty('--pin-on', `${on}em`);
    el.append(pinsL, pinsR);

    if (item.topRight || item.bottomRight) {
      const range = span('pcb-ic-range');
      range.append(span('', item.topRight || ''), span('', item.bottomRight || ''));
      el.append(range);
    }

    el.append(span('pcb-ic-name', item.label || item.name || item.ref || 'IC'));
    if (item.sublabel) el.append(span('pcb-ic-sub', item.sublabel));
    if (item.footer) el.append(span('pcb-ic-footer', item.footer));

    layer.append(el);
    return el;
  }

  function renderResistor(layer, item, board) {
    const el = div('pcb-resistor');
    setBox(el, { ...item, h: item.h || 12 }, board);
    el.style.setProperty('--component-rotation', `${item.rotation || 0}deg`);
    if (item.ref) el.append(span('pcb-resistor-ref', item.ref));
    el.append(div('pcb-resistor-body'));
    layer.append(el);
    return el;
  }

  function renderCapacitor(layer, item, board) {
    const el = div('pcb-capacitor');
    setBox(el, item, board);
    el.style.setProperty('--component-rotation', `${item.rotation || 0}deg`);
    el.append(span('pcb-capacitor-label', item.label || item.ref || 'C'));
    layer.append(el);
    return el;
  }

  function renderBoard(root, sourceBoard) {
    if (!root) return null;

    const board = normalizeBoard(sourceBoard);
    const edgeReserve = edgeConnectorReserve(board.edgeConnector, board);
    root.classList.add('astrocade-pcb-host');
    const renderId = ++pcbRenderId;
    root.innerHTML = '';

    const frame = div('astrocade-pcb-frame');
    const head = div('astrocade-pcb-head');
    const titleWrap = div('');
    titleWrap.append(span('astrocade-pcb-title', board.title || 'Astrocade PCB'));
    if (board.subtitle) titleWrap.append(span('astrocade-pcb-subtitle', board.subtitle));
    head.append(titleWrap);
    if (board.tag) head.append(span('astrocade-pcb-tag', board.tag));

    const stage = div('astrocade-pcb-stage');
    const pcb = div('astrocade-pcb-board');
    pcb.style.setProperty('--pcb-aspect', `${board.width} / ${board.height}`);
    if (board.maxWidth) pcb.style.setProperty('--pcb-max-width', typeof board.maxWidth === 'number' ? px(board.maxWidth) : board.maxWidth);
    if (edgeReserve) {
      pcb.classList.add('has-edge-connector');
      pcb.style.setProperty('--pcb-edge-tab-reserve', `${edgeReserve.reservePct}%`);
    }
    pcb.setAttribute('role', 'img');
    pcb.setAttribute('aria-label', board.ariaLabel || board.title || 'Drawn PCB');

    const perfLayer = div('pcb-layer pcb-perf-layer');
    const padLayer = div('pcb-layer pcb-pad-layer');
    const silkLayer = div('pcb-layer pcb-silk-layer');
    const compLayer = div('pcb-layer pcb-component-layer');
    const labelLayer = div('pcb-layer pcb-label-layer');

    renderPerfAreas(perfLayer, board);
    renderEdgeConnector(padLayer, board);
    renderMountHoles(padLayer, board);
    renderVias(padLayer, board);
    (board.components || []).forEach((item) => renderComponent(compLayer, item, board));
    renderLabels(labelLayer, board);
    renderBoardLabels(labelLayer, board);

    pcb.append(
      renderBoardSvg(board, renderId),
      perfLayer,
      renderTraceLayer(board),
      padLayer,
      silkLayer,
      compLayer,
      labelLayer
    );

    stage.append(pcb);
    frame.append(head, stage);

    if (Array.isArray(board.legend) && board.legend.length) {
      const legend = div('pcb-legend');
      board.legend.forEach((text) => legend.append(span('', text)));
      frame.append(legend);
    }

    root.append(frame);
    return pcb;
  }

  function defaultFormatMemoryHex(value) {
    const numeric = Number(value || 0);
    return '$' + numeric.toString(16).toUpperCase().padStart(4, '0');
  }

  function renderMemoryMapRomChips(blockPanel, region, options = {}) {
    if (!blockPanel || !region || !Array.isArray(region.roms) || region.roms.length === 0) {
      return null;
    }

    const formatHex = typeof options.formatHex === 'function'
      ? options.formatHex
      : defaultFormatMemoryHex;

    const romStack = div('memmap-rom-stack');
    const romGrid = div('memmap-rom-grid');

    [...region.roms]
      .filter(Boolean)
      .sort((a, b) => Number(b.start || 0) - Number(a.start || 0))
      .forEach((rom) => {
        const chip = div('memmap-rom-chip');
        const romName = rom.name || rom.label || 'ROM';
        const romStart = Number(rom.start || 0);
        const romEnd = Number(rom.end || romStart);

        chip.title = [
          `${romName} maps to ${formatHex(romStart)}-${formatHex(romEnd)}`,
          rom.size || '',
          rom.chip || '',
          rom.crc ? `CRC ${rom.crc}` : ''
        ].filter(Boolean).join(' · ');

        const notch = span('memmap-rom-notch');
        notch.setAttribute('aria-hidden', 'true');

        const name = span('memmap-rom-name', romName);

        const range = span('memmap-rom-range');
        range.setAttribute('aria-label', `${formatHex(romStart)}-${formatHex(romEnd)}`);
        range.append(
          span('memmap-rom-range-top', formatHex(romEnd)),
          span('memmap-rom-range-bottom', formatHex(romStart))
        );

        const size = span('memmap-rom-size', [rom.size, rom.chip || ''].filter(Boolean).join(' · '));
        const crc = span('memmap-rom-crc', rom.crc ? `CRC ${rom.crc}` : '');

        chip.append(notch, name, range, size, crc);
        romGrid.append(chip);
      });

    romStack.append(romGrid);
    blockPanel.append(romStack);
    return romStack;
  }

  function normalizeBoard(board) {
    const src = board || defaultBoardData.blank;
    return {
      width: 1000,
      height: 680,
      maxWidth: '1280px',
      ...src,
      components: Array.isArray(src.components) ? src.components : [],
      traces: Array.isArray(src.traces) ? src.traces : [],
      vias: Array.isArray(src.vias) ? src.vias : [],
      labels: Array.isArray(src.labels) ? src.labels : [],
      pcbLabels: Array.isArray(src.pcbLabels) ? src.pcbLabels : [],
      boardLabels: Array.isArray(src.boardLabels) ? src.boardLabels : []
    };
  }

  function resolveBoard(nameOrObject) {
    if (!nameOrObject) return defaultBoardData.blank;
    if (typeof nameOrObject === 'object') return nameOrObject;
    return window.astrocadePcbBoards?.[nameOrObject] || defaultBoardData[nameOrObject] || defaultBoardData.blank;
  }

  function renderAll() {
    document.querySelectorAll('[data-pcb-board]').forEach((root) => {
      renderBoard(root, resolveBoard(root.dataset.pcbBoard));
    });
  }

  window.astrocadePcbBoards = {
    ...defaultBoardData,
    ...(window.astrocadePcbBoards || {})
  };

  window.AstrocadePCB = {
    boards: window.astrocadePcbBoards,
    renderBoard,
    renderAll,
    resolveBoard,
    renderMemoryMapRomChips
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderAll, { once: true });
  } else {
    renderAll();
  }
}());
