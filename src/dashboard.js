import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CUSTOMERS_PATH = path.join(__dirname, '..', 'data', 'customers.json');
const LOGS_DIR       = path.join(__dirname, '..', 'logs');
const TEMPLATES_DIR  = path.join(__dirname, '..', 'templates');

const PORT     = process.env.PORT || 3001;
const PASSWORD = process.env.DASHBOARD_PASSWORD;
const TOKEN    = Buffer.from(`dash:${PASSWORD}`).toString('base64');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// ── Auth middleware ───────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.cookies?.dash_auth === TOKEN) return next();
  res.redirect('/login');
}

// ── Login ─────────────────────────────────────────────────
app.get('/login', async (_req, res) => {
  res.send(await fs.readFile(path.join(TEMPLATES_DIR, 'login.html'), 'utf-8'));
});

app.post('/login', (req, res) => {
  if (req.body.password === PASSWORD) {
    res.cookie('dash_auth', TOKEN, { httpOnly: true, sameSite: 'lax' });
    return res.redirect('/');
  }
  res.redirect('/login?error=1');
});

app.get('/logout', (_req, res) => {
  res.clearCookie('dash_auth');
  res.redirect('/login');
});

// ── Dashboard ─────────────────────────────────────────────
app.get('/', requireAuth, async (_req, res) => {
  res.send(await fs.readFile(path.join(TEMPLATES_DIR, 'dashboard.html'), 'utf-8'));
});

// ── API: customers ────────────────────────────────────────
app.get('/api/customers', requireAuth, async (_req, res) => {
  const raw = await fs.readFile(CUSTOMERS_PATH, 'utf-8');
  res.json(JSON.parse(raw));
});

app.patch('/api/customers/:id', requireAuth, async (req, res) => {
  const raw = await fs.readFile(CUSTOMERS_PATH, 'utf-8');
  const customers = JSON.parse(raw);
  const idx = customers.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  const allowed = ['contact_email', 'active', 'name'];
  for (const key of allowed) {
    if (key in req.body) customers[idx][key] = req.body[key];
  }
  await fs.writeFile(CUSTOMERS_PATH, JSON.stringify(customers, null, 2), 'utf-8');
  res.json(customers[idx]);
});

app.post('/api/customers', requireAuth, async (req, res) => {
  const { name, contact_email, brand_id, location_id, plausible_domain } = req.body;
  if (!name || !contact_email || !brand_id) {
    return res.status(400).json({ error: 'name, contact_email och brand_id krävs' });
  }
  const id = name.toLowerCase()
    .replace(/å/g, 'a').replace(/ä/g, 'a').replace(/ö/g, 'o')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

  const raw = await fs.readFile(CUSTOMERS_PATH, 'utf-8');
  const customers = JSON.parse(raw);
  if (customers.find(c => c.id === id)) {
    return res.status(409).json({ error: `id "${id}" finns redan` });
  }
  const newCustomer = {
    id, name, contact_email, active: true,
    metricool: { brand_id },
    google:    { location_id: location_id || '' },
    website:   { platform: '', plausible_domain: plausible_domain || '' }
  };
  customers.push(newCustomer);
  await fs.writeFile(CUSTOMERS_PATH, JSON.stringify(customers, null, 2), 'utf-8');
  res.status(201).json(newCustomer);
});

// ── API: delivery status ──────────────────────────────────
app.get('/api/status', requireAuth, async (_req, res) => {
  const months = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      year:  d.getFullYear(),
      month: d.getMonth() + 1,
      key:   `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    });
  }

  const logs = {};
  for (const { key } of months) {
    let delivered = [], failed = [];
    try { delivered = JSON.parse(await fs.readFile(path.join(LOGS_DIR, `delivered-${key}.json`), 'utf-8')); } catch {}
    try { failed    = JSON.parse(await fs.readFile(path.join(LOGS_DIR, `failed-${key}.json`),    'utf-8')); } catch {}
    logs[key] = { delivered, failed: failed.map(f => f.customerId ?? f) };
  }
  res.json({ months, logs });
});

app.listen(PORT, () => {
  console.log(`Dashboard körs på http://localhost:${PORT}`);
});
