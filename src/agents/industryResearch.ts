import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { tavily } from '@tavily/core';
import { askLLM } from '../utils/llm.js';
import { config } from '../config.js';
import type { Industry } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = path.resolve(__dirname, '../../knowledge/industries');
const REFRESH_DAYS = 30; // 超過幾天後重新更新

const client = tavily({ apiKey: config.tavilyApiKey });

export interface IndustryKnowledge {
  industryName: string;
  filePath: string;
  content: string;
  isNew: boolean;
}

/**
 * For each identified industry, ensure a knowledge MD file exists and is fresh.
 * Returns the knowledge content to be used as context in downstream agents.
 */
export async function researchIndustries(industries: Industry[]): Promise<Map<string, IndustryKnowledge>> {
  if (!fs.existsSync(KNOWLEDGE_DIR)) {
    fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
  }

  const knowledgeMap = new Map<string, IndustryKnowledge>();

  for (const industry of industries) {
    const knowledge = await ensureIndustryKnowledge(industry);
    knowledgeMap.set(industry.industry, knowledge);
  }

  return knowledgeMap;
}

async function ensureIndustryKnowledge(industry: Industry): Promise<IndustryKnowledge> {
  const slug = slugify(industry.industry);
  const filePath = path.join(KNOWLEDGE_DIR, `${slug}.md`);
  const today = new Date().toISOString().split('T')[0] ?? '';

  // ── Case 1: File exists and is fresh ──────────────────────────────────────
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lastUpdated = parseLastUpdated(content);

    if (lastUpdated && daysSince(lastUpdated) <= REFRESH_DAYS) {
      console.log(`   [Research] ${industry.industry}: 使用現有知識庫（${daysSince(lastUpdated)} 天前更新）`);
      return { industryName: industry.industry, filePath, content, isNew: false };
    }

    // ── Case 2: File exists but stale — refresh ──────────────────────────
    console.log(`   [Research] ${industry.industry}: 知識庫已過期（${daysSince(lastUpdated ?? '')} 天），重新更新…`);
    const updatedContent = await buildKnowledgeDoc(industry, today, content);
    fs.writeFileSync(filePath, updatedContent, 'utf-8');
    return { industryName: industry.industry, filePath, content: updatedContent, isNew: false };
  }

  // ── Case 3: File doesn't exist — create new ─────────────────────────────
  console.log(`   [Research] ${industry.industry}: 建立新知識庫…`);
  const newContent = await buildKnowledgeDoc(industry, today, null);
  fs.writeFileSync(filePath, newContent, 'utf-8');
  return { industryName: industry.industry, filePath, content: newContent, isNew: true };
}

async function buildKnowledgeDoc(
  industry: Industry,
  today: string,
  existingContent: string | null
): Promise<string> {
  // Fetch background research via Tavily
  const queries = [
    `${industry.industry} 產業 上中下游 供應鏈 分析`,
    `${industry.industry} industry supply chain upstream downstream analysis`,
    `${industry.industry} 產業邏輯 景氣循環 需求驅動`,
  ];

  const searchResults: string[] = [];
  for (const q of queries) {
    try {
      const res = await client.search(q, { maxResults: 3, searchDepth: 'basic' });
      for (const item of res.results) {
        if (item.content && item.content.length > 100) {
          searchResults.push(`[${item.url}]\n${item.content.slice(0, 2000)}`);
        }
      }
    } catch {
      // ignore search errors
    }
    await new Promise((r) => setTimeout(r, 600));
  }

  const searchBlock = searchResults.slice(0, 6).join('\n\n---\n\n');
  const createdDate = existingContent ? parseCreatedDate(existingContent) ?? today : today;
  const isUpdate = existingContent !== null;

  const prompt = `你是一位專業的產業分析師。請針對「${industry.industry}」產業，撰寫一份完整的產業研究報告。

供給面背景：${industry.supplyConstraintReason}
Time-to-market：約 ${industry.timeToMarketYears} 年
需求依據：${industry.structuralDemandEvidence}

以下是相關搜尋資料：
${searchBlock}

${isUpdate ? `\n以下是舊版報告（請更新並保留有價值的資訊）：\n${existingContent?.slice(0, 3000)}` : ''}

請輸出以下 Markdown 格式（直接輸出，不要加 \`\`\`）：

# ${industry.industry} 產業研究報告

> 最後更新：${today} ｜ 建立：${createdDate}

## 產業概覽
（150-200 字，說明產業定義、規模、重要性）

## 上中下游供應鏈
### 上游（原材料／設備）
（條列式，3-5 項）
### 中游（製造／加工）
（條列式，3-5 項）
### 下游（應用／終端客戶）
（條列式，3-5 項）

## 產業邏輯與週期
（150-200 字，說明景氣循環特徵、定價機制、庫存週期）

## 關鍵供需驅動因素
### 需求側
（條列式，3-5 項）
### 供給側
（條列式，包含建廠時間、技術門檻等）

## 主要業者與市佔
（台股與美股各前三，含市佔估計）

## 更新日誌
| 日期 | 摘要 |
|------|------|
| ${today} | ${isUpdate ? '定期更新' : '初始建立'} |
${isUpdate ? extractUpdateLog(existingContent ?? '') : ''}`;

  try {
    const rawMd = await askLLM<string>(prompt, 'text');
    return typeof rawMd === 'string' ? rawMd : JSON.stringify(rawMd, null, 2);
  } catch (err) {
    console.warn(`   [Research] LLM failed for ${industry.industry}:`, err instanceof Error ? err.message : err);
    // Return a minimal placeholder
    return `# ${industry.industry} 產業研究報告\n\n> 最後更新：${today} ｜ 建立：${createdDate}\n\n（Gemini 分析暫時失敗，下次更新時重試）\n\n## 更新日誌\n| 日期 | 摘要 |\n|------|------|\n| ${today} | 初始建立（失敗） |\n`;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name.replace(/[\s\/\\:*?"<>|]/g, '-').replace(/-+/g, '-').trim();
}

function parseLastUpdated(content: string): string | null {
  const match = content.match(/最後更新：(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
}

function parseCreatedDate(content: string): string | null {
  const match = content.match(/建立：(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
}

function daysSince(dateStr: string): number {
  const then = new Date(dateStr).getTime();
  const now = Date.now();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}

function extractUpdateLog(content: string): string {
  // Extract existing update log rows (skip the header)
  const match = content.match(/## 更新日誌[\s\S]*?\n(\|[\s\S]*?)(?=\n##|$)/);
  if (!match) return '';
  const rows = match[1]?.split('\n').filter((r) => r.startsWith('|') && !r.includes('---') && !r.includes('日期')) ?? [];
  return rows.slice(0, 10).join('\n'); // Keep last 10 entries
}
