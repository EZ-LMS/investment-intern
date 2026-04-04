import 'dotenv/config';

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

  // Gemini fallback (optional — set GEMINI_API_KEY to enable dual-LLM strategy)
  geminiApiKey: process.env['GEMINI_API_KEY'] ?? '',
  geminiModel: 'gemini-2.0-flash',

  // ── LLM settings (Groq primary: 14,400 req/day, 30 RPM, 12k TPM) ─────────
  // llama-3.3-70b-versatile: 128k context, best for Chinese instruction-following
  llmModel: 'llama-3.3-70b-versatile',

  // 2.5s between calls to stay safely under 30 RPM
  llmDelay: 2500,

  // ── Search settings ───────────────────────────────────────────────────────
  supplyKeywords: '供給 OR 缺貨 OR 擴產 OR 週期 OR 報價 OR shortage OR capacity OR supply constraint',
  lookbackHours: 48,
} as const;
