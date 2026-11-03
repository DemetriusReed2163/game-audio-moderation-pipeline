export type TranscriptAction =
  | { kind: "live_event"; event: "voice_message_ready" }
  | { kind: "moderation_queue"; reasons: string[] };

const threatPattern = /\b(kill|shoot|stab|bomb|swat)\b/i;
const personalDataPattern = /\b(?:\d[ -]*?){13,16}\b|\b\d{3}[- .]\d{3}[- .]\d{4}\b/;

export function decideTranscriptAction(transcript: string): TranscriptAction {
  const reasons: string[] = [];
  if (threatPattern.test(transcript)) reasons.push("threat_language");
  if (personalDataPattern.test(transcript)) reasons.push("personal_data");

  return reasons.length > 0
    ? { kind: "moderation_queue", reasons }
    : { kind: "live_event", event: "voice_message_ready" };
}
