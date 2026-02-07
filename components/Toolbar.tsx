import React from "react";
import {
  Paintbrush,
  Eraser,
  Square,
  Circle,
  PaintBucket,
  Minus,
  Trash2,
} from "lucide-react";
import { type Tool } from "@/hooks/usePixelCanvas";

interface ToolbarProps {
  activeTool: Tool;
  onToolChange: (tool: Tool) => void;
  onClear: () => void;
  disabled?: boolean;
}

const tools: { id: Tool; label: string; icon: React.ElementType }[] = [
  { id: "brush", label: "Brush", icon: Paintbrush },
  { id: "eraser", label: "Eraser", icon: Eraser },
  { id: "rectangle", label: "Rectangle", icon: Square },
  { id: "circle", label: "Circle", icon: Circle },
  { id: "line", label: "Line", icon: Minus },
  { id: "fill", label: "Fill", icon: PaintBucket },
];

const Toolbar: React.FC<ToolbarProps> = ({
  activeTool,
  onToolChange,
  onClear,
  disabled = false,
}) => {
  return (
    <div className={`flex flex-col gap-2 p-3 bg-toolbar-bg border border-border rounded-lg ${disabled ? "opacity-50 pointer-events-none" : ""}`}>
      <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider mb-1">
        Tools
      </span>
      {tools.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => onToolChange(id)}
          className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all border ${
            activeTool === id
              ? "tool-active border-primary"
              : "border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary"
          }`}
          title={label}
        >
          <Icon className="w-4 h-4" />
          <span className="hidden xl:inline">{label}</span>
        </button>
      ))}

      <div className="border-t border-border my-2" />

      <button
        onClick={onClear}
        className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-destructive hover:bg-destructive/10 transition-all border border-transparent"
        title="Clear Canvas"
      >
        <Trash2 className="w-4 h-4" />
        <span className="hidden xl:inline">Clear</span>
      </button>
    </div>
  );
};

export default Toolbar;
