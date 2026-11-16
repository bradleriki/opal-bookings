import {
  DAY_START, DAY_END, LAST_START, STEP, CELLS, STARTS, RES, RES_IDS, KIND, LEVELS, POUR_LEVELS, CHART,
  levelOf, zoneOf, zoneShort, zoneLong, craneCheck, capAt, blocksFor, blockMsg, resourcesFor, poursOn, pourLabel,
  hourLabel, span, fmtD, addDays, weekday, brisbaneNow, cutoffPassed, pad, SHUTDOWNS, HOLIDAYS
} from './rules.js';

const $ = s => document.querySelector(s);
const RES_CLS = {crane: 'crane', delivery: 'deliv', hoist: 'hoist', pump: 'pump', mobile: 'mobile'};
const view = $('#view');

/* ---------- state ---------- */
const S = {
  me: null, programme: null, settings: null, serverNow: null,
  view: window.innerWidth < 760 ? 'day' : 'week',
  anchor: null, weekRes: 'crane', list: 'mine', zoneFilter: '',
  week: [], weekKey: '', weekLoading: true, upcoming: [],
  signup: null
};
const today = () => brisbaneNow().date;
const notSunday = (d, dir = 1) => weekday(d) === 0 ? addDays(d, dir) : d;
const monday = d => addDays(d, -((weekday(d) + 6) % 7));
const fmtLong = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-AU', {timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'});
const fmtShort = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-AU', {timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short'});
const isAdmin = () => !!(S.me && S.me.role === 'admin');
const isMine = b => !!(S.me && b.companyId && b.companyId === S.me.companyId);
function startPassed(date, t){ const n = brisbaneNow(); return date < n.date || (date === n.date && t + STEP <= n.hour); }
function endPassed(date, t){ const n = brisbaneNow(); return date < n.date || (date === n.date && t <= n.hour); }

function el(tag, cls, text){ const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function h(tag, attrs, ...kids){
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})){
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}
let toastT = null;
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2800); }

async function api(path, opts = {}){
  const res = await fetch(path, {
    method: opts.method || 'GET', credentials: 'same-origin',
    headers: opts.body ? {'Content-Type': 'application/json'} : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 401 && !path.startsWith('/api/auth')){ S.me = null; route(); }
  if (!res.ok) { const e = new Error(data.error || 'The connection dropped. Check your signal and try again.'); e.status = res.status; throw e; }
  return data;
}

/* ---------- header ---------- */
function renderHeader(){
  const signedIn = !!S.me;
  const active = signedIn && S.me.status === 'active' && S.me.companyStatus === 'approved';
  const who = $('#who');
  who.hidden = !signedIn;
  who.textContent = '';
  if (signedIn){
    who.append(el('b', null, S.me.name), ' · ' + S.me.companyName + ' ');
    who.append(h('button', {class: 'linkbtn', type: 'button', onclick: signOut}, 'Sign out'));
  }
  $('#hdrActions').hidden = !active;
  $('#adminLink').hidden = !isAdmin();
}
async function signOut(){ await api('/api/auth/logout', {method: 'POST', body: {}}).catch(() => {}); S.me = null; location.hash = '#/'; route(); }

/* ---------- sign-in ---------- */
function renderSignIn(step = 'email', email = ''){
  view.textContent = '';
  const err = el('p', 'err'); err.setAttribute('role', 'alert');
  const card = el('section', 'card');
  card.dataset.signin = '1';
  if (step === 'email'){
    const input = h('input', {type: 'email', name: 'email', autocomplete: 'email', required: true, value: email});
    const btn = h('button', {class: 'primary', type: 'submit'}, 'Email me a code');
    const form = h('form', {novalidate: true}, h('h2', null, 'Sign in'),
      h('p', null, 'Book the tower crane, loading zone, hoist, boom pump and mobile crane at Opal Carindale. Enter your email and we’ll send you a 6-digit code. There’s no password.'),
      h('label', {class: 'f'}, 'Email', input), err, btn);
    form.addEventListener('submit', async e => {
      e.preventDefault(); err.textContent = ''; btn.disabled = true; btn.textContent = 'Sending…';
      try {
        const r = await api('/api/auth/request', {method: 'POST', body: {email: input.value}});
        if (r.devCode) console.info('Dev mode sign-in code:', r.devCode);
        renderSignIn('code', input.value.trim());
      } catch (x){ err.textContent = x.message; btn.disabled = false; btn.textContent = 'Email me a code'; }
    });
    card.append(form); view.append(card); input.focus();
  } else if (step === 'code'){
    const input = h('input', {type: 'text', name: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', pattern: '[0-9]{6}', required: true});
    const btn = h('button', {class: 'primary', type: 'submit'}, 'Sign in');
    const form = h('form', {novalidate: true}, h('h2', null, 'Check your email'),
      h('p', null, 'We sent a 6-digit code to ', h('b', null, email), '. It expires in 10 minutes. Check your junk folder if it hasn’t arrived.'),
      h('label', {class: 'f'}, 'Code', input), err, btn,
      h('p', {class: 'small', style: 'margin-top:12px'}, h('button', {class: 'linkbtn', type: 'button', onclick: () => renderSignIn('email', email)}, 'Use a different email or send a new code')));
    form.addEventListener('submit', async e => {
      e.preventDefault(); err.textContent = ''; btn.disabled = true;
      try {
        const r = await api('/api/auth/verify', {method: 'POST', body: {email, code: input.value}});
        if (r.next === 'profile'){ S.signup = {token: r.signupToken, companies: r.companies, email}; renderSignIn('profile', email); }
        else { await loadMe(); route(); }
      } catch (x){ err.textContent = x.message; btn.disabled = false; }
    });
    card.append(form); view.append(card); input.focus();
  } else {
    const companies = S.signup.companies || [];
    const name = h('input', {type: 'text', name: 'name', autocomplete: 'name', maxlength: '80'});
    const phone = h('input', {type: 'tel', name: 'phone', autocomplete: 'tel', maxlength: '30'});
    const sel = h('select', {name: 'companyId'}, h('option', {value: ''}, companies.length ? 'Pick your company…' : 'No companies yet'),
      companies.map(c => h('option', {value: c.id}, c.name)), h('option', {value: '__new'}, 'My company isn’t listed'));
    const newCo = h('input', {type: 'text', name: 'newCompany', autocomplete: 'organization', maxlength: '80'});
    const newWrap = h('label', {class: 'f', hidden: companies.length > 0}, 'Company name', newCo);
    if (!companies.length) sel.value = '__new';
    sel.addEventListener('change', () => { newWrap.hidden = sel.value !== '__new'; });
    const priv = h('input', {type: 'checkbox', name: 'privacy'});
    const btn = h('button', {class: 'primary', type: 'submit'}, 'Finish signing up');
    const form = h('form', {novalidate: true}, h('h2', null, 'Your details'),
      h('p', null, 'Signing up as ', h('b', null, email), '.'),
      h('label', {class: 'f'}, 'Your name', name), h('label', {class: 'f'}, 'Mobile', phone),
      h('label', {class: 'f'}, 'Company', sel), newWrap,
      h('p', {class: 'privacy'}, 'Privacy: your name, company, mobile and email are kept so the site team and other trades booking on this site can see who has booked and contact you about a booking. They are not used for anything else. Ask the site team at any time to delete your details.'),
      h('label', {class: 'check block'}, priv, 'I accept the privacy note'),
      err, btn);
    form.addEventListener('submit', async e => {
      e.preventDefault(); err.textContent = ''; btn.disabled = true;
      const body = {signupToken: S.signup.token, name: name.value, phone: phone.value, privacy: priv.checked};
      if (sel.value && sel.value !== '__new') body.companyId = sel.value; else body.newCompany = newCo.value;
      try { await api('/api/auth/signup', {method: 'POST', body}); S.signup = null; await loadMe(); route(); }
      catch (x){ err.textContent = x.message; btn.disabled = false; }
    });
    card.append(form); view.append(card); name.focus();
  }
}

function renderPending(){
  view.textContent = '';
  view.append(h('section', {class: 'card'}, h('h2', null, 'Waiting for approval'),
    h('p', null, `Thanks, ${S.me.name}. ${S.me.companyName} is new to this site, so the site team needs to approve it before you can book. We’ll email you as soon as that’s done.`),
    h('p', {class: 'muted small'}, 'Already approved? ', h('button', {class: 'linkbtn', type: 'button', onclick: async () => { await loadMe(); route(); }}, 'Check again'))));
}

/* ---------- board ---------- */
function entriesFor(res, date){ return S.week.filter(b => b.date === date && b.resources.includes(res)).sort((a, b) => a.start - b.start); }
function matchesFilter(b){ if (!S.zoneFilter) return true; const [lv, z] = S.zoneFilter.split(':'); return b.level === lv && (z === '*' || b.zoneId === z); }
const blocks = (res, date) => blocksFor(res, date, S.programme);

let pollT = null;
async function loadWeek(force){
  const m = monday(S.anchor), k = m;
  if (k !== S.weekKey){ S.weekKey = k; S.week = []; S.weekLoading = true; }
  else if (!force) return;
  try {
    const [w, up] = await Promise.all([
      api(`/api/bookings?from=${m}&to=${addDays(m, 6)}`),
      api(`/api/bookings?from=${today()}&to=${addDays(today(), 28)}`)
    ]);
    if (S.weekKey !== k) return;
    S.week = w.bookings; S.upcoming = up.bookings; S.weekLoading = false;
    if (currentRoute() === 'board') renderBoard();
    refreshAvail();
  } catch (x){ if (x.status !== 401) toast(x.message); }
}
function startPolling(){
  clearInterval(pollT);
  pollT = setInterval(() => { if (!document.hidden && currentRoute() === 'board' && !$('#formDlg').open && !$('#detDlg').open) loadWeek(true); }, 20000);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.me && currentRoute() === 'board') loadWeek(true); });

function columns(){
  const t = today();
  if (S.view === 'day') return RES_IDS.map(r => ({res: r, date: S.anchor, head: RES[r].label, today: false}));
  const m = monday(S.anchor);
  return [0, 1, 2, 3, 4, 5].map(i => { const d = addDays(m, i); return {res: S.weekRes, date: d, head: fmtShort(d), today: d === t}; });
}

function renderBoard(){
  view.textContent = '';
  const m = monday(S.anchor);
  const controls = h('div', {class: 'controls'},
    h('div', {class: 'nav'},
      h('button', {type: 'button', 'aria-label': 'Previous', onclick: () => step(-1)}, '‹'),
      h('button', {type: 'button', onclick: () => { S.anchor = notSunday(today()); loadWeek(); renderBoard(); }}, 'Today'),
      h('button', {type: 'button', 'aria-label': 'Next', onclick: () => step(1)}, '›'),
      h('h2', {id: 'rangeLabel'}, S.view === 'day' ? fmtLong(S.anchor) : fmtD(m).replace(/ \d+$/, '') + ' – ' + fmtD(addDays(m, 5)))),
    h('div', {class: 'seg', role: 'group', 'aria-label': 'View'},
      ['day', 'week'].map(v => h('button', {type: 'button', 'aria-pressed': String(S.view === v), onclick: () => { S.view = v; renderBoard(); }}, v === 'day' ? 'Day' : 'Week'))),
    h('div', {class: 'seg', role: 'group', 'aria-label': 'Show bookings for', hidden: S.view !== 'week'},
      RES_IDS.map(r => h('button', {type: 'button', 'aria-pressed': String(S.weekRes === r), onclick: () => { S.weekRes = r; renderBoard(); }}, RES[r].label))),
    zoneFilterEl());
  view.append(controls);

  const cols = columns();
  const board = h('div', {class: 'board', 'data-view': S.view, style: `--cols:${cols.length};--rows:${CELLS.length}`});
  board.append(el('div', 'corner'));
  for (const c of cols){
    const hd = el('div', 'colhead' + (c.today ? ' today' : ''));
    if (S.view === 'day'){ const k = el('span', 'key'); k.style.background = 'var(--' + RES_CLS[c.res] + ')'; hd.append(k); }
    hd.append(c.head);
    const pl = pourLabel(c.date, S.programme);
    if (pl && (S.view === 'week' || c.res === 'crane')){ const f = el('span', 'pour'); f.append(el('span', null, 'Pour: ' + pl)); hd.append(f); }
    if (S.view === 'week'){
      const bl = blocks(c.res, c.date);
      if (bl.some(b => b.full)) hd.append(el('span', 'sub na', 'Not available'));
      else {
        const total = DAY_END - DAY_START - bl.reduce((a, b) => a + (b.end - b.start), 0);
        const n = entriesFor(c.res, c.date).reduce((a, b) => a + (b.end - b.start), 0);
        hd.append(el('span', 'sub', S.weekLoading ? ' ' : (total - n) + ' of ' + total + ' hours free'));
      }
    }
    board.append(hd);
  }
  const gutter = el('div', 'gutter');
  CELLS.forEach(t => gutter.append(el('div', null, hourLabel(t))));
  board.append(gutter);

  for (const c of cols){
    const col = el('div', 'col');
    const covered = new Set();
    for (const b of blocks(c.res, c.date)){
      for (let t = b.start; t < b.end; t += STEP) covered.add(t);
      const d = el('div', b.full ? 'bk off' : 'bk brk', b.details);
      d.style.gridRow = rowOf(b.start) + ' / ' + rowOf(b.end);
      col.append(d);
    }
    for (const b of entriesFor(c.res, c.date)){
      for (let t = b.start; t < b.end; t += STEP) covered.add(t);
      const cls = b.kind === 'hold' || b.kind === 'closure' ? 'hold' : RES_CLS[c.res];
      const btn = el('button', 'bk ' + cls + (isMine(b) ? ' mine' : '') + (endPassed(c.date, b.end) ? ' past' : '') + (matchesFilter(b) ? '' : ' dim'));
      btn.type = 'button';
      btn.style.gridRow = rowOf(b.start) + ' / ' + rowOf(b.end);
      if (b.level && b.zoneId) btn.append(el('span', 'z', zoneShort(b.level, b.zoneId)));
      btn.append(el('span', 't', span(b.start, b.end)));
      btn.append(el('span', 'c', b.kind === 'hold' ? 'Site hold' : b.kind === 'closure' ? 'Closed' : (b.company || 'Booked')));
      let d = b.details || '';
      if (b.kind === 'delivery' && c.res === 'crane') d = 'Unloading delivery' + (d ? ': ' + d : '');
      else if (b.kind === 'delivery' && c.res === 'hoist') d = 'Delivery going up' + (d ? ': ' + d : '');
      else if (b.kind === 'delivery'){ const extra = b.resources.filter(r => r !== 'delivery').map(r => RES[r].short); if (extra.length) d = 'With ' + extra.join(' + ') + (d ? ': ' + d : ''); }
      if (d) btn.append(el('span', 'd', d));
      if (isMine(b)) btn.append(el('span', 'tag', 'Yours'));
      btn.setAttribute('aria-label', (b.company || KIND[b.kind]) + ', ' + RES[c.res].label + ', ' + span(b.start, b.end) + ', ' + c.date);
      btn.addEventListener('click', () => openDetail(b));
      col.append(btn);
    }
    const canBook = !S.weekLoading;
    for (const t of CELLS){
      if (covered.has(t)) continue;
      const past = startPassed(c.date, t), startable = t <= LAST_START;
      const s = el('button', 'slot' + (past ? ' past' : ''), past || !startable ? '' : 'Book ' + hourLabel(t));
      s.type = 'button'; s.style.gridRow = String(rowOf(t));
      s.disabled = past || !canBook || !startable;
      s.setAttribute('aria-label', 'Book ' + RES[c.res].short + ' at ' + hourLabel(t) + ' on ' + fmtShort(c.date));
      s.addEventListener('click', () => openForm({res: c.res, date: c.date, hour: t}));
      col.append(s);
    }
    board.append(col);
  }
  view.append(h('div', {class: 'scroller'}, board));
  view.append(lowerPanels());
}
const rowOf = t => Math.round((t - DAY_START) / STEP) + 1;
function step(dir){
  if (S.view === 'day'){ let d = addDays(S.anchor, dir); if (weekday(d) === 0) d = addDays(d, dir); S.anchor = d; }
  else S.anchor = addDays(S.anchor, 7 * dir);
  loadWeek(); renderBoard();
}
function zoneFilterEl(){
  const f = h('select', {id: 'zoneFilter'}, h('option', {value: ''}, 'All zones'));
  for (const l of LEVELS){
    const g = h('optgroup', {label: l.label});
    if (l.zones.length > 1) g.append(h('option', {value: l.id + ':*'}, l.label + ', all zones'));
    l.zones.forEach(z => g.append(h('option', {value: l.id + ':' + z.id}, zoneShort(l.id, z.id) || l.label)));
    f.append(g);
  }
  f.value = S.zoneFilter;
  f.addEventListener('change', () => { S.zoneFilter = f.value; renderBoard(); });
  return h('label', {class: 'zonefilter'}, 'Zone', f);
}
function lowerPanels(){
  const list = h('ul', {class: 'list'});
  const limit = addDays(today(), 14);
  const rows = S.upcoming.filter(b => !endPassed(b.date, b.end))
    .filter(b => S.list === 'mine' ? isMine(b) : b.date <= limit)
    .filter(matchesFilter)
    .sort((x, y) => (x.date + pad(x.start)).localeCompare(y.date + pad(y.start)));
  if (!rows.length) list.append(el('li', 'empty', S.list === 'mine' ? 'Your company has no upcoming bookings. Pick a free hour on the board to book one.' : 'Nothing booked in the next 14 days.'));
  for (const b of rows){
    const sw = el('span', 'sw'); sw.style.background = b.kind === 'hold' || b.kind === 'closure' ? 'var(--hold-b)' : 'var(--' + RES_CLS[b.resources[0]] + ')';
    list.append(h('li', null, h('button', {type: 'button', onclick: () => openDetail(b)}, sw,
      el('span', 'l1', fmtShort(b.date) + ', ' + span(b.start, b.end) + ' · ' + b.resources.map(r => RES[r].label).join(' + ') + ' · ' + zoneShort(b.level, b.zoneId)),
      el('span', 'l2', (b.kind === 'hold' ? 'Site hold' : b.kind === 'closure' ? 'Closed' : b.company) + (b.details ? ': ' + b.details : '')))));
  }
  const P = S.programme;
  return h('div', {class: 'lower'},
    h('section', {class: 'panel'}, h('h2', null, h('span', null, S.list === 'mine' ? 'Your company’s upcoming bookings' : 'All bookings, next 14 days'),
      h('span', {class: 'seg', role: 'group', 'aria-label': 'List'},
        h('button', {type: 'button', 'aria-pressed': String(S.list === 'mine'), onclick: () => { S.list = 'mine'; renderBoard(); }}, 'Yours'),
        h('button', {type: 'button', 'aria-pressed': String(S.list === 'all'), onclick: () => { S.list = 'all'; renderBoard(); }}, 'Everyone, next 14 days'))), list),
    h('section', {class: 'panel rules'}, h('h2', null, 'Site rules for bookings'),
      h('p', null, 'The tower crane, loading zone, materials hoist, concrete boom pump and mobile crane are booked separately. If your delivery needs the crane to unload or the hoist to take it up, tick the boxes on the booking form and they are booked together.'),
      h('p', null, `Bookings close at ${hourLabel(S.settings.cutoff)} the day before. For anything sooner, call the site team.`),
      h('p', null, 'Every booking is tied to a level and pour zone from the slab pour sequence. Use the zone filter to see one zone’s bookings.'),
      h('p', null, 'Enter the heaviest piece and the lift radius when you book a crane lift. The form checks them against the Comedil CTL260-18 load chart (15.5 t at 15 m down to 2.9 t at 55 m). Slab 2 (NW corner) on L2 to L6 is at 35 to 45 m radius and beyond, where the chart drops to 4.3 t at 45 m and 3.53 t at 50 m. L1 Slab 4 is the furthest L1 zone. Allow for rigging. The crane crew confirms every lift.'),
      h('p', null, `The tower crane can be booked from ${fmtD(P.craneFrom)} to ${fmtD(P.craneTo)}. The materials hoist can be booked from ${fmtD(P.hoistFrom)} to ${fmtD(P.hoistTo)}.`),
      h('p', null, 'The concrete pump is the Meales boom pump (Unit 334), set up off the driveway beside the hoist. It reaches 45.2 m horizontally and 49.2 m vertically. The feed area is 8 × 5 m and takes two agitators. The longest run is 47 m, to the L6 Slab 2 corner, with a line attachment at L6.'),
      h('p', null, 'The site is shut 23 Dec 26 to 11 Jan 27 and 24 Dec 27 to 10 Jan 28, and on QLD public holidays. Nothing can be booked on those days.'),
      h('p', null, 'Days marked with a striped pour flag are programmed pour days. Expect the crane and loading zone to be busy. Ground floor slabs follow the engineer’s five pour stages; bays with the same stage number pour on the same day.'),
      h('p', null, 'The crane is not available 12:30 to 1:00pm for the crane driver’s break. Deliveries that need the crane to unload can’t be booked over it either.'),
      h('p', null, 'Hatched blocks are held or closed by the site team. Running late or not coming? Cancel the booking so someone else can use the slot.'),
      h('p', {class: 'src'}, 'Pour, crane and hoist dates from: ' + (P.source || 'not stated') + '.')));
}

/* ---------- booking form ---------- */
const form = $('#bkForm'), formDlg = $('#formDlg');
STARTS.forEach(t => form.start.append(h('option', {value: t}, hourLabel(t))));
LEVELS.forEach(l => form.level.append(h('option', {value: l.id}, l.label)));
function formKind(){ const r = form.querySelector('input[name=kind]:checked'); return r ? r.value : 'crane'; }
function formInput(){
  const k = formKind();
  return {
    kind: k, date: form.date.value, start: Number(form.start.value), dur: Number(form.dur.value),
    level: form.level.value, zoneId: form.zoneId.value, details: form.details.value, holdRes: form.holdRes.value,
    craneToo: form.craneToo.checked, hoistToo: form.hoistToo.checked,
    weight: form.weight.value, radius: form.radius.value, vehicle: form.vehicle.value, load: form.load.value,
    volume: form.volume.value, pumpSetup: form.pumpSetup.value, mcSize: form.mcSize.value, mcWeight: form.mcWeight.value, mcSetup: form.mcSetup.value
  };
}
function fillZones(keep){
  const l = levelOf(form.level.value);
  form.zoneId.textContent = '';
  l.zones.forEach(z => form.zoneId.append(h('option', {value: z.id}, z.name + (z.desc && z.name !== z.desc ? ' (' + z.desc + ')' : ''))));
  if (keep && l.zones.some(z => z.id === keep)) form.zoneId.value = keep;
}
function prefillRadius(){ const z = zoneOf(form.level.value, form.zoneId.value); form.radius.value = z && z.radius ? z.radius : ''; }
function fillDur(keep){
  const start = Number(form.start.value), max = Math.floor(DAY_END - start), prev = keep || Number(form.dur.value) || 1;
  form.dur.textContent = '';
  for (let i = 1; i <= max; i++) form.dur.append(h('option', {value: i}, i + (i === 1 ? ' hour' : ' hours') + ' (to ' + hourLabel(start + i) + ')'));
  form.dur.value = String(Math.min(prev, max));
}
function syncSections(){
  const k = formKind();
  form.querySelectorAll('[data-sec]').forEach(s => { s.hidden = !s.dataset.sec.split(' ').includes(k); });
  $('#detailsLabel').textContent = {hold: 'Reason for the hold', closure: 'Reason for closing (sent to affected bookers)', crane: 'What is being lifted', hoist: 'What is going up or down', pump: 'Pour details', mobile: 'What is being lifted', delivery: 'What is being delivered'}[k];
  form.details.placeholder = {hold: 'e.g. L3 Slab 2 pour', closure: 'e.g. Wind over the crane limit', crane: 'e.g. Reo bundles to L3 Slab 2', hoist: 'e.g. Plasterboard to L4, 2 trolleys', pump: 'e.g. L3 Slab 1 pour, 2 agitators', mobile: 'e.g. Plant deck AC units to roof', delivery: 'e.g. 2 pallets of wall framing'}[k];
  $('#submitBtn').textContent = k === 'hold' ? 'Hold slot' : k === 'closure' ? 'Close and notify' : 'Book slot';
  $('#bookingAs').textContent = S.me ? `Booking for ${S.me.companyName}. Contact: ${S.me.name}, ${S.me.phone}.` : '';
}
function zoneCard(){
  const c = $('#zoneCard'); c.textContent = '';
  const z = zoneOf(form.level.value, form.zoneId.value); if (!z) return;
  const k = formKind();
  c.append(el('b', null, zoneLong(form.level.value, form.zoneId.value)));
  if (z.area) c.append(', ' + z.area + '.');
  if (z.pumpNote && k === 'pump') c.append(' ' + z.pumpNote);
  if (z.note && form.level.value === 'GF' && k !== 'hold' && k !== 'closure') c.append(' ' + z.note);
  else if (z.note && (k === 'crane' || (k === 'delivery' && form.craneToo.checked))){ c.append(' '); c.append(el('span', z.longRadius && k === 'crane' ? 'warn' : null, z.note)); }
  const pl = pourLabel(form.date.value, S.programme);
  if (pl && k !== 'hold' && k !== 'closure'){ c.append(' '); c.append(el('span', 'warn', 'Pour programmed this day: ' + pl + '. Expect the crane and loading zone to be tied up.')); }
}
function capCheck(){
  const m = $('#capMsg');
  const r = craneCheck(form.weight.value, form.radius.value);
  m.className = 'sec avail' + (r.level === 'ok' ? ' ok' : r.level === 'none' ? '' : ' bad');
  m.textContent = formKind() === 'crane' ? r.msg : '';
  return r;
}
function refreshAvail(){
  if (!formDlg.open) return;
  capCheck();
  const a = $('#avail'), date = form.date.value;
  if (!date){ a.className = 'avail'; a.textContent = ''; return; }
  const start = Number(form.start.value), end = start + Number(form.dur.value);
  const bad = msg => { a.className = 'avail bad'; a.textContent = msg; };
  if (weekday(date) === 0) return bad('The site is closed on Sundays.');
  if (startPassed(date, start)) return bad('That time has already passed.');
  const k = formKind();
  if (!isAdmin() && cutoffPassed(date, brisbaneNow(), S.settings.cutoff)) return bad(`Bookings for ${fmtD(date)} closed at ${hourLabel(S.settings.cutoff)} the day before. Call the site team.`);
  if (monday(date) !== S.weekKey || S.weekLoading){ a.className = 'avail'; a.textContent = 'Checking availability…'; return; }
  const res = resourcesFor(formInput());
  for (const r of res){
    for (const x of blocks(r, date)) if (x.start < end && start < x.end && (x.full || (k !== 'hold' && k !== 'closure'))) return bad(x.full ? RES[r].label + ': ' + x.details + '.' : blockMsg(x));
    if (k === 'closure') continue;
    const c = entriesFor(r, date).find(b => b.start < end && start < b.end);
    if (c) return bad(RES[r].label + ' is taken ' + span(c.start, c.end) + ' by ' + (c.kind === 'hold' ? 'a site hold' : c.kind === 'closure' ? 'a site closure' : c.company) + '. Pick another time.');
  }
  if (k === 'closure'){
    const n = new Set(res.flatMap(r => entriesFor(r, date).filter(b => b.start < end && start < b.end).map(b => b.id))).size;
    a.className = 'avail' + (n ? ' bad' : ' ok'); a.textContent = n ? `This will cancel ${n} booking${n > 1 ? 's' : ''} and email the bookers.` : 'No bookings in that time.';
    return;
  }
  a.className = 'avail ok';
  a.textContent = 'Free: ' + res.map(r => RES[r].label.toLowerCase()).join(' and ') + ', ' + span(start, end) + '.';
}
function openForm(pre = {}){
  $('#formErr').textContent = '';
  form.querySelectorAll('[data-admin]').forEach(x => { x.hidden = !isAdmin(); });
  form.reset();
  const kind = RES[pre.res] ? pre.res : 'crane';
  form.querySelector(`input[name=kind][value=${kind}]`).checked = true;
  const t = today();
  form.date.min = t;
  form.date.value = pre.date || (S.anchor < t ? notSunday(t) : S.anchor);
  let hr = pre.hour;
  if (hr == null){ hr = 7.5; if (form.date.value === t){ const n = brisbaneNow().hour; hr = STARTS.find(x => x >= n) ?? LAST_START; } }
  form.start.value = String(STARTS.includes(hr) ? hr : 7.5);
  fillDur(1);
  let saved = {}; try { saved = JSON.parse(localStorage.getItem('opal-zone') || '{}'); } catch {}
  let lv = saved.level || 'L2', zn = saved.zoneId || 'S1';
  if (S.zoneFilter){ const [fl, fz] = S.zoneFilter.split(':'); lv = fl; zn = fz === '*' ? '' : fz; }
  const pour = poursOn(form.date.value, S.programme)[0];
  if (!S.zoneFilter && pour){ lv = pour[0]; zn = pour[1]; }
  form.level.value = levelOf(lv) ? lv : 'L2';
  fillZones(zn); prefillRadius(); syncSections(); zoneCard();
  formDlg.showModal();
  if (form.date.value && monday(form.date.value) !== S.weekKey){ S.anchor = form.date.value; loadWeek(); }
  refreshAvail();
}
form.addEventListener('input', e => { if (e.target.name === 'weight' || e.target.name === 'radius') capCheck(); });
form.addEventListener('change', e => {
  const n = e.target.name;
  if (n === 'kind') syncSections();
  if (n === 'level'){ fillZones(); prefillRadius(); }
  if (n === 'zoneId') prefillRadius();
  if (n === 'start') fillDur();
  if (n === 'date' && form.date.value && weekday(form.date.value) !== 0 && monday(form.date.value) !== S.weekKey){ S.anchor = form.date.value; loadWeek(); }
  zoneCard(); refreshAvail();
});
$('#formCancel').addEventListener('click', () => formDlg.close());
form.addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#formErr'); err.textContent = '';
  const input = formInput();
  if (input.kind === 'crane'){ const cc = capCheck(); if (!cc.ok){ err.textContent = cc.msg; return; } }
  if (input.kind === 'closure' && !confirm('Close this and cancel any bookings in that time? Each booker gets an email with your reason.')) return;
  const btn = $('#submitBtn'); btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const r = await api('/api/bookings', {method: 'POST', body: input});
    try { localStorage.setItem('opal-zone', JSON.stringify({level: input.level, zoneId: input.zoneId})); } catch {}
    formDlg.close();
    toast(input.kind === 'hold' ? 'Slot held' : input.kind === 'closure' ? `Closed. ${r.cancelled} booking${r.cancelled === 1 ? '' : 's'} cancelled and emailed.` : 'Booked ' + span(input.start, input.start + input.dur) + ', ' + fmtShort(input.date) + '. Confirmation emailed.');
    S.anchor = input.date; await loadWeek(true);
  } catch (x){ err.textContent = x.message; if (x.status === 409) loadWeek(true); }
  finally { btn.disabled = false; syncSections(); }
});
$('#bookBtn').addEventListener('click', () => { if (currentRoute() !== 'board') location.hash = '#/'; openForm({res: S.view === 'week' ? S.weekRes : 'crane'}); });

/* ---------- booking detail ---------- */
const detDlg = $('#detDlg');
let detCurrent = null;
function openDetail(b){
  detCurrent = b;
  $('#detErr').textContent = '';
  $('#detTitle').textContent = b.kind === 'hold' ? 'Site hold' : b.kind === 'closure' ? 'Closed by site team' : (b.company || KIND[b.kind]);
  const dl = $('#detList'); dl.textContent = '';
  const add = (k, v, href) => {
    if (v == null || v === '') return;
    dl.append(el('dt', null, k));
    const dd = el('dd'); if (href){ const a = el('a', null, v); a.href = href; dd.append(a); } else dd.textContent = v;
    dl.append(dd);
  };
  add('When', fmtLong(b.date) + ', ' + span(b.start, b.end));
  add('Type', KIND[b.kind]);
  add('Uses', b.resources.map(r => RES[r].label).join(' and '));
  add(b.kind === 'hold' || b.kind === 'closure' ? 'Reason' : 'Details', b.details);
  add('Heaviest piece', b.weight != null ? b.weight + ' t' : '');
  add('Lift radius', b.radius != null ? b.radius + ' m (chart ' + (capAt(b.radius) ?? '–') + ' t)' : '');
  add('Pour zone', zoneLong(b.level, b.zoneId));
  add('Vehicle', b.vehicle);
  add('Hoist load', b.load != null ? b.load + ' kg' : '');
  add('Concrete volume', b.volume != null ? b.volume + ' m³' : '');
  add('Pump set-up', b.pumpSetup);
  add('Mobile crane size', b.mcSize != null ? b.mcSize + ' t' : '');
  add('Heaviest piece', b.mcWeight != null ? b.mcWeight + ' t' : '');
  add('Crane set-up', b.mcSetup);
  if (b.kind !== 'hold' && b.kind !== 'closure'){ add('Contact', b.contact); add('Mobile', b.phone, b.phone ? 'tel:' + b.phone.replace(/[^\d+]/g, '') : null); }
  if (b.createdAt) add('Booked on', new Date(b.createdAt).toLocaleString('en-AU', {timeZone: 'Australia/Brisbane', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit'}));
  const canCancel = isAdmin() || (isMine(b) && !endPassed(b.date, b.end));
  $('#detCancelBk').hidden = !canCancel;
  $('#detCancelBk').textContent = b.kind === 'hold' ? 'Release hold' : b.kind === 'closure' ? 'Reopen' : 'Cancel booking';
  detDlg.showModal();
}
$('#detClose').addEventListener('click', () => detDlg.close());
$('#detCancelBk').addEventListener('click', async () => {
  if (!detCurrent) return;
  const b = detCurrent, btn = $('#detCancelBk'); btn.disabled = true;
  let reason = '';
  if (isAdmin() && !isMine(b) && b.kind !== 'hold' && b.kind !== 'closure'){ reason = prompt('Reason (sent to the booker):', '') ?? null; if (reason === null){ btn.disabled = false; return; } }
  try {
    await api(`/api/bookings/${b.id}/cancel`, {method: 'POST', body: {reason}});
    detDlg.close();
    toast(b.kind === 'hold' ? 'Hold released' : b.kind === 'closure' ? 'Reopened' : 'Booking cancelled');
    loadWeek(true);
  } catch (x){ $('#detErr').textContent = x.message; }
  finally { btn.disabled = false; }
});

/* ---------- daily lift plan / gate sheet ---------- */
async function renderPlan(date){
  date = date || notSunday(today());
  view.textContent = '';
  const dateIn = h('input', {type: 'date', value: date});
  dateIn.addEventListener('change', () => { if (dateIn.value) location.hash = '#/plan/' + dateIn.value; });
  view.append(h('div', {class: 'controls noprint'},
    h('div', {class: 'nav'},
      h('button', {type: 'button', 'aria-label': 'Previous day', onclick: () => { location.hash = '#/plan/' + notSunday(addDays(date, -1), -1); }}, '‹'),
      h('button', {type: 'button', 'aria-label': 'Next day', onclick: () => { location.hash = '#/plan/' + notSunday(addDays(date, 1)); }}, '›'),
      h('label', {class: 'zonefilter'}, 'Day', dateIn)),
    h('button', {class: 'primary', type: 'button', onclick: () => window.print()}, 'Print')));
  const box = h('section', {class: 'plan'}, h('p', {class: 'muted'}, 'Loading…'));
  view.append(box);
  let bookings;
  try { bookings = (await api(`/api/bookings?from=${date}&to=${date}`)).bookings; }
  catch (x){ box.textContent = x.message; return; }
  box.textContent = '';
  box.append(h('h2', null, 'Daily lift plan and gate sheet · ' + fmtLong(date)));
  const pl = pourLabel(date, S.programme);
  box.append(h('p', {class: 'pourline'}, pl ? 'Programmed pour: ' + pl + '.' : 'No pour programmed.'));
  const closed = RES_IDS.map(r => [r, blocksFor(r, date, S.programme).find(b => b.full)]).filter(x => x[1]);
  if (closed.length) box.append(h('p', {class: 'small'}, closed.map(([r, b]) => RES[r].label + ': ' + b.details).join(' · ')));
  const rows = bookings.slice().sort((a, b) => a.start - b.start || a.resources[0].localeCompare(b.resources[0]));
  const tbl = h('table', {class: 'tbl'}, h('thead', null, h('tr', null, ['Time', 'Uses', 'Company / contact', 'Level & zone', 'What', 'Vehicle / load', 'Arrived'].map(x => h('th', null, x)))));
  const tb = h('tbody');
  if (!rows.length) tb.append(h('tr', null, h('td', {colspan: '7', class: 'muted'}, 'No bookings.')));
  for (const b of rows){
    const load = [b.weight != null ? `Heaviest ${b.weight} t` + (b.radius != null ? ` @ ${b.radius} m` : '') : '', b.vehicle, b.load != null ? b.load + ' kg' : '', b.volume != null ? b.volume + ' m³' : '', b.mcSize != null ? b.mcSize + ' t mobile, ' + (b.mcSetup || '') : ''].filter(Boolean).join(' · ');
    const admin = b.kind === 'hold' || b.kind === 'closure';
    tb.append(h('tr', {class: admin ? 'blk' : null},
      h('td', null, span(b.start, b.end)),
      h('td', null, b.resources.map(r => RES[r].label).join(' + ')),
      h('td', null, admin ? (b.kind === 'hold' ? 'Site hold' : 'Closed') : [h('b', null, b.company), h('br'), b.contact + (b.phone ? ', ' + b.phone : '')]),
      h('td', null, zoneShort(b.level, b.zoneId)),
      h('td', null, b.details),
      h('td', null, load),
      h('td', null, admin ? '' : '☐')));
  }
  tbl.append(tb);
  box.append(h('div', {class: 'tblwrap'}, tbl));
  box.append(h('p', {class: 'small muted', style: 'margin-top:10px'}, 'Crane driver break 12:30–1:00pm. Printed ' + new Date().toLocaleString('en-AU', {timeZone: 'Australia/Brisbane'}) + '. Source: ' + (S.programme.source || '') + '.'));
}

/* ---------- site team ---------- */
let adminTab = 'companies';
async function renderAdmin(tab){
  if (!isAdmin()){ location.hash = '#/'; return; }
  adminTab = tab || adminTab;
  view.textContent = '';
  const tabs = [['companies', 'Companies'], ['people', 'People'], ['programme', 'Programme dates'], ['settings', 'Settings & export']];
  view.append(h('h2', {style: 'color:var(--head-ink);margin:4px 0 10px'}, 'Site team'));
  view.append(h('div', {class: 'tabs', role: 'tablist'}, tabs.map(([k, l]) => h('button', {type: 'button', role: 'tab', 'aria-selected': String(adminTab === k), onclick: () => { location.hash = '#/admin/' + k; }}, l))));
  const box = el('div'); view.append(box);
  const err = el('p', 'err'); err.setAttribute('role', 'alert');
  try {
    if (adminTab === 'companies') await adminCompanies(box, err);
    else if (adminTab === 'people') await adminPeople(box, err);
    else if (adminTab === 'programme') adminProgramme(box, err);
    else adminSettings(box, err);
  } catch (x){ box.textContent = x.message; }
}
const pill = (s, cls) => h('span', {class: 'pill ' + (cls || s)}, s);
async function adminCompanies(box, err){
  const {companies} = await api('/api/admin/companies');
  const set = async (c, body) => { err.textContent = ''; try { await api('/api/admin/companies/' + c.id, {method: 'POST', body}); toast('Saved'); renderAdmin('companies'); } catch (x){ err.textContent = x.message; } };
  box.append(h('p', {class: 'muted small'}, 'Approve a company once and everyone from it can book. Approving also activates anyone from that company who is waiting.'), err);
  box.append(h('div', {class: 'tblwrap'}, h('table', {class: 'tbl'},
    h('thead', null, h('tr', null, h('th', null, 'Company'), h('th', null, 'Status'), h('th', null, 'People'), h('th', null, 'Added'), h('th', null, ''))),
    h('tbody', null, companies.length ? companies.map(c => h('tr', null,
      h('td', null, c.name), h('td', null, pill(c.status)), h('td', null, String(c.people)), h('td', null, fmtD(c.createdAt.slice(0, 10))),
      h('td', {class: 'acts'},
        c.status !== 'approved' ? h('button', {class: 'primary', type: 'button', onclick: () => set(c, {status: 'approved'})}, 'Approve') : null,
        c.status !== 'rejected' ? h('button', {class: 'ghost', type: 'button', onclick: () => { if (confirm(`Reject ${c.name}? Its people won’t be able to book.`)) set(c, {status: 'rejected'}); }}, 'Reject') : null,
        h('button', {class: 'ghost', type: 'button', onclick: () => { const n = prompt('Company name:', c.name); if (n && n !== c.name) set(c, {name: n}); }}, 'Rename'))))
      : h('tr', null, h('td', {colspan: '5', class: 'muted'}, 'No companies yet.'))))));
}
async function adminPeople(box, err){
  const {users} = await api('/api/admin/users');
  const set = async (u, body, msg) => { err.textContent = ''; try { await api('/api/admin/users/' + u.id, {method: 'POST', body}); toast(msg || 'Saved'); renderAdmin('people'); } catch (x){ err.textContent = x.message; } };
  box.append(h('p', {class: 'muted small'}, 'Site team members can approve companies, hold and close slots, cancel any booking and edit programme dates. Delete removes a person’s contact details; their past bookings stay against their company.'), err);
  box.append(h('div', {class: 'tblwrap'}, h('table', {class: 'tbl'},
    h('thead', null, h('tr', null, ['Name', 'Company', 'Email', 'Mobile', 'Access', 'Last sign-in', ''].map(x => h('th', null, x)))),
    h('tbody', null, users.map(u => h('tr', null,
      h('td', null, u.name), h('td', null, u.companyName), h('td', null, u.email), h('td', null, u.phone),
      h('td', null, u.role === 'admin' ? pill('site team', 'admin') : null, ' ', pill(u.status === 'active' && u.companyStatus !== 'approved' ? 'waiting' : u.status, u.status === 'active' && u.companyStatus !== 'approved' ? 'pending' : u.status)),
      h('td', null, u.lastLoginAt ? fmtD(u.lastLoginAt.slice(0, 10)) : '–'),
      h('td', {class: 'acts'},
        u.id === S.me.id ? h('span', {class: 'muted small'}, 'You') : [
          h('button', {class: 'ghost', type: 'button', onclick: () => set(u, {role: u.role === 'admin' ? 'member' : 'admin'})}, u.role === 'admin' ? 'Remove site team' : 'Make site team'),
          h('button', {class: 'ghost', type: 'button', onclick: () => set(u, {status: u.status === 'disabled' ? 'active' : 'disabled'})}, u.status === 'disabled' ? 'Switch on' : 'Switch off'),
          h('button', {class: 'danger', type: 'button', onclick: () => { if (confirm(`Delete ${u.name}’s details? This can’t be undone.`)) set(u, {delete: true}, 'Deleted'); }}, 'Delete')])))))));
}
function adminProgramme(box, err){
  const P = S.programme;
  const inp = (name, v) => h('input', {type: 'date', name, value: v || ''});
  const source = h('input', {type: 'text', value: P.source || '', maxlength: '120'});
  const cf = inp('craneFrom', P.craneFrom), ct = inp('craneTo', P.craneTo), hf = inp('hoistFrom', P.hoistFrom), ht = inp('hoistTo', P.hoistTo);
  const grid = h('div', {class: 'cfg-grid'});
  for (const lv of POUR_LEVELS){
    const l = levelOf(lv);
    grid.append(h('h3', null, l.label));
    for (const z of l.zones){
      if (lv === 'RF' && z.id !== 'RF') continue;
      const key = lv + ':' + z.id, id = 'p_' + lv + '_' + z.id;
      grid.append(h('label', {for: id}, z.name + (z.area ? ', ' + z.area : '')), h('input', {type: 'date', id, 'data-key': key, value: P.pours[key] || ''}));
    }
  }
  const btn = h('button', {class: 'primary', type: 'submit'}, 'Save dates');
  const f = h('form', {class: 'section', novalidate: true},
    h('p', {class: 'muted small'}, 'These dates set the pour flags and when the tower crane and hoist can be booked. Leave a pour blank if it has no date yet. Changes show for everyone straight away.'),
    h('div', {class: 'formrow'}, h('label', {class: 'f', style: 'flex:1'}, 'Programme source', source)),
    h('div', {class: 'formrow'}, h('label', {class: 'f'}, 'Crane bookable from', cf), h('label', {class: 'f'}, 'Crane last bookable day', ct),
      h('label', {class: 'f'}, 'Hoist bookable from', hf), h('label', {class: 'f'}, 'Hoist last bookable day', ht)),
    grid, err, h('div', {class: 'actions'}, btn));
  f.addEventListener('submit', async e => {
    e.preventDefault(); err.textContent = ''; btn.disabled = true;
    const pours = {}; grid.querySelectorAll('input[data-key]').forEach(i => { if (i.value) pours[i.dataset.key] = i.value; });
    try {
      await api('/api/admin/settings', {method: 'POST', body: {programme: {source: source.value, craneFrom: cf.value, craneTo: ct.value, hoistFrom: hf.value, hoistTo: ht.value, pours}}});
      await loadMe(); toast('Dates saved');
    } catch (x){ err.textContent = x.message; }
    btn.disabled = false;
  });
  box.append(f);
}
function adminSettings(box, err){
  const cut = h('select', null, STARTS.filter(t => t >= 8 && t <= 17.5 && t % 1 === 0 || t === 15.5 || t === 12.5).map(t => h('option', {value: t}, hourLabel(t))));
  cut.value = String(S.settings.cutoff);
  const btn = h('button', {class: 'primary', type: 'submit'}, 'Save');
  const f = h('form', {class: 'section', novalidate: true}, h('h3', null, 'Booking cut-off'),
    h('p', {class: 'muted small'}, 'Trades must book before this time on the day before. The site team can always book.'),
    h('div', {class: 'formrow'}, h('label', {class: 'f'}, 'Bookings close at', cut), btn), err);
  f.addEventListener('submit', async e => {
    e.preventDefault(); err.textContent = '';
    try { await api('/api/admin/settings', {method: 'POST', body: {general: {cutoff: Number(cut.value)}}}); await loadMe(); toast('Saved'); }
    catch (x){ err.textContent = x.message; }
  });
  const from = h('input', {type: 'date', value: monday(today())}), to = h('input', {type: 'date', value: addDays(monday(today()), 13)});
  const exp = h('div', {class: 'section'}, h('h3', null, 'Export bookings'),
    h('p', {class: 'muted small'}, 'Downloads a CSV that opens in Excel, including cancelled bookings and who booked them.'),
    h('div', {class: 'formrow'}, h('label', {class: 'f'}, 'From', from), h('label', {class: 'f'}, 'To', to),
      h('button', {class: 'primary', type: 'button', onclick: () => { if (from.value && to.value) location.href = `/api/admin/export?from=${from.value}&to=${to.value}`; }}, 'Download CSV')));
  const tv = h('div', {class: 'section'}, h('h3', null, 'TV display'), h('p', {class: 'muted small'}, 'Loading…'));
  box.append(f, exp, tv);
  renderTvSection(tv, err);
}
async function renderTvSection(sec, err){
  let st;
  try { st = await api('/api/admin/tv'); } catch (x){ sec.lastChild.textContent = x.message; return; }
  const act = async (action, confirmMsg) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    try { await api('/api/admin/tv', {method: 'POST', body: {action}}); toast(action === 'disable' ? 'TV display switched off' : 'New TV link ready'); }
    catch (x){ err.textContent = x.message; return; }
    sec.textContent = ''; sec.append(h('h3', null, 'TV display'), h('p', {class: 'muted small'}, 'Loading…')); renderTvSection(sec, err);
  };
  sec.textContent = '';
  sec.append(h('h3', null, 'TV display'),
    h('p', {class: 'muted small'}, 'A read-only live board for a screen in the site office: today and the next booking day, all five resources, updated every 20 seconds. No sign-in, no phone numbers, and nothing can be changed from it. Open the link on the TV\u2019s browser and make it full screen (F11 on a PC).'));
  if (!st.enabled){
    sec.append(h('div', {class: 'formrow'}, h('button', {class: 'primary', type: 'button', onclick: () => act('create')}, 'Create TV link')));
    return;
  }
  const link = h('input', {type: 'text', readonly: true, value: st.url, style: 'flex:1;min-width:260px'});
  sec.append(
    h('p', {class: 'small'}, 'Anyone with this link can see the board, so only put it on the site screen. Making a new link switches the old one off.'),
    h('div', {class: 'formrow'}, link,
      h('button', {class: 'primary', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(st.url); toast('Link copied'); } catch { link.select(); } }}, 'Copy link'),
      h('a', {class: 'ghost', href: st.url, target: '_blank', rel: 'noopener', style: 'text-decoration:none;display:inline-flex;align-items:center'}, 'Open')),
    h('div', {class: 'formrow'},
      h('button', {class: 'ghost', type: 'button', onclick: () => act('create', 'Make a new link? The TV will stop showing bookings until you open the new link on it.')}, 'Make a new link'),
      h('button', {class: 'danger', type: 'button', onclick: () => act('disable', 'Switch the TV display off?')}, 'Switch off')));
}

/* ---------- routing ---------- */
function currentRoute(){
  const r = location.hash.replace(/^#\/?/, '').split('/');
  return r[0] || 'board';
}
async function loadMe(){
  const r = await api('/api/me');
  S.me = r.user; S.programme = r.programme; S.settings = r.settings;
}
function route(){
  renderHeader();
  if (formDlg.open) formDlg.close();
  if (detDlg.open) detDlg.close();
  if (!S.me){ clearInterval(pollT); if (!view.querySelector('[data-signin]')) renderSignIn(); return; }
  if (!(S.me.status === 'active' && S.me.companyStatus === 'approved')){ clearInterval(pollT); renderPending(); return; }
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const r = parts[0] || 'board';
  if (r === 'plan') return renderPlan(parts[1]);
  if (r === 'admin') return renderAdmin(parts[1]);
  if (!S.anchor) S.anchor = notSunday(today());
  renderBoard(); loadWeek(true); startPolling();
}
window.addEventListener('hashchange', route);
setInterval(() => { if (S.me && currentRoute() === 'board' && !formDlg.open && !detDlg.open) renderBoard(); }, 5 * 60 * 1000);

if (location.pathname.startsWith('/tv/') || location.pathname === '/tv') {
  import('./tv.js').then(m => m.startTv());
} else (async () => {
  try { await loadMe(); } catch { S.me = null; S.programme = S.programme || null; }
  if (!S.programme){ const m = await import('./rules.js'); S.programme = m.DEFAULT_PROGRAMME; S.settings = m.DEFAULT_SETTINGS; }
  route();
})();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
