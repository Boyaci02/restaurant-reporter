import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'report.html');
const OUTPUT_DIR = path.join(__dirname, '..', 'output');

const MONTH_NAMES_SV = [
  'Januari', 'Februari', 'Mars', 'April', 'Maj', 'Juni',
  'Juli', 'Augusti', 'September', 'Oktober', 'November', 'December'
];

/**
 * Generates a PDF report for a customer.
 * @param {object} customer - Customer object from customers.json
 * @param {object} data - Combined data: { metricool, google, plausible }
 * @param {{summary: string, recommendations: string[]}} aiInsights - Claude AI output
 * @param {number} month - Month (1-12)
 * @param {number} year - Full year
 * @returns {Promise<string>} Absolute path to the generated PDF
 */
export async function generatePDF(customer, data, aiInsights, month, year) {
  const logger = createLogger('pdfGenerator', customer.id);

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const monthName = MONTH_NAMES_SV[month - 1];
  const agencyName = process.env.MAIL_FROM_NAME || 'Rapport';
  const agencyEmail = process.env.MAIL_FROM_ADDRESS || '';

  logger.info('Reading HTML template');
  let html = await fs.readFile(TEMPLATE_PATH, 'utf-8');

  // ── Base substitutions ──────────────────────────────────
  html = replaceToken(html, 'CUSTOMER_NAME', escHtml(customer.name));
  html = replaceToken(html, 'REPORT_MONTH', monthName);
  html = replaceToken(html, 'REPORT_YEAR', String(year));
  html = replaceToken(html, 'AGENCY_NAME', escHtml(agencyName));
  html = replaceToken(html, 'AGENCY_EMAIL', escHtml(agencyEmail));

  // ── Social Media ────────────────────────────────────────
  const social = data.metricool?.social;
  const ig = social?.instagram;
  const fb = social?.facebook;
  const tt = social?.tiktok;
  if (ig || fb || tt) {
    html = showSection(html, 'SOCIAL');
    if (tt) {
      // Switch to 3-column grid when TikTok is present
      html = html.replace('class="platform-split"', 'class="platform-split has-tiktok"');
    }
    html = replaceToken(html, 'IG_REACH',          fmt(ig?.reach));
    html = replaceToken(html, 'IG_IMPRESSIONS',    fmt(ig?.impressions));
    html = replaceToken(html, 'IG_ENGAGEMENT',     fmt(ig?.engagement));
    html = replaceToken(html, 'IG_FOLLOWER_GROWTH',fmt(ig?.followerGrowth));
    html = replaceToken(html, 'IG_LIKES',          fmt(ig?.likes));
    html = replaceToken(html, 'IG_COMMENTS',       fmt(ig?.comments));
    html = replaceToken(html, 'IG_SAVES',          fmt(ig?.saves));

    // Show note when reach/impressions come from stories only (no posts)
    const igHasPosts = (ig?.likes ?? 0) > 0 || (ig?.comments ?? 0) > 0 || (ig?.saves ?? 0) > 0;
    const igStoriesOnly = !igHasPosts && (ig?.stories?.count ?? 0) > 0;
    if (igStoriesOnly) {
      html = showSection(html, 'IG_STORIES_ONLY');
    } else {
      html = hideSection(html, 'IG_STORIES_ONLY');
    }

    // Instagram Stories
    const stories = ig?.stories;
    if (stories && stories.count > 0) {
      html = showSection(html, 'IG_STORIES');
      html = replaceToken(html, 'IG_STORIES_COUNT',       fmt(stories.count));
      html = replaceToken(html, 'IG_STORIES_IMPRESSIONS', fmt(stories.impressions));
      html = replaceToken(html, 'IG_STORIES_REACH',       fmt(stories.reach));
      html = replaceToken(html, 'IG_STORIES_REPLIES',     fmt(stories.replies));
    } else {
      html = hideSection(html, 'IG_STORIES');
    }

    if (fb) {
      html = showSection(html, 'FB');
      html = replaceToken(html, 'FB_REACH',          fmt(fb.reach));
      html = replaceToken(html, 'FB_IMPRESSIONS',    fmt(fb.impressions));
      html = replaceToken(html, 'FB_ENGAGEMENT',     fmt(fb.engagement));
      html = replaceToken(html, 'FB_FOLLOWER_GROWTH',fmt(fb.followerGrowth));
      html = replaceToken(html, 'FB_LIKES',          fmt(fb.likes));
      html = replaceToken(html, 'FB_COMMENTS',       fmt(fb.comments));
      html = replaceToken(html, 'FB_SHARES',         fmt(fb.shares));
    } else {
      html = hideSection(html, 'FB');
    }

    // TikTok
    if (tt) {
      html = showSection(html, 'TIKTOK');
      html = replaceToken(html, 'TT_VIDEO_VIEWS',      fmt(tt.videoViews));
      html = replaceToken(html, 'TT_REACH',            fmt(tt.reach));
      html = replaceToken(html, 'TT_ENGAGEMENT',       fmt(tt.engagement));
      html = replaceToken(html, 'TT_LIKES',            fmt(tt.likes));
      html = replaceToken(html, 'TT_COMMENTS',         fmt(tt.comments));
      html = replaceToken(html, 'TT_SHARES',           fmt(tt.shares));
      html = replaceToken(html, 'TT_FOLLOWER_GROWTH',  fmt(tt.followerGrowth));
      html = replaceToken(html, 'TT_TOTAL_FOLLOWERS',  fmt(tt.totalFollowers));
    } else {
      html = hideSection(html, 'TIKTOK');
    }
  } else {
    html = hideSection(html, 'SOCIAL');
    html = hideSection(html, 'TIKTOK');
  }

  // ── Posts per platform (all posts, tabular) ─────────────
  const byPlatform = data.metricool?.allPostsByPlatform;
  const fbPostsList = byPlatform?.facebook ?? [];
  const igPostsList = byPlatform?.instagram ?? [];
  const ttPostsList = byPlatform?.tiktok ?? [];
  const hasAnyPosts = fbPostsList.length > 0 || igPostsList.length > 0 || ttPostsList.length > 0;

  if (hasAnyPosts) {
    html = showSection(html, 'POSTS');

    // Helper: format epoch ms or ISO date string as DD/MM
    const fmtDate = raw => {
      if (!raw) return '—';
      const d = typeof raw === 'number' ? new Date(raw) : new Date(raw);
      if (isNaN(d)) return '—';
      return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
    };

    // Helper: post thumbnail + caption cell
    const postCell = (p) => `
      <div class="pt-post">
        ${p.thumbnail
          ? `<img class="pt-thumb" src="${escHtml(p.thumbnail)}" alt="" />`
          : `<div class="pt-thumb-ph"></div>`}
        <span class="pt-caption">${escHtml(p.caption || '')}</span>
      </div>`;

    if (fbPostsList.length > 0) {
      html = showSection(html, 'FB_POSTS');
      html = replaceToken(html, 'FB_POSTS_TABLE', fbPostsList.map(p => `
        <tr>
          <td class="pt-date">${fmtDate(p.date)}</td>
          <td>${postCell(p)}</td>
          <td class="pt-num">${fmt(p.reach)}</td>
          <td class="pt-num">${fmt(p.impressions)}</td>
          <td class="pt-num">${fmt(p.likes)}</td>
          <td class="pt-num">${fmt(p.comments)}</td>
          <td class="pt-num">${fmt(p.shares)}</td>
          <td class="pt-num">${(p.engagementRate || 0).toFixed(1)}%</td>
        </tr>`).join(''));
    } else {
      html = hideSection(html, 'FB_POSTS');
      html = replaceToken(html, 'FB_POSTS_TABLE', '');
    }

    if (igPostsList.length > 0) {
      html = showSection(html, 'IG_POSTS');
      html = replaceToken(html, 'IG_POSTS_TABLE', igPostsList.map(p => `
        <tr>
          <td class="pt-date">${fmtDate(p.date)}</td>
          <td>${postCell(p)}</td>
          <td class="pt-num">${fmt(p.reach)}</td>
          <td class="pt-num">${fmt(p.impressions)}</td>
          <td class="pt-num">${fmt(p.likes)}</td>
          <td class="pt-num">${fmt(p.comments)}</td>
          <td class="pt-num">${fmt(p.saves)}</td>
          <td class="pt-num">${(p.engagementRate || 0).toFixed(1)}%</td>
        </tr>`).join(''));
    } else {
      html = hideSection(html, 'IG_POSTS');
      html = replaceToken(html, 'IG_POSTS_TABLE', '');
    }

    if (ttPostsList.length > 0) {
      html = showSection(html, 'TT_POSTS');
      html = replaceToken(html, 'TT_POSTS_TABLE', ttPostsList.map(p => `
        <tr>
          <td class="pt-date">${fmtDate(p.date)}</td>
          <td>${postCell(p)}</td>
          <td class="pt-num">${fmt(p.views)}</td>
          <td class="pt-num">${fmt(p.reach)}</td>
          <td class="pt-num">${fmt(p.likes)}</td>
          <td class="pt-num">${fmt(p.comments)}</td>
          <td class="pt-num">${fmt(p.shares)}</td>
          <td class="pt-num">${(p.engagementRate || 0).toFixed(1)}%</td>
        </tr>`).join(''));
    } else {
      html = hideSection(html, 'TT_POSTS');
      html = replaceToken(html, 'TT_POSTS_TABLE', '');
    }
  } else {
    html = hideSection(html, 'POSTS');
    html = hideSection(html, 'FB_POSTS');
    html = hideSection(html, 'IG_POSTS');
    html = hideSection(html, 'TT_POSTS');
    html = replaceToken(html, 'FB_POSTS_TABLE', '');
    html = replaceToken(html, 'IG_POSTS_TABLE', '');
    html = replaceToken(html, 'TT_POSTS_TABLE', '');
  }

  // ── Meta Ads ────────────────────────────────────────────
  const ads = data.metricool?.ads;
  if (ads && ads.spend > 0) {
    html = showSection(html, 'ADS');
    html = replaceToken(html, 'ADS_SPEND', fmt(ads.spend));
    html = replaceToken(html, 'ADS_CURRENCY', escHtml(ads.currency || 'SEK'));
    html = replaceToken(html, 'ADS_REACH', fmt(ads.reach));
    html = replaceToken(html, 'ADS_CLICKS', fmt(ads.clicks));
    html = replaceToken(html, 'ADS_ROAS', ads.roas != null ? `${ads.roas.toFixed(2)}x` : '—');
  } else {
    html = hideSection(html, 'ADS');
  }

  // ── Google Business ─────────────────────────────────────
  const google = data.google;
  if (google) {
    html = showSection(html, 'GOOGLE');
    html = replaceToken(html, 'G_IMPRESSIONS_SEARCH', fmt(google.impressions.search));
    html = replaceToken(html, 'G_IMPRESSIONS_MAPS', fmt(google.impressions.maps));
    html = replaceToken(html, 'G_WEBSITE_CLICKS', fmt(google.actions.websiteClicks));
    html = replaceToken(html, 'G_PHONE_CALLS', fmt(google.actions.phoneCalls));
    html = replaceToken(html, 'G_DIRECTIONS', fmt(google.actions.directions));
    html = replaceToken(html, 'G_PHOTO_VIEWS', fmt(google.actions.photoViews));
    html = replaceToken(html, 'G_AVG_RATING', (google.reviews.averageRating || 0).toFixed(1));
    html = replaceToken(html, 'G_TOTAL_REVIEWS', fmt(google.reviews.totalReviews));
  } else {
    html = hideSection(html, 'GOOGLE');
  }

  // ── Website ─────────────────────────────────────────────
  const web = data.plausible ?? data.metricool?.web ?? null;
  if (web) {
    html = showSection(html, 'WEBSITE');
    html = replaceToken(html, 'WEB_VISITORS', fmt(web.visitors));
    html = replaceToken(html, 'WEB_PAGEVIEWS', fmt(web.pageviews));
    html = replaceToken(html, 'WEB_BOUNCE_RATE', String(web.bounceRate ?? 0));
    html = replaceToken(html, 'WEB_DURATION', String(web.visitDuration ?? 0));

    const sourcesRows = (web.topSources || []).map(s =>
      `<tr><td>${escHtml(s.source)}</td><td>${fmt(s.visitors)}</td></tr>`
    ).join('');
    html = replaceToken(html, 'WEB_SOURCES_ROWS', sourcesRows);

    const pagesRows = (web.topPages || []).map(p =>
      `<tr><td>${escHtml(p.page)}</td><td>${fmt(p.visitors)}</td></tr>`
    ).join('');
    html = replaceToken(html, 'WEB_PAGES_ROWS', pagesRows);
  } else {
    html = hideSection(html, 'WEBSITE');
    html = replaceToken(html, 'WEB_SOURCES_ROWS', '');
    html = replaceToken(html, 'WEB_PAGES_ROWS', '');
  }

  // ── AI Insights ─────────────────────────────────────────
  html = replaceToken(html, 'AI_SUMMARY', escHtml(aiInsights.summary));

  // ── Render PDF via Puppeteer ────────────────────────────
  const fileName = `rapport_${customer.id}_${year}-${String(month).padStart(2, '0')}.pdf`;
  const pdfPath = path.join(OUTPUT_DIR, fileName);

  logger.info('Launching Puppeteer');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' }
    });
  } finally {
    await browser.close();
  }

  logger.info('PDF generated', { pdfPath });
  return pdfPath;
}

// ── Helpers ──────────────────────────────────────────────

function replaceToken(html, token, value) {
  return html.replaceAll(`{{${token}}}`, value ?? '');
}

/** Show conditional section: keeps #IF block, removes #ELSE block */
function showSection(html, key) {
  html = html.replace(new RegExp(`\\{\\{#IF_${key}\\}\\}`, 'g'), '');
  html = html.replace(new RegExp(`\\{\\{/IF_${key}\\}\\}`, 'g'), '');
  html = html.replace(new RegExp(`\\{\\{#ELSE_${key}\\}\\}[\\s\\S]*?\\{\\{/ELSE_${key}\\}\\}`, 'g'), '');
  return html;
}

/** Hide conditional section: removes #IF block, shows #ELSE block */
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
