"use client";

import { useRef, useState, useEffect, useMemo } from "react";
import { useTheme } from "next-themes";
import type { TopologyNode, TopologyEdge } from "@/types/topology";
import { useLocale } from "@/lib/i18n";
import { formatTopologyCount } from "@/lib/i18n/topology-count";
import { TopologyDetailPanel } from "./topology-detail-panel";

interface TopologyCanvasProps {
  readonly nodes: TopologyNode[];
  readonly edges: TopologyEdge[];
  readonly zoom: number;
  readonly selectedNodeId: string | null;
  readonly onNodeClick: (nodeId: string) => void;
  readonly onNodeDblClick?: (nodeId: string) => void;
  readonly entityDetailLoading?: boolean;
  readonly graphMode?: "documents" | "knowledge";
}

const COLORS: Record<string, string> = {
  pdf: "#2563EB", docx: "#EA580C", md: "#16A34A", markdown: "#16A34A",
  draft: "#7C3AED", entity: "#7C3AED",
};
const BGS: Record<string, string> = {
  pdf: "#EFF6FF", docx: "#FFF7ED", md: "#F0FDF4", markdown: "#F0FDF4",
  draft: "#F3F1FC", entity: "#F5F3FF",
};
function clr(f: string) { return COLORS[f.toLowerCase()] ?? "#7C3AED"; }
function bgc(f: string) { return BGS[f.toLowerCase()] ?? "#F3F1FC"; }

function applyRotation(wrapper: HTMLDivElement | null, angle: number) {
  if (!wrapper) return;
  const deg = angle * (180 / Math.PI);
  wrapper.style.transform = `rotate(${deg}deg)`;
  wrapper.style.setProperty("--rotation-deg", `${deg}deg`);
}

export function TopologyCanvas({
  nodes,
  edges,
  zoom,
  selectedNodeId,
  onNodeClick,
  onNodeDblClick,
  entityDetailLoading,
  graphMode = "documents",
}: TopologyCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const angleRef = useRef(0);
  const rotating = useRef(false);
  const lastX = useRef(0);
  const autoRef = useRef(true);
  const autoTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [, setDragTick] = useState(0);

  const dragCardId = useRef<string | null>(null);
  const dragStartMouse = useRef({ x: 0, y: 0 });
  const dragHasMoved = useRef(false);
  const dragAngle = useRef(0);
  const cardOffsets = useRef<Record<string, { dx: number; dy: number }>>({});

  const draftNode = useMemo(() => nodes.find((n) => n.type === "draft"), [nodes]);
  const refNodes = useMemo(() => nodes.filter((n) => n.type === "reference" || n.type === "entity"), [nodes]);
  const nodeById = useMemo(() => {
    const m = new Map<string, TopologyNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);
  const edgesByTarget = useMemo(() => {
    const m = new Map<string, TopologyEdge[]>();
    for (const e of edges) {
      const arr = m.get(e.target) ?? [];
      arr.push(e);
      m.set(e.target, arr);
    }
    return m;
  }, [edges]);
  const isKnowledge = graphMode === "knowledge";
  const rotMul = isKnowledge ? 0.5 : 1;
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && resolvedTheme === "dark";
  const { locale, t } = useLocale();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ w: r.width, h: r.height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onDown = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest("[data-card-id]");
      if (target) {
        e.preventDefault();
        const cardId = target.getAttribute("data-card-id")!;
        dragCardId.current = cardId;
        dragStartMouse.current = { x: e.clientX, y: e.clientY };
        dragHasMoved.current = false;
        dragAngle.current = angleRef.current * rotMul;
        e.stopPropagation();
      } else {
        e.preventDefault();
        rotating.current = true;
        lastX.current = e.clientX;
      }
      autoRef.current = false;
      clearTimeout(autoTimer.current);
    };
    const onMove = (e: MouseEvent) => {
      if (dragCardId.current) {
        const dx = e.clientX - dragStartMouse.current.x;
        const dy = e.clientY - dragStartMouse.current.y;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragHasMoved.current = true;
        const a = dragAngle.current;
        const cosA = Math.cos(a);
        const sinA = Math.sin(a);
        const localDx = e.movementX * cosA + e.movementY * sinA;
        const localDy = -e.movementX * sinA + e.movementY * cosA;
        const prev = cardOffsets.current[dragCardId.current] ?? { dx: 0, dy: 0 };
        cardOffsets.current[dragCardId.current] = {
          dx: prev.dx + localDx,
          dy: prev.dy + localDy,
        };
        dragStartMouse.current = { x: e.clientX, y: e.clientY };
        setDragTick((t) => t + 1);
      } else if (rotating.current) {
        const delta = (e.clientX - lastX.current) * 0.005;
        angleRef.current += delta;
        lastX.current = e.clientX;
        applyRotation(wrapperRef.current, angleRef.current * rotMul);
      }
    };
    const onUp = () => {
      const wasCardDrag = dragCardId.current != null;
      const moved = dragHasMoved.current;
      dragCardId.current = null;
      dragHasMoved.current = false;
      rotating.current = false;
      autoTimer.current = setTimeout(() => { autoRef.current = true; }, 4000);
      if (wasCardDrag && moved) setDragTick((t) => t + 1);
    };
    el.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      el.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      clearTimeout(autoTimer.current);
    };
  }, [rotMul]);

  useEffect(() => {
    let last = performance.now();
    let raf: number;
    function frame(now: number) {
      if (now - last >= 16) {
        last = now;
        if (autoRef.current) {
          angleRef.current += 0.003;
          applyRotation(wrapperRef.current, angleRef.current * rotMul);
        }
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [rotMul]);

  const cx = size.w / 2;
  const cy = size.h / 2;
  const radius = Math.min(size.w, size.h) * 0.34 * zoom;

  const items = (() => {
    const result: {
      id: string; label: string; format: string; weight: number;
      color: string; bg: string; x: number; y: number;
    }[] = [];
    const n = refNodes.length;
    for (let i = 0; i < n; i++) {
      const baseAngle = (2 * Math.PI * i) / Math.max(n, 1);
      const r = isKnowledge ? radius * (0.6 + 0.4 * (i % 3) / 3) : radius;
      const edge = (edgesByTarget.get(refNodes[i].id) ?? [])[0];
      const off = cardOffsets.current[refNodes[i].id] ?? { dx: 0, dy: 0 };
      result.push({
        id: refNodes[i].id,
        label: refNodes[i].label || refNodes[i].entityType || t.topology.nodeTypes.entity,
        format: refNodes[i].format || "entity",
        weight: edge?.weight ?? 1,
        color: clr(refNodes[i].format || "entity"),
        bg: bgc(refNodes[i].format || "entity"),
        x: cx + Math.cos(baseAngle) * r + off.dx,
        y: cy + Math.sin(baseAngle) * r + off.dy,
      });
    }
    return result;
  })();

  const itemById = useMemo(() => {
    const m = new Map<string, { x: number; y: number; color: string }>();
    for (const it of items) m.set(it.id, it);
    return m;
  }, [items]);

  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) ?? null : null;

  const wrapperStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    transformOrigin: `${cx}px ${cy}px`,
    willChange: "transform",
  };

  // Theme-aware palette
  const dotColor = isDark ? "rgba(148, 163, 184, 0.14)" : "rgba(148, 163, 184, 0.30)";
  const cardBg = isDark ? "rgba(17, 24, 39, 0.72)" : "rgba(255, 255, 255, 0.72)";
  const draftIconBg = isDark ? "rgba(139, 92, 246, 0.18)" : "rgba(124, 58, 237, 0.10)";
  const draftIconFg = isDark ? "#C4B5FD" : "#7C3AED";
  const draftTitleColor = isDark ? "#F8FAFC" : "#0F172A";
  const draftSubColor = isDark ? "rgba(248, 250, 252, 0.55)" : "rgba(15, 23, 42, 0.55)";
  const draftSel = !!draftNode && draftNode.id === selectedNodeId;

  return (
    <div
      ref={containerRef}
      className="relative bg-background border border-border rounded-2xl overflow-hidden select-none"
      style={{ minHeight: 560, cursor: dragCardId.current ? "default" : rotating.current ? "grabbing" : "grab" }}
    >
      {/* Theme-aware dot grid + faint violet/orange mesh glow for depth */}
      <div className="absolute inset-0" style={{
        backgroundImage: `radial-gradient(circle, ${dotColor} 1px, transparent 1px)`,
        backgroundSize: "24px 24px",
      }} />
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: isDark
          ? "radial-gradient(at 22% 24%, rgba(139, 92, 246, 0.10) 0px, transparent 48%), radial-gradient(at 78% 80%, rgba(251, 146, 60, 0.06) 0px, transparent 48%)"
          : "radial-gradient(at 22% 24%, rgba(124, 58, 237, 0.05) 0px, transparent 48%), radial-gradient(at 78% 80%, rgba(249, 115, 22, 0.03) 0px, transparent 48%)",
      }} />

      <div ref={wrapperRef} style={wrapperStyle}>
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          <defs>
            {items.map((it, i) => (
              // id must be ASCII-safe: node ids can contain Chinese chars or
              // dots (e.g. ".docx") which break url(#…) CSS selector parsing.
              <linearGradient key={`g-${i}`} id={`g-${i}`} x1={cx} y1={cy} x2={it.x} y2={it.y} gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor={isDark ? "#8B5CF6" : "#7C3AED"} />
                <stop offset="100%" stopColor={it.color} />
              </linearGradient>
            ))}
          </defs>
          {items.map((it, i) => {
            const sel = it.id === selectedNodeId;
            if (isKnowledge) {
              const connectedEdges = edgesByTarget.get(it.id) ?? [];
              return connectedEdges.map((edge, j) => {
                const sourceItem = itemById.get(edge.source);
                if (!sourceItem) return null;
                return (
                  <line key={`${it.id}-${j}`} x1={sourceItem.x} y1={sourceItem.y} x2={it.x} y2={it.y}
                    stroke={it.color} strokeWidth={1} opacity={0.25} />
                );
              });
            }
            // Curved bezier edge (center → reference): offset the midpoint along
            // the perpendicular so parallel links fan out instead of overlapping.
            const dx = it.x - cx;
            const dy = it.y - cy;
            const len = Math.hypot(dx, dy) || 1;
            const curve = Math.min(40, len * 0.12);
            const ox = (-dy / len) * curve;
            const oy = (dx / len) * curve;
            const mx = (cx + it.x) / 2 + ox;
            const my = (cy + it.y) / 2 + oy;
            return (
              <path key={it.id}
                d={`M ${cx} ${cy} Q ${mx} ${my} ${it.x} ${it.y}`}
                fill="none"
                stroke={`url(#g-${i})`}
                strokeWidth={sel ? 2.5 : 1.5}
                strokeLinecap="round"
                opacity={sel ? 0.9 : 0.55}
              />
            );
          })}
        </svg>

        {items.map((it) => {
          const sel = it.id === selectedNodeId;
          const isDragging = dragCardId.current === it.id;
          return (
            <div key={it.id}
              data-card-id={it.id}
              title={it.label}
              className="absolute rounded-xl flex items-center gap-2 px-2.5 overflow-hidden"
              style={{
                left: it.x - 75, top: it.y - 26, width: 150, height: 52,
                borderWidth: 1.5, borderStyle: "solid",
                borderColor: sel ? it.color : "var(--border)",
                backgroundColor: sel ? it.bg : cardBg,
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                boxShadow: sel
                  ? `0 6px 24px -4px ${it.color}40, 0 0 0 1px ${it.color}20, 0 1px 0 ${isDark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.5)"} inset`
                  : `0 2px 8px -2px rgba(0,0,0,${isDark ? 0.4 : 0.06}), 0 1px 0 ${isDark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.5)"} inset`,
                zIndex: isDragging ? 30 : sel ? 25 : 15,
                cursor: isDragging ? "grabbing" : "grab",
                transition: isDragging ? "none" : "box-shadow 0.2s, border-color 0.2s, transform 0.2s",
                transform: sel ? "rotate(calc(-1 * var(--rotation-deg, 0deg))) translateY(-2px)" : "rotate(calc(-1 * var(--rotation-deg, 0deg)))",
              }}
              onClick={() => { if (!dragHasMoved.current) onNodeClick(it.id); }}
              onDoubleClick={() => { if (!dragHasMoved.current && onNodeDblClick) onNodeDblClick(it.id); }}
            >
              <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                style={{ backgroundColor: sel ? it.bg : `${it.color}1A`, boxShadow: `0 0 8px ${it.color}30` }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={it.color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </div>
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-[10px] font-semibold leading-tight line-clamp-1 text-foreground">{it.label}</span>
                <span className="text-[8px] font-medium mt-px truncate" style={{ color: it.color }}>
                  ·{it.weight}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {draftNode && (
        <div
          className="absolute flex flex-col items-center justify-center text-center rounded-2xl cursor-pointer"
          style={{
            left: cx - 90, top: cy - 55, width: 180, height: 110,
            backgroundColor: cardBg,
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            borderWidth: 1.5,
            borderStyle: "solid",
            borderColor: draftSel ? (isDark ? "#8B5CF6" : "#7C3AED") : "var(--border)",
            // Soft violet glow ring replaces the old solid purple gradient.
            boxShadow: draftSel
              ? `0 0 0 1px ${isDark ? "rgba(139,92,246,0.5)" : "rgba(124,58,237,0.4)"}, 0 8px 32px -6px ${isDark ? "rgba(139,92,246,0.45)" : "rgba(124,58,237,0.30)"}, 0 0 28px ${isDark ? "rgba(139,92,246,0.18)" : "rgba(124,58,237,0.12)"}, 0 1px 0 ${isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.6)"} inset`
              : `0 8px 32px -6px ${isDark ? "rgba(139,92,246,0.28)" : "rgba(124,58,237,0.18)"}, 0 0 22px ${isDark ? "rgba(139,92,246,0.10)" : "rgba(124,58,237,0.06)"}, 0 1px 0 ${isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.6)"} inset`,
            zIndex: 20,
            transition: "box-shadow 0.25s, border-color 0.25s",
          }}
          onClick={() => onNodeClick(draftNode.id)}
        >
          <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-1.5"
            style={{ backgroundColor: draftIconBg }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={draftIconFg} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
          </div>
          <span className="text-[13px] font-bold font-display leading-tight line-clamp-2 px-4" style={{ color: draftTitleColor }}>{draftNode.label}</span>
          <span className="text-[10px] mt-0.5" style={{ color: draftSubColor }}>
            {formatTopologyCount(draftNode.totalReferences ?? refNodes.length, locale, t.topology.counts.refs)}
            {draftNode.sectionsWithReferences !== undefined && draftNode.totalSections !== undefined
              ? ` · ${draftNode.sectionsWithReferences}/${formatTopologyCount(draftNode.totalSections, locale, t.topology.counts.sections)}`
              : ""}
          </span>
        </div>
      )}

      <div className="absolute bottom-3 left-4 text-[10px] text-muted-foreground select-none pointer-events-none">
        {t.topology.dragToRotate}
      </div>

      {selectedNode && (
        <TopologyDetailPanel
          node={selectedNode}
          loading={entityDetailLoading}
          onClose={() => onNodeClick("")}
          onNavigate={isKnowledge ? () => { if (onNodeDblClick) onNodeDblClick(selectedNode.id); } : undefined}
        />
      )}
    </div>
  );
}
