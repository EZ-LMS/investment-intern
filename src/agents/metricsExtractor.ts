import { tavily } from '@tavily/core';
import { askLLM } from '../utils/llm.js';
import { config } from '../config.js';
import type { Company } from '../types.js';

const client = tavily({ apiKey: config.tavilyApiKey });

/** Returns the most recently completed quarter based on today's date.
 *  Earnings are typically available ~6 weeks after quarter end. */
function getRecentQuarters(): { curQ: number; curY: number; prevQ: number; prevY: number } {
  const now = new Date();
  const month = now.getMonth() + 1;
  const curQ = month <= 3 ? 4 : month <= 6 ? 1 : month <= 9 ? 2 : 3;
  const curY = month <= 3 ? now.getFullYear() - 1 : now.getFullYear();
  const prevQ = curQ === 1 ? 4 : curQ - 1;
  const prevY = curQ === 1 ? curY - 1 : curY;
  return { curQ, curY, prevQ, prevY };
}

interface ExtractedMetrics {
  ticker: string;
  themeQuote: string;
  latestRevenue: string;
  previousGuidance: string;
  latestGuidance: string;
  sourceUrls: string[];
}

/**
 * Enrich all companies in one Gemini call (batch).
 * Fetches docs per company individually (Tavily), then sends all docs to Gemini at once.
 */
export async function enrichCompaniesWithDocs(companies: Company[], industryName: string): Promise<Company[]> {
  if (companies.length === 0) return companies;

  // ── Fetch docs for all companies (Tavily, no Gemini yet) ──
  const docsMap: Record<string, { url: string; content: string }[]> = {};
  for (const c of companies) {
    docsMap[c.ticker] = await fetchEarningsDocs(c);
    await new Promise((r) => setTimeout(r, 800));
  }

  // ── Build one combined prompt for all companies ──
  const companyBlocks = companies.map((c) => {
    const docs = docsMap[c.ticker] ?? [];
    const docText = docs.map((d) => `[來源: ${d.url}]\n${d.content}`).join('\n---\n').slice(0, 6000);
    return `### ${c.market === 'TW' ? c.ticker + ' ' : ''}${c.name} (${c.ticker})\n${docText || '（無法取得文件）'}`;
  }).join('\n\n');

  const prompt = `以下是多家公司的法說會或財報資料，請針對每一家公司提取資訊。

${companyBlocks}

---

請針對「${industryName}」這個主題，對每家公司提取：
1. themeQuote：與該主題相關的具體引用句子（1-2 句，若無則填 "未提及"）
2. latestRevenue：最新一季實際營收（含單位，若無則填 "未提及"）
3. previousGuidance：上一季的 Guidance 數字或描述（若無則填 "未提及"）
4. latestGuidance：最新前瞻展望或 Guidance（若無則填 "未提及"）
5. sourceUrls：最多 3 個來源 URL

以 JSON 陣列格式回覆，順序與輸入相同：
[
  {
    "ticker": "2330",
    "themeQuote": "...",
    "latestRevenue": "...",
    "previousGuidance": "...",
    "latestGuidance": "...",
    "sourceUrls": ["url1"]
  }
]`;

  let extracted: ExtractedMetrics[] = [];
  try {
    extracted = await askLLM<ExtractedMetrics[]>(prompt);
  } catch (err) {
    console.warn('[MetricsExtractor] Batch Gemini call failed:', err instanceof Error ? err.message : err);
    // Return companies with doc sources only, no Gemini enrichment
    return companies.map((c) => ({
      ...c,
      sources: (docsMap[c.ticker] ?? []).map((d) => d.url),
    }));
  }

  // ── Merge results back into companies ──
  return companies.map((c) => {
    const result = extracted.find((r) => r.ticker === c.ticker);
    return {
      ...c,
      sources: result?.sourceUrls ?? (docsMap[c.ticker] ?? []).map((d) => d.url),
    };
  });
}

async function fetchEarningsDocs(company: Company): Promise<{ url: string; content: string }[]> {
  const { curQ, curY, prevQ, prevY } = getRecentQuarters();
  const queries =
    company.market === 'US'
      ? [
          `${company.name} ${company.ticker} Q${curQ} ${curY} earnings call transcript`,
          `${company.name} ${company.ticker} Q${prevQ} ${prevY} earnings results guidance`,
          `${company.name} investor relations ${curY} annual report`,
        ]
      : [
          `${company.ticker} ${company.name} ${curY} Q${curQ} 法說會 簡報`,
          `${company.ticker} ${company.name} ${curY} 第${curQ}季 財報 法說會`,
          `${company.ticker} ${company.name} 法說會 site:mops.twse.com.tw`,
        ];

  const docs: { url: string; content: string }[] = [];
  for (const q of queries) {
    try {
      const res = await client.search(q, {
        maxResults: 2,
        searchDepth: 'advanced',
        includeAnswer: false,
        days: 90,
      });
      for (const item of res.results) {
        if (item.content && item.content.length > 200) {
          docs.push({ url: item.url, content: item.content.slice(0, 3000) });
        }
      }
    } catch (err) {
      console.warn(`[Metrics] Search failed for "${q}":`, err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  return docs.slice(0, 3);
}
