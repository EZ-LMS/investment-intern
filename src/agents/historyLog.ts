import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { DashboardData, IndustryReport } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = path.resolve(__dirname, '../../knowledge');
const HISTORY_FILE = path.join(KNOWLEDGE_DIR, 'history.md');

/**
 * Append today's pipeline run summary to knowledge/history.md (newest at top).
 * Pure local file operation — no API calls.
 */
export function appendHistory(data: DashboardData): void {
  if (!fs.existsSync(KNOWLEDGE_DIR)) {
    fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
  }

  const today = new Date(data.generatedAt).toISOString().split('T')[0] ?? '';
  const entry = buildEntry(today, data);

  if (fs.existsSync(HISTORY_FILE)) {
    const existing = fs.readFileSync(HISTORY_FILE, 'utf-8');
    fs.writeFileSync(HISTORY_FILE, entry + existing, 'utf-8');
  } else {
    const header = '# Investment Intern — 每日報告歷史記錄\n\n<!-- 最新報告在最上方 -->\n\n';
    fs.writeFileSync(HISTORY_FILE, header + entry, 'utf-8');
  }

  console.log(`   [History] 已記錄 ${today} 報告到 knowledge/history.md`);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function buildEntry(today: string, data: DashboardData): string {
  const modeLabel = data.mode === 'structural' ? '供給面結構性機會' : 'KOL 討論彙整';
  const lines: string[] = [];

  lines.push(`## ${today} ｜ ${modeLabel}\n`);

  if (data.mode === 'structural' && data.reports.length > 0) {
    // Industries summary line
    const industryList = data.reports
      .map((r) => `${r.industry.industry}（信心 ${r.industry.confidenceScore}/10）`)
      .join('、');
    lines.push(`**發現產業**：${industryList}\n`);

    // Company table
    lines.push('');
    lines.push('| 產業 | 推薦台股 | 推薦美股 |');
    lines.push('|------|---------|---------|');
    for (const report of data.reports) {
      const twStocks = report.companies
        .filter((c) => c.market === 'TW')
        .map((c) => `${c.ticker} ${c.name}`)
        .join('、') || '—';
      const usStocks = report.companies
        .filter((c) => c.market === 'US')
        .map((c) => `${c.ticker} ${c.name}`)
        .join('、') || '—';
      lines.push(`| ${report.industry.industry} | ${twStocks} | ${usStocks} |`);
    }
    lines.push('');

    // Credibility highlights
    const highlights = buildCredibilityHighlights(data.reports);
    if (highlights) {
      lines.push(`**管理層評鑑亮點**：${highlights}\n`);
    }

    // Supply constraint reasons
    lines.push('**供給限制摘要**：');
    for (const report of data.reports) {
      lines.push(`- **${report.industry.industry}**：${report.industry.supplyConstraintReason}`);
    }
    lines.push('');
  } else if (data.mode === 'kol-summary' && data.kolTopics.length > 0) {
    lines.push('**KOL 熱議主題**：');
    for (const topic of data.kolTopics.slice(0, 5)) {
      const companies = topic.mentionedCompanies.length > 0
        ? `（相關公司：${topic.mentionedCompanies.join('、')}）`
        : '';
      lines.push(`- **${topic.topic}** ${companies}：${topic.summary}`);
    }
    lines.push('');
  } else {
    lines.push('（本次未發現結構性機會，亦無 KOL 主題摘要）\n');
  }

  lines.push('---\n\n');
  return lines.join('\n');
}

function buildCredibilityHighlights(reports: IndustryReport[]): string {
  const items: string[] = [];
  for (const report of reports) {
    for (const c of report.credibility) {
      if (c.credibilityType === 'conservative') {
        items.push(`${c.name} 保守型`);
      } else if (c.credibilityType === 'optimistic') {
        items.push(`${c.name} 樂觀型`);
      }
    }
  }
  return items.slice(0, 4).join('；');
}
