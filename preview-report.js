/**
 * Preview-script – genererar en HTML-rapport med exempeldata.
 * Kräver inga npm-paket, bara inbyggd Node.js.
 *
 * Kör: node preview-report.js
 * Öppna sedan: output/preview-rapport.html i din webbläsare.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, 'templates', 'report.html');
const OUTPUT_PATH = path.join(__dirname, 'output', 'preview-rapport.html');

// ── Exempeldata – Restaurang Lyktan, Februari 2026 ────────────────────

const customer = {
  id: 'kund_001',
  name: 'Restaurang Lyktan',
  contact_email: 'info@lyktan.se'
};

const month = 2;
const year = 2026;
const monthName = 'Februari';
const agencyName = 'Syns Nu Media';
const agencyEmail = 'philio@synsnumedia.com';

const data = {
  metricool: {
    social: {
      instagram: {
        reach: 8420,
        impressions: 14300,
        engagement: 612,
        followerGrowth: 87,
        likes: 489,
        comments: 73,
        saves: 134
      },
      facebook: {
        reach: 3150,
        impressions: 6200,
        engagement: 218,
        followerGrowth: 23,
        likes: 164,
        comments: 38,
        shares: 22
      }
    },
    topPosts: [
      {
        network: 'Instagram',
        thumbnail: null,
        caption: '🍽️ Veckans specialmeny är här! Bearnaisebiff med handskurna pommes och hemgjord bearnaisesås. Boka bord via länken i bio. #restauranglyktan #middag #stockholmmat',
        likes: 312,
        comments: 28,
        engagementRate: 4.7
      },
      {
        network: 'Instagram',
        thumbnail: null,
        caption: '☕ Perfekt söndagslunch med familjen! Kom och njut av vår söndagsbuffé 12–15. Barnmeny ingår. #söndagslunch #familj #buffé',
        likes: 198,
        comments: 19,
        engagementRate: 3.2
      },
      {
        network: 'Facebook',
        thumbnail: null,
        caption: '🎉 Valentinstips! Boka ett romantiskt bord för er på Alla hjärtans dag. Specialmeny med 3 rätter + vin. Begränsat antal platser – boka redan idag!',
        likes: 143,
        comments: 31,
        engagementRate: 2.9
      }
    ],
    ads: {
      spend: 1500,
      currency: 'SEK',
      reach: 18600,
      clicks: 342,
      roas: 3.8
    }
  },
  google: {
    impressions: {
      search: 2840,
      maps: 1190
    },
    actions: {
      websiteClicks: 183,
      phoneCalls: 47,
      directions: 92,
      photoViews: 640
    },
    reviews: {
      averageRating: 4.6,
      totalReviews: 218
    }
  },
  plausible: {
    visitors: 1240,
    pageviews: 3870,
    bounceRate: 42,
    visitDuration: 118,
    topSources: [
      { source: 'Google', visitors: 580 },
      { source: 'Instagram', visitors: 210 },
      { source: 'Direkt', visitors: 190 },
      { source: 'Facebook', visitors: 145 },
      { source: 'Övrigt', visitors: 115 }
    ],
    topPages: [
      { page: '/', visitors: 890 },
      { page: '/meny', visitors: 640 },
      { page: '/boka-bord', visitors: 420 },
      { page: '/om-oss', visitors: 185 },
      { page: '/kontakt', visitors: 130 }
    ]
  }
};

const aiInsights = {
  summary: 'Februari var en stark månad för Restaurang Lyktan med tydlig tillväxt på Instagram (+87 följare) och ett lyckat Alla hjärtans dag-kampanj som genererade hög engagemang. Räckvidden på sociala medier ökade med 12% jämfört med januari, och Google Business visar att allt fler hittar er via Sök och Maps. Meta Ads-kampanjen levererade ett ROAS på 3.8x vilket är mycket bra för restaurangbranschen.',
  recommendations: [
    'Kör mer video-content på Instagram Reels – korta klipp från köket eller "behind the scenes" brukar generera 3–4x mer räckvidd än stillbilder och kostar inget extra.',
    'Ni har 218 Google-recensioner med snitt 4.6 – skicka en påminnelse i nästa nyhetsbrev till stamgäster att lämna recension, målet bör vara 250 recensioner inför sommarsäsongen.',
    'Bokmeny-sidan (/boka-bord) är den tredje mest besökta sidan men konverteringsdata saknas – koppla på ett enkelt bokningsformulär med bekräftelse-mail för att minska bortfall.'
  ]
};

// ── Hjälpfunktioner (kopior från pdfGenerator.js) ──────────────────────

function replaceToken(html, token, value) {
  return html.replaceAll(`{{${token}}}`, value ?? '');
}

function showSection(html, key) {
  html = html.replace(new RegExp(`\\{\\{#IF_${key}\\}\\}`, 'g'), '');
  html = html.replace(new RegExp(`\\{\\{/IF_${key}\\}\\}`, 'g'), '');
  html = html.replace(new RegExp(`\\{\\{#ELSE_${key}\\}\\}[\\s\\S]*?\\{\\{/ELSE_${key}\\}\\}`, 'g'), '');
  return html;
}

function hideSection(html, key) {
  html = html.replace(new RegExp(`\\{\\{#IF_${key}\\}\\}[\\s\\S]*?\\{\\{/IF_${key}\\}\\}`, 'g'), '');
  html = html.replace(new RegExp(`\\{\\{#ELSE_${key}\\}\\}`, 'g'), '');
  html = html.replace(new RegExp(`\\{\\{/ELSE_${key}\\}\\}`, 'g'), '');
  return html;
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmt(n) {
  return Number(n ?? 0).toLocaleString('sv-SE');
}

// ── Generera HTML ──────────────────────────────────────────────────────

let html = await fs.readFile(TEMPLATE_PATH, 'utf-8');

html = replaceToken(html, 'CUSTOMER_NAME', escHtml(customer.name));
html = replaceToken(html, 'REPORT_MONTH', monthName);
html = replaceToken(html, 'REPORT_YEAR', String(year));
html = replaceToken(html, 'AGENCY_NAME', escHtml(agencyName));
html = replaceToken(html, 'AGENCY_EMAIL', escHtml(agencyEmail));

// Sociala medier
const social = data.metricool?.social;
html = showSection(html, 'SOCIAL');
html = replaceToken(html, 'IG_REACH', fmt(social.instagram.reach));
html = replaceToken(html, 'IG_IMPRESSIONS', fmt(social.instagram.impressions));
html = replaceToken(html, 'IG_ENGAGEMENT', fmt(social.instagram.engagement));
html = replaceToken(html, 'IG_FOLLOWER_GROWTH', fmt(social.instagram.followerGrowth));
html = replaceToken(html, 'IG_LIKES', fmt(social.instagram.likes));
html = replaceToken(html, 'IG_COMMENTS', fmt(social.instagram.comments));
html = replaceToken(html, 'IG_SAVES', fmt(social.instagram.saves));
html = replaceToken(html, 'FB_REACH', fmt(social.facebook.reach));
html = replaceToken(html, 'FB_IMPRESSIONS', fmt(social.facebook.impressions));
html = replaceToken(html, 'FB_ENGAGEMENT', fmt(social.facebook.engagement));
html = replaceToken(html, 'FB_FOLLOWER_GROWTH', fmt(social.facebook.followerGrowth));
html = replaceToken(html, 'FB_LIKES', fmt(social.facebook.likes));
html = replaceToken(html, 'FB_COMMENTS', fmt(social.facebook.comments));
html = replaceToken(html, 'FB_SHARES', fmt(social.facebook.shares));

// Top Posts
html = showSection(html, 'POSTS');
const postsHtml = data.metricool.topPosts.map(post => `
  <div class="post-card">
    <div class="post-thumb-placeholder">📸</div>
    <div class="post-body">
      <span class="post-badge">${escHtml(post.network)}</span>
      <p class="post-caption">${escHtml(post.caption)}</p>
      <div class="post-stats">
        <span>❤️ <strong>${fmt(post.likes)}</strong></span>
        <span>💬 <strong>${fmt(post.comments)}</strong></span>
        <span>📈 <strong>${post.engagementRate.toFixed(1)}%</strong></span>
      </div>
    </div>
  </div>
`).join('');
html = replaceToken(html, 'TOP_POSTS_HTML', postsHtml);

// Meta Ads
const ads = data.metricool.ads;
html = showSection(html, 'ADS');
html = replaceToken(html, 'ADS_SPEND', fmt(ads.spend));
html = replaceToken(html, 'ADS_CURRENCY', ads.currency);
html = replaceToken(html, 'ADS_REACH', fmt(ads.reach));
html = replaceToken(html, 'ADS_CLICKS', fmt(ads.clicks));
html = replaceToken(html, 'ADS_ROAS', `${ads.roas.toFixed(2)}x`);

// Google Business
const google = data.google;
html = showSection(html, 'GOOGLE');
html = replaceToken(html, 'G_IMPRESSIONS_SEARCH', fmt(google.impressions.search));
html = replaceToken(html, 'G_IMPRESSIONS_MAPS', fmt(google.impressions.maps));
html = replaceToken(html, 'G_WEBSITE_CLICKS', fmt(google.actions.websiteClicks));
html = replaceToken(html, 'G_PHONE_CALLS', fmt(google.actions.phoneCalls));
html = replaceToken(html, 'G_DIRECTIONS', fmt(google.actions.directions));
html = replaceToken(html, 'G_PHOTO_VIEWS', fmt(google.actions.photoViews));
html = replaceToken(html, 'G_AVG_RATING', google.reviews.averageRating.toFixed(1));
html = replaceToken(html, 'G_TOTAL_REVIEWS', fmt(google.reviews.totalReviews));

// Hemsida
const web = data.plausible;
html = showSection(html, 'WEBSITE');
html = replaceToken(html, 'WEB_VISITORS', fmt(web.visitors));
html = replaceToken(html, 'WEB_PAGEVIEWS', fmt(web.pageviews));
html = replaceToken(html, 'WEB_BOUNCE_RATE', String(web.bounceRate));
html = replaceToken(html, 'WEB_DURATION', String(web.visitDuration));

const sourcesRows = web.topSources.map(s =>
  `<tr><td>${escHtml(s.source)}</td><td>${fmt(s.visitors)}</td></tr>`
).join('');
html = replaceToken(html, 'WEB_SOURCES_ROWS', sourcesRows);

const pagesRows = web.topPages.map(p =>
  `<tr><td>${escHtml(p.page)}</td><td>${fmt(p.visitors)}</td></tr>`
).join('');
html = replaceToken(html, 'WEB_PAGES_ROWS', pagesRows);

// AI Insikter
html = replaceToken(html, 'AI_SUMMARY', escHtml(aiInsights.summary));
const recsHtml = aiInsights.recommendations.map((rec, i) =>
  `<li><span class="rec-num">${i + 1}</span><span>${escHtml(rec)}</span></li>`
).join('');
html = replaceToken(html, 'AI_RECOMMENDATIONS_HTML', recsHtml);

// ── Spara ──────────────────────────────────────────────────────────────

await fs.mkdir(path.join(__dirname, 'output'), { recursive: true });
await fs.writeFile(OUTPUT_PATH, html, 'utf-8');

console.log(`\n✅ Preview klar! Öppna filen i din webbläsare:\n`);
console.log(`   ${OUTPUT_PATH}\n`);
console.log(`   Tips: I webbläsaren kan du trycka Cmd+P → "Spara som PDF" för att se exakt hur PDFen ser ut.\n`);
