import type { RawContent, TrackingSource } from '../types.js';

export async function collectPodcastRSS(sources: TrackingSource[]): Promise<RawContent[]> {
  const podcastSources = sources.filter(s => s.media.toLowerCase() === 'podcast');
  const results: RawContent[] = [];

  for (const src of podcastSources) {
    try {
      // Extract Apple Podcasts ID from URL like .../id1500839292
      const match = src.link.match(/id(\d+)/);
      if (!match) {
        console.warn(`[PodcastRSS] No Apple Podcast ID found for ${src.name}`);
        continue;
      }
      const podcastId = match[1];

      // Get RSS feed URL from iTunes Lookup API
      const lookupRes = await fetch(`https://itunes.apple.com/lookup?id=${podcastId}`);
      const lookupData = await lookupRes.json() as { results?: Array<{ feedUrl?: string }> };
      const feedUrl = lookupData.results?.[0]?.feedUrl;
      if (!feedUrl) {
        console.warn(`[PodcastRSS] No feedUrl for ${src.name}`);
        continue;
      }

      console.log(`[PodcastRSS] Fetching RSS for ${src.name}: ${feedUrl}`);
      const rssRes = await fetch(feedUrl);
      const rssText = await rssRes.text();

      // Parse 3 most recent episodes
      const episodes = parseRssEpisodes(rssText, 3);
      for (const ep of episodes) {
        results.push({
          source: src.name,
          mediaType: 'Podcast',
          url: ep.link || src.link,
          content: `【${ep.title}】\n${ep.description}`,
          publishedAt: ep.pubDate,
        });
      }
      console.log(`[PodcastRSS] Got ${episodes.length} episodes for ${src.name}`);
    } catch (err) {
      console.warn(`[PodcastRSS] Failed for ${src.name}:`, err instanceof Error ? err.message : err);
    }
  }

  return results;
}

interface Episode {
  title: string;
  description: string;
  link: string;
  pubDate: string;
}

function parseRssEpisodes(xml: string, limit: number): Episode[] {
  const episodes: Episode[] = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null && episodes.length < limit) {
    const item = match[1] ?? '';
    const title = extractCdataTag(item, 'title');
    const desc = extractCdataTag(item, 'description')
              || extractCdataTag(item, 'itunes:summary')
              || extractCdataTag(item, 'content:encoded')
              || '';
    const link = extractAttrOrTag(item, 'enclosure', 'url')
              || extractCdataTag(item, 'link')
              || '';
    const pubDate = extractCdataTag(item, 'pubDate') || '';

    // Strip HTML/CDATA artifacts, keep up to 600 chars
    const cleanDesc = desc.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').trim().slice(0, 600);

    if (title) {
      episodes.push({ title, description: cleanDesc, link, pubDate });
    }
  }
  return episodes;
}

function extractCdataTag(xml: string, tag: string): string {
  // Match <tag>content</tag> or <tag><![CDATA[content]]></tag>
  const regex = new RegExp(`<${tag}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i');
  return xml.match(regex)?.[1]?.trim() ?? '';
}

function extractAttrOrTag(xml: string, tag: string, attr: string): string {
  const regex = new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`, 'i');
  return xml.match(regex)?.[1]?.trim() ?? '';
}
