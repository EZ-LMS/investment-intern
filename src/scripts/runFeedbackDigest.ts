/**
 * runFeedbackDigest.ts
 *
 * Standalone script — runs only the feedback digest step.
 * Invoked by the `feedback-digest` GitHub Actions workflow when a new
 * GitHub Issue is labeled "user-feedback", so the knowledge base is
 * updated immediately rather than waiting for the next morning's pipeline.
 *
 * Usage: tsx src/scripts/runFeedbackDigest.ts
 */

import 'dotenv/config';
import { runFeedbackDigest } from '../agents/feedbackDigest.js';

async function main() {
  console.log('📬 Running feedback digest…');
  await runFeedbackDigest();
  console.log('✅ Feedback digest complete.');
}

main().catch((err) => {
  console.error('❌ Feedback digest failed:', err);
  process.exit(1);
});
