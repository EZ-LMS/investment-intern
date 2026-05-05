import { askLLM } from '../utils/llm.js';
import { getEarningsDocs } from '../utils/earningsFetch.js';
import type { Company, CredibilityResult } from '../types.js';

/**
 * Robustly unwrap an LLM response into a typed array.
 * Handles Groq JSON-object mode which may return:
 *   - The array directly: [...]
 *   - A wrapper object: { "companies": [...] }
 *   - Numeric-keyed object: { "0": {...}, "1": {...} }
 */
function unwrapArray<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (typeof raw !== 'object' || raw === null) return [];
  const values = Object.values(raw as Record<string, unknown>);
  // Pattern 1: { "companies": [...] } → first array value wins
  for (const v of values) {
    if (Array.isArray(v) && v.length > 0) return v as T[];
  }
  // Pattern 2: { "0": {...}, "1": {...} } → all object values
  if (values.length > 0 && values.every((v) => typeof v === 'object' && v !== null && !Array.isArray(v))) {
    return values as T[];
  }
  return [];
}

/**
 * Check credibility for all companies in one batch LLM call.
 * Documents are fetched via earningsFetch (shared cache with metricsExtractor),
 * so Step 5 incurs zero additional Tavily calls if Step 4 already ran.
 */
export async function checkCredibilityBatch(companies: Company[]): Promise<CredibilityResult[]> {
  if (companies.length === 0) return [];

  // ── Fetch docs via shared cache (no additional Tavily if metricsExtractor ran first) ──
  const docsMap: Record<string, string[]> = {};
  for (const c of companies) {
    const earningsDocs = await getEarningsDocs(c);
    docsMap[c.ticker] = earningsDocs.map((d) => `[${d.url}]\n${d.content}`);
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
    const raw = await askLLM<unknown>(prompt, 'json', true); // preferGemini=true for large prompts
    results = unwrapArray<(typeof results)[number]>(raw);
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
