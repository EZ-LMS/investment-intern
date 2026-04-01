import { askGemini } from '../utils/gemini.js';
import { fetchFinancials, normaliseTicker } from '../utils/finance.js';
import type { Company, Industry } from '../types.js';

interface CompanyPickResult {
  twStocks: RawCompany[];
  usStocks: RawCompany[];
}

interface RawCompany {
  ticker: string;
  name: string;
  themeProduct: string;
  themeRevenuePercent: string;
  marketShare: string;
  lowRevenueWarning: boolean;
}

export async function pickCompanies(industry: Industry): Promise<Company[]> {
  const prompt = `你是一位專業投資分析師。

產業：${industry.industry}
供給限制原因：${industry.supplyConstraintReason}

請找出這個產業中，**市佔率或相關營收前三名**的公司，分別列出：
- 台灣上市/上櫃股票（台股）top 3
- 美國上市股票（美股）top 3

每家公司需要提供：
- ticker：台股填股票代碼（如 2330），美股填代碼（如 NVDA）
- name：公司名稱（台股用繁體中文，美股用英文）
- themeProduct：與「${industry.industry}」直接相關的核心產品或業務名稱
- themeRevenuePercent：此主題產品佔該公司**總營收**的估計比例（如 "約 15%"、"約 60%"、"不明"）
- marketShare：此公司在${industry.industry}的市佔率估計（如 "約 30%"、"市場前三"）
- lowRevenueWarning：若 themeRevenuePercent 低於 20%，設為 true；否則 false

⚠️ 注意：如果台股或美股中找不到明確相關公司，填空陣列即可，不要強行填入不相關的公司。

以 JSON 格式回覆：
{
  "twStocks": [
    {
      "ticker": "2330",
      "name": "台積電",
      "themeProduct": "先進封裝 CoWoS",
      "themeRevenuePercent": "約 10-15%",
      "marketShare": "約 90%（先進封裝）",
      "lowRevenueWarning": true
    }
  ],
  "usStocks": [
    {
      "ticker": "NVDA",
      "name": "NVIDIA",
      "themeProduct": "AI GPU",
      "themeRevenuePercent": "約 80%",
      "marketShare": "約 80%（AI 訓練 GPU）",
      "lowRevenueWarning": false
    }
  ]
}`;

  const raw = await askGemini<CompanyPickResult>(prompt);
  const allRaw = [
    ...(raw.twStocks ?? []).slice(0, 3).map((c) => ({ ...c, market: 'TW' as const })),
    ...(raw.usStocks ?? []).slice(0, 3).map((c) => ({ ...c, market: 'US' as const })),
  ];

  const companies: Company[] = [];
  for (const c of allRaw) {
    const normTicker = normaliseTicker(c.ticker, c.market);
    const financials = await fetchFinancials(normTicker);
    companies.push({
      ticker: c.ticker,
      name: c.name,
      market: c.market,
      themeProduct: c.themeProduct,
      themeRevenuePercent: c.themeRevenuePercent,
      marketShare: c.marketShare,
      lowRevenueWarning: c.lowRevenueWarning,
      financials: {
        pe: financials.pe,
        eps: financials.eps,
        epsForward: financials.epsForward,
      },
      sources: [],
    });
    await new Promise((r) => setTimeout(r, 1000));
  }

  return companies;
}
