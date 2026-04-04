import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { fetchTrackingSources } from './collectors/sheets.js';
import { collectThreads } from './collectors/threads.js';
import { collectYouTube } from './collectors/youtube.js';
import { collectNews } from './collectors/news.js';
import { collectFeedback } from './collectors/feedback.js';
import { filterIndustries } from './agents/industryFilter.js';
import { researchIndustries } from './agents/industryResearch.js';
import { pickCompanies } from './agents/companyPicker.js';
import { enrichCompaniesWithDocs } from './agents/metricsExtractor.js';
import { checkCredibilityBatch } from './agents/credibilityCheck.js';
import { appendHistory } from './agents/historyLog.js';
import { runFeedbackDigest } from './agents/feedbackDigest.js';
import { generateDashboard } from './output/dashboard.js';
import type { DashboardData, IndustryReport } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isDryRun = process.argv.includes('--dry-run');

async function run(): Promise<void> {
  console.log('🚀 Investment Intern pipeline starting…');

  // ── Step 1: Collect raw content ──────────────────────────────────────────
  console.log('\n📥 Step 1: Fetching tracking sources…');
  const sources = await fetchTrackingSources();
  console.log(`   Found ${sources.length} sources`);

  console.log('\n📥 Step 1: Collecting content from all sources…');
  const [threadsContent, ytContent, newsContent, feedbackContent] = await Promise.all([
    collectThreads(sources),
    collectYouTube(sources),
    collectNews(sources),
    collectFeedback(),
  ]);

  const rawContents = [...threadsContent, ...ytContent, ...newsContent, ...feedbackContent];
  console.log(`   Collected ${rawContents.length} items (Threads: ${threadsContent.length}, YT: ${ytContent.length}, News/Podcast: ${newsContent.length}, Feedback: ${feedbackContent.length})`);

  // ── Step 2: Industry filtering ───────────────────────────────────────────
  console.log('\n🔍 Step 2: Analysing industries (supply-side structural filter)…');
  const filterResult = await filterIndustries(rawContents);
  console.log(`   Mode: ${filterResult.mode}, Industries found: ${filterResult.industries.length}`);

  // ── Step 2.5: Industry research (knowledge base) ─────────────────────────
  let industryKnowledgeMap = new Map();
  if (filterResult.mode === 'structural' && filterResult.industries.length > 0) {
    console.log('\n📚 Step 2.5: Researching industry knowledge base…');
    industryKnowledgeMap = await researchIndustries(filterResult.industries);
    console.log(`   Knowledge docs ready for ${industryKnowledgeMap.size} industries`);
  }

  // ── Steps 3-5: Company picking, metrics, credibility ─────────────────────
  const reports: IndustryReport[] = [];

  if (filterResult.mode === 'structural') {
    for (const industry of filterResult.industries) {
      console.log(`\n📊 Processing industry: ${industry.industry}`);

      console.log('   Step 3: Picking companies…');
      const knowledge = industryKnowledgeMap.get(industry.industry);
      const companies = await pickCompanies(industry, knowledge);
      console.log(`   Found ${companies.length} companies`);

      console.log('   Step 4: Enriching with earnings docs (batch)…');
      const enriched = await enrichCompaniesWithDocs(companies, industry.industry);

      console.log('   Step 5: Checking management credibility (batch)…');
      const credibility = await checkCredibilityBatch(enriched);

      reports.push({ industry, companies: enriched, credibility });
    }
  }

  // ── Step 6: Generate dashboard ───────────────────────────────────────────
  console.log('\n🖥  Step 6: Generating dashboard…');
  const dashboardData: DashboardData = {
    generatedAt: new Date().toISOString(),
    mode: filterResult.mode,
    reports,
    kolTopics: filterResult.kolTopics,
    rawSources: rawContents,
  };

  const html = generateDashboard(dashboardData);

  const outputDir = path.resolve(__dirname, '../public');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'index.html');
  fs.writeFileSync(outputPath, html, 'utf-8');

  // ── Step 6.5: Append to history log ─────────────────────────────────────
  console.log('\n📝 Step 6.5: Appending to history log…');
  appendHistory(dashboardData);

  // ── Step 6.6: Consolidate user feedback into digest MD ───────────────────
  console.log('\n🗂  Step 6.6: Running feedback digest…');
  await runFeedbackDigest();

  if (isDryRun) {
    console.log(`\n✅ Dry run complete. Dashboard written to: ${outputPath}`);
    console.log('   Open it in a browser to preview.\n');
  } else {
    console.log(`\n✅ Dashboard generated: ${outputPath}\n`);
  }
}

run().catch((err) => {
  console.error('❌ Pipeline failed:', err);
  process.exit(1);
});
