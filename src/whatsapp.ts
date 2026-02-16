// WhatsApp Cloud API — send/receive helpers

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN!;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID!;
const GRAPH_API = "https://graph.facebook.com/v22.0";

export interface IncomingMessage {
  from: string; // sender phone number
  type: "text" | "audio" | "image" | "location" | "interactive";
  text?: string;
  audioId?: string;
  location?: { latitude: number; longitude: number };
  timestamp: number;
}

/** Parse the raw webhook body into a clean IncomingMessage (or null if not a user message) */
export function parseWebhook(body: any): IncomingMessage | null {
  try {
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const msg = value?.messages?.[0];
    if (!msg) return null;

    const base: IncomingMessage = {
      from: msg.from,
      type: msg.type,
      timestamp: parseInt(msg.timestamp, 10),
    };

    if (msg.type === "text") {
      base.text = msg.text.body;
    } else if (msg.type === "audio") {
      base.audioId = msg.audio.id;
    } else if (msg.type === "location") {
      base.location = {
        latitude: msg.location.latitude,
        longitude: msg.location.longitude,
      };
    }

    return base;
  } catch {
    return null;
  }
}

/** Send a text message via WhatsApp */
export async function sendMessage(to: string, text: string): Promise<void> {
  // WhatsApp has a ~4096 char limit per message. Split if needed.
  const chunks = splitMessage(text, 4000);
  for (const chunk of chunks) {
    const res = await fetch(`${GRAPH_API}/${PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: chunk },
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error("WhatsApp API error:", JSON.stringify(data, null, 2));
    } else {
      console.log("Message sent to", to, "— response:", JSON.stringify(data));
    }
  }
}

/** Download media (voice notes, images) from WhatsApp */
export async function downloadMedia(mediaId: string): Promise<Buffer> {
  // Step 1: get the media URL
  const metaRes = await fetch(`${GRAPH_API}/${mediaId}`, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
  });
  const meta = (await metaRes.json()) as { url: string };

  // Step 2: download the actual file
  const fileRes = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
  });
  const arrayBuffer = await fileRes.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/** Mark a message as read (shows blue ticks) */
export async function markAsRead(messageId: string): Promise<void> {
  await fetch(`${GRAPH_API}/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    }),
  });
}

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Try to break at a newline
    let breakPoint = remaining.lastIndexOf("\n", maxLen);
    if (breakPoint < maxLen * 0.5) breakPoint = maxLen;
    chunks.push(remaining.slice(0, breakPoint));
    remaining = remaining.slice(breakPoint).trimStart();
  }
  return chunks;
}
