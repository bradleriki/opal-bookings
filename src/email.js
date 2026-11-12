// Email sending through Resend (https://resend.com). Secrets: RESEND_API_KEY. Vars: MAIL_FROM, APP_URL.
// With no API key set (local development), emails are written to the log instead of being sent.

const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

function wrapHtml(env, title, lines){
  const body = lines.map(l => l === '' ? '<br>' : `<p style="margin:0 0 10px">${esc(l)}</p>`).join('');
  return `<!doctype html><html><body style="margin:0;background:#EEF1F5;font:15px/1.5 Arial,Helvetica,sans-serif;color:#111">
<div style="max-width:560px;margin:0 auto;background:#fff">
<div style="padding:18px 22px;border-bottom:5px solid #822433"><img src="${esc((env.APP_URL || '') + '/img/badge-logo.png')}" alt="BADGE" width="150" style="display:block;width:150px;height:auto"></div>
<div style="padding:20px 22px"><h1 style="font-size:20px;color:#003C69;margin:0 0 14px">${esc(title)}</h1>${body}</div>
<div style="padding:12px 22px;font-size:12px;color:#555;border-top:1px solid #DCE2EC">BADGE · Opal Carindale RACF · Site bookings${env.APP_URL ? ' · ' + esc(env.APP_URL) : ''}</div>
</div></body></html>`;
}

export async function sendEmail(env, to, subject, lines){
  const list = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!list.length) return {ok: true, skipped: true};
  const text = lines.join('\n') + '\n\nBADGE · Opal Carindale RACF · Site bookings' + (env.APP_URL ? '\n' + env.APP_URL : '');
  if (!env.RESEND_API_KEY){
    console.log('[email not sent: no RESEND_API_KEY]', JSON.stringify({to: list, subject, text}));
    return {ok: true, dev: true};
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json'},
    body: JSON.stringify({from: env.MAIL_FROM, to: list, subject, text, html: wrapHtml(env, subject, lines)})
  });
  if (!res.ok){
    console.error('email send failed', res.status, await res.text().catch(() => ''));
    return {ok: false, status: res.status};
  }
  return {ok: true};
}
