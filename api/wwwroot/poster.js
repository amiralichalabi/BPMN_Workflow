'use strict';
(async () => {
  document.documentElement.dataset.theme = 'light';
  document.documentElement.style.removeProperty('--accent');
  const q = new URLSearchParams(location.search);
  if (q.get('embed') === '1') $('#poster').classList.add('embed');
  const fail = (m) => { $('#canvas').replaceChildren(h('p', { class: 'err', style: 'padding:30px' }, m)); };
  let data;
  try {
    if (q.get('t')) {
      const d = await http('/api/public/' + encodeURIComponent(q.get('t')));
      data = { ...d, style: d.style };
    } else {
      const id = q.get('d') || '';
      if (!/^[0-9a-f-]{36}$/i.test(id)) return fail('آدرس نامعتبر است');
      const dd = await http('/api/diagrams/' + id);
      const n = /^\d+$/.test(q.get('v') || '') ? q.get('v') : dd.headVersion;
      const [v, style] = await Promise.all([http(`/api/diagrams/${id}/versions/${n}`), http('/api/settings/style')]);
      data = { title: dd.title, system: dd.system, number: v.number, createdAt: v.createdAt, author: v.author, hash: v.hash, xml: v.xml, style };
    }
  } catch (e) { return fail(e.status === 401 ? 'برای مشاهده این پوستر باید وارد شوید.' : e.message); }

  if (data.style) StudioBpmn.setStyle(data.style);
  document.title = data.title;
  $('#title').textContent = data.title;
  if (data.system) { $('#sys').hidden = false; $('#sys').textContent = data.system; }
  $('#info').replaceChildren(
    h('span', {}, 'نسخه ', h('span', { class: 'ltr' }, 'v' + data.number)),
    h('span', {}, fa(data.createdAt)), h('span', {}, 'ثبت‌کننده: ' + data.author),
    h('span', {}, 'کد: ', h('span', { class: 'ltr' }, data.hash)));

  const viewer = new BpmnJS({ container: '#canvas', ...StudioBpmn.options('viewer') });
  try { await viewer.importXML(data.xml); } catch (e) { return fail('نمایش نمودار ممکن نشد: ' + e.message); }
  const fit = () => viewer.get('canvas').zoom('fit-viewport', 'center');
  fit(); addEventListener('resize', fit);
  renderLegend($('#legend'), StudioBpmn.getStyle().colors);

  $('#b-print').onclick = () => { fit(); print(); };
  $('#b-svg').onclick = async () => download(await withFonts((await viewer.saveSVG()).svg), data.title + '.svg', 'image/svg+xml');
  $('#b-png').onclick = async () => download(await svgToPng((await viewer.saveSVG()).svg), data.title + '.png');
  if (location.hash === '#print') setTimeout(() => print(), 500);
  $('#b-full').onclick = () => document.documentElement.requestFullscreen?.();
})();
