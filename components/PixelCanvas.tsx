import React, { useCallback, useRef } from "react";
import { GRID_SIZE } from "@/hooks/usePixelCanvas";

interface PixelCanvasProps {
  grid: boolean[][];
  onMouseDown: (row: number, col: number) => void;
  onMouseMove: (row: number, col: number) => void;
  onMouseUp: () => void;
  disabled?: boolean;
}

const PixelCanvas: React.FC<PixelCanvasProps> = ({
  grid,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  disabled = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const CELL_SIZE = 10;
  const canvasSize = GRID_SIZE * CELL_SIZE;

  const getCell = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const scaleX = canvasSize / rect.width;
      const scaleY = canvasSize / rect.height;
      const col = Math.floor((e.clientX - rect.left) * scaleX / CELL_SIZE);
      const row = Math.floor((e.clientY - rect.top) * scaleY / CELL_SIZE);
      return { row: Math.max(0, Math.min(GRID_SIZE - 1, row)), col: Math.max(0, Math.min(GRID_SIZE - 1, col)) };
    },
    [canvasSize]
  );

  // Draw on canvas
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvasSize, canvasSize);

    // Grid lines
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= GRID_SIZE; i++) {
      ctx.beginPath();
      ctx.moveTo(i * CELL_SIZE, 0);
      ctx.lineTo(i * CELL_SIZE, canvasSize);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * CELL_SIZE);
      ctx.lineTo(canvasSize, i * CELL_SIZE);
      ctx.stroke();
    }

    // Filled pixels
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        if (grid[r][c]) {
          ctx.fillStyle = "#0b0e14";
          ctx.fillRect(c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        }
      }
    }
  }, [grid, canvasSize]);

  return (
    <canvas
      ref={canvasRef}
      width={canvasSize}
      height={canvasSize}
      className={`pixel-canvas w-full h-full max-w-[500px] max-h-[500px] aspect-square border border-border rounded-sm ${
        disabled ? "opacity-50 pointer-events-none" : "cursor-crosshair"
      }`}
      onMouseDown={(e) => {
        if (disabled) return;
        const { row, col } = getCell(e);
        onMouseDown(row, col);
      }}
      onMouseMove={(e) => {
        if (disabled) return;
        const { row, col } = getCell(e);
        onMouseMove(row, col);
      }}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    />
  );
};

export default PixelCanvas;
