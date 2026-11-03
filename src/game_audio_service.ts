import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";
import { InfraiAudio, InfraiError } from "./infrai_audio.js";
import { decideTranscriptAction } from "./transcript_policy.js";

const uploadRequest = z.object({
  assetKey: z.string().min(1).max(240),
  contentType: z.enum(["audio/mpeg", "audio/wav"]),
  bytes: z.number().int().positive().max(20_000_000),
});

const transcriptionRequest = z.object({
  playerId: z.string().min(1).max(80),
  sessionId: z.string().min(1).max(80),
  assetKey: z.string().min(1).max(240),
  format: z.enum(["mp3", "wav"]),
});

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");

const bucket = process.env.GAME_AUDIO_BUCKET ?? "player-generated-audio";
const port = Number(process.env.PORT ?? 3000);
const infrai = new InfraiAudio(apiKey);

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 64_000) throw new Error("Request body is too large");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

function clientStatus(error: InfraiError): number {
  return error.status >= 400 && error.status < 500 ? error.status : 502;
}

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method === "POST" && request.url === "/assets/upload-url") {
    const input = uploadRequest.parse(await readJson(request));
    const signed = await infrai.presign(bucket, input.assetKey, {
      op: "put",
      expires_seconds: 600,
      content_type: input.contentType,
      max_bytes: input.bytes,
      idempotency_key: `upload-${input.assetKey}`,
    });
    json(response, 200, { assetKey: input.assetKey, upload: signed });
    return;
  }

  if (request.method === "POST" && request.url === "/voice-events") {
    const input = transcriptionRequest.parse(await readJson(request));
    const transcript = await infrai.transcribeFromObject(bucket, input.assetKey, input.format);
    const action = decideTranscriptAction(transcript);
    json(response, 200, {
      playerId: input.playerId,
      sessionId: input.sessionId,
      assetKey: input.assetKey,
      transcript,
      action,
    });
    return;
  }

  json(response, 404, { error: "route_not_found" });
}

createServer((request, response) => {
  route(request, response).catch((error: unknown) => {
    if (error instanceof z.ZodError) {
      json(response, 400, { error: "invalid_request", issues: error.issues });
    } else if (error instanceof InfraiError) {
      json(response, clientStatus(error), { error: error.code, detail: error.detail });
    } else {
      console.error(error);
      json(response, 500, { error: "request_failed" });
    }
  });
}).listen(port, () => console.log(`Game audio service listening on http://localhost:${port}`));
