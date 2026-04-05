import { tavily } from '@tavily/core';
import { askLLM } from '../utils/llm.js';
import { config } from '../config.js';
import type { Company, CredibilityResult } from '../types.js';

const client = tavily({ apiKey: config.tavilyApiKey });

function getRecentQuarters(): { curQ: number; curY: number; prevQ: number; prevY: number } {
  const now = new Date();
  const month = now.getMonth() + 1;
  const curQ = month <= 3 ? 4 : month <= 6 ? 1 : month <= 9 ? 2 : 3;
  const curY = month <= 3 ? now.getFullYear() - 1 : now.getFullYear();
  const prevQ = curQ === 1 ? 4 : curQ - 1;
  const prevY = curQ === 1 ? curY - 1 : curY;
  return { curQ, curY, prevQ, prevY };
}

/**
 * Check credibility for all companies in one Gemini call (batch).
 */
export async function checkCredibilityBatch(companies: Company[]): Promise<CredibilityResult[]> {
  if (companies.length === 0) return [];

  // ── Fetch previous earnings docs for all companies ──
  const docsMap: Record<string, string[]> = {};
  for (const c of companies) {
    docsMap[c.ticker] = await fetchPreviousEarnings(c);
    await new Promise((r) => setTimeout(r, 800));
  }

  // ── Build one combined prompt ──
  const companyBlocks = companies.map((c) => {
    const docs = docsMap[c.ticker] ?? [];
    const docText = docs.join('\n---\n').slice(0, 5000);
    return `### ${c.market === 'TW' ? c.ticker + ' ' : ''}${c.name} (${c.ticker})\n${docText || '（無法取得法說會資料）'}`;
  }).join('\n\n');

  const prompt = `以下是多家公司近兩季的法說會或財報資料。

${companyBlocks}

---

請針對每家公司分析管理層 Guidance 的誠信度：

**分類標準**：
- conservative（保守型）：實際表現通常超過 Guidance 5% 以上（sandbagging，低報預測）
- optimistic（樂觀型）：實際表現通常低於 Guidance 5% 以上（over-promise，高報預測）
- accurate（準確型）：誤差通常在 ±5% 內
- unknown：資料不足無法判斷

每家公司請提取：
1. credibilityType："conservative" | "optimistic" | "accurate" | "unknown"
2. previousGuidance：上一季 Guidance 的具體描述或數字（直接引用原文，若無則填 "未提及"）
3. actualResult：本季實際表現（具體數字，若無則填 "未提及"）
4. latestGuidance：最新一季 Guidance 或前瞻展望（直接引用原文，若無則填 "未提及"）
5. sourceUrl：最主要來源的 URL（若無則填 null）

以 JSON 陣列格式回覆，順序與輸入相同：
[
  {
    "ticker": "2330",
    "credibilityType": "conservative",
    "previousGuidance": "...",
    "actualResult": "...",
    "latestGuidance": "...",
    "sourceUrl": "https://..."
  }
]`;

  let results: Array<{
    ticker: string;
    credibilityType: CredibilityResult['credibilityType'];
    previousGuidance: string;
    actualResult: string;
    latestGuidance: string;
    sourceUrl?: string | null;
  }> = [];

  try {
    const raw = await askLLM<unknown>(prompt);
    // Groq JSON mode returns an object; unwrap if the array is nested inside
    results = Array.isArray(raw)
      ? (raw as typeof results)
      : ((raw as Record<string, unknown>)[Object.keys(raw as object)[0]] as typeof results) ?? [];
  } catch (err) {
    console.warn('[Credibility] Batch LLM call failed:', err instanceof Error ? err.message : err);
  }

  return companies.map((c) => {
    const r = results.find((x) => x.ticker === c.ticker);
    return {
      ticker: c.ticker,
      name: c.name,
      market: c.market,
      credibilityType: r?.credibilityType ?? 'unknown',
      previousGuidance: r?.previousGuidance ?? '未提及',
      actualResult: r?.actualResult ?? '未提及',
      latestGuidance: r?.latestGuidance ?? '未提及',
      sourceUrl: r?.sourceUrl ?? undefined,
    };
  });
}

async function fetchPreviousEarnings(company: Company): Promise<string[]> {
  const { curQ, curY, prevQ, prevY } = getRecentQuarters();
  const queries =
    company.market === 'US'
      ? [
          `${company.name} ${company.ticker} Q${curQ} ${curY} earnings results vs guidance`,
          `${company.name} ${company.ticker} Q${prevQ} ${prevY} earnings call guidance outlook`,
        ]
      : [
          `${company.ticker} ${company.name} ${curY} 第${curQ}季 法說會 指引`,
          `${company.ticker} ${company.name} ${prevY} Q${prevQ} 財報 法說會`,
        ];

  const contents: string[] = [];
  for (const q of queries) {
    try {
      const res = await client.search(q, {
        maxResults: 2,
        searchDepth: 'advanced',
        includeAnswer: false,
        days: 180,
      });
      for (const item of res.results) {
        if (item.content && item.content.length > 200) {
          contents.push(`[${item.url}]\n${item.content.slice(0, 3000)}`);
        }
      }
    } catch (err) {
      console.warn(`[Credibility] Search failed for "${q}":`, err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  return contents.slice(0, 3);
}
