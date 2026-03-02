import { GoogleAuth } from 'google-auth-library';
import axios from 'axios';
import path from 'path';
import { createLogger } from './logger.js';
import { withRetry } from './retry.js';

const PERFORMANCE_BASE = 'https://businessprofileperformance.googleapis.com/v1';
const MYBUSINESS_BASE = 'https://mybusiness.googleapis.com/v4';
const SCOPES = ['https://www.googleapis.com/auth/business.manage'];

/**
 * Creates an authenticated Axios instance using a Google Service Account.
 * @returns {Promise<import('axios').AxiosInstance>}
 */
async function getAuthenticatedClient() {
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || './config/google-service-account.json';
  const resolvedPath = path.resolve(keyPath);

  const auth = new GoogleAuth({
    keyFile: resolvedPath,
    scopes: SCOPES
  });

  const token = await auth.getAccessToken();
  return axios.create({
    headers: { Authorization: `Bearer ${token}` }
  });
}

/**
 * Fetches Google Business Profile data for a customer.
 * @param {object} customer - Customer object from customers.json
 * @param {number} month - Month (1-12)
 * @param {number} year - Full year (e.g. 2025)
 * @returns {Promise<object|null>} Google Business data or null on failure
 */
export async function fetchGoogleData(customer, month, year) {
  const logger = createLogger('googleBusiness', customer.id);
  const locationId = customer.google?.location_id;

  if (!locationId) {
    logger.warn('No location_id configured, skipping Google Business');
    return null;
  }

  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  if (!keyPath) {
    logger.error('GOOGLE_SERVICE_ACCOUNT_KEY_PATH not set');
    return null;
  }

  // Build date range
  const startDate = { year, month, day: 1 };
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = { year, month, day: lastDay };

  try {
    logger.info('Fetching Google Business data', { locationId });
    const client = await getAuthenticatedClient();

    // Build query string with repeated dailyMetrics params (Google API requires this format)
    const sp = new URLSearchParams();
    [
      'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
      'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
      'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
      'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
      'CALL_CLICKS',
      'WEBSITE_CLICKS',
      'BUSINESS_DIRECTION_REQUESTS',
      'BUSINESS_BOOKINGS',
      'PHOTO_VIEWS_MERCHANT'
    ].forEach(m => sp.append('dailyMetrics', m));
    sp.append('dailyRange.startDate.year',  String(startDate.year));
    sp.append('dailyRange.startDate.month', String(startDate.month));
    sp.append('dailyRange.startDate.day',   String(startDate.day));
    sp.append('dailyRange.endDate.year',    String(endDate.year));
    sp.append('dailyRange.endDate.month',   String(endDate.month));
    sp.append('dailyRange.endDate.day',     String(endDate.day));

    // Fetch performance metrics (impressions, actions)
    const performanceRes = await withRetry(
      () => client.get(
        `${PERFORMANCE_BASE}/${locationId}:fetchMultiDailyMetricsTimeSeries?${sp.toString()}`
      ),
      { logger, label: 'google-performance' }
    );

    // Fetch reviews
    const reviewsRes = await withRetry(
      () => client.get(`${MYBUSINESS_BASE}/${locationId}/reviews`, {
        params: { pageSize: 5, orderBy: 'updateTime desc' }
      }),
      { logger, label: 'google-reviews' }
    );

    // Aggregate metric series into monthly totals
    const metrics = performanceRes.data?.multiDailyMetricTimeSeries || [];
    const totals = {};
    for (const series of metrics) {
      const metricName = series.dailyMetric;
      const total = (series.timeSeries?.datedValues || [])
        .reduce((sum, dv) => sum + (dv.value ?? 0), 0);
      totals[metricName] = total;
    }

    const reviewData = reviewsRes.data;
    const result = {
      impressions: {
        search: (totals['BUSINESS_IMPRESSIONS_DESKTOP_SEARCH'] || 0) +
                (totals['BUSINESS_IMPRESSIONS_MOBILE_SEARCH'] || 0),
        maps: (totals['BUSINESS_IMPRESSIONS_DESKTOP_MAPS'] || 0) +
              (totals['BUSINESS_IMPRESSIONS_MOBILE_MAPS'] || 0),
        total: Object.keys(totals)
          .filter(k => k.startsWith('BUSINESS_IMPRESSIONS'))
          .reduce((sum, k) => sum + totals[k], 0)
      },
      actions: {
        websiteClicks: totals['WEBSITE_CLICKS'] || 0,
        phoneCalls: totals['CALL_CLICKS'] || 0,
        directions: totals['BUSINESS_DIRECTION_REQUESTS'] || 0,
        bookings: totals['BUSINESS_BOOKINGS'] || 0,
        photoViews: totals['PHOTO_VIEWS_MERCHANT'] || 0
      },
      reviews: {
        totalReviews: reviewData?.totalReviewCount ?? 0,
        averageRating: reviewData?.averageRating ?? 0,
        recentReviews: (reviewData?.reviews || []).slice(0, 3).map(r => ({
          rating: r.starRating,
          comment: r.comment?.substring(0, 200) || '',
          authorName: r.reviewer?.displayName || 'Anonym',
          createdAt: r.createTime
        }))
      }
    };

    logger.info('Google Business data fetched successfully');
    return result;
  } catch (err) {
    logger.error('Failed to fetch Google Business data', {
      error: err.message,
      responseStatus: err.response?.status,
      responseData: JSON.stringify(err.response?.data)
    });
    return null;
  }
}
