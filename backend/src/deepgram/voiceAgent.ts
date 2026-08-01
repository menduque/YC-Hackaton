/**
 * Deepgram Voice Agent bridge — STUB for the next step.
 *
 * Once DEEPGRAM_API_KEY is set and the panel captures the mic, this module opens
 * the browser<->backend audio path to Deepgram's Voice Agent WS, sends
 * buildAgentSettings(), streams audio both ways, and on each FunctionCallRequest
 * calls dispatchFunction(...) then replies with a FunctionCallResponse.
 *
 * Events to consume (handoff §3.4): ConversationText, FunctionCallRequest,
 * UserStartedSpeaking, AgentAudioDone.
 *
 * Left as a stub on purpose: it needs the Deepgram key + the panel's mic stream,
 * which come after this scaffolding.
 */
import { buildAgentSettings } from "./agentConfig.js";

export { buildAgentSettings };

export function notReady(): never {
  throw new Error(
    "Deepgram voice agent bridge not wired yet — needs DEEPGRAM_API_KEY + the mic panel.",
  );
}
