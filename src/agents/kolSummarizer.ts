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
 * Always produces a card per source — even if only a title/description
 * is available — so the user sees what was published rather than silence.
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
    const combined = items.map((i) => i.content).join('\n\n').trim();
    const mediaType = items[0].mediaType;
    const primaryUrl = items[0].url;

    // If content is truly empty, show a minimal card without LLM
    if (!combined) {
      results.push({
        source,
        mediaType,
        url: primaryUrl,
        keyPoints: ['本期未能取得內容（字幕不可用或收集失敗）'],
        mentionedCompanies: [],
        overallView: '',
      });
      continue;
    }

    // Use up to 1500 chars — keeps each Groq call ~500 tokens
    const contentSnippet = combined.slice(0, 1500);
    const isShort = combined.length < 100;

    const prompt = `你是一位閱讀投資 KOL 內容的分析師。以下是「${source}」（${mediaType}）近期發布的內容：

---
${contentSnippet}
---

請整理這位 KOL 近期的內容，以 JSON 格式回覆：

{
  "keyPoints": [
    "重點1（20-60字）",
    "重點2",
    "重點3"
  ],
  "mentionedCompanies": ["公司A（股票代碼）", "公司B"],
  "overallView": "整體立場或主題方向（50字以內）"
}

注意：
${isShort
  ? `- 目前只有標題或簡短摘要，請根據現有資訊整理「他發布了什麼」，不要說「內容不足」
- keyPoints 列出集數標題、大致主題、或已知的討論方向`
  : `- keyPoints 列出 2-5 個重點，具體說明他的分析或論點，不要只說「他討論了某某話題」
- 若有提到具體股票代碼請一起列出`}
- overallView 說明這位 KOL 近期關注的方向`;

    try {
      const raw = await askLLM<unknown>(prompt, 'json');
      const r = raw as LLMSummaryResult;
      results.push({
        source,
        mediaType,
        url: primaryUrl,
        keyPoints: Array.isArray(r.keyPoints) && r.keyPoints.length > 0
          ? r.keyPoints
          : ['無法解析內容'],
        mentionedCompanies: Array.isArray(r.mentionedCompanies) ? r.mentionedCompanies : [],
        overallView: r.overallView ?? '',
      });
    } catch (err) {
      console.warn(`[KolSummarizer] Failed to summarize ${source}:`, err instanceof Error ? err.message : err);
      // Always push a card even on error, so the source isn't silently skipped
      results.push({
        source,
        mediaType,
        url: primaryUrl,
        keyPoints: items.map((i) => i.content.slice(0, 80)).filter(Boolean).slice(0, 3),
        mentionedCompanies: [],
        overallView: '',
      });
    }
  }

  return results;
}
