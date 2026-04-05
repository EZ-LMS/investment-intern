export interface TrackingSource {
  media: string; // "Threads" | "YT" | "Podcast" | "財訊" | ...
  name: string;
  link: string;
}

export interface RawContent {
  source: string;
  mediaType: string;
  url: string;
  content: string;
  publishedAt?: string;
}

export interface Industry {
  industry: string;
  supplyConstraintReason: string;
  timeToMarketYears: number;
  structuralDemandEvidence: string;
  confidenceScore: number;
}

export interface Company {
  ticker: string;
  name: string;
  market: 'TW' | 'US';
  themeProduct: string;
  themeRevenuePercent: string;
  marketShare: string;
  lowRevenueWarning: boolean;
  financials: {
    pe?: string;
    eps?: string;
    epsForward?: string;
  };
  sources: string[];
}

export interface CredibilityResult {
  ticker: string;
  name: string;
  market: 'TW' | 'US';
  credibilityType: 'conservative' | 'optimistic' | 'accurate' | 'unknown';
  previousGuidance: string;
  actualResult: string;
  latestGuidance: string;
  sourceUrl?: string;
}

export interface IndustryReport {
  industry: Industry;
  companies: Company[];
  credibility: CredibilityResult[];
}

export interface KolTopic {
  topic: string;
  mentionedCompanies: string[];
  summary: string;
  sourceUrls: string[];
}

/** Per-KOL detailed summary produced by kolSummarizer */
export interface KolSummary {
  source: string;             // KOL name / account handle
  mediaType: string;          // "Threads" | "YT" | "Podcast" | "news"
  url: string;                // primary source URL
  keyPoints: string[];        // 2-5 specific discussion points
  mentionedCompanies: string[]; // stocks / companies mentioned
  overallView: string;        // overall stance (≤50 chars)
}

export interface DashboardData {
  generatedAt: string;
  mode: 'structural' | 'kol-summary';
  reports: IndustryReport[];
  kolTopics: KolTopic[];
  kolSummaries: KolSummary[];
  rawSources: RawContent[];
}

export interface IndustryKnowledge {
  industryName: string;
  filePath: string;
  content: string;
  isNew: boolean;
}
