import { useState, useEffect, useRef, useCallback } from 'react';

interface UseResizablePanelOptions {
  initialWidth: number;
  initialHeight?: number;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
}

interface UseResizablePanelReturn {
  width: number;
  height: number;
  isDragging: boolean;
  isDraggingRef: React.MutableRefObject<'left' | 'right' | 'top' | 'bottom' | null>;

  setWidth: React.Dispatch<React.SetStateAction<number>>;
  setHeight: React.Dispatch<React.SetStateAction<number>>;

  startResize: (direction: 'left' | 'right' | 'top' | 'bottom') => void;

  getResizeHandlers: (direction: 'left' | 'right' | 'top' | 'bottom') => {
    onMouseDown: () => void;
  };
}

export function useResizablePanel(options: UseResizablePanelOptions): UseResizablePanelReturn {
  const {
    initialWidth,
    initialHeight = 500,
    minWidth = 400,
    maxWidth = typeof window !== 'undefined' ? window.innerWidth - 300 : 1200,
    minHeight = 200,
    maxHeight = typeof window !== 'undefined' ? window.innerHeight - 100 : 800
  } = options;

  const [width, setWidth] = useState(initialWidth);
  const [height, setHeight] = useState(initialHeight);
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef<'left' | 'right' | 'top' | 'bottom' | null>(null);

  const startResize = useCallback((direction: 'left' | 'right' | 'top' | 'bottom') => {
    isDraggingRef.current = direction;
    setIsDragging(true);
    document.body.classList.add('select-none');
  }, []);

  useEffect(() => {
    let rafId: number | null = null;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;

      if (rafId) cancelAnimationFrame(rafId);

      rafId = requestAnimationFrame(() => {
        const direction = isDraggingRef.current;

        if (direction === 'left' || direction === 'right') {
          const centerX = window.innerWidth / 2;
          const newHalfWidth = Math.abs(e.clientX - centerX);
          const newWidth = Math.max(minWidth, Math.min(newHalfWidth * 2, maxWidth));
          setWidth(newWidth);
        } else if (direction === 'top' || direction === 'bottom') {
          const newHeight = Math.max(minHeight, Math.min(window.innerHeight - e.clientY, maxHeight));
          setHeight(newHeight);
        }
      });
    };

    const handleMouseUp = () => {
      isDraggingRef.current = null;
      setIsDragging(false);
      document.body.classList.remove('select-none');
      if (rafId) cancelAnimationFrame(rafId);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [minWidth, maxWidth, minHeight, maxHeight]);

  const getResizeHandlers = useCallback((direction: 'left' | 'right' | 'top' | 'bottom') => ({
    onMouseDown: () => startResize(direction)
  }), [startResize]);

  return {
    width,
    height,
    isDragging,
    isDraggingRef,
    setWidth,
    setHeight,
    startResize,
    getResizeHandlers,
  };
}
