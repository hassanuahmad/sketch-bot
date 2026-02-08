import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

const PUBLIC_SKETCH_DIR = path.join(process.cwd(), "public", "sketches");

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";

  if (!id) {
    return NextResponse.json({ error: "Missing id." }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }

  const db = getDb();
  const result = db
    .prepare(`UPDATE sketches SET name = ? WHERE id = ?`)
    .run(name, id);

  if (result.changes === 0) {
    return NextResponse.json({ error: "Sketch not found." }, { status: 404 });
  }

  return NextResponse.json({ id, name });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  if (!id) {
    return NextResponse.json({ error: "Missing id." }, { status: 400 });
  }

  const db = getDb();
  const row = db
    .prepare(`SELECT svg_path as svgPath FROM sketches WHERE id = ?`)
    .get(id) as { svgPath?: string } | undefined;

  const result = db.prepare(`DELETE FROM sketches WHERE id = ?`).run(id);

  if (result.changes === 0) {
    return NextResponse.json({ error: "Sketch not found." }, { status: 404 });
  }

  if (row?.svgPath) {
    const fileName = path.basename(row.svgPath);
    const filePath = path.join(PUBLIC_SKETCH_DIR, fileName);
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Ignore missing file
    }
  }

  return NextResponse.json({ id });
}
