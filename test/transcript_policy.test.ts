import assert from "node:assert/strict";
import test from "node:test";
import { decideTranscriptAction } from "../src/transcript_policy.js";

test("routes a threat to moderation instead of publishing a live event", () => {
  assert.deepEqual(decideTranscriptAction("I will shoot your base after this match"), {
    kind: "moderation_queue",
    reasons: ["threat_language"],
  });
});

test("turns an ordinary squad callout into a visible live event", () => {
  assert.deepEqual(decideTranscriptAction("Two players rotating toward the north gate"), {
    kind: "live_event",
    event: "voice_message_ready",
  });
});
