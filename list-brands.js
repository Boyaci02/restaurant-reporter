/**
 * Listar alla brands/konton som är kopplade till ditt Metricool-konto.
 * Kör: node list-brands.js
 */

import 'dotenv/config';
import axios from 'axios';

const apiKey = process.env.METRICOOL_API_KEY;
const userId = process.env.METRICOOL_USER_ID;

if (!apiKey || !userId) {
  console.error('Saknar METRICOOL_API_KEY eller METRICOOL_USER_ID i .env');
  process.exit(1);
}

console.log('\nHämtar dina Metricool-brands...\n');

try {
  const res = await axios.get('https://app.metricool.com/api/admin/simpleProfiles', {
    headers: { 'X-Mc-Auth': apiKey },
    params: { userId }
  });

  const brands = res.data?.brands || res.data?.profiles || res.data || [];

  if (!Array.isArray(brands) || brands.length === 0) {
    console.log('Inga brands hittades. API-svar:');
    console.log(JSON.stringify(res.data, null, 2));
  } else {
    console.log(`Hittade ${brands.length} brand(s):\n`);
    brands.forEach((b, i) => {
      // Google location_id: extrahera "locations/xxx" ur gmb-strängen
      const googleLocationId = b.gmb
        ? 'locations/' + b.gmb.split('/locations/')[1]
        : null;

      // Vilka sociala nätverk är kopplade
      const networks = [
        b.instagram    && 'Instagram',
        b.facebook     && 'Facebook',
        b.tiktok       && 'TikTok',
        b.linkedinCompany && 'LinkedIn',
        b.youtube      && 'YouTube',
        b.gmb          && 'Google Business'
      ].filter(Boolean).join(', ');

      console.log(`  ${i + 1}. ${b.label || '(inget namn)'}`);
      console.log(`     brand_id (Metricool):   ${b.id}`);
      console.log(`     location_id (Google):   ${googleLocationId || '— ej kopplat'}`);
      console.log(`     Nätverk: ${networks || '?'}`);
      console.log();
    });
    console.log('Kopiera brand_id och location_id till customers.json för varje kund.\n');
  }
} catch (err) {
  console.error('Fel:', err.response?.status, err.response?.data || err.message);
  console.log('\nAPI-svar:', JSON.stringify(err.response?.data, null, 2));
}
