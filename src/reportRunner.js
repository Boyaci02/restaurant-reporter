import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchMetricoolData } from './metricool.js';
import { fetchGoogleData } from './googleBusiness.js';
import { fetchPlausibleData } from './plausible.js';
import { generateAISummary } from './aiSummary.js';
import { generatePDF } from './pdfGenerator.js';
import { sendReport } from './mailer.js';
import { createLogger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CUSTOMERS_PATH = path.join(__dirname, '..', 'data', 'customers.json');
const LOGS_DIR = path.join(__dirname, '..', 'logs');

/**
 * Loads all active customers from customers.json.
 * @returns {Promise<object[]>}
 */
async function loadCustomers() {
  const raw = await fs.readFile(CUSTOMERS_PATH, 'utf-8');
  const all = JSON.parse(raw);
  return all.filter(c => c.active === true);
}

/**
 * Checks if a customer has already received their report this month.
 * @param {string} customerId
 * @param {number} month
 * @param {number} year
 * @returns {Promise<boolean>}
 */
async function alreadyDelivered(customerId, month, year) {
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const logFile = path.join(LOGS_DIR, `delivered-${monthKey}.json`);
  try {
    const raw = await fs.readFile(logFile, 'utf-8');
    const delivered = JSON.parse(raw);
    return Array.isArray(delivered) && delivered.includes(customerId);
  } catch {
    return false;
  }
}

/**
 * Records a successful delivery in the monthly delivery log.
 * @param {string} customerId
 * @param {number} month
 * @param {number} year
 */
async function recordDelivery(customerId, month, year) {
  await fs.mkdir(LOGS_DIR, { recursive: true });
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const logFile = path.join(LOGS_DIR, `delivered-${monthKey}.json`);

  let delivered = [];
  try {
    const raw = await fs.readFile(logFile, 'utf-8');
    delivered = JSON.parse(raw);
  } catch { /* file doesn't exist yet */ }

  if (!delivered.includes(customerId)) {
    delivered.push(customerId);
    await fs.writeFile(logFile, JSON.stringify(delivered, null, 2), 'utf-8');
  }
}

/**
 * Records a failed delivery in the monthly failure log.
 * @param {string} customerId
 * @param {string} errorMessage
 * @param {number} month
 * @param {number} year
 */
async function recordFailure(customerId, errorMessage, month, year) {
  await fs.mkdir(LOGS_DIR, { recursive: true });
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const logFile = path.join(LOGS_DIR, `failed-${monthKey}.json`);

  let failures = [];
  try {
    const raw = await fs.readFile(logFile, 'utf-8');
    failures = JSON.parse(raw);
  } catch { /* file doesn't exist yet */ }

  failures.push({ customerId, errorMessage, timestamp: new Date().toISOString() });
  await fs.writeFile(logFile, JSON.stringify(failures, null, 2), 'utf-8');
}

/**
 * Runs the full report pipeline for a single customer.
 * @param {object} customer - Customer object
 * @param {number} month - Month (1-12)
 * @param {number} year - Full year
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false] - Skip email, keep PDF locally
 */
export async function runReport(customer, month, year, { dryRun = false } = {}) {
  const logger = createLogger('reportRunner', customer.id);

  // ── Duplicate guard ──────────────────────────────────────
  if (!dryRun && await alreadyDelivered(customer.id, month, year)) {
    logger.info('Report already delivered this month, skipping');
    return;
  }

  logger.info('Starting report generation', { month, year, dryRun });

  // ── 1–3. Fetch data from all sources (parallel) ──────────
  logger.info('Fetching data from all sources');
  const [metricool, google, plausible] = await Promise.all([
    fetchMetricoolData(customer, month, year).catch(err => {
      logger.warn('Metricool fetch failed', { error: err.message });
      return null;
    }),
    fetchGoogleData(customer, month, year).catch(err => {
      logger.warn('Google Business fetch failed', { error: err.message });
      return null;
    }),
    fetchPlausibleData(customer, month, year).catch(err => {
      logger.warn('Plausible fetch failed', { error: err.message });
      return null;
    })
  ]);

  // Use direct Google API data; fall back to Metricool GMB data if unavailable
  const googleData = google ?? metricool?.googleBusiness ?? null;
  const data = { metricool, google: googleData, plausible };

  // ── 4. Generate AI summary ───────────────────────────────
  logger.info('Generating AI insights');
  const aiInsights = await generateAISummary(customer.name, data, month, year);

  // ── 5–6. Generate PDF ────────────────────────────────────
  logger.info('Generating PDF');
  const pdfPath = await generatePDF(customer, data, aiInsights, month, year);

  if (dryRun) {
    logger.info('Dry run – PDF saved locally, skipping email', { pdfPath });
    console.log(`\n✅ PDF sparad: ${pdfPath}\n`);
    return;
  }

  // ── 7. Send email ────────────────────────────────────────
  try {
    await sendReport(customer, pdfPath, month, year);

    // ── 8. Log delivery ──────────────────────────────────────
    await recordDelivery(customer.id, month, year);
    logger.info('Report delivered successfully');

    // ── 9. Cleanup PDF ───────────────────────────────────────
    await fs.unlink(pdfPath);
    logger.info('Temporary PDF deleted');
  } catch (err) {
    logger.error('Failed to send report email', { error: err.message });
    await recordFailure(customer.id, err.message, month, year);
    throw err;
  }
}

// ── CLI entrypoint ───────────────────────────────────────
// Usage:
//   npm run test-customer -- --id=kund_001   (dry run for one customer)
//   npm run generate-all                     (all active customers)

const args = process.argv.slice(2);
const isDirectRun = process.argv[1] && process.argv[1].endsWith('reportRunner.js');

if (isDirectRun) {
  const now = new Date();
  const monthArg = args.find(a => a.startsWith('--month='));
  const yearArg  = args.find(a => a.startsWith('--year='));
  const month = monthArg ? parseInt(monthArg.replace('--month=', ''), 10) : now.getMonth() + 1;
  const year  = yearArg  ? parseInt(yearArg.replace('--year=', ''),  10) : now.getFullYear();

  const idArg = args.find(a => a.startsWith('--id='));
  const runAll = args.includes('--all');

  const customers = await loadCustomers();

  if (idArg) {
    const customerId = idArg.replace('--id=', '');
    const customer = customers.find(c => c.id === customerId);
    if (!customer) {
      console.error(`Kund "${customerId}" hittades inte eller är inaktiv.`);
      process.exit(1);
    }
    await runReport(customer, month, year, { dryRun: !args.includes('--send') });
  } else if (runAll) {
    console.log(`Kör rapporter för ${customers.length} aktiva kunder…`);
    for (const customer of customers) {
      try {
        await runReport(customer, month, year, { dryRun: false });
      } catch (err) {
        console.error(`Fel för ${customer.id}: ${err.message}`);
      }
    }
    console.log('Alla rapporter klara.');
  } else {
    console.log('Användning:');
    console.log('  npm run test-customer -- --id=kund_001');
    console.log('  npm run generate-all');
  }
}
