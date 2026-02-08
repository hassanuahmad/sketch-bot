type SvgOptions = {
  cellSize?: number;
  onColor?: string;
  offColor?: string;
  padding?: number;
};

export function gridToSvg(
  grid: boolean[][],
  options: SvgOptions = {},
): string {
  const cellSize = options.cellSize ?? 10;
  const onColor = options.onColor ?? "#111";
  const offColor = options.offColor ?? "#fff";
  const padding = options.padding ?? 0;

  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const width = cols * cellSize + padding * 2;
  const height = rows * cellSize + padding * 2;

  const rects: string[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (!grid[r]?.[c]) continue;
      const x = c * cellSize + padding;
      const y = r * cellSize + padding;
      rects.push(
        `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" />`,
      );
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg"`,
    ` width="${width}" height="${height}"`,
    ` viewBox="0 0 ${width} ${height}"`,
    ` shape-rendering="crispEdges"`,
    ` data-cell-size="${cellSize}"`,
    ` data-rows="${rows}"`,
    ` data-cols="${cols}">`,
    `<rect width="100%" height="100%" fill="${offColor}" />`,
    `<g fill="${onColor}">`,
    rects.join(""),
    `</g>`,
    `</svg>`,
  ].join("");
}
