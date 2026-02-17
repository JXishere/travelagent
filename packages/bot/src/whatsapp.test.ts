import { describe, it, expect, beforeAll } from "vitest";

// Set env vars before import to avoid side-effect crash from top-level `!` assertions
beforeAll(() => {
  process.env.WHATSAPP_TOKEN = "test-token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "test-phone-id";
});

import { parseWebhook, splitMessage } from "./whatsapp.js";

function makeWebhookBody(msg: Record<string, any>) {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [msg],
            },
          },
        ],
      },
    ],
  };
}

describe("parseWebhook", () => {
  it("extracts fields from a valid text message", () => {
    const body = makeWebhookBody({
      from: "+60123456789",
      id: "msg-1",
      type: "text",
      timestamp: "1700000000",
      text: { body: "Hello Sam" },
    });
    const result = parseWebhook(body);
    expect(result).not.toBeNull();
    expect(result!.from).toBe("+60123456789");
    expect(result!.messageId).toBe("msg-1");
    expect(result!.type).toBe("text");
    expect(result!.text).toBe("Hello Sam");
    expect(result!.timestamp).toBe(1700000000);
  });

  it("extracts audioId from an audio message", () => {
    const body = makeWebhookBody({
      from: "+60123456789",
      id: "msg-2",
      type: "audio",
      timestamp: "1700000001",
      audio: { id: "audio-123" },
    });
    const result = parseWebhook(body);
    expect(result!.audioId).toBe("audio-123");
  });

  it("extracts imageId and imageCaption from image with caption", () => {
    const body = makeWebhookBody({
      from: "+60123456789",
      id: "msg-3",
      type: "image",
      timestamp: "1700000002",
      image: { id: "img-456", caption: "Check this out" },
    });
    const result = parseWebhook(body);
    expect(result!.imageId).toBe("img-456");
    expect(result!.imageCaption).toBe("Check this out");
  });

  it("leaves imageCaption undefined when no caption", () => {
    const body = makeWebhookBody({
      from: "+60123456789",
      id: "msg-4",
      type: "image",
      timestamp: "1700000003",
      image: { id: "img-789" },
    });
    const result = parseWebhook(body);
    expect(result!.imageId).toBe("img-789");
    expect(result!.imageCaption).toBeUndefined();
  });

  it("extracts lat/lng from a location message", () => {
    const body = makeWebhookBody({
      from: "+60123456789",
      id: "msg-5",
      type: "location",
      timestamp: "1700000004",
      location: { latitude: 3.139, longitude: 101.687 },
    });
    const result = parseWebhook(body);
    expect(result!.location).toEqual({ latitude: 3.139, longitude: 101.687 });
  });

  it("returns null for empty body", () => {
    expect(parseWebhook({})).toBeNull();
  });

  it("returns null for null/undefined", () => {
    expect(parseWebhook(null)).toBeNull();
    expect(parseWebhook(undefined)).toBeNull();
  });

  it("returns null for status update (no messages)", () => {
    const body = {
      entry: [{ changes: [{ value: { statuses: [{ id: "status-1" }] } }] }],
    };
    expect(parseWebhook(body)).toBeNull();
  });

  it("returns null for malformed entry (empty array)", () => {
    expect(parseWebhook({ entry: [] })).toBeNull();
  });
});

describe("splitMessage", () => {
  it("returns single chunk for short text", () => {
    expect(splitMessage("Hello", 100)).toEqual(["Hello"]);
  });

  it("returns single chunk when text equals maxLen", () => {
    const text = "a".repeat(100);
    expect(splitMessage(text, 100)).toEqual([text]);
  });

  it("splits at newline within range", () => {
    const text = "Line one\nLine two";
    const chunks = splitMessage(text, 15);
    expect(chunks[0]).toBe("Line one");
    expect(chunks[1]).toBe("Line two");
  });

  it("falls back to maxLen when no good newline", () => {
    const text = "a".repeat(200);
    const chunks = splitMessage(text, 100);
    expect(chunks[0].length).toBe(100);
    expect(chunks[1].length).toBe(100);
  });

  it("handles 3+ chunks", () => {
    const text = "a".repeat(300);
    const chunks = splitMessage(text, 100);
    expect(chunks.length).toBe(3);
  });

  it("trims leading whitespace on subsequent chunks", () => {
    // Newline split leaves whitespace after the break — trimStart kicks in
    const text = "First part\n   Second part";
    const chunks = splitMessage(text, 12);
    expect(chunks[1]).toBe("Second part");
  });

  it("returns [''] for empty string", () => {
    expect(splitMessage("", 100)).toEqual([""]);
  });
});
