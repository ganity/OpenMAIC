'use client';

import { useRef } from 'react';
import {
  Undo2,
  Redo2,
  Type,
  Trash2,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Ruler,
  Grid3x3,
  Bold,
  Italic,
  Underline,
  Minus,
  Plus,
  ImagePlus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCanvasStore } from '@/lib/store/canvas';
import { useCanvasOperations } from '@/lib/hooks/use-canvas-operations';
import { useHistorySnapshot } from '@/lib/hooks/use-history-snapshot';
import { ElementAlignCommands } from '@/lib/types/edit';
import emitter, { EmitterEvents } from '@/lib/utils/emitter';
import { nanoid } from 'nanoid';
import { useSceneSelector } from '@/lib/contexts/scene-context';
import type { SlideContent } from '@/lib/types/stage';
import type { PPTElement } from '@/lib/types/slides';

const ctrlBtn = cn(
  'relative w-7 h-7 rounded-md flex items-center justify-center',
  'transition-all duration-150 outline-none cursor-pointer',
  'hover:bg-gray-500/[0.08] dark:hover:bg-gray-400/[0.08] active:scale-90',
);

function CtrlDivider() {
  return <div className="w-px h-3 bg-gray-200 dark:bg-gray-700 mx-0.5" />;
}

export function EditToolbar({ className }: { readonly className?: string }) {
  const { undo, redo, canUndo, canRedo } = useHistorySnapshot();

  const showRuler = useCanvasStore.use.showRuler();
  const setRulerState = useCanvasStore.use.setRulerState();
  const gridLineSize = useCanvasStore.use.gridLineSize();
  const setGridLineSize = useCanvasStore.use.setGridLineSize();
  const setCreatingElement = useCanvasStore.use.setCreatingElement();
  const activeElementIdList = useCanvasStore.use.activeElementIdList();
  const handleElementId = useCanvasStore.use.handleElementId();
  const richTextAttrs = useCanvasStore.use.richTextAttrs();

  const elements = useSceneSelector<SlideContent, PPTElement[]>((content) => content.canvas.elements);
  const handleElement = elements.find((el) => el.id === handleElementId);

  const { deleteElement, alignElementToCanvas, addElement } = useCanvasOperations();
  const { addHistorySnapshot } = useHistorySnapshot();

  const hasSelection = activeElementIdList.length > 0;
  const isEditingText = handleElement?.type === 'text';
  const fileInputRef = useRef<HTMLInputElement>(null);

  const recordTelemetry = (eventType: string, payload: Record<string, unknown>) => {
    void fetch('/api/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventType, payload }),
    }).catch(() => {
      // telemetry must not block editing flow
    });
  };

  const sendRichTextCommand = (command: string, value?: string) => {
    emitter.emit(EmitterEvents.RICH_TEXT_COMMAND, {
      action: { command, value },
    });
  };

  const handleInsertImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = ev.target?.result as string;
      if (!src) return;
      addElement({
        id: nanoid(10),
        type: 'image',
        src,
        left: 100,
        top: 100,
        width: 400,
        height: 300,
        rotate: 0,
        fixedRatio: true,
      });
      addHistorySnapshot();
      recordTelemetry('manual_edit_hotspot', {
        editType: 'canvas_insert_image',
        elementType: 'image',
      });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div className={cn('flex items-center gap-0.5 select-none', className)}>
      {/* 撤销/重做 */}
      <button
        onClick={() => undo()}
        disabled={!canUndo}
        className={cn(ctrlBtn, !canUndo && 'opacity-30 cursor-not-allowed')}
        title="撤销 (Ctrl+Z)"
      >
        <Undo2 className="w-3.5 h-3.5 text-gray-600 dark:text-gray-300" />
      </button>
      <button
        onClick={() => redo()}
        disabled={!canRedo}
        className={cn(ctrlBtn, !canRedo && 'opacity-30 cursor-not-allowed')}
        title="重做 (Ctrl+Shift+Z)"
      >
        <Redo2 className="w-3.5 h-3.5 text-gray-600 dark:text-gray-300" />
      </button>

      <CtrlDivider />

      {/* 插入文本框 */}
      <button
        onClick={() => {
          setCreatingElement({ type: 'text' });
          recordTelemetry('manual_edit_hotspot', {
            editType: 'canvas_insert_text',
            elementType: 'text',
          });
        }}
        className={cn(ctrlBtn, 'text-gray-600 dark:text-gray-300')}
        title="插入文本框"
      >
        <Type className="w-3.5 h-3.5" />
      </button>

      {/* 插入图片 */}
      <button
        onClick={() => fileInputRef.current?.click()}
        className={cn(ctrlBtn, 'text-gray-600 dark:text-gray-300')}
        title="插入图片"
      >
        <ImagePlus className="w-3.5 h-3.5" />
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleInsertImage}
      />

      <CtrlDivider />

      {/* 文本格式（仅在编辑文本时显示） */}
      {isEditingText && (
        <>
          <button
            onClick={() => sendRichTextCommand('bold')}
            className={cn(
              ctrlBtn,
              richTextAttrs.bold
                ? 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20'
                : 'text-gray-600 dark:text-gray-300',
            )}
            title="粗体"
          >
            <Bold className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => sendRichTextCommand('em')}
            className={cn(
              ctrlBtn,
              richTextAttrs.em
                ? 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20'
                : 'text-gray-600 dark:text-gray-300',
            )}
            title="斜体"
          >
            <Italic className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => sendRichTextCommand('underline')}
            className={cn(
              ctrlBtn,
              richTextAttrs.underline
                ? 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20'
                : 'text-gray-600 dark:text-gray-300',
            )}
            title="下划线"
          >
            <Underline className="w-3.5 h-3.5" />
          </button>

          <CtrlDivider />

          {/* 字体大小 */}
          <button
            onClick={() => sendRichTextCommand('fontsize-reduce')}
            className={cn(ctrlBtn, 'text-gray-600 dark:text-gray-300')}
            title="减小字号"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs text-gray-500 dark:text-gray-400 min-w-[2rem] text-center">
            {richTextAttrs.fontsize ? parseInt(richTextAttrs.fontsize) : 20}
          </span>
          <button
            onClick={() => sendRichTextCommand('fontsize-add')}
            className={cn(ctrlBtn, 'text-gray-600 dark:text-gray-300')}
            title="增大字号"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>

          <CtrlDivider />

          {/* 文字颜色 */}
          <label
            className={cn(ctrlBtn, 'cursor-pointer')}
            title="文字颜色"
          >
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-xs font-bold text-gray-600 dark:text-gray-300 leading-none">A</span>
              <div
                className="w-3.5 h-1 rounded-sm"
                style={{ backgroundColor: richTextAttrs.color || '#000000' }}
              />
            </div>
            <input
              type="color"
              className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
              value={richTextAttrs.color || '#000000'}
              onChange={(e) => sendRichTextCommand('color', e.target.value)}
            />
          </label>

          <CtrlDivider />
        </>
      )}

      {/* 对齐 */}
      <button
        onClick={() => {
          alignElementToCanvas(ElementAlignCommands.LEFT);
          recordTelemetry('manual_edit_hotspot', {
            editType: 'canvas_align',
            alignType: ElementAlignCommands.LEFT,
            selectionCount: activeElementIdList.length,
          });
        }}
        disabled={!hasSelection}
        className={cn(ctrlBtn, !hasSelection && 'opacity-30 cursor-not-allowed', 'text-gray-600 dark:text-gray-300')}
        title="左对齐"
      >
        <AlignLeft className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => alignElementToCanvas(ElementAlignCommands.HORIZONTAL)}
        disabled={!hasSelection}
        className={cn(ctrlBtn, !hasSelection && 'opacity-30 cursor-not-allowed', 'text-gray-600 dark:text-gray-300')}
        title="水平居中"
      >
        <AlignCenter className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => alignElementToCanvas(ElementAlignCommands.RIGHT)}
        disabled={!hasSelection}
        className={cn(ctrlBtn, !hasSelection && 'opacity-30 cursor-not-allowed', 'text-gray-600 dark:text-gray-300')}
        title="右对齐"
      >
        <AlignRight className="w-3.5 h-3.5" />
      </button>

      <CtrlDivider />

      {/* 删除 */}
      <button
        onClick={() => {
          deleteElement();
          recordTelemetry('manual_edit_hotspot', {
            editType: 'canvas_delete',
            selectionCount: activeElementIdList.length,
          });
        }}
        disabled={!hasSelection}
        className={cn(
          ctrlBtn,
          hasSelection
            ? 'text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
            : 'opacity-30 cursor-not-allowed text-gray-400',
        )}
        title="删除选中元素 (Delete)"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>

      <CtrlDivider />

      {/* 辅助显示 */}
      <button
        onClick={() => setRulerState(!showRuler)}
        className={cn(
          ctrlBtn,
          showRuler ? 'text-purple-600 dark:text-purple-400' : 'text-gray-500 dark:text-gray-400',
        )}
        title="标尺"
      >
        <Ruler className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => setGridLineSize(gridLineSize > 0 ? 0 : 50)}
        className={cn(
          ctrlBtn,
          gridLineSize > 0 ? 'text-purple-600 dark:text-purple-400' : 'text-gray-500 dark:text-gray-400',
        )}
        title="网格"
      >
        <Grid3x3 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
