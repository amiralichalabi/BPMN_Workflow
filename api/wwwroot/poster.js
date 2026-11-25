'use strict';
(async () => {
  const q = new URLSearchParams(location.search);
  const fail = (m) => { $('#canvas').replaceChildren(h('p', { class: 'err', style: 'padding:30px' }, m)); };
  let data;
  try {
    if (q.get('t')) {
      const d = await http('/api/public/' + encodeURIComponent(q.get('t')));
      data = { title: d.title, number: d.number, createdAt: d.createdAt, author: d.author, hash: d.hash, xml: d.xml };
    } else {
      const id = q.get('d') || '';
      if (!/^[0-9a-f-]{36}$/i.test(id)) return fail('آدرس نامعتبر است');
      const dd = await http('/api/diagrams/' + id);
      const n = /^\d+$/.test(q.get('v') || '') ? q.get('v') : dd.headVersion;
      const v = await http(`/api/diagrams/${id}/versions/${n}`);
      data = { title: dd.title, number: v.number, createdAt: v.createdAt, author: v.author, hash: v.hash, xml: v.xml };
    }
  } catch (e) { return fail(e.status === 401 ? 'برای مشاهده این پوستر باید وارد شوید.' : e.message); }

  document.title = data.title;
  $('#title').textContent = data.title;
  $('#info').replaceChildren(
    h('div', {}, 'نسخه ', h('span', { class: 'ltr' }, 'v' + data.number)),
    h('div', {}, fa(data.createdAt)), h('div', {}, 'ثبت‌کننده: ' + data.author),
    h('div', {}, 'کد: ', h('span', { class: 'ltr' }, data.hash)));

  const viewer = new BpmnJS({ container: '#canvas' });
  await viewer.importXML(data.xml);
  const fit = () => viewer.get('canvas').zoom('fit-viewport', 'auto');
  fit(); addEventListener('resize', fit);

  const legend = new BpmnJS({ container: '#legend' });
  await legend.importXML(legendXml());
  legend.get('canvas').zoom('fit-viewport', 'auto');

  $('#b-print').onclick = () => { fit(); print(); };
  $('#b-svg').onclick = async () => download((await viewer.saveSVG()).svg, data.title + '.svg', 'image/svg+xml');
  $('#b-png').onclick = async () => download(await svgToPng((await viewer.saveSVG()).svg), data.title + '.png');
  $('#b-full').onclick = () => document.documentElement.requestFullscreen?.();
})();
