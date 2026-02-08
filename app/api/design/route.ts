import { NextResponse } from "next/server";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const GRID_SIZE = 50;

type PixelGridResponse = {
  rows: number;
  cols: number;
  grid: number[][];
  caption?: string;
};

function normalizeGrid(
  input: Array<Array<number | string | boolean>>,
): boolean[][] {
  const normalized: boolean[][] = Array.from({ length: GRID_SIZE }, () =>
    Array(GRID_SIZE).fill(false),
  );

  for (let r = 0; r < Math.min(GRID_SIZE, input.length); r += 1) {
    const row = input[r] || [];
    for (let c = 0; c < Math.min(GRID_SIZE, row.length); c += 1) {
      const value = row[c];
      const numeric = Number(value);
      normalized[r][c] = Number.isFinite(numeric)
        ? numeric === 1
        : value === true;
    }
  }

  return normalized;
}

function hasAnyPixels(grid: boolean[][]): boolean {
  for (const row of grid) {
    if (row.some(Boolean)) return true;
  }
  return false;
}

function extractGeminiJson(data: any): PixelGridResponse | null {
  const text =
    data?.candidates?.[0]?.content?.parts?.find(
      (part: any) => typeof part?.text === "string",
    )?.text || "";
  if (!text) return null;
  try {
    return JSON.parse(text) as PixelGridResponse;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as PixelGridResponse;
    } catch {
      return null;
    }
  }
}

export async function POST(req: Request) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing GEMINI_API_KEY" },
      { status: 500 },
    );
  }

  let body: { prompt?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const prompt = body.prompt?.trim();
  if (!prompt) {
    return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
  }

  const system =
    "You generate 50x50 pixel art for a single subject. " +
    "Return ONLY the outline (no filled areas). " +
    "The outline should be a single-pixel stroke where possible, centered. " +
    "Use 1 for outline pixels and 0 for empty. Avoid tiny scattered pixels. " +
    "Ensure at least 120 outline pixels. Keep the subject recognizable at 50x50. " +
    "Respond with ONLY valid JSON (no markdown, no code fences).";

  const response = await fetch(
    `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: system }],
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text:
                  "Return JSON with shape {rows, cols, grid, caption}. " +
                  "rows and cols must both be 50. " +
                  "grid is a 50x50 array of 0 or 1. " +
                  "caption is a short sentence. " +
                  `Prompt: ${prompt}`,
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
        },
      }),
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    return NextResponse.json(
      { error: "Gemini request failed", detail },
      { status: 502 },
    );
  }

  const data = await response.json();
  const parsed = extractGeminiJson(data);
  if (!parsed || !Array.isArray(parsed.grid)) {
    return NextResponse.json(
      { error: "Gemini response did not include a valid grid" },
      { status: 502 },
    );
  }

  const normalized = normalizeGrid(
    parsed.grid as Array<Array<number | string | boolean>>,
  );
  if (!hasAnyPixels(normalized)) {
    return NextResponse.json(
      { error: "Gemini returned an empty grid" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    grid: normalized,
    caption: parsed.caption || "Here you go.",
  });
}
