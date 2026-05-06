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
/**
 * Fetch actual earnings press release content from SEC EDGAR.
 * Strategy:
 *   1. Get company's recent 8-K filings via EDGAR atom feed
 *   2. Filter for earnings filings (item 2.02 = Results of Operations)
 *   3. Fetch the filing index to find the press release exhibit (ex99-1)
 *   4. Fetch and extract text from the press release HTML
 */
async function fetchSecEdgarDocs(company: Company): Promise<EarningsDoc[]> {
  const docs: EarningsDoc[] = [];
  const headers = { 'User-Agent': 'investment-intern-bot contact@example.com' };

  try {
    // Get recent 8-K filings via EDGAR atom feed (includes items description)
    const atomUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=&CIK=${encodeURIComponent(company.ticker)}&type=8-K&dateb=&owner=include&count=10&search_text=&output=atom`;
    const atomRes = await fetch(atomUrl, { headers, signal: AbortSignal.timeout(12_000) });
    if (!atomRes.ok) return docs;

    const xml = await atomRes.text();
    const entries = [...xml.matchAll(/<entry>[\s\S]*?<\/entry>/g)];

    // Prioritise item 2.02 (Results of Operations = earnings), fall back to 8.01
    const earningsEntries = entries.filter((m) =>
      m[0].includes('items 2.02') || m[0].includes('item 2.02')
    );
    const candidateEntries = earningsEntries.length > 0 ? earningsEntries : entries;

    for (const match of candidateEntries.slice(0, 3)) {
      const entry = match[0];
      const filingHref = entry.match(/<filing-href>([^<]+)<\/filing-href>/)?.[1]?.trim();
      const filingDate = entry.match(/<filing-date>([^<]+)<\/filing-date>/)?.[1]?.trim() ?? '';
      if (!filingHref) continue;

      try {
        // Fetch the filing index page to find exhibit files
        const indexRes = await fetch(filingHref, { headers, signal: AbortSignal.timeout(10_000) });
        if (!indexRes.ok) continue;
        const indexHtml = await indexRes.text();

        // Find the earnings press release exhibit — prefer ex99-1, fallback to any .htm
        const baseUrl = filingHref.substring(0, filingHref.lastIndexOf('/'));
        const allLinks = [...indexHtml.matchAll(/href="(\/Archives\/edgar\/data[^"]*\.htm)"/gi)]
          .map((m) => 'https://www.sec.gov' + m[1]);

        const pressReleaseUrl =
          allLinks.find((u) => /ex99[-_]?1|ex-99\.1|pressrelease|press[-_]release/i.test(u)) ??
          allLinks.find((u) => /ex99/i.test(u)) ??
          allLinks[0];

        if (!pressReleaseUrl) continue;

        // Fetch and extract text from the press release
        const docRes = await fetch(pressReleaseUrl, { headers, signal: AbortSignal.timeout(12_000) });
        if (!docRes.ok) continue;
        const docHtml = await docRes.text();

        // Strip HTML and clean text
        const text = docHtml
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&#[0-9]+;/g, ' ')
          .replace(/&[a-z]+;/g, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        if (text.length > 300) {
          console.log(`   [EarningsFetch] SEC EDGAR: got ${text.length} chars for ${company.ticker} (${filingDate})`);
          docs.push({
            url: pressReleaseUrl,
            content: extractEarningsContent(text),
            source: 'secEdgar',
          });
          if (docs.length >= 2) break; // 2 filings is enough
        }
      } catch (innerErr) {
        // Non-fatal — try next filing
        console.warn(`   [EarningsFetch] EDGAR filing fetch failed:`, innerErr instanceof Error ? innerErr.message.slice(0, 80) : innerErr);
      }

      await new Promise((r) => setTimeout(r, 400)); // polite delay
    }
  } catch (err) {
    console.warn(`   [EarningsFetch] SEC EDGAR failed for ${company.ticker}:`, err instanceof Error ? err.message : err);
  }

  return docs;
}

// ── Smart earnings content extractor ────────────────────────────────────────
/**
 * Extracts the most useful portions of an earnings press release:
 *   1. First 2,500 chars (financial highlights + actual results)
 *   2. The "Outlook" / "Business Outlook" / "Guidance" section (~1,500 chars)
 *
 * Earnings press releases typically bury the guidance section after financial
 * tables (often around char 3,000-5,000). A flat 5,000-char slice often
 * includes lengthy footnotes but misses the outlook entirely.
 */
function extractEarningsContent(text: string): string {
  const summary = text.slice(0, 2_500);

  // Search for the guidance section using common press release headings
  const lower = text.toLowerCase();
  const outlookPatterns = [
    'business outlook',
    '\noutlook\n',
    ' outlook ',
    'financial outlook',
    'guidance',
    'next quarter',
    'fiscal quarter outlook',
  ];

  let outlookStart = -1;
  for (const pattern of outlookPatterns) {
    const idx = lower.indexOf(pattern, 1_000); // Skip matches in the header area
    if (idx > 0 && (outlookStart === -1 || idx < outlookStart)) {
      outlookStart = idx;
    }
  }

  if (outlookStart > 2_500) {
    // Guidance section is beyond our summary window — include it separately
    const outlookSnippet = text.slice(outlookStart, outlookStart + 1_500);
    return `${summary}\n\n[OUTLOOK SECTION]\n${outlookSnippet}`;
  }

  // Guidance is already within the first 2,500 chars — extend the window instead
  return text.slice(0, 4_000);
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
