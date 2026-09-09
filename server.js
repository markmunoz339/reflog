require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const db = require('./db');
const { buildICS } = require('./ics');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname + '/public'));
app.use(cookieParser());

const LOGIN_MAX_AGE = 1000 * 60 * 60 * 24 * 365; // 1 year — this is a personal
// tool on your own device, not a shared kiosk, so unlike Reffi's ref login
// there's no reason to make you re-enter your PIN every visit.

// ---------- Date helpers ----------
// Local calendar date, matching how dates are stored everywhere else here
// (games.date), so "today" lines up with what's actually on the schedule
// instead of drifting on UTC.
function todayDateStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function firstOfMonth(dateStr) {
  return dateStr.slice(0, 7) + '-01';
}

function formatMoney(n) {
  const num = Number(n) || 0;
  return '$' + num.toLocaleString('en-US', { minimumFractionDigits: num % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
}

function formatDateLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTimeLabel(timeStr) {
  if (!timeStr) return '';
  const [hh, mm] = timeStr.split(':').map(Number);
  const period = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${period}`;
}

// ---------- Auth ----------
function generateUniquePin() {
  const taken = new Set(db.prepare('SELECT pin FROM refs').all().map((r) => r.pin));
  let pin;
  do {
    pin = String(Math.floor(1000 + Math.random() * 9000));
  } while (taken.has(pin));
  return pin;
}

function requireRef(req, res, next) {
  const refId = req.cookies.reflog_ref_id ? Number(req.cookies.reflog_ref_id) : null;
  const ref = refId ? db.prepare('SELECT * FROM refs WHERE id = ?').get(refId) : null;
  if (!ref) return res.redirect('/login');
  req.ref = ref;
  next();
}

// ---------- Home / auth routes ----------
app.get('/', (req, res) => {
  res.render('home');
});

app.get('/signup', (req, res) => {
  res.render('signup', { error: null });
});

app.post('/signup', (req, res) => {
  const name = (req.body.name || '').trim();
  const pin = (req.body.pin || '').trim();
  if (!name || !/^[0-9]{4,6}$/.test(pin)) {
    return res.render('signup', { error: 'Please enter your name and a 4-6 digit PIN.' });
  }
  const existing = db.prepare('SELECT id FROM refs WHERE pin = ?').get(pin);
  if (existing) {
    return res.render('signup', { error: 'That PIN is already taken — please pick a different one.' });
  }
  const id = db.prepare('INSERT INTO refs (name, pin) VALUES (?, ?)').run(name, pin).lastInsertRowid;
  res.cookie('reflog_ref_id', String(id), { httpOnly: true, maxAge: LOGIN_MAX_AGE });
  res.redirect('/dashboard');
});

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const pin = (req.body.pin || '').trim();
  const ref = pin ? db.prepare('SELECT * FROM refs WHERE pin = ?').get(pin) : null;
  if (!ref) {
    return res.render('login', { error: 'PIN not recognized. New here? Create a profile below.' });
  }
  res.cookie('reflog_ref_id', String(ref.id), { httpOnly: true, maxAge: LOGIN_MAX_AGE });
  res.redirect('/dashboard');
});

app.get('/logout', (req, res) => {
  res.clearCookie('reflog_ref_id');
  res.redirect('/');
});

// ---------- Dashboard ----------
function computeStats(refId) {
  const today = todayDateStr();
  const weekStart = mondayOf(today);
  const monthStart = firstOfMonth(today);

  const countPay = (whereDate) => {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS cnt, COALESCE(SUM(pay), 0) AS total
         FROM games WHERE ref_id = ? AND status != 'given_away' ${whereDate}`
      )
      .get(refId);
    return { count: row.cnt, pay: row.total };
  };

  return {
    week: countPay(`AND date >= '${weekStart}'`),
    month: countPay(`AND date >= '${monthStart}'`),
    allTime: countPay(''),
  };
}

app.get('/dashboard', requireRef, (req, res) => {
  const tab = req.query.tab === 'history' ? 'history' : 'upcoming';
  const today = todayDateStr();

  const games =
    tab === 'upcoming'
      ? db.prepare('SELECT * FROM games WHERE ref_id = ? AND date >= ? ORDER BY date ASC, start_time ASC').all(req.ref.id, today)
      : db.prepare('SELECT * FROM games WHERE ref_id = ? AND date < ? ORDER BY date DESC, start_time DESC').all(req.ref.id, today);

  const gamesView = games.map((g) => ({
    ...g,
    dateLabel: formatDateLabel(g.date),
    startLabel: formatTimeLabel(g.start_time),
    endLabel: formatTimeLabel(g.end_time),
    payLabel: g.pay != null ? formatMoney(g.pay) : null,
  }));

  res.render('dashboard', {
    ref: req.ref,
    tab,
    games: gamesView,
    stats: computeStats(req.ref.id),
    formatMoney,
    host: req.get('host'),
    editGameId: req.query.edit ? Number(req.query.edit) : null,
    swapGameId: req.query.swap ? Number(req.query.swap) : null,
  });
});

// ---------- Games CRUD ----------
app.post('/games', requireRef, (req, res) => {
  const { date, start_time, end_time, location, league, level, notes } = req.body;
  if (!date || !start_time) return res.redirect('/dashboard');

  const pickedUp = req.body.picked_up === 'on';
  const payRaw = (req.body.pay || '').trim();
  const pay = payRaw !== '' ? Number(payRaw) : req.ref.default_pay;

  db.prepare(
    `INSERT INTO games (ref_id, date, start_time, end_time, location, league, level, notes, pay, status, swap_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    req.ref.id,
    date,
    start_time,
    end_time || null,
    location || null,
    league || null,
    level || null,
    notes || null,
    pay != null && !Number.isNaN(pay) ? pay : null,
    pickedUp ? 'picked_up' : 'normal',
    pickedUp ? (req.body.picked_up_from || '').trim() || null : null
  );

  res.redirect(req.body.return_tab === 'history' ? '/dashboard?tab=history' : '/dashboard');
});

app.post('/games/:id/edit', requireRef, (req, res) => {
  const game = db.prepare('SELECT * FROM games WHERE id = ? AND ref_id = ?').get(req.params.id, req.ref.id);
  if (!game) return res.redirect('/dashboard');

  const { date, start_time, end_time, location, league, level, notes, status, swap_name, swap_note } = req.body;
  const payRaw = (req.body.pay || '').trim();
  const pay = payRaw !== '' ? Number(payRaw) : null;
  const validStatus = ['normal', 'picked_up', 'given_away'].includes(status) ? status : 'normal';

  db.prepare(
    `UPDATE games SET date = ?, start_time = ?, end_time = ?, location = ?, league = ?, level = ?, notes = ?, pay = ?, status = ?, swap_name = ?, swap_note = ?
     WHERE id = ?`
  ).run(
    date || game.date,
    start_time || game.start_time,
    end_time || null,
    location || null,
    league || null,
    level || null,
    notes || null,
    pay != null && !Number.isNaN(pay) ? pay : null,
    validStatus,
    validStatus === 'normal' ? null : (swap_name || '').trim() || null,
    validStatus === 'normal' ? null : (swap_note || '').trim() || null,
    game.id
  );

  res.redirect(req.body.return_tab === 'history' ? '/dashboard?tab=history' : '/dashboard');
});

app.post('/games/:id/delete', requireRef, (req, res) => {
  db.prepare('DELETE FROM games WHERE id = ? AND ref_id = ?').run(req.params.id, req.ref.id);
  res.redirect(req.body.return_tab === 'history' ? '/dashboard?tab=history' : '/dashboard');
});

// ---------- Settings ----------
app.get('/settings', requireRef, (req, res) => {
  res.render('settings', { ref: req.ref, error: null, saved: req.query.saved === '1' });
});

app.post('/settings', requireRef, (req, res) => {
  const name = (req.body.name || '').trim();
  const pin = (req.body.pin || '').trim();
  const timezone = (req.body.timezone || 'America/Denver').trim();
  const payRaw = (req.body.default_pay || '').trim();
  const defaultPay = payRaw !== '' ? Number(payRaw) : null;

  if (!name || !/^[0-9]{4,6}$/.test(pin)) {
    return res.render('settings', { ref: req.ref, error: 'Name and a 4-6 digit PIN are required.', saved: false });
  }
  const collision = db.prepare('SELECT id FROM refs WHERE pin = ? AND id != ?').get(pin, req.ref.id);
  if (collision) {
    return res.render('settings', { ref: req.ref, error: 'That PIN is already taken by another profile.', saved: false });
  }

  db.prepare('UPDATE refs SET name = ?, pin = ?, timezone = ?, default_pay = ? WHERE id = ?').run(
    name,
    pin,
    timezone || 'America/Denver',
    defaultPay != null && !Number.isNaN(defaultPay) ? defaultPay : null,
    req.ref.id
  );

  res.redirect('/settings?saved=1');
});

// ---------- Calendar feed ----------
app.get('/ref/:refId/schedule.ics', (req, res) => {
  const ref = db.prepare('SELECT * FROM refs WHERE id = ?').get(req.params.refId);
  if (!ref) return res.status(404).send('Not found');

  const games = db
    .prepare(`SELECT * FROM games WHERE ref_id = ? AND status != 'given_away' ORDER BY date, start_time`)
    .all(ref.id);

  const events = games.map((g) => ({
    uid: `game-${g.id}`,
    date: g.date,
    startTime: g.start_time,
    endTime: g.end_time || g.start_time,
    summary: [g.league, g.level].filter(Boolean).join(' ') || 'Reffing',
    location: g.location || '',
    description: [g.notes, g.status === 'picked_up' && g.swap_name ? `Picked up from ${g.swap_name}` : null]
      .filter(Boolean)
      .join(' — '),
  }));

  const ics = buildICS(events, `${ref.name}'s RefLog Games`, ref.timezone);
  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="reflog-games.ics"');
  res.send(ics);
});

app.listen(PORT, () => {
  console.log(`RefLog running on http://localhost:${PORT}`);
});
