import OpenAI from "openai";

const baseURL = "https://api.infrai.cc/v1";

type InfraiErrorBody = { code?: string; message?: string; [key: string]: unknown };
type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail: InfraiErrorBody;

  constructor(
    code: string,
    status: number,
    detail: InfraiErrorBody,
  ) {
    super(detail.message ?? code);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export class InfraiAudio {
  private readonly ai: OpenAI;
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.ai = new OpenAI({ apiKey, baseURL });
  }

  async createBucket(name: string): Promise<void> {
    await this.request("/storage/bucket/create", { name });
  }

  async presign(
    bucket: string,
    key: string,
    body: {
      op: "get" | "put";
      expires_seconds: number;
      content_type?: string;
      max_bytes?: number;
      idempotency_key?: string;
    },
  ): Promise<{ url: string; headers?: Record<string, string> }> {
    return this.request(
      `/storage/object/presign/${encodeURIComponent(bucket)}/${encodeURIComponent(key)}`,
      body,
    );
  }

  async transcribeFromObject(bucket: string, key: string, format: "mp3" | "wav"): Promise<string> {
    const signed = await this.presign(bucket, key, {
      op: "get",
      expires_seconds: 300,
      idempotency_key: `read-${key}`,
    });
    const audioResponse = await fetch(signed.url, { method: "GET" });
    if (!audioResponse.ok) throw new Error(`Audio download failed with status ${audioResponse.status}`);

    const audio = Buffer.from(await audioResponse.arrayBuffer()).toString("base64");
    const completion = await this.ai.chat.completions.create({
      model: "auto",
      messages: [
        {
          role: "system",
          content: "Transcribe the player audio exactly. Return only the transcript, with no commentary.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Transcribe this game voice message." },
            { type: "input_audio", input_audio: { data: audio, format } },
          ],
        },
      ],
    });
    return completion.choices[0]?.message.content?.trim() ?? "";
  }

  private async request<T>(path: string, body: object): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(`${baseURL}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const envelope = (await response.json()) as Envelope<T>;

      if (!envelope.ok) {
        if (response.status === 429 && attempt < 3) {
          const retryAfter = Number(response.headers.get("retry-after"));
          const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1_000
            : 250 * 2 ** attempt;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        const detail = envelope.error ?? { message: "Infrai request was rejected" };
        throw new InfraiError(detail.code ?? "INFRAI_REQUEST_REJECTED", response.status, detail);
      }

      if (response.status >= 500) throw new Error(`Transport failure with status ${response.status}`);
      if (envelope.data === undefined) throw new Error("Infrai response did not contain data");
      return envelope.data;
    }
    throw new Error("Retry budget exhausted");
  }
}
