// Whisper API wrapper — voice note transcription

import OpenAI from "openai";
import { downloadMedia } from "./whatsapp.js";

const openai = new OpenAI(); // uses OPENAI_API_KEY env var

/** Download a WhatsApp voice note and transcribe it via Whisper */
export async function transcribeVoiceNote(mediaId: string): Promise<string> {
  const audioBuffer = await downloadMedia(mediaId);

  // Whisper needs a File-like object with a name
  const file = new File([new Uint8Array(audioBuffer)], "voice.ogg", { type: "audio/ogg" });

  const transcription = await openai.audio.transcriptions.create({
    model: "whisper-1",
    file,
    language: "en",
  });

  return transcription.text;
}
