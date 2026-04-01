import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config.js';

const genAI = new GoogleGenerativeAI(config.geminiApiKey);

const model = genAI.getGenerativeModel({
  model: config.geminiModel,
  generationConfig: { responseMimeType: 'application/json' },
});

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Call Gemini with a prompt that expects a JSON response.
 * Retries once on rate-limit errors after a longer delay.
 */
export async function askGemini<T>(prompt: string): Promise<T> {
  await delay(config.geminiDelay);
  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    return parseJson<T>(text);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('429') || msg.includes('quota')) {
      console.warn('[Gemini] Rate limited, retrying in 30s…');
      await delay(30_000);
      const result = await model.generateContent(prompt);
      return parseJson<T>(result.response.text());
    }
    throw err;
  }
}

function parseJson<T>(text: string): T {
  // Strip markdown code fences if present
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error(`Gemini returned non-JSON response:\n${text.slice(0, 500)}`);
  }
}
