import WebSocket from "ws";
import { config } from "../config.js";
import { buildAgentSettings } from "./agentConfig.js";
import { dispatchFunction } from "../functions/index.js";

const DG_URL = "wss://agent.deepgram.com/v1/agent/converse";

/**
 * Bridges one browser client to a Deepgram Voice Agent session.
 *   browser --(binary PCM 16k)--> backend --> Deepgram
 *   Deepgram --(binary PCM 24k)--> backend --> browser  (TTS audio)
 *   Deepgram --(JSON events)--> backend: transcripts forwarded, function calls handled here.
 *
 * `browser` is the ws to the panel; `callId` scopes function handlers (e.g. which
 * widget preparar_turno pushes to).
 */
export function bridgeBrowserToDeepgram(browser: WebSocket, callId: string) {
  if (!config.deepgram.apiKey) {
    browser.send(JSON.stringify({ type: "error", message: "DEEPGRAM_API_KEY missing" }));
    browser.close();
    return;
  }

  const dg = new WebSocket(DG_URL, {
    headers: { Authorization: `Token ${config.deepgram.apiKey}` },
  });

  let dgReady = false;
  const audioQueue: Buffer[] = [];

  dg.on("open", () => {
    dg.send(JSON.stringify(buildAgentSettings()));
    dgReady = true;
    for (const buf of audioQueue) dg.send(buf);
    audioQueue.length = 0;
    tell(browser, { type: "status", status: "connected" });
  });

  // --- Deepgram -> browser ---
  dg.on("message", async (data: WebSocket.RawData, isBinary: boolean) => {
    if (isBinary) {
      // TTS audio: forward straight to the browser to play.
      if (browser.readyState === WebSocket.OPEN) browser.send(data);
      return;
    }
    let evt: any;
    try {
      evt = JSON.parse(data.toString());
    } catch {
      return;
    }

    switch (evt.type) {
      case "ConversationText":
        // { role: "user"|"assistant", content: "..." }
        tell(browser, { type: "transcript", role: evt.role, content: evt.content });
        break;
      case "UserStartedSpeaking":
        tell(browser, { type: "user_speaking" });
        break;
      case "AgentAudioDone":
      case "AgentStartedSpeaking":
      case "AgentThinking":
        tell(browser, { type: evt.type });
        break;
      case "FunctionCallRequest":
        await handleFunctionCalls(evt, dg, browser, callId);
        break;
      case "Welcome":
      case "SettingsApplied":
        break;
      case "Error":
        tell(browser, { type: "error", message: evt.description ?? "deepgram error" });
        console.error("[deepgram] error:", evt);
        break;
      default:
        // pass through anything else for debugging in the panel
        break;
    }
  });

  dg.on("close", (code) => {
    tell(browser, { type: "status", status: "closed", code });
    if (browser.readyState === WebSocket.OPEN) browser.close();
  });
  dg.on("error", (err) => {
    console.error("[deepgram] ws error:", err.message);
    tell(browser, { type: "error", message: err.message });
  });

  // --- browser -> Deepgram ---
  browser.on("message", (data: WebSocket.RawData, isBinary: boolean) => {
    if (isBinary) {
      const buf = data as Buffer;
      if (dgReady) dg.send(buf);
      else audioQueue.push(buf);
    }
    // (control JSON from the browser could be handled here if needed)
  });

  browser.on("close", () => {
    if (dg.readyState === WebSocket.OPEN || dg.readyState === WebSocket.CONNECTING) dg.close();
  });
  browser.on("error", () => dg.close());
}

async function handleFunctionCalls(
  evt: any,
  dg: WebSocket,
  browser: WebSocket,
  callId: string,
) {
  const calls: any[] = evt.functions ?? [];
  for (const call of calls) {
    const args = safeParse(call.arguments);
    tell(browser, { type: "function_call", name: call.name, arguments: args });
    let content: string;
    try {
      const result = await dispatchFunction(call.name, args, { callId });
      content = JSON.stringify(result ?? { ok: true });
    } catch (err) {
      content = JSON.stringify({ error: (err as Error).message });
      tell(browser, { type: "function_error", name: call.name, error: (err as Error).message });
    }
    dg.send(
      JSON.stringify({
        type: "FunctionCallResponse",
        id: call.id,
        name: call.name,
        content,
      }),
    );
  }
}

function tell(ws: WebSocket, obj: unknown) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}
function safeParse(s: unknown) {
  if (typeof s !== "string") return s ?? {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
