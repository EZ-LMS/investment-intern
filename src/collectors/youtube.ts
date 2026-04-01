// @ts-expect-error: no types for ESM sub-path
import { YoutubeTranscript } from 'youtube-transcript/dist/youtube-transcript.esm.js';
import ytSearch from 'yt-search';
import type { RawContent, TrackingSource } from '../types.js';

export async function collectYouTube(sources: TrackingSource[]): Promise<RawContent[]> {
  const ytSources = sources.filter((s) => s.media.toUpperCase() === 'YT');
  const results: RawContent[] = [];

  for (const src of ytSources) {
    try {
      console.log(`[YouTube] Fetching latest videos from ${src.name}…`);
      const handle = extractChannelHandle(src.link);
      const searchRes = await ytSearch(`${handle} 投資`);
      const videos = searchRes.videos.slice(0, 2);

      for (const video of videos) {
        try {
          const transcriptItems = await YoutubeTranscript.fetchTranscript(video.videoId, {
            lang: 'zh-Hant',
          }).catch(() =>
            YoutubeTranscript.fetchTranscript(video.videoId, { lang: 'zh' }).catch(() =>
              YoutubeTranscript.fetchTranscript(video.videoId)
            )
          );

          const transcript = transcriptItems.map((t: { text: string }) => t.text).join(' ').slice(0, 8000);
          if (transcript.length > 100) {
            results.push({
              source: src.name,
              mediaType: 'YT',
              url: `https://www.youtube.com/watch?v=${video.videoId}`,
              content: `【${video.title}】\n${transcript}`,
              publishedAt: video.ago,
            });
          }
        } catch {
          console.warn(`[YouTube] No transcript for ${video.title}`);
        }
      }
    } catch (err) {
      console.warn(`[YouTube] Failed for ${src.name}:`, err instanceof Error ? err.message : err);
    }
  }

  return results;
}

function extractChannelHandle(url: string): string {
  // Extract @handle or channel name from YouTube URL for yt-search
  const match = url.match(/@([^/?]+)/);
  return match?.[1] ?? url;
}
