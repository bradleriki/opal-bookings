import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateBooking, capAt, craneCheck, blocksFor, cutoffPassed, DEFAULT_PROGRAMME, DEFAULT_SETTINGS, resourcesFor, brisbaneNow} from '../public/js/rules.js';

const ctx = (over = {}) => ({programme: DEFAULT_PROGRAMME, settings: DEFAULT_SETTINGS, now: {date: '2027-03-01', hour: 9}, isAdmin: false, ...over});
const base = {kind: 'crane', date: '2027-03-03', start: 7.5, dur: 2, level: 'L1', zoneId: 'S1', details: 'Reo bundles', weight: 2, radius: 20};

test('load chart reads the next radius out', () => {
  assert.equal(capAt(20), 13.5);
  assert.equal(capAt(21), 10.45);
  assert.equal(capAt(50), 3.53);
  assert.equal(capAt(56), null);
  assert.equal(capAt(4), null);
  assert.equal(craneCheck(4, 50).level, 'over');
  assert.equal(craneCheck(3.3, 50).level, 'near');
  assert.equal(craneCheck(2, 50).level, 'ok');
});

test('valid crane booking passes and gets its resources', () => {
  const r = validateBooking(base, ctx());
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.booking.resources, ['crane']);
  assert.equal(r.booking.end, 9.5);
});

test('over the load chart is refused', () => {
  const r = validateBooking({...base, weight: 4, radius: 50}, ctx());
  assert.equal(r.ok, false);
  assert.match(r.error, /Over the load chart/);
});

test('crane driver break blocks a crane booking but not a site hold', () => {
  assert.equal(validateBooking({...base, start: 12, dur: 1}, ctx()).ok, false);
  assert.equal(validateBooking({...base, kind: 'hold', holdRes: 'crane', start: 12, dur: 1}, ctx({isAdmin: true})).ok, true);
});

test('Sundays, shutdowns, public holidays and crane window are closed', () => {
  assert.match(validateBooking({...base, date: '2027-03-07'}, ctx()).error, /Sunday/);
  assert.match(validateBooking({...base, date: '2027-01-05'}, ctx({now: {date: '2026-12-01', hour: 9}})).error, /shutdown/);
  assert.match(validateBooking({...base, date: '2027-03-26'}, ctx()).error, /Good Friday/);
  assert.match(validateBooking({...base, date: '2026-12-10'}, ctx({now: {date: '2026-12-01', hour: 9}})).error, /not commissioned/);
  assert.match(validateBooking({...base, kind: 'hoist', date: '2027-03-03'}, ctx()).error, /Hoist not commissioned/);
});

test('booking cut-off is 3pm the day before, admins exempt', () => {
  assert.equal(cutoffPassed('2027-03-02', {date: '2027-03-01', hour: 14.9}, 15), false);
  assert.equal(cutoffPassed('2027-03-02', {date: '2027-03-01', hour: 15}, 15), true);
  assert.equal(cutoffPassed('2027-03-01', {date: '2027-03-01', hour: 6}, 15), true);
  assert.match(validateBooking({...base, date: '2027-03-02'}, ctx({now: {date: '2027-03-01', hour: 16}})).error, /close at 3:00pm/);
  assert.equal(validateBooking({...base, date: '2027-03-02'}, ctx({now: {date: '2027-03-01', hour: 16}, isAdmin: true})).ok, true);
});

test('members cannot make holds or closures', () => {
  assert.equal(validateBooking({...base, kind: 'hold', holdRes: 'crane'}, ctx()).ok, false);
  assert.equal(validateBooking({...base, kind: 'closure', holdRes: 'all'}, ctx()).ok, false);
});

test('delivery with crane and hoist books all three', () => {
  assert.deepEqual(resourcesFor({kind: 'delivery', craneToo: true, hoistToo: true}), ['delivery', 'crane', 'hoist']);
  const r = validateBooking({...base, kind: 'delivery', craneToo: true, hoistToo: true, date: '2027-07-01'}, ctx({now: {date: '2027-06-28', hour: 9}}));
  assert.equal(r.ok, true, r.error);
});

test('bad inputs are refused', () => {
  assert.equal(validateBooking({...base, start: 18}, ctx()).ok, false);
  assert.equal(validateBooking({...base, dur: 13}, ctx()).ok, false);
  assert.equal(validateBooking({...base, zoneId: 'S9'}, ctx()).ok, false);
  assert.equal(validateBooking({...base, details: '  '}, ctx()).ok, false);
  assert.equal(validateBooking({...base, weight: 'x'}, ctx()).ok, false);
});

test('Brisbane time is UTC+10', () => {
  const n = brisbaneNow(Date.UTC(2027, 2, 1, 14, 30));
  assert.equal(n.date, '2027-03-02');
  assert.equal(n.hour, 0.5);
});

test('blocks list the driver break on a normal crane day', () => {
  const b = blocksFor('crane', '2027-03-03', DEFAULT_PROGRAMME);
  assert.equal(b.length, 1);
  assert.equal(b[0].start, 12.5);
});
