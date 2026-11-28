'use strict';
const S = { user: null, ed: null, pop: null, systems: [], styleLoaded: false };
const root = $('#app');
const isDesigner = () => S.user && (S.user.role === 'designer' || S.user.role === 'admin');
const ROLE_FA = { viewer: 'بیننده', designer: 'طراح', admin: 'مدیر' };
const host = () => document.fullscreenElement || document.body;   // popovers must live inside the fullscreen element

/* ================= ui helpers ================= */
function toast(msg, bad) {
  const t = h('div', { class: 'toast' + (bad ? ' bad' : ''), role: 'status' }, msg);
  host().append(t); setTimeout(() => t.remove(), 3800);
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
    }, a.label)), h('button', { class: 'btn', onclick: close }, 'بستن')));
  dlg.addEventListener('cancel', () => dlg.remove());
  host().append(dlg); dlg.showModal();
  return { close, el: dlg };
}
function closePopover() { if (S.pop) { S.pop._off && S.pop._off(); S.pop.remove(); S.pop = null; } }
function popover(anchor, content) {
  closePopover();
  const pop = h('div', { class: 'pop', role: 'dialog' }, content);
  host().append(pop);
  const r = anchor.getBoundingClientRect(), w = Math.min(380, innerWidth * 0.94);
  pop.style.top = Math.max(8, Math.min(r.bottom + 6, innerHeight - 140)) + 'px';
  pop.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8)) + 'px';
  const outside = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) closePopover(); };
  const esc = (e) => { if (e.key === 'Escape') closePopover(); };
  setTimeout(() => { document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', esc); }, 0);
  pop._off = () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', esc); };
  S.pop = pop; return pop;
}

function shell(content, wide) {
  const onLib = !location.hash.startsWith('#/admin');
  root.replaceChildren(h('div', { class: 'page' },
    h('div', { class: 'top' },
      h('a', { class: 'brand', href: '#/' }, h('i'), 'استودیوی BPMN'),
      h('nav', {}, h('a', { href: '#/', class: onLib ? 'on' : '' }, 'گردش‌کارها'),
        S.user.role === 'admin' ? h('a', { href: '#/admin', class: onLib ? '' : 'on' }, 'مدیریت') : null),
      h('span', { class: 'who' }, `${S.user.username} (${ROLE_FA[S.user.role]})`),
      h('button', { class: 'btn small', onclick: openSettings }, '⚙ تنظیمات'),
      h('button', { class: 'btn small', onclick: changePassword }, 'رمز عبور'),
      h('button', { class: 'btn small', onclick: async () => { await http('/api/auth/logout', { method: 'POST' }).catch(() => {}); S.user = null; S.styleLoaded = false; location.hash = '#/'; route(); } }, 'خروج')),
    h('main', { class: wide ? 'wide' : '' }, content)));
}

function changePassword() {
  const cur = h('input', { type: 'password', autocomplete: 'current-password' });
  const nxt = h('input', { type: 'password', autocomplete: 'new-password' });
  modal('تغییر رمز عبور', [h('label', {}, 'رمز فعلی'), cur, h('label', {}, 'رمز جدید (حداقل ۱۰ نویسه)'), nxt],
    [{ label: 'ذخیره', kind: 'primary', onClick: async (close) => { await http('/api/auth/password', { method: 'POST', body: { current: cur.value, next: nxt.value } }); toast('رمز عبور تغییر کرد'); close(); } }]);
}

/* ================= settings: personal theme + workspace diagram style ================= */
const KEY_FA = { task: 'فعالیت‌ها (Task)', subProcess: 'زیرفرایند', startEvent: 'رویداد شروع', intermediateEvent: 'رویداد میانی', endEvent: 'رویداد پایان', gateway: 'دروازه‌ها (Gateway)', data: 'داده', header: 'سرتیتر' };
const FONT_FA = { auto: 'خودکار (وزیرمتن + Times)', vazirmatn: 'وزیرمتن', times: 'Times New Roman', tahoma: 'Tahoma', arial: 'Arial', georgia: 'Georgia', courier: 'Courier New' };
const THEME_PREVIEW = { light: '#ffffff', dark: '#16212c', blue: '#dbe6fb', sand: '#f3eee4', forest: '#dcebe2' };

function openSettings() {
  const ui = loadUi();
  const tabs = h('div', { class: 'tabs' }), body = h('div', {});
  const draw = (which) => {
    tabs.replaceChildren(h('button', { class: 'btn small' + (which === 'ui' ? ' on' : ''), onclick: () => draw('ui') }, 'ظاهر برنامه (فقط برای من)'),
      isDesigner() ? h('button', { class: 'btn small' + (which === 'diagram' ? ' on' : ''), onclick: () => draw('diagram') }, 'سبک نمودارها (برای همه)') : null);
    body.replaceChildren(...[which === 'ui' ? uiTab() : diagramTab()].flat(Infinity));
  };
  function uiTab() {
    const cur = loadUi();
    const accent = h('input', { type: 'color', value: cur.accent || '#0f6b8a', oninput: (e) => { const u = loadUi(); u.accent = e.target.value; saveUi(u); } });
    const scale = h('input', { type: 'range', min: 0.9, max: 1.2, step: 0.05, value: cur.scale, oninput: (e) => { const u = loadUi(); u.scale = +e.target.value; saveUi(u); } });
    return [h('label', {}, 'تم رنگی'),
      h('div', { class: 'seg' }, Object.entries(THEMES).map(([k, t]) => h('button', { class: 'themebtn' + (cur.theme === k ? ' on' : ''), onclick: () => { const u = loadUi(); u.theme = k; saveUi(u); draw('ui'); } },
        h('i', { style: `background:${THEME_PREVIEW[k]}` }), t))),
      h('label', {}, 'رنگ تأکیدی (دکمه‌ها و پیوندها)'), h('div', { class: 'seg' }, accent, h('button', { class: 'btn small', onclick: () => { const u = loadUi(); u.accent = ''; saveUi(u); draw('ui'); } }, 'پیش‌فرض تم')),
      h('label', {}, 'اندازه متن برنامه'), scale,
      h('p', { class: 'muted', style: 'margin-top:1rem;font-size:.8rem' }, 'این تنظیمات فقط در همین مرورگر ذخیره می‌شود. بوم نمودار همیشه سفید می‌ماند تا چاپ و خروجی‌ها یکسان باشند.')];
  }
  function diagramTab() {
    const st = JSON.parse(JSON.stringify(StudioBpmn.getStyle()));
    const font = h('select', {}, Object.entries(FONT_FA).map(([k, t]) => h('option', { value: k }, t)));
    font.value = st.font;
    const size = h('input', { type: 'number', min: 10, max: 20, value: st.fontSize });
    const inputs = {};
    const rows = Object.keys(KEY_FA).map((k) => {
      const f = h('input', { type: 'color', value: st.colors[k].fill }), s = h('input', { type: 'color', value: st.colors[k].stroke });
      inputs[k] = { f, s };
      return h('div', { class: 'crow' }, h('span', {}, KEY_FA[k]), h('span', { class: 'muted' }, 'پر ', f), h('span', { class: 'muted' }, 'خط ', s));
    });
    return [h('p', { class: 'muted', style: 'font-size:.82rem' }, 'رنگ‌ها و فونت برای همه‌ی کاربران و پوستر اعمال می‌شود. رنگ دستی هر عنصر (از نوار ابزار بوم) بر این پیش‌فرض‌ها غلبه می‌کند.'),
      h('div', { class: 'formgrid' }, h('div', {}, h('label', {}, 'فونت متن نمودار'), font), h('div', {}, h('label', {}, 'اندازه فونت'), size)),
      h('label', {}, 'رنگ عناصر'), rows,
      h('div', { class: 'mf', style: 'border:0;padding-bottom:0' },
        h('button', { class: 'btn', onclick: () => { const d = StudioBpmn.DEFAULT_STYLE; font.value = d.font; size.value = d.fontSize; for (const k in inputs) { inputs[k].f.value = d.colors[k].fill; inputs[k].s.value = d.colors[k].stroke; } } }, 'بازنشانی به پیش‌فرض'),
        h('button', { class: 'btn primary', onclick: async () => {
          const colors = {}; for (const k in inputs) colors[k] = { fill: inputs[k].f.value, stroke: inputs[k].s.value };
          try {
            const res = await http('/api/settings/style', { method: 'PUT', body: { font: font.value, fontSize: +size.value, colors } });
            StudioBpmn.setStyle(res); toast('سبک نمودارها ذخیره شد');
            if (S.ed && S.ed.dirty) toast('برای اعمال کامل، پس از ثبت نسخه صفحه را تازه کنید');
            else if (location.hash.startsWith('#/d/')) route();
          } catch (e) { toast(e.message, true); }
        } }, 'ذخیره سبک نمودارها'))];
  }
  draw('ui');
  modal('تنظیمات', [tabs, body], []);
}

/* ================= router ================= */
function goto(hash) { if (location.hash === hash) route(); else location.hash = hash; }
async function boot() {
  try { S.user = await http('/api/auth/me'); } catch { S.user = null; }
  route();
}
addEventListener('hashchange', route);
addEventListener('beforeunload', (e) => { if (S.ed && S.ed.dirty) { e.preventDefault(); e.returnValue = ''; } });

async function route() {
  closePopover(); teardownEditor();
  if (!S.user) return viewLogin();
  if (!S.styleLoaded) { try { StudioBpmn.setStyle(await http('/api/settings/style')); } catch { /* defaults */ } S.styleLoaded = true; }
  const m = location.hash.match(/^#\/d\/([0-9a-f-]{36})(?:\/v\/(\d+))?$/i);
  if (m) return viewEditor(m[1], m[2] ? +m[2] : null);
  if (location.hash === '#/admin' && S.user.role === 'admin') return viewAdmin();
  viewLibrary();
}
function teardownEditor() {
  if (!S.ed) return;
  document.removeEventListener('keydown', S.ed.onKey);
  document.removeEventListener('fullscreenchange', S.ed.onFs);
  try { S.ed.modeler && S.ed.modeler.destroy(); } catch {}
  try { S.ed.viewer && S.ed.viewer.destroy(); } catch {}
  S.ed = null;
}

/* ================= login ================= */
function viewLogin() {
  const u = h('input', { type: 'text', autocomplete: 'username', autofocus: true });
  const p = h('input', { type: 'password', autocomplete: 'current-password' });
  const msg = h('p', { class: 'err' });
  root.replaceChildren(h('form', {
    class: 'login', onsubmit: async (ev) => {
      ev.preventDefault(); msg.textContent = '';
      try { S.user = await http('/api/auth/login', { method: 'POST', body: { username: u.value, password: p.value } }); route(); }
      catch (e) { msg.textContent = e.message; }
    },
  }, h('h1', {}, 'استودیوی BPMN'), h('p', { class: 'muted' }, 'طراحی، نسخه‌بندی و نمایش فرایندها'),
  h('label', {}, 'نام کاربری'), u, h('label', {}, 'رمز عبور'), p, msg,
  h('p', { style: 'margin-top:1rem' }, h('button', { class: 'btn primary', type: 'submit' }, 'ورود'))));
}

/* ================= workflow form (new / edit) ================= */
function diagramForm(init = {}, withFile = false) {
  const f = {
    system: h('input', { type: 'text', maxlength: 80, list: 'sys-list', value: init.system || '', autocomplete: 'off' }),
    title: h('input', { type: 'text', maxlength: 120, value: init.title || '' }),
    actor: h('input', { type: 'text', maxlength: 80, value: init.actor || '' }),
    role: h('input', { type: 'text', maxlength: 80, value: init.role || '' }),
    description: h('textarea', { rows: 3, maxlength: 500 }, init.description || ''),
    file: h('input', { type: 'file', accept: '.bpmn,.xml,.bpm' }),
  };
  const el = h('div', {}, h('datalist', { id: 'sys-list' }, S.systems.map((s) => h('option', { value: s }))),
    h('div', { class: 'formgrid' },
      h('div', {}, h('label', {}, 'سامانه / پروژه *'), f.system), h('div', {}, h('label', {}, 'نام گردش کار *'), f.title),
      h('div', {}, h('label', {}, 'عامل'), f.actor), h('div', {}, h('label', {}, 'نقش'), f.role),
      h('div', { class: 'full' }, h('label', {}, 'توضیحات'), f.description),
      withFile ? h('div', { class: 'full' }, h('label', {}, 'ورود از فایل (اختیاری): .bpmn ، .xml یا .bpm'), f.file) : null),
    h('p', { class: 'muted', style: 'font-size:.8rem;margin-top:.8rem' }, 'تاریخ ثبت و نام ثبت‌کننده به‌صورت خودکار توسط سیستم ثبت می‌شود.'));
  return { el, f, values: () => ({ system: f.system.value, title: f.title.value, actor: f.actor.value, role: f.role.value, description: f.description.value }) };
}
function newDiagram() {
  const form = diagramForm({}, true);
  modal('گردش کار جدید', form.el, [{ label: 'ایجاد', kind: 'primary', onClick: async (close) => {
    const v = form.values();
    if (!v.system.trim() || !v.title.trim()) { toast('سامانه و نام گردش کار الزامی است', true); return false; }
    const xml = form.f.file.files[0] ? await readBpmnFile(form.f.file.files[0]) : undefined;
    const r = await http('/api/diagrams', { method: 'POST', body: { ...v, xml } });
    close(); goto('#/d/' + r.id);
  } }]);
}

/* ================= library: full searchable table ================= */
async function viewLibrary() {
  const st = { q: '', system: '', sort: 'updatedAt', dir: -1, rows: [], open: new Set() };
  const tbody = h('tbody'), count = h('span', { class: 'muted' });
  const sysSel = h('select', { onchange: (e) => { st.system = e.target.value; draw(); } }, h('option', { value: '' }, 'همه سامانه‌ها'));
  const q = h('input', { type: 'search', placeholder: 'جست‌وجو در همه‌ی ستون‌ها…', oninput: (e) => { st.q = e.target.value; draw(); } });
  const COLS = [['system', 'سامانه'], ['title', 'نام گردش کار'], ['actor', 'عامل'], ['role', 'نقش'], ['createdBy', 'ثبت‌کننده'], ['createdAt', 'تاریخ ثبت'], ['updatedAt', 'آخرین تغییر'], ['headVersion', 'نسخه']];
  const headRow = h('tr'), thead = h('thead', {}, headRow);
  function draw() {
    headRow.replaceChildren(h('th', {}, ''), ...COLS.map(([k, t]) => h('th', {}, h('button', { onclick: () => { st.dir = st.sort === k ? -st.dir : 1; st.sort = k; draw(); } }, t + (st.sort === k ? (st.dir > 0 ? ' ▲' : ' ▼') : '')))), h('th', {}, 'عملیات'));
    const needle = norm(st.q).trim();
    let rows = st.rows.filter((d) => (!st.system || d.system === st.system) &&
      (!needle || norm([d.system, d.title, d.actor, d.role, d.createdBy, d.updatedBy, d.description].join(' ')).includes(needle)));
    rows.sort((a, b) => { const x = a[st.sort] ?? '', y = b[st.sort] ?? ''; return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'fa')) * st.dir; });
    count.textContent = `${num(rows.length)} گردش کار`;
    tbody.replaceChildren(...(rows.length ? rows.flatMap((d) => {
      const open = st.open.has(d.id);
      const hbtn = h('button', { class: 'btn small icon', 'aria-label': 'تاریخچه نسخه‌ها', title: 'تاریخچه نسخه‌ها', onclick: async (e) => {
        const btn = e.currentTarget; const pop = popover(btn, h('div', { class: 'empty' }, 'در حال بارگذاری…'));
        try { const versions = await http(`/api/diagrams/${d.id}/versions`); pop.replaceChildren(versionList(d.id, versions, { head: d.headVersion, shown: -1, editor: false })); }
        catch (err) { pop.replaceChildren(h('div', { class: 'empty err' }, err.message)); }
      } }, '☰');
      const tr = h('tr', { class: 'r' },
        h('td', {}, h('button', { class: 'btn small icon', 'aria-expanded': String(open), 'aria-label': 'جزئیات', onclick: () => { open ? st.open.delete(d.id) : st.open.add(d.id); draw(); } }, open ? '▾' : '◂')),
        h('td', {}, h('span', { class: 'sysbadge' }, d.system || '—')), h('td', {}, h('b', {}, d.title)), h('td', {}, d.actor || '—'), h('td', {}, d.role || '—'),
        h('td', {}, d.createdBy), h('td', {}, faDate(d.createdAt)), h('td', {}, fa(d.updatedAt)), h('td', {}, h('span', { class: 'vbadge ltr' }, 'v' + d.headVersion)),
        h('td', {}, h('span', { class: 'seg' }, hbtn, h('a', { class: 'btn small primary', href: '#/d/' + d.id }, 'باز کردن'))));
      const out = [tr];
      if (open) out.push(h('tr', { class: 'detail' }, h('td', { colspan: 10 },
        h('div', { class: 'dgrid' }, [['سامانه', d.system], ['عامل', d.actor], ['نقش', d.role], ['ثبت‌کننده', d.createdBy], ['تاریخ ثبت', fa(d.createdAt)], ['آخرین ویرایشگر', `${d.updatedBy} · ${fa(d.updatedAt)}`]]
          .map(([k, v]) => h('div', { class: 'kv' }, h('small', {}, k), v || '—'))),
        h('p', { class: 'muted', style: 'margin:.4rem 0' }, d.description || 'بدون توضیحات'),
        h('div', { class: 'seg' }, h('a', { class: 'btn small primary', href: '#/d/' + d.id }, 'باز کردن در بوم'),
          h('a', { class: 'btn small', href: `/poster.html?d=${d.id}`, target: '_blank', rel: 'noopener' }, 'پوستر')))));
      return out;
    }) : [h('tr', {}, h('td', { colspan: 10, class: 'empty' }, 'گردش کاری یافت نشد. ' + (isDesigner() ? 'با «گردش کار جدید» شروع کنید.' : '')))]));
  }
  shell([h('div', { class: 'toolbar' }, q, sysSel, count, isDesigner() ? h('button', { class: 'btn primary', onclick: async () => { await refreshSystems(); newDiagram(); } }, '＋ گردش کار جدید') : null),
    h('div', { class: 'tablewrap' }, h('table', {}, thead, tbody))]);
  try {
    st.rows = await http('/api/diagrams');
    S.systems = [...new Set(st.rows.map((r) => r.system).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fa'));
    sysSel.append(...S.systems.map((s) => h('option', { value: s }, s)));
    draw();
  } catch (e) { tbody.replaceChildren(h('tr', {}, h('td', { colspan: 10, class: 'empty err' }, e.message))); }
}
async function refreshSystems() {
  try { const rows = await http('/api/diagrams'); S.systems = [...new Set(rows.map((r) => r.system).filter(Boolean))]; } catch { /* keep old */ }
}

/* ================= version list (shared by table popover and editor popover) ================= */
function chipsFor(v) {
  return h('div', { class: 'chips' },
    v.added ? h('span', { class: 'chip added' }, '+' + num(v.added)) : null, v.removed ? h('span', { class: 'chip removed' }, '−' + num(v.removed)) : null,
    v.changed ? h('span', { class: 'chip changed' }, '~' + num(v.changed)) : null, v.moved ? h('span', { class: 'chip moved' }, '↔' + num(v.moved)) : null,
    v.tags.map((t) => h('span', { class: 'chip tag' }, '🏷 ' + t)));
}
function versionList(id, versions, ctx) {
  const nums = versions.map((v) => v.number);
  const from = h('select', {}, nums.map((n) => h('option', { value: n }, 'v' + n)));
  const to = h('select', {}, nums.map((n) => h('option', { value: n }, 'v' + n)));
  if (nums.length > 1) { from.value = nums[1]; to.value = nums[0]; }
  return h('div', {},
    h('h3', {}, `نسخه‌ها (${num(versions.length)})`),
    versions.length > 1 ? h('div', { class: 'cmp' }, 'مقایسه', from, 'با', to, h('button', { class: 'btn small', onclick: () => { closePopover(); openDiff(id, +from.value, +to.value); } }, 'نمایش تغییرات')) : null,
    h('ul', { class: 'tl' }, versions.map((v) => h('li', { class: (v.number === ctx.head ? 'head ' : '') + (v.number === ctx.shown ? 'cur' : '') },
      h('div', {}, h('span', { class: 'vn ltr' }, 'v' + v.number), v.number === ctx.head ? ' (آخرین)' : '', v.number === ctx.shown ? ' · در حال نمایش' : ''),
      h('div', {}, v.message), chipsFor(v),
      h('div', { class: 'meta' }, `${v.author} · ${fa(v.createdAt)} · `, h('span', { class: 'ltr' }, v.hash)),
      h('div', { class: 'acts' },
        v.number !== ctx.shown ? h('a', { class: 'btn small primary', href: `#/d/${id}/v/${v.number}`, onclick: () => closePopover() }, 'باز کردن') : null,
        v.number > 1 ? h('button', { class: 'btn small', onclick: () => { closePopover(); openDiff(id, v.number - 1, v.number); } }, 'تغییرات') : null,
        h('a', { class: 'btn small', href: `/poster.html?d=${id}&v=${v.number}`, target: '_blank', rel: 'noopener' }, 'پوستر'),
        ctx.editor && isDesigner() ? h('button', { class: 'btn small', onclick: () => { closePopover(); tagDlg(id, v.number); } }, 'برچسب') : null,
        ctx.editor && isDesigner() && v.number !== ctx.head ? h('button', { class: 'btn small', onclick: () => { closePopover(); restore(id, v.number, ctx.head); } }, 'بازگردانی') : null)))));
}

function changeList(items, onPick) {
  if (!items.length) return h('p', { class: 'muted' }, 'تغییری نسبت به آخرین نسخه وجود ندارد.');
  const order = { added: 0, changed: 1, moved: 2, removed: 3 };
  return h('ul', { class: 'changes' }, [...items].sort((a, b) => order[a.kind] - order[b.kind]).map((i) => h('li', { 'data-id': i.id, onclick: () => onPick && onPick(i) },
    h('span', { class: 'tagk ' + i.kind }, KIND_FA[i.kind]), h('span', {}, typeFa(i.type) + (i.name ? ` «${i.name}»` : '')),
    i.details && i.details.length ? h('span', { class: 'muted' }, i.details.map((d) => `${fieldFa(d.field)}: ${d.from ?? '∅'} ← ${d.to ?? '∅'}`).join(' ، ')) : null)));
}
const summaryChips = (items) => h('div', { class: 'summary' }, ['added', 'removed', 'changed', 'moved'].map((k) => {
  const n = items.filter((i) => i.kind === k).length;
  return n ? h('span', { class: 'chip ' + k }, `${KIND_FA[k]}: ${num(n)}`) : null;
}));

/* ================= editor ================= */
const A = (type, opts) => ({ type, opts: opts || {} });
const EVT = (d) => ({ eventDefinitionType: 'bpmn:' + d + 'EventDefinition' });
const TRAY = [
  ['رویدادها (Events)', [
    ['شروع', 'bpmn-icon-start-event-none', A('bpmn:StartEvent')], ['شروع پیام', 'bpmn-icon-start-event-message', A('bpmn:StartEvent', EVT('Message'))], ['شروع تایمر', 'bpmn-icon-start-event-timer', A('bpmn:StartEvent', EVT('Timer'))],
    ['میانی', 'bpmn-icon-intermediate-event-none', A('bpmn:IntermediateThrowEvent')], ['میانی تایمر', 'bpmn-icon-intermediate-event-catch-timer', A('bpmn:IntermediateCatchEvent', EVT('Timer'))], ['دریافت پیام', 'bpmn-icon-intermediate-event-catch-message', A('bpmn:IntermediateCatchEvent', EVT('Message'))],
    ['ارسال پیام', 'bpmn-icon-intermediate-event-throw-message', A('bpmn:IntermediateThrowEvent', EVT('Message'))], ['سیگنال', 'bpmn-icon-intermediate-event-catch-signal', A('bpmn:IntermediateCatchEvent', EVT('Signal'))],
    ['پایان', 'bpmn-icon-end-event-none', A('bpmn:EndEvent')], ['پایان پیام', 'bpmn-icon-end-event-message', A('bpmn:EndEvent', EVT('Message'))], ['پایان خطا', 'bpmn-icon-end-event-error', A('bpmn:EndEvent', EVT('Error'))], ['پایان نهایی', 'bpmn-icon-end-event-terminate', A('bpmn:EndEvent', EVT('Terminate'))]]],
  ['فعالیت‌ها (Tasks)', [
    ['فعالیت', 'bpmn-icon-task', A('bpmn:Task')], ['وظیفه کاربر', 'bpmn-icon-user-task', A('bpmn:UserTask')], ['وظیفه سرویس', 'bpmn-icon-service-task', A('bpmn:ServiceTask')],
    ['وظیفه دستی', 'bpmn-icon-manual-task', A('bpmn:ManualTask')], ['اسکریپت', 'bpmn-icon-script-task', A('bpmn:ScriptTask')], ['قانون کسب‌وکار', 'bpmn-icon-business-rule-task', A('bpmn:BusinessRuleTask')],
    ['ارسال', 'bpmn-icon-send-task', A('bpmn:SendTask')], ['دریافت', 'bpmn-icon-receive-task', A('bpmn:ReceiveTask')], ['فراخوانی فرایند', 'bpmn-icon-call-activity', A('bpmn:CallActivity')]]],
  ['زیرفرایند (Sub-process)', [
    ['جمع‌شده (+)', 'bpmn-icon-subprocess-collapsed', A('bpmn:SubProcess', { isExpanded: false })], ['باز', 'bpmn-icon-subprocess-expanded', A('bpmn:SubProcess', { isExpanded: true })],
    ['تراکنش', 'bpmn-icon-transaction', A('bpmn:Transaction', { isExpanded: true })], ['رویدادی', 'bpmn-icon-event-subprocess-expanded', A('bpmn:SubProcess', { triggeredByEvent: true, isExpanded: true })]]],
  ['دروازه‌ها (Gateways)', [
    ['انحصاری XOR', 'bpmn-icon-gateway-xor', A('bpmn:ExclusiveGateway')], ['موازی AND', 'bpmn-icon-gateway-parallel', A('bpmn:ParallelGateway')], ['فراگیر OR', 'bpmn-icon-gateway-or', A('bpmn:InclusiveGateway')],
    ['مبتنی بر رویداد', 'bpmn-icon-gateway-eventbased', A('bpmn:EventBasedGateway')], ['پیچیده', 'bpmn-icon-gateway-complex', A('bpmn:ComplexGateway')]]],
  ['داده، یادداشت و استخر', [
    ['شیء داده', 'bpmn-icon-data-object', A('bpmn:DataObjectReference')], ['مخزن داده', 'bpmn-icon-data-store', A('bpmn:DataStoreReference')], ['یادداشت', 'bpmn-icon-text-annotation', A('bpmn:TextAnnotation')],
    ['گروه', 'bpmn-icon-group', A('bpmn:Group')], ['استخر (Pool)', 'bpmn-icon-participant', A('bpmn:Participant')]]],
];
const SWATCHES = [['آبی', '#dbeafe', '#1d4ed8'], ['سبز', '#dcfce7', '#15803d'], ['زرد', '#fef9c3', '#ca8a04'], ['قرمز', '#fee2e2', '#b91c1c'], ['بنفش', '#ede9fe', '#6d28d9'], ['خاکستری', '#e5e7eb', '#374151']];

function setGrid(inst, on) {
  const layer = inst.get('canvas').getLayer('studio-grid', -1);
  layer.replaceChildren();
  if (!on) return;
  const pat = (id, size, color, w) => sv('pattern', { id, width: size, height: size, patternUnits: 'userSpaceOnUse' }, sv('path', { d: `M${size} 0H0V${size}`, fill: 'none', stroke: color, 'stroke-width': w }));
  const cs = getComputedStyle(document.documentElement);
  layer.append(sv('defs', {}, pat('sg-minor', 10, cs.getPropertyValue('--grid-minor').trim() || '#e3e9f0', 0.6), pat('sg-major', 100, cs.getPropertyValue('--grid-major').trim() || '#c9d3de', 1)),
    sv('rect', { x: -20000, y: -20000, width: 60000, height: 60000, fill: 'url(#sg-minor)', 'pointer-events': 'none' }),
    sv('rect', { x: -20000, y: -20000, width: 60000, height: 60000, fill: 'url(#sg-major)', 'pointer-events': 'none' }));
}
function setSnap(inst, on) {
  const gs = inst.get('gridSnapping', false);
  if (!gs) return false;
  try { if (typeof gs.toggleActive === 'function') gs.toggleActive(on); else if (typeof gs.setActive === 'function') gs.setActive(on); else return false; return true; }
  catch { return false; }
}

/* align / distribute implemented here (only needs modeling.moveElements) so it does not depend on optional bpmn-js modules */
function pickShapes(inst) {
  const sel = inst.get('selection').get().filter((e) => !e.waypoints && !e.labelTarget && e.type !== 'label' && e.width);
  const set = new Set(sel);
  return sel.filter((e) => !(e.parent && set.has(e.parent)));      // a moved container already carries its children
}
function alignManual(inst, type) {
  const els = pickShapes(inst); if (els.length < 2) return false;
  const modeling = inst.get('modeling');
  const minL = Math.min(...els.map((e) => e.x)), maxR = Math.max(...els.map((e) => e.x + e.width));
  const minT = Math.min(...els.map((e) => e.y)), maxB = Math.max(...els.map((e) => e.y + e.height));
  const moves = els.map((e) => {
    let dx = 0, dy = 0;
    if (type === 'left') dx = minL - e.x;
    if (type === 'right') dx = maxR - (e.x + e.width);
    if (type === 'center') dx = (minL + maxR) / 2 - (e.x + e.width / 2);
    if (type === 'top') dy = minT - e.y;
    if (type === 'bottom') dy = maxB - (e.y + e.height);
    if (type === 'middle') dy = (minT + maxB) / 2 - (e.y + e.height / 2);
    return [e, Math.round(dx), Math.round(dy)];
  });
  for (const [e, dx, dy] of moves) if (dx || dy) modeling.moveElements([e], { x: dx, y: dy });
  return true;
}
function distributeManual(inst, axis) {
  const els = pickShapes(inst); if (els.length < 3) return false;
  const modeling = inst.get('modeling'), h_ = axis === 'horizontal';
  const pos = (e) => (h_ ? e.x : e.y), size = (e) => (h_ ? e.width : e.height);
  const sorted = [...els].sort((a, b) => pos(a) - pos(b));
  const first = sorted[0], last = sorted[sorted.length - 1];
  const span = pos(last) + size(last) - pos(first), total = sorted.reduce((t, e) => t + size(e), 0);
  const gap = (span - total) / (sorted.length - 1);
  let cursor = pos(first) + size(first) + gap;
  const moves = [];
  for (let i = 1; i < sorted.length - 1; i++) { moves.push([sorted[i], Math.round(cursor - pos(sorted[i]))]); cursor += size(sorted[i]) + gap; }
  for (const [e, d] of moves) if (d) modeling.moveElements([e], h_ ? { x: d, y: 0 } : { x: 0, y: d });
  return true;
}

async function fileToImage(file) {
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) throw new Error('فقط تصویر PNG، JPEG، GIF یا WebP پذیرفته می‌شود');
  if (file.size > 6e6) throw new Error('حجم تصویر بیش از ۶ مگابایت است');
  const url = URL.createObjectURL(file), img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('تصویر خوانده نشد')); img.src = url; });
  const k = Math.min(1, 900 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
  const src = file.type === 'image/jpeg' ? c.toDataURL('image/jpeg', 0.85) : c.toDataURL('image/png');
  const w = Math.min(360, c.width), hh = Math.min(300, Math.round(w * c.height / c.width));
  return { src, w, h: hh };
}

async function viewEditor(id, vNum) {
  shell(h('p', { class: 'empty' }, 'در حال بارگذاری…'), true);
  const ed = S.ed = { id, dirty: false, modeler: null, viewer: null, grid: true, snap: true };
  try { [ed.d, ed.versions] = await Promise.all([http('/api/diagrams/' + id), http(`/api/diagrams/${id}/versions`)]); }
  catch (e) { return shell(h('p', { class: 'empty err' }, e.message)); }
  const head = ed.d.headVersion;
  ed.shown = vNum && vNum !== head ? vNum : head;
  ed.readOnly = !isDesigner() || ed.shown !== head;
  let ver;
  try { ver = await http(`/api/diagrams/${id}/versions/${ed.shown}`); } catch (e) { return shell(h('p', { class: 'empty err' }, e.message)); }

  const dirtyEl = h('span', { class: 'chip changed', hidden: true }, '● ذخیره‌نشده');
  const titleEl = h('b', {}, ed.d.title), metaEl = h('small', {});
  const setMeta = () => { titleEl.textContent = ed.d.title; metaEl.textContent = [ed.d.system, ed.d.actor && 'عامل: ' + ed.d.actor, ed.d.role && 'نقش: ' + ed.d.role].filter(Boolean).join(' · '); };
  setMeta();
  const mod = h('div', { class: 'cv', dir: 'ltr' }), vw = h('div', { class: 'cv', dir: 'ltr' });
  const fileIn = h('input', { type: 'file', accept: '.bpmn,.xml,.bpm', hidden: true });
  const imgIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', hidden: true });
  const cur = () => (ed.readOnly ? ed.viewer : ed.modeler);

  const exportSel = h('select', { 'aria-label': 'خروجی', style: 'width:auto', onchange: async (e) => {
    const k = e.target.value; e.target.value = ''; if (!k) return;
    const base = `${ed.d.title}-v${ed.shown}`;
    try {
      if (k === 'bpmn') download((await cur().saveXML({ format: true })).xml, base + '.bpmn', 'application/xml');
      if (k === 'xml') download((await cur().saveXML({ format: true })).xml, base + '.xml', 'application/xml');
      if (k === 'svg') download(await withFonts((await cur().saveSVG()).svg), base + '.svg', 'image/svg+xml');
      if (k === 'png') download(await svgToPng((await cur().saveSVG()).svg), base + '.png');
      if (k === 'pdf') window.open(`/poster.html?d=${id}&v=${ed.shown}#print`, '_blank', 'noopener');
    } catch (err) { toast(err.message, true); }
  } }, h('option', { value: '' }, 'خروجی…'), h('option', { value: 'bpmn' }, 'BPMN 2.0 (‎.bpmn‎) — مناسب Bizagi'), h('option', { value: 'xml' }, 'XML (‎.xml‎)'),
  h('option', { value: 'svg' }, 'تصویر SVG'), h('option', { value: 'png' }, 'تصویر PNG'), h('option', { value: 'pdf' }, 'پوستر / PDF'));

  const histBtn = h('button', { class: 'btn icon', title: 'تاریخچه نسخه‌ها', 'aria-label': 'تاریخچه نسخه‌ها', onclick: async (e) => {
    const pop = popover(e.currentTarget, h('div', { class: 'empty' }, 'در حال بارگذاری…'));
    try { ed.versions = await http(`/api/diagrams/${id}/versions`); pop.replaceChildren(versionList(id, ed.versions, { head: ed.d.headVersion, shown: ed.shown, editor: true })); }
    catch (err) { pop.replaceChildren(h('div', { class: 'empty err' }, err.message)); }
  } }, '☰');
  const fsBtn = h('button', { class: 'btn', onclick: () => (document.fullscreenElement ? document.exitFullscreen() : editorEl.requestFullscreen?.()) }, '⛶ تمام‌صفحه');

  const bar = h('div', { class: 'ebar' },
    h('a', { class: 'btn small', href: '#/' }, '→ گردش‌کارها'), histBtn,
    h('div', { class: 'ttl' }, titleEl, metaEl), h('span', { class: 'vbadge ltr' }, 'v' + ed.shown), dirtyEl,
    isDesigner() ? h('button', { class: 'btn small icon', title: 'ویرایش مشخصات', onclick: editMeta }, '✎') : null,
    h('span', { class: 'grp' },
      !ed.readOnly ? h('button', { class: 'btn primary', onclick: saveFlow }, 'ثبت نسخه جدید') : null,
      !ed.readOnly ? h('button', { class: 'btn', onclick: () => fileIn.click(), title: 'ورود از BPMN / XML / BPM' }, 'ورود فایل') : null,
      exportSel),
    h('span', { class: 'grp' }, h('a', { class: 'btn', href: `/poster.html?d=${id}&v=${ed.shown}`, target: '_blank', rel: 'noopener' }, 'پوستر'),
      isDesigner() ? h('button', { class: 'btn', onclick: shareDlg }, 'اشتراک‌گذاری') : null, fsBtn));

  const banner = h('div', { class: 'banner', hidden: ed.shown === head },
    h('span', {}, `نسخه v${ed.shown} (فقط‌خواندنی) — آخرین نسخه v${head} است.`), h('a', { class: 'btn small', href: '#/d/' + id }, 'بازگشت به آخرین نسخه'),
    isDesigner() ? h('button', { class: 'btn small primary', onclick: () => restore(id, ed.shown, head) }, 'بازگردانی این نسخه') : null);

  const stage = h('div', { class: 'stage' }, mod, vw);
  const tools = h('div', { class: 'tools' });
  const editorEl = h('div', { class: 'editor' }, bar, tools, banner, stage);
  shell(editorEl, true);
  ed.onFs = () => { fsBtn.textContent = document.fullscreenElement ? '✕ خروج از تمام‌صفحه' : '⛶ تمام‌صفحه'; };
  document.addEventListener('fullscreenchange', ed.onFs);

  try {
    if (ed.readOnly) {
      mod.hidden = true; tools.hidden = true;
      ed.viewer = new BpmnViewer({ container: vw, ...StudioBpmn.options('viewer') });
      await ed.viewer.importXML(ver.xml); ed.viewer.get('canvas').zoom('fit-viewport', 'center');
    } else {
      vw.hidden = true;
      ed.modeler = new BpmnJS({ container: mod, keyboard: { bindTo: document }, ...StudioBpmn.options('modeler') });
      await ed.modeler.importXML(ver.xml);
      ed.modeler.get('canvas').zoom('fit-viewport', 'center');
      setGrid(ed.modeler, ed.grid); if (!setSnap(ed.modeler, ed.snap)) ed.snap = false;
      ed.modeler.on('commandStack.changed', () => { ed.dirty = true; dirtyEl.hidden = false; });
      buildTools(); buildTray();
      ed.onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveFlow(); } };
      document.addEventListener('keydown', ed.onKey);
    }
  } catch (e) { stage.replaceChildren(h('p', { class: 'empty err' }, 'نمایش نمودار ممکن نشد: ' + e.message)); return; }

  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0]; fileIn.value = ''; if (!f) return;
    try {
      const xml = await readBpmnFile(f);
      await ed.modeler.importXML(xml); ed.modeler.get('canvas').zoom('fit-viewport', 'center'); setGrid(ed.modeler, ed.grid);
      ed.dirty = true; dirtyEl.hidden = false;
      toast('فایل وارد شد. پس از بررسی، «ثبت نسخه جدید» را بزنید تا تغییرات (نسبت به نسخه قبل) ثبت شود');
    } catch (e) { toast(e.message, true); }
  });
  imgIn.addEventListener('change', async () => {
    const f = imgIn.files[0]; imgIn.value = ''; if (!f) return;
    try {
      const im = await fileToImage(f), inst = ed.modeler;
      const ef = inst.get('elementFactory'), bf = inst.get('bpmnFactory'), canvas = inst.get('canvas'), vb = canvas.viewbox();
      const shape = ef.createShape({ type: 'bpmn:TextAnnotation', width: im.w, height: im.h });
      attachExt(bf, shape.businessObject, 'studio:Image', { src: im.src });
      inst.get('modeling').createShape(shape, { x: Math.round(vb.x + vb.width / 2), y: Math.round(vb.y + vb.height / 2) }, canvas.getRootElement());
    } catch (e) { toast(e.message, true); }
  });
  editorEl.append(fileIn, imgIn);

  function attachExt(bf, bo, type, attrs) {
    const ext = bf.create(type, attrs), wrap = bf.create('bpmn:ExtensionElements', { values: [ext] });
    ext.$parent = wrap; wrap.$parent = bo; bo.extensionElements = wrap;
  }

  /* ---- tool strip: grid, align, zoom, colours ---- */
  function buildTools() {
    const inst = ed.modeler, sel = () => inst.get('selection').get();
    const btn = (label, title, fn, cls = '') => h('button', { class: 'btn small ' + cls, title, onclick: fn }, label);
    const gridBtn = btn('شبکه', 'نمایش شبکه', () => { ed.grid = !ed.grid; gridBtn.classList.toggle('on', ed.grid); setGrid(inst, ed.grid); }, ed.grid ? 'on' : '');
    const snapBtn = inst.get('gridSnapping', false)
      ? btn('چسبیدن به شبکه', 'عناصر به خانه‌های شبکه می‌چسبند', () => { ed.snap = !ed.snap; snapBtn.classList.toggle('on', ed.snap); setSnap(inst, ed.snap); }, ed.snap ? 'on' : '') : null;
    const align = (t, label, title) => btn(label, title, () => { if (!alignManual(inst, t)) toast('حداقل دو عنصر را انتخاب کنید (Shift + کلیک یا کشیدن کادر)', true); });
    const dist = (a, label, title) => btn(label, title, () => { if (!distributeManual(inst, a)) toast('برای توزیع، حداقل سه عنصر لازم است', true); });
    const zoom = (f) => () => { const c = inst.get('canvas'); c.zoom(f === 0 ? 'fit-viewport' : f === 1 ? 1 : c.zoom() * f, f === 0 ? 'center' : undefined); };
    const canColor = typeof inst.get('modeling').setColor === 'function';
    const color = (fill, stroke) => { const s = sel(); if (!s.length) return toast('ابتدا یک یا چند عنصر را انتخاب کنید', true); inst.get('modeling').setColor(s, { fill, stroke }); };
    tools.replaceChildren(
      h('span', { class: 'grp' }, gridBtn, snapBtn),
      h('span', { class: 'grp' }, h('span', { class: 'lbl' }, 'تراز'), align('left', 'چپ', 'تراز چپ'), align('center', 'وسط', 'تراز افقی وسط'), align('right', 'راست', 'تراز راست'),
        align('top', 'بالا', 'تراز بالا'), align('middle', 'میانه', 'تراز عمودی میانه'), align('bottom', 'پایین', 'تراز پایین'), dist('horizontal', 'توزیع افقی', 'فاصله‌ی افقی یکسان'), dist('vertical', 'توزیع عمودی', 'فاصله‌ی عمودی یکسان')),
      h('span', { class: 'grp' }, btn('↶', 'بازگردانی (Ctrl+Z)', () => inst.get('commandStack').undo(), 'icon'), btn('↷', 'تکرار (Ctrl+Y)', () => inst.get('commandStack').redo(), 'icon')),
      h('span', { class: 'grp' }, btn('−', 'کوچک‌نمایی', zoom(0.8), 'icon'), btn('جا دادن', 'نمایش کل نمودار', zoom(0)), btn('+', 'بزرگ‌نمایی', zoom(1.25), 'icon'), btn('۱۰۰٪', 'اندازه واقعی', zoom(1))),
      !canColor ? null : h('span', { class: 'grp' }, h('span', { class: 'lbl' }, 'رنگ عنصر انتخابی'),
        h('button', { class: 'sw reset', title: 'بازگشت به رنگ پیش‌فرض نوع عنصر', 'aria-label': 'رنگ پیش‌فرض', onclick: () => color(undefined, undefined) }),
        SWATCHES.map(([n, f, s]) => h('button', { class: 'sw', title: n, 'aria-label': n, style: `background:${f};border-color:${s}`, onclick: () => color(f, s) }))));
  }

  /* ---- collapsible toolbox ---- */
  function buildTray() {
    const inst = ed.modeler, create = inst.get('create'), ef = inst.get('elementFactory'), bf = inst.get('bpmnFactory');
    const start = (ev, a) => { closePopover(); create.start(ev, a.type === 'bpmn:Participant' ? ef.createParticipantShape(true) : ef.createShape({ type: a.type, ...a.opts })); };
    const startHeader = (ev) => {
      const shape = ef.createShape({ type: 'bpmn:TextAnnotation', width: 620, height: 64 });
      shape.businessObject.text = ed.d.title; attachExt(bf, shape.businessObject, 'studio:Header', {}); create.start(ev, shape);
    };
    const item = (label, icon, fn) => h('button', { class: 'item', title: label, onclick: fn }, h('i', { class: icon }), label);
    const groups = TRAY.map(([title, items], i) => h('details', { open: i === 1 }, h('summary', {}, title),
      h('div', { class: 'items' }, items.map(([label, icon, a]) => item(label, icon, (ev) => start(ev, a))))));
    groups.push(h('details', {}, h('summary', {}, 'سرتیتر و تصویر'), h('div', { class: 'items' },
      item('سرتیتر', 'bpmn-icon-text-annotation', startHeader), item('تصویر', 'bpmn-icon-data-object', () => imgIn.click())),
    h('p', { class: 'hint' }, 'سرتیتر و تصویر داخل فایل BPMN ذخیره می‌شوند و در نسخه‌ها و پوستر دیده می‌شوند.')));
    const panel = h('div', { class: 'panel', hidden: true }, groups, h('p', { class: 'hint' }, 'روی یک مورد کلیک کنید، سپس در بوم کلیک کنید تا قرار گیرد.'));
    const tab = h('button', { class: 'tab', onclick: () => { panel.hidden = !panel.hidden; tab.textContent = panel.hidden ? 'جعبه‌ابزار ◂' : 'بستن ▸'; } }, 'جعبه‌ابزار ◂');
    stage.append(h('div', { class: 'tray' }, tab, panel));
  }

  async function editMeta() {
    await refreshSystems();
    const form = diagramForm(ed.d);
    modal('ویرایش مشخصات گردش کار', form.el, [{ label: 'ذخیره', kind: 'primary', onClick: async (close) => {
      const v = form.values();
      if (!v.system.trim() || !v.title.trim()) { toast('سامانه و نام گردش کار الزامی است', true); return false; }
      ed.d = await http('/api/diagrams/' + id, { method: 'PATCH', body: v }); setMeta(); close();
    } }]);
  }

  async function saveFlow() {
    if (ed.readOnly) return;
    const { xml } = await ed.modeler.saveXML({ format: true });
    let prev;
    try { prev = await http(`/api/diagrams/${id}/preview`, { method: 'POST', body: { xml } }); } catch (e) { return toast(e.message, true); }
    if (!prev.items.length) return toast('تغییری نسبت به آخرین نسخه وجود ندارد');
    const msg = h('input', { type: 'text', maxlength: 200, placeholder: 'مثلاً: افزودن مسیر رد درخواست', autofocus: true });
    modal('ثبت نسخه جدید', [h('p', {}, 'این نسخه پس از ', h('b', { class: 'ltr' }, 'v' + prev.headVersion), ' ثبت می‌شود. تغییرات شما:'),
      summaryChips(prev.items), changeList(prev.items), h('label', {}, 'پیام نسخه (توضیح کوتاه تغییرات)'), msg],
    [{ label: 'ثبت نسخه', kind: 'primary', onClick: async (close) => {
      if (!msg.value.trim()) { toast('پیام نسخه را بنویسید', true); return false; }
      try {
        const r = await http(`/api/diagrams/${id}/versions`, { method: 'POST', body: { xml, message: msg.value, baseVersion: prev.headVersion } });
        ed.dirty = false; close(); toast(r.unchanged ? 'تغییری نسبت به آخرین نسخه نبود' : `نسخه v${r.version} ثبت شد`); goto('#/d/' + id);
      } catch (e) {
        if (e.status === 409 && e.data && e.data.headVersion) {
          close();
          modal('تداخل با نسخه جدیدتر', [h('p', { class: 'err' }, e.message), h('p', {}, 'نسخه خودتان را به‌صورت فایل نگه دارید، سپس صفحه را دوباره بارگذاری کنید.')],
            [{ label: 'دانلود نسخه من', onClick: () => { download(xml, ed.d.title + '-my-changes.bpmn', 'application/xml'); return false; } }]);
          return;
        }
        throw e;
      }
    } }]);
  }

  async function shareDlg() {
    const sel = h('select', {}, ed.versions.map((v) => h('option', { value: v.number }, `v${v.number} — ${v.message}`)));
    sel.value = ed.shown; const out = h('div', {});
    async function loadList() {
      const rows = await http(`/api/diagrams/${id}/shares`);
      out.replaceChildren(...rows.map((s) => {
        const url = `${location.origin}/poster.html?t=${s.token}`;
        const embed = `<iframe src="${url}&embed=1" style="width:100%;height:600px;border:0" loading="lazy"></iframe>`;
        return h('div', { class: 'kv', style: 'margin:.5rem 0' }, h('div', {}, `نسخه v${s.versionNumber}`, s.revoked ? ' (لغو شده)' : ''),
          s.revoked ? null : [h('input', { type: 'text', readonly: true, value: url, onfocus: (e) => e.target.select() }),
            h('small', { class: 'muted' }, 'کد تعبیه در سایت (نیازمند EMBED_ORIGINS روی سرور):'), h('textarea', { rows: 2, readonly: true, onfocus: (e) => e.target.select() }, embed),
            h('button', { class: 'btn small danger', onclick: async () => { await http(`/api/shares/${s.id}/revoke`, { method: 'POST' }); loadList(); } }, 'لغو پیوند')],
          h('div', { class: 'muted', style: 'font-size:.78rem' }, `${s.createdBy} · ${fa(s.createdAt)}`));
      }));
    }
    modal('اشتراک‌گذاری پوستر (فقط‌خواندنی)', [h('p', { class: 'muted' }, 'هر کس پیوند را داشته باشد بدون ورود همین نسخه را می‌بیند. هر زمان بخواهید لغو کنید.'), h('label', {}, 'نسخه'), sel, out],
      [{ label: 'ساخت پیوند جدید', kind: 'primary', onClick: async () => { await http(`/api/diagrams/${id}/shares`, { method: 'POST', body: { version: +sel.value } }); await loadList(); return false; } }]);
    loadList();
  }
}

/* ---- shared actions that don't need the editor instance ---- */
async function restore(id, n, head) {
  modal('بازگردانی نسخه', [h('p', {}, `نسخه v${n} به‌عنوان یک نسخه جدید روی آخرین نسخه ثبت می‌شود. هیچ نسخه‌ای پاک نمی‌شود.`)],
    [{ label: 'بازگردانی', kind: 'primary', onClick: async (close) => {
      const r = await http(`/api/diagrams/${id}/versions/${n}/restore`, { method: 'POST', body: { baseVersion: head } });
      close(); toast(r.unchanged ? 'این نسخه همان آخرین نسخه است' : `نسخه v${r.version} ثبت شد`); if (S.ed) S.ed.dirty = false; goto('#/d/' + id);
    } }]);
}
function tagDlg(id, n) {
  const t = h('input', { type: 'text', maxlength: 40, placeholder: 'مثلاً: تأیید-نهایی' });
  modal(`برچسب‌گذاری نسخه v${n}`, [h('label', {}, 'نام برچسب'), t], [{ label: 'افزودن', kind: 'primary', onClick: async (close) => {
    await http(`/api/diagrams/${id}/tags`, { method: 'POST', body: { name: t.value, version: n } }); close(); toast('برچسب افزوده شد');
  } }]);
}

async function openDiff(id, from, to) {
  if (from === to) return toast('دو نسخه متفاوت انتخاب کنید', true);
  let r;
  try { r = await http(`/api/diagrams/${id}/diff?from=${from}&to=${to}`); } catch (e) { return toast(e.message, true); }
  const oldCv = h('div', { class: 'cv2' }), newCv = h('div', { class: 'cv2' });
  let vOld, vNew;
  const list = changeList(r.items, (i) => { for (const v of [vOld, vNew]) { try { const el = v.get('elementRegistry').get(i.id); if (el) v.get('canvas').scrollToElement(el); } catch {} } });
  const m = modal(`تغییرات v${from} ← v${to}`, [summaryChips(r.items), list,
    h('div', { class: 'panes' }, h('div', { class: 'pane' }, h('h4', {}, `قبل (v${from}) — قرمز: حذف‌شده`), oldCv),
      h('div', { class: 'pane' }, h('h4', {}, `بعد (v${to}) — سبز: افزوده · نارنجی: تغییر · آبی خط‌چین: جابه‌جا`), newCv))], [], true);
  vOld = new BpmnViewer({ container: oldCv, ...StudioBpmn.options('viewer') }); vNew = new BpmnViewer({ container: newCv, ...StudioBpmn.options('viewer') });
  const stop = () => { try { vOld.destroy(); vNew.destroy(); } catch {} };
  m.el.addEventListener('close', stop); m.el.addEventListener('cancel', stop);
  await Promise.all([vOld.importXML(r.fromXml), vNew.importXML(r.toXml)]);
  const mark = (v, kinds) => { const cv = v.get('canvas'), reg = v.get('elementRegistry'); for (const i of r.items) if (kinds.includes(i.kind) && reg.get(i.id)) cv.addMarker(i.id, 'diff-' + i.kind); cv.zoom('fit-viewport', 'center'); };
  mark(vOld, ['removed', 'changed', 'moved']); mark(vNew, ['added', 'changed', 'moved']);
  let busy = false;
  const sync = (a, b) => a.on('canvas.viewbox.changed', () => { if (busy) return; busy = true; b.get('canvas').viewbox(a.get('canvas').viewbox()); busy = false; });
  sync(vOld, vNew); sync(vNew, vOld);
}

/* ================= admin ================= */
async function viewAdmin() {
  const usersEl = h('div', {}), auditEl = h('div', {});
  async function load() {
    const [users, audit] = await Promise.all([http('/api/users'), http('/api/audit')]);
    usersEl.replaceChildren(h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'کاربر'), h('th', {}, 'نقش'), h('th', {}, 'وضعیت'), h('th', {}))),
      h('tbody', {}, users.map((u) => h('tr', {}, h('td', {}, u.username), h('td', {}, ROLE_FA[u.role]), h('td', {}, u.disabled ? 'غیرفعال' : 'فعال'),
        h('td', {}, u.username === S.user.username ? '' : h('button', { class: 'btn small', onclick: async () => { await http(`/api/users/${u.id}/disabled`, { method: 'POST', body: { disabled: !u.disabled } }); load(); } }, u.disabled ? 'فعال‌سازی' : 'غیرفعال‌سازی'))))))));
    auditEl.replaceChildren(h('div', { class: 'tablewrap', style: 'max-height:420px' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'زمان'), h('th', {}, 'کاربر'), h('th', {}, 'رویداد'), h('th', {}, 'جزئیات'))),
      h('tbody', {}, audit.map((a) => h('tr', {}, h('td', {}, fa(a.timestamp)), h('td', {}, a.userName), h('td', {}, a.action), h('td', { class: 'muted' }, a.detail || '')))))));
  }
  const un = h('input', { type: 'text', autocomplete: 'off' }), pw = h('input', { type: 'password', autocomplete: 'new-password' });
  const role = h('select', {}, h('option', { value: 'viewer' }, 'بیننده'), h('option', { value: 'designer' }, 'طراح'), h('option', { value: 'admin' }, 'مدیر'));
  shell(h('div', {}, h('div', { class: 'grid2' },
    h('div', {}, h('h3', {}, 'کاربران'), usersEl),
    h('div', {}, h('h3', {}, 'کاربر جدید'), h('label', {}, 'نام کاربری (انگلیسی)'), un, h('label', {}, 'رمز عبور (حداقل ۱۰ نویسه)'), pw, h('label', {}, 'نقش'), role,
      h('p', { style: 'margin-top:1rem' }, h('button', { class: 'btn primary', onclick: async () => {
        try { await http('/api/users', { method: 'POST', body: { username: un.value, password: pw.value, role: role.value } }); un.value = pw.value = ''; load(); toast('کاربر ساخته شد'); }
        catch (e) { toast(e.message, true); }
      } }, 'ساخت کاربر')))),
  h('h3', { style: 'margin:1.4rem 0 .6rem' }, 'گزارش ممیزی (۳۰۰ رویداد آخر، غیرقابل ویرایش)'), auditEl));
  load().catch((e) => toast(e.message, true));
}

boot();
