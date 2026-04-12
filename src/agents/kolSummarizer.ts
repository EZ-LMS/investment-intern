import { askLLM } from '../utils/llm.js';
import type { RawContent, KolSummary } from '../types.js';

const BATCH_SIZE = 3;

interface LLMSummaryResult {
  keyPoints: string[];
  mentionedCompanies: string[];
  overallView: string;
}

interface BatchLLMResult {
  [source: string]: LLMSummaryResult;
}

/**
 * Summarise each tracked KOL / source in batches of BATCH_SIZE.
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

  // Convert Map to array of entries for batching
  const entries = Array.from(bySource.entries());

  // Process in batches of BATCH_SIZE
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);

    // Separate out sources with empty content — handle them without LLM
    const emptyBatch: typeof batch = [];
    const contentBatch: typeof batch = [];
    for (const entry of batch) {
      const combined = entry[1].map((it) => it.content).join('\n\n').trim();
      if (!combined) {
        emptyBatch.push(entry);
      } else {
        contentBatch.push(entry);
      }
    }

    // Push minimal cards for sources with no content
    for (const [source, items] of emptyBatch) {
      results.push({
        source,
        mediaType: items[0]!.mediaType,
        url: items[0]!.url,
        keyPoints: ['本期未能取得內容（字幕不可用或收集失敗）'],
        mentionedCompanies: [],
        overallView: '',
      });
    }

    if (contentBatch.length === 0) continue;

    // Build one prompt for all sources in the content batch
    const firstSource = contentBatch[0]![0];
    const prompt = `你是一位閱讀投資 KOL 內容的分析師。以下是 ${contentBatch.length} 位 KOL 的近期內容，請逐一整理：

${contentBatch.map(([source, items]) => {
  const content = items.map(i => i.content).join('\n\n').slice(0, 1500);
  return `=== ${source} (${items[0]!.mediaType}) ===\n${content}`;
}).join('\n\n')}

請以 JSON 格式回覆，每個 KOL 為一個 key：
{
  "${firstSource}": {
    "keyPoints": ["重點1（20-60字）", "重點2", "重點3"],
    "mentionedCompanies": ["公司A（股票代碼）"],
    "overallView": "整體立場或主題方向（50字以內）"
  },
  ... (其他 KOL 同樣格式)
}

注意：keyPoints 具體說明分析或論點；若有股票代碼請一起列出。`;

    try {
      const raw = await askLLM<unknown>(prompt, 'json');
      const batchResult = raw as BatchLLMResult;

      // Extract each source's data from the batch result
      for (const [source, items] of contentBatch) {
        const mediaType = items[0]!.mediaType;
        const primaryUrl = items[0]!.url;
        const r = batchResult[source];

        if (!r || typeof r !== 'object') {
          console.warn(`[KolSummarizer] Missing result for ${source} in batch response`);
          results.push({
            source,
            mediaType,
            url: primaryUrl,
            keyPoints: items.map((it) => it.content.slice(0, 80)).filter(Boolean).slice(0, 3),
            mentionedCompanies: [],
            overallView: '',
          });
          continue;
        }

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
      }
    } catch (err) {
      console.warn(`[KolSummarizer] Batch failed (sources: ${contentBatch.map(([s]) => s).join(', ')}):`, err instanceof Error ? err.message : err);
      // Always push a card even on error, so no source is silently skipped
      for (const [source, items] of contentBatch) {
        results.push({
          source,
          mediaType: items[0]!.mediaType,
          url: items[0]!.url,
          keyPoints: items.map((it) => it.content.slice(0, 80)).filter(Boolean).slice(0, 3),
          mentionedCompanies: [],
          overallView: '',
        });
      }
    }
  }

  return results;
}
