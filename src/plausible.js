import axios from 'axios';
import { createLogger } from './logger.js';
import { withRetry } from './retry.js';

const BASE_URL = 'https://plausible.io/api/v1';

/**
 * Fetches website analytics data from Plausible for a customer.
 * @param {object} customer - Customer object from customers.json
 * @param {number} month - Month (1-12)
 * @param {number} year - Full year (e.g. 2025)
 * @returns {Promise<object|null>} Plausible analytics data or null on failure
 */
export async function fetchPlausibleData(customer, month, year) {
  const logger = createLogger('plausible', customer.id);
  const domain = customer.website?.plausible_domain;

  if (!domain) {
    logger.warn('No plausible_domain configured, skipping Plausible');
    return null;
  }

  const apiKey = process.env.PLAUSIBLE_API_KEY;
  if (!apiKey) {
    logger.error('PLAUSIBLE_API_KEY not set');
    return null;
  }

  const headers = { Authorization: `Bearer ${apiKey}` };

  // Build period string: YYYY-MM format for Plausible custom date range
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
  const period = 'custom';

  const commonParams = { site_id: domain, period, date: `${startDate},${endDate}` };

  try {
    logger.info('Fetching Plausible data', { domain, startDate, endDate });

    const [statsRes, sourcesRes, pagesRes] = await Promise.all([
      withRetry(
        () => axios.get(`${BASE_URL}/stats/aggregate`, {
          headers,
          params: {
            ...commonParams,
            metrics: 'visitors,pageviews,bounce_rate,visit_duration'
          }
        }),
        { logger, label: 'plausible-stats' }
      ),
      withRetry(
        () => axios.get(`${BASE_URL}/stats/breakdown`, {
          headers,
          params: {
            ...commonParams,
            property: 'visit:source',
            metrics: 'visitors',
            limit: 5
          }
        }),
        { logger, label: 'plausible-sources' }
      ),
      withRetry(
        () => axios.get(`${BASE_URL}/stats/breakdown`, {
          headers,
          params: {
            ...commonParams,
            property: 'event:page',
            metrics: 'visitors,pageviews',
            limit: 5
          }
        }),
        { logger, label: 'plausible-pages' }
      )
    ]);

    const stats = statsRes.data?.results || {};
    const sources = sourcesRes.data?.results || [];
    const pages = pagesRes.data?.results || [];

    const result = {
      visitors: stats.visitors?.value ?? 0,
      pageviews: stats.pageviews?.value ?? 0,
      bounceRate: stats.bounce_rate?.value ?? 0,
      visitDuration: stats.visit_duration?.value ?? 0,
      topSources: sources.map(s => ({
        source: s.source || 'Direct / None',
        visitors: s.visitors ?? 0
      })),
      topPages: pages.map(p => ({
        page: p.page,
        visitors: p.visitors ?? 0,
        pageviews: p.pageviews ?? 0
      }))
    };

    logger.info('Plausible data fetched successfully');
    return result;
  } catch (err) {
    logger.error('Failed to fetch Plausible data', { error: err.message });
    return null;
  }
}
