'use client';

import Canvas from './Canvas';
import type { StageMode } from '@/lib/types/stage';
import { ScreenCanvas } from './ScreenCanvas';
import { EditToolbar } from '@/components/canvas/edit-toolbar';
import { cn } from '@/lib/utils';

/**
 * Slide Editor - wraps Canvas with SceneProvider
 */
export function SlideEditor({ mode }: { readonly mode: StageMode }) {
  const isEditMode = mode === 'autonomous';
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-hidden">
        {isEditMode ? <Canvas /> : <ScreenCanvas />}
      </div>
      {isEditMode && (
        <EditToolbar
          className={cn(
            'shrink-0 h-9 px-2',
            'bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl',
            'border-t border-amber-200/60 dark:border-amber-700/40',
          )}
        />
      )}
    </div>
  );
}
