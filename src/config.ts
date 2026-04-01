import 'dotenv/config';

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

export const config = {
  geminiApiKey: requireEnv('GEMINI_API_KEY'),
  tavilyApiKey: requireEnv('TAVILY_API_KEY'),
  googleSheetsCsvUrl: requireEnv('GOOGLE_SHEETS_CSV_URL'),

  // Search keywords for supply-side signals
  supplyKeywords: '供給 OR 缺貨 OR 擴產 OR 週期 OR 報價 OR shortage OR capacity OR supply constraint',

  // How many hours back to look for content
  lookbackHours: 48,

  // Gemini model
  geminiModel: 'gemini-2.5-flash',

  // Delays (ms) to respect Gemini free tier RPM limits
  geminiDelay: 5000,
} as const;
