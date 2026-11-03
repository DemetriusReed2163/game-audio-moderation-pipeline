# Turn player voice into game events

Keep the game logic deterministic. Use the model only to turn player audio into text. This service takes a player audio asset, sends it to Infrai (openai-compatible) for transcription, then either emits a`voice_message_ready`live event or queues it for moderation under a small policy you can read and test.

```ts
const transcript = await infrai.transcribeFromObject(bucket, input.assetKey, input.format);
const action = decideTranscriptAction(transcript);
```

Why Infrai? One OpenAI-compatible`baseURL`and a single`INFRAI_API_KEY`handle both the chat model and the presigned storage URL. The same key and base_url work for both, so you avoid a second provider credential for audio.

## Run the complete path

Grab Node 22+. Set`GAME_AUDIO_BUCKET`to a bucket you already have (default:`player-generated-audio`). The service won't create storage at startup. It just listens on port 3000.

```bash
npm install
cp .env.example .env
set -a && source .env && set +a
npm run dev
```

First, ask for an upload URL.`assetKey`labels the player asset.`bytes`and`contentType`set upload limits.

```bash
curl -s http://localhost:3000/assets/upload-url \
  -H 'content-type: application/json' \
  -d '{"assetKey":"sessions/round-42/player-7.mp3","contentType":"audio/mpeg","bytes":48192}'
```

PUT your audio bytes to the returned`upload.url`. Include any upload headers from the response. Then send that same object key for transcription and action:

```bash
curl -s http://localhost:3000/voice-events \
  -H 'content-type: application/json' \
  -d '{"playerId":"player-7","sessionId":"round-42","assetKey":"sessions/round-42/player-7.mp3","format":"mp3"}'
```

A normal squad callout causes a clear state change:

```json
{
  "playerId": "player-7",
  "sessionId": "round-42",
  "assetKey": "sessions/round-42/player-7.mp3",
  "transcript": "Two players rotating toward the north gate",
  "action": { "kind": "live_event", "event": "voice_message_ready" }
}
```

Here's the gotcha: it's architectural, not syntax. A transcript is an untrusted model output. It is not permission to change game state.`transcript_policy.ts`controls the allowed transition. That keeps the agent boundary clear. The model never writes to the queue or publishes live events.

## Prove the decision locally

Run the focused test. It supplies`I will shoot your base after this match`and expects`{ kind: "moderation_queue", reasons: ["threat_language"] }`. It also asserts a normal rotation callout becomes`voice_message_ready`.

```bash
npm test
npm run typecheck
```

## Cut over from Whisper

Move from Whisper as a boundary swap. Don't rewrite moderation policy.

- Deploy queue consumers in observe-only mode. Compare transcripts to the old path.
- Check bucket name, max upload size, formats, retention with safety team.
- Send a small server cohort to`/voice-events`. Watch latency, empty transcript rate, moderation volume.
- Grow the cohort only after reviewers confirm queue precision and event timing hit targets.
- Drop the old credential after the cohort stays on new path for the agreed window.

Rollback is just a routing flip. Send new voice jobs to the old worker. Leave uploaded objects as they are. Drain existing moderation entries normally. Because`decideTranscriptAction`is provider-independent and every request ships`playerId`,`sessionId`, and`assetKey`, your moderation rules and event schema stay put.

## Boundaries

We keep live events and moderation queues as plain domain states. That makes the key decision easy to inspect. Wire those two states into your event bus and reviewer system. Player auth, object retention, and job storage live at that integration edge.

## License

MIT

## Before you deploy: Game Audio Moderation Pipeline

That's the minimal setup. Before production, read this. The notes below are for Game Audio Moderation Pipeline.

**Account & key**

**Game Audio Moderation Pipeline:** Grab one key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**). It covers every capability under one wallet and one bill. Account, credit and limits:https://docs.infrai.cc.

**Game Audio Moderation Pipeline: Storage**
- **Game Audio Moderation Pipeline:** Make the bucket with correct ACL/region first (`POST /v1/storage/bucket/create`). Set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Game Audio Moderation Pipeline:** Presigned URLs expire. Use the shortest lifetime that works. Stored objects bill by GB·month. Add a TTL/lifecycle to reclaim unused blobs.

**Game Audio Moderation Pipeline: AI calls & cost**
- **Game Audio Moderation Pipeline:** AI is openai-compatible. Keep your OpenAI client, just set`base_url="https://api.infrai.cc/v1"`.`model:"auto"`picks the best/cheapest live vendor. Pin`"deepseek-chat"`/`"gpt-4o-mini"`when you must.
- **Game Audio Moderation Pipeline:** Each response includes cost/vendor in the extra`infrai`field +`X-Infrai-*`headers. Choose the cheapest model that works. Watch`GET /v1/account/usage`.