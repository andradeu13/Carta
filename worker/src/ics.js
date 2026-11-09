/* Lector mínimo de calendarios iCal (.ics) para saber qué reuniones tienes en un día.
   Soporta VEVENT con hora local (TZID), UTC o «flotante», y RRULE básicas (DAILY / WEEKLY+BYDAY, INTERVAL, UNTIL, COUNT).
   Ignora los eventos de todo el día, los cancelados y lo que no entiende. */

const DAYCODE = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

function unfold(text) { return String(text).replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n'); }
function parseLine(line) {
  const i = line.indexOf(':'); if (i < 0) return null;
  const [name, ...ps] = line.slice(0, i).split(';');
  const params = {}; ps.forEach(p => { const [k, v] = p.split('='); if (k) params[k.toUpperCase()] = (v || '').replace(/^"|"$/g, ''); });
  return { name: name.toUpperCase(), params, value: line.slice(i + 1) };
}
const unesc = s => String(s || '').replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();

/* Hora de pared en `tz` → milisegundos UTC. */
function zonedToUtc(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const off = t => {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t));
    const g = k => +p.find(x => x.type === k).value;
    return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - t;
  };
  return guess - off(guess - off(guess));
}
function parseDate(prop, localTz) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(prop.value.trim());
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  if (!m[4]) return { allDay: true, y, mo, d };
  const h = +m[4], mi = +m[5], s = +(m[6] || 0);
  let utc;
  if (m[7]) utc = Date.UTC(y, mo - 1, d, h, mi, s);
  else { let tz = prop.params.TZID || localTz; try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch (e) { tz = localTz; } utc = zonedToUtc(y, mo, d, h, mi, s, tz); }
  return { allDay: false, utc };
}
const partsIn = (ms, tz) => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
  const g = k => +p.find(x => x.type === k).value;
  const date = `${p.find(x => x.type === 'year').value}-${p.find(x => x.type === 'month').value}-${p.find(x => x.type === 'day').value}`;
  return { date, secs: g('hour') * 3600 + g('minute') * 60 + g('second') };
};
const dayNum = date => Math.round(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 864e5);
const wdOf = date => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;

function parseRule(v) { const r = {}; String(v || '').split(';').forEach(p => { const [k, x] = p.split('='); if (k) r[k.toUpperCase()] = x; }); return r; }

/* Eventos que ocurren en `date` (YYYY-MM-DD, hora de `tz`): [{ title, from, to }] en segundos del día. */
export function eventsOn(ics, date, tz) {
  const lines = unfold(ics).map(parseLine).filter(Boolean);
  const out = []; let ev = null;
  for (const l of lines) {
    if (l.name === 'BEGIN' && l.value === 'VEVENT') { ev = { ex: [] }; continue; }
    if (l.name === 'END' && l.value === 'VEVENT') { if (ev) { const o = occurrence(ev, date, tz); if (o) out.push(o); } ev = null; continue; }
    if (!ev) continue;
    if (l.name === 'DTSTART') ev.start = parseDate(l, tz);
    else if (l.name === 'DTEND') ev.end = parseDate(l, tz);
    else if (l.name === 'DURATION') ev.dur = l.value;
    else if (l.name === 'SUMMARY') ev.title = unesc(l.value);
    else if (l.name === 'RRULE') ev.rule = parseRule(l.value);
    else if (l.name === 'EXDATE') l.value.split(',').forEach(v => { const d = parseDate({ value: v, params: l.params }, tz); if (d && !d.allDay) ev.ex.push(partsIn(d.utc, tz).date); else if (d) ev.ex.push(`${d.y}-${String(d.mo).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`); });
    else if (l.name === 'STATUS' && /CANCELLED/i.test(l.value)) ev.cancelled = true;
  }
  return out.sort((a, b) => a.from - b.from);
}

function occurrence(ev, date, tz) {
  if (ev.cancelled || !ev.start || ev.start.allDay) return null;
  const first = partsIn(ev.start.utc, tz);
  let durMs = 3600e3;
  if (ev.end && !ev.end.allDay) durMs = Math.max(60e3, ev.end.utc - ev.start.utc);
  else if (ev.dur) { const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(ev.dur); if (m) durMs = (((+m[1] || 0) * 24 + (+m[2] || 0)) * 60 + (+m[3] || 0)) * 60e3 || durMs; }
  const startDay = dayNum(first.date), target = dayNum(date);
  const make = () => ({ title: ev.title || 'Evento', from: first.secs, to: Math.min(86400, first.secs + Math.round(durMs / 1000)) });
  if (ev.ex.includes(date)) return null;
  if (!ev.rule || !ev.rule.FREQ) return first.date === date ? make() : null;
  const r = ev.rule, interval = Math.max(1, +r.INTERVAL || 1);
  if (target < startDay) return null;
  if (r.UNTIL) { const u = parseDate({ value: r.UNTIL, params: {} }, tz); const ud = u && (u.allDay ? `${u.y}-${String(u.mo).padStart(2, '0')}-${String(u.d).padStart(2, '0')}` : partsIn(u.utc, tz).date); if (ud && date > ud) return null; }
  const matches = dn => {
    const diff = dn - startDay;
    if (r.FREQ === 'DAILY') return diff % interval === 0;
    if (r.FREQ === 'WEEKLY') {
      const days = r.BYDAY ? r.BYDAY.split(',').map(x => DAYCODE.indexOf(x.slice(-2))).filter(x => x >= 0) : [wdOf(first.date)];
      const dd = new Date(dn * 864e5).toISOString().slice(0, 10);
      const weeks = Math.floor((dn - (startDay - wdOf(first.date))) / 7);
      return days.includes(wdOf(dd)) && weeks % interval === 0;
    }
    return false;
  };
  if (!['DAILY', 'WEEKLY'].includes(r.FREQ) || !matches(target)) return null;
  if (r.COUNT) { let n = 0; for (let dn = startDay; dn <= target; dn++) if (matches(dn) && ++n > +r.COUNT) return null; }
  return make();
}
