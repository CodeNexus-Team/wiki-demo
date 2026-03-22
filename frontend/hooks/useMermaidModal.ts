import { useState, useRef, useEffect, useCallback } from 'react';
import { MermaidMetadata } from '../types';

interface UseMermaidModalReturn {
  isOpen: boolean;
  chart: string;
  metadata?: MermaidMetadata;
  zoom: number;
  position: { left: number; top: number };
  size: { width: number; height: number };

  contentRef: React.RefObject<HTMLDivElement>;
  isDraggingRef: React.MutableRefObject<'left' | 'right' | 'top' | 'bottom' | 'move' | null>;

  open: (chart: string, metadata?: MermaidMetadata) => void;
  close: () => void;
  setZoom: React.Dispatch<React.SetStateAction<number>>;

  handleResizeStart: (direction: 'left' | 'right' | 'top' | 'bottom') => void;
  handleMoveStart: (e: React.MouseEvent) => void;
  handleContentDragStart: (e: React.MouseEvent) => void;
  handleWheel: (e: React.WheelEvent) => void;

  adjustForSourcePanel: (sourcePanelWidth: number) => void;
}

export function useMermaidModal(): UseMermaidModalReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [chart, setChart] = useState('');
  const [metadata, setMetadata] = useState<MermaidMetadata | undefined>();
  const [zoom, setZoom] = useState(1);

  const [width, setWidth] = useState(typeof window !== 'undefined' ? window.innerWidth * 0.95 : 1200);
  const [height, setHeight] = useState(typeof window !== 'undefined' ? window.innerHeight * 0.95 : 800);
  const [left, setLeft] = useState(typeof window !== 'undefined' ? window.innerWidth * 0.025 : 20);
  const [top, setTop] = useState(typeof window !== 'undefined' ? window.innerHeight * 0.025 : 20);

  const isDraggingRef = useRef<'left' | 'right' | 'top' | 'bottom' | 'move' | null>(null);
  const modalDragStartRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const contentDraggingRef = useRef(false);
  const scrollStartRef = useRef<{ scrollLeft: number; scrollTop: number; clientX: number; clientY: number } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const open = useCallback((newChart: string, newMetadata?: MermaidMetadata) => {
    setChart(newChart);
    setMetadata(newMetadata);
    setZoom(1);
    const initialWidth = window.innerWidth * 0.95;
    const initialHeight = window.innerHeight * 0.95;
    setWidth(initialWidth);
    setHeight(initialHeight);
    setLeft(window.innerWidth * 0.025);
    setTop(window.innerHeight * 0.025);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const handleResizeStart = useCallback((direction: 'left' | 'right' | 'top' | 'bottom') => {
    isDraggingRef.current = direction;
    document.body.classList.add('select-none');
  }, []);

  const handleMoveStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.stopPropagation();
    isDraggingRef.current = 'move';
    document.body.classList.add('select-none');
    modalDragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      left,
      top
    };
  }, [left, top]);

  const handleContentDragStart = useCallback((e: React.MouseEvent) => {
    if (contentRef.current) {
      contentDraggingRef.current = true;
      scrollStartRef.current = {
        scrollLeft: contentRef.current.scrollLeft,
        scrollTop: contentRef.current.scrollTop,
        clientX: e.clientX,
        clientY: e.clientY
      };
      contentRef.current.style.cursor = 'grabbing';
      e.preventDefault();
    }
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setZoom(prev => {
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        return Math.max(0.5, prev + delta);
      });
    }
  }, []);

  const adjustForSourcePanel = useCallback((sourcePanelWidth: number) => {
    if (sourcePanelWidth > 0) {
      const targetWidth = window.innerWidth * 0.6;
      setWidth(targetWidth);
    }
  }, []);

  // Mouse move and mouse up handlers
  useEffect(() => {
    let rafId: number | null = null;

    const handleMouseMove = (e: MouseEvent) => {
      // Handle content dragging
      if (contentDraggingRef.current && scrollStartRef.current && contentRef.current) {
        const deltaX = e.clientX - scrollStartRef.current.clientX;
        const deltaY = e.clientY - scrollStartRef.current.clientY;
        contentRef.current.scrollLeft = scrollStartRef.current.scrollLeft - deltaX;
        contentRef.current.scrollTop = scrollStartRef.current.scrollTop - deltaY;
        return;
      }

      if (!isDraggingRef.current) return;

      if (rafId) cancelAnimationFrame(rafId);

      rafId = requestAnimationFrame(() => {
        const direction = isDraggingRef.current;

        if (direction === 'move') {
          if (modalDragStartRef.current) {
            const deltaX = e.clientX - modalDragStartRef.current.x;
            const deltaY = e.clientY - modalDragStartRef.current.y;
            setLeft(modalDragStartRef.current.left + deltaX);
            setTop(modalDragStartRef.current.top + deltaY);
          }
        } else if (direction === 'right') {
          const newWidth = Math.max(300, e.clientX - left);
          setWidth(newWidth);
        } else if (direction === 'left') {
          const delta = e.clientX - left;
          const newLeft = Math.max(0, e.clientX);
          const newWidth = Math.max(300, width - delta);
          setLeft(newLeft);
          setWidth(newWidth);
        } else if (direction === 'bottom') {
          const newHeight = Math.max(200, e.clientY - top);
          setHeight(newHeight);
        } else if (direction === 'top') {
          const delta = e.clientY - top;
          const newTop = Math.max(0, e.clientY);
          const newHeight = Math.max(200, height - delta);
          setTop(newTop);
          setHeight(newHeight);
        }
      });
    };

    const handleMouseUp = () => {
      isDraggingRef.current = null;
      modalDragStartRef.current = null;
      contentDraggingRef.current = false;
      scrollStartRef.current = null;
      document.body.classList.remove('select-none');
      if (rafId) cancelAnimationFrame(rafId);
      if (contentRef.current) {
        contentRef.current.style.cursor = 'grab';
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [left, top, width, height]);

  return {
    isOpen,
    chart,
    metadata,
    zoom,
    position: { left, top },
    size: { width, height },
    contentRef,
    isDraggingRef,
    open,
    close,
    setZoom,
    handleResizeStart,
    handleMoveStart,
    handleContentDragStart,
    handleWheel,
    adjustForSourcePanel,
  };
}
