/**
 * Unified web search utility.
 * Tries providers in order: Tavily → Google CSE
 * Automatically falls back when a provider's quota is exhausted.
 */
import { tavily } from '@tavily/core';
import { config } from '../config.js';

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  publishedDate?: string;
}

const tavilyClient = tavily({ apiKey: config.tavilyApiKey });

export async function searchWeb(
  query: string,
  options: { days?: number; maxResults?: number } = {}
): Promise<SearchResult[]> {
  const { days, maxResults = 5 } = options;

  // ── 1. Try Tavily ─────────────────────────────────────────────────────────
  try {
    const res = await tavilyClient.search(query, {
      maxResults,
      searchDepth: 'basic',
      includeAnswer: false,
      ...(days ? { days } : {}),
    });
    return res.results.map((r) => ({
      title: r.title,
      url: r.url,
      content: r.content,
      publishedDate: r.publishedDate ?? undefined,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isQuota = msg.includes('usage limit') || msg.includes('quota') || msg.includes('429') || msg.includes('exceeded');
    if (!isQuota) throw err;   // unexpected error — re-throw
    console.warn('[Search] Tavily quota exceeded → trying Google CSE…');
  }

  // ── 2. Fallback: Google Custom Search Engine (100 free queries/day) ───────
  if (config.googleCseKey && config.googleCseId) {
    try {
      return await searchGoogleCSE(query, { days, maxResults });
    } catch (err) {
      console.warn('[Search] Google CSE failed:', err instanceof Error ? err.message : err);
    }
  }

  return [];
}

async function searchGoogleCSE(
  query: string,
  options: { days?: number; maxResults?: number }
): Promise<SearchResult[]> {
  const { days, maxResults = 5 } = options;

  const params = new URLSearchParams({
    key: config.googleCseKey,
    cx: config.googleCseId,
    q: query,
    num: String(Math.min(maxResults, 10)),
  });

  // dateRestrict: d7 = past 7 days, d90 = past 90 days, etc.
  if (days) params.set('dateRestrict', `d${days}`);

  const res = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`, {
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google CSE HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json() as {
    items?: Array<{ title: string; link: string; snippet: string }>;
  };

  return (data.items ?? []).map((item) => ({
    title: item.title,
    url: item.link,
    content: item.snippet,
  }));
}
