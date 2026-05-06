"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import type { TopologyNode, TopologyEdge } from "@/types/topology";
import { TopologyDetailPanel } from "./topology-detail-panel";

interface TopologyCanvasProps {
  readonly nodes: TopologyNode[];
  readonly edges: TopologyEdge[];
  readonly zoom: number;
  readonly selectedNodeId: string | null;
  readonly onNodeClick: (nodeId: string) => void;
}

const FORMAT_COLORS: Record<string, string> = {
  pdf: "#2563EB",
  docx: "#EA580C",
  md: "#16A34A",
  markdown: "#16A34A",
  draft: "#4361EE",
} as const;

const FORMAT_BG: Record<string, string> = {
  pdf: "#EFF6FF",
  docx: "#FFF7ED",
  md: "#F0FDF4",
  markdown: "#F0FDF4",
  draft: "#EEF0FD",
} as const;

function getFormatColor(format: string): string {
  return FORMAT_COLORS[format.toLowerCase()] ?? "#4361EE";
}

function getFormatBg(format: string): string {
  return FORMAT_BG[format.toLowerCase()] ?? "#EEF0FD";
}

function FormatNodeIcon({ format }: { readonly format: string }) {
  const color = getFormatColor(format);
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function DraftIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="white"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

interface NodePosition {
  x: number;
  y: number;
}

interface DraftPosition {
  x: number;
  y: number;
}

interface ComputedLayout {
  draft: DraftPosition;
  references: NodePosition[];
  containerWidth: number;
  containerHeight: number;
}

function computeLayout(
  containerWidth: number,
  containerHeight: number,
  referenceCount: number,
  zoom: number
): ComputedLayout {
  const cx = containerWidth / 2;
  const cy = containerHeight * 0.4;

  const radiusX = containerWidth * 0.35;
  const radiusY = containerHeight * 0.3;

  const references: NodePosition[] = [];

  for (let i = 0; i < referenceCount; i++) {
    const angle = (2 * Math.PI * i) / referenceCount - Math.PI / 2;
    references.push({
      x: cx + radiusX * Math.cos(angle),
      y: cy + radiusY * Math.sin(angle),
    });
  }

  return {
    draft: {
      x: cx * zoom - 70,
      y: cy * zoom - 70,
    },
    references: references.map((pos) => ({
      x: pos.x * zoom,
      y: pos.y * zoom,
    })),
    containerWidth: containerWidth * zoom,
    containerHeight: containerHeight * zoom,
  };
}

export function TopologyCanvas({
  nodes,
  edges,
  zoom,
  selectedNodeId,
  onNodeClick,
}: TopologyCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerWidth(entry.contentRect.width);
        setContainerHeight(entry.contentRect.height);
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const draftNode = nodes.find((n) => n.type === "draft");
  const referenceNodes = nodes.filter((n) => n.type === "reference");
  const layout = computeLayout(
    containerWidth,
    containerHeight,
    referenceNodes.length,
    zoom
  );

  const selectedNode = selectedNodeId
    ? nodes.find((n) => n.id === selectedNodeId) ?? null
    : null;

  const selectedEdge = selectedNodeId
    ? edges.find((e) => e.target === selectedNodeId) ?? null
    : null;

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      onNodeClick(nodeId);
    },
    [onNodeClick]
  );

  const handleCloseDetail = useCallback(() => {
    onNodeClick("");
  }, [onNodeClick]);

  const draftCx = containerWidth / 2;
  const draftCy = containerHeight * 0.4;

  return (
    <div className="relative min-h-[560px] bg-[#F5F5F3] border border-[#E4E4E7] rounded-2xl overflow-hidden">
      {/* Animated dash keyframes */}
      <style>{`
        @keyframes topo-dash {
          to { stroke-dashoffset: -20; }
        }
        .topo-dash {
          animation: topo-dash 1.2s linear infinite;
        }
        @keyframes topo-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(67, 97, 238, 0.3); }
          50% { box-shadow: 0 0 0 12px rgba(67, 97, 238, 0); }
        }
        .topo-pulse {
          animation: topo-pulse 2.5s ease-in-out infinite;
        }
      `}</style>

      {/* Container ref for measurement */}
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{
          transform: `scale(${zoom})`,
          transformOrigin: "center center",
        }}
      >
        {/* SVG edge layer */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {referenceNodes.map((node, index) => {
            const refPos = layout.references[index];
            if (!refPos) return null;

            const color = getFormatColor(node.format);
            const edge = edges.find((e) => e.target === node.id);
            const weight = edge?.weight ?? 1;

            return (
              <line
                key={`edge-${node.id}`}
                x1={draftCx}
                y1={draftCy}
                x2={refPos.x}
                y2={refPos.y}
                stroke={color}
                strokeWidth={1.5 + weight * 0.5}
                opacity={0.4 + weight * 0.05}
                strokeDasharray="6 4"
                className="topo-dash"
              />
            );
          })}
        </svg>

        {/* Draft node (center) */}
        {draftNode && (
          <div
            className="absolute topo-pulse rounded-2xl flex flex-col items-center justify-center text-white text-center p-4 cursor-default select-none"
            style={{
              left: draftCx - 70,
              top: draftCy - 70,
              width: 140,
              height: 140,
              background: "linear-gradient(135deg, #4361EE, #3651D4)",
            }}
          >
            <DraftIcon />
            <span className="text-[13px] font-bold mt-2 leading-tight line-clamp-2">
              {draftNode.label}
            </span>
          </div>
        )}

        {/* Reference nodes */}
        {referenceNodes.map((node, index) => {
          const pos = layout.references[index];
          if (!pos) return null;

          const color = getFormatColor(node.format);
          const bg = getFormatBg(node.format);
          const isSelected = node.id === selectedNodeId;

          return (
            <div
              key={node.id}
              role="button"
              tabIndex={0}
              onClick={() => handleNodeClick(node.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleNodeClick(node.id);
                }
              }}
              className="absolute bg-white rounded-2xl flex flex-col items-center justify-center p-3 transition-transform duration-200 hover:scale-[1.08] cursor-pointer select-none"
              style={{
                left: pos.x - 60,
                top: pos.y - 50,
                width: 120,
                height: 100,
                borderWidth: 2,
                borderStyle: "solid",
                borderColor: isSelected ? color : "#E4E4E7",
                backgroundColor: isSelected ? bg : "white",
              }}
            >
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center mb-1.5"
                style={{ backgroundColor: bg }}
              >
                <FormatNodeIcon format={node.format} />
              </div>
              <span
                className="text-[11px] font-semibold text-[#18181B] leading-tight text-center line-clamp-2"
                style={{ color }}
              >
                {node.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Detail panel overlay */}
      {selectedNode && selectedEdge && (
        <TopologyDetailPanel
          node={selectedNode}
          edge={selectedEdge}
          onClose={handleCloseDetail}
        />
      )}
    </div>
  );
}
