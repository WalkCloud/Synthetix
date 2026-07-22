"use client";

/**
 * Force-directed Knowledge Graph canvas (premium styling).
 *
 * d3-force with forceCollide guarantees nodes never overlap; the simulation
 * spreads them to fit any node count. Renders to <canvas> with a curated
 * palette, radial-gradient nodes with soft glow, curved bezier links, and
 * dark-mode-aware colors so it matches the rest of the app.
 *
 * Density: by default only the top entities by degree are shown (with a
 * "show all" toggle) to keep the graph readable. Selecting a node opens the
 * right-side TopologyDetailPanel.
 *
 * Interactions: wheel=zoom (cursor-anchored), drag background=pan,
 * drag node=arrange, click=select, double-click=re-center on entity.
 */

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useTheme } from "next-themes";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import type { TopologyEdge, TopologyNode } from "@/types/topology";
import { TopologyDetailPanel } from "@/components/topology/topology-detail-panel";
import { useLocale } from "@/lib/i18n";

export interface KnowledgeGraphCanvasHandle {
  zoomBy: (factor: number) => void;
  zoomToFit: () => void;
}

interface KnowledgeGraphCanvasProps {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  selectedNodeId: string | null;
  onNodeClick: (id: string) => void;
  onNodeDblClick?: (id: string) => void;
  entityDetailLoading?: boolean;
  zoomRef?: MutableRefObject<KnowledgeGraphCanvasHandle | null>;
}

interface GNode extends SimulationNodeDatum {
  id: string;
  label: string;
  type: string;
  degree: number;
  r: number;
}
interface GLink extends SimulationLinkDatum<GNode> {
  weight: number;
}

// Curated, harmonious palette anchored on the app's violet primary.
const PALETTE = [
  "#7C3AED", "#6366F1", "#2563EB", "#0EA5E9",
  "#0891B2", "#059669", "#D97706", "#DB2777",
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
function typeColor(type: string): string {
  return PALETTE[hashStr(type || "entity") % PALETTE.length];
}
// Lighten a #rrggbb color toward white by t (0..1).
function lighten(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (c: number) => Math.round(c + (255 - c) * t);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

const TOP_N = 40; // default visible entities (by degree) to keep it readable

export function KnowledgeGraphCanvas({
  nodes,
  edges,
  selectedNodeId,
  onNodeClick,
  onNodeDblClick,
  entityDetailLoading,
  zoomRef,
}: KnowledgeGraphCanvasProps) {
  const { resolvedTheme } = useTheme();
  const { t, format } = useLocale();
  const [showAll, setShowAll] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const transformRef = useRef({ k: 1, x: 0, y: 0 });
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const simRef = useRef<Simulation<GNode, GLink> | null>(null);
  const gNodesRef = useRef<GNode[]>([]);
  const gLinksRef = useRef<GLink[]>([]);
  const neighborsRef = useRef<Map<string, Set<string>>>(new Map());
  const labelThresholdRef = useRef(Infinity);
  const isDarkRef = useRef(false);
  // Track whether the user has manually interacted (zoom/pan). Once true,
  // auto-fit-to-view is suppressed so it never overrides the user's zoom level.
  const userInteractedRef = useRef(false);

  const hoverRef = useRef<string | null>(null);
  const dragNodeRef = useRef<GNode | null>(null);
  const dragMovedRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const panRef = useRef<{ active: boolean; moved: boolean; x: number; y: number }>({
    active: false, moved: false, x: 0, y: 0,
  });

  // Build graph model, applying the density filter (top-N by degree) unless showAll.
  const graphData = useMemo(() => {
    const degree = new Map<string, number>();
    for (const n of nodes) degree.set(n.id, 0);
    for (const e of edges) {
      if (degree.has(e.source)) degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      if (degree.has(e.target)) degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }
    let gNodes: GNode[] = nodes.map((n) => {
      const d = degree.get(n.id) ?? 0;
      return {
        id: n.id,
        label: n.label || n.entityType || n.id.slice(0, 24),
        type: n.entityType || n.type || "entity",
        degree: d,
        r: Math.min(17, 5 + Math.sqrt(d) * 2.6),
      };
    });

    if (!showAll && gNodes.length > TOP_N) {
      const keep = new Set(
        [...gNodes].sort((a, b) => b.degree - a.degree).slice(0, TOP_N).map((n) => n.id),
      );
      gNodes = gNodes.filter((n) => keep.has(n.id));
    }

    const idSet = new Set(gNodes.map((n) => n.id));
    const gLinks: GLink[] = edges
      .filter((e) => idSet.has(e.source) && idSet.has(e.target) && e.source !== e.target)
      .map((e) => ({ source: e.source, target: e.target, weight: e.weight || 1 }));

    const neighbors = new Map<string, Set<string>>();
    for (const n of gNodes) neighbors.set(n.id, new Set());
    for (const l of gLinks) {
      const s = typeof l.source === "object" ? l.source.id : String(l.source);
      const tt = typeof l.target === "object" ? l.target.id : String(l.target);
      neighbors.get(s)?.add(tt);
      neighbors.get(tt)?.add(s);
    }

    const sortedDeg = gNodes.map((n) => n.degree).sort((a, b) => b - a);
    const threshold = sortedDeg[Math.min(28, sortedDeg.length - 1)] ?? Infinity;

    return { gNodes, gLinks, neighbors, threshold };
  }, [nodes, edges, showAll]);

  useEffect(() => {
    gNodesRef.current = graphData.gNodes;
    gLinksRef.current = graphData.gLinks;
    neighborsRef.current = graphData.neighbors;
    labelThresholdRef.current = graphData.threshold;
  }, [graphData]);

  const toSim = (clientX: number, clientY: number): { x: number; y: number } | null => {
    // The pointer listeners are bound to window, so a mousemove can arrive after
    // the canvas unmounts (e.g. tab switch / remount) while the stale listener
    // is still being torn down. Bail out instead of crashing on null.
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const t = transformRef.current;
    return {
      x: (clientX - rect.left - t.x) / t.k,
      y: (clientY - rect.top - t.y) / t.k,
    };
  };
  const nodeAt = (sx: number, sy: number): GNode | null => {
    let best: GNode | null = null;
    let bestD = Infinity;
    for (const n of gNodesRef.current) {
      if (n.x == null || n.y == null) continue;
      const d = (n.x - sx) ** 2 + (n.y - sy) ** 2;
      if (d <= (n.r + 4) ** 2 && d < bestD) { bestD = d; best = n; }
    }
    return best;
  };

  const scheduleDrawRef = useRef<() => void>(() => {});

  const zoomToFitInternal = () => {
    const ns = gNodesRef.current;
    if (ns.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of ns) {
      if (n.x == null || n.y == null) continue;
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y);
    }
    if (!isFinite(minX)) return;
    const { w, h } = sizeRef.current;
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    const pad = 90;
    const k = Math.max(0.2, Math.min(2.5, (w - pad * 2) / bw, (h - pad * 2) / bh));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    transformRef.current = { k, x: w / 2 - cx * k, y: h / 2 - cy * k };
    scheduleDrawRef.current();
  };

  const zoomAt = (cxScreen: number, cyScreen: number, factor: number) => {
    userInteractedRef.current = true;
    const t = transformRef.current;
    const k = Math.max(0.2, Math.min(4, t.k * factor));
    const sx = (cxScreen - t.x) / t.k;
    const sy = (cyScreen - t.y) / t.k;
    transformRef.current = { k, x: cxScreen - sx * k, y: cyScreen - sy * k };
    scheduleDrawRef.current();
  };

  // Force simulation — strong spreading + collision so nodes never overlap.
  useEffect(() => {
    const { w, h } = sizeRef.current;
    const gNodes = graphData.gNodes.map((n) => ({ ...n }));
    const gLinks: GLink[] = graphData.gLinks.map((l) => ({ ...l }));
    gNodesRef.current = gNodes;
    gLinksRef.current = gLinks;

    const sim = forceSimulation<GNode>(gNodes)
      .force("charge", forceManyBody<GNode>().strength((d) => -(70 + d.r * 9)))
      .force(
        "link",
        forceLink<GNode, GLink>(gLinks)
          .id((d) => d.id)
          .distance((l) => 55 + 26 / Math.max(1, l.weight))
          .strength(0.12),
      )
      .force("collide", forceCollide<GNode>().radius((d) => d.r + 9).iterations(3))
      .force("center", forceCenter(w / 2, h / 2))
      .alphaDecay(0.03);
    // Fit the view to the nodes as soon as the canvas has a real size and the
    // nodes have begun to spread out — but early enough that the user never sees
    // the un-scaled (k=1) initial frame. The former fixed 500ms delay showed a
    // visible "too large then shrinks" flash; tracking the first few ticks once
    // the layout is measured eliminates it.
    let ticksSinceReady = -1;
    let fitDone = false;
    const fitOnReady = () => {
      scheduleDrawRef.current();
      if (fitDone) return;
      // Suppress auto-fit once the user has manually zoomed/panned — their
      // viewport takes priority over the automatic "fit to view".
      if (userInteractedRef.current) { fitDone = true; return; }
      // Wait until the ResizeObserver has measured the canvas.
      if (sizeRef.current.w <= 0 || sizeRef.current.h <= 0) return;
      // Let the simulation spread the nodes a few ticks so the bounding box is
      // meaningful, then lock the fit.
      ticksSinceReady += 1;
      if (ticksSinceReady >= 3) {
        fitDone = true;
        zoomToFitInternal();
      }
    };
    sim.on("tick", fitOnReady);
    simRef.current = sim;

    return () => { sim.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphData]);

  // Theme tracking for dark-mode-aware colors.
  useEffect(() => {
    isDarkRef.current = resolvedTheme === "dark";
    scheduleDrawRef.current();
  }, [resolvedTheme]);

  // Drawing loop.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let dirty = true;

    const draw = () => {
      dirty = false;
      const { w, h, dpr } = sizeRef.current;
      if (w === 0 || h === 0) return;
      const dark = isDarkRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const t = transformRef.current;
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.scale(t.k, t.k);

      const sel = selectedNodeId;
      const neighbors = sel ? neighborsRef.current.get(sel) : null;

      // Links — gentle quadratic curves to avoid a hairball.
      for (const l of gLinksRef.current) {
        const s = l.source as GNode;
        const tg = l.target as GNode;
        if (s.x == null || s.y == null || tg.x == null || tg.y == null) continue;
        const highlighted = !!sel && (s.id === sel || tg.id === sel);
        const mx = (s.x + tg.x) / 2;
        const my = (s.y + tg.y) / 2;
        const dx = tg.x - s.x, dy = tg.y - s.y;
        const len = Math.hypot(dx, dy) || 1;
        const curve = Math.min(40, len * 0.12);
        const ox = (-dy / len) * curve;
        const oy = (dx / len) * curve;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.quadraticCurveTo(mx + ox, my + oy, tg.x, tg.y);
        if (highlighted) {
          ctx.strokeStyle = dark ? "rgba(167,139,250,0.75)" : "rgba(124,58,237,0.7)";
          ctx.lineWidth = (1.6 + Math.min(2, l.weight * 0.3)) / t.k;
        } else {
          ctx.strokeStyle = dark ? "rgba(148,163,184,0.13)" : "rgba(100,116,139,0.13)";
          ctx.lineWidth = (0.7 + Math.min(1.6, l.weight * 0.25)) / t.k;
        }
        ctx.stroke();
      }

      // Nodes — radial gradient + soft glow + ring.
      for (const n of gNodesRef.current) {
        if (n.x == null || n.y == null) continue;
        const isSel = n.id === sel;
        const isNeighbor = neighbors?.has(n.id);
        const color = typeColor(n.type);
        const dimmed = sel && !isSel && !isNeighbor;
        ctx.globalAlpha = dimmed ? 0.22 : 1;

        // glow
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = (isSel ? 20 : isNeighbor ? 10 : 5) / t.k;
        const grad = ctx.createRadialGradient(
          n.x - n.r * 0.35, n.y - n.r * 0.35, n.r * 0.15,
          n.x, n.y, n.r,
        );
        grad.addColorStop(0, lighten(color, 0.45));
        grad.addColorStop(1, color);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // ring
        ctx.lineWidth = (isSel ? 2.2 : 1) / t.k;
        ctx.strokeStyle = isSel
          ? (dark ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.85)")
          : (dark ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.6)");
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.stroke();

        if (isSel) {
          // halo
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r + 5 / t.k, 0, Math.PI * 2);
          ctx.strokeStyle = dark ? "rgba(167,139,250,0.6)" : "rgba(124,58,237,0.55)";
          ctx.lineWidth = 2 / t.k;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      // Labels — transparent background (text halo only), smaller font.
      // Label visibility is zoom-adaptive: as the user zooms in, more labels
      // appear (fewer nodes per screen pixel = less overlap); zoomed out,
      // only high-degree nodes show labels to avoid clutter. This replaces
      // the old fixed top-28 threshold which hid labels even when zoomed in.
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      const labelText = dark ? "#f4f4f5" : "#27272a";
      const halo = dark ? "rgba(9,9,11,0.85)" : "rgba(255,255,255,0.9)";
      // zoom level t.k determines how many labels to show:
      //   k < 0.8  → only top-degree nodes (threshold = top 25)
      //   k < 1.5  → moderate (threshold = top 80)
      //   k < 2.5  → most nodes (threshold = top 120)
      //   k >= 2.5 → all nodes
      const allDegrees = gNodesRef.current.map((n) => n.degree).sort((a, b) => b - a);
      let labelCount: number;
      if (t.k >= 2.5) labelCount = allDegrees.length;
      else if (t.k >= 1.5) labelCount = Math.min(120, allDegrees.length);
      else if (t.k >= 0.8) labelCount = Math.min(80, allDegrees.length);
      else labelCount = Math.min(25, allDegrees.length);
      const dynThreshold = allDegrees[Math.min(labelCount - 1, allDegrees.length - 1)] ?? Infinity;
      // Font size shrinks slightly when zoomed out so labels don't dominate.
      const fontSize = Math.max(8, Math.min(11, 10 / Math.max(0.8, t.k * 0.8)));
      ctx.font = `500 ${fontSize / t.k}px ui-sans-serif, system-ui, sans-serif`;
      for (const n of gNodesRef.current) {
        if (n.x == null || n.y == null) continue;
        // Always show labels for selected, hovered, high-degree nodes, and all
        // neighbors of the selected node — so clicking a node reveals every
        // connected entity's name without needing to zoom in.
        const isNeighborOfSelected = !!sel && !!neighbors?.has(n.id);
        const show = n.id === sel || n.id === hoverRef.current || isNeighborOfSelected || n.degree >= dynThreshold;
        if (!show) continue;
        const dimmed = sel && n.id !== sel && !neighbors?.has(n.id);
        ctx.globalAlpha = dimmed ? 0.4 : 1;
        const label = n.label.length > 18 ? n.label.slice(0, 17) + "…" : n.label;
        const tx = n.x + n.r + 4 / t.k;
        const ty = n.y;
        ctx.lineWidth = 3 / t.k;
        ctx.strokeStyle = halo;
        ctx.strokeText(label, tx, ty);
        ctx.fillStyle = labelText;
        ctx.fillText(label, tx, ty);
        ctx.globalAlpha = 1;
      }

      ctx.restore();
    };

    const loop = () => {
      if (dirty) draw();
      raf = requestAnimationFrame(loop);
    };
    const schedule = () => { dirty = true; };
    scheduleDrawRef.current = schedule;
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [selectedNodeId]);

  // Resize observer → size the canvas (DPR-aware) + recenter.
  useEffect(() => {
    const el = containerRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;
    const resize = () => {
      const r = el.getBoundingClientRect();
      // Ignore sub-pixel changes (scrollbar appear/disappear, etc.) that would
      // reset the canvas bitmap and cause a visible "jump" on every interaction.
      const prev = sizeRef.current;
      if (prev.w > 0 && Math.abs(r.width - prev.w) < 2 && Math.abs(r.height - prev.h) < 2) {
        return;
      }
      const dpr = window.devicePixelRatio || 1;
      sizeRef.current = { w: r.width, h: r.height, dpr };
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
      // Do NOT update forceCenter on resize — updating it mid-simulation
      // causes nodes to "jump" toward the new center, which the user sees
      // as a jarring snap when selecting/deselecting nodes (the detail panel
      // appearing/disappearing triggers a minor resize via scrollbar changes).
      // The center force is set once at simulation init and stays fixed.
      scheduleDrawRef.current();
    };
    const obs = new ResizeObserver(resize);
    obs.observe(el);
    resize();
    return () => obs.disconnect();
  }, []);

  // Expose zoom handle to the parent.
  useEffect(() => {
    if (!zoomRef) return;
    zoomRef.current = {
      zoomBy: (factor: number) => zoomAt(sizeRef.current.w / 2, sizeRef.current.h / 2, factor),
      zoomToFit: zoomToFitInternal,
    };
    return () => { zoomRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomRef]);

  // Pointer interactions.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
    };
    const onDown = (e: MouseEvent) => {
      const sp = toSim(e.clientX, e.clientY);
      if (!sp) return;
      const hit = nodeAt(sp.x, sp.y);
      if (hit) {
        dragNodeRef.current = hit;
        dragMovedRef.current = false;
        dragStartRef.current = { x: e.clientX, y: e.clientY };
      } else {
        panRef.current = { active: true, moved: false, x: e.clientX, y: e.clientY };
      }
    };
    const onMove = (e: MouseEvent) => {
      if (dragNodeRef.current) {
        const dx = e.clientX - dragStartRef.current.x;
        const dy = e.clientY - dragStartRef.current.y;
        if (Math.hypot(dx, dy) > 3) dragMovedRef.current = true;
        if (dragMovedRef.current) {
          const sp = toSim(e.clientX, e.clientY);
          if (!sp) return;
          const n = dragNodeRef.current;
          n.fx = sp.x; n.fy = sp.y;
          simRef.current?.alphaTarget(0.3).restart();
          scheduleDrawRef.current();
        }
        return;
      }
      if (panRef.current.active) {
        const dx = e.clientX - panRef.current.x;
        const dy = e.clientY - panRef.current.y;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
          panRef.current.moved = true;
          userInteractedRef.current = true;
        }
        transformRef.current.x += dx;
        transformRef.current.y += dy;
        panRef.current.x = e.clientX;
        panRef.current.y = e.clientY;
        scheduleDrawRef.current();
        return;
      }
      const sp = toSim(e.clientX, e.clientY);
      if (!sp) return;
      const hit = nodeAt(sp.x, sp.y);
      const id = hit?.id ?? null;
      if (id !== hoverRef.current) {
        hoverRef.current = id;
        scheduleDrawRef.current();
      }
      canvas.style.cursor = hit ? "pointer" : "grab";
    };
    const onUp = (e: MouseEvent) => {
      const wasNodeDrag = !!dragNodeRef.current;
      const moved = dragMovedRef.current || panRef.current.moved;
      if (wasNodeDrag) {
        const n = dragNodeRef.current!;
        n.fx = null; n.fy = null;
        simRef.current?.alphaTarget(0);
      }
      dragNodeRef.current = null;
      const wasPanning = panRef.current.active;
      panRef.current.active = false;
      if (!moved) {
        const sp = toSim(e.clientX, e.clientY);
        if (!sp) return;
        const hit = nodeAt(sp.x, sp.y);
        if (hit) onNodeClick(hit.id);
        else if (wasPanning) onNodeClick("");
      }
    };
    const onDbl = (e: MouseEvent) => {
      const sp = toSim(e.clientX, e.clientY);
      if (!sp) return;
      const hit = nodeAt(sp.x, sp.y);
      if (hit && onNodeDblClick) onNodeDblClick(hit.id);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    canvas.addEventListener("dblclick", onDbl);
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      canvas.removeEventListener("dblclick", onDbl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onNodeClick, onNodeDblClick]);

  const selectedNode = selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) ?? null : null;
  const visibleCount = graphData.gNodes.length;
  const totalCount = nodes.length;
  const dens = t.topology.density;

  return (
    <div
      ref={containerRef}
      className="relative bg-background border border-border rounded-2xl overflow-hidden select-none"
      style={{ minHeight: 560, cursor: "grab" }}
    >
      <canvas ref={canvasRef} className="absolute inset-0" />

      {/* Density toggle */}
      {totalCount > TOP_N && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="absolute top-3 left-3 z-20 inline-flex items-center gap-1.5 rounded-lg border border-border bg-card/90 backdrop-blur-sm px-2.5 py-1.5 text-[11px] font-medium text-foreground shadow-sm hover:bg-secondary transition-colors cursor-pointer"
          title={showAll
            ? dens.showTopTitle
            : format.template(dens.showAllTitle, { count: totalCount })}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {showAll
              ? <><path d="M4 14h6v6" /><path d="M20 10h-6V4" /><path d="M14 10l7-7" /><path d="M3 21l7-7" /></>
              : <><path d="M3 3h18v18H3z" opacity="0" /><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>}
          </svg>
          {showAll
            ? format.template(dens.allEntitiesLabel, { count: totalCount })
            : format.template(dens.topEntitiesLabel, { visible: visibleCount, total: totalCount })}
        </button>
      )}

      {/* Right-side detail panel (restored) */}
      {selectedNode && (
        <TopologyDetailPanel
          node={selectedNode}
          loading={entityDetailLoading}
          onNavigate={onNodeDblClick ? () => onNodeDblClick(selectedNode.id) : undefined}
          onClose={() => onNodeClick("")}
        />
      )}

      <div className="absolute bottom-3 left-4 text-[10px] text-muted-foreground select-none pointer-events-none z-10">
        {t.search.kgGraphHint}
      </div>
    </div>
  );
}
