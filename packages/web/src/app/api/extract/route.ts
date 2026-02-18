import { setPromptsDir } from "@sam/bot/llm";
import { resolve } from "path";

setPromptsDir(resolve(process.cwd(), "../bot/src/prompts"));

import { NextRequest } from "next/server";
import { extractJSON } from "@sam/bot/llm";

export async function POST(req: NextRequest) {
  const { text, spotName, city } = (await req.json()) as {
    text: string;
    spotName: string;
    city?: string;
  };

  if (!text || !spotName) {
    return Response.json({ error: "text and spotName required" }, { status: 400 });
  }

  try {
    const result = await extractJSON<Record<string, unknown>>(
      "extraction",
      text,
      `This is about an existing spot called "${spotName}". Extract any new info the user provides.`,
      { templateVars: { CITY: city ?? "Kuala Lumpur" } }
    );

    // Remove fields we don't want to overwrite from extraction
    delete result.name;
    delete result.city;
    delete result.missing_fields;

    return Response.json(result);
  } catch (error) {
    console.error("[extract] Error:", error);
    return Response.json({ error: "Extraction failed" }, { status: 500 });
  }
}
