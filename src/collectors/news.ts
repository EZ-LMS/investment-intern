import { tavily } from '@tavily/core';
import { config } from '../config.js';
import type { RawContent, TrackingSource } from '../types.js';

const client = tavily({ apiKey: config.tavilyApiKey });

/**
 * Handles Podcast (RSS summary) and general news/financial media sources.
 */
export async function collectNews(sources: TrackingSource[]): Promise<RawContent[]> {
  const newsSources = sources.filter(
    (s) => !['threads', 'yt'].includes(s.media.toLowerCase())
  );
  const results: RawContent[] = [];

  for (const src of newsSources) {
    const isPodcast = src.media.toLowerCase() === 'podcast';

    try {
      if (isPodcast) {
        console.log(`[Podcast] Fetching RSS summary for ${src.name}…`);
        const rssContent = await fetchPodcastRss(src.link, src.name);
        if (rssContent) results.push(rssContent);
      } else {
        // General website / financial media — search via Tavily
        console.log(`[News] Searching ${src.media} / ${src.name}…`);
        const domain = extractDomain(src.link);
        const query = domain
          ? `site:${domain} ${src.name} (${config.supplyKeywords})`
          : `${src.name} (${config.supplyKeywords})`;

        const res = await client.search(query, {
          maxResults: 5,
          searchDepth: 'basic',
          includeAnswer: false,
        });

        for (const item of res.results) {
          if (item.content && item.content.length > 100) {
            results.push({
              source: src.name,
              mediaType: 'news',
              url: item.url,
              content: item.content,
              publishedAt: item.publishedDate ?? undefined,
            });
          }
        }
      }
    } catch (err) {
      console.warn(`[News] Failed for ${src.name}:`, err instanceof Error ? err.message : err);
    }
  }

  return results;
}

async function fetchPodcastRss(appleUrl: string, name: string): Promise<RawContent | null> {
  try {
    // Derive RSS feed URL from Apple Podcasts page
    const res = await fetch(appleUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10_000),
    });
    const html = await res.text();

    // Extract podcast feed URL from the page
    const feedMatch = html.match(/feedUrl["\s:]+["']([^"']+)/i);
    const feedUrl = feedMatch?.[1];

    if (!feedUrl) {
      // Fallback: just record the episode page as a reference
      return {
        source: name,
        mediaType: 'Podcast',
        url: appleUrl,
        content: `[Podcast] ${name} — Apple Podcasts 頁面（無法取得 RSS，請手動查閱）`,
      };
    }

    const feedRes = await fetch(feedUrl, { signal: AbortSignal.timeout(10_000) });
    const feedXml = await feedRes.text();

    // Extract latest 2 episode titles and descriptions
    const episodes: string[] = [];
    const itemMatches = feedXml.matchAll(/<item>([\s\S]*?)<\/item>/gi);
    for (const match of itemMatches) {
      if (episodes.length >= 2) break;
      const item = match[1] ?? '';
      const title = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/i);
      const desc = item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>|<description>(.*?)<\/description>/i);
      const titleText = title?.[1] ?? title?.[2] ?? '';
      const descText = (desc?.[1] ?? desc?.[2] ?? '').replace(/<[^>]+>/g, '').slice(0, 500);
      if (titleText) episodes.push(`【${titleText}】\n${descText}`);
    }

    return {
      source: name,
      mediaType: 'Podcast',
      url: appleUrl,
      content: episodes.join('\n\n') || `[Podcast] ${name} — 無最新集數內容`,
    };
  } catch (err) {
    console.warn(`[Podcast] RSS fetch failed for ${name}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
