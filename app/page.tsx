"use client";

import React, { useState, useCallback, useEffect } from "react";
import { Monitor, Eye, Send } from "lucide-react";
import ConnectionStatus from "@/components/ConnectionStatus";
import PixelCanvas from "@/components/PixelCanvas";
import Toolbar from "@/components/Toolbar";
import ChatPanel from "@/components/ChatPanel";
import RecentSketches, { type Sketch } from "@/components/RecentSketches";
import POVView from "@/components/POVView";
import {
  usePixelCanvas,
} from "@/hooks/usePixelCanvas";
import { gridToSvg } from "@/lib/svg";

type SketchResponse = {
  id: string;
  name: string;
  svgPath: string;
  createdAt: string;
  ageSeconds?: number;
};

function createGrid(rows: number, cols: number) {
  return Array.from({ length: rows }, () => Array(cols).fill(false));
}

function formatAge(seconds?: number) {
  if (seconds === undefined) return "Just now";
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}

function svgToGrid(svgText: string): boolean[][] | null {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, "image/svg+xml");
    const svg = doc.querySelector("svg");
    if (!svg) return null;

    const cellSizeAttr = svg.getAttribute("data-cell-size");
    const rowsAttr = svg.getAttribute("data-rows");
    const colsAttr = svg.getAttribute("data-cols");

    let cellSize = cellSizeAttr ? Number(cellSizeAttr) : 0;
    let rows = rowsAttr ? Number(rowsAttr) : 0;
    let cols = colsAttr ? Number(colsAttr) : 0;

    const rects = Array.from(svg.querySelectorAll("g rect, rect"));
    if (!cellSize) {
      const firstRect = rects.find(
        (rect) => rect.getAttribute("width") && rect.getAttribute("height"),
      );
      if (firstRect) {
        cellSize = Number(firstRect.getAttribute("width")) || 0;
      }
    }

    if (!rows || !cols) {
      const viewBox = svg.getAttribute("viewBox");
      if (viewBox) {
        const parts = viewBox.split(/\s+/).map(Number);
        const width = parts[2] || 0;
        const height = parts[3] || 0;
        if (cellSize) {
          cols = cols || Math.round(width / cellSize);
          rows = rows || Math.round(height / cellSize);
        }
      }
    }

    if (!rows || !cols || !cellSize) return null;

    const grid = createGrid(rows, cols);
    for (const rect of rects) {
      const width = rect.getAttribute("width");
      const height = rect.getAttribute("height");
      if (width === "100%" || height === "100%") continue;
      const x = Number(rect.getAttribute("x") || "0");
      const y = Number(rect.getAttribute("y") || "0");
      const c = Math.round(x / cellSize);
      const r = Math.round(y / cellSize);
      if (r >= 0 && r < rows && c >= 0 && c < cols) {
        grid[r][c] = true;
      }
    }

    return grid;
  } catch {
    return null;
  }
}

const Index: React.FC = () => {
  const {
    grid,
    tool,
    setTool,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    clearCanvas,
    setGrid,
  } = usePixelCanvas();

  const [activeTab, setActiveTab] = useState<"canvas" | "pov">("canvas");
  const [isConnected] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [sketches, setSketches] = useState<Sketch[]>([]);

  const loadSketches = useCallback(async () => {
    try {
      const response = await fetch("/api/sketches");
      if (!response.ok) {
        console.error("Failed to load sketches", await response.text());
        return;
      }
      const data = (await response.json()) as { sketches: SketchResponse[] };
      const normalized: Sketch[] = (data.sketches || []).map((item) => ({
        id: item.id,
        name: item.name,
        timestamp: formatAge(item.ageSeconds),
        svgPath: item.svgPath,
      }));
      setSketches(normalized);
    } catch (error) {
      console.error("Error loading sketches", error);
    }
  }, []);

  useEffect(() => {
    void loadSketches();
  }, [loadSketches]);

  const isDrawingMode = activeTab === "canvas" && !isSubmitting;

  const handleSubmit = useCallback(async () => {
    setIsSubmitting(true);

    const newSketchName = `Sketch ${sketches.length + 1}`;

    try {
      const svg = gridToSvg(grid);
      const response = await fetch("/api/sketches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newSketchName, svg }),
      });
      if (!response.ok) {
        console.error("Failed to save sketch", await response.text());
      } else {
        await loadSketches();
      }
    } catch (error) {
      console.error("Error saving sketch", error);
    }

    // Switch to POV tab
    setTimeout(() => {
      setActiveTab("pov");
      setIsSubmitting(false);
    }, 500);
  }, [grid, sketches.length, loadSketches]);

  const handleRenameSketch = useCallback(
    async (sketchId: string, name: string) => {
      setSketches((prev) =>
        prev.map((sketch) =>
          sketch.id === sketchId ? { ...sketch, name } : sketch,
        ),
      );
      try {
        const response = await fetch(`/api/sketches/${sketchId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        if (!response.ok) {
          console.error("Failed to rename sketch", await response.text());
          await loadSketches();
        }
      } catch (error) {
        console.error("Error renaming sketch", error);
        await loadSketches();
      }
    },
    [loadSketches],
  );

  const handleDeleteSketch = useCallback(
    async (sketchId: string) => {
      setSketches((prev) => prev.filter((sketch) => sketch.id !== sketchId));
      try {
        const response = await fetch(`/api/sketches/${sketchId}`, {
          method: "DELETE",
        });
        if (!response.ok) {
          console.error("Failed to delete sketch", await response.text());
          await loadSketches();
        }
      } catch (error) {
        console.error("Error deleting sketch", error);
        await loadSketches();
      }
    },
    [loadSketches],
  );

  const handleSelectSketch = useCallback(
    async (sketch: Sketch) => {
      if (activeTab === "pov") return;
      if (sketch.thumbnail) {
        setGrid(sketch.thumbnail.map((r) => [...r]));
        return;
      }
      if (!sketch.svgPath) return;
      try {
        const response = await fetch(sketch.svgPath);
        if (!response.ok) {
          console.error("Failed to load sketch SVG", await response.text());
          return;
        }
        const svgText = await response.text();
        const parsedGrid = svgToGrid(svgText);
        if (parsedGrid) {
          setGrid(parsedGrid);
        }
      } catch (error) {
        console.error("Error loading sketch SVG", error);
      }
    },
    [activeTab, setGrid],
  );

  const handleGenerateDesign = useCallback(
    async (prompt: string) => {
      setIsGenerating(true);
      try {
        const response = await fetch("/api/design", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt }),
        });
        if (!response.ok) {
          const detail = await response.text();
          throw new Error(detail || "Design request failed");
        }
        const data = (await response.json()) as {
          grid?: boolean[][];
          caption?: string;
        };
        if (!data.grid) throw new Error("Missing grid in response");
        setGrid(data.grid);
        return data.caption || "Done. The design is on the canvas.";
      } finally {
        setIsGenerating(false);
      }
    },
    [setGrid],
  );

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Left Sidebar - Recent Sketches */}
      <aside className="w-80 shrink-0 p-3 border-r border-border hidden lg:flex flex-col">
        <RecentSketches
          sketches={sketches}
          onSelectSketch={handleSelectSketch}
          onRenameSketch={handleRenameSketch}
          onDeleteSketch={handleDeleteSketch}
        />
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 p-4 gap-3">
        {/* Top Bar: Connection Status */}
        <div className="flex items-center gap-4 flex-wrap">
          <ConnectionStatus isConnected={isConnected} />

          {/* Tabs */}
          <div className="flex items-center bg-card border border-border rounded-lg overflow-hidden mx-auto">
            <button
              onClick={() => setActiveTab("canvas")}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-all ${
                activeTab === "canvas"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Monitor className="w-4 h-4" />
              Canvas
            </button>
            <button
              onClick={() => setActiveTab("pov")}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-all ${
                activeTab === "pov"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Eye className="w-4 h-4" />
              POV
            </button>
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={activeTab === "pov" || isSubmitting}
            className={`hidden lg:flex items-center gap-2 px-5 py-2 rounded-lg font-semibold text-sm transition-all ml-auto ${
              activeTab === "pov" || isSubmitting
                ? "bg-muted text-muted-foreground cursor-not-allowed"
                : "bg-primary text-primary-foreground hover:opacity-90 glow-green"
            }`}
          >
            <Send className="w-4 h-4" />
            {isSubmitting ? "Sending..." : "Submit to Robot"}
          </button>
        </div>

        {/* Canvas / POV Area */}
        <div className="flex-1 flex gap-3 min-h-0">
          <div className="flex-1 flex items-center justify-center">
            {activeTab === "canvas" ? (
              <PixelCanvas
                grid={grid}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                disabled={!isDrawingMode}
              />
            ) : (
              <POVView isActive={activeTab === "pov"} />
            )}
          </div>

          {/* Right Toolbar */}
          <div className="shrink-0">
            <Toolbar
              activeTool={tool}
              onToolChange={setTool}
              onClear={clearCanvas}
              disabled={!isDrawingMode}
            />
          </div>
        </div>

        {/* Chat Panel */}
        <ChatPanel
          disabled={activeTab === "pov" || isGenerating}
          onGenerateDesign={handleGenerateDesign}
        />

        {/* Mobile Submit Button */}
        <button
          onClick={handleSubmit}
          disabled={activeTab === "pov" || isSubmitting}
          className={`lg:hidden w-full py-3 px-4 rounded-lg font-semibold text-sm transition-all ${
            activeTab === "pov" || isSubmitting
              ? "bg-muted text-muted-foreground cursor-not-allowed"
              : "bg-primary text-primary-foreground glow-green"
          }`}
        >
          {isSubmitting ? "Sending..." : "Submit to Robot"}
        </button>
      </main>
    </div>
  );
};

export default Index;
