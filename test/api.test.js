// End-to-end API test. Run against a local dev server with DEV_MODE=1 and ADMIN_EMAILS=admin@test.local:
//   npm run db:migrate:local && npx wrangler dev   (in another terminal)
//   BASE=http://127.0.0.1:8787 npm run test:api
import {test} from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const run = Date.now().toString(36);

class Client {
  constructor(){ this.cookie = ''; }
  async call(path, {method = 'GET', body} = {}){
    const res = await fetch(BASE + path, {method, headers: {...(body ? {'Content-Type': 'application/json'} : {}), ...(this.cookie ? {Cookie: this.cookie} : {})}, body: body ? JSON.stringify(body) : undefined});
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return {status: res.status, data};
  }
  async signIn(email, profile){
    const r1 = await this.call('/api/auth/request', {method: 'POST', body: {email}});
    assert.equal(r1.status, 200, JSON.stringify(r1.data));
    const r2 = await this.call('/api/auth/verify', {method: 'POST', body: {email, code: r1.data.devCode}});
    assert.equal(r2.status, 200, JSON.stringify(r2.data));
    if (r2.data.next === 'profile'){
      const r3 = await this.call('/api/auth/signup', {method: 'POST', body: {signupToken: r2.data.signupToken, privacy: true, ...profile(r2.data.companies)}});
      assert.equal(r3.status, 200, JSON.stringify(r3.data));
    }
    return (await this.call('/api/me')).data.user;
  }
}

const admin = new Client(), sub = new Client(), sub2 = new Client(), stranger = new Client();
// A different Wednesday each run (inside the crane window, no public holidays), so earlier runs' bookings don't clash.
const WEDS = Array.from({length: 30}, (_, k) => new Date(Date.UTC(2027, 3, 7 + 7 * k)).toISOString().slice(0, 10)).filter(d => d !== '2027-08-11');
const date = process.env.TEST_DATE || WEDS[Math.floor(Math.random() * WEDS.length)];
let subCompanyId, adminUser;

test('admin signs up and is active straight away', async () => {
  adminUser = await admin.signIn('admin@test.local', () => ({name: 'Site Admin', phone: '0400 000 000', newCompany: 'BADGE Constructions ' + run}));
  assert.equal(adminUser.role, 'admin');
  assert.equal(adminUser.status, 'active');
  assert.equal(adminUser.companyStatus, 'approved');
});

test('wrong code is refused', async () => {
  const c = new Client();
  await c.call('/api/auth/request', {method: 'POST', body: {email: 'x' + run + '@test.local'}});
  const r = await c.call('/api/auth/verify', {method: 'POST', body: {email: 'x' + run + '@test.local', code: '000000'}});
  assert.equal(r.status, 400);
});

test('new company waits for approval and cannot book', async () => {
  const u = await sub.signIn(`sub${run}@test.local`, () => ({name: 'Sam Sub', phone: '0411 111 111', newCompany: 'Acme Reo ' + run}));
  assert.equal(u.companyStatus, 'pending');
  subCompanyId = u.companyId;
  const r = await sub.call('/api/bookings', {method: 'POST', body: {kind: 'crane', date, start: 7.5, dur: 1, level: 'L1', zoneId: 'S1', details: 'Reo'}});
  assert.equal(r.status, 403);
});

test('signed-out requests are refused', async () => {
  assert.equal((await stranger.call(`/api/bookings?from=${date}&to=${date}`)).status, 401);
  assert.equal((await stranger.call('/api/admin/companies')).status, 401);
});

test('members cannot use site team endpoints', async () => {
  assert.equal((await sub.call('/api/admin/companies')).status, 403);
});

test('admin approves the company, and the member can book', async () => {
  const r = await admin.call('/api/admin/companies/' + subCompanyId, {method: 'POST', body: {status: 'approved'}});
  assert.equal(r.status, 200);
  const me = (await sub.call('/api/me')).data.user;
  assert.equal(me.status, 'active');
  const b = await sub.call('/api/bookings', {method: 'POST', body: {kind: 'crane', date, start: 7.5, dur: 2, level: 'L1', zoneId: 'S1', details: 'Reo bundles', weight: 2, radius: 20}});
  assert.equal(b.status, 200, JSON.stringify(b.data));
});

test('second person joins the approved company straight away', async () => {
  const u = await sub2.signIn(`sub2${run}@test.local`, cos => ({name: 'Pat Two', phone: '0422 222 222', companyId: cos.find(c => c.id === subCompanyId).id}));
  assert.equal(u.status, 'active');
  assert.equal(u.companyStatus, 'approved');
});

test('double booking is impossible, even when requests arrive together', async () => {
  const req = {kind: 'crane', date, start: 8.5, dur: 1, level: 'L1', zoneId: 'S1', details: 'Clash test'};
  const r = await admin.call('/api/bookings', {method: 'POST', body: req});
  assert.equal(r.status, 409);
  assert.match(r.data.error, /taken/);
  // Ten simultaneous attempts at one free slot: exactly one wins.
  const free = {kind: 'crane', date, start: 14.5, dur: 1, level: 'L1', zoneId: 'S1', details: 'Race'};
  const results = await Promise.all(Array.from({length: 10}, (_, i) => (i % 2 ? sub : sub2).call('/api/bookings', {method: 'POST', body: free})));
  assert.equal(results.filter(x => x.status === 200).length, 1);
  assert.equal(results.filter(x => x.status === 409).length, 9);
});

test('delivery with crane clashes with the crane booking', async () => {
  const r = await sub2.call('/api/bookings', {method: 'POST', body: {kind: 'delivery', craneToo: true, date, start: 7.5, dur: 1, level: 'SITE', zoneId: 'LAY', details: 'Formply', vehicle: 'Rigid truck'}});
  assert.equal(r.status, 409);
  const ok = await sub2.call('/api/bookings', {method: 'POST', body: {kind: 'delivery', date, start: 7.5, dur: 1, level: 'SITE', zoneId: 'LAY', details: 'Formply', vehicle: 'Rigid truck'}});
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
});

test('board shows company and contact', async () => {
  const r = await sub2.call(`/api/bookings?from=${date}&to=${date}`);
  assert.equal(r.status, 200);
  const crane = r.data.bookings.find(b => b.details === 'Reo bundles');
  assert.equal(crane.company, 'Acme Reo ' + run);
  assert.equal(crane.contact, 'Sam Sub');
});

test('another company cannot cancel your booking; your colleague can', async () => {
  const other = new Client();
  await other.signIn(`other${run}@test.local`, () => ({name: 'Olly Other', phone: '0433 333 333', newCompany: 'Other Co ' + run}));
  const list = (await sub.call(`/api/bookings?from=${date}&to=${date}`)).data.bookings;
  const mine = list.find(b => b.details === 'Reo bundles');
  const cos = (await admin.call('/api/admin/companies')).data.companies;
  await admin.call('/api/admin/companies/' + cos.find(c => c.name === 'Other Co ' + run).id, {method: 'POST', body: {status: 'approved'}});
  assert.equal((await other.call(`/api/bookings/${mine.id}/cancel`, {method: 'POST', body: {}})).status, 403);
  assert.equal((await sub2.call(`/api/bookings/${mine.id}/cancel`, {method: 'POST', body: {}})).status, 200);
});

test('site team closure cancels overlapping bookings', async () => {
  const b = await sub.call('/api/bookings', {method: 'POST', body: {kind: 'crane', date, start: 9.5, dur: 1, level: 'L1', zoneId: 'S2', details: 'Before wind', weight: 1, radius: 30}});
  assert.equal(b.status, 200, JSON.stringify(b.data));
  const c = await admin.call('/api/bookings', {method: 'POST', body: {kind: 'closure', holdRes: 'crane', date, start: 9.5, dur: 3, level: 'SITE', zoneId: 'LAY', details: 'Wind over the crane limit'}});
  assert.equal(c.status, 200, JSON.stringify(c.data));
  assert.ok(c.data.cancelled >= 1);
  const list = (await sub.call(`/api/bookings?from=${date}&to=${date}`)).data.bookings;
  assert.ok(!list.find(x => x.details === 'Before wind'));
});

test('programme dates and cut-off can be changed by the site team only', async () => {
  const me = (await admin.call('/api/me')).data;
  const programme = {...me.programme, source: 'Test ' + run};
  assert.equal((await sub.call('/api/admin/settings', {method: 'POST', body: {programme}})).status, 403);
  assert.equal((await admin.call('/api/admin/settings', {method: 'POST', body: {programme, general: {cutoff: 15}}})).status, 200);
  assert.equal((await sub.call('/api/me')).data.programme.source, 'Test ' + run);
});

test('CSV export works for the site team', async () => {
  const r = await admin.call(`/api/admin/export?from=${date}&to=${date}`);
  assert.equal(r.status, 200);
  assert.match(r.data, /Date,Start,End/);
  assert.match(r.data, /cancelled/);
});

test('deleting a person removes their details and signs them out', async () => {
  const users = (await admin.call('/api/admin/users')).data.users;
  const pat = users.find(u => u.email === `sub2${run}@test.local`);
  assert.equal((await admin.call('/api/admin/users/' + pat.id, {method: 'POST', body: {delete: true}})).status, 200);
  assert.equal((await sub2.call(`/api/bookings?from=${date}&to=${date}`)).status, 401);
  const after = (await admin.call('/api/admin/users')).data.users;
  assert.ok(!after.find(u => u.email === `sub2${run}@test.local`));
});

test('cross-site posts are refused', async () => {
  const res = await fetch(BASE + '/api/bookings', {method: 'POST', headers: {'Content-Type': 'application/json', Origin: 'https://evil.example', Cookie: admin.cookie}, body: '{}'});
  assert.equal(res.status, 403);
});

test('TV display: off until created, read-only, no phone numbers, switchable', async () => {
  const anon = new Client();
  assert.equal((await anon.call('/api/tv?key=nothing')).status, 403);
  assert.equal((await sub.call('/api/admin/tv')).status, 403);
  const made = await admin.call('/api/admin/tv', {method: 'POST', body: {action: 'create'}});
  assert.equal(made.status, 200);
  assert.ok(made.data.enabled && /\/tv\/[\w-]{20,}$/.test(made.data.url));
  const key = made.data.url.split('/tv/')[1];
  const tv = await anon.call('/api/tv?key=' + encodeURIComponent(key));
  assert.equal(tv.status, 200, JSON.stringify(tv.data));
  assert.equal(tv.data.days.length, 2);
  assert.notEqual(tv.data.days[0], tv.data.days[1]);
  const text = JSON.stringify(tv.data);
  assert.ok(!/0411 111 111|0400 000 000|@test\.local|"phone"|"contact"|"userId"/.test(text), 'TV data must not include contact details');
  assert.equal((await anon.call('/api/tv?key=' + encodeURIComponent(key) + 'x')).status, 403);
  // A new link switches the old one off; switching off stops both.
  const again = await admin.call('/api/admin/tv', {method: 'POST', body: {action: 'create'}});
  assert.equal((await anon.call('/api/tv?key=' + encodeURIComponent(key))).status, 403);
  const key2 = again.data.url.split('/tv/')[1];
  assert.equal((await anon.call('/api/tv?key=' + encodeURIComponent(key2))).status, 200);
  await admin.call('/api/admin/tv', {method: 'POST', body: {action: 'disable'}});
  assert.equal((await anon.call('/api/tv?key=' + encodeURIComponent(key2))).status, 403);
  // The page itself loads at /tv/<key> without signing in.
  const page = await fetch(BASE + '/tv/' + key2);
  assert.equal(page.status, 200);
});
