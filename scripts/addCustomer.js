import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CUSTOMERS_PATH = path.join(__dirname, '..', 'data', 'customers.json');

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

function nameToId(name) {
  return name
    .toLowerCase()
    .replace(/å/g, 'a').replace(/ä/g, 'a').replace(/ö/g, 'o')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const raw = await fs.readFile(CUSTOMERS_PATH, 'utf-8');
const customers = JSON.parse(raw);

console.log('\n── Lägg till ny kund ──────────────────────────────────\n');

const name         = (await ask(rl, 'Restaurangens namn:                    ')).trim();
const email        = (await ask(rl, 'Kontakt-e-post:                        ')).trim();
const brandId      = (await ask(rl, 'Metricool Brand ID:                    ')).trim();
const locationId   = (await ask(rl, 'Google location_id (lämna tom om ej):  ')).trim();
const plausibleDomain = (await ask(rl, 'Plausible-domän    (lämna tom om ej):  ')).trim();

rl.close();

const id = nameToId(name);

if (!name || !email || !brandId) {
  console.error('\n❌ Namn, e-post och Metricool Brand ID är obligatoriska.\n');
  process.exit(1);
}

if (customers.find(c => c.id === id)) {
  console.error(`\n❌ En kund med id "${id}" finns redan. Redigera data/customers.json direkt.\n`);
  process.exit(1);
}

const newCustomer = {
  id,
  name,
  contact_email: email,
  active: true,
  metricool: { brand_id: brandId },
  google: { location_id: locationId },
  website: { platform: '', plausible_domain: plausibleDomain }
};

customers.push(newCustomer);
await fs.writeFile(CUSTOMERS_PATH, JSON.stringify(customers, null, 2), 'utf-8');

console.log(`\n✅ Kund tillagd: ${id}`);
console.log(`   Sätt active: false i data/customers.json om du vill pausa kunden.\n`);
