/**
 * alphaMemo.ts
 *
 * Playwright-based scraper for https://www.alphamemo.ai/free-transcripts
 * AlphaMemo provides free Taiwan earnings call transcripts (法說會逐字稿).
 * The site is JavaScript-rendered, so we use headless Chromium.
 *
 * Usage: called by earningsFetch.ts for TW-market companies.
 * Fails gracefully — returns [] if browser unavailable or site structure changes.
 */

import type { Company } from '../types.js';

export interface AlphaMemoDoc {
  url: string;
  content: string;
  source: 'alphaMemo';
}

const BASE_URL = 'https://www.alphamemo.ai/free-transcripts';
// Polite delay between requests — AlphaMemo is a free community resource
const REQUEST_DELAY_MS = 2_500;

export async function fetchAlphaMemoTranscript(company: Company): Promise<AlphaMemoDoc[]> {
  if (company.market !== 'TW') return [];

  let browser: import('playwright').Browser | null = null;

  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'zh-TW',
    });
    const page = await context.newPage();

    // Navigate to the free transcripts page
    console.log(`   [AlphaMemo] Searching for ${company.ticker} ${company.name}…`);
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForTimeout(1_500);

    // Try to search for the company
    const searchPerformed = await trySearch(page, company);

    // Find transcript links that match the company
    const links = await findTranscriptLinks(page, company);

    if (links.length === 0) {
      console.log(`   [AlphaMemo] No transcripts found for ${company.ticker}`);
      return [];
    }

    // Fetch content from up to 2 transcript pages
    const docs: AlphaMemoDoc[] = [];
    for (const link of links.slice(0, 2)) {
      await page.waitForTimeout(REQUEST_DELAY_MS);
      try {
        const doc = await fetchTranscriptPage(page, link);
        if (doc) docs.push(doc);
      } catch (err) {
        console.warn(`   [AlphaMemo] Failed to fetch ${link}:`, err instanceof Error ? err.message : err);
      }
    }

    if (!searchPerformed && docs.length === 0) {
      // Try direct URL pattern: /free-transcripts?company={ticker}
      const directUrl = `${BASE_URL}?company=${company.ticker}`;
      await page.goto(directUrl, { waitUntil: 'networkidle', timeout: 20_000 });
      await page.waitForTimeout(1_000);
      const directLinks = await findTranscriptLinks(page, company);
      for (const link of directLinks.slice(0, 1)) {
        const doc = await fetchTranscriptPage(page, link);
        if (doc) docs.push(doc);
      }
    }

    return docs;
  } catch (err) {
    // Playwright might not be installed in all environments — fail gracefully
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Cannot find module') || msg.includes('not found') || msg.includes('Executable')) {
      console.warn('   [AlphaMemo] Playwright/Chromium not available, skipping.');
    } else {
      console.warn(`   [AlphaMemo] Error for ${company.ticker}:`, msg.slice(0, 200));
    }
    return [];
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function trySearch(page: import('playwright').Page, company: Company): Promise<boolean> {
  try {
    // Look for a search input using multiple selector strategies
    const searchSelectors = [
      'input[type="search"]',
      'input[placeholder*="搜尋"]',
      'input[placeholder*="search"]',
      'input[placeholder*="公司"]',
      'input[placeholder*="股票"]',
      '[data-testid*="search"] input',
      '.search input',
      'form input[type="text"]',
    ];

    for (const selector of searchSelectors) {
      const input = await page.$(selector);
      if (input) {
        await input.fill(company.ticker);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(2_000);

        // Try to wait for results to load
        await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
        return true;
      }
    }
  } catch {
    // Search failed, proceed with page scan
  }
  return false;
}

async function findTranscriptLinks(
  page: import('playwright').Page,
  company: Company
): Promise<string[]> {
  try {
    // Get all links on the page and filter for transcript-related ones
    const allLinks = await page.$$eval(
      'a[href]',
      (anchors, args) => {
        const { ticker, name } = args as { ticker: string; name: string };
        return anchors
          .filter((a) => {
            const href = (a as HTMLAnchorElement).href;
            const text = a.textContent?.trim() ?? '';
            return (
              href.includes('transcript') ||
              href.includes('法說會') ||
              href.includes('/nas/STR/') ||    // MOPS PDF server
              href.includes('FileDownLoad') ||  // MOPS download endpoint
              text.includes(ticker) ||
              href.includes(ticker) ||
              text.includes(name)
            );
          })
          .map((a) => ({
            href: (a as HTMLAnchorElement).href,
            text: a.textContent?.trim() ?? '',
          }));
      },
      { ticker: company.ticker, name: company.name }
    );

    const seen = new Set<string>();
    const unique: string[] = [];

    for (const { href } of allLinks) {
      // Skip the listing page itself — it's just navigation chrome, not a transcript
      if (href === BASE_URL || href === BASE_URL + '/') continue;
      if (href && !seen.has(href) && !href.includes('#') && href.startsWith('http')) {
        seen.add(href);
        unique.push(href);
      }
    }

    return unique;
  } catch {
    return [];
  }
}

async function fetchTranscriptPage(
  page: import('playwright').Page,
  url: string
): Promise<AlphaMemoDoc | null> {
  // PDF URLs: download and parse with pdf-parse, don't navigate in browser
  if (isPdfUrl(url)) {
    return fetchAndParsePdf(url);
  }

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 25_000 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // If Playwright tried to navigate to a download, handle gracefully
    if (msg.includes('Download is starting')) {
      return fetchAndParsePdf(url);
    }
    throw err;
  }
  await page.waitForTimeout(1_000);

  // Try multiple content selectors in priority order
  const contentSelectors = [
    'main article',
    '.transcript-content',
    '.transcript',
    '[class*="transcript"]',
    '[class*="content"]',
    'article',
    'main',
    '.post-content',
    '#content',
  ];

  for (const selector of contentSelectors) {
    try {
      const el = await page.$(selector);
      if (el) {
        const text = await el.innerText();
        if (text.trim().length > 300) {
          return {
            url,
            content: text.trim().slice(0, 4_000),
            source: 'alphaMemo',
          };
        }
      }
    } catch {
      continue;
    }
  }

  // Last resort: read the entire body text
  try {
    const bodyText = await page.innerText('body');
    if (bodyText.trim().length > 300) {
      return {
        url,
        content: bodyText.trim().slice(0, 3_000),
        source: 'alphaMemo',
      };
    }
  } catch {
    // ignore
  }

  return null;
}

function isPdfUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.endsWith('.pdf') ||
    lower.includes('/nas/str/') ||
    lower.includes('filedownload') ||
    lower.includes('download?') && lower.includes('pdf')
  );
}

async function fetchAndParsePdf(url: string): Promise<AlphaMemoDoc | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': 'https://mops.twse.com.tw/',
      },
      signal: AbortSignal.timeout(25_000),
    });

    if (!res.ok) return null;

    const buffer = Buffer.from(await res.arrayBuffer());

    // pdf-parse v2 uses a class-based API: new PDFParse({ data, verbosity })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfParseModule = await import('pdf-parse') as any;
    const PDFParse = pdfParseModule.PDFParse;

    let text = '';
    if (typeof PDFParse === 'function') {
      // v2.x API
      const parser = new PDFParse({ data: new Uint8Array(buffer), verbosity: 0 });
      await parser.load();
      const result = await parser.getText();
      text = result?.text?.trim() ?? '';
    } else {
      // Fallback: try calling the module directly (v1.x API)
      const parseFn = pdfParseModule.default ?? pdfParseModule;
      if (typeof parseFn === 'function') {
        const data = await parseFn(buffer);
        text = data?.text?.trim() ?? '';
      }
    }

    if (text.length < 100) return null;

    return {
      url,
      content: text.slice(0, 4_000),
      source: 'alphaMemo',
    };
  } catch (err) {
    console.warn(`   [AlphaMemo] PDF parse failed for ${url}:`, err instanceof Error ? err.message.slice(0, 100) : err);
    return null;
  }
}
