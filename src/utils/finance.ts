import yahooFinance from 'yahoo-finance2';

export interface FinancialSummary {
  ticker: string;
  pe?: string;
  eps?: string;
  epsForward?: string;
}

/**
 * Fetch basic financial metrics for a ticker.
 * Supports both US tickers (NVDA) and Taiwan tickers (2330.TW).
 */
const yf = new yahooFinance();

export async function fetchFinancials(ticker: string): Promise<FinancialSummary> {
  try {
    const q = await yf.quote(ticker);
    const equity = q as { trailingPE?: number; epsTrailingTwelveMonths?: number; epsForward?: number; regularMarketPrice?: number };

    const pe = equity.trailingPE != null ? `P/E ${equity.trailingPE.toFixed(1)}` : undefined;
    const eps = equity.epsTrailingTwelveMonths != null ? `EPS $${equity.epsTrailingTwelveMonths.toFixed(2)}` : undefined;
    const epsForward = equity.epsForward != null ? `Forward EPS $${equity.epsForward.toFixed(2)}` : undefined;

    return { ticker, pe, eps, epsForward };
  } catch (err) {
    console.warn(`[Finance] Failed to fetch ${ticker}:`, err instanceof Error ? err.message : err);
    return { ticker };
  }
}

/**
 * Normalise a Taiwan ticker: if it's a number like "2330", append ".TW"
 */
export function normaliseTicker(ticker: string, market: 'TW' | 'US'): string {
  if (market === 'TW' && !ticker.includes('.')) {
    return `${ticker}.TW`;
  }
  return ticker;
}
