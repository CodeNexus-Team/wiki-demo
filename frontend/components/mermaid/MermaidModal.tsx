import React from 'react';
import { X } from 'lucide-react';
import Mermaid from '../Mermaid';
import { MermaidMetadata } from '../../types';

interface MermaidModalProps {
  isOpen: boolean;
  chart: string;
  metadata?: MermaidMetadata;
  zoom: number;
  position: { left: number; top: number };
  size: { width: number; height: number };
  contentRef: React.RefObject<HTMLDivElement>;
  isDragging: boolean;
  isSourcePanelOpen?: boolean;

  onClose: () => void;
  onNodeClick: (nodeId: string) => void;
  onResizeStart: (direction: 'left' | 'right' | 'top' | 'bottom') => void;
  onMoveStart: (e: React.MouseEvent) => void;
  onContentDragStart: (e: React.MouseEvent) => void;
  onWheel: (e: React.WheelEvent) => void;
}

export const MermaidModal: React.FC<MermaidModalProps> = ({
  isOpen,
  chart,
  metadata,
  zoom,
  position,
  size,
  contentRef,
  isDragging,
  isSourcePanelOpen = false,
  onClose,
  onNodeClick,
  onResizeStart,
  onMoveStart,
  onContentDragStart,
  onWheel,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/20 pointer-events-none">
      <div
        className="absolute bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col pointer-events-auto"
        style={{
          left: `${position.left}px`,
          top: `${position.top}px`,
          width: `${size.width}px`,
          height: `${size.height}px`,
          transition: isSourcePanelOpen ? 'width 0.3s ease-in-out' : 'none',
          willChange: isDragging ? 'width, height, left, top' : 'auto'
        }}
        onClick={(e) => e.stopPropagation()}
        onWheel={onWheel}
      >
        {/* Resize handles */}
        <div
          className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-blue-500/30 z-10"
          onMouseDown={(e) => {
            e.stopPropagation();
            onResizeStart('left');
          }}
        />
        <div
          className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-blue-500/30 z-10"
          onMouseDown={(e) => {
            e.stopPropagation();
            onResizeStart('right');
          }}
        />
        <div
          className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-blue-500/30 z-10"
          onMouseDown={(e) => {
            e.stopPropagation();
            onResizeStart('top');
          }}
        />
        <div
          className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-blue-500/30 z-10"
          onMouseDown={(e) => {
            e.stopPropagation();
            onResizeStart('bottom');
          }}
        />

        {/* Header */}
        <div
          className="flex items-center justify-between p-4 border-b border-gray-200 cursor-move"
          onMouseDown={onMoveStart}
        >
          <h3 className="text-lg font-semibold text-gray-900">Mermaid Chart</h3>
          <div className="flex items-center gap-2">
            <div className="text-xs text-gray-500 mr-2">Drag to move</div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div
          ref={contentRef}
          className="flex-1 overflow-auto p-6 cursor-grab active:cursor-grabbing"
          style={{
            overflow: 'auto',
            position: 'relative'
          }}
          onMouseDown={onContentDragStart}
        >
          <div style={{
            transform: `scale(${zoom})`,
            transformOrigin: 'top left',
            transition: 'transform 0.2s',
            display: 'inline-block',
            minWidth: '100%'
          }}>
            <Mermaid
              chart={chart}
              metadata={metadata}
              onNodeClick={onNodeClick}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-gray-200 text-center text-xs text-gray-500">
          Hold Ctrl + scroll to zoom (current: {Math.round(zoom * 100)}%) | Drag content to pan | Right-click node to view source | Drag edges to resize
        </div>
      </div>
    </div>
  );
};

export default MermaidModal;
