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

const fa = (d) => d ? new Date(d).toLocaleString('fa-IR-u-ca-persian', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const num = (n) => Number(n).toLocaleString('fa-IR');

async function http(path, opt = {}) {
  const r = await fetch(path, {
    method: opt.method || 'GET',
    credentials: 'same-origin',
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

async function svgToPng(svg, scale = 2) {
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

const TYPE_FA = {
  startEvent: 'رویداد شروع', endEvent: 'رویداد پایان', intermediateCatchEvent: 'رویداد میانی (دریافت)',
  intermediateThrowEvent: 'رویداد میانی (ارسال)', boundaryEvent: 'رویداد مرزی',
  task: 'فعالیت', userTask: 'وظیفه کاربر', serviceTask: 'وظیفه سرویس', manualTask: 'وظیفه دستی',
  scriptTask: 'وظیفه اسکریپت', businessRuleTask: 'وظیفه قانون کسب‌وکار', sendTask: 'وظیفه ارسال', receiveTask: 'وظیفه دریافت',
  subProcess: 'زیرفرایند', callActivity: 'فراخوانی فرایند', transaction: 'تراکنش',
  exclusiveGateway: 'دروازه انحصاری', parallelGateway: 'دروازه موازی', inclusiveGateway: 'دروازه فراگیر',
  eventBasedGateway: 'دروازه مبتنی بر رویداد', complexGateway: 'دروازه پیچیده',
  sequenceFlow: 'جریان توالی', messageFlow: 'جریان پیام', association: 'ارتباط', textAnnotation: 'یادداشت',
  participant: 'استخر (Pool)', lane: 'خط شنا (Lane)', laneSet: 'مجموعه Lane', process: 'فرایند', collaboration: 'همکاری',
  dataObjectReference: 'شیء داده', dataStoreReference: 'مخزن داده', group: 'گروه',
};
const typeFa = (t) => TYPE_FA[t] || t;
const FIELD_FA = { name: 'نام', type: 'نوع', documentation: 'توضیحات', conditionExpression: 'شرط', sourceRef: 'مبدأ', targetRef: 'مقصد', default: 'مسیر پیش‌فرض', eventDefinition: 'نوع رویداد', isExecutable: 'اجرایی' };
const fieldFa = (f) => FIELD_FA[f] || f;
const KIND_FA = { added: 'افزوده', removed: 'حذف', changed: 'تغییر', moved: 'جابه‌جایی' };

/* legend of standard BPMN symbols, rendered by bpmn-js itself */
function legendXml() {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const items = [
    ['startEvent', 'رویداد شروع', 36], ['task', 'فعالیت', 100], ['userTask', 'وظیفه کاربر', 100], ['serviceTask', 'وظیفه سرویس', 100],
    ['exclusiveGateway', 'دروازه انحصاری (XOR)', 50], ['parallelGateway', 'دروازه موازی (AND)', 50], ['inclusiveGateway', 'دروازه فراگیر (OR)', 50],
    ['intermediateCatchEvent', 'رویداد تایمر', 36], ['endEvent', 'رویداد پایان', 36],
  ];
  let procs = '', shapes = '', x = 20;
  items.forEach(([t, label, size], i) => {
    const inner = t === 'intermediateCatchEvent' ? '<bpmn:timerEventDefinition />' : '';
    procs += `<bpmn:${t} id="L${i}" name="${esc(label)}">${inner}</bpmn:${t}>`;
    const w = size, hh = t.endsWith('Task') || t === 'task' ? 80 : size;
    const y = 60 - hh / 2;
    const marker = t === 'exclusiveGateway' ? ' isMarkerVisible="true"' : '';
    shapes += `<bpmndi:BPMNShape id="L${i}_di" bpmnElement="L${i}"${marker}><dc:Bounds x="${x}" y="${y}" width="${w}" height="${hh}"/></bpmndi:BPMNShape>`;
    x += w + 60;
  });
  return `<?xml version="1.0" encoding="UTF-8"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="D" targetNamespace="http://example.org/legend"><bpmn:process id="P" isExecutable="false">${procs}</bpmn:process><bpmndi:BPMNDiagram id="BD"><bpmndi:BPMNPlane id="BP" bpmnElement="P">${shapes}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;
}
