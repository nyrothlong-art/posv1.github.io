require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'pos.db');
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  JWT_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[warn] JWT_SECRET មិនបានកំណត់ — ប្រើ key បណ្តោះអាសន្ន (ត្រូវ Login ឡើងវិញរាល់ពេល Restart)');
}

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    user TEXT PRIMARY KEY COLLATE NOCASE,
    pass_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('ADMIN','CASHIER','STOCK'))
  );
  CREATE TABLE IF NOT EXISTS docs (
    col TEXT NOT NULL,
    id TEXT NOT NULL,
    json TEXT NOT NULL,
    PRIMARY KEY (col, id)
  );
  CREATE TABLE IF NOT EXISTS meta (col TEXT PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`);

// Seed Admin
if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  let pw = process.env.ADMIN_PASSWORD;
  if (!pw) {
    pw = crypto.randomBytes(6).toString('hex');
    console.warn(`[warn] ADMIN_PASSWORD មិនបានកំណត់។ ពាក្យសម្ងាត់ Admin ដំបូង: ${pw}  (ប្តូរភ្លាមៗ)`);
  }
  db.prepare('INSERT INTO users (user, pass_hash, role) VALUES (?,?,?)').run('Admin', bcrypt.hashSync(pw, 10), 'ADMIN');
  console.log('[info] បានបង្កើតគណនី Admin ដំបូង');
}

const getSetting = k => { const r = db.prepare('SELECT value FROM settings WHERE key=?').get(k); return r ? r.value : null; };
const setSetting = (k, v) => db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v);

// ===== Collections & permissions =====
const COLS = {
  products:   { write: ['ADMIN', 'STOCK'], remove: ['ADMIN', 'STOCK'], cashierPatch: true, newestFirst: false },
  invoices:   { write: ['ADMIN', 'CASHIER'], remove: ['ADMIN'], newestFirst: true },
  expenses:   { write: ['ADMIN'], remove: ['ADMIN'], newestFirst: true },
  changeLogs: { write: ['ADMIN', 'CASHIER'], remove: ['ADMIN'], newestFirst: true }
};

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);                       // curl / health checks
    if (ORIGINS.includes(origin)) return cb(null, true);
    if (!ORIGINS.length && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return cb(null, true);
    cb(new Error('Origin not allowed'));
  }
}));
app.use(express.json({ limit: '10mb' }));

const auth = (roles) => (req, res, next) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'សូម Login ជាមុនសិន' });
  try {
    const p = jwt.verify(token, JWT_SECRET);
    const u = db.prepare('SELECT user, role FROM users WHERE user=?').get(p.user);
    if (!u) return res.status(401).json({ error: 'គណនីមិនមានទៀតទេ' });
    req.user = u;
    if (roles && !roles.includes(u.role)) return res.status(403).json({ error: 'គ្មានសិទ្ធិធ្វើសកម្មភាពនេះ' });
    next();
  } catch {
    res.status(401).json({ error: 'Session ផុតកំណត់ សូម Login ឡើងវិញ' });
  }
};

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ===== Auth =====
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'ព្យាយាមចូលច្រើនពេក សូមរង់ចាំ 15 នាទី' } });

app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { user, pass } = req.body || {};
  if (typeof user !== 'string' || typeof pass !== 'string') return res.status(400).json({ error: 'ទិន្នន័យមិនត្រឹមត្រូវ' });
  const row = db.prepare('SELECT user, pass_hash, role FROM users WHERE user=?').get(user.trim());
  if (!row || !bcrypt.compareSync(pass, row.pass_hash)) return res.status(401).json({ error: 'ឈ្មោះអ្នកប្រើប្រាស់ ឬលេខសម្ងាត់មិនត្រឹមត្រូវឡើយ!' });
  const token = jwt.sign({ user: row.user }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, user: row.user, role: row.role });
});

// ===== Data sync =====
app.get('/api/data', auth(), (req, res) => {
  const out = {};
  for (const [col, cfg] of Object.entries(COLS)) {
    const init = !!db.prepare('SELECT 1 FROM meta WHERE col=?').get(col);
    const rows = db.prepare(`SELECT json FROM docs WHERE col=? ORDER BY rowid ${cfg.newestFirst ? 'DESC' : 'ASC'}`).all(col);
    out[col] = { init, items: rows.map(r => JSON.parse(r.json)) };
  }
  res.json(out);
});

app.put('/api/data/:col', auth(), (req, res) => {
  const col = req.params.col;
  const cfg = COLS[col];
  if (!cfg) return res.status(404).json({ error: 'Collection មិនមាន' });
  const role = req.user.role;
  const upsert = Array.isArray(req.body.upsert) ? req.body.upsert : [];
  const remove = Array.isArray(req.body.remove) ? req.body.remove : [];

  const isCashierPatch = cfg.cashierPatch && role === 'CASHIER';
  if (!isCashierPatch && (upsert.length && !cfg.write.includes(role))) return res.status(403).json({ error: 'គ្មានសិទ្ធិកែប្រែទិន្នន័យនេះ' });
  if (remove.length && !cfg.remove.includes(role)) return res.status(403).json({ error: 'គ្មានសិទ្ធិលុបទិន្នន័យនេះ' });
  if (upsert.length + remove.length > 5000) return res.status(400).json({ error: 'ទិន្នន័យច្រើនពេក' });

  const get = db.prepare('SELECT json FROM docs WHERE col=? AND id=?');
  const put = db.prepare('INSERT INTO docs (col,id,json) VALUES (?,?,?) ON CONFLICT(col,id) DO UPDATE SET json=excluded.json');
  const del = db.prepare('DELETE FROM docs WHERE col=? AND id=?');

  try {
    db.transaction(() => {
      for (const item of upsert) {
        if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 100) throw new Error('id មិនត្រឹមត្រូវ');
        if (isCashierPatch) {
          // អ្នកលក់អាចកែបានតែ qty / totalOut នៃទំនិញដែលមានស្រាប់ (ពេលលក់)
          const cur = get.get(col, item.id);
          if (!cur) throw Object.assign(new Error('អ្នកលក់មិនអាចបន្ថែមទំនិញថ្មីបានទេ'), { code: 403 });
          const merged = JSON.parse(cur.json);
          if (typeof item.qty === 'number') merged.qty = item.qty;
          if (typeof item.totalOut === 'number') merged.totalOut = item.totalOut;
          put.run(col, item.id, JSON.stringify(merged));
        } else {
          put.run(col, item.id, JSON.stringify(item));
        }
      }
      for (const id of remove) if (typeof id === 'string') del.run(col, id);
      db.prepare('INSERT OR IGNORE INTO meta (col) VALUES (?)').run(col);
    })();
    res.json({ ok: true });
  } catch (e) {
    res.status(e.code === 403 ? 403 : 400).json({ error: e.message });
  }
});

// ===== Staff (Admin only) =====
app.get('/api/staff', auth(['ADMIN']), (_req, res) => {
  res.json(db.prepare('SELECT user, role FROM users ORDER BY rowid').all());
});

app.post('/api/staff', auth(['ADMIN']), (req, res) => {
  const { user, pass, role } = req.body || {};
  if (typeof user !== 'string' || !/^[\p{L}\p{N}_.\- ]{2,40}$/u.test(user.trim())) return res.status(400).json({ error: 'ឈ្មោះអ្នកប្រើមិនត្រឹមត្រូវ' });
  if (typeof pass !== 'string' || pass.length < 4) return res.status(400).json({ error: 'ពាក្យសម្ងាត់ត្រូវមានយ៉ាងតិច 4 តួ' });
  if (!['ADMIN', 'CASHIER', 'STOCK'].includes(role)) return res.status(400).json({ error: 'Role មិនត្រឹមត្រូវ' });
  if (db.prepare('SELECT 1 FROM users WHERE user=?').get(user.trim())) return res.status(409).json({ error: 'ឈ្មោះអ្នកប្រើប្រាស់នេះមានរួចហើយ!' });
  db.prepare('INSERT INTO users (user, pass_hash, role) VALUES (?,?,?)').run(user.trim(), bcrypt.hashSync(pass, 10), role);
  res.json({ ok: true });
});

app.put('/api/staff/:user/password', auth(['ADMIN']), (req, res) => {
  const { pass } = req.body || {};
  if (typeof pass !== 'string' || pass.length < 4) return res.status(400).json({ error: 'ពាក្យសម្ងាត់ត្រូវមានយ៉ាងតិច 4 តួ' });
  const r = db.prepare('UPDATE users SET pass_hash=? WHERE user=?').run(bcrypt.hashSync(pass, 10), req.params.user);
  res.json({ ok: r.changes > 0 });
});

app.delete('/api/staff/:user', auth(['ADMIN']), (req, res) => {
  if (req.params.user.toLowerCase() === 'admin') return res.status(400).json({ error: 'មិនអាចលុប Admin គោលបានទេ' });
  db.prepare('DELETE FROM users WHERE user=?').run(req.params.user);
  res.json({ ok: true });
});

// ===== Config =====
function notifyConfig() {
  return {
    tgToken: getSetting('tgToken') || process.env.TELEGRAM_BOT_TOKEN || '',
    tgChatId: getSetting('tgChatId') || process.env.TELEGRAM_CHAT_ID || ''
  };
}
const emailEnabled = () => !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD && process.env.NOTIFY_EMAIL_TO);

app.get('/api/config', auth(), (_req, res) => {
  const pub = JSON.parse(getSetting('publicConfig') || '{}');
  const n = notifyConfig();
  res.json({ ...pub, telegram: !!(n.tgToken && n.tgChatId), email: emailEnabled() });
});

app.put('/api/config', auth(['ADMIN']), (req, res) => {
  const b = req.body || {};
  const pub = JSON.parse(getSetting('publicConfig') || '{}');
  if (typeof b.shopName === 'string') pub.shopName = b.shopName.slice(0, 100);
  if (Number.isFinite(b.exchangeRate) && b.exchangeRate > 0) pub.exchangeRate = b.exchangeRate;
  if (typeof b.customLogo === 'string') pub.customLogo = b.customLogo;
  setSetting('publicConfig', JSON.stringify(pub));
  if (typeof b.tgToken === 'string' && b.tgToken.trim()) setSetting('tgToken', b.tgToken.trim());
  if (typeof b.tgChatId === 'string' && b.tgChatId.trim()) setSetting('tgChatId', b.tgChatId.trim());
  res.json({ ok: true });
});

// ===== Notifications (Telegram + Gmail) — Token នៅលើ Server មិនបង្ហាញទៅ Browser =====
let mailer = null;
function getMailer() {
  if (!mailer && emailEnabled()) {
    mailer = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } });
  }
  return mailer;
}

const notifyLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });

app.post('/api/notify', auth(), notifyLimiter, async (req, res) => {
  let text = (req.body && typeof req.body.text === 'string') ? req.body.text : '';
  text = text.replace(/\*\*/g, '').slice(0, 4000).trim();
  if (!text) return res.status(400).json({ error: 'គ្មានខ្លឹមសារ' });

  const result = { telegram: 'skipped', email: 'skipped' };
  const n = notifyConfig();
  const jobs = [];

  if (n.tgToken && n.tgChatId) {
    jobs.push(fetch(`https://api.telegram.org/bot${n.tgToken}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: n.tgChatId, text })
    }).then(async r => { result.telegram = r.ok ? 'sent' : 'failed'; if (!r.ok) console.warn('[telegram]', r.status, await r.text()); })
      .catch(e => { result.telegram = 'failed'; console.warn('[telegram]', e.message); }));
  }
  const m = getMailer();
  if (m) {
    const subject = text.split('\n')[0].slice(0, 120);
    jobs.push(m.sendMail({ from: process.env.GMAIL_USER, to: process.env.NOTIFY_EMAIL_TO, subject, text })
      .then(() => { result.email = 'sent'; })
      .catch(e => { result.email = 'failed'; console.warn('[email]', e.message); }));
  }
  await Promise.all(jobs);
  res.json(result);
});

app.use((err, _req, res, _next) => {
  if (err && err.message === 'Origin not allowed') return res.status(403).json({ error: 'Origin មិនត្រូវបានអនុញ្ញាត' });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

app.listen(PORT, () => console.log(`POS API running on :${PORT}`));
