// TV display: read-only wall screen for the site office. Opened from a private link (/tv/<key>), no sign-in.
// Shows today and the next booking day side by side, refreshes every 20 seconds, never shows phone numbers.
import {DAY_START, DAY_END, STEP, CELLS, RES, RES_IDS, blocksFor, pourLabel, zoneShort, hourLabel, span, addDays, brisbaneNow} from './rules.js';

const RES_CLS = {crane: 'crane', delivery: 'deliv', hoist: 'hoist', pump: 'pump', mobile: 'mobile'};
const SHORT = {crane: 'Tower crane', delivery: 'Deliveries', hoist: 'Hoist', pump: 'Boom pump', mobile: 'Mobile crane'};
const key = decodeURIComponent(location.pathname.split('/')[2] || '');
const view = document.getElementById('view');
let data = null, lastOk = null, failed = false;

function el(tag, cls, text){ const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
const rowOf = t => Math.round((t - DAY_START) / STEP) + 1;
const longDate = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-AU', {timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long'});
const clock = () => new Date().toLocaleTimeString('en-AU', {timeZone: 'Australia/Brisbane', hour: 'numeric', minute: '2-digit'});
const weekdayName = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-AU', {timeZone: 'UTC', weekday: 'long'});
const dayMonth = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-AU', {timeZone: 'UTC', day: 'numeric', month: 'long'});
function dayLabel(d, now){ return d === now.date ? 'Today' : d === addDays(now.date, 1) ? 'Tomorrow' : weekdayName(d); }

function render(){
  view.textContent = '';
  const wrap = el('div', 'tv-wrap');
  const top = el('div', 'tv-top');
  const logo = el('img', 'tv-logo'); logo.src = '/img/badge-logo.png'; logo.alt = 'BADGE';
  const title = el('div', 'tv-title');
  title.append(el('div', 'tv-h', 'Crane & Delivery Bookings'), el('div', 'tv-sub', 'Opal Carindale RACF · Live board'));
  const right = el('div', 'tv-right');
  right.append(el('div', 'tv-clock', clock()));
  const status = el('div', 'tv-status' + (failed ? ' bad' : ''), failed
    ? 'Connection lost. Showing bookings from ' + (lastOk ? lastOk.toLocaleTimeString('en-AU', {timeZone: 'Australia/Brisbane', hour: 'numeric', minute: '2-digit'}) : 'earlier') + '.'
    : 'Updated ' + (lastOk ? lastOk.toLocaleTimeString('en-AU', {timeZone: 'Australia/Brisbane', hour: 'numeric', minute: '2-digit', second: '2-digit'}) : ''));
  right.append(status);
  top.append(logo, title, right);
  wrap.append(top);

  const days = el('div', 'tv-days');
  const now = brisbaneNow();
  for (const d of data.days) days.append(dayPanel(d, now));
  wrap.append(days);
  const legend = el('div', 'tv-legend');
  for (const r of RES_IDS){ const k = el('span', 'tv-key'); const sw = el('i'); sw.style.background = 'var(--' + RES_CLS[r] + ')'; k.append(sw, RES[r].label); legend.append(k); }
  legend.append(el('span', 'tv-src', 'Book at ' + location.host + ' · Bookings close ' + hourLabel(data.cutoff ?? 15).replace(':00', '') + ' the day before'));
  wrap.append(legend);
  view.append(wrap);
}

function dayPanel(date, now){
  const panel = el('section', 'tv-day' + (date === now.date ? ' is-today' : ''));
  const head = el('div', 'tv-dayhead');
  const label = dayLabel(date, now);
  head.append(el('span', 'tv-when', label), el('span', 'tv-date', label === weekdayName(date) ? dayMonth(date) : longDate(date)));
  const pl = pourLabel(date, data.programme);
  if (pl) head.append(el('span', 'tv-pour', 'Pour: ' + pl));
  panel.append(head);

  const grid = el('div', 'tv-grid');
  grid.style.setProperty('--rows', CELLS.length);
  grid.append(el('div', 'tv-corner'));
  for (const r of RES_IDS){ const h = el('div', 'tv-colhead'); const sw = el('i'); sw.style.background = 'var(--' + RES_CLS[r] + ')'; h.append(sw, SHORT[r]); grid.append(h); }
  const gutter = el('div', 'tv-gutter');
  CELLS.forEach((t, i) => gutter.append(el('div', null, i % 2 ? '' : hourLabel(t).replace(':00', ''))));
  grid.append(gutter);
  for (const r of RES_IDS){
    const col = el('div', 'tv-col');
    for (const b of blocksFor(r, date, data.programme)){
      const x = el('div', b.full ? 'tv-bk off' : 'tv-bk brk', b.full ? b.details : 'Driver break');
      x.style.gridRow = rowOf(b.start) + ' / ' + rowOf(b.end);
      col.append(x);
    }
    for (const b of data.bookings.filter(x => x.date === date && x.resources.includes(r))){
      const admin = b.kind === 'hold' || b.kind === 'closure';
      const x = el('div', 'tv-bk ' + (admin ? 'hold' : RES_CLS[r]) + (date === now.date && b.end <= now.hour ? ' past' : ''));
      x.style.gridRow = rowOf(b.start) + ' / ' + rowOf(b.end);
      if (b.end - b.start <= 1) x.classList.add('short');
      x.append(el('span', 'tv-t', span(b.start, b.end)));
      x.append(el('span', 'tv-c', admin ? (b.kind === 'hold' ? 'Site hold' : 'Closed') : b.company));
      const what = [zoneShort(b.level, b.zoneId), b.details].filter(Boolean).join(' · ');
      if (what) x.append(el('span', 'tv-d', what));
      col.append(x);
    }
    if (date === now.date && now.hour >= DAY_START && now.hour <= DAY_END){
      const line = el('div', 'tv-now');
      line.style.top = ((now.hour - DAY_START) / (DAY_END - DAY_START) * 100).toFixed(2) + '%';
      col.append(line);
    }
    grid.append(col);
  }
  panel.append(grid);
  return panel;
}

function message(title, text){
  view.textContent = '';
  const box = el('div', 'tv-msg');
  const logo = el('img', 'tv-logo'); logo.src = '/img/badge-logo.png'; logo.alt = 'BADGE';
  box.append(logo, el('h2', null, title), el('p', null, text));
  view.append(box);
}

async function load(){
  try {
    const res = await fetch('/api/tv?key=' + encodeURIComponent(key), {cache: 'no-store'});
    const body = await res.json().catch(() => ({}));
    if (res.status === 403){ data = null; message('Display switched off', body.error || 'Ask the site team for the new display link.'); return; }
    if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
    data = body; lastOk = new Date(); failed = false;
  } catch {
    failed = true;
  }
  if (data) render(); else if (failed) message('Connecting…', 'Waiting for the site network.');
}

export function startTv(){
  document.body.classList.add('tv');
  document.title = 'Opal Carindale — Live bookings';
  if (!key){ message('Display link missing', 'Open the full display link from Site team › Settings.'); return; }
  load();
  setInterval(load, 20000);
  setInterval(() => { if (data) render(); }, 30000); // keeps the clock and the "now" line moving
  setTimeout(() => location.reload(), 6 * 3600e3); // picks up app updates
}
