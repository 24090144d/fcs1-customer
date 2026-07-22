'use client';

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

type Offset = { x: number; y: number };

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  origin: Offset;
  rect: DOMRect;
};

export function useDraggableDialog() {
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const drag = useRef<DragState | null>(null);

  const resetDialogPosition = useCallback(() => setOffset({ x: 0, y: 0 }), []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button, a, input, select, textarea')) return;
    const dialog = event.currentTarget.closest('[role="dialog"]');
    if (!(dialog instanceof HTMLElement)) return;

    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: offset,
      rect: dialog.getBoundingClientRect(),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, [offset]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;

    const nextX = state.origin.x + event.clientX - state.startX;
    const nextY = state.origin.y + event.clientY - state.startY;
    const visibleEdge = 80;
    const visibleHeader = 48;
    setOffset({
      x: Math.min(
        state.origin.x + window.innerWidth - visibleEdge - state.rect.left,
        Math.max(state.origin.x + visibleEdge - state.rect.right, nextX),
      ),
      y: Math.min(
        state.origin.y + window.innerHeight - visibleHeader - state.rect.top,
        Math.max(state.origin.y - state.rect.top, nextY),
      ),
    });
  }, []);

  const stopDragging = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    drag.current = null;
  }, []);

  return {
    dialogStyle: { transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` },
    dragHandleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: stopDragging,
      onPointerCancel: stopDragging,
    },
    resetDialogPosition,
  };
}
