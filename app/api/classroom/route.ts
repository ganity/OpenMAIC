import { type NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import {
  buildRequestOrigin,
  isValidClassroomId,
  persistClassroom,
  readClassroom,
  CLASSROOMS_DIR,
} from '@/lib/server/classroom-storage';
import { replaceMediaPlaceholders } from '@/lib/server/classroom-media-generation';
import { createLogger } from '@/lib/logger';

const log = createLogger('Classroom API');

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { stage, scenes, mediaBase64, audioBase64 } = body;

    if (!stage || !scenes) {
      return apiError(
        API_ERROR_CODES.MISSING_REQUIRED_FIELD,
        400,
        'Missing required fields: stage, scenes',
      );
    }

    const id = stage.id || randomUUID();
    const baseUrl = buildRequestOrigin(request);

    // 处理前端上传的音频 base64（TTS blob），写盘后将 audioId 替换为 audioUrl
    if (audioBase64 && typeof audioBase64 === 'object') {
      const audioDir = path.join(CLASSROOMS_DIR, id, 'audio');
      await fs.mkdir(audioDir, { recursive: true });

      for (const [audioId, dataUrl] of Object.entries(audioBase64 as Record<string, string>)) {
        try {
          const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
          if (!match) continue;
          const [, mimeType, base64Data] = match;
          const ext = mimeType.split('/')[1]?.split('+')[0] || 'mp3';
          const filename = `${audioId}.${ext}`;
          const buffer = Buffer.from(base64Data, 'base64');
          await fs.writeFile(path.join(audioDir, filename), buffer);
          const audioUrl = `${baseUrl}/api/classroom-media/${id}/audio/${filename}`;
          // 将 scenes 中对应 audioId 的 speech action 设置 audioUrl
          for (const scene of scenes) {
            for (const action of scene.actions || []) {
              if (action.type === 'speech' && action.audioId === audioId) {
                action.audioUrl = audioUrl;
              }
            }
          }
        } catch (err) {
          log.warn(`[Classroom API] Failed to write audio file for ${audioId}:`, err);
        }
      }
    }

    // 处理前端上传的媒体 base64（图片/视频），写盘后替换 placeholder src
    if (mediaBase64 && typeof mediaBase64 === 'object') {
      const mediaDir = path.join(CLASSROOMS_DIR, id, 'media');
      await fs.mkdir(mediaDir, { recursive: true });
      const mediaMap: Record<string, string> = {};

      for (const [placeholder, dataUrl] of Object.entries(mediaBase64 as Record<string, string>)) {
        try {
          const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
          if (!match) continue;
          const [, mimeType, base64Data] = match;
          const ext = mimeType.split('/')[1]?.split('+')[0] || 'bin';
          const filename = `${placeholder}.${ext}`;
          const buffer = Buffer.from(base64Data, 'base64');
          await fs.writeFile(path.join(mediaDir, filename), buffer);
          mediaMap[placeholder] = `${baseUrl}/api/classroom-media/${id}/media/${filename}`;
        } catch (err) {
          log.warn(`[Classroom API] Failed to write media file for ${placeholder}:`, err);
        }
      }

      replaceMediaPlaceholders(scenes, mediaMap);
    }

    const persisted = await persistClassroom({ id, stage: { ...stage, id }, scenes }, baseUrl);

    return apiSuccess({ id: persisted.id, url: persisted.url }, 201);
  } catch (error) {
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to store classroom',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id');

    if (!id) {
      return apiError(
        API_ERROR_CODES.MISSING_REQUIRED_FIELD,
        400,
        'Missing required parameter: id',
      );
    }

    if (!isValidClassroomId(id)) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid classroom id');
    }

    const classroom = await readClassroom(id);
    if (!classroom) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
    }

    return apiSuccess({ classroom });
  } catch (error) {
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to retrieve classroom',
      error instanceof Error ? error.message : String(error),
    );
  }
}
