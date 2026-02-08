import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

type SketchRecord = {
  id: string;
  name: string;
  svgPath: string;
  createdAt: string;
  ageSeconds?: number;
};

const PUBLIC_SKETCH_DIR = path.join(process.cwd(), "public", "sketches");

function ensurePublicDir() {
  fs.mkdirSync(PUBLIC_SKETCH_DIR, { recursive: true });
}

function validateSvg(svg: string) {
  if (!svg.trim().startsWith("<svg")) {
    throw new Error("SVG content must start with <svg");
  }
  if (!svg.includes("</svg>")) {
    throw new Error("SVG content must include </svg>");
  }
}

export async function GET() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, name, svg_path as svgPath, created_at as createdAt
       FROM sketches
       ORDER BY created_at DESC
       LIMIT 50`,
    )
    .all() as SketchRecord[];

  const now = Date.now();
  const withAge = rows.map((row) => ({
    ...row,
    ageSeconds: Math.max(
      0,
      Math.floor((now - Date.parse(row.createdAt)) / 1000),
    ),
  }));

  return NextResponse.json({ sketches: withAge });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const svg = typeof body?.svg === "string" ? body.svg.trim() : "";

  if (!name) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }
  if (!svg) {
    return NextResponse.json({ error: "SVG is required." }, { status: 400 });
  }

  try {
    validateSvg(svg);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid SVG." },
      { status: 400 },
    );
  }

  ensurePublicDir();
  const id = crypto.randomUUID();
  const svgPath = `/sketches/${id}.svg`;
  const filePath = path.join(PUBLIC_SKETCH_DIR, `${id}.svg`);
  fs.writeFileSync(filePath, svg, "utf8");

  const pngPath = `/sketches/${id}.png`;
  const pngFilePath = path.join(PUBLIC_SKETCH_DIR, `${id}.png`);
  const latestPngPath = path.join(PUBLIC_SKETCH_DIR, "latest.png");
  try {
    await sharp(Buffer.from(svg))
      .png()
      .toFile(pngFilePath);
    fs.copyFileSync(pngFilePath, latestPngPath);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to render PNG from SVG." },
      { status: 500 },
    );
  }

  const createdAt = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO sketches (id, name, svg_path, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(id, name, svgPath, createdAt);

  return NextResponse.json(
    { id, name, svgPath, pngPath, createdAt },
    { status: 201 },
  );
}
