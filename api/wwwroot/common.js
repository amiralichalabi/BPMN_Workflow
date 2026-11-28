'use strict';
const $ = (s, r = document) => r.querySelector(s);

function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));   // text only: no HTML injection
  }
  return e;
}
const SVGNS = 'http://www.w3.org/2000/svg';
function sv(tag, attrs, ...kids) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  for (const c of kids.flat()) if (c) e.append(c);
  return e;
}

const fa = (d) => d ? new Date(d).toLocaleString('fa-IR-u-ca-persian', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const faDate = (d) => d ? new Date(d).toLocaleDateString('fa-IR-u-ca-persian', { dateStyle: 'medium' }) : '—';
const num = (n) => Number(n).toLocaleString('fa-IR');
const norm = (s) => String(s ?? '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').toLowerCase();

async function http(path, opt = {}) {
  const r = await fetch(path, {
    method: opt.method || 'GET', credentials: 'same-origin',
    headers: { 'X-Studio': '1', ...(opt.body ? { 'Content-Type': 'application/json' } : {}) },
    body: opt.body ? JSON.stringify(opt.body) : undefined,
  });
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) { const e = new Error((data && data.error) || 'خطا در ارتباط با سرور'); e.status = r.status; e.data = data; throw e; }
  return data;
}

function download(blobOrText, name, type = 'application/octet-stream') {
  const blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---- exports: embed Vazirmatn so SVG/PNG look the same everywhere ---- */
let fontCss = null;
async function embeddedFontCss() {
  if (fontCss !== null) return fontCss;
  fontCss = '';
  try {
    for (const [file, w] of [['Regular', 400], ['Bold', 700]]) {
      let r = await fetch(`/lib/fonts/Vazirmatn-${file}.woff2`);
      if (!r.ok) r = await fetch('/lib/fonts/Vazirmatn%5Bwght%5D.woff2');
      if (!r.ok) continue;
      const bytes = new Uint8Array(await r.arrayBuffer());
      let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      fontCss += `@font-face{font-family:"Vazirmatn";font-weight:${w};src:url(data:font/woff2;base64,${btoa(bin)}) format("woff2")}`;
    }
  } catch { /* fall back to system fonts */ }
  return fontCss;
}
async function withFonts(svg) {
  const css = await embeddedFontCss();
  return css ? svg.replace(/(<svg[^>]*>)/, `$1<defs><style>${css}</style></defs>`) : svg;
}
async function svgToPng(svg, scale = 2) {
  svg = await withFonts(svg);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const c = document.createElement('canvas');
  c.width = (img.naturalWidth || 800) * scale; c.height = (img.naturalHeight || 600) * scale;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  return new Promise((r) => c.toBlob(r, 'image/png'));
}

/* ---- import: .bpmn / .xml / .bpm (zip containers are opened and searched for BPMN XML) ---- */
const BPMN_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function bpmnFromZip(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const td = new TextDecoder('utf-8'), found = [];
  for (let n = 0; n < count && dv.getUint32(p, true) === 0x02014b50; n++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + elen + clen;
    if (name.endsWith('/') || csize > 30e6) continue;
    const ds = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    const raw = u8.subarray(ds, ds + csize);
    try {
      const data = method === 0 ? raw : method === 8 ? await inflateRaw(raw) : null;
      if (!data) continue;
      const text = td.decode(data);
      if (text.includes(BPMN_NS)) found.push({ name, text });
    } catch { /* skip unreadable entry */ }
  }
  found.sort((a, b) => Number(/\.(bpmn|xml)$/i.test(b.name)) - Number(/\.(bpmn|xml)$/i.test(a.name)));
  return found.length ? found[0].text : null;
}
async function readBpmnFile(file) {
  const u8 = new Uint8Array(await file.arrayBuffer());
  let text;
  if (u8[0] === 0x50 && u8[1] === 0x4b) {
    text = await bpmnFromZip(u8);
    if (!text) throw new Error('داخل این فایل فشرده، BPMN استاندارد پیدا نشد. در Bizagi از File ▸ Export ▸ BPMN 2.0 خروجی بگیرید و فایل .bpmn را وارد کنید.');
  } else {
    text = new TextDecoder('utf-8').decode(u8).replace(/^\uFEFF/, '');
  }
  if (!text.includes(BPMN_NS)) throw new Error('این فایل BPMN 2.0 نیست. اگر فایل .bpm بیزاگی است، از داخل Bizagi با Export به BPMN 2.0 ذخیره کنید.');
  return text;
}

/* ---- labels ---- */
const TYPE_FA = {
  startEvent: 'رویداد شروع', endEvent: 'رویداد پایان', intermediateCatchEvent: 'رویداد میانی (دریافت)',
  intermediateThrowEvent: 'رویداد میانی (ارسال)', boundaryEvent: 'رویداد مرزی',
  task: 'فعالیت', userTask: 'وظیفه کاربر', serviceTask: 'وظیفه سرویس', manualTask: 'وظیفه دستی',
  scriptTask: 'وظیفه اسکریپت', businessRuleTask: 'وظیفه قانون', sendTask: 'وظیفه ارسال', receiveTask: 'وظیفه دریافت',
  subProcess: 'زیرفرایند', callActivity: 'فراخوانی فرایند', transaction: 'تراکنش',
  exclusiveGateway: 'دروازه انحصاری', parallelGateway: 'دروازه موازی', inclusiveGateway: 'دروازه فراگیر',
  eventBasedGateway: 'دروازه مبتنی بر رویداد', complexGateway: 'دروازه پیچیده',
  sequenceFlow: 'جریان توالی', messageFlow: 'جریان پیام', association: 'ارتباط', textAnnotation: 'یادداشت',
  studioImage: 'تصویر', studioHeader: 'سرتیتر',
  participant: 'استخر (Pool)', lane: 'خط شنا (Lane)', laneSet: 'مجموعه Lane', process: 'فرایند', collaboration: 'همکاری',
  dataObjectReference: 'شیء داده', dataStoreReference: 'مخزن داده', group: 'گروه',
};
const typeFa = (t) => TYPE_FA[t] || t;
const FIELD_FA = { name: 'نام', type: 'نوع', text: 'متن', image: 'تصویر', documentation: 'توضیحات', conditionExpression: 'شرط', sourceRef: 'مبدأ', targetRef: 'مقصد', default: 'مسیر پیش‌فرض', eventDefinition: 'نوع رویداد', isExecutable: 'اجرایی' };
const fieldFa = (f) => FIELD_FA[f] || f;
const KIND_FA = { added: 'افزوده', removed: 'حذف', changed: 'تغییر', moved: 'جابه‌جایی' };

/* ---- personal UI theme (stored in this browser only) ---- */
const THEMES = { light: 'روشن', dark: 'تیره', blue: 'آبی اداری', sand: 'شنی', forest: 'سبز' };
const UI_DEFAULT = { theme: 'light', accent: '', scale: 1 };
function loadUi() { try { return { ...UI_DEFAULT, ...JSON.parse(localStorage.getItem('studio.ui') || '{}') }; } catch { return { ...UI_DEFAULT }; } }
function applyUi(ui) {
  const r = document.documentElement;
  r.dataset.theme = THEMES[ui.theme] ? ui.theme : 'light';
  if (/^#[0-9a-f]{6}$/i.test(ui.accent || '')) r.style.setProperty('--accent', ui.accent); else r.style.removeProperty('--accent');
  r.style.setProperty('--scale', String(Math.min(1.3, Math.max(0.85, +ui.scale || 1))));
}
function saveUi(ui) { try { localStorage.setItem('studio.ui', JSON.stringify(ui)); } catch { /* private mode */ } applyUi(ui); }
applyUi(loadUi());

/* ---- legend of standard BPMN symbols (poster): clean cards, drawn with the workspace colours ---- */
function renderLegend(container, colors) {
  const c = colors || StudioBpmn.getStyle().colors;
  const st = (k, w = 2) => ({ fill: c[k].fill, stroke: c[k].stroke, 'stroke-width': w });
  const line = { stroke: '#334155', 'stroke-width': 1.6, fill: 'none' };
  const person = (x, y) => [sv('circle', { cx: x, cy: y, r: 2.6, ...line }), sv('path', { d: `M${x - 5} ${y + 9}v-3a5 5 0 0 1 10 0v3z`, ...line })];
  const diamond = (inner, k = 'gateway') => [sv('path', { d: 'M40 5 L62 25 L40 45 L18 25 Z', ...st(k) }), ...inner];
  const task = (extra = []) => [sv('rect', { x: 12, y: 8, width: 60, height: 34, rx: 8, ...st('task') }), ...extra];
  const cards = [
    ['رویداد شروع', [sv('circle', { cx: 40, cy: 25, r: 15, ...st('startEvent') })]],
    ['رویداد میانی', [sv('circle', { cx: 40, cy: 25, r: 15, ...st('intermediateEvent') }), sv('circle', { cx: 40, cy: 25, r: 11.5, ...st('intermediateEvent', 1.4), fill: 'none' })]],
    ['رویداد پایان', [sv('circle', { cx: 40, cy: 25, r: 15, ...st('endEvent', 4.5) })]],
    ['فعالیت (Task)', task()],
    ['وظیفه کاربر', task(person(24, 17))],
    ['وظیفه سرویس', task([sv('circle', { cx: 25, cy: 22, r: 5, ...line }), sv('circle', { cx: 25, cy: 22, r: 1.8, ...line })])],
    ['زیرفرایند (Sub-process)', [sv('rect', { x: 8, y: 6, width: 68, height: 38, rx: 9, ...st('subProcess') }),
      sv('rect', { x: 36, y: 31, width: 12, height: 12, ...line, fill: '#fff' }), sv('path', { d: 'M42 34v6M39 37h6', ...line })]],
    ['دروازه انحصاری (XOR)', diamond([sv('path', { d: 'M33 18l14 14M47 18l-14 14', ...line, 'stroke-width': 3 })])],
    ['دروازه موازی (AND)', diamond([sv('path', { d: 'M40 15v20M30 25h20', ...line, 'stroke-width': 3 })])],
    ['دروازه فراگیر (OR)', diamond([sv('circle', { cx: 40, cy: 25, r: 9, ...line, 'stroke-width': 3 })])],
    ['جریان توالی', [sv('defs', {}, sv('marker', { id: 'lgA', markerWidth: 8, markerHeight: 8, refX: 7, refY: 4, orient: 'auto' }, sv('path', { d: 'M0 0L8 4L0 8z', fill: '#334155' }))), sv('path', { d: 'M8 25H70', ...line, 'marker-end': 'url(#lgA)' })]],
    ['جریان پیام', [sv('defs', {}, sv('marker', { id: 'lgB', markerWidth: 9, markerHeight: 9, refX: 8, refY: 4.5, orient: 'auto' }, sv('path', { d: 'M0 0L9 4.5L0 9z', fill: '#fff', stroke: '#334155' }))), sv('circle', { cx: 10, cy: 25, r: 3, fill: '#fff', stroke: '#334155', 'stroke-width': 1.5 }), sv('path', { d: 'M14 25H72', ...line, 'stroke-dasharray': '5 3', 'marker-end': 'url(#lgB)' })]],
    ['شیء داده', [sv('path', { d: 'M28 6h18l10 10v28H28z M46 6v10h10', ...st('data', 1.8) })]],
    ['یادداشت', [sv('path', { d: 'M30 8h-8v34h8', ...line }), sv('path', { d: 'M36 18h28M36 26h28M36 34h20', stroke: '#94a3b8', 'stroke-width': 2 })]],
    ['استخر (Pool)', [sv('rect', { x: 6, y: 8, width: 72, height: 34, fill: '#fff', stroke: '#334155', 'stroke-width': 1.6 }), sv('path', { d: 'M20 8v34', ...line })]],
  ];
  container.replaceChildren(...cards.map(([label, shapes]) => h('div', { class: 'lcard' },
    sv('svg', { viewBox: '0 0 84 50', 'aria-hidden': 'true' }, shapes), h('span', {}, label))));
}
