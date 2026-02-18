// Embeddings module — OpenAI text-embedding-3-small for semantic search

import OpenAI from "openai";
import type { Spot } from "./database.js";

const openai = new OpenAI(); // uses OPENAI_API_KEY env var

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

/** Generate an embedding vector for a text string */
export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
    dimensions: EMBEDDING_DIMENSIONS,
  });
  return response.data[0].embedding;
}

/** Build a text representation of a spot for embedding */
export function buildSpotText(spot: Partial<Spot>): string {
  const parts: string[] = [];

  if (spot.name) parts.push(spot.name);
  if (spot.area) parts.push(spot.area);
  if (spot.category) parts.push(spot.category);
  if (spot.vibe) parts.push(`vibe: ${spot.vibe}`);
  if (spot.what_to_order?.length) parts.push(`known for: ${spot.what_to_order.join(", ")}`);
  if (spot.pro_tips?.length) parts.push(`tips: ${spot.pro_tips.join(". ")}`);
  if (spot.price_range) parts.push(`price: ${spot.price_range}`);
  if (spot.best_time_of_day) parts.push(`best time: ${spot.best_time_of_day}`);
  if (spot.indoor_outdoor) parts.push(spot.indoor_outdoor);

  return parts.join(". ");
}

/** Generate and store an embedding for a spot */
export async function embedSpot(
  spotId: string,
  text: string,
  updateFn: (spotId: string, updates: Record<string, any>) => Promise<void>
): Promise<void> {
  const embedding = await generateEmbedding(text);
  // Store as pgvector-compatible string: "[0.1,0.2,...]"
  const embeddingStr = `[${embedding.join(",")}]`;
  await updateFn(spotId, { embedding: embeddingStr });
}
