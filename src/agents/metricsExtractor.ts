import { askLLM } from '../utils/llm.js';
import { getEarningsDocs } from '../utils/earningsFetch.js';
import type { Company } from '../types.js';

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

interface ExtractedMetrics {
  ticker: string;
  themeQuote: string;
  latestRevenue: string;
  previousGuidance: string;
  latestGuidance: string;
  sourceUrls: string[];
}

/**
 * Enrich all companies in one batch LLM call.
 * Documents are fetched via earningsFetch (AlphaMemo→MOPS/SEC EDGAR→Tavily)
 * with an in-memory cache, so credibilityCheck can reuse the same docs.
 */
export async function enrichCompaniesWithDocs(companies: Company[], industryName: string): Promise<Company[]> {
  if (companies.length === 0) return companies;

  // ── Fetch docs for all companies (shared cache across Step 4 + Step 5) ──
  const docsMap: Record<string, { url: string; content: string }[]> = {};
  for (const c of companies) {
    const earningsDocs = await getEarningsDocs(c);
    docsMap[c.ticker] = earningsDocs.map((d) => ({ url: d.url, content: d.content }));
  }

  // ── Build one combined prompt for all companies ──
  const companyBlocks = companies.map((c) => {
    const docs = docsMap[c.ticker] ?? [];
    // Give each doc an equal share of the budget so Doc 2 (previous quarter,
    // which contains previousGuidance) isn't squeezed out by Doc 1.
    // 8,000 chars/company × 6 companies ≈ 48k chars total — Gemini (1M ctx) handles
    // this fine; Groq fallback may hit 12k TPM but will retry/fail gracefully.
    const perDocLimit = docs.length > 0 ? Math.floor(8000 / docs.length) : 8000;
    const docText = docs
      .map((d) => `[來源: ${d.url}]\n${d.content.slice(0, perDocLimit)}`)
      .join('\n---\n');
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
    const raw = await askLLM<unknown>(prompt, 'json', true); // preferGemini=true for large prompts
    extracted = unwrapArray<ExtractedMetrics>(raw);
  } catch (err) {
    console.warn('[MetricsExtractor] Batch LLM call failed:', err instanceof Error ? err.message : err);
    // Return companies with doc sources only, no LLM enrichment
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
