import 'dotenv/config';
import cron from 'node-cron';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { runReport } from './reportRunner.js';
import { createLogger } from './logger.js';
import { startDashboard } from './dashboard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CUSTOMERS_PATH = path.join(__dirname, '..', 'data', 'customers.json');

const logger = createLogger('index');

async function loadActiveCustomers() {
  const raw = await fs.readFile(CUSTOMERS_PATH, 'utf-8');
  const all = JSON.parse(raw);
  return all.filter(c => c.active === true);
}

/**
 * Runs the full monthly report cycle for all active customers.
 * @param {number} month - Month (1-12)
 * @param {number} year - Full year
 */
async function runMonthlyReports(month, year) {
  logger.info('Starting monthly report run', { month, year });

  let customers;
  try {
    customers = await loadActiveCustomers();
  } catch (err) {
    logger.error('Failed to load customers.json', { error: err.message });
    return;
  }

  logger.info(`Processing ${customers.length} active customers`);

  let successCount = 0;
  let failCount = 0;

  for (const customer of customers) {
    try {
      await runReport(customer, month, year);
      successCount++;
    } catch (err) {
      logger.error('Report failed for customer', {
        customerId: customer.id,
        error: err.message
      });
      failCount++;
    }
  }

  logger.info('Monthly report run complete', {
    total: customers.length,
    success: successCount,
    failed: failCount
  });
}

function isLastDayOfMonth(date) {
  const nextDay = new Date(date);
  nextDay.setDate(date.getDate() + 1);
  return nextDay.getMonth() !== date.getMonth();
}

// ── Immediate run via --now flag ─────────────────────────
const args = process.argv.slice(2);
if (args.includes('--now')) {
  const now = new Date();
  logger.info('Immediate run triggered via --now flag');
  await runMonthlyReports(now.getMonth() + 1, now.getFullYear());
  process.exit(0);
}

// ── Dashboard ─────────────────────────────────────────────
startDashboard();

// ── Monthly cron: 08:00 on the last day of every month ──
logger.info('Restaurant Reporter started – waiting for scheduled run (08:00 on last day of month)');

cron.schedule('0 8 * * *', async () => {
  const now = new Date();
  if (!isLastDayOfMonth(now)) return;
  await runMonthlyReports(now.getMonth() + 1, now.getFullYear());
}, {
  timezone: 'Europe/Stockholm'
});
