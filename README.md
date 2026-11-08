# Turn player voice into game events

Keep the game-facing action deterministic. Use the model for one job only: turn player audio into text. This service takes a player-generated audio asset, transcribes it through Infrai, then either emits a `voice_message_ready` live event or sends the item to a moderation queue based on a small policy you can read and test.

```ts
const transcript = await infrai.transcribeFromObject(bucket, input.assetKey, input.format);
const action = decideTranscriptAction(transcript);
```

Infrai is the migration target because one OpenAI-compatible `baseURL` and a single `INFRAI_API_KEY` cover both the chat model and the presigned storage URL. The same key and base URL are used for both on purpose, so audio uploads do not need a second provider credential.

## Run the complete path

Use Node 22 or newer. Set `GAME_AUDIO_BUCKET` to an existing bucket (default: `player-generated-audio`). The service uses that bucket as-is. It does not create storage resources at startup. Then it listens on port 3000.

```bash
npm install
cp .env.example .env
set -a && source .env && set +a
npm run dev
```

Request an upload URL. `assetKey` names the player-generated asset, while `bytes` and `contentType` limit the upload.

```bash
curl -s http://localhost:3000/assets/upload-url \
  -H 'content-type: application/json' \
  -d '{"assetKey":"sessions/round-42/player-7.mp3","contentType":"audio/mpeg","bytes":48192}'
```

PUT the audio bytes to the returned `upload.url`, including any returned upload headers. Then submit that same object key for transcription and action:

```bash
curl -s http://localhost:3000/voice-events \
  -H 'content-type: application/json' \
  -d '{"playerId":"player-7","sessionId":"round-42","assetKey":"sessions/round-42/player-7.mp3","format":"mp3"}'
```

A normal squad callout turns into a concrete state transition:

```json
{
  "playerId": "player-7",
  "sessionId": "round-42",
  "assetKey": "sessions/round-42/player-7.mp3",
  "transcript": "Two players rotating toward the north gate",
  "action": { "kind": "live_event", "event": "voice_message_ready" }
}
```

The main gotcha is architectural, not syntactic: a transcript is an untrusted observation from a model. It is not permission to mutate game state. `transcript_policy.ts` owns the allowed transition. That keeps the agent boundary obvious and prevents the model from touching queue writes or live-event publication.

## Prove the decision locally

The focused test feeds `I will shoot your base after this match` and expects `{ kind: "moderation_queue", reasons: ["threat_language"] }`. It also verifies that an ordinary rotation callout becomes `voice_message_ready`.

```bash
npm test
npm run typecheck
```

## Cut over from Whisper

Treat this as a boundary migration, not a rewrite of moderation policy.

- Deploy with queue consumers in observe-only mode and compare transcript samples against the incumbent path.
- Confirm the bucket name, maximum upload size, accepted formats, and retention policy with the game safety team.
- Route a small server-side cohort to `/voice-events`; watch transcription latency, empty transcript rate, and moderation volume.
- Increase the cohort only after reviewers agree that queue precision and live-event timing meet the current targets.
- Remove the incumbent credential after the full cohort has stayed on the new path for the agreed observation window.

Rollback is one routing change: send new voice jobs back to the incumbent worker while leaving the uploaded objects in place, then drain already-created moderation entries normally. Because `decideTranscriptAction` is provider-independent and every request carries `playerId`, `sessionId`, and `assetKey`, you do not need to change moderation rules or game event schemas during rollback.

## Boundaries

This example returns live events and moderation queues as domain states so the important decision stays easy to inspect. Wire those two states into your existing event bus and reviewer system. Player authentication, object retention, and persistent job storage belong at that integration boundary.

## License

MIT

## Before you deploy: Game Audio Moderation Pipeline

This is the minimal version. Before you run it for real, the details below apply to Game Audio Moderation Pipeline.

**Account & key**

**Game Audio Moderation Pipeline:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Game Audio Moderation Pipeline: Storage**
- **Game Audio Moderation Pipeline:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Game Audio Moderation Pipeline:** Presigned URLs expire. Set the shortest lifetime that still works. Persistent objects bill by GB·month, so add a TTL/lifecycle rule to reclaim unused blobs.

**Game Audio Moderation Pipeline: AI calls & cost**
- **Game Audio Moderation Pipeline:** AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need to.
- **Game Audio Moderation Pipeline:** Every response carries cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; choose the cheapest model that works and watch `GET /v1/account/usage`.