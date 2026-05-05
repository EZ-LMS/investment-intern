/**
 * earningsFetch.ts
 *
 * Central earnings document fetcher with:
 *  - In-memory cache (shared between metricsExtractor + credibilityCheck)
 *  - Source priority: AlphaMemo (TW) → MOPS (TW) / SEC EDGAR (US) → Tavily (fallback)
 *
 * Caching alone halves Tavily usage: both Step 4 + Step 5 used to search independently
 * for the same company data.  Now they share the same fetched docs.
 */

import { searchWeb } from './search.js';
import type { Company } from '../types.js';

export interface EarningsDoc {
  url: string;
  content: string;
  source: 'alphaMemo' | 'mops' | 'secEdgar' | 'tavily';
}

// ── In-memory cache (single pipeline run) ───────────────────────────────────
const cache = new Map<string, EarningsDoc[]>();

/** Returns up to 3 earnings docs for a company, using cache if available. */
export async function getEarningsDocs(company: Company): Promise<EarningsDoc[]> {
  if (cache.has(company.ticker)) {
    console.log(`   [EarningsFetch] Cache hit for ${company.ticker}`);
    return cache.get(company.ticker)!;
  }

  const { curQ, curY, prevQ, prevY } = getRecentQuarters();
  const docs: EarningsDoc[] = [];

  if (company.market === 'TW') {
    // 1. AlphaMemo — highest quality TW transcripts (Playwright)
    try {
      const { fetchAlphaMemoTranscript } = await import('../collectors/alphaMemo.js');
      const alphaDocs = await fetchAlphaMemoTranscript(company);
      docs.push(...alphaDocs.map((d) => ({ ...d, source: 'alphaMemo' as const })));
    } catch (err) {
      console.warn(`   [EarningsFetch] AlphaMemo failed for ${company.ticker}:`, err instanceof Error ? err.message : err);
    }

    // 2. MOPS — official government source
    if (docs.length < 2) {
      const mopsDocs = await fetchMopsDocs(company.ticker, curQ, curY, prevQ, prevY);
      docs.push(...mopsDocs);
    }
  } else {
    // US: SEC EDGAR
    const secDocs = await fetchSecEdgarDocs(company);
    docs.push(...secDocs);
  }

  // 3. Tavily fallback (used only if above sources didn't yield enough)
  if (docs.length < 1) {
    const tavilyDocs = await fetchTavilyFallback(company, curQ, curY, prevQ, prevY);
    docs.push(...tavilyDocs);
  }

  const result = docs.slice(0, 4);
  cache.set(company.ticker, result);
  return result;
}

/** Clear the cache (call between pipeline runs if needed). */
export function clearEarningsCache(): void {
  cache.clear();
}

// ── Quarter helpers ──────────────────────────────────────────────────────────
function getRecentQuarters() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const curQ = month <= 3 ? 4 : month <= 6 ? 1 : month <= 9 ? 2 : 3;
  const curY = month <= 3 ? now.getFullYear() - 1 : now.getFullYear();
  const prevQ = curQ === 1 ? 4 : curQ - 1;
  const prevY = curQ === 1 ? curY - 1 : curY;
  return { curQ, curY, prevQ, prevY };
}

// ── MOPS (台股法說會) ─────────────────────────────────────────────────────────
async function fetchMopsDocs(
  ticker: string,
  curQ: number,
  curY: number,
  prevQ: number,
  prevY: number
): Promise<EarningsDoc[]> {
  const rocYear = curY - 1911; // Convert to ROC calendar year
  const prevRocYear = prevY - 1911;
  const docs: EarningsDoc[] = [];

  // MOPS has a search endpoint for investor conference announcements
  // We try both current and previous quarter
  const targets = [
    { year: rocYear, season: curQ },
    { year: prevRocYear, season: prevQ },
  ];

  for (const { year, season } of targets) {
    try {
      const formData = new URLSearchParams({
        encodeURIComponent: '1',
        step: '1',
        firstin: '1',
        off: '1',
        keyword4: '',
        code1: '',
        TYPEK2: '',
        checkbtn: '',
        queryName: 'co_id',
        inpuType: 'co_id',
        TYPEK: 'all',
        isnew: 'false',
        co_id: ticker,
        year: String(year),
        season: String(season),
      });

      const res = await fetch('https://mops.twse.com.tw/mops/web/ajax_t100sb01', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Referer': 'https://mops.twse.com.tw/mops/web/t100sb01',
        },
        body: formData.toString(),
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) continue;
      const html = await res.text();
      if (html.length < 100 || html.includes('查無資料')) continue;

      // Extract table text content (strip HTML tags)
      const textContent = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 3000);

      if (textContent.length > 200) {
        docs.push({
          url: `https://mops.twse.com.tw/mops/web/t100sb01`,
          content: `【MOPS 法說會記錄 ${ticker} ${year}年Q${season}】\n${textContent}`,
          source: 'mops',
        });
      }
    } catch (err) {
      console.warn(`   [EarningsFetch] MOPS fetch failed for ${ticker} ${year}Q${season}:`, err instanceof Error ? err.message : err);
    }
  }

  return docs;
}

// ── SEC EDGAR (美股) ──────────────────────────────────────────────────────────
async function fetchSecEdgarDocs(company: Company): Promise<EarningsDoc[]> {
  const docs: EarningsDoc[] = [];

  try {
    // Use EDGAR full-text search for recent 8-K filings (earnings releases + calls)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const startDate = sixMonthsAgo.toISOString().split('T')[0];

    const searchUrl = `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(company.name)}%22+%22earnings%22&dateRange=custom&startdt=${startDate}&forms=8-K&_source=file_date,period_of_report,entity_name,file_num,form_type,biz_location,inc_states&hits.hits.total.value=true&hits.hits._source.period_of_report=true&hits.hits._source.file_date=true&hits.hits._source.entity_name=true&hits.hits._source.file_num=true&hits.hits.highlight.file_date=true`;

    const res = await fetch(searchUrl, {
      headers: { 'User-Agent': 'investment-intern-bot contact@example.com' },
      signal: AbortSignal.timeout(10_000),
    });

    if (res.ok) {
      const data = await res.json() as {
        hits?: { hits?: Array<{ _source?: { entity_name?: string; file_date?: string; file_num?: string }; _id?: string }> };
      };
      const hits = data?.hits?.hits ?? [];

      // Get first 2 filing URLs
      for (const hit of hits.slice(0, 2)) {
        const id = hit._id;
        if (!id) continue;

        // Construct the filing index URL
        const filingUrl = `https://www.sec.gov/Archives/edgar/data/${id}`;
        docs.push({
          url: filingUrl,
          content: `SEC EDGAR 8-K filing for ${company.name} (${hit._source?.entity_name ?? ''}), filed ${hit._source?.file_date ?? ''}. See ${filingUrl} for full transcript.`,
          source: 'secEdgar',
        });
      }
    }
  } catch (err) {
    console.warn(`   [EarningsFetch] SEC EDGAR search failed for ${company.ticker}:`, err instanceof Error ? err.message : err);
  }

  // Also try the EDGAR company search API for most recent 8-K documents
  if (docs.length < 1) {
    try {
      const companyUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=&CIK=${encodeURIComponent(company.ticker)}&type=8-K&dateb=&owner=include&count=5&search_text=&output=atom`;
      const res = await fetch(companyUrl, {
        headers: { 'User-Agent': 'investment-intern-bot contact@example.com' },
        signal: AbortSignal.timeout(10_000),
      });

      if (res.ok) {
        const xml = await res.text();
        // Extract filing URLs from Atom feed
        const entryMatches = [...xml.matchAll(/<entry>[\s\S]*?<\/entry>/g)];
        for (const match of entryMatches.slice(0, 2)) {
          const entry = match[0];
          const titleMatch = entry.match(/<title[^>]*>([^<]+)<\/title>/);
          const linkMatch = entry.match(/<link[^>]+href="([^"]+)"/);
          const updatedMatch = entry.match(/<updated>([^<]+)<\/updated>/);
          if (linkMatch?.[1]) {
            docs.push({
              url: linkMatch[1],
              content: `SEC EDGAR ${titleMatch?.[1] ?? '8-K'} filing for ${company.name}, filed ${updatedMatch?.[1]?.split('T')[0] ?? ''}. See ${linkMatch[1]} for full details.`,
              source: 'secEdgar',
            });
          }
        }
      }
    } catch {
      // Silent — this is a secondary attempt
    }
  }

  return docs;
}

// ── Tavily fallback ──────────────────────────────────────────────────────────
async function fetchTavilyFallback(
  company: Company,
  curQ: number,
  curY: number,
  prevQ: number,
  prevY: number
): Promise<EarningsDoc[]> {
  const queries =
    company.market === 'US'
      ? [
          `${company.name} ${company.ticker} Q${curQ} ${curY} earnings call guidance`,
          `${company.name} ${company.ticker} Q${prevQ} ${prevY} earnings results`,
        ]
      : [
          `${company.ticker} ${company.name} ${curY} Q${curQ} 法說會 指引`,
          `${company.ticker} ${company.name} ${prevY} Q${prevQ} 財報 法說會`,
        ];

  const docs: EarningsDoc[] = [];
  for (const q of queries) {
    try {
      const results = await searchWeb(q, { maxResults: 2, days: 180 });
      for (const item of results) {
        if (item.content && item.content.length > 200) {
          docs.push({
            url: item.url,
            content: item.content.slice(0, 3000),
            source: 'tavily',
          });
        }
      }
    } catch (err) {
      console.warn(`   [EarningsFetch] Tavily fallback failed for "${q}":`, err instanceof Error ? err.message : err);
    }
    // Small delay between Tavily calls
    await new Promise((r) => setTimeout(r, 600));
    if (docs.length >= 2) break; // Don't use more Tavily than needed
  }

  return docs;
}
