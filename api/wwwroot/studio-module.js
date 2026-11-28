'use strict';
/* Shared bpmn-js extension: colours per element type, header + image decorations, no auto start-event in sub-processes. */
(function () {
  const NS = 'http://bpmn-studio.local/schema';
  const MODDLE = {
    name: 'Studio', uri: NS, prefix: 'studio', xml: { tagAlias: 'lowerCase' },
    types: [
      { name: 'Image', superClass: ['Element'], properties: [{ name: 'src', isAttr: true, type: 'String' }] },
      { name: 'Header', superClass: ['Element'], properties: [] },
    ],
  };
  const FONT_CSS = {
    auto: '"StudioLatin","Vazirmatn",Tahoma,sans-serif', vazirmatn: '"Vazirmatn",Tahoma,sans-serif',
    times: '"Times New Roman",Times,serif', tahoma: 'Tahoma,sans-serif', arial: 'Arial,sans-serif',
    georgia: 'Georgia,serif', courier: '"Courier New",monospace',
  };
  const DEFAULT_STYLE = {
    font: 'auto', fontSize: 13,
    colors: {
      task: { fill: '#dbeafe', stroke: '#1d4ed8' }, subProcess: { fill: '#e0e7ff', stroke: '#4338ca' },
      startEvent: { fill: '#dcfce7', stroke: '#15803d' }, intermediateEvent: { fill: '#fef9c3', stroke: '#ca8a04' },
      endEvent: { fill: '#fee2e2', stroke: '#b91c1c' }, gateway: { fill: '#fde68a', stroke: '#a16207' },
      data: { fill: '#f1f5f9', stroke: '#475569' }, header: { fill: '#0f3d4c', stroke: '#0f3d4c' },
    },
  };
  const state = { style: JSON.parse(JSON.stringify(DEFAULT_STYLE)) };
  const SVG = 'http://www.w3.org/2000/svg';
  const DATA_IMG = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;

  function colorKey(type) {
    if (type === 'bpmn:StartEvent') return 'startEvent';
    if (type === 'bpmn:EndEvent') return 'endEvent';
    if (type === 'bpmn:IntermediateCatchEvent' || type === 'bpmn:IntermediateThrowEvent' || type === 'bpmn:BoundaryEvent') return 'intermediateEvent';
    if (/Gateway$/.test(type)) return 'gateway';
    if (type === 'bpmn:SubProcess' || type === 'bpmn:Transaction' || type === 'bpmn:AdHocSubProcess') return 'subProcess';
    if (/Task$/.test(type) || type === 'bpmn:CallActivity') return 'task';
    if (type === 'bpmn:DataObjectReference' || type === 'bpmn:DataStoreReference') return 'data';
    return null;
  }
  function studioExt(bo) {
    const ev = bo && bo.extensionElements && bo.extensionElements.values;
    return ev ? ev.find((v) => v.$type === 'studio:Image' || v.$type === 'studio:Header') : null;
  }
  const mk = (tag, attrs) => { const e = document.createElementNS(SVG, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  function lum(hex) { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; }

  function drawImage(parent, el, ext) {
    const rect = mk('rect', { x: 0, y: 0, width: el.width, height: el.height, fill: 'rgba(255,255,255,0.01)', stroke: 'none' });
    parent.appendChild(rect);
    const src = ext.src || '';
    if (DATA_IMG.test(src)) parent.appendChild(mk('image', { href: src, x: 0, y: 0, width: el.width, height: el.height, preserveAspectRatio: 'xMidYMid meet' }));
    else { const t = mk('text', { x: el.width / 2, y: el.height / 2, 'text-anchor': 'middle', fill: '#999' }); t.textContent = '🖼'; parent.appendChild(t); }
    return rect;
  }
  function drawHeader(parent, el, bo) {
    const c = state.style.colors.header;
    const rect = mk('rect', { x: 0, y: 0, width: el.width, height: el.height, rx: 8, ry: 8, fill: c.fill, stroke: c.stroke, 'stroke-width': 2 });
    parent.appendChild(rect);
    const t = mk('text', {
      x: el.width / 2, y: el.height / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central',
      fill: lum(c.fill) > 0.6 ? '#14202e' : '#ffffff', 'font-weight': 700,
      'font-size': Math.round(state.style.fontSize * 1.9), 'font-family': FONT_CSS[state.style.font] || FONT_CSS.auto,
    });
    t.textContent = (bo.text || '').split('\n')[0];
    parent.appendChild(t);
    return rect;
  }
  function colorize(gfx, el, key) {
    const di = el.di || (el.businessObject && el.businessObject.di);
    try { if (di && (di.get('bioc:fill') || di.get('bioc:stroke') || di.fill || di.stroke)) return; } catch (e) { /* no bioc */ }
    const c = state.style.colors[key];
    if (!c || !gfx || !gfx.style) return;
    gfx.style.fill = c.fill; gfx.style.stroke = c.stroke;
  }

  function StudioRenderer(eventBus, bpmnRenderer) {
    eventBus.on('render.shape', 1500, function (evt, ctx) {
      const el = ctx.element, bo = el.businessObject;
      if (!bo) return;
      const ext = studioExt(bo);
      if (ext && ext.$type === 'studio:Image') return drawImage(ctx.gfx, el, ext);
      if (ext && ext.$type === 'studio:Header') return drawHeader(ctx.gfx, el, bo);
      const key = colorKey(bo.$type);
      if (!key) return undefined;            // let the default renderer draw it
      const gfx = bpmnRenderer.drawShape(ctx.gfx, el);
      try { colorize(gfx, el, key); } catch (e) { /* cosmetic only */ }
      return gfx;
    });
  }
  StudioRenderer.$inject = ['eventBus', 'bpmnRenderer'];

  // bpmn-js adds a start event inside every new expanded sub-process (the "circle in the middle"). Remove it.
  function SubProcessCleanup(eventBus, modeling) {
    eventBus.on('commandStack.shape.create.postExecuted', 100, function (e) {
      const shape = e.context && e.context.shape;
      const bo = shape && shape.businessObject;
      if (!bo || !['bpmn:SubProcess', 'bpmn:Transaction', 'bpmn:AdHocSubProcess'].includes(bo.$type) || bo.triggeredByEvent) return;
      const starters = (shape.children || []).filter((c) => c.businessObject && c.businessObject.$type === 'bpmn:StartEvent'
        && !(c.incoming && c.incoming.length) && !(c.outgoing && c.outgoing.length));
      if (starters.length) modeling.removeElements(starters);
    });
  }
  SubProcessCleanup.$inject = ['eventBus', 'modeling'];

  const RendererModule = { __init__: ['studioRenderer'], studioRenderer: ['type', StudioRenderer] };
  const CleanupModule = { __init__: ['subProcessCleanup'], subProcessCleanup: ['type', SubProcessCleanup] };

  window.StudioBpmn = {
    NS, FONT_CSS, DEFAULT_STYLE,
    getStyle: () => state.style,
    setStyle(s) { state.style = { font: s.font, fontSize: s.fontSize, colors: Object.assign({}, DEFAULT_STYLE.colors, s.colors) }; },
    options(kind) {
      const st = state.style;
      return {
        additionalModules: kind === 'modeler' ? [RendererModule, CleanupModule] : [RendererModule],
        moddleExtensions: { studio: MODDLE },
        textRenderer: { defaultStyle: { fontFamily: FONT_CSS[st.font] || FONT_CSS.auto, fontSize: st.fontSize } },
      };
    },
    redraw(inst) {
      try {
        const reg = inst.get('elementRegistry'), gf = inst.get('graphicsFactory');
        reg.forEach((el) => { const gfx = reg.getGraphics(el); if (gfx && !el.waypoints) gf.update('shape', el, gfx); });
      } catch (e) { /* ignore */ }
    },
  };
})();
