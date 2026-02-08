"use client";

import React, { useState, useCallback, useEffect } from "react";
import { Monitor, Eye, Send, Plus } from "lucide-react";
import ConnectionStatus from "@/components/ConnectionStatus";
import PixelCanvas from "@/components/PixelCanvas";
import Toolbar from "@/components/Toolbar";
import ChatPanel from "@/components/ChatPanel";
import RecentSketches, { type Sketch } from "@/components/RecentSketches";
import POVView from "@/components/POVView";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePixelCanvas } from "@/hooks/usePixelCanvas";
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
  const [isConnected, setIsConnected] = useState(false);
  const [carName, setCarName] = useState("Car 1");
  const wsRef = React.useRef<WebSocket | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [sketches, setSketches] = useState<Sketch[]>([]);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [sketchName, setSketchName] = useState("");
  const [activeSketchId, setActiveSketchId] = useState<string | null>(null);
  const [povFrame, setPovFrame] = useState<string | null>(null);

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

  useEffect(() => {
    const wsUrl =
      process.env.NEXT_PUBLIC_WS_URL ||
      `ws://${window.location.hostname}:3001`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({ type: "register", role: "ui", client: "web" }),
      );
    });

    ws.addEventListener("message", (event) => {
      let data: any;
      try {
        data = JSON.parse(String(event.data));
      } catch {
        return;
      }

      if (data.type === "status") {
        setIsConnected(Boolean(data.carOnline));
        if (data.carName) {
          const name = String(data.carName);
          setCarName(name === "ESP32" ? "Car 1" : name);
        }
        return;
      }

      if (data.type === "vision_frame" && data.data) {
        const format = data.format || "jpeg";
        setPovFrame(`data:image/${format};base64,${data.data}`);
        return;
      }
    });

    ws.addEventListener("close", () => {
      setIsConnected(false);
    });

    ws.addEventListener("error", () => {
      setIsConnected(false);
    });

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, []);

  const isDrawingMode = activeTab === "canvas" && !isSubmitting;

  const saveSketch = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      const resolvedName = trimmed || `Sketch ${sketches.length + 1}`;
      try {
        const svg = gridToSvg(grid);
        const response = await fetch("/api/sketches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: resolvedName, svg }),
        });
        if (!response.ok) {
          console.error("Failed to save sketch", await response.text());
          return false;
        }
        await loadSketches();
        return true;
      } catch (error) {
        console.error("Error saving sketch", error);
        return false;
      }
    },
    [grid, sketches.length, loadSketches],
  );

  const handleOpenSaveDialog = useCallback(() => {
    setSketchName(
      activeSketchId ? sketchName : `Sketch ${sketches.length + 1}`,
    );
    setIsSaveDialogOpen(true);
  }, [activeSketchId, sketchName, sketches.length]);

  const handleSaveOnly = useCallback(async () => {
    if (isSaving || isSubmitting) return;
    setIsSaving(true);
    const ok = await saveSketch(sketchName);
    setIsSaving(false);
    if (ok) setIsSaveDialogOpen(false);
  }, [isSaving, isSubmitting, saveSketch, sketchName]);

  const sendSketchToRobot = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type: "sketch", sketch: grid }));
    return true;
  }, [grid]);

  const handleSaveAndSubmit = useCallback(async () => {
    if (isSaving || isSubmitting) return;
    setIsSubmitting(true);
    setIsSaving(true);
    const ok = await saveSketch(sketchName);
    setIsSaving(false);
    if (!ok) {
      setIsSubmitting(false);
      return;
    }
    sendSketchToRobot();
    setIsSaveDialogOpen(false);
    // Switch to POV tab
    setTimeout(() => {
      setActiveTab("pov");
      setIsSubmitting(false);
    }, 500);
  }, [isSaving, isSubmitting, saveSketch, sketchName, sendSketchToRobot]);

  const handleSendToRobot = useCallback(() => {
    if (isSubmitting || isSaving) return;
    setIsSubmitting(true);
    const ok = sendSketchToRobot();
    setTimeout(() => {
      setActiveTab("pov");
      setIsSubmitting(false);
    }, ok ? 300 : 500);
  }, [isSubmitting, isSaving, sendSketchToRobot]);

  const handleNewSketch = useCallback(() => {
    clearCanvas();
    setActiveTab("canvas");
    setActiveSketchId(null);
    setSketchName(`Sketch ${sketches.length + 1}`);
  }, [clearCanvas, sketches.length]);

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
        setActiveSketchId(sketch.id);
        setSketchName(sketch.name);
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
          <ConnectionStatus isConnected={isConnected} carName={carName} />

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

          {/* Save / Submit */}
          <button
            onClick={handleOpenSaveDialog}
            disabled={activeTab === "pov" || isSubmitting || isSaving}
            className={`hidden lg:flex items-center gap-2 px-5 py-2 rounded-lg font-semibold text-sm transition-all ml-auto ${
              activeTab === "pov" || isSubmitting || isSaving
                ? "bg-muted text-muted-foreground cursor-not-allowed"
                : "bg-primary text-primary-foreground hover:opacity-90 glow-green"
            }`}
          >
            <Send className="w-4 h-4" />
            {isSubmitting ? "Sending..." : "Save / Send"}
          </button>
          <Button
            variant="outline"
            className="hidden lg:flex items-center justify-center ml-0 px-3"
            onClick={handleNewSketch}
            disabled={isSubmitting || isSaving}
            aria-label="New sketch"
          >
            <Plus className="w-4 h-4" />
          </Button>
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
              <POVView isActive={activeTab === "pov"} frameSrc={povFrame} />
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
        <div className="lg:hidden flex gap-2">
          <button
            onClick={handleOpenSaveDialog}
            disabled={activeTab === "pov" || isSubmitting || isSaving}
            className={`flex-1 py-3 px-4 rounded-lg font-semibold text-sm transition-all ${
              activeTab === "pov" || isSubmitting || isSaving
                ? "bg-muted text-muted-foreground cursor-not-allowed"
                : "bg-primary text-primary-foreground glow-green"
            }`}
          >
            {isSubmitting ? "Sending..." : "Save / Send"}
          </button>
          <Button
            variant="outline"
            className="px-3"
            onClick={handleNewSketch}
            disabled={isSubmitting || isSaving}
            aria-label="New sketch"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </main>

      <Dialog open={isSaveDialogOpen} onOpenChange={setIsSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save sketch</DialogTitle>
            <DialogDescription>
              Name your sketch, then choose how to proceed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label
              className="text-sm font-medium text-foreground"
              htmlFor="sketch-name"
            >
              Sketch name
            </label>
            <Input
              id="sketch-name"
              value={sketchName}
              onChange={(event) => setSketchName(event.target.value)}
              placeholder="Sketch name"
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            {activeSketchId ? (
              <>
                <Button
                  variant="outline"
                  onClick={handleSaveOnly}
                  disabled={isSaving || isSubmitting}
                >
                  {isSaving ? "Saving..." : "Save as New"}
                </Button>
                <Button
                  onClick={handleSendToRobot}
                  disabled={isSaving || isSubmitting}
                >
                  {isSubmitting ? "Sending..." : "Submit to Robot"}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={handleSaveOnly}
                  disabled={isSaving || isSubmitting}
                >
                  {isSaving ? "Saving..." : "Save"}
                </Button>
                <Button
                  onClick={handleSaveAndSubmit}
                  disabled={isSaving || isSubmitting}
                >
                  {isSubmitting ? "Sending..." : "Save & Submit"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Index;
