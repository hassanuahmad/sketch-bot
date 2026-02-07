"use client";

import React, { useState, useCallback } from "react";
import { Monitor, Eye, Send } from "lucide-react";
import ConnectionStatus from "@/components/ConnectionStatus";
import PixelCanvas from "@/components/PixelCanvas";
import Toolbar from "@/components/Toolbar";
import ChatPanel from "@/components/ChatPanel";
import RecentSketches, { type Sketch } from "@/components/RecentSketches";
import POVView from "@/components/POVView";
import {
  usePixelCanvas,
  GRID_SIZE,
  createEmptyGrid,
} from "@/hooks/usePixelCanvas";

const MOCK_SKETCHES: Sketch[] = [
  {
    id: "1",
    name: "Heart Shape",
    timestamp: "2 min ago",
    thumbnail: createMockGrid("heart"),
  },
  {
    id: "2",
    name: "Star Pattern",
    timestamp: "15 min ago",
    thumbnail: createMockGrid("star"),
  },
  {
    id: "3",
    name: "Robot Face",
    timestamp: "1 hr ago",
    thumbnail: createMockGrid("face"),
  },
];

function createMockGrid(type: string): boolean[][] {
  const grid = Array.from({ length: GRID_SIZE }, () =>
    Array(GRID_SIZE).fill(false),
  );
  const cx = 25;
  const cy = 25;

  if (type === "heart") {
    for (let i = -8; i <= 8; i++) {
      for (let j = -8; j <= 8; j++) {
        const x = i / 8;
        const y = j / 8;
        if ((x * x + y * y - 1) ** 3 - x * x * y * y * y <= 0) {
          const r = cy + j;
          const c = cx + i;
          if (r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE) {
            grid[r][c] = true;
          }
        }
      }
    }
  } else if (type === "star") {
    for (let angle = 0; angle < 360; angle += 1) {
      const rad = (angle * Math.PI) / 180;
      const r = angle % 72 < 36 ? 10 : 5;
      const px = Math.round(cx + r * Math.cos(rad));
      const py = Math.round(cy + r * Math.sin(rad));
      if (px >= 0 && px < GRID_SIZE && py >= 0 && py < GRID_SIZE) {
        grid[py][px] = true;
      }
    }
  } else if (type === "face") {
    // Simple smiley
    for (let angle = 0; angle < 360; angle += 2) {
      const rad = (angle * Math.PI) / 180;
      const px = Math.round(cx + 10 * Math.cos(rad));
      const py = Math.round(cy + 10 * Math.sin(rad));
      if (px >= 0 && px < GRID_SIZE && py >= 0 && py < GRID_SIZE) {
        grid[py][px] = true;
      }
    }
    // Eyes
    grid[22][21] = true;
    grid[22][29] = true;
    // Mouth
    for (let i = -4; i <= 4; i++) {
      const r = 28 + Math.round(Math.abs(i) * 0.3);
      const c = cx + i;
      if (r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE) {
        grid[r][c] = true;
      }
    }
  }
  return grid;
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
  const [sketches, setSketches] = useState<Sketch[]>(MOCK_SKETCHES);

  const isDrawingMode = activeTab === "canvas" && !isSubmitting;

  const handleSubmit = useCallback(() => {
    setIsSubmitting(true);

    // Save current sketch
    const newSketch: Sketch = {
      id: Date.now().toString(),
      name: `Sketch ${sketches.length + 1}`,
      timestamp: "Just now",
      thumbnail: grid.map((r) => [...r]),
    };
    setSketches((prev) => [newSketch, ...prev]);

    // Switch to POV tab
    setTimeout(() => {
      setActiveTab("pov");
      setIsSubmitting(false);
    }, 500);
  }, [grid, sketches.length]);

  const handleSelectSketch = useCallback(
    (sketch: Sketch) => {
      if (activeTab === "pov") return;
      setGrid(sketch.thumbnail.map((r) => [...r]));
    },
    [activeTab, setGrid],
  );

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Left Sidebar - Recent Sketches */}
      <aside className="w-64 shrink-0 p-3 border-r border-border hidden lg:flex flex-col">
        <RecentSketches
          sketches={sketches}
          onSelectSketch={handleSelectSketch}
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
        <ChatPanel disabled={activeTab === "pov"} />

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
