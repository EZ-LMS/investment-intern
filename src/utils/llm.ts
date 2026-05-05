import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config.js';

const groq = new Groq({ apiKey: config.groqApiKey });

// Gemini client is optional — only created when GEMINI_API_KEY is set
const geminiClient = config.geminiApiKey
  ? new GoogleGenerativeAI(config.geminiApiKey)
  : null;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Call LLM with a prompt.
 *
 * @param prompt       The user prompt
 * @param format       'json' (default) — forces JSON output and parses it
 *                     'text' — returns raw string (for Markdown generation)
 * @param preferGemini If true AND Gemini is available, skip Groq entirely and go
 *                     straight to Gemini. Use for large prompts (earnings docs,
 *                     multi-company batches) that risk hitting Groq's 12k TPM limit.
 *
 * Routing when preferGemini=false (default — Groq first):
 *   Groq → on 413 (too large) or repeated 429 (rate limit) → Gemini fallback
 *
 * Routing when preferGemini=true:
 *   Gemini → on failure → Groq fallback
 */
export async function askLLM<T>(
  prompt: string,
  format: 'json' | 'text' = 'json',
  preferGemini = false
): Promise<T> {
  await delay(config.llmDelay);

  if (preferGemini && geminiClient) {
    console.log('[LLM] preferGemini=true → Gemini');
    try {
      return await callGemini<T>(prompt, format);
    } catch (geminiErr) {
      console.warn('[LLM] Gemini failed, falling back to Groq:', geminiErr instanceof Error ? geminiErr.message : geminiErr);
      return callWithRetry<T>(prompt, format);
    }
  }

  return callWithRetry<T>(prompt, format);
}

async function callWithRetry<T>(prompt: string, format: 'json' | 'text', attempt = 0): Promise<T> {
  try {
    const response = await groq.chat.completions.create({
      model: config.llmModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      ...(format === 'json' ? { response_format: { type: 'json_object' } } : {}),
    });

    const text = response.choices[0]?.message?.content ?? '';

    if (format === 'text') {
      return text as unknown as T;
    }
    return parseJson<T>(text);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const is413 = msg.includes('413');
    const isRateLimit = !is413 && (msg.includes('429') || msg.includes('rate_limit') || msg.includes('quota'));

    // 429: retry Groq once with a wait
    if (isRateLimit && attempt < 1) {
      console.warn(`[LLM] Groq rate limited, retrying in 15s… (attempt ${attempt + 1})`);
      await delay(15_000);
      return callWithRetry<T>(prompt, format, attempt + 1);
    }

    // 413 (too large) or repeated 429 → fall back to Gemini
    if ((is413 || isRateLimit) && geminiClient) {
      console.warn(`[LLM] Groq ${is413 ? '413 (prompt too large)' : '429 (exhausted retries)'} → falling back to Gemini`);
      return callGemini<T>(prompt, format);
    }

    throw err;
  }
}

async function callGemini<T>(prompt: string, format: 'json' | 'text'): Promise<T> {
  const model = geminiClient!.getGenerativeModel({
    model: config.geminiModel,
    generationConfig: format === 'json'
      ? { responseMimeType: 'application/json' }
      : {},
  });

  const result = await model.generateContent(prompt);
  const text = result.response.text();

  if (format === 'text') {
    return text as unknown as T;
  }
  return parseJson<T>(text);
}

function parseJson<T>(text: string): T {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error(`LLM returned non-JSON response:\n${text.slice(0, 500)}`);
  }
}
