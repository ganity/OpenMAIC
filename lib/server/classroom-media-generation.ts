/**
 * Server-side media and TTS generation for classrooms.
 *
 * Generates image/video files and TTS audio for a classroom,
 * writes them to disk, and returns serving URL mappings.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { createLogger } from '@/lib/logger';
import { CLASSROOMS_DIR } from '@/lib/server/classroom-storage';
import { generateImage } from '@/lib/media/image-providers';
import { generateVideo, normalizeVideoOptions } from '@/lib/media/video-providers';
import { generateTTS } from '@/lib/audio/tts-providers';
import { DEFAULT_TTS_VOICES, TTS_PROVIDERS } from '@/lib/audio/constants';
import { IMAGE_PROVIDERS } from '@/lib/media/image-providers';
import { VIDEO_PROVIDERS } from '@/lib/media/video-providers';
import { isMediaPlaceholder } from '@/lib/store/media-generation';
import {
  getServerImageProviders,
  getServerVideoProviders,
  getServerTTSProviders,
  resolveImageApiKey,
  resolveImageBaseUrl,
  resolveVideoApiKey,
  resolveVideoBaseUrl,
  resolveTTSApiKey,
  resolveTTSBaseUrl,
} from '@/lib/server/provider-config';
import type { SceneOutline } from '@/lib/types/generation';
import type { Scene } from '@/lib/types/stage';
import type { SpeechAction } from '@/lib/types/action';
import type { ImageProviderId } from '@/lib/media/types';
import type { VideoProviderId } from '@/lib/media/types';
import type { TTSProviderId } from '@/lib/audio/types';
import { splitLongSpeechActions } from '@/lib/audio/tts-utils';

const log = createLogger('ClassroomMedia');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

const DOWNLOAD_TIMEOUT_MS = 120_000; // 2 minutes
const DOWNLOAD_MAX_SIZE = 100 * 1024 * 1024; // 100 MB

async function downloadToBuffer(url: string): Promise<Buffer> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!resp.ok) throw new Error(`Download failed: ${resp.status} ${resp.statusText}`);
  const contentLength = Number(resp.headers.get('content-length') || 0);
  if (contentLength > DOWNLOAD_MAX_SIZE) {
    throw new Error(`File too large: ${contentLength} bytes (max ${DOWNLOAD_MAX_SIZE})`);
  }
  return Buffer.from(await resp.arrayBuffer());
}

function mediaServingUrl(baseUrl: string, classroomId: string, subPath: string): string {
  return `${baseUrl}/api/classroom-media/${classroomId}/${subPath}`;
}

// ---------------------------------------------------------------------------
// Image / Video generation
// ---------------------------------------------------------------------------

export async function generateMediaForClassroom(
  outlines: SceneOutline[],
  classroomId: string,
  baseUrl: string,
): Promise<Record<string, string>> {
  const mediaDir = path.join(CLASSROOMS_DIR, classroomId, 'media');
  await ensureDir(mediaDir);

  // Collect all media generation requests from outlines
  const requests = outlines.flatMap((o) => o.mediaGenerations ?? []);
  log.info(`[Media] classroomId=${classroomId}, total requests=${requests.length}`);
  if (requests.length === 0) {
    log.info('[Media] No media generation requests found in outlines, skipping');
    return {};
  }

  // Resolve providers
  const imageProviderIds = Object.keys(getServerImageProviders());
  const videoProviderIds = Object.keys(getServerVideoProviders());
  log.info(`[Media] imageProviders=${JSON.stringify(imageProviderIds)}, videoProviders=${JSON.stringify(videoProviderIds)}`);

  const mediaMap: Record<string, string> = {};

  // Separate image and video requests, generate each type sequentially
  // but run the two types in parallel (providers often have limited concurrency).
  const imageRequests = requests.filter((r) => r.type === 'image' && imageProviderIds.length > 0);
  const videoRequests = requests.filter((r) => r.type === 'video' && videoProviderIds.length > 0);
  log.info(`[Media] imageRequests=${imageRequests.length}, videoRequests=${videoRequests.length}`);

  const generateImages = async () => {
    for (const req of imageRequests) {
      try {
        const providerId = imageProviderIds[0] as ImageProviderId;
        const apiKey = resolveImageApiKey(providerId);
        if (!apiKey) {
          log.warn(`No API key for image provider "${providerId}", skipping ${req.elementId}`);
          continue;
        }
        const providerConfig = IMAGE_PROVIDERS[providerId];
        const model = providerConfig?.models?.[0]?.id;

        const result = await generateImage(
          { providerId, apiKey, baseUrl: resolveImageBaseUrl(providerId), model },
          { prompt: req.prompt, aspectRatio: req.aspectRatio || '16:9' },
        );

        let buf: Buffer;
        let ext: string;
        if (result.base64) {
          buf = Buffer.from(result.base64, 'base64');
          ext = 'png';
        } else if (result.url) {
          buf = await downloadToBuffer(result.url);
          const urlExt = path.extname(new URL(result.url).pathname).replace('.', '');
          ext = ['png', 'jpg', 'jpeg', 'webp'].includes(urlExt) ? urlExt : 'png';
        } else {
          log.warn(`Image generation returned no data for ${req.elementId}`);
          continue;
        }

        const filename = `${req.elementId}.${ext}`;
        await fs.writeFile(path.join(mediaDir, filename), buf);
        mediaMap[req.elementId] = mediaServingUrl(baseUrl, classroomId, `media/${filename}`);
        log.info(`Generated image: ${filename}`);
      } catch (err) {
        log.warn(`Image generation failed for ${req.elementId}:`, err);
      }
    }
  };

  const generateVideos = async () => {
    for (const req of videoRequests) {
      try {
        const providerId = videoProviderIds[0] as VideoProviderId;
        const apiKey = resolveVideoApiKey(providerId);
        if (!apiKey) {
          log.warn(`No API key for video provider "${providerId}", skipping ${req.elementId}`);
          continue;
        }
        const providerConfig = VIDEO_PROVIDERS[providerId];
        const model = providerConfig?.models?.[0]?.id;

        const normalized = normalizeVideoOptions(providerId, {
          prompt: req.prompt,
          aspectRatio: (req.aspectRatio as '16:9' | '4:3' | '1:1' | '9:16') || '16:9',
        });

        const result = await generateVideo(
          { providerId, apiKey, baseUrl: resolveVideoBaseUrl(providerId), model },
          normalized,
        );

        const buf = await downloadToBuffer(result.url);
        const filename = `${req.elementId}.mp4`;
        await fs.writeFile(path.join(mediaDir, filename), buf);
        mediaMap[req.elementId] = mediaServingUrl(baseUrl, classroomId, `media/${filename}`);
        log.info(`Generated video: ${filename}`);
      } catch (err) {
        log.warn(`Video generation failed for ${req.elementId}:`, err);
      }
    }
  };

  await Promise.all([generateImages(), generateVideos()]);

  return mediaMap;
}

// ---------------------------------------------------------------------------
// Placeholder replacement in scene content
// ---------------------------------------------------------------------------

export function replaceMediaPlaceholders(scenes: Scene[], mediaMap: Record<string, string>): void {
  if (Object.keys(mediaMap).length === 0) return;

  for (const scene of scenes) {
    if (scene.type !== 'slide') continue;
    const canvas = (
      scene.content as {
        canvas?: { elements?: Array<{ id: string; src?: string; poster?: string; type?: string }> };
      }
    )?.canvas;
    if (!canvas?.elements) continue;

    for (const el of canvas.elements) {
      if (el.type === 'image' || el.type === 'video') {
        if (typeof el.src === 'string' && isMediaPlaceholder(el.src) && mediaMap[el.src]) {
          el.src = mediaMap[el.src];
        }
        // 替换视频封面（poster）
        const posterKey = `${el.id}_poster`;
        if (el.type === 'video' && mediaMap[posterKey]) {
          el.poster = mediaMap[posterKey];
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// TTS generation
// ---------------------------------------------------------------------------

// TTS provider 配置解析（内部复用）
function resolveTTSConfig(): {
  providerId: TTSProviderId;
  apiKey: string;
  ttsBaseUrl: string | undefined;
  voice: string;
  format: string;
} | null {
  const ttsProviderIds = Object.keys(getServerTTSProviders()).filter(
    (id) => id !== 'browser-native-tts',
  );
  if (ttsProviderIds.length === 0) return null;

  const providerId = ttsProviderIds[0] as TTSProviderId;
  const apiKey = resolveTTSApiKey(providerId);
  if (!apiKey) return null;

  return {
    providerId,
    apiKey,
    ttsBaseUrl: resolveTTSBaseUrl(providerId) || TTS_PROVIDERS[providerId]?.defaultBaseUrl,
    voice: DEFAULT_TTS_VOICES[providerId] || 'default',
    format: TTS_PROVIDERS[providerId]?.supportedFormats?.[0] || 'mp3',
  };
}

// 为单个 scene 生成 TTS，支持逐 scene 立即生成
export async function generateTTSForScene(
  scene: Scene,
  classroomId: string,
  baseUrl: string,
): Promise<void> {
  const config = resolveTTSConfig();
  if (!config) return;

  const { providerId, apiKey, ttsBaseUrl, voice, format } = config;
  const audioDir = path.join(CLASSROOMS_DIR, classroomId, 'audio');
  await ensureDir(audioDir);

  if (!scene.actions) return;

  // 拆分长 speech actions
  scene.actions = splitLongSpeechActions(scene.actions, providerId);

  for (const action of scene.actions) {
    if (action.type !== 'speech' || !(action as SpeechAction).text) continue;
    const speechAction = action as SpeechAction;
    // 已有 audioUrl 则跳过（避免重复生成）
    if (speechAction.audioUrl) continue;
    const audioId = `tts_${action.id}`;

    try {
      const result = await generateTTS(
        { providerId, apiKey, baseUrl: ttsBaseUrl, voice, speed: speechAction.speed },
        speechAction.text,
      );

      const filename = `${audioId}.${format}`;
      await fs.writeFile(path.join(audioDir, filename), result.audio);

      speechAction.audioId = audioId;
      speechAction.audioUrl = mediaServingUrl(baseUrl, classroomId, `audio/${filename}`);
      log.info(`Generated TTS: ${filename} (${result.audio.length} bytes)`);
    } catch (err) {
      log.warn(`TTS generation failed for action ${action.id}:`, err);
    }
  }
}

export async function generateTTSForClassroom(
  scenes: Scene[],
  classroomId: string,
  baseUrl: string,
): Promise<void> {
  const config = resolveTTSConfig();
  if (!config) {
    log.warn('No server TTS provider configured, skipping TTS generation');
    return;
  }

  for (const scene of scenes) {
    await generateTTSForScene(scene, classroomId, baseUrl);
  }
}
