'use strict';
const S = { user: null, ed: null };
const root = $('#app');
const isDesigner = () => S.user && (S.user.role === 'designer' || S.user.role === 'admin');
const ROLE_FA = { viewer: 'بیننده', designer: 'طراح', admin: 'مدیر' };

/* ---------- ui helpers ---------- */
function toast(msg, bad) {
  const t = h('div', { class: 'toast' + (bad ? ' bad' : ''), role: 'status' }, msg);
  document.body.append(t); setTimeout(() => t.remove(), 3500);
}

function modal(title, body, actions = [], big = false) {
  const dlg = h('dialog', { class: big ? 'big' : '' });
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.append(
    h('div', { class: 'mh' }, h('span', {}, title), h('button', { class: 'btn small', onclick: close, 'aria-label': 'بستن' }, '✕')),
    h('div', { class: 'mb' }, body),
    h('div', { class: 'mf' }, actions.map((a) => h('button', {
      class: 'btn ' + (a.kind || ''), onclick: async (ev) => {
        ev.target.disabled = true;
        try { if ((await a.onClick(close)) === false) ev.target.disabled = false; }
        catch (e) { toast(e.message, true); ev.target.disabled = false; }
      },
    }, a.label)), h('button', { class: 'btn', onclick: close }, 'انصراف')));
  dlg.addEventListener('cancel', () => dlg.remove());
  document.body.append(dlg); dlg.showModal();
  return { close, el: dlg };
}

function shell(content, wide) {
  root.replaceChildren(
    h('div', { class: 'page' },
      h('div', { class: 'top' },
        h('a', { class: 'brand', href: '#/' }, 'استودیوی BPMN'),
        h('nav', {},
          h('a', { href: '#/', class: location.hash.startsWith('#/admin') ? '' : 'on' }, 'نمودارها'),
          S.user.role === 'admin' ? h('a', { href: '#/admin', class: location.hash.startsWith('#/admin') ? 'on' : '' }, 'مدیریت') : null),
        h('span', { class: 'who' }, `${S.user.username} (${ROLE_FA[S.user.role]})`),
        h('button', { onclick: changePassword }, 'رمز عبور'),
        h('button', { onclick: async () => { await http('/api/auth/logout', { method: 'POST' }).catch(() => {}); S.user = null; location.hash = '#/'; route(); } }, 'خروج')),
      h('main', { class: wide ? 'wide' : '', style: wide ? 'flex:1;min-height:0;display:flex;flex-direction:column' : '' }, content)));
}

function changePassword() {
  const cur = h('input', { type: 'password', autocomplete: 'current-password' });
  const nxt = h('input', { type: 'password', autocomplete: 'new-password' });
  modal('تغییر رمز عبور', [h('label', {}, 'رمز فعلی'), cur, h('label', {}, 'رمز جدید (حداقل ۱۰ نویسه)'), nxt],
    [{ label: 'ذخیره', kind: 'primary', onClick: async (close) => { await http('/api/auth/password', { method: 'POST', body: { current: cur.value, next: nxt.value } }); toast('رمز عبور تغییر کرد'); close(); } }]);
}

/* ---------- router ---------- */
function goto(hash) { if (location.hash === hash) route(); else location.hash = hash; }

async function boot() {
  try { S.user = await http('/api/auth/me'); } catch { S.user = null; }
  route();
}
addEventListener('hashchange', route);
addEventListener('beforeunload', (e) => { if (S.ed && S.ed.dirty) { e.preventDefault(); e.returnValue = ''; } });

function route() {
  teardownEditor();
  if (!S.user) return viewLogin();
  const m = location.hash.match(/^#\/d\/([0-9a-f-]{36})(?:\/v\/(\d+))?$/i);
  if (m) return viewEditor(m[1], m[2] ? +m[2] : null);
  if (location.hash === '#/admin' && S.user.role === 'admin') return viewAdmin();
  viewLibrary();
}

function teardownEditor() {
  if (!S.ed) return;
  try { S.ed.modeler && S.ed.modeler.destroy(); } catch {}
  try { S.ed.viewer && S.ed.viewer.destroy(); } catch {}
  S.ed = null;
}

/* ---------- login ---------- */
function viewLogin() {
  const u = h('input', { type: 'text', autocomplete: 'username', autofocus: true });
  const p = h('input', { type: 'password', autocomplete: 'current-password' });
  const msg = h('p', { class: 'err' });
  const go = async (ev) => {
    ev.preventDefault(); msg.textContent = '';
    try { S.user = await http('/api/auth/login', { method: 'POST', body: { username: u.value, password: p.value } }); route(); }
    catch (e) { msg.textContent = e.message; }
  };
  root.replaceChildren(h('form', { class: 'login', onsubmit: go },
    h('h1', {}, 'استودیوی BPMN'), h('p', { class: 'muted' }, 'طراحی، نسخه‌بندی و نمایش فرایندها'),
    h('label', {}, 'نام کاربری'), u, h('label', {}, 'رمز عبور'), p, msg,
    h('p', {}, h('button', { class: 'btn primary', type: 'submit' }, 'ورود'))));
}

/* ---------- library ---------- */
async function viewLibrary() {
  const list = h('div', { class: 'rows' });
  let timer;
  const q = h('input', { type: 'search', placeholder: 'جست‌وجو در عنوان و توضیحات…', oninput: () => { clearTimeout(timer); timer = setTimeout(load, 250); } });
  async function load() {
    try {
      const rows = await http('/api/diagrams?q=' + encodeURIComponent(q.value));
      list.replaceChildren(...(rows.length ? rows.map((d) => h('div', { class: 'row' },
        h('div', { class: 't' }, h('a', { href: '#/d/' + d.id }, d.title), h('div', { class: 'd' }, d.description || '')),
        h('span', { class: 'vbadge ltr' }, 'v' + d.headVersion),
        h('span', { class: 'd' }, `${d.updatedBy} · ${fa(d.updatedAt)}`)))
        : [h('div', { class: 'row muted' }, 'نموداری یافت نشد. ' + (isDesigner() ? 'با «نمودار جدید» شروع کنید.' : ''))]));
    } catch (e) { list.replaceChildren(h('div', { class: 'row err' }, e.message)); }
  }
  shell([h('div', { class: 'bar-row' }, q, isDesigner() ? h('button', { class: 'btn primary', onclick: newDiagram }, 'نمودار جدید') : null), list]);
  load();
}

function newDiagram() {
  const t = h('input', { type: 'text', maxlength: 120 });
  const d = h('textarea', { rows: 2, maxlength: 500 });
  const f = h('input', { type: 'file', accept: '.bpmn,.xml' });
  modal('نمودار جدید', [h('label', {}, 'عنوان'), t, h('label', {}, 'توضیحات (اختیاری)'), d,
    h('label', {}, 'یا یک فایل .bpmn موجود را وارد کنید (اختیاری)'), f],
    [{ label: 'ایجاد', kind: 'primary', onClick: async (close) => {
      const xml = f.files[0] ? await f.files[0].text() : undefined;
      const r = await http('/api/diagrams', { method: 'POST', body: { title: t.value, description: d.value, xml } });
      close(); goto('#/d/' + r.id);
    } }]);
}

/* ---------- editor ---------- */
async function viewEditor(id, vNum) {
  shell(h('p', { class: 'muted', style: 'padding:20px' }, 'در حال بارگذاری…'), true);
  const ed = S.ed = { id, dirty: false, modeler: null, viewer: null };
  try {
    [ed.d, ed.versions] = await Promise.all([http('/api/diagrams/' + id), http(`/api/diagrams/${id}/versions`)]);
  } catch (e) { return shell(h('p', { class: 'err', style: 'padding:20px' }, e.message)); }
  const head = ed.d.headVersion;
  ed.shown = vNum && vNum !== head ? vNum : head;
  ed.readOnly = !isDesigner() || ed.shown !== head;
  let ver;
  try { ver = await http(`/api/diagrams/${id}/versions/${ed.shown}`); }
  catch (e) { return shell(h('p', { class: 'err', style: 'padding:20px' }, e.message)); }
  ed.headXml = ed.shown === head ? ver.xml : null;

  const dirtyEl = h('span', { class: 'dirty', hidden: true }, '● تغییرات ذخیره‌نشده');
  const banner = h('div', { class: 'banner', hidden: !(ed.shown !== head) },
    h('span', {}, `در حال مشاهده نسخه v${ed.shown} (فقط‌خواندنی) — آخرین نسخه v${head} است.`),
    h('a', { class: 'btn small', href: '#/d/' + id }, 'بازگشت به آخرین نسخه'),
    isDesigner() ? h('button', { class: 'btn small primary', onclick: () => restore(ed.shown) }, 'بازگردانی این نسخه') : null);
  const hist = h('aside', { class: 'hist' });
  ed.histEl = hist;
  const mod = h('div', { id: 'mod', dir: 'ltr' }), vw = h('div', { id: 'vw', dir: 'ltr' });

  const exportMenu = h('select', { 'aria-label': 'خروجی', onchange: async (e) => {
    const k = e.target.value; e.target.value = ''; if (!k) return;
    const inst = ed.readOnly ? ed.viewer : ed.modeler;
    const base = `${ed.d.title}-v${ed.shown}`;
    if (k === 'bpmn') download((await inst.saveXML({ format: true })).xml, base + '.bpmn', 'application/xml');
    if (k === 'svg') download((await inst.saveSVG()).svg, base + '.svg', 'image/svg+xml');
    if (k === 'png') download(await svgToPng((await inst.saveSVG()).svg), base + '.png');
  }}, h('option', { value: '' }, 'خروجی…'), h('option', { value: 'bpmn' }, 'فایل BPMN'), h('option', { value: 'svg' }, 'تصویر SVG'), h('option', { value: 'png' }, 'تصویر PNG'));
  exportMenu.style.width = 'auto';

  const titleEl = h('h2', {}, ed.d.title);
  shell(h('div', { class: 'page' },
    h('div', { class: 'ebar' },
      h('a', { class: 'btn small', href: '#/' }, '→ نمودارها'), titleEl,
      isDesigner() ? h('button', { class: 'btn small', onclick: rename, 'aria-label': 'تغییر عنوان' }, '✎') : null,
      h('span', { class: 'vbadge ltr' }, 'v' + ed.shown), dirtyEl, h('span', { class: 'sp' }),
      !ed.readOnly ? h('button', { class: 'btn primary', onclick: saveFlow }, 'ثبت نسخه جدید') : null,
      h('button', { class: 'btn', onclick: () => { hist.hidden = !hist.hidden; } }, 'تاریخچه'),
      h('a', { class: 'btn', href: `/poster.html?d=${id}&v=${ed.shown}`, target: '_blank', rel: 'noopener' }, 'پوستر'),
      isDesigner() ? h('button', { class: 'btn', onclick: shareDlg }, 'اشتراک‌گذاری') : null,
      exportMenu),
    banner,
    h('div', { class: 'work' }, h('div', { class: 'stage' }, mod, vw), hist)), true);

  if (ed.readOnly) {
    mod.hidden = true;
    ed.viewer = new BpmnViewer({ container: vw });
    await ed.viewer.importXML(ver.xml);
    ed.viewer.get('canvas').zoom('fit-viewport', 'auto');
  } else {
    vw.hidden = true;
    ed.modeler = new BpmnJS({ container: mod, keyboard: { bindTo: document } });
    await ed.modeler.importXML(ver.xml);
    ed.modeler.get('canvas').zoom('fit-viewport', 'auto');
    ed.modeler.on('commandStack.changed', () => { ed.dirty = true; dirtyEl.hidden = false; });
  }
  ed.dirtyEl = dirtyEl;
  renderHistory();

  async function rename() {
    const t = h('input', { type: 'text', value: ed.d.title, maxlength: 120 });
    modal('تغییر عنوان', [h('label', {}, 'عنوان'), t], [{ label: 'ذخیره', kind: 'primary', onClick: async (close) => {
      ed.d = await http('/api/diagrams/' + id, { method: 'PATCH', body: { title: t.value } });
      titleEl.textContent = ed.d.title; close();
    } }]);
  }
}

function renderHistory() {
  const ed = S.ed; if (!ed) return;
  const vs = ed.versions;
  const nums = vs.map((v) => v.number);
  const from = h('select', {}, nums.map((n) => h('option', { value: n }, 'v' + n)));
  const to = h('select', {}, nums.map((n) => h('option', { value: n }, 'v' + n)));
  if (nums.length > 1) { from.value = nums[1]; to.value = nums[0]; }
  const chips = (v) => h('div', { class: 'chips' },
    v.added ? h('span', { class: 'chip added' }, '+' + v.added) : null,
    v.removed ? h('span', { class: 'chip removed' }, '−' + v.removed) : null,
    v.changed ? h('span', { class: 'chip changed' }, '~' + v.changed) : null,
    v.moved ? h('span', { class: 'chip moved' }, '↔' + v.moved) : null,
    v.tags.map((t) => h('span', { class: 'chip tag' }, '🏷 ' + t)));

  ed.histEl.replaceChildren(
    h('h3', {}, `تاریخچه نسخه‌ها (${num(vs.length)})`),
    vs.length > 1 ? h('div', { class: 'cmp' }, 'مقایسه', from, 'با', to,
      h('button', { class: 'btn small', onclick: () => openDiff(+from.value, +to.value) }, 'نمایش تغییرات')) : null,
    h('ul', { class: 'tl' }, vs.map((v) => h('li', { class: (v.number === ed.d.headVersion ? 'head ' : '') + (v.number === ed.shown ? 'cur' : '') },
      h('div', {}, h('span', { class: 'vn ltr' }, 'v' + v.number), v.number === ed.d.headVersion ? ' (آخرین)' : ''),
      h('div', { class: 'msg' }, v.message),
      chips(v),
      h('div', { class: 'meta' }, `${v.author} · ${fa(v.createdAt)} · `, h('span', { class: 'ltr' }, v.hash)),
      h('div', { class: 'acts' },
        v.number !== ed.shown ? h('a', { class: 'btn small', href: `#/d/${ed.id}/v/${v.number}` }, 'مشاهده') : null,
        v.number > 1 ? h('button', { class: 'btn small', onclick: () => openDiff(v.number - 1, v.number) }, 'تغییرات') : null,
        isDesigner() ? h('button', { class: 'btn small', onclick: () => tagDlg(v.number) }, 'برچسب') : null,
        isDesigner() && v.number !== ed.d.headVersion ? h('button', { class: 'btn small', onclick: () => restore(v.number) }, 'بازگردانی') : null)))));
}

function changeList(items, onPick) {
  if (!items.length) return h('p', { class: 'muted' }, 'تغییری نسبت به آخرین نسخه وجود ندارد.');
  const order = { added: 0, changed: 1, moved: 2, removed: 3 };
  return h('ul', { class: 'changes' }, [...items].sort((a, b) => order[a.kind] - order[b.kind]).map((i) => h('li', { 'data-id': i.id, onclick: () => onPick && onPick(i) },
    h('span', { class: 'tagk ' + i.kind }, KIND_FA[i.kind]),
    h('span', {}, typeFa(i.type) + (i.name ? ` «${i.name}»` : '')),
    i.details && i.details.length ? h('span', { class: 'muted' }, i.details.map((d) => `${fieldFa(d.field)}: ${d.from ?? '∅'} ← ${d.to ?? '∅'}`).join(' ، ')) : null)));
}
const summaryChips = (items) => h('div', { class: 'summary' }, ['added', 'removed', 'changed', 'moved'].map((k) => {
  const n = items.filter((i) => i.kind === k).length;
  return n ? h('span', { class: 'chip ' + k }, `${KIND_FA[k]}: ${num(n)}`) : null;
}));

async function saveFlow() {
  const ed = S.ed; if (!ed || ed.readOnly) return;
  const { xml } = await ed.modeler.saveXML({ format: true });
  let prev;
  try { prev = await http(`/api/diagrams/${ed.id}/preview`, { method: 'POST', body: { xml } }); }
  catch (e) { return toast(e.message, true); }
  if (!prev.items.length && !ed.dirty) return toast('تغییری برای ذخیره وجود ندارد');
  const msg = h('input', { type: 'text', maxlength: 200, placeholder: 'مثلاً: افزودن مسیر رد درخواست', autofocus: true });
  modal('ثبت نسخه جدید', [
    h('p', {}, 'این نسخه روی ', h('b', { class: 'ltr' }, 'v' + prev.headVersion), ' ثبت می‌شود. تغییرات شما:'),
    summaryChips(prev.items), changeList(prev.items),
    h('label', {}, 'پیام نسخه (توضیح کوتاه تغییرات)'), msg],
    [{ label: 'ثبت نسخه', kind: 'primary', onClick: async (close) => {
      if (!msg.value.trim()) { toast('پیام نسخه را بنویسید', true); return false; }
      try {
        const r = await http(`/api/diagrams/${ed.id}/versions`, { method: 'POST', body: { xml, message: msg.value, baseVersion: prev.headVersion } });
        ed.dirty = false; close();
        toast(r.unchanged ? 'تغییری نسبت به آخرین نسخه نبود' : `نسخه v${r.version} ثبت شد`);
        goto('#/d/' + ed.id);
      } catch (e) {
        if (e.status === 409 && e.data && e.data.headVersion) {
          close();
          modal('تداخل با نسخه جدیدتر', [h('p', { class: 'err' }, e.message),
            h('p', {}, 'می‌توانید نسخه خودتان را به‌صورت فایل BPMN نگه دارید و سپس نمودار را دوباره بارگذاری کنید.')],
            [{ label: 'دانلود نسخه من', onClick: () => { download(xml, ed.d.title + '-my-changes.bpmn', 'application/xml'); return false; } }]);
          return;
        }
        throw e;
      }
    } }]);
}

async function restore(n) {
  const ed = S.ed;
  modal('بازگردانی نسخه', [h('p', {}, `نسخه v${n} به‌عنوان یک نسخه جدید روی آخرین نسخه ثبت می‌شود. هیچ نسخه‌ای پاک نمی‌شود.`)],
    [{ label: 'بازگردانی', kind: 'primary', onClick: async (close) => {
      const r = await http(`/api/diagrams/${ed.id}/versions/${n}/restore`, { method: 'POST', body: { baseVersion: ed.d.headVersion } });
      close(); toast(r.unchanged ? 'این نسخه همان آخرین نسخه است' : `نسخه v${r.version} ثبت شد`); ed.dirty = false; goto('#/d/' + ed.id);
    } }]);
}

function tagDlg(n) {
  const t = h('input', { type: 'text', maxlength: 40, placeholder: 'مثلاً: تأیید-نهایی' });
  modal(`برچسب‌گذاری نسخه v${n}`, [h('label', {}, 'نام برچسب'), t], [{ label: 'افزودن', kind: 'primary', onClick: async (close) => {
    await http(`/api/diagrams/${S.ed.id}/tags`, { method: 'POST', body: { name: t.value, version: n } });
    S.ed.versions = await http(`/api/diagrams/${S.ed.id}/versions`); renderHistory(); close();
  } }]);
}

async function openDiff(from, to) {
  const ed = S.ed;
  if (from === to) return toast('دو نسخه متفاوت انتخاب کنید', true);
  let r;
  try { r = await http(`/api/diagrams/${ed.id}/diff?from=${from}&to=${to}`); } catch (e) { return toast(e.message, true); }
  const oldCv = h('div', { class: 'cv' }), newCv = h('div', { class: 'cv' });
  const list = changeList(r.items, (i) => {
    for (const v of [vOld, vNew]) { try { const reg = v.get('elementRegistry'); const el = reg.get(i.id); if (el) v.get('canvas').scrollToElement(el); } catch {} }
  });
  const m = modal(`تغییرات v${from} ← v${to}`, [summaryChips(r.items), list,
    h('div', { class: 'panes' }, h('div', { class: 'pane' }, h('h4', {}, `قبل (v${from}) — قرمز: حذف‌شده`), oldCv),
      h('div', { class: 'pane' }, h('h4', {}, `بعد (v${to}) — سبز: افزوده · نارنجی: تغییر · آبی خط‌چین: جابه‌جا`), newCv))], [], true);
  const vOld = new BpmnViewer({ container: oldCv }), vNew = new BpmnViewer({ container: newCv });
  const stop = () => { try { vOld.destroy(); vNew.destroy(); } catch {} };
  m.el.addEventListener('close', stop); m.el.addEventListener('cancel', stop);
  await Promise.all([vOld.importXML(r.fromXml), vNew.importXML(r.toXml)]);
  const mark = (v, kinds) => {
    const cv = v.get('canvas'), reg = v.get('elementRegistry');
    for (const i of r.items) if (kinds.includes(i.kind) && reg.get(i.id)) cv.addMarker(i.id, 'diff-' + i.kind);
    cv.zoom('fit-viewport', 'auto');
  };
  mark(vOld, ['removed', 'changed', 'moved']); mark(vNew, ['added', 'changed', 'moved']);
  let busy = false;   // keep both views panned/zoomed together
  const sync = (src, dst) => src.on('canvas.viewbox.changed', () => { if (busy) return; busy = true; dst.get('canvas').viewbox(src.get('canvas').viewbox()); busy = false; });
  sync(vOld, vNew); sync(vNew, vOld);
}

async function shareDlg() {
  const ed = S.ed;
  const sel = h('select', {}, ed.versions.map((v) => h('option', { value: v.number }, `v${v.number} — ${v.message}`)));
  sel.value = ed.shown;
  const out = h('div', {});
  async function loadList() {
    const rows = await http(`/api/diagrams/${ed.id}/shares`);
    out.replaceChildren(...rows.map((s) => {
      const url = `${location.origin}/poster.html?t=${s.token}`;
      return h('div', { class: 'row' },
        h('div', { class: 't' }, h('div', {}, `نسخه v${s.VersionNumber ?? s.versionNumber}`, s.revoked ? ' (لغو شده)' : ''),
          s.revoked ? null : h('input', { type: 'text', readonly: true, value: url, onfocus: (e) => e.target.select() }),
          h('div', { class: 'd' }, `${s.createdBy} · ${fa(s.createdAt)}`)),
        s.revoked ? null : h('button', { class: 'btn small danger', onclick: async () => { await http(`/api/shares/${s.id}/revoke`, { method: 'POST' }); loadList(); } }, 'لغو'));
    }));
  }
  modal('اشتراک‌گذاری پوستر (فقط‌خواندنی)', [
    h('p', { class: 'muted' }, 'هر کسی که پیوند را داشته باشد بدون ورود می‌تواند همین نسخه را ببیند. هر زمان بخواهید لغو کنید.'),
    h('label', {}, 'نسخه'), sel, out],
    [{ label: 'ساخت پیوند جدید', kind: 'primary', onClick: async () => { await http(`/api/diagrams/${ed.id}/shares`, { method: 'POST', body: { version: +sel.value } }); await loadList(); return false; } }]);
  loadList();
}

/* ---------- admin ---------- */
async function viewAdmin() {
  const usersEl = h('div', {}), auditEl = h('div', {});
  async function load() {
    const [users, audit] = await Promise.all([http('/api/users'), http('/api/audit')]);
    usersEl.replaceChildren(h('table', {}, h('tr', {}, h('th', {}, 'کاربر'), h('th', {}, 'نقش'), h('th', {}, 'وضعیت'), h('th', {})),
      users.map((u) => h('tr', {}, h('td', {}, u.username), h('td', {}, ROLE_FA[u.role]), h('td', {}, u.disabled ? 'غیرفعال' : 'فعال'),
        h('td', {}, u.username === S.user.username ? '' : h('button', { class: 'btn small', onclick: async () => { await http(`/api/users/${u.id}/disabled`, { method: 'POST', body: { disabled: !u.disabled } }); load(); } }, u.disabled ? 'فعال‌سازی' : 'غیرفعال‌سازی'))))));
    auditEl.replaceChildren(h('table', {}, h('tr', {}, h('th', {}, 'زمان'), h('th', {}, 'کاربر'), h('th', {}, 'رویداد'), h('th', {}, 'جزئیات')),
      audit.map((a) => h('tr', {}, h('td', {}, fa(a.timestamp)), h('td', {}, a.userName), h('td', {}, a.action), h('td', { class: 'muted' }, a.detail || '')))));
  }
  const un = h('input', { type: 'text', autocomplete: 'off' }), pw = h('input', { type: 'password', autocomplete: 'new-password' });
  const role = h('select', {}, h('option', { value: 'viewer' }, 'بیننده'), h('option', { value: 'designer' }, 'طراح'), h('option', { value: 'admin' }, 'مدیر'));
  shell(h('div', {}, h('div', { class: 'grid2' },
    h('div', {}, h('h3', {}, 'کاربران'), usersEl),
    h('div', {}, h('h3', {}, 'کاربر جدید'), h('label', {}, 'نام کاربری (انگلیسی)'), un, h('label', {}, 'رمز عبور (حداقل ۱۰ نویسه)'), pw, h('label', {}, 'نقش'), role,
      h('p', {}, h('button', { class: 'btn primary', onclick: async () => {
        try { await http('/api/users', { method: 'POST', body: { username: un.value, password: pw.value, role: role.value } }); un.value = pw.value = ''; load(); toast('کاربر ساخته شد'); }
        catch (e) { toast(e.message, true); }
      } }, 'ساخت کاربر')))),
    h('h3', {}, 'گزارش ممیزی (۳۰۰ رویداد آخر، غیرقابل ویرایش)'), auditEl));
  load().catch((e) => toast(e.message, true));
}

boot();
