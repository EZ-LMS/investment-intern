import type { RawContent } from '../types.js';

const REPO = 'EZ-LMS/investment-intern';
const LABEL = 'user-feedback';

/**
 * Reads open GitHub Issues with the "user-feedback" label as supplementary
 * pipeline context. No token required — public repo read is unauthenticated.
 */
export async function collectFeedback(): Promise<RawContent[]> {
  try {
    const url = `https://api.github.com/repos/${REPO}/issues?labels=${LABEL}&state=open&per_page=20`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'investment-intern-bot',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.warn(`[Feedback] GitHub Issues API returned ${res.status}`);
      return [];
    }

    const issues = await res.json() as Array<{
      number: number;
      title: string;
      body: string | null;
      html_url: string;
      created_at: string;
    }>;

    if (!Array.isArray(issues) || issues.length === 0) return [];

    console.log(`   [Feedback] 讀取到 ${issues.length} 筆用戶回饋`);

    return issues.map((issue) => ({
      source: 'user-feedback',
      mediaType: 'feedback',
      url: issue.html_url,
      content: `【用戶回饋 #${issue.number}】${issue.title}\n${issue.body ?? ''}`.slice(0, 2000),
      publishedAt: issue.created_at,
    }));
  } catch (err) {
    console.warn('[Feedback] Failed to fetch GitHub Issues:', err instanceof Error ? err.message : err);
    return [];
  }
}
