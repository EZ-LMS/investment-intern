import { askLLM } from '../utils/llm.js';
import type { RawContent, KolSummary } from '../types.js';

interface LLMSummaryResult {
  keyPoints: string[];
  mentionedCompanies: string[];
  overallView: string;
}

/**
 * Summarise each tracked KOL / source individually.
 * Called when industryFilter returns mode='kol-summary'.
 *
 * Each source gets up to 1500 chars of content — enough for meaningful analysis
 * while staying well within Groq's 12k TPM limit per call.
 */
export async function summarizeKols(rawContents: RawContent[]): Promise<KolSummary[]> {
  if (rawContents.length === 0) return [];

  // Group contents by source (one KOL may have multiple posts/videos)
  const bySource = new Map<string, RawContent[]>();
  for (const item of rawContents) {
    if (!bySource.has(item.source)) bySource.set(item.source, []);
    bySource.get(item.source)!.push(item);
  }

  const results: KolSummary[] = [];

  for (const [source, items] of bySource.entries()) {
    // Skip very short content (likely failed fetch)
    const combined = items.map((i) => i.content).join('\n\n').trim();
    if (combined.length < 50) continue;

    // Use up to 1500 chars — keeps each Groq call ~500 tokens
    const contentSnippet = combined.slice(0, 1500);
    const mediaType = items[0].mediaType;
    const primaryUrl = items[0].url;

    const prompt = `你是一位閱讀投資 KOL 內容的分析師。以下是「${source}」（${mediaType}）近期發表的內容：

---
${contentSnippet}
---

請分析這位 KOL 近期討論的重點，以 JSON 格式回覆：

{
  "keyPoints": [
    "重點1：具體說明他的觀點或分析（20-50字）",
    "重點2：...",
    "重點3：..."
  ],
  "mentionedCompanies": ["公司A（股票代碼）", "公司B"],
  "overallView": "這位 KOL 的整體立場或觀點方向（50字以內）"
}

注意：
- keyPoints 列出 2-5 個重點，每點要具體說明他的分析或論點，不要只說「他討論了某某話題」
- 若有提到具體股票代碼請一起列出
- 若內容不足無法分析，keyPoints 填 ["內容不足，無法分析"]`;

    try {
      const raw = await askLLM<unknown>(prompt, 'json');
      const r = raw as LLMSummaryResult;
      results.push({
        source,
        mediaType,
        url: primaryUrl,
        keyPoints: Array.isArray(r.keyPoints) ? r.keyPoints : [],
        mentionedCompanies: Array.isArray(r.mentionedCompanies) ? r.mentionedCompanies : [],
        overallView: r.overallView ?? '',
      });
    } catch (err) {
      console.warn(`[KolSummarizer] Failed to summarize ${source}:`, err instanceof Error ? err.message : err);
    }
  }

  return results;
}
