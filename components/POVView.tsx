import React from "react";
import { Camera, Loader2 } from "lucide-react";

interface POVViewProps {
  isActive: boolean;
}

const POVView: React.FC<POVViewProps> = ({ isActive }) => {
  if (!isActive) return null;

  return (
    <div className="flex flex-col items-center justify-center w-full max-w-[500px] aspect-square bg-canvas-bg border border-border rounded-sm relative overflow-hidden">
      {/* Scanline overlay */}
      <div className="absolute inset-0 pointer-events-none opacity-10" style={{
        backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, hsl(210, 20%, 92%) 2px, hsl(210, 20%, 92%) 3px)",
      }} />

      <div className="flex flex-col items-center gap-4 text-muted-foreground z-10">
        <div className="relative">
          <Camera className="w-12 h-12" />
          <Loader2 className="w-5 h-5 absolute -bottom-1 -right-1 animate-spin text-primary" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">Robot Camera Feed</p>
          <p className="text-xs font-mono text-muted-foreground mt-1">
            Waiting for video stream...
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-secondary rounded-full">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse-slow" />
          <span className="text-[10px] font-mono uppercase tracking-wider text-primary">
            Drawing in progress
          </span>
        </div>
      </div>

      {/* Corner markers */}
      <div className="absolute top-2 left-2 w-4 h-4 border-l-2 border-t-2 border-primary/40" />
      <div className="absolute top-2 right-2 w-4 h-4 border-r-2 border-t-2 border-primary/40" />
      <div className="absolute bottom-2 left-2 w-4 h-4 border-l-2 border-b-2 border-primary/40" />
      <div className="absolute bottom-2 right-2 w-4 h-4 border-r-2 border-b-2 border-primary/40" />
    </div>
  );
};

export default POVView;
