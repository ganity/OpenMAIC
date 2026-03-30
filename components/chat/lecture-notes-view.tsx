'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { BookOpen, Flashlight, MousePointer2, Play, Pencil, Check, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import type { LectureNoteEntry } from '@/lib/types/chat';
import { useStageStore } from '@/lib/store';
import { generateAndStoreTTS } from '@/lib/hooks/use-scene-generator';
import type { SpeechAction } from '@/lib/types/action';

const ACTION_ICON_ONLY: Record<string, { Icon: typeof Flashlight; style: string }> = {
  spotlight: {
    Icon: Flashlight,
    style:
      'bg-yellow-50 dark:bg-yellow-500/15 border-yellow-300/40 dark:border-yellow-500/30 text-yellow-700 dark:text-yellow-300',
  },
  laser: {
    Icon: MousePointer2,
    style:
      'bg-red-50 dark:bg-red-500/15 border-red-300/40 dark:border-red-500/30 text-red-600 dark:text-red-300',
  },
  play_video: {
    Icon: Play,
    style:
      'bg-yellow-50 dark:bg-yellow-500/15 border-yellow-300/40 dark:border-yellow-500/30 text-yellow-700 dark:text-yellow-300',
  },
};

interface LectureNotesViewProps {
  notes: LectureNoteEntry[];
  currentSceneId?: string | null;
}

interface EditingState {
  sceneId: string;
  actionId: string;
  text: string;
}

export function LectureNotesView({ notes, currentSceneId }: LectureNotesViewProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [savingActionId, setSavingActionId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scenes = useStageStore((s) => s.scenes);
  const updateScene = useStageStore((s) => s.updateScene);

  // Auto-scroll to the current scene note
  useEffect(() => {
    if (!currentSceneId || !containerRef.current) return;
    const el = containerRef.current.querySelector(`[data-scene-id="${currentSceneId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentSceneId]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [editing?.text]);

  const startEditing = useCallback((sceneId: string, actionId: string, text: string) => {
    setEditing({ sceneId, actionId, text });
  }, []);

  const cancelEditing = useCallback(() => {
    setEditing(null);
  }, []);

  const saveEditing = useCallback(async () => {
    if (!editing) return;
    const { sceneId, actionId, text } = editing;
    if (!text.trim()) return;

    setSavingActionId(actionId);
    setEditing(null);

    try {
      // 更新 scene 中对应 SpeechAction 的文本
      const scene = scenes.find((s) => s.id === sceneId);
      if (!scene) return;

      const updatedActions = (scene.actions || []).map((a) => {
        if (a.id === actionId && a.type === 'speech') {
          return { ...a, text } as SpeechAction;
        }
        return a;
      });

      updateScene(sceneId, { actions: updatedActions });

      void fetch('/api/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'manual_edit_hotspot',
          payload: {
            editType: 'speech_note_edit',
            sceneId,
            actionId,
            textLength: text.length,
          },
        }),
      }).catch(() => {
        // telemetry must not block manual editing flow
      });

      // 重新生成 TTS 音频（覆盖旧的）
      const audioId = `tts_${actionId}`;
      await generateAndStoreTTS(audioId, text);
    } catch (err) {
      console.error('TTS regeneration failed:', err);
    } finally {
      setSavingActionId(null);
    }
  }, [editing, scenes, updateScene]);

  // Empty state
  if (notes.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-6">
        <div className="w-12 h-12 bg-purple-50 dark:bg-purple-900/20 rounded-2xl flex items-center justify-center mb-3 text-purple-300 dark:text-purple-600 ring-1 ring-purple-100 dark:ring-purple-800/30">
          <BookOpen className="w-6 h-6" />
        </div>
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
          {t('chat.lectureNotes.empty')}
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          {t('chat.lectureNotes.emptyHint')}
        </p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full overflow-y-auto px-3 py-3 space-y-4">
      {notes.map((note, noteIdx) => {
        const pageNum = noteIdx + 1;
        const pageLabel = t('chat.lectureNotes.pageLabel').replace('{n}', String(pageNum));
        const isCurrentScene = note.sceneId === currentSceneId;

        return (
          <div
            key={note.sceneId}
            data-scene-id={note.sceneId}
            className={cn(
              'rounded-xl border transition-colors duration-300',
              isCurrentScene
                ? 'border-purple-200/80 dark:border-purple-700/50 bg-purple-50/40 dark:bg-purple-900/10'
                : 'border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900/40',
            )}
          >
            {/* Scene header */}
            <div
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-t-xl border-b',
                isCurrentScene
                  ? 'border-purple-100/80 dark:border-purple-800/40 bg-purple-50/60 dark:bg-purple-900/20'
                  : 'border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30',
              )}
            >
              <span
                className={cn(
                  'text-[10px] font-semibold px-1.5 py-0.5 rounded-full',
                  isCurrentScene
                    ? 'bg-purple-100 dark:bg-purple-800/50 text-purple-600 dark:text-purple-300'
                    : 'bg-gray-100 dark:bg-gray-700/60 text-gray-500 dark:text-gray-400',
                )}
              >
                {pageLabel}
              </span>
              {isCurrentScene && (
                <span className="text-[10px] font-medium text-purple-500 dark:text-purple-400">
                  {t('chat.lectureNotes.currentPage')}
                </span>
              )}
              <span
                className={cn(
                  'text-xs font-medium truncate flex-1 min-w-0',
                  isCurrentScene
                    ? 'text-purple-700 dark:text-purple-300'
                    : 'text-gray-600 dark:text-gray-300',
                )}
              >
                {note.sceneTitle}
              </span>
            </div>

            {/* Note content */}
            <div className="px-3 py-2 space-y-1">
              {(() => {
                // Build render rows: group inline actions (spotlight/laser) with next speech
                type RenderRow =
                  | { kind: 'speech'; inlineActions: string[]; text: string; actionId: string }
                  | { kind: 'standalone-action'; type: string; label?: string };

                const rows: RenderRow[] = [];
                let pendingInline: string[] = [];

                for (const item of note.items) {
                  if (item.kind === 'action' && ACTION_ICON_ONLY[item.type]) {
                    pendingInline.push(item.type);
                  } else if (item.kind === 'speech') {
                    rows.push({
                      kind: 'speech',
                      inlineActions: pendingInline,
                      text: item.text,
                      actionId: item.actionId,
                    });
                    pendingInline = [];
                  } else {
                    if (pendingInline.length > 0) {
                      rows.push({
                        kind: 'speech',
                        inlineActions: pendingInline,
                        text: '',
                        actionId: '',
                      });
                      pendingInline = [];
                    }
                    rows.push({
                      kind: 'standalone-action',
                      type: item.type,
                      label: item.kind === 'action' ? item.label : undefined,
                    });
                  }
                }
                if (pendingInline.length > 0) {
                  rows.push({ kind: 'speech', inlineActions: pendingInline, text: '', actionId: '' });
                }

                return rows.map((row, rowIdx) => {
                  if (row.kind === 'standalone-action') {
                    return (
                      <p key={rowIdx} className="text-xs leading-relaxed text-gray-600 dark:text-gray-300">
                        <span className="inline-flex items-center gap-1 border rounded-full px-2 py-0.5 text-[10px] bg-blue-50 dark:bg-blue-500/15 border-blue-200/40 dark:border-blue-500/30 text-blue-600 dark:text-blue-300">
                          {row.label || row.type}
                        </span>
                      </p>
                    );
                  }

                  const isEditingThis =
                    editing?.sceneId === note.sceneId && editing?.actionId === row.actionId;
                  const isSavingThis = savingActionId === row.actionId;

                  return (
                    <div key={rowIdx} className="group relative">
                      <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-300 flex flex-wrap items-center gap-1">
                        {row.inlineActions.map((actionType, i) => {
                          const cfg = ACTION_ICON_ONLY[actionType];
                          if (!cfg) return null;
                          const { Icon } = cfg;
                          return (
                            <span
                              key={i}
                              className={cn(
                                'inline-flex items-center justify-center w-4 h-4 rounded-full border shrink-0',
                                cfg.style,
                              )}
                            >
                              <Icon className="w-2.5 h-2.5" />
                            </span>
                          );
                        })}

                        {/* 编辑态 */}
                        {isEditingThis ? null : (
                          <>
                            <span className="flex-1">{row.text}</span>
                            {isSavingThis && (
                              <Loader2 className="w-3 h-3 shrink-0 animate-spin text-purple-500" />
                            )}
                            {!isSavingThis && row.actionId && (
                              <button
                                onClick={() => startEditing(note.sceneId, row.actionId, row.text)}
                                className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                                title="编辑话术"
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                            )}
                          </>
                        )}
                      </p>

                      {isEditingThis && (
                        <div className="mt-1 space-y-1">
                          <textarea
                            ref={textareaRef}
                            value={editing.text}
                            onChange={(e) => setEditing((prev) => prev ? { ...prev, text: e.target.value } : null)}
                            className="w-full text-xs leading-relaxed resize-none rounded-md border border-purple-300 dark:border-purple-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-400 dark:focus:ring-purple-500"
                            autoFocus
                            rows={3}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') cancelEditing();
                              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveEditing();
                            }}
                          />
                          <div className="flex items-center gap-1 justify-end">
                            <span className="text-[10px] text-gray-400 mr-auto">编辑后将重新生成语音</span>
                            <button
                              onClick={cancelEditing}
                              className="flex items-center gap-0.5 text-[10px] px-2 py-0.5 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                            >
                              <X className="w-3 h-3" /> 取消
                            </button>
                            <button
                              onClick={saveEditing}
                              className="flex items-center gap-0.5 text-[10px] px-2 py-0.5 rounded bg-purple-500 hover:bg-purple-600 text-white"
                            >
                              <Check className="w-3 h-3" /> 保存并重新生成语音
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        );
      })}
    </div>
  );
}
