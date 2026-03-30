'use client';

import { Stage } from '@/components/stage';
import { ThemeProvider } from '@/lib/hooks/use-theme';
import { useStageStore } from '@/lib/store';
import { useSettingsStore } from '@/lib/store/settings';
import { loadImageMapping } from '@/lib/utils/image-storage';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useSceneGenerator } from '@/lib/hooks/use-scene-generator';
import { useMediaGenerationStore } from '@/lib/store/media-generation';
import { useWhiteboardHistoryStore } from '@/lib/store/whiteboard-history';
import { createLogger } from '@/lib/logger';
import { MediaStageProvider } from '@/lib/contexts/media-stage-context';
import { generateMediaForOutlines } from '@/lib/media/media-orchestrator';
import { db } from '@/lib/utils/database';
import type { SpeechAction } from '@/lib/types/action';

const log = createLogger('Classroom');

export default function ClassroomDetailPage() {
  const params = useParams();
  const classroomId = params?.id as string;

  const { loadFromStorage } = useStageStore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const generationMode = useSettingsStore((s) => s.generationMode);
  const generationStartedRef = useRef(false);
  const pendingJobPollUrlRef = useRef<string | null>(null);

  const { generateRemaining, retrySingleOutline, stop } = useSceneGenerator({
    onComplete: async () => {
      log.info('[Classroom] All scenes generated');
      // 将生成结果持久化到服务端，使课件可通过 URL 跨设备访问
      const { stage, scenes } = useStageStore.getState();
      if (stage && scenes.length > 0) {
        try {
          // 将 blob 转 base64 dataUrl 的辅助函数
          const blobToBase64 = (blob: Blob): Promise<string> =>
            new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });

          // 收集图片/视频媒体文件（objectUrl → base64），随 POST 一起发送给服务端写盘
          const mediaBase64: Record<string, string> = {};
          const mediaTasks = useMediaGenerationStore.getState().tasks;
          await Promise.all(
            Object.entries(mediaTasks).map(async ([placeholder, task]) => {
              if (task.objectUrl) {
                try {
                  const resp = await fetch(task.objectUrl);
                  const blob = await resp.blob();
                  mediaBase64[placeholder] = await blobToBase64(blob);
                } catch (e) {
                  log.warn('[Classroom] Failed to read media objectUrl for', placeholder, e);
                }
              }
              if (task.poster) {
                try {
                  const resp = await fetch(task.poster);
                  const blob = await resp.blob();
                  mediaBase64[`${placeholder}_poster`] = await blobToBase64(blob);
                } catch (e) {
                  log.warn('[Classroom] Failed to read poster objectUrl for', placeholder, e);
                }
              }
            }),
          );

          // 收集 TTS 音频（IndexedDB audioFiles → base64），随 POST 一起发送给服务端写盘
          const audioBase64: Record<string, string> = {};
          const allAudioIds = scenes.flatMap((s) =>
            (s.actions || [])
              .filter((a): a is SpeechAction => a.type === 'speech' && !!(a as SpeechAction).audioId)
              .map((a) => a.audioId as string),
          );
          await Promise.all(
            allAudioIds.map(async (audioId) => {
              try {
                const record = await db.audioFiles.get(audioId);
                if (record?.blob) {
                  audioBase64[audioId] = await blobToBase64(record.blob);
                }
              } catch (e) {
                log.warn('[Classroom] Failed to read audio blob for', audioId, e);
              }
            }),
          );

          const res = await fetch('/api/classroom', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stage, scenes, mediaBase64, audioBase64 }),
          });
          if (res.ok) {
            const json = await res.json().catch(() => null);
            log.info('[Classroom] Persisted to server:', json?.id || stage.id);
          } else {
            log.warn('[Classroom] Failed to persist to server:', res.status);
          }
        } catch (err) {
          log.warn('[Classroom] Server persist error:', err);
        }
      }
    },
  });

  const loadClassroom = useCallback(async (pendingPollUrl: string | null = null) => {
    try {
      // 检查是否有 pending job（提前跳转场景）—— pendingPollUrl 由 useEffect 在最开始读取并传入
      if (pendingPollUrl) {
        log.info('Pending job detected, waiting for first data:', pendingPollUrl);
        pendingJobPollUrlRef.current = pendingPollUrl;
        // 等待服务端第一次 persist 数据可读
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          try {
            const checkRes = await fetch(`/api/classroom?id=${encodeURIComponent(classroomId)}`);
            if (checkRes.ok) {
              const checkJson = await checkRes.json();
              if (checkJson.success && checkJson.classroom) {
                log.info('Classroom data available, loading...');
                break;
              }
            }
          } catch (e) { /* continue polling */ }
        }
        // 从服务端加载第一批数据
        try {
          const res = await fetch(`/api/classroom?id=${encodeURIComponent(classroomId)}`);
          if (res.ok) {
            const json = await res.json();
            if (json.success && json.classroom) {
              const { stage, scenes } = json.classroom;
              useStageStore.getState().setStage(stage);
              useStageStore.getState().setScenes(scenes);
              log.info('Loaded from server-side storage (pending job):', classroomId);
            }
          }
        } catch (fetchErr) {
          log.warn('Server-side storage fetch failed:', fetchErr);
        }
      } else {
        await loadFromStorage(classroomId);

        // If IndexedDB had no data, try server-side storage (API-generated classrooms)
        if (!useStageStore.getState().stage) {
          log.info('No IndexedDB data, trying server-side storage for:', classroomId);
          try {
            const res = await fetch(`/api/classroom?id=${encodeURIComponent(classroomId)}`);
            if (res.ok) {
              const json = await res.json();
              if (json.success && json.classroom) {
                const { stage, scenes } = json.classroom;
                useStageStore.getState().setStage(stage);
                useStageStore.getState().setScenes(scenes);
                log.info('Loaded from server-side storage:', classroomId);
              }
            }
          } catch (fetchErr) {
            log.warn('Server-side storage fetch failed:', fetchErr);
          }
        }
      }

      // Restore completed media generation tasks from IndexedDB
      await useMediaGenerationStore.getState().restoreFromDB(classroomId);
      // Restore agents for this stage
      const { loadGeneratedAgentsForStage, useAgentRegistry } =
        await import('@/lib/orchestration/registry/store');
      const generatedAgentIds = await loadGeneratedAgentsForStage(classroomId);
      const { useSettingsStore } = await import('@/lib/store/settings');
      if (generatedAgentIds.length > 0) {
        // Auto mode — use generated agents from IndexedDB
        useSettingsStore.getState().setAgentMode('auto');
        useSettingsStore.getState().setSelectedAgentIds(generatedAgentIds);
      } else {
        // Preset mode — restore agent IDs saved in the stage at creation time.
        // Filter out any stale generated IDs that may have been persisted before
        // the bleed-fix, so they don't resolve against a leftover registry entry.
        const stage = useStageStore.getState().stage;
        const stageAgentIds = stage?.agentIds;
        const registry = useAgentRegistry.getState();
        const cleanIds = stageAgentIds?.filter((id) => {
          const a = registry.getAgent(id);
          return a && !a.isGenerated;
        });
        useSettingsStore.getState().setAgentMode('preset');
        useSettingsStore
          .getState()
          .setSelectedAgentIds(
            cleanIds && cleanIds.length > 0 ? cleanIds : ['default-1', 'default-2', 'default-3'],
          );
      }
    } catch (error) {
      log.error('Failed to load classroom:', error);
      setError(error instanceof Error ? error.message : 'Failed to load classroom');
    } finally {
      setLoading(false);
    }
  }, [classroomId, loadFromStorage]);

  useEffect(() => {
    // Reset loading state on course switch to unmount Stage during transition,
    // preventing stale data from syncing back to the new course
    setLoading(true);
    setError(null);
    generationStartedRef.current = false;

    // Clear previous classroom's media tasks to prevent cross-classroom contamination.
    // Placeholder IDs (gen_img_1, gen_vid_1) are NOT globally unique across stages,
    // so stale tasks from a previous classroom would shadow the new one's.
    const mediaStore = useMediaGenerationStore.getState();
    mediaStore.revokeObjectUrls();
    useMediaGenerationStore.setState({ tasks: {} });

    // Clear whiteboard history to prevent snapshots from a previous course leaking in.
    useWhiteboardHistoryStore.getState().clearHistory();

    // 在 effect 最开始就读取并删除 sessionStorage key，避免 React Strict Mode 双重执行时竞争
    const pendingPollUrl = sessionStorage.getItem(`pendingJob_${classroomId}`);
    if (pendingPollUrl) {
      sessionStorage.removeItem(`pendingJob_${classroomId}`);
    }
    // 有 pending job 时立刻设置 ref，不等待异步 loadClassroom 内部设置
    // 这样即使 React Strict Mode 第二次执行时 sessionStorage key 已被删除，防护也不会失效
    if (pendingPollUrl) {
      pendingJobPollUrlRef.current = pendingPollUrl;
    } else {
      pendingJobPollUrlRef.current = null;
    }
    loadClassroom(pendingPollUrl).then(() => {
      const pollUrl = pendingPollUrl;
      log.info('[Classroom] loadClassroom done, pendingJobPollUrl:', pollUrl);
      if (!pollUrl) return;

      // 持续轮询 job 直到完成，每次有新 scenes 时更新 store
      log.info('[Classroom] Starting background polling for pending job:', pollUrl);
      let cancelled = false;
      (async () => {
        while (!cancelled) {
          await new Promise((r) => setTimeout(r, 2000));
          if (cancelled) break;
          log.info('[Classroom] Background poll tick, cancelled=', cancelled);
          try {
            const resp = await fetch(pollUrl);
            if (!resp.ok) continue;
            const data = await resp.json();
            const job = data.data || data;

            if (cancelled) break;
            // 用 job.outlines 设置 generatingOutlines，让 Stage 显示骨架屏
            if (job.outlines?.length > 0) {
              const currentStore = useStageStore.getState();
              const completedOrders = new Set(currentStore.scenes.map((s: { order: number }) => s.order));
              const stillPending = job.outlines.filter((o: { order: number }) => !completedOrders.has(o.order));
              if (stillPending.length !== currentStore.generatingOutlines.length) {
                useStageStore.setState({ outlines: job.outlines, generatingOutlines: stillPending });
              }
            }

            // 从服务端 classroom API 拉取最新 scenes
            if (cancelled) break;
            const classRes = await fetch(`/api/classroom?id=${encodeURIComponent(classroomId)}`);
            if (classRes.ok) {
              const classJson = await classRes.json();
              if (classJson.success && classJson.classroom) {
                const { scenes } = classJson.classroom;
                const currentScenes = useStageStore.getState().scenes;
                const hasNewScenes = scenes.length > currentScenes.length;
                // 检测是否有新的 audioUrl（TTS 生成完成后才写入）
                const hasNewAudio = !hasNewScenes && scenes.some((s: { order: number; actions?: Array<{ audioUrl?: string }> }, i: number) => {
                  const cur = currentScenes[i];
                  if (!cur) return false;
                  return s.actions?.some((a, j) => a.audioUrl && !(cur.actions as Array<{ audioUrl?: string }>)?.[j]?.audioUrl);
                });
                if (hasNewScenes || hasNewAudio) {
                  log.info(`[Classroom] Updated scenes: ${scenes.length} (was ${currentScenes.length}), hasNewAudio=${hasNewAudio}`);
                  useStageStore.getState().setScenes(scenes);
                  // 更新 generatingOutlines
                  const allOutlines = useStageStore.getState().outlines;
                  if (allOutlines.length > 0) {
                    const completedOrders = new Set(scenes.map((s: { order: number }) => s.order));
                    useStageStore.setState({
                      generatingOutlines: allOutlines.filter((o) => !completedOrders.has(o.order)),
                    });
                  }
                }
              }
            }
            if (job.done || job.status === 'succeeded' || job.status === 'failed') {
              log.info('[Classroom] Pending job finished:', job.status);
              pendingJobPollUrlRef.current = null;
              // 清空骨架屏
              useStageStore.setState({ generatingOutlines: [] });
              break;
            }
          } catch (e) { /* continue */ }
        }
      })();

      return () => { cancelled = true; };
    });

    // Cancel ongoing generation when classroomId changes or component unmounts
    return () => {
      stop();
    };
  }, [classroomId, loadClassroom, stop]);

  // Auto-resume generation for pending outlines
  useEffect(() => {
    if (loading || error || generationStartedRef.current) return;
    // 服务端模式下不走前端生成路径，由 server job 负责所有场景生成
    if (generationMode === 'server') return;
    // 服务端 Job 正在轮询中，等待 Job 自己更新 scenes，不走前端生成路径
    if (pendingJobPollUrlRef.current) return;

    const state = useStageStore.getState();
    const { outlines, scenes, stage } = state;

    // Check if there are pending outlines
    const completedOrders = new Set(scenes.map((s) => s.order));
    const hasPending = outlines.some((o) => !completedOrders.has(o.order));

    if (hasPending && stage) {
      generationStartedRef.current = true;

      // Load generation params from sessionStorage (stored by generation-preview before navigating)
      const genParamsStr = sessionStorage.getItem('generationParams');
      const params = genParamsStr ? JSON.parse(genParamsStr) : {};

      // Reconstruct imageMapping from IndexedDB using pdfImages storageIds
      const storageIds = (params.pdfImages || [])
        .map((img: { storageId?: string }) => img.storageId)
        .filter(Boolean);

      loadImageMapping(storageIds).then((imageMapping) => {
        generateRemaining({
          pdfImages: params.pdfImages,
          imageMapping,
          stageInfo: {
            name: stage.name || '',
            description: stage.description,
            language: stage.language,
            style: stage.style,
          },
          agents: params.agents,
          userProfile: params.userProfile,
          generationMetadata: params.generationMetadata,
        });
      });
    } else if (outlines.length > 0 && stage) {
      // All scenes are generated, but some media may not have finished.
      // Resume media generation for any tasks not yet in IndexedDB.
      // generateMediaForOutlines skips already-completed tasks automatically.
      generationStartedRef.current = true;
      generateMediaForOutlines(outlines, stage.id).catch((err) => {
        log.warn('[Classroom] Media generation resume error:', err);
      });
    }
  }, [loading, error, generateRemaining, generationMode]);

  return (
    <ThemeProvider>
      <MediaStageProvider value={classroomId}>
        <div className="h-screen flex flex-col overflow-hidden">
          {loading ? (
            <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
              <div className="text-center text-muted-foreground">
                <p>Loading classroom...</p>
              </div>
            </div>
          ) : error ? (
            <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
              <div className="text-center">
                <p className="text-destructive mb-4">Error: {error}</p>
                <button
                  onClick={() => {
                    setError(null);
                    setLoading(true);
                    loadClassroom();
                  }}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
                >
                  Retry
                </button>
              </div>
            </div>
          ) : (
            <Stage onRetryOutline={retrySingleOutline} />
          )}
        </div>
      </MediaStageProvider>
    </ThemeProvider>
  );
}
