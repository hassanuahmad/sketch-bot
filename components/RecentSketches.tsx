import React from "react";
import { Clock, ImageIcon, Pencil, Trash2 } from "lucide-react";

interface Sketch {
  id: string;
  name: string;
  timestamp: string;
  thumbnail?: boolean[][]; // simplified
  svgPath?: string;
}

interface RecentSketchesProps {
  sketches: Sketch[];
  onSelectSketch?: (sketch: Sketch) => void;
  onRenameSketch?: (sketchId: string, name: string) => void;
  onDeleteSketch?: (sketchId: string) => void;
}

const THUMB_SIZE = 10;

const SketchThumbnail: React.FC<{ grid?: boolean[][]; svgPath?: string }> = ({
  grid,
  svgPath,
}) => {
  if (!grid || grid.length === 0) {
    return svgPath ? (
      <img
        src={svgPath}
        alt="Sketch thumbnail"
        className="pixel-canvas rounded-sm border border-border bg-background"
        width={THUMB_SIZE * 4}
        height={THUMB_SIZE * 4}
      />
    ) : (
      <div className="pixel-canvas rounded-sm border border-border bg-muted w-[40px] h-[40px]" />
    );
  }

  const size = THUMB_SIZE;
  const cellSize = 4;
  const canvasSize = size * cellSize;

  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "hsl(220, 14%, 6%)";
    ctx.fillRect(0, 0, canvasSize, canvasSize);

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        // Sample from the grid
        const gr = Math.floor((r / size) * grid.length);
        const gc = Math.floor((c / size) * (grid[0]?.length || 0));
        if (grid[gr]?.[gc]) {
          ctx.fillStyle = "hsl(210, 20%, 92%)";
          ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
        }
      }
    }
  }, [grid, canvasSize, size]);

  return (
    <canvas
      ref={canvasRef}
      width={canvasSize}
      height={canvasSize}
      className="pixel-canvas rounded-sm border border-border"
    />
  );
};

const RecentSketches: React.FC<RecentSketchesProps> = ({
  sketches,
  onSelectSketch,
  onRenameSketch,
  onDeleteSketch,
}) => {
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draftName, setDraftName] = React.useState("");

  const beginEdit = React.useCallback((sketch: Sketch) => {
    setEditingId(sketch.id);
    setDraftName(sketch.name);
  }, []);

  const cancelEdit = React.useCallback(() => {
    setEditingId(null);
    setDraftName("");
  }, []);

  const commitEdit = React.useCallback(() => {
    if (!editingId) return;
    const name = draftName.trim();
    if (!name) return;
    onRenameSketch?.(editingId, name);
    setEditingId(null);
    setDraftName("");
  }, [draftName, editingId, onRenameSketch]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Logo */}
      <div className="flex items-center gap-3 px-0 py-0">
        <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center shrink-0">
          <span className="text-primary-foreground font-bold text-sm font-mono">
            SP
          </span>
        </div>
        <span className="text-base font-semibold text-foreground tracking-tight">
          SketchPro
        </span>
      </div>

      {/* Recent Sketches Section */}
      <div className="flex flex-col flex-1 bg-card border border-border rounded-lg overflow-hidden mt-3">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Clock className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            Recent Sketches
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {sketches.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <ImageIcon className="w-8 h-8 mb-2 opacity-50" />
              <span className="text-xs">No sketches yet</span>
            </div>
          ) : (
            sketches.map((sketch) => (
              <div
                key={sketch.id}
                className="flex items-center gap-2 w-full p-2 rounded-md hover:bg-secondary transition-colors"
              >
                <button
                  type="button"
                  onClick={() => onSelectSketch?.(sketch)}
                  className="flex items-center gap-4 flex-1 min-w-0 text-left"
                >
                  <SketchThumbnail
                    grid={sketch.thumbnail}
                    svgPath={sketch.svgPath}
                  />
                  <div className="flex-1 min-w-0 text-left">
                    {editingId === sketch.id ? (
                      <input
                        value={draftName}
                        onChange={(event) => setDraftName(event.target.value)}
                        onBlur={commitEdit}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            commitEdit();
                          }
                          if (event.key === "Escape") {
                            event.preventDefault();
                            cancelEdit();
                          }
                        }}
                        className="w-full rounded-sm bg-background border border-border px-2 py-1 text-sm font-medium text-foreground"
                        autoFocus
                      />
                    ) : (
                      <p className="text-sm font-medium text-foreground truncate">
                        {sketch.name}
                      </p>
                    )}
                    <p className="text-[10px] font-mono text-muted-foreground">
                      {sketch.timestamp}
                    </p>
                  </div>
                </button>
                <button
                  type="button"
                  aria-label="Edit sketch name"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (editingId === sketch.id) {
                      commitEdit();
                    } else {
                      beginEdit(sketch);
                    }
                  }}
                  className="ml-auto inline-flex items-center justify-center rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-secondary"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Delete sketch"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteSketch?.(sketch.id);
                  }}
                  className="inline-flex items-center justify-center rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-secondary"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default RecentSketches;
export type { Sketch };
