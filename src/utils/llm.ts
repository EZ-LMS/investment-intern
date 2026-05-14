import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

const groq = new Groq({ apiKey: config.groqApiKey });

// Claude Haiku — primary large-context LLM ($0.80/M tokens, 200k ctx)
// Replaces Gemini which has an unreliable free-tier quota (limit: 0 after exhaustion)
const anthropicClient = config.anthropicApiKey
  ? new Anthropic({ apiKey: config.anthropicApiKey })
  : null;

// Gemini — legacy fallback, only used if Claude key is not set
const geminiClient = config.geminiApiKey
  ? new GoogleGenerativeAI(config.geminiApiKey)
  : null;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Call LLM with a prompt.
 *
 * @param prompt         The user prompt
 * @param format         'json' (default) — forces JSON output and parses it
 *                       'text' — returns raw string (for Markdown generation)
 * @param preferLargeCtx If true, skip Groq and use Claude Haiku first (large
 *                       prompts that risk hitting Groq's 12k TPM). Falls back to
 *                       Gemini if no Claude key, then Groq as last resort.
 *
 * Routing when preferLargeCtx=false (default — Groq first):
 *   Groq → on 413/repeated 429 → Claude → Gemini
 *
 * Routing when preferLargeCtx=true:
 *   Claude Haiku → on failure → Groq → on 413 → Gemini
 */
export async function askLLM<T>(
  prompt: string,
  format: 'json' | 'text' = 'json',
  preferLargeCtx = false
): Promise<T> {
  await delay(config.llmDelay);

  if (preferLargeCtx) {
    if (anthropicClient) {
      console.log('[LLM] preferLargeCtx=true → Claude Haiku');
      try {
        return await callClaude<T>(prompt, format);
      } catch (claudeErr) {
        console.warn('[LLM] Claude failed, falling back to Groq:', claudeErr instanceof Error ? claudeErr.message.slice(0, 120) : claudeErr);
        return callWithRetry<T>(prompt, format);
      }
    }
    // No Claude key → fall back to Gemini (legacy behaviour)
    if (geminiClient) {
      console.log('[LLM] preferLargeCtx=true (no Claude key) → Gemini');
      try {
        return await callGemini<T>(prompt, format);
      } catch (geminiErr) {
        console.warn('[LLM] Gemini failed, falling back to Groq:', geminiErr instanceof Error ? geminiErr.message.slice(0, 120) : geminiErr);
        return callWithRetry<T>(prompt, format);
      }
    }
  }

  return callWithRetry<T>(prompt, format);
}

// ── Claude Haiku ──────────────────────────────────────────────────────────────
async function callClaude<T>(prompt: string, format: 'json' | 'text'): Promise<T> {
  const systemPrompt = format === 'json'
    ? 'You are a financial analysis assistant. Always respond with valid JSON only — no markdown code fences, no explanation outside JSON.'
    : 'You are a financial analysis assistant.';

  const response = await anthropicClient!.messages.create({
    model: config.anthropicModel,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: prompt }],
  });

  const firstBlock = response.content[0];
  const text = firstBlock?.type === 'text' ? firstBlock.text : '';
  if (format === 'text') return text as unknown as T;
  return parseJson<T>(text);
}

// ── Groq (primary for small / fast calls) ────────────────────────────────────
async function callWithRetry<T>(prompt: string, format: 'json' | 'text', attempt = 0): Promise<T> {
  try {
    const response = await groq.chat.completions.create({
      model: config.llmModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      ...(format === 'json' ? { response_format: { type: 'json_object' } } : {}),
    });

    const text = response.choices[0]?.message?.content ?? '';
    if (format === 'text') return text as unknown as T;
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

    // 413 or repeated 429 → fall back to Claude
    if ((is413 || isRateLimit) && anthropicClient) {
      console.warn(`[LLM] Groq ${is413 ? '413 (prompt too large)' : '429 exhausted'} → falling back to Claude`);
      return callClaude<T>(prompt, format);
    }

    // No Claude → legacy Gemini fallback
    if ((is413 || isRateLimit) && geminiClient) {
      console.warn(`[LLM] Groq ${is413 ? '413' : '429'} → falling back to Gemini`);
      return callGemini<T>(prompt, format);
    }

    throw err;
  }
}

// ── Gemini (legacy fallback, only when Claude key is not set) ─────────────────
async function callGemini<T>(prompt: string, format: 'json' | 'text'): Promise<T> {
  const model = geminiClient!.getGenerativeModel({
    model: config.geminiModel,
    generationConfig: format === 'json'
      ? { responseMimeType: 'application/json' }
      : {},
  });

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  if (format === 'text') return text as unknown as T;
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
