// Opal Carindale site bookings: API Worker. Static files in /public are served by Workers Assets;
// requests to /api/* come here first.
import {
  RES, KIND, DEFAULT_PROGRAMME, DEFAULT_SETTINGS, LEVELS, POUR_LEVELS, zoneOf, zoneLong, zoneShort,
  validateBooking, brisbaneNow, slotOf, span, fmtD, isDate, addDays, STEP, hourLabel
} from '../public/js/rules.js';
import {sendEmail} from './email.js';

const CODE_TTL = 10 * 60e3, SESSION_TTL = 30 * 24 * 3600e3, SIGNUP_TTL = 30 * 60e3;
const COOKIE = 'ob_sess';

/* ---------- helpers ---------- */
class HttpError extends Error { constructor(status, message){ super(message); this.status = status; } }
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers}});
const nowIso = () => new Date().toISOString();
const uid = (p = '') => p + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
const normEmail = e => (typeof e === 'string' ? e.trim().toLowerCase() : '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

async function sha256(s){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function randomToken(){ const a = new Uint8Array(32); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/[+/=]/g, c => ({'+': '-', '/': '_', '=': ''}[c])); }
function randomCode(){ const a = new Uint32Array(1); crypto.getRandomValues(a); return String(a[0] % 1000000).padStart(6, '0'); }
function getCookie(req, name){
  const c = req.headers.get('Cookie') || '';
  for (const part of c.split(/;\s*/)){ const i = part.indexOf('='); if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1)); }
  return null;
}
const sessionCookie = (token, maxAgeS) => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeS}`;
async function body(req){ try { return await req.json(); } catch { throw new HttpError(400, 'Bad request.'); } }
const adminEmails = env => (env.ADMIN_EMAILS || '').split(',').map(normEmail).filter(Boolean);
const isDev = env => env.DEV_MODE === '1';

async function audit(env, userId, action, detail){
  await env.DB.prepare('INSERT INTO audit (at, user_id, action, detail) VALUES (?, ?, ?, ?)').bind(nowIso(), userId || null, action, JSON.stringify(detail || {})).run();
}
async function getSetting(env, key, fallback){
  const r = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  if (!r) return fallback;
  try { return {...fallback, ...JSON.parse(r.value)}; } catch { return fallback; }
}
const getProgramme = env => getSetting(env, 'programme', DEFAULT_PROGRAMME);
const getSettings = env => getSetting(env, 'general', DEFAULT_SETTINGS);

/* ---------- auth ---------- */
async function currentUser(req, env){
  const token = getCookie(req, COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.*, c.name AS company_name, c.status AS company_status FROM sessions s
     JOIN users u ON u.id = s.user_id JOIN companies c ON c.id = u.company_id
     WHERE s.token_hash = ? AND s.expires_at > ?`).bind(await sha256(token), Date.now()).first();
  if (!row || row.status === 'deleted' || row.status === 'disabled') return null;
  return row;
}
function publicUser(u){
  if (!u) return null;
  return {id: u.id, email: u.email, name: u.name, phone: u.phone, role: u.role, status: u.status, companyId: u.company_id, companyName: u.company_name, companyStatus: u.company_status};
}
const isActive = u => u && u.status === 'active' && u.company_status === 'approved';
function requireActive(u){ if (!u) throw new HttpError(401, 'Please sign in.'); if (!isActive(u)) throw new HttpError(403, 'Your account is waiting for site team approval.'); }
function requireAdmin(u){ requireActive(u); if (u.role !== 'admin') throw new HttpError(403, 'Site team only.'); }

async function startSession(env, userId){
  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').bind(await sha256(token), userId, Date.now() + SESSION_TTL, Date.now()),
    env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(nowIso(), userId),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now())
  ]);
  return sessionCookie(token, SESSION_TTL / 1000);
}

async function authRequest(req, env){
  const {email: raw} = await body(req);
  const email = normEmail(raw);
  if (!EMAIL_RE.test(email) || email.length > 200) throw new HttpError(400, 'Enter a valid email address.');
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_codes WHERE email = ? AND created_at > ?').bind(email, Date.now() - 3600e3).first();
  if (recent.n >= 5) throw new HttpError(429, 'Too many codes requested. Wait an hour, or use the last code you were sent.');
  const code = randomCode();
  await env.DB.prepare('INSERT INTO login_codes (id, email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(uid('c_'), email, await sha256(email + ':' + code), Date.now() + CODE_TTL, Date.now()).run();
  const sent = await sendEmail(env, email, 'Your Opal Carindale sign-in code: ' + code, [
    'Your sign-in code for the Opal Carindale site bookings app is:', code, '',
    'It expires in 10 minutes. If you did not ask for it, ignore this email.'
  ]);
  if (!sent.ok) throw new HttpError(502, 'The code email could not be sent. Try again in a minute.');
  return json({ok: true, ...(isDev(env) ? {devCode: code} : {})});
}

async function authVerify(req, env){
  const b = await body(req);
  const email = normEmail(b.email), code = String(b.code || '').trim();
  const row = await env.DB.prepare('SELECT * FROM login_codes WHERE email = ? AND used = 0 AND expires_at > ? ORDER BY created_at DESC LIMIT 1').bind(email, Date.now()).first();
  if (!row) throw new HttpError(400, 'That code has expired. Ask for a new one.');
  if (row.attempts >= 5) throw new HttpError(429, 'Too many wrong tries. Ask for a new code.');
  if (row.code_hash !== await sha256(email + ':' + code)){
    await env.DB.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?').bind(row.id).run();
    throw new HttpError(400, 'That code is not right. Check the email and try again.');
  }
  await env.DB.prepare('UPDATE login_codes SET used = 1 WHERE id = ?').bind(row.id).run();
  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  if (user && user.status !== 'deleted'){
    if (user.status === 'disabled') throw new HttpError(403, 'This account has been switched off. Contact the site team.');
    if (adminEmails(env).includes(email) && user.role !== 'admin') await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(user.id).run();
    return json({ok: true, next: 'in'}, 200, {'Set-Cookie': await startSession(env, user.id)});
  }
  const token = randomToken();
  await env.DB.prepare('INSERT INTO signup_tokens (token_hash, email, expires_at) VALUES (?, ?, ?)').bind(await sha256(token), email, Date.now() + SIGNUP_TTL).run();
  const companies = (await env.DB.prepare("SELECT id, name FROM companies WHERE status = 'approved' ORDER BY name").all()).results;
  return json({ok: true, next: 'profile', signupToken: token, companies});
}

async function authSignup(req, env){
  const b = await body(req);
  const tok = await env.DB.prepare('SELECT * FROM signup_tokens WHERE token_hash = ? AND expires_at > ?').bind(await sha256(String(b.signupToken || '')), Date.now()).first();
  if (!tok) throw new HttpError(400, 'Your sign-up has timed out. Start again with your email.');
  const email = tok.email;
  const name = clean(b.name, 80), phone = clean(b.phone, 30);
  if (!name) throw new HttpError(400, 'Enter your name.');
  if (!/^[+\d][\d\s()-]{7,}$/.test(phone)) throw new HttpError(400, 'Enter a mobile number the site team can call.');
  if (b.privacy !== true) throw new HttpError(400, 'Tick the box to accept the privacy note.');
  const isAdmin = adminEmails(env).includes(email);
  let company;
  if (b.companyId){
    company = await env.DB.prepare("SELECT * FROM companies WHERE id = ? AND status = 'approved'").bind(String(b.companyId)).first();
    if (!company) throw new HttpError(400, 'Pick your company from the list, or add it as a new company.');
  } else {
    const cname = clean(b.newCompany, 80);
    if (cname.length < 2) throw new HttpError(400, 'Enter your company name.');
    const key = cname.toLowerCase();
    company = await env.DB.prepare('SELECT * FROM companies WHERE name_key = ?').bind(key).first();
    if (company && company.status === 'rejected') throw new HttpError(403, 'That company is not set up for bookings on this site. Contact the site team.');
    if (!company){
      company = {id: uid('co_'), name: cname, status: isAdmin ? 'approved' : 'pending'};
      await env.DB.prepare('INSERT INTO companies (id, name, name_key, status, created_at) VALUES (?, ?, ?, ?, ?)').bind(company.id, cname, key, company.status, nowIso()).run();
    }
    if (isAdmin && company.status !== 'approved'){
      await env.DB.prepare("UPDATE companies SET status = 'approved', decided_at = ? WHERE id = ?").bind(nowIso(), company.id).run();
      company.status = 'approved';
    }
  }
  const status = company.status === 'approved' || isAdmin ? 'active' : 'pending';
  const user = {id: uid('u_'), email, name, phone};
  await env.DB.batch([
    env.DB.prepare('INSERT INTO users (id, email, name, phone, company_id, role, status, privacy_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(user.id, email, name, phone, company.id, isAdmin ? 'admin' : 'member', status, nowIso(), nowIso()),
    env.DB.prepare('DELETE FROM signup_tokens WHERE token_hash = ?').bind(tok.token_hash)
  ]);
  await audit(env, user.id, 'signup', {company: company.name, companyStatus: company.status});
  // Tell the site team.
  const admins = (await env.DB.prepare("SELECT email FROM users WHERE role = 'admin' AND status = 'active' AND id != ?").bind(user.id).all()).results.map(r => r.email);
  if (admins.length){
    const pending = company.status !== 'approved';
    await sendEmail(env, admins, pending ? `New company waiting for approval: ${company.name}` : `New user: ${name} (${company.name})`, [
      `${name} (${email}, ${phone}) has signed up to the Opal Carindale bookings app for ${company.name}.`,
      pending ? 'This is a new company. Approve or reject it in the app under Site team › Companies.' : 'Their company is already approved, so they can book now. You can switch them off under Site team › People.'
    ]);
  }
  return json({ok: true}, 200, {'Set-Cookie': await startSession(env, user.id)});
}

async function logout(req, env){
  const token = getCookie(req, COOKIE);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return json({ok: true}, 200, {'Set-Cookie': sessionCookie('', 0)});
}

/* ---------- bookings ---------- */
function rowToBooking(r){
  let extra = {}; try { extra = JSON.parse(r.extra || '{}'); } catch {}
  return {
    id: r.id, kind: r.kind, date: r.date, start: r.start, end: r.end, resources: JSON.parse(r.resources),
    level: r.level, zoneId: r.zone_id, details: r.details, ...extra,
    companyId: r.company_id, company: r.company_name || '', contact: r.user_name || '', phone: r.user_phone || '',
    userId: r.user_id, status: r.status, createdAt: r.created_at
  };
}
const BOOKING_SELECT = `SELECT b.*, c.name AS company_name, u.name AS user_name, u.phone AS user_phone
  FROM bookings b LEFT JOIN companies c ON c.id = b.company_id LEFT JOIN users u ON u.id = b.user_id`;

async function listBookings(req, env, user){
  requireActive(user);
  const url = new URL(req.url);
  const from = url.searchParams.get('from'), to = url.searchParams.get('to');
  if (!isDate(from) || !isDate(to) || to < from || addDays(from, 62) < to) throw new HttpError(400, 'Bad date range.');
  const rows = (await env.DB.prepare(BOOKING_SELECT + " WHERE b.status = 'active' AND b.date BETWEEN ? AND ? ORDER BY b.date, b.start").bind(from, to).all()).results;
  return json({bookings: rows.map(rowToBooking)});
}

function slotStatements(env, booking){
  const out = [];
  for (const r of booking.resources) for (let t = booking.start; t < booking.end; t += STEP)
    out.push(env.DB.prepare('INSERT INTO slots (resource, date, slot, booking_id) VALUES (?, ?, ?, ?)').bind(r, booking.date, slotOf(t), booking.id));
  return out;
}
function insertBookingStmt(env, b, user){
  const extra = {};
  for (const k of ['weight', 'radius', 'vehicle', 'load', 'volume', 'pumpSetup', 'mcSize', 'mcWeight', 'mcSetup', 'craneToo', 'hoistToo', 'holdRes'])
    if (b[k] != null && b[k] !== '' && b[k] !== false) extra[k] = b[k];
  return env.DB.prepare('INSERT INTO bookings (id, kind, date, start, end, resources, level, zone_id, details, extra, company_id, user_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(b.id, b.kind, b.date, b.start, b.end, JSON.stringify(b.resources), b.level, b.zoneId, b.details, JSON.stringify(extra),
      b.kind === 'hold' || b.kind === 'closure' ? null : user.company_id, user.id, 'active', nowIso());
}
async function clashMessage(env, b){
  const slots = [];
  for (let t = b.start; t < b.end; t += STEP) slots.push(slotOf(t));
  const ph = b.resources.map(() => '?').join(','), sp = slots.map(() => '?').join(',');
  const row = await env.DB.prepare(`SELECT s.resource, bk.kind, bk.start, bk.end, c.name AS company FROM slots s JOIN bookings bk ON bk.id = s.booking_id LEFT JOIN companies c ON c.id = bk.company_id
    WHERE s.date = ? AND s.resource IN (${ph}) AND s.slot IN (${sp}) LIMIT 1`).bind(b.date, ...b.resources, ...slots).first();
  if (!row) return 'That time was just taken. Pick another time.';
  const who = row.kind === 'hold' ? 'a site hold' : row.kind === 'closure' ? 'a site closure' : (row.company || 'another booking');
  return `${RES[row.resource].label} is taken ${span(row.start, row.end)} by ${who}. Pick another time.`;
}

function bookingSummary(b){
  const lines = [
    `When: ${fmtD(b.date)}, ${span(b.start, b.end)}`,
    `What: ${KIND[b.kind]} (${b.resources.map(r => RES[r].label).join(' + ')})`,
    `Where: ${zoneLong(b.level, b.zoneId)}`,
    `Details: ${b.details}`
  ];
  if (b.weight != null) lines.push(`Heaviest piece: ${b.weight} t` + (b.radius != null ? ` at ${b.radius} m` : ''));
  if (b.vehicle) lines.push(`Vehicle: ${b.vehicle}`);
  return lines;
}

async function createBooking(req, env, user){
  requireActive(user);
  const input = await body(req);
  const [programme, settings] = await Promise.all([getProgramme(env), getSettings(env)]);
  const isAdmin = user.role === 'admin';
  const v = validateBooking(input, {programme, settings, now: brisbaneNow(), isAdmin});
  if (!v.ok) throw new HttpError(400, v.error);
  const b = {...v.booking, id: uid('b_')};

  let cancelled = [];
  if (b.kind === 'closure'){
    // Closing a resource cancels the bookings it overlaps, then tells their bookers.
    const slots = []; for (let t = b.start; t < b.end; t += STEP) slots.push(slotOf(t));
    const ph = b.resources.map(() => '?').join(','), sp = slots.map(() => '?').join(',');
    const ids = (await env.DB.prepare(`SELECT DISTINCT booking_id FROM slots WHERE date = ? AND resource IN (${ph}) AND slot IN (${sp})`).bind(b.date, ...b.resources, ...slots).all()).results.map(r => r.booking_id);
    if (ids.length){
      const ip = ids.map(() => '?').join(',');
      cancelled = (await env.DB.prepare(BOOKING_SELECT.replace('SELECT b.*', 'SELECT b.*, u.email AS user_email') + ` WHERE b.id IN (${ip})`).bind(...ids).all()).results;
      await env.DB.batch([
        env.DB.prepare(`UPDATE bookings SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancel_reason = ? WHERE id IN (${ip})`).bind(nowIso(), user.id, 'Closed: ' + b.details, ...ids),
        env.DB.prepare(`DELETE FROM slots WHERE booking_id IN (${ip})`).bind(...ids)
      ]);
    }
  }
  try {
    await env.DB.batch([insertBookingStmt(env, b, user), ...slotStatements(env, b)]);
  } catch (e){
    if (String(e && e.message).includes('UNIQUE')) throw new HttpError(409, await clashMessage(env, b));
    throw e;
  }
  await audit(env, user.id, 'booking.create', {id: b.id, kind: b.kind, date: b.date, start: b.start, end: b.end, resources: b.resources, cancelled: cancelled.map(c => c.id)});

  if (b.kind === 'closure'){
    for (const c of cancelled){
      const cb = rowToBooking(c);
      if (c.kind === 'hold' || c.kind === 'closure' || !c.user_email) continue;
      await sendEmail(env, c.user_email, `Booking cancelled: ${RES[cb.resources[0]].label} closed ${fmtD(cb.date)}`, [
        `Your booking has been cancelled because the site team has closed the ${b.resources.map(r => RES[r].short).join(' and ')} on ${fmtD(b.date)}, ${span(b.start, b.end)}.`,
        `Reason: ${b.details}`, '', ...bookingSummary(cb), '', 'Please book another time in the app, or call the site team.'
      ]);
    }
  } else if (b.kind !== 'hold'){
    await sendEmail(env, user.email, `Booking confirmed: ${KIND[b.kind]} ${fmtD(b.date)} ${span(b.start, b.end)}`, [
      'Your booking at Opal Carindale RACF is confirmed.', '', ...bookingSummary(b), '',
      'Running late or not coming? Cancel it in the app so someone else can use the slot.'
    ]);
  }
  return json({ok: true, id: b.id, cancelled: cancelled.length});
}

async function cancelBooking(req, env, user, id){
  requireActive(user);
  const row = await env.DB.prepare(BOOKING_SELECT.replace('SELECT b.*', 'SELECT b.*, u.email AS user_email') + " WHERE b.id = ? AND b.status = 'active'").bind(id).first();
  if (!row) throw new HttpError(404, 'That booking no longer exists.');
  const isAdmin = user.role === 'admin';
  if (!isAdmin && row.company_id !== user.company_id) throw new HttpError(403, 'You can only cancel your own company’s bookings.');
  const now = brisbaneNow();
  if (!isAdmin && (row.date < now.date || (row.date === now.date && row.end <= now.hour))) throw new HttpError(400, 'That booking has already finished.');
  const reason = clean((await body(req).catch(() => ({}))).reason, 200);
  await env.DB.batch([
    env.DB.prepare("UPDATE bookings SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancel_reason = ? WHERE id = ?").bind(nowIso(), user.id, reason || null, id),
    env.DB.prepare('DELETE FROM slots WHERE booking_id = ?').bind(id)
  ]);
  await audit(env, user.id, 'booking.cancel', {id});
  if (row.user_email && row.user_id !== user.id && row.kind !== 'hold' && row.kind !== 'closure'){
    await sendEmail(env, row.user_email, `Booking cancelled: ${KIND[row.kind]} ${fmtD(row.date)} ${span(row.start, row.end)}`, [
      `${user.name} (${user.company_name}) has cancelled this booking.` + (reason ? ` Reason: ${reason}` : ''), '', ...bookingSummary(rowToBooking(row))
    ]);
  }
  return json({ok: true});
}

/* ---------- site team ---------- */
async function adminCompanies(req, env, user){
  requireAdmin(user);
  const rows = (await env.DB.prepare(`SELECT c.*, (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id AND u.status != 'deleted') AS people
    FROM companies c ORDER BY CASE c.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, c.name`).all()).results;
  return json({companies: rows.map(r => ({id: r.id, name: r.name, status: r.status, people: r.people, createdAt: r.created_at}))});
}
async function adminCompanyUpdate(req, env, user, id){
  requireAdmin(user);
  const b = await body(req);
  const c = await env.DB.prepare('SELECT * FROM companies WHERE id = ?').bind(id).first();
  if (!c) throw new HttpError(404, 'Company not found.');
  const stmts = [];
  if (b.name !== undefined){
    const name = clean(b.name, 80);
    if (name.length < 2) throw new HttpError(400, 'Enter the company name.');
    stmts.push(env.DB.prepare('UPDATE companies SET name = ?, name_key = ? WHERE id = ?').bind(name, name.toLowerCase(), id));
  }
  let notify = [];
  if (b.status !== undefined){
    if (!['approved', 'rejected', 'pending'].includes(b.status)) throw new HttpError(400, 'Bad status.');
    stmts.push(env.DB.prepare('UPDATE companies SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?').bind(b.status, nowIso(), user.id, id));
    if (b.status === 'approved' && c.status !== 'approved'){
      notify = (await env.DB.prepare("SELECT email, name FROM users WHERE company_id = ? AND status = 'pending'").bind(id).all()).results;
      stmts.push(env.DB.prepare("UPDATE users SET status = 'active' WHERE company_id = ? AND status = 'pending'").bind(id));
    }
  }
  if (!stmts.length) return json({ok: true});
  try { await env.DB.batch(stmts); } catch (e){ if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'Another company already has that name.'); throw e; }
  await audit(env, user.id, 'company.update', {id, ...b});
  for (const u of notify){
    await sendEmail(env, u.email, 'You can now book at Opal Carindale', [
      `Hi ${u.name}, the site team has approved ${c.name}. You can now book the tower crane, loading zone, hoist, boom pump and mobile crane in the app.`
    ]);
  }
  return json({ok: true});
}
async function adminUsers(req, env, user){
  requireAdmin(user);
  const rows = (await env.DB.prepare(`SELECT u.*, c.name AS company_name, c.status AS company_status FROM users u JOIN companies c ON c.id = u.company_id
    WHERE u.status != 'deleted' ORDER BY c.name, u.name`).all()).results;
  return json({users: rows.map(publicUser).map((p, i) => ({...p, lastLoginAt: rows[i].last_login_at, createdAt: rows[i].created_at}))});
}
async function adminUserUpdate(req, env, user, id){
  requireAdmin(user);
  const b = await body(req);
  const u = await env.DB.prepare("SELECT * FROM users WHERE id = ? AND status != 'deleted'").bind(id).first();
  if (!u) throw new HttpError(404, 'Person not found.');
  if (id === user.id && (b.role === 'member' || b.status === 'disabled' || b.delete)) throw new HttpError(400, 'You can’t remove your own site team access.');
  if (b.delete){
    // Privacy: remove the person's contact details. Their past bookings stay against their company.
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET status = 'deleted', name = 'Deleted user', phone = '', email = ?, role = 'member' WHERE id = ?").bind('deleted+' + id + '@invalid', id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id)
    ]);
    await audit(env, user.id, 'user.delete', {id});
    return json({ok: true});
  }
  const stmts = [];
  if (b.role !== undefined){ if (!['admin', 'member'].includes(b.role)) throw new HttpError(400, 'Bad role.'); stmts.push(env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(b.role, id)); }
  if (b.status !== undefined){
    if (!['active', 'disabled'].includes(b.status)) throw new HttpError(400, 'Bad status.');
    stmts.push(env.DB.prepare('UPDATE users SET status = ? WHERE id = ?').bind(b.status, id));
    if (b.status === 'disabled') stmts.push(env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id));
  }
  if (stmts.length) await env.DB.batch(stmts);
  await audit(env, user.id, 'user.update', {id, ...b});
  return json({ok: true});
}
async function adminSettings(req, env, user){
  requireAdmin(user);
  const b = await body(req);
  const stmts = [];
  if (b.programme){
    const p = b.programme, out = {source: clean(p.source, 120)};
    for (const k of ['craneFrom', 'craneTo', 'hoistFrom', 'hoistTo']){ if (!isDate(p[k])) throw new HttpError(400, 'Set all four crane and hoist dates.'); out[k] = p[k]; }
    if (out.craneTo < out.craneFrom || out.hoistTo < out.hoistFrom) throw new HttpError(400, 'Each last day must be after its first day.');
    out.pours = {};
    for (const [k, v] of Object.entries(p.pours || {})){
      const [lv, z] = k.split(':');
      if (POUR_LEVELS.includes(lv) && zoneOf(lv, z) && isDate(v)) out.pours[k] = v;
    }
    stmts.push(env.DB.prepare('INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by')
      .bind('programme', JSON.stringify(out), nowIso(), user.id));
  }
  if (b.general){
    const cutoff = Number(b.general.cutoff);
    if (!(cutoff >= 6 && cutoff <= 20 && cutoff * 2 === Math.round(cutoff * 2))) throw new HttpError(400, 'Pick a cut-off time between 6am and 8pm.');
    stmts.push(env.DB.prepare('INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by')
      .bind('general', JSON.stringify({cutoff}), nowIso(), user.id));
  }
  if (stmts.length) await env.DB.batch(stmts);
  await audit(env, user.id, 'settings.update', b);
  return json({ok: true});
}
const csvCell = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? '"' + (/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""') + '"' : s; };
async function adminExport(req, env, user){
  requireAdmin(user);
  const url = new URL(req.url);
  const from = url.searchParams.get('from'), to = url.searchParams.get('to');
  if (!isDate(from) || !isDate(to) || to < from) throw new HttpError(400, 'Bad date range.');
  const rows = (await env.DB.prepare(BOOKING_SELECT + ' WHERE b.date BETWEEN ? AND ? ORDER BY b.date, b.start').bind(from, to).all()).results.map(r => ({...rowToBooking(r), cancelReason: r.cancel_reason}));
  const head = ['Date', 'Start', 'End', 'Type', 'Resources', 'Level / zone', 'Company', 'Contact', 'Mobile', 'Details', 'Heaviest piece (t)', 'Radius (m)', 'Vehicle', 'Hoist load (kg)', 'Concrete (m3)', 'Status', 'Cancel reason', 'Booked at'];
  const lines = [head.join(',')].concat(rows.map(b => [b.date, hourLabel(b.start), hourLabel(b.end), KIND[b.kind], b.resources.map(r => RES[r].label).join(' + '), zoneShort(b.level, b.zoneId), b.company, b.contact, b.phone, b.details, b.weight, b.radius, b.vehicle, b.load, b.volume, b.status, b.cancelReason, b.createdAt].map(csvCell).join(',')));
  return new Response('﻿' + lines.join('\r\n'), {headers: {'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="Opal_Carindale_Bookings_${from}_to_${to}.csv"`, 'Cache-Control': 'no-store'}});
}

/* ---------- router ---------- */
async function route(req, env){
  const url = new URL(req.url), p = url.pathname, m = req.method;
  if (m !== 'GET' && m !== 'HEAD'){
    const origin = req.headers.get('Origin');
    if (origin && origin !== url.origin) throw new HttpError(403, 'Bad origin.');
    if (!(req.headers.get('Content-Type') || '').includes('application/json')) throw new HttpError(415, 'Send JSON.');
  }
  if (p === '/api/auth/request' && m === 'POST') return authRequest(req, env);
  if (p === '/api/auth/verify' && m === 'POST') return authVerify(req, env);
  if (p === '/api/auth/signup' && m === 'POST') return authSignup(req, env);
  if (p === '/api/auth/logout' && m === 'POST') return logout(req, env);
  const user = await currentUser(req, env);
  if (p === '/api/me' && m === 'GET'){
    const [programme, settings] = await Promise.all([getProgramme(env), getSettings(env)]);
    return json({user: publicUser(user), programme, settings, now: brisbaneNow()});
  }
  if (p === '/api/bookings' && m === 'GET') return listBookings(req, env, user);
  if (p === '/api/bookings' && m === 'POST') return createBooking(req, env, user);
  let mm;
  if ((mm = p.match(/^\/api\/bookings\/([\w-]+)\/cancel$/)) && m === 'POST') return cancelBooking(req, env, user, mm[1]);
  if (p === '/api/admin/companies' && m === 'GET') return adminCompanies(req, env, user);
  if ((mm = p.match(/^\/api\/admin\/companies\/([\w-]+)$/)) && m === 'POST') return adminCompanyUpdate(req, env, user, mm[1]);
  if (p === '/api/admin/users' && m === 'GET') return adminUsers(req, env, user);
  if ((mm = p.match(/^\/api\/admin\/users\/([\w-]+)$/)) && m === 'POST') return adminUserUpdate(req, env, user, mm[1]);
  if (p === '/api/admin/settings' && m === 'POST') return adminSettings(req, env, user);
  if (p === '/api/admin/export' && m === 'GET') return adminExport(req, env, user);
  throw new HttpError(404, 'Not found.');
}

export default {
  async fetch(req, env){
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      return await route(req, env);
    } catch (e){
      if (e instanceof HttpError) return json({error: e.message}, e.status);
      console.error(e && e.stack || e);
      return json({error: 'Something went wrong on the server. Try again.'}, 500);
    }
  },
  // Daily tidy-up: expired codes, sign-up tokens and sessions.
  async scheduled(event, env){
    const t = Date.now();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM login_codes WHERE expires_at < ?').bind(t - 24 * 3600e3),
      env.DB.prepare('DELETE FROM signup_tokens WHERE expires_at < ?').bind(t),
      env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(t)
    ]);
  }
};
