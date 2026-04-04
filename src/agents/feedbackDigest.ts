import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { askLLM } from '../utils/llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = path.resolve(__dirname, '../../knowledge');
const DIGEST_FILE = path.join(KNOWLEDGE_DIR, 'user-feedback-digest.md');

/** Max issues to accumulate before forcing a digest consolidation */
const DIGEST_THRESHOLD = 10;

interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  created_at: string;
}

/**
 * Fetch open feedback issues, and if enough have accumulated, consolidate them
 * into knowledge/user-feedback-digest.md and close the processed issues.
 *
 * The digest file accumulates learned preferences, industry insights, and
 * data source suggestions provided by the user over time.
 */
export async function runFeedbackDigest(): Promise<void> {
  const issues = await fetchOpenFeedbackIssues();
  if (issues.length === 0) {
    console.log('   [FeedbackDigest] 無新回饋，跳過');
    return;
  }

  console.log(`   [FeedbackDigest] 發現 ${issues.length} 筆回饋`);

  // Always incorporate into digest if we have any issues, but only close when above threshold
  const shouldClose = issues.length >= DIGEST_THRESHOLD;
  await consolidateIntoDigest(issues);

  if (shouldClose) {
    console.log(`   [FeedbackDigest] 達到 ${DIGEST_THRESHOLD} 筆門檻，關閉已處理 Issues`);
    await closeProcessedIssues(issues);
  } else {
    console.log(`   [FeedbackDigest] 已更新 digest（累積 ${issues.length} 筆，滿 ${DIGEST_THRESHOLD} 筆時自動關閉）`);
  }
}

async function consolidateIntoDigest(issues: GitHubIssue[]): Promise<void> {
  if (!fs.existsSync(KNOWLEDGE_DIR)) {
    fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
  }

  const existingDigest = fs.existsSync(DIGEST_FILE)
    ? fs.readFileSync(DIGEST_FILE, 'utf-8')
    : '';

  const issueBlock = issues
    .map((i) => `### Issue #${i.number} — ${i.title}\n${i.body ?? '（無內容）'}`)
    .join('\n\n---\n\n');

  const today = new Date().toISOString().split('T')[0];

  const prompt = `你是投資研究助理的知識管理員。
以下是用戶提供的新回饋（${issues.length} 筆），以及現有的已彙整知識庫。

---
## 新回饋
${issueBlock}

---
## 現有知識庫（若空白表示尚未建立）
${existingDigest || '（尚未建立）'}

---

請將新回饋的內容彙整並融入知識庫，產出一份更新後的完整 Markdown 文件。

文件結構必須包含以下段落（若無相關內容可留空，但標題要保留）：

# 用戶回饋知識庫
> 最後更新：${today}

## 產業偏好與觀察
（用戶對哪些產業特別感興趣、有獨到見解、或認為應重點追蹤）

## 股票與公司補充資訊
（用戶提供的特定公司資訊、尚未在系統中追蹤的公司、市佔與競爭格局補充）

## 篩選邏輯調整建議
（用戶對供給面篩選條件、時間框架、信心分數等的修正意見）

## 資料來源建議
（用戶建議新增到追蹤清單的 KOL、媒體、法說會來源）

## 其他備忘
（不屬於以上分類的重要觀察或提醒）

## 處理紀錄
（記錄哪些 Issue 已被彙整，格式：- #號碼 YYYY-MM-DD：簡短摘要）

請直接輸出完整 Markdown 內容，不要加任何前言或解釋。`;

  try {
    const digest = await askLLM<string>(prompt, 'text');
    fs.writeFileSync(DIGEST_FILE, digest, 'utf-8');
    console.log(`   [FeedbackDigest] 知識庫已更新：knowledge/user-feedback-digest.md`);
  } catch (err) {
    console.warn('[FeedbackDigest] LLM digest failed:', err instanceof Error ? err.message : err);
    // Append raw issues to digest as fallback
    const fallback = `\n\n---\n## 待彙整回饋（${today}）\n${issueBlock}\n`;
    fs.appendFileSync(DIGEST_FILE, fallback, 'utf-8');
  }
}

async function fetchOpenFeedbackIssues(): Promise<GitHubIssue[]> {
  try {
    const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'investment-intern-bot',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(
      'https://api.github.com/repos/EZ-LMS/investment-intern/issues?labels=user-feedback&state=open&per_page=50',
      { headers, signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) return [];
    const data = await res.json() as GitHubIssue[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function closeProcessedIssues(issues: GitHubIssue[]): Promise<void> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (!token) {
    console.warn('   [FeedbackDigest] 無 GITHUB_TOKEN，無法自動關閉 Issues');
    return;
  }

  for (const issue of issues) {
    try {
      await fetch(
        `https://api.github.com/repos/EZ-LMS/investment-intern/issues/${issue.number}`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            state: 'closed',
            body: (issue.body ?? '') + '\n\n---\n_✅ 已由 Investment Intern 自動彙整至 knowledge/user-feedback-digest.md_',
          }),
          signal: AbortSignal.timeout(8_000),
        }
      );
    } catch {
      // Non-fatal, just log
    }
  }
}
