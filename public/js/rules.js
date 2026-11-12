// Site rules for Opal Carindale bookings.
// Shared by the browser (public/js/app.js) and the Worker (src/worker.js), so both apply the same checks.

export const SITE = {
  name: 'Opal Carindale RACF',
  address: '16 Surbiton Court, Carindale QLD 4152',
  tz: 'Australia/Brisbane'
};

/* Times are decimal hours (6.5 = 6:30am). The board is in half-hours; bookings are whole hours.
   First booking 6:30am, last booking starts 5:30pm (ends 6:30pm). */
export const DAY_START = 6.5, DAY_END = 18.5, LAST_START = 17.5, STEP = 0.5;
export const SLOT_COUNT = (DAY_END - DAY_START) / STEP;
export const CELLS = Array.from({length: SLOT_COUNT}, (_, i) => DAY_START + i * STEP);
export const STARTS = CELLS.filter(t => t <= LAST_START);
export const slotOf = t => Math.round((t - DAY_START) / STEP);

export const RES = {
  crane: {label: 'Tower crane', short: 'crane'},
  delivery: {label: 'Deliveries', short: 'loading zone'},
  hoist: {label: 'Materials hoist', short: 'hoist'},
  pump: {label: 'Concrete boom pump', short: 'boom pump'},
  mobile: {label: 'Mobile crane', short: 'mobile crane'}
};
export const RES_IDS = ['crane', 'delivery', 'hoist', 'pump', 'mobile'];
export const KIND = {crane: 'Crane lift', delivery: 'Delivery', hoist: 'Hoist use', pump: 'Boom pump', mobile: 'Mobile crane', hold: 'Site hold', closure: 'Closed'};
export const MEMBER_KINDS = ['crane', 'delivery', 'hoist', 'pump', 'mobile'];
export const ADMIN_KINDS = ['hold', 'closure'];

export const BREAKS = [{res: 'crane', start: 12.5, end: 13, label: 'Crane driver break'}];

/* Programme calendar, Rev 5f1 IS (10/11/26): Christmas shutdowns and QLD public holidays. Inclusive dates. */
export const SHUTDOWNS = [
  {from: '2026-12-23', to: '2027-01-11', label: 'Christmas shutdown, site closed'},
  {from: '2027-12-24', to: '2028-01-10', label: 'Christmas shutdown, site closed'}
];
export const HOLIDAYS = {
  '2027-01-26': 'Australia Day', '2027-03-26': 'Good Friday', '2027-03-29': 'Easter Monday',
  '2027-04-26': 'Anzac Day (observed)', '2027-05-03': 'Labour Day', '2027-08-11': 'Ekka show day',
  '2027-10-04': "King's Birthday", '2028-01-26': 'Australia Day', '2028-04-14': 'Good Friday',
  '2028-04-17': 'Easter Monday', '2028-04-25': 'Anzac Day', '2028-05-01': 'Labour Day', '2028-08-16': 'Ekka show day'
};

/* Comedil CTL260-18 load chart (Boland). Capacity is read at the next chart radius out (conservative). */
export const CHART = [[15, 15.5], [20, 13.5], [25, 10.45], [30, 8.14], [35, 6.5], [40, 5.26], [45, 4.3], [50, 3.53], [55, 2.9]];
export function capAt(r){
  r = Number(r);
  if (!(r >= 5 && r <= 55)) return null;
  for (const [R, t] of CHART) if (r <= R) return t;
  return null;
}
/* Returns {ok, level: 'ok'|'near'|'over'|'reach'|'none', cap, msg}. */
export function craneCheck(weight, radius){
  if (weight == null || weight === '' || radius == null || radius === '') return {ok: true, level: 'none', cap: null, msg: 'Enter the heaviest piece and lift radius to check them against the load chart.'};
  const w = Number(weight), r = Number(radius), cap = capAt(r);
  if (cap == null) return {ok: false, level: 'reach', cap: null, msg: 'The crane works between 5 m and 55 m radius. Check the lift radius.'};
  if (w > cap) return {ok: false, level: 'over', cap, msg: `Over the load chart: ${w} t at ${r} m, but the chart allows ${cap} t. Talk to the crane crew before booking.`};
  if (w > cap * 0.9) return {ok: true, level: 'near', cap, msg: `Close to the limit: ${w} t of ${cap} t chart capacity at ${r} m. Allow for rigging and confirm with the crane crew.`};
  return {ok: true, level: 'ok', cap, msg: `Within the load chart: ${cap} t at ${r} m. Allow for rigging. The crane crew confirms every lift.`};
}

/* Pour zones per Construction Methodology Rev 5c / slab sequence Rev 1a. */
const TYP = [
  {id: 'S1', name: 'Slab 1', tag: 'NE wing', desc: 'NE wing', area: '775 m²', note: 'Short crane radius (15 to 25 m), high capacity.', pumpNote: 'Pours first on each level.'},
  {id: 'S2', name: 'Slab 2', tag: 'NW corner', desc: 'NW corner', area: '600 m²', radius: 50, note: 'Long crane radius (35 to 45 m and beyond), the lowest capacity on the floor: 4.3 t at 45 m, 3.53 t at 50 m. Check the heaviest piece first.', longRadius: true, pumpNote: 'Longest pump run: 47 m to the L6 Slab 2 corner, confirmed by Meales and peer-reviewed, with a line attachment at L6.'},
  {id: 'S3', name: 'Slab 3', tag: 'Central', desc: 'Central / south', area: '740 m²', note: 'Medium crane radius (20 to 35 m).', pumpNote: 'Confirm the reach to the far edge with Meales.'}
];
const GF_NOTE = 'Bays with the same stage number pour on the same day, and the next stage follows straight on with no wait for curing.';
export const LEVELS = [
  {id: 'SITE', label: 'Site / laydown', zones: [{id: 'LAY', name: 'Laydown / general', desc: 'Not tied to a pour zone'}]},
  {id: 'GF', label: 'Ground floor', zones: [
    {id: 'G1', name: 'Stage 1', desc: 'North-central waffle & NE wing', area: '783 m²', note: GF_NOTE},
    {id: 'G2', name: 'Stage 2', desc: 'NW, west, core / lift & SW bays', area: '877 m²', note: GF_NOTE},
    {id: 'G3', name: 'Stage 3', desc: 'West-mid, south-centre, central-east', area: '707 m²', note: GF_NOTE},
    {id: 'G4', name: 'Stage 4', desc: 'Central infill, NE tip, SE strips', area: '361 m²', note: GF_NOTE},
    {id: 'G5', name: 'Stage 5', desc: 'NE wing ends, SE edge pieces', area: '144 m²', note: GF_NOTE},
    {id: 'GP2', name: 'Slab 5 Part 2', desc: 'SE strip, after the scaffold bottom lift is struck', area: '840 m²'}]},
  {id: 'L1', label: 'Level 1', zones: [
    {id: 'S1', name: 'Slab 1', tag: 'NE wing', desc: 'NE wing, transfer slab', area: '900 m²', note: 'Mostly 15 to 25 m crane radius.'},
    {id: 'S2', name: 'Slab 2', tag: 'North', desc: 'North, transfer slab', area: '690 m²', note: 'Crane radius out to about 35 m.'},
    {id: 'S3', name: 'Slab 3', tag: 'West', desc: 'West, transfer slab', area: '660 m²', note: 'Crane radius out to about 35 m. The deck follows the Energex HV works in Carindale St.'},
    {id: 'S4', name: 'Slab 4', tag: 'SW', desc: 'South-west, transfer slab', area: '850 m²', note: 'Furthest L1 zone from the crane. Check piece weights against the chart before booking lifts.', longRadius: true}]},
  {id: 'L2', label: 'Level 2', zones: TYP},
  {id: 'L3', label: 'Level 3', zones: TYP},
  {id: 'L4', label: 'Level 4', zones: TYP},
  {id: 'L5', label: 'Level 5', zones: TYP},
  {id: 'L6', label: 'Level 6', zones: TYP},
  {id: 'RF', label: 'Roof (L7)', zones: [
    {id: 'RF', name: 'Plant roof', desc: 'Concrete, single pour', area: '520 m²'},
    {id: 'MR1', name: 'Metal roof 1', desc: 'NE, steel from 15 Sep 27', area: '830 m²'},
    {id: 'MR2', name: 'Metal roof 2', desc: 'NW, steel from 5 Nov 27', area: '400 m²'},
    {id: 'MR3', name: 'Metal roof 3', desc: 'South, steel from 5 Nov 27', area: '320 m²'}]}
];
export const POUR_LEVELS = ['GF', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'RF'];
export const levelOf = id => LEVELS.find(l => l.id === id);
export const zoneOf = (lv, z) => { const l = levelOf(lv); return l ? l.zones.find(x => x.id === z) : null; };
export function zoneShort(lv, z){
  const l = levelOf(lv), zz = zoneOf(lv, z);
  if (!l || !zz) return '';
  if (lv === 'SITE') return l.label;
  if (lv === 'RF') return 'L7 ' + zz.name;
  return lv + ' ' + zz.name + (zz.tag ? ' ' + zz.tag : '');
}
export function zoneLong(lv, z){
  const l = levelOf(lv), zz = zoneOf(lv, z);
  if (!l || !zz) return '';
  return l.label + ', ' + zz.name + (zz.desc ? ' (' + zz.desc + ')' : '');
}

/* Starting programme: Opal_Carindale_Programme_Rev5f1_IS_10-11-26.xml. Admins can change it in the app. */
export const DEFAULT_PROGRAMME = {
  source: 'Programme Rev 5f1 IS (10/11/26)',
  craneFrom: '2026-12-12', craneTo: '2028-03-27',
  hoistFrom: '2027-06-24', hoistTo: '2028-03-27',
  pours: {
    'GF:G1': '2026-12-22', 'GF:G2': '2027-01-28', 'GF:G3': '2027-02-08', 'GF:G4': '2027-02-12', 'GF:G5': '2027-02-17', 'GF:GP2': '2028-03-15',
    'L1:S1': '2027-03-22', 'L1:S2': '2027-03-11', 'L1:S3': '2027-04-23', 'L1:S4': '2027-05-12',
    'L2:S1': '2027-04-23', 'L2:S2': '2027-06-03', 'L2:S3': '2027-06-16',
    'L3:S1': '2027-06-01', 'L3:S2': '2027-07-08', 'L3:S3': '2027-07-21',
    'L4:S1': '2027-07-02', 'L4:S2': '2027-08-16', 'L4:S3': '2027-08-26',
    'L5:S1': '2027-08-06', 'L5:S2': '2027-09-16', 'L5:S3': '2027-09-29',
    'L6:S1': '2027-09-10', 'L6:S2': '2027-10-27', 'L6:S3': '2027-11-04',
    'RF:RF': '2027-11-29'
  }
};
export const DEFAULT_SETTINGS = {cutoff: 15}; // bookings close at 3pm the day before

/* ---------- dates ---------- */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isDate = s => typeof s === 'string' && DATE_RE.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));
export const weekday = s => new Date(s + 'T00:00:00Z').getUTCDay(); // 0 = Sunday
export function addDays(s, n){ const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
/* Brisbane has no daylight saving: UTC+10 all year. */
export function brisbaneNow(ms = Date.now()){
  const d = new Date(ms + 10 * 3600e3);
  return {date: d.toISOString().slice(0, 10), hour: d.getUTCHours() + d.getUTCMinutes() / 60};
}
export const pad = n => String(n).padStart(2, '0');
export function hourLabel(t){ const h = Math.floor(t), m = Math.round((t - h) * 60); return (h % 12 || 12) + ':' + pad(m) + (h < 12 || h === 24 ? 'am' : 'pm'); }
export const span = (s, e) => hourLabel(s) + '–' + hourLabel(e);
export function fmtD(s){ const [y, m, d] = s.split('-'); return Number(d) + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(m) - 1] + ' ' + y.slice(2); }

export function poursOn(date, programme){
  const p = (programme && programme.pours) || {};
  return Object.keys(p).filter(k => p[k] === date).map(k => k.split(':')).filter(x => zoneOf(x[0], x[1]));
}
export const pourLabel = (date, programme) => poursOn(date, programme).map(p => zoneShort(p[0], p[1])).join(' + ');

/* Fixed blocks on a resource-day: shutdowns, public holidays, crane/hoist not on site, driver break. */
export function blocksFor(res, date, programme){
  const full = details => [{id: 'full', kind: 'break', full: true, start: DAY_START, end: DAY_END, details}];
  if (weekday(date) === 0) return full('Sunday, site closed');
  const sd = SHUTDOWNS.find(x => date >= x.from && date <= x.to);
  if (sd) return full(sd.label);
  if (HOLIDAYS[date]) return full('Public holiday (' + HOLIDAYS[date] + '), site closed');
  const P = programme || DEFAULT_PROGRAMME;
  if (res === 'crane' && P.craneFrom && date < P.craneFrom) return full('Tower crane not commissioned until ' + fmtD(P.craneFrom));
  if (res === 'crane' && P.craneTo && date > P.craneTo) return full('Tower crane dismantled (last day ' + fmtD(P.craneTo) + ')');
  if (res === 'hoist' && P.hoistFrom && date < P.hoistFrom) return full('Hoist not commissioned until ' + fmtD(P.hoistFrom));
  if (res === 'hoist' && P.hoistTo && date > P.hoistTo) return full('Hoist removed (last day ' + fmtD(P.hoistTo) + ')');
  return BREAKS.filter(b => b.res === res).map(b => ({id: 'break-' + b.start, kind: 'break', start: b.start, end: b.end, details: b.label}));
}
export function blockMsg(x){
  return x.full ? x.details + '. Pick another day.' : 'The ' + x.details.toLowerCase() + ' is ' + span(x.start, x.end) + '. Finish by ' + hourLabel(x.start) + ' or start from ' + hourLabel(x.end) + '.';
}

export function resourcesFor(b){
  if (b.kind === 'delivery') return ['delivery'].concat(b.craneToo ? ['crane'] : [], b.hoistToo ? ['hoist'] : []);
  if (b.kind === 'hold' || b.kind === 'closure') return b.holdRes === 'all' ? RES_IDS.slice() : [b.holdRes];
  return [b.kind];
}

/* Booking cut-off: a booking for day D must be made before the cut-off hour on day D-1 (Brisbane time). */
export function cutoffPassed(date, now, cutoff){
  if (date <= now.date) return true;
  if (date === addDays(now.date, 1) && now.hour >= cutoff) return true;
  return false;
}

const num = (v, lo, hi) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : NaN;
};
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/* Validates and normalises a booking request. Clashes with other bookings are checked by the database.
   ctx = {programme, settings, now: brisbaneNow(), isAdmin}. Returns {ok, error?, booking?}. */
export function validateBooking(input, ctx){
  const fail = error => ({ok: false, error});
  const i = input || {};
  const kind = i.kind;
  if (!MEMBER_KINDS.includes(kind) && !(ctx.isAdmin && ADMIN_KINDS.includes(kind))) return fail('Pick what you are booking.');
  if (!isDate(i.date)) return fail('Pick a date.');
  const start = Number(i.start), dur = Number(i.dur);
  if (!STARTS.includes(start)) return fail('Pick a start time between 6:30am and 5:30pm.');
  if (!Number.isInteger(dur) || dur < 1 || start + dur > DAY_END) return fail('Pick how many hours (the day ends at 6:30pm).');
  const end = start + dur;
  if (weekday(i.date) === 0) return fail('The site is closed on Sundays. Pick another day.');
  const now = ctx.now;
  if (i.date < now.date || (i.date === now.date && start + STEP <= now.hour)) return fail('That time has already passed. Pick a later start.');
  if (!ctx.isAdmin && cutoffPassed(i.date, now, ctx.settings.cutoff)) {
    return fail(`Bookings close at ${hourLabel(ctx.settings.cutoff)} the day before. Call the site team for anything sooner.`);
  }
  const level = i.level, zoneId = i.zoneId, z = zoneOf(level, zoneId);
  if (!z) return fail('Pick a level and pour zone.');
  const holdRes = (kind === 'hold' || kind === 'closure') ? (i.holdRes === 'all' || RES_IDS.includes(i.holdRes) ? i.holdRes : null) : null;
  if ((kind === 'hold' || kind === 'closure') && !holdRes) return fail('Pick what the hold applies to.');
  const details = str(i.details, 400);
  if (!details) return fail(kind === 'closure' ? 'Give the reason for closing (it goes in the email to affected bookers).' : kind === 'hold' ? 'Give the reason for the hold.' : 'Add a short description of the ' + (kind === 'crane' || kind === 'mobile' ? 'lift.' : kind === 'hoist' ? 'hoist load.' : kind === 'pump' ? 'pour.' : 'delivery.'));
  const b = {
    kind, date: i.date, start, end, level, zoneId, details, holdRes,
    craneToo: kind === 'delivery' && !!i.craneToo, hoistToo: kind === 'delivery' && !!i.hoistToo,
    weight: kind === 'crane' ? num(i.weight, 0, 50) : null,
    radius: kind === 'crane' ? num(i.radius, 0, 60) : null,
    vehicle: kind === 'delivery' ? str(i.vehicle, 40) : '',
    load: kind === 'hoist' ? num(i.load, 0, 5000) : null,
    volume: kind === 'pump' ? num(i.volume, 0, 1000) : null,
    pumpSetup: kind === 'pump' ? str(i.pumpSetup, 60) : '',
    mcSize: kind === 'mobile' ? num(i.mcSize, 0, 1000) : null,
    mcWeight: kind === 'mobile' ? num(i.mcWeight, 0, 200) : null,
    mcSetup: kind === 'mobile' ? str(i.mcSetup, 60) : ''
  };
  for (const k of ['weight', 'radius', 'load', 'volume', 'mcSize', 'mcWeight']) if (Number.isNaN(b[k])) return fail('Check the numbers on the form.');
  if (kind === 'crane'){
    const cc = craneCheck(b.weight, b.radius);
    if (!cc.ok) return fail(cc.msg);
  }
  b.resources = resourcesFor(b);
  for (const r of b.resources){
    for (const x of blocksFor(r, b.date, ctx.programme)){
      if (x.start < end && start < x.end){
        if (x.full) return fail(RES[r].label + ': ' + x.details + '. Pick another day.');
        if (kind !== 'hold' && kind !== 'closure') return fail(blockMsg(x));
      }
    }
  }
  return {ok: true, booking: b};
}
