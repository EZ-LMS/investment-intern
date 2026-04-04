import Groq from 'groq-sdk';
import { config } from '../config.js';

const groq = new Groq({ apiKey: config.groqApiKey });

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Call Groq LLM with a prompt.
 * @param prompt  The user prompt
 * @param format  'json' (default) — forces JSON output and parses it
 *                'text' — returns raw string (for Markdown generation)
 */
export async function askLLM<T>(prompt: string, format: 'json' | 'text' = 'json'): Promise<T> {
  await delay(config.llmDelay);
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
    const isRateLimit = msg.includes('429') || msg.includes('rate_limit') || msg.includes('quota');

    if (isRateLimit && attempt < 2) {
      const waitMs = attempt === 0 ? 15_000 : 60_000;
      console.warn(`[LLM] Rate limited, retrying in ${waitMs / 1000}s… (attempt ${attempt + 1})`);
      await delay(waitMs);
      return callWithRetry<T>(prompt, format, attempt + 1);
    }
    throw err;
  }
}

function parseJson<T>(text: string): T {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error(`LLM returned non-JSON response:\n${text.slice(0, 500)}`);
  }
}
