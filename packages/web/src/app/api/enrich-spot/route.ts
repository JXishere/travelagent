import { NextRequest, NextResponse } from "next/server";
import { webSearchSpot } from "@sam/bot/llm";

export async function POST(req: NextRequest) {
  const { spotName, city } = await req.json();
  if (!spotName || !city) {
    return NextResponse.json({ error: "spotName and city required" }, { status: 400 });
  }
  try {
    const suggestions = await webSearchSpot(spotName, city);
    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json({ error: "Web search failed" }, { status: 500 });
  }
}
