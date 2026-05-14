import dotenv from 'dotenv';
dotenv.config({ override: true }); // override: true ensures .env values beat empty shell vars

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

export const config = {
  // ── API keys ──────────────────────────────────────────────────────────────
  groqApiKey: requireEnv('GROQ_API_KEY'),
  tavilyApiKey: requireEnv('TAVILY_API_KEY'),
  googleSheetsCsvUrl: requireEnv('GOOGLE_SHEETS_CSV_URL'),

  // Claude Haiku — primary large-context LLM (replaces Gemini)
  // $0.80/M input, 200k ctx, ~$0.06/day → $100 credit = 1,600 days of runway
  anthropicApiKey: process.env['ANTHROPIC_API_KEY'] ?? '',
  anthropicModel: 'claude-haiku-4-5-20251001',

  // Gemini fallback (optional — set GEMINI_API_KEY to enable dual-LLM strategy)
  geminiApiKey: process.env['GEMINI_API_KEY'] ?? '',
  geminiModel: 'gemini-2.0-flash',

  // Google Custom Search fallback (optional — 100 free queries/day)
  googleCseKey: process.env['GOOGLE_CSE_KEY'] ?? '',
  googleCseId: process.env['GOOGLE_CSE_ID'] ?? '',

  // ── LLM settings (Groq primary: 14,400 req/day, 30 RPM, 12k TPM) ─────────
  // llama-3.3-70b-versatile: 128k context, best for Chinese instruction-following
  llmModel: 'llama-3.3-70b-versatile',

  // 2.5s between calls to stay safely under 30 RPM
  llmDelay: 2500,

  // ── Search settings ───────────────────────────────────────────────────────
  supplyKeywords: '供給 OR 缺貨 OR 擴產 OR 週期 OR 報價 OR shortage OR capacity OR supply constraint',
  lookbackHours: 48,
} as const;
