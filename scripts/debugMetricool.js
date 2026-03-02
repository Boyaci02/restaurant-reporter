/**
 * Debug script – dumps raw Metricool API responses for a customer.
 * Saves output to logs/debug-metricool-{customerId}.json
 *
 * Usage:
 *   node scripts/debugMetricool.js --id=sushi_revolution [--month=2] [--year=2026]
 */
import 'dotenv/config';
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE_URL   = 'https://app.metricool.com/api';
const V2_BASE_URL = 'https://app.metricool.com/api/v2';

const args      = process.argv.slice(2);
const idArg     = args.find(a => a.startsWith('--id='));
const monthArg  = args.find(a => a.startsWith('--month='));
const yearArg   = args.find(a => a.startsWith('--year='));

if (!idArg) {
  console.error('Usage: node scripts/debugMetricool.js --id=sushi_revolution [--month=2] [--year=2026]');
  process.exit(1);
}

const now       = new Date();
const customerId = idArg.replace('--id=', '');
const month     = monthArg ? parseInt(monthArg.replace('--month=', ''), 10) : now.getMonth() + 1;
const year      = yearArg  ? parseInt(yearArg.replace('--year=', ''),  10) : now.getFullYear();

const apiKey  = process.env.METRICOOL_API_KEY;
const userId  = process.env.METRICOOL_USER_ID;
if (!apiKey || !userId) {
  console.error('METRICOOL_API_KEY and METRICOOL_USER_ID must be set in .env');
  process.exit(1);
}

// Load customer
const customersRaw = await fs.readFile(path.join(__dirname, '..', 'data', 'customers.json'), 'utf-8');
const customers    = JSON.parse(customersRaw);
const customer     = customers.find(c => c.id === customerId);
if (!customer) {
  console.error(`Customer "${customerId}" not found`);
  process.exit(1);
}

const brandId = customer.metricool?.brand_id;
if (!brandId) {
  console.error(`Customer "${customerId}" has no metricool.brand_id`);
  process.exit(1);
}

const headers = { 'X-Mc-Auth': apiKey };
const lastDay = new Date(year, month, 0).getDate();
const pad     = n => String(n).padStart(2, '0');

const startDate = `${year}${pad(month)}01`;
const endDate   = `${year}${pad(month)}${pad(lastDay)}`;
const monthDate = `${year}${pad(month)}01`;
const isoFrom   = `${year}-${pad(month)}-01T00:00:00`;
const isoTo     = `${year}-${pad(month)}-${pad(lastDay)}T23:59:59`;
const base      = { userId, blogId: brandId };

console.log(`\n🔍 Debugging Metricool for: ${customer.name} (brand_id: ${brandId})`);
console.log(`   Period: ${year}-${pad(month)} (${startDate} → ${endDate})\n`);

async function fetch(label, url, params) {
  try {
    const res = await axios.get(url, { headers, params });
    return { label, status: res.status, data: res.data };
  } catch (err) {
    return { label, status: err.response?.status ?? 'ERR', error: err.message, data: err.response?.data ?? null };
  }
}

const results = await Promise.all([
  fetch('FB stats',           `${BASE_URL}/stats/values/Facebook`,          { ...base, date: monthDate }),
  fetch('IG stats',           `${BASE_URL}/stats/values/Instagram`,         { ...base, date: monthDate }),
  fetch('Google stats',       `${BASE_URL}/stats/values/Google`,            { ...base, date: monthDate }),
  fetch('FB posts',           `${BASE_URL}/stats/facebook/posts`,           { ...base, start: startDate, end: endDate, sortcolumn: 'engagement' }),
  fetch('IG posts',           `${BASE_URL}/stats/instagram/posts`,          { ...base, start: startDate, end: endDate, sortcolumn: 'engagement' }),
  fetch('IG stories',         `${BASE_URL}/stats/instagram/stories`,        { ...base, start: startDate, end: endDate }),
  fetch('Meta Ads',           `${BASE_URL}/stats/facebookads/campaigns`,    { ...base, start: startDate, end: endDate }),
  fetch('Web visitors',       `${BASE_URL}/stats/timeline/Visitors`,        { ...base, start: startDate, end: endDate }),
  fetch('Web pageviews',      `${BASE_URL}/stats/timeline/PageViews`,       { ...base, start: startDate, end: endDate }),
  fetch('Web referrers',      `${BASE_URL}/stats/distribution/referrers`,   { ...base, start: startDate, end: endDate }),
  fetch('TT posts (v2)',      `${V2_BASE_URL}/analytics/posts/tiktok`,      { blogId: brandId, from: isoFrom, to: isoTo }),
  fetch('TT video_views',     `${V2_BASE_URL}/analytics/aggregation`, { blogId: brandId, network: 'tiktok', metric: 'video_views',          subject: 'account', from: isoFrom, to: isoTo }),
  fetch('TT followers',       `${V2_BASE_URL}/analytics/aggregation`, { blogId: brandId, network: 'tiktok', metric: 'followers_count',       subject: 'account', from: isoFrom, to: isoTo }),
  fetch('TT follower_delta',  `${V2_BASE_URL}/analytics/aggregation`, { blogId: brandId, network: 'tiktok', metric: 'followers_delta_count', subject: 'account', from: isoFrom, to: isoTo }),
  fetch('TT likes',           `${V2_BASE_URL}/analytics/aggregation`, { blogId: brandId, network: 'tiktok', metric: 'likes',                subject: 'account', from: isoFrom, to: isoTo }),
  fetch('TT comments',        `${V2_BASE_URL}/analytics/aggregation`, { blogId: brandId, network: 'tiktok', metric: 'comments',             subject: 'account', from: isoFrom, to: isoTo }),
  fetch('TT shares',          `${V2_BASE_URL}/analytics/aggregation`, { blogId: brandId, network: 'tiktok', metric: 'shares',               subject: 'account', from: isoFrom, to: isoTo }),
]);

// Print summary
console.log('── RESULTS SUMMARY ──────────────────────────────────────\n');
for (const r of results) {
  const ok = r.status === 200;
  const icon = ok ? '✅' : '❌';
  const dataPreview = ok
    ? (Array.isArray(r.data) ? `array[${r.data.length}]` : `object{${Object.keys(r.data || {}).join(', ')}}`)
    : r.error;
  console.log(`${icon} [${r.status}] ${r.label.padEnd(20)} → ${dataPreview}`);
}

// Save full output to JSON
const outDir  = path.join(__dirname, '..', 'logs');
await fs.mkdir(outDir, { recursive: true });
const outFile = path.join(outDir, `debug-metricool-${customerId}.json`);
await fs.writeFile(outFile, JSON.stringify(results, null, 2), 'utf-8');

console.log(`\n📄 Full raw data saved to: ${outFile}\n`);
