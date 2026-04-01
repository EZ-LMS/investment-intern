import { tavily } from '@tavily/core';
import { config } from '../config.js';
import type { RawContent, TrackingSource } from '../types.js';

const client = tavily({ apiKey: config.tavilyApiKey });

export async function collectThreads(sources: TrackingSource[]): Promise<RawContent[]> {
  const threadsSources = sources.filter((s) => s.media.toLowerCase() === 'threads');
  const results: RawContent[] = [];

  for (const src of threadsSources) {
    try {
      console.log(`[Threads] Searching @${src.name}…`);
      const res = await client.search(
        `site:threads.net @${src.name} (${config.supplyKeywords})`,
        {
          maxResults: 5,
          searchDepth: 'basic',
          includeAnswer: false,
        }
      );

      for (const item of res.results) {
        if (item.content && item.content.length > 50) {
          results.push({
            source: src.name,
            mediaType: 'Threads',
            url: item.url,
            content: item.content,
            publishedAt: item.publishedDate ?? undefined,
          });
        }
      }
    } catch (err) {
      console.warn(`[Threads] Failed for @${src.name}:`, err instanceof Error ? err.message : err);
    }
  }

  return results;
}
