import { askLLM } from '../utils/llm.js';
import type { Industry, KolTopic, RawContent } from '../types.js';

interface FilterResult {
  mode: 'structural' | 'kol-summary';
  industries: Industry[];
  kolTopics: KolTopic[];
}

export async function filterIndustries(rawContents: RawContent[]): Promise<FilterResult> {
  if (rawContents.length === 0) {
    return { mode: 'kol-summary', industries: [], kolTopics: [] };
  }

  const contentBlock = rawContents
    .map((r) => `[來源: ${r.source} (${r.mediaType})]\n${r.content}`)
    .join('\n\n---\n\n')
    .slice(0, 60_000);

  const prompt = `你是一位專業的供給面投資研究員，擅長「穿透式研究」。

以下是近 48 小時從各 KOL 社群媒體、YouTube 頻道、財經媒體收集到的原始內容：

${contentBlock}

---

你的任務分兩步驟：

**步驟一：判斷是否存在符合「供給面結構性機會」的產業**

判斷標準（需同時符合）：
1. **Time-to-market > 1 年**：該產業的產能擴充，需要至少 1 年以上才能追上需求（蓋廠、造船、長交期零件、特殊材料等）
2. **結構性供給不足**：目前已發生或正在形成供給長期追不上需求的結構性缺口

⚠️ 重要原則：
- 就算該產業是傳統製造業、中低階製造、或非熱門板塊，只要符合上述兩個條件，**絕對不能排除**
- 典型案例：航運（造船 3 年）、記憶體（蓋廠 2 年）、電力設備（變壓器交期 2 年）、PCB、被動元件
- **不能因為「產業不夠高科技」或「KOL 沒有直接提到」就過濾掉**，要從文字中找出隱含的供給信號

**步驟二：根據結果決定輸出模式**

若找到 1 個以上符合條件的產業 → 輸出 mode = "structural"
若沒有任何產業符合條件 → 輸出 mode = "kol-summary"，整理 KOL 討論的主題

請以 JSON 格式回覆：

{
  "mode": "structural" | "kol-summary",
  "industries": [
    {
      "industry": "產業名稱（繁體中文）",
      "supplyConstraintReason": "供給受限的具體原因（100字以內）",
      "timeToMarketYears": 2,
      "structuralDemandEvidence": "需求結構性依據，直接引用原始內容中的關鍵句子",
      "confidenceScore": 7
    }
  ],
  "kolTopics": [
    {
      "topic": "討論主題名稱",
      "mentionedCompanies": ["公司A", "公司B"],
      "summary": "主題摘要（150字以內）",
      "sourceUrls": ["url1", "url2"]
    }
  ]
}

注意：
- industries 在 mode="structural" 時最多 3 個，mode="kol-summary" 時為空陣列
- kolTopics 在 mode="kol-summary" 時最多 5 個主題，mode="structural" 時也可附上 1-2 個作為補充
- confidenceScore 範圍 1-10`;

  const result = await askLLM<FilterResult>(prompt);
  return {
    mode: result.mode ?? 'kol-summary',
    industries: result.industries ?? [],
    kolTopics: result.kolTopics ?? [],
  };
}
