import { useState, useCallback, useRef } from "react";

export type Tool = "brush" | "eraser" | "rectangle" | "circle" | "fill" | "line";

interface UsePixelCanvasReturn {
  grid: boolean[][];
  tool: Tool;
  setTool: (tool: Tool) => void;
  handleMouseDown: (row: number, col: number) => void;
  handleMouseMove: (row: number, col: number) => void;
  handleMouseUp: () => void;
  clearCanvas: () => void;
  setGrid: React.Dispatch<React.SetStateAction<boolean[][]>>;
}

const GRID_SIZE = 50;

const createEmptyGrid = (): boolean[][] =>
  Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(false));

export const usePixelCanvas = (): UsePixelCanvasReturn => {
  const [grid, setGrid] = useState<boolean[][]>(createEmptyGrid);
  const [tool, setTool] = useState<Tool>("brush");
  const isDrawing = useRef(false);
  const startPos = useRef<{ row: number; col: number } | null>(null);
  const previewGrid = useRef<boolean[][] | null>(null);

  const setPixel = useCallback(
    (row: number, col: number, value: boolean) => {
      setGrid((prev) => {
        const next = prev.map((r) => [...r]);
        if (row >= 0 && row < GRID_SIZE && col >= 0 && col < GRID_SIZE) {
          next[row][col] = value;
        }
        return next;
      });
    },
    []
  );

  const drawLine = useCallback(
    (r0: number, c0: number, r1: number, c1: number, value: boolean, targetGrid: boolean[][]) => {
      const dr = Math.abs(r1 - r0);
      const dc = Math.abs(c1 - c0);
      const sr = r0 < r1 ? 1 : -1;
      const sc = c0 < c1 ? 1 : -1;
      let err = dr - dc;
      let r = r0;
      let c = c0;

      while (true) {
        if (r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE) {
          targetGrid[r][c] = value;
        }
        if (r === r1 && c === c1) break;
        const e2 = 2 * err;
        if (e2 > -dc) { err -= dc; r += sr; }
        if (e2 < dr) { err += dr; c += sc; }
      }
      return targetGrid;
    },
    []
  );

  const drawRectangle = useCallback(
    (r0: number, c0: number, r1: number, c1: number, value: boolean, targetGrid: boolean[][]) => {
      const minR = Math.min(r0, r1);
      const maxR = Math.max(r0, r1);
      const minC = Math.min(c0, c1);
      const maxC = Math.max(c0, c1);

      for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
          if (r === minR || r === maxR || c === minC || c === maxC) {
            if (r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE) {
              targetGrid[r][c] = value;
            }
          }
        }
      }
      return targetGrid;
    },
    []
  );

  const drawCircle = useCallback(
    (r0: number, c0: number, r1: number, c1: number, value: boolean, targetGrid: boolean[][]) => {
      const centerR = Math.round((r0 + r1) / 2);
      const centerC = Math.round((c0 + c1) / 2);
      const radiusR = Math.abs(r1 - r0) / 2;
      const radiusC = Math.abs(c1 - c0) / 2;
      const radius = Math.max(radiusR, radiusC);

      for (let angle = 0; angle < 360; angle += 1) {
        const rad = (angle * Math.PI) / 180;
        const r = Math.round(centerR + radius * Math.sin(rad));
        const c = Math.round(centerC + radius * Math.cos(rad));
        if (r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE) {
          targetGrid[r][c] = value;
        }
      }
      return targetGrid;
    },
    []
  );

  const floodFill = useCallback(
    (row: number, col: number, targetValue: boolean, newValue: boolean) => {
      setGrid((prev) => {
        const next = prev.map((r) => [...r]);
        if (next[row][col] !== targetValue || targetValue === newValue) return prev;

        const stack: [number, number][] = [[row, col]];
        while (stack.length > 0) {
          const [r, c] = stack.pop()!;
          if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) continue;
          if (next[r][c] !== targetValue) continue;
          next[r][c] = newValue;
          stack.push([r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]);
        }
        return next;
      });
    },
    []
  );

  const handleMouseDown = useCallback(
    (row: number, col: number) => {
      isDrawing.current = true;
      startPos.current = { row, col };

      if (tool === "brush") {
        setPixel(row, col, true);
      } else if (tool === "eraser") {
        setPixel(row, col, false);
      } else if (tool === "fill") {
        setGrid((prev) => {
          const targetValue = prev[row][col];
          floodFill(row, col, targetValue, !targetValue);
          return prev;
        });
      }

      if (tool === "rectangle" || tool === "circle" || tool === "line") {
        setGrid((prev) => {
          previewGrid.current = prev.map((r) => [...r]);
          return prev;
        });
      }
    },
    [tool, setPixel, floodFill]
  );

  const handleMouseMove = useCallback(
    (row: number, col: number) => {
      if (!isDrawing.current) return;

      if (tool === "brush") {
        setPixel(row, col, true);
      } else if (tool === "eraser") {
        setPixel(row, col, false);
      } else if (startPos.current && previewGrid.current) {
        const { row: r0, col: c0 } = startPos.current;
        let next = previewGrid.current.map((r) => [...r]);

        if (tool === "rectangle") {
          next = drawRectangle(r0, c0, row, col, true, next);
        } else if (tool === "circle") {
          next = drawCircle(r0, c0, row, col, true, next);
        } else if (tool === "line") {
          next = drawLine(r0, c0, row, col, true, next);
        }
        setGrid(next);
      }
    },
    [tool, setPixel, drawRectangle, drawCircle, drawLine]
  );

  const handleMouseUp = useCallback(() => {
    isDrawing.current = false;
    startPos.current = null;
    previewGrid.current = null;
  }, []);

  const clearCanvas = useCallback(() => {
    setGrid(createEmptyGrid());
  }, []);

  return {
    grid,
    tool,
    setTool,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    clearCanvas,
    setGrid,
  };
};

export { GRID_SIZE, createEmptyGrid };
