import axios from 'axios';
import { createLogger } from './logger.js';
import { withRetry } from './retry.js';

const BASE_URL = 'https://app.metricool.com/api';
const V2_BASE_URL = 'https://app.metricool.com/api/v2';

/**
 * Formats a date as YYYYMMDD (Metricool's required format for v1 endpoints).
 */
function toMetricoolDate(year, month, day) {
  return `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
}

/**
 * Formats a date as ISO 8601 (required for v2 analytics endpoints).
 */
function toISODate(year, month, day, endOfDay = false) {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}T${endOfDay ? '23:59:59' : '00:00:00'}`;
}

/**
 * Fetches social media and ads data from Metricool for a customer.
 * @param {object} customer - Customer object from customers.json
 * @param {number} month - Month (1-12)
 * @param {number} year - Full year (e.g. 2026)
 * @returns {Promise<object|null>} Metricool data or null on failure
 */
export async function fetchMetricoolData(customer, month, year) {
  const logger = createLogger('metricool', customer.id);
  const brandId = customer.metricool?.brand_id;

  if (!brandId) {
    logger.warn('No brand_id configured, skipping Metricool');
    return null;
  }

  const apiKey = process.env.METRICOOL_API_KEY;
  if (!apiKey) {
    logger.error('METRICOOL_API_KEY not set');
    return null;
  }

  const userId = process.env.METRICOOL_USER_ID;
  if (!userId) {
    logger.error('METRICOOL_USER_ID not set');
    return null;
  }

  const headers = { 'X-Mc-Auth': apiKey };
  const lastDay = new Date(year, month, 0).getDate();

  const startDate = toMetricoolDate(year, month, 1);
  const endDate   = toMetricoolDate(year, month, lastDay);
  const monthDate = toMetricoolDate(year, month, 1); // single-date param for stats/values

  // ISO 8601 dates for v2 analytics endpoints
  const isoFrom = toISODate(year, month, 1);
  const isoTo   = toISODate(year, month, lastDay, true);

  const baseParams = { userId, blogId: brandId };

  try {
    logger.info('Fetching Metricool data', { brandId, startDate, endDate });

    const [fbStatsRes, fbPostsRes, igStatsRes, igPostsRes, igStoriesRes, adsRes, igPostsV2Res, igReelsRes, fbReelsRes, ttPostsRes, ttAggRes, webVisitorsRes, webPageviewsRes, webReferrersRes, gmbRes] = await Promise.all([

      // Facebook page stats for the month
      withRetry(
        () => axios.get(`${BASE_URL}/stats/values/Facebook`, {
          headers,
          params: { ...baseParams, date: monthDate }
        }),
        { logger, label: 'metricool-fb-stats' }
      ).catch(err => {
        logger.warn('FB stats fetch failed', { error: err.message });
        return { data: {} };
      }),

      // Facebook posts for the month (includes both photos and videos)
      withRetry(
        () => axios.get(`${BASE_URL}/stats/facebook/posts`, {
          headers,
          params: { ...baseParams, start: startDate, end: endDate, sortcolumn: 'engagement' }
        }),
        { logger, label: 'metricool-fb-posts' }
      ).catch(err => {
        logger.warn('FB posts fetch failed', { error: err.message, brandId });
        return { data: [] };
      }),

      // Instagram account-level stats (requires Professional/Creator account; returns {} otherwise)
      axios.get(`${BASE_URL}/stats/values/Instagram`, {
        headers,
        params: { ...baseParams, date: monthDate }
      }).catch(() => ({ data: {} })),

      // Instagram posts (may be empty if account not connected as Business/Creator)
      withRetry(
        () => axios.get(`${BASE_URL}/stats/instagram/posts`, {
          headers,
          params: { ...baseParams, start: startDate, end: endDate, sortcolumn: 'engagement' }
        }),
        { logger, label: 'metricool-ig-posts' }
      ).catch(() => ({ data: [] })),

      // Instagram stories (aggregate stats – thumbnails not available via API)
      withRetry(
        () => axios.get(`${BASE_URL}/stats/instagram/stories`, {
          headers,
          params: { ...baseParams, start: startDate, end: endDate }
        }),
        { logger, label: 'metricool-ig-stories' }
      ).catch(() => ({ data: [] })),

      // Meta Ads campaigns
      withRetry(
        () => axios.get(`${BASE_URL}/stats/facebookads/campaigns`, {
          headers,
          params: { ...baseParams, start: startDate, end: endDate }
        }),
        { logger, label: 'metricool-ads' }
      ).catch(() => ({ data: [] })),

      // Instagram posts via v2 API (works without Business/Creator account)
      axios.get(`${V2_BASE_URL}/analytics/posts/instagram`, {
        headers,
        params: { blogId: brandId, from: isoFrom, to: isoTo }
      }).catch(() => ({ data: { data: [] } })),

      // Instagram Reels via v2 API (separate endpoint from regular posts)
      axios.get(`${V2_BASE_URL}/analytics/reels/instagram`, {
        headers,
        params: { blogId: brandId, from: isoFrom, to: isoTo }
      }).catch(() => ({ data: { data: [] } })),

      // Facebook Reels via v2 API (separate endpoint from regular posts)
      axios.get(`${V2_BASE_URL}/analytics/reels/facebook`, {
        headers,
        params: { blogId: brandId, from: isoFrom, to: isoTo }
      }).catch(() => ({ data: { data: [] } })),

      // TikTok posts via v2 API (professional accounts)
      axios.get(`${V2_BASE_URL}/analytics/posts/tiktok`, {
        headers,
        params: { blogId: brandId, from: isoFrom, to: isoTo }
      }).catch(() => ({ data: { data: [] } })),

      // TikTok account aggregation – 6 metrics in parallel (v2 API)
      Promise.all(
        ['video_views', 'followers_count', 'followers_delta_count', 'likes', 'comments', 'shares']
          .map(metric => axios.get(`${V2_BASE_URL}/analytics/aggregation`, {
            headers,
            params: { blogId: brandId, network: 'tiktok', metric, subject: 'account', from: isoFrom, to: isoTo }
          }).catch(() => ({ data: { data: 0 } })))
      ),

      // Website visitors (daily timeseries → sum for month)
      axios.get(`${BASE_URL}/stats/timeline/Visitors`, {
        headers,
        params: { ...baseParams, start: startDate, end: endDate }
      }).catch(() => ({ data: [] })),

      // Website pageviews (daily timeseries → sum for month)
      axios.get(`${BASE_URL}/stats/timeline/PageViews`, {
        headers,
        params: { ...baseParams, start: startDate, end: endDate }
      }).catch(() => ({ data: [] })),

      // Website traffic sources (referrers distribution)
      axios.get(`${BASE_URL}/stats/distribution/referrers`, {
        headers,
        params: { ...baseParams, start: startDate, end: endDate }
      }).catch(() => ({ data: [] })),

      // Google Business Profile via Metricool (fallback if direct Google API fails)
      axios.get(`${BASE_URL}/stats/values/Google`, {
        headers,
        params: { ...baseParams, date: monthDate }
      }).catch(err => {
        logger.warn('Google Business via Metricool fetch failed', { error: err.message });
        return { data: {} };
      })
    ]);

    const fbStats    = fbStatsRes.data  || {};
    const fbPostsBase = Array.isArray(fbPostsRes.data)   ? fbPostsRes.data    : [];
    const igStats    = igStatsRes.data  || {};
    const igPostsV1  = Array.isArray(igPostsRes.data)    ? igPostsRes.data    : [];
    const igStories  = Array.isArray(igStoriesRes.data)  ? igStoriesRes.data  : [];
    const adsList    = Array.isArray(adsRes.data)        ? adsRes.data        : [];

    // Instagram v2: regular posts + Reels from separate endpoints
    const igPostsV2 = Array.isArray(igPostsV2Res.data?.data) ? igPostsV2Res.data.data : [];
    const igReels   = Array.isArray(igReelsRes.data?.data)   ? igReelsRes.data.data   : [];
    // Merge Reels into posts (both endpoints use same field names: content, imageUrl, likes, reach…)
    const igPostsAll = [...igPostsV2, ...igReels];
    const igPosts    = igPostsAll.length > 0 ? igPostsAll : igPostsV1;

    // Facebook Reels: normalize to match regular post field names for consistent aggregation
    const fbReels = Array.isArray(fbReelsRes.data?.data) ? fbReelsRes.data.data : [];
    const fbPosts = [
      ...fbPostsBase,
      ...fbReels.map(r => ({
        created:           r.created?.dateTime ?? r.created,
        text:              r.description || '',
        picture:           r.thumbnailUrl || null,
        impressionsUnique: r.postImpressionsUnique ?? 0,
        impressions:       r.blueReelsPlayCount ?? 0,
        impressionsOrganic: 0,
        reactions:         r.postVideoReactions ?? 0,
        comments:          0,
        shares:            0,
        engagement:        r.engagement ?? 0,
      }))
    ];

    // TikTok v2: posts from response wrapper { data: [...] }, agg from [{ data: { data: N } }, ...]
    const ttPosts = Array.isArray(ttPostsRes.data?.data) ? ttPostsRes.data.data : [];
    const [ttVideoViewsRes, ttFollowersRes, ttFollowerDeltaRes, ttLikesRes, ttCommentsRes, ttSharesRes] = ttAggRes;

    // TikTok aggregation API requires professional account; fall back to per-post sums when 0 or errored
    const ttVideoViews     = (ttVideoViewsRes.data?.data    ?? 0) || ttPosts.reduce((s, p) => s + (p.viewCount    ?? 0), 0);
    const ttTotalFollowers =  ttFollowersRes.data?.data     ?? 0;
    const ttFollowerGrowth =  ttFollowerDeltaRes.data?.data ?? 0;
    const ttLikes          = (ttLikesRes.data?.data         ?? 0) || ttPosts.reduce((s, p) => s + (p.likeCount    ?? 0), 0);
    const ttComments       = (ttCommentsRes.data?.data      ?? 0) || ttPosts.reduce((s, p) => s + (p.commentCount ?? 0), 0);
    const ttShares         = (ttSharesRes.data?.data        ?? 0) || ttPosts.reduce((s, p) => s + (p.shareCount   ?? 0), 0);

    // ── Website analytics from Metricool tracking ───────────────────────────
    // Metricool returns daily timeseries as [[epochMs, "value"], ...] arrays
    const parseWebSeries = series =>
      Array.isArray(series)
        ? series.reduce((s, d) => s + (Array.isArray(d) ? (parseFloat(d[1]) || 0) : (d.value ?? d.count ?? 0)), 0)
        : 0;
    const webVisitorsSeries  = Array.isArray(webVisitorsRes.data)  ? webVisitorsRes.data  : [];
    const webPageviewsSeries = Array.isArray(webPageviewsRes.data) ? webPageviewsRes.data : [];
    const webReferrers       = Array.isArray(webReferrersRes.data) ? webReferrersRes.data : [];
    const webVisitors  = parseWebSeries(webVisitorsSeries);
    const webPageviews = parseWebSeries(webPageviewsSeries);

    // ── Build top posts list (FB + IG + TikTok combined, sorted by engagement) ──
    const allPosts = [
      ...fbPosts.map(p => ({
        network: 'Facebook',
        caption: (p.text || '').substring(0, 120),
        thumbnail: p.picture || null,
        likes: p.reactions ?? 0,
        comments: p.comments ?? 0,
        shares: p.shares ?? 0,
        engagementRate: p.engagement ?? 0,
        publishedAt: p.created
      })),
      ...igPosts.map(p => ({
        network: 'Instagram',
        caption: (p.content || p.text || p.description || '').substring(0, 120),
        thumbnail: p.imageUrl || p.coverImageUrl || p.picture || p.thumbnail || null,
        likes: p.likes ?? p.reactions ?? 0,
        comments: p.comments ?? 0,
        shares: p.shares ?? 0,
        engagementRate: p.engagement ?? p.engagementRate ?? 0,
        publishedAt: p.publishedAt?.dateTime ?? p.created
      })),
      ...ttPosts.map(p => ({
        network: 'TikTok',
        caption: (p.videoDescription || '').substring(0, 120),
        thumbnail: p.coverImageUrl || null,
        likes: p.likeCount ?? 0,
        comments: p.commentCount ?? 0,
        shares: p.shareCount ?? 0,
        engagementRate: p.engagement ?? 0,
        publishedAt: p.createTime
      }))
    ].sort((a, b) => b.engagementRate - a.engagementRate).slice(0, 3);

    // ── Aggregate Meta Ads ──────────────────────────────────────────────
    const adsTotals = adsList.reduce(
      (acc, c) => {
        acc.spend    += c.spend    ?? c.amountSpent ?? c.spent ?? 0;
        acc.reach    += c.reach    ?? 0;
        acc.clicks   += c.clicks   ?? 0;
        acc.impressions += c.impressions ?? 0;
        return acc;
      },
      { spend: 0, reach: 0, clicks: 0, impressions: 0 }
    );

    const result = {
      social: {
        // Instagram – posts + stories aggregate
        // Post metrics require Business/Creator account; stories and igStats may work otherwise.
        // igStats fallback: account-level stats from /stats/values/Instagram (Professional accounts)
        instagram: (igPosts.length > 0 || igStories.length > 0 || Object.keys(igStats).length > 0) ? {
          reach: igPosts.reduce((s, p) => s + (p.reach ?? p.impressionsUnique ?? 0), 0)
                   || (igStats.reach ?? igStats.impressions_unique ?? 0)
                   || igStories.reduce((s, p) => s + (p.reach ?? 0), 0),
          impressions: igPosts.reduce((s, p) => s + (p.impressionsTotal ?? p.impressions ?? 0), 0)
                   || (igStats.impressions ?? 0)
                   || igStories.reduce((s, p) => s + (p.impressions ?? 0), 0),
          engagement: igPosts.reduce((s, p) => s + (p.interactions ?? (p.likes ?? 0) + (p.comments ?? 0) + (p.saved ?? 0)), 0),
          followerGrowth: igStats.followers_delta ?? igStats.followerGrowth ?? 0,
          totalFollowers: igStats.followers ?? igStats.followerCount ?? 0,
          likes: igPosts.reduce((s, p) => s + (p.likes ?? 0), 0),
          comments: igPosts.reduce((s, p) => s + (p.comments ?? 0), 0),
          saves: igPosts.reduce((s, p) => s + (p.saved ?? 0), 0),
          stories: {
            count: igStories.length,
            impressions: igStories.reduce((s, p) => s + (p.impressions ?? 0), 0),
            reach: igStories.reduce((s, p) => s + (p.reach ?? 0), 0),
            exits: igStories.reduce((s, p) => s + (p.exits ?? 0), 0),
            replies: igStories.reduce((s, p) => s + (p.replies ?? 0), 0)
          }
        } : null,

        // Facebook – summed from individual posts (consistent with posts table)
        // Followers/growth still come from page stats (not available per-post)
        facebook: (() => {
          const fbFollowers    = fbStats.pageFollows ?? 0;
          const fbFollowGrowth = fbStats.page_daily_follows_unique ?? 0;
          const fbPageViews    = fbStats.pageViews ?? 0;
          const fbReach        = fbPosts.reduce((s, p) => s + (p.impressionsUnique ?? p.impressionsUniqueOrganic ?? 0), 0);
          const fbImpressions  = fbPosts.reduce((s, p) => s + (p.impressions ?? p.impressionsOrganic ?? 0), 0);
          const fbLikes        = fbPosts.reduce((s, p) => s + (p.reactions ?? 0), 0);
          const fbComments     = fbPosts.reduce((s, p) => s + (p.comments ?? 0), 0);
          const fbShares       = fbPosts.reduce((s, p) => s + (p.shares ?? 0), 0);
          const hasActivity    = fbPosts.length > 0 || fbFollowers > 0;
          if (!hasActivity) return null;
          return {
            reach: fbReach,
            impressions: fbImpressions,
            engagement: fbLikes + fbComments + fbShares,
            followerGrowth: fbFollowGrowth,
            likes: fbLikes,
            comments: fbComments,
            shares: fbShares,
            totalFollowers: fbFollowers,
            pageViews: fbPageViews
          };
        })(),

        // TikTok – from v2 analytics (professional accounts)
        tiktok: (ttPosts.length > 0 || ttVideoViews > 0 || ttTotalFollowers > 0) ? {
          videoViews: ttVideoViews,
          reach: ttPosts.reduce((s, p) => s + (p.reach ?? 0), 0),
          engagement: ttPosts.reduce((s, p) => s + (p.likeCount ?? 0) + (p.commentCount ?? 0), 0),
          followerGrowth: ttFollowerGrowth,
          totalFollowers: ttTotalFollowers,
          likes: ttLikes,
          comments: ttComments,
          shares: ttShares
        } : null
      },
      topPosts: allPosts,
      allPostsByPlatform: {
        facebook: fbPosts.map(p => ({
          date: p.created,
          caption: (p.text || '').substring(0, 100),
          thumbnail: p.picture || null,
          reach: p.impressionsUnique ?? p.impressionsUniqueOrganic ?? 0,
          impressions: p.impressions ?? p.impressionsOrganic ?? 0,
          likes: p.reactions ?? 0,
          comments: p.comments ?? 0,
          shares: p.shares ?? 0,
          engagementRate: p.engagement ?? 0
        })),
        instagram: igPosts.map(p => ({
          date: p.publishedAt?.dateTime ?? p.created,
          caption: (p.content || p.text || p.description || '').substring(0, 100),
          thumbnail: p.imageUrl || p.coverImageUrl || p.picture || p.thumbnail || null,
          reach: p.reach ?? 0,
          impressions: p.impressionsTotal ?? p.impressions ?? 0,
          likes: p.likes ?? 0,
          comments: p.comments ?? 0,
          saves: p.saved ?? 0,
          engagementRate: p.engagement ?? 0
        })),
        tiktok: ttPosts.map(p => ({
          date: p.createTime,
          caption: (p.videoDescription || p.title || '').substring(0, 100),
          thumbnail: p.coverImageUrl || null,
          views: p.viewCount ?? 0,
          reach: p.reach ?? 0,
          likes: p.likeCount ?? 0,
          comments: p.commentCount ?? 0,
          shares: p.shareCount ?? 0,
          engagementRate: p.engagement ?? 0
        }))
      },
      ads: adsTotals.spend > 0 ? {
        spend: adsTotals.spend,
        reach: adsTotals.reach,
        clicks: adsTotals.clicks,
        impressions: adsTotals.impressions,
        roas: null,
        currency: 'SEK'
      } : null,

      web: (webVisitors > 0 || webPageviews > 0) ? {
        visitors: webVisitors,
        pageviews: webPageviews,
        bounceRate: null,
        visitDuration: null,
        topSources: webReferrers.slice(0, 5).map(s => ({
          source: s.source ?? s.name ?? s.referrer ?? 'Okänd',
          visitors: s.value ?? s.visitors ?? s.count ?? 0
        })),
        topPages: []
      } : null
    };

    // ── Google Business Profile via Metricool (fallback) ────────────────────
    const gmbStats = gmbRes.data || {};
    const gmbHasData = Object.keys(gmbStats).length > 0;
    const googleBusiness = gmbHasData ? {
      impressions: {
        search: gmbStats.searches ?? gmbStats.searchImpressions ?? gmbStats.search ?? 0,
        maps:   gmbStats.maps    ?? gmbStats.mapImpressions    ?? gmbStats.map   ?? 0,
        total:  (gmbStats.searches ?? gmbStats.search ?? 0) + (gmbStats.maps ?? gmbStats.map ?? 0)
      },
      actions: {
        websiteClicks: gmbStats.website      ?? gmbStats.websiteClicks      ?? gmbStats.clicks    ?? 0,
        phoneCalls:    gmbStats.calls        ?? gmbStats.phoneCalls          ?? 0,
        directions:    gmbStats.directions   ?? gmbStats.directionRequests   ?? 0,
        bookings:      gmbStats.bookings     ?? 0,
        photoViews:    gmbStats.photoViews   ?? gmbStats.photo_views         ?? 0
      },
      reviews: {
        totalReviews:   gmbStats.totalReviews  ?? gmbStats.reviewCount ?? gmbStats.reviews ?? 0,
        averageRating:  gmbStats.averageRating ?? gmbStats.rating       ?? 0,
        recentReviews:  []
      }
    } : null;

    result.googleBusiness = googleBusiness;

    logger.info('Metricool data fetched successfully', {
      fbPosts: fbPostsBase.length,
      fbReels: fbReels.length,
      igPosts: igPostsV2.length,
      igReels: igReels.length,
      igStories: igStories.length,
      ttPosts: ttPosts.length,
      ads: adsList.length,
      webVisitors,
      webPageviews
    });
    return result;

  } catch (err) {
    logger.error('Failed to fetch Metricool data', { error: err.message });
    return null;
  }
}
