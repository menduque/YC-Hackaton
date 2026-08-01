/**
 * End-to-end call simulator — proves the whole loop without a microphone.
 *
 *   Deepgram TTS (the "caller") --PCM--> our /v1/agent WS --> Deepgram Voice Agent
 *                                              |
 *                                              +--> FunctionCallRequest
 *                                                     -> preparar_turno
 *                                                        -> widget WS push
 *
 * It connects to the *running backend* rather than straight to Deepgram, so the
 * bridge, the function handlers and the widget hub are all exercised for real.
 * Whatever the widget receives here is exactly what it receives on a live call.
 *
 *   npx tsx src/scripts/callsim.ts            # uses PORT from .env
 *   npx tsx src/scripts/callsim.ts --port 8789 --callId demo
 */
import WebSocket from "ws";
import { config } from "../config.js";

const argv = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const PORT = arg("port", String(config.port));
const CALL_ID = arg("callId", "demo");

/** What the caller says, in order. One line per agent turn. */
const CALLER_LINES = [
  "Hi, I would like to book an appointment with the eye doctor please.",
  "My name is Juan Perez, and my I D number is 3 0 1 2 3 4 5 6.",
  "September twenty ninth, twenty twenty six.",
  "Twelve o'clock works great, thank you.",
];

// 16 kHz, 16-bit mono => 32 bytes per ms. 20 ms frames = 640 bytes.
const FRAME_BYTES = 640;
const FRAME_MS = 20;

/** Render one caller line to raw linear16 PCM via Deepgram's TTS REST API. */
async function speak(text: string): Promise<Buffer> {
  const url =
    "https://api.deepgram.com/v1/speak?model=aura-2-thalia-en" +
    "&encoding=linear16&sample_rate=16000&container=none";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Token ${config.deepgram.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SILENCE = Buffer.alloc(FRAME_BYTES);

/**
 * A real mic never stops sending — it sends silence between words. Deepgram
 * closes the session ("We did not receive audio within our timeout") if the
 * binary stream ever goes quiet, so this pacer always emits a frame every
 * 20 ms: queued speech when there is any, silence otherwise.
 */
const pending: Buffer[] = [];

function enqueuePcm(pcm: Buffer) {
  for (let off = 0; off < pcm.length; off += FRAME_BYTES) {
    pending.push(pcm.subarray(off, off + FRAME_BYTES));
  }
}

/** Resolves once every queued frame has actually gone out on the wire. */
function drained(): Promise<void> {
  return new Promise((resolve) => {
    const check = () => (pending.length === 0 ? resolve() : setTimeout(check, FRAME_MS));
    check();
  });
}

async function startMic(ws: WebSocket) {
  while (ws.readyState === WebSocket.OPEN) {
    ws.send(pending.shift() ?? SILENCE);
    await sleep(FRAME_MS);
  }
}

const WS_URL = `ws://localhost:${PORT}/v1/agent?callId=${CALL_ID}`;
console.log(`[callsim] connecting to ${WS_URL}\n`);
const ws = new WebSocket(WS_URL);

/**
 * Listen on the widget hub exactly like the Chrome extension does, so the run
 * proves delivery rather than just that the function fired. The hub broadcasts,
 * so a real extension on this callId receives the same push and will start the
 * RPA — use a scratch --callId to observe without driving a live browser.
 */
let widgetGot: unknown = null;
const widgetWs = new WebSocket(
  `ws://localhost:${PORT}/v1/voice/stream?callId=${CALL_ID}`,
);
widgetWs.on("message", (d) => {
  const msg = JSON.parse(d.toString());
  if (msg.type !== "OIDO_SCHEDULE") return;
  widgetGot = msg.payload;
  console.log("\n  📬 WIDGET RECEIVED the appointment payload\n");
});
widgetWs.on("error", () => {});

let turn = 0;
let speaking = false;
let agentBusy = false;
const functionCalls: { name: string; arguments: unknown }[] = [];

/** Say the next scripted line, once the agent has finished its turn. */
async function nextTurn() {
  if (speaking || agentBusy) return;
  if (turn >= CALLER_LINES.length) return;
  const line = CALLER_LINES[turn++];
  speaking = true;
  console.log(`[caller]  ${line}`);
  try {
    enqueuePcm(await speak(line));
    await drained();
  } catch (err) {
    console.error("[callsim] TTS failed:", (err as Error).message);
  }
  speaking = false;
}

ws.on("open", () => {
  console.log("[callsim] connected to backend\n");
  void startMic(ws); // silence from now on, so the session never times out
});

ws.on("message", async (data, isBinary) => {
  if (isBinary) return; // agent TTS audio — nothing to play here
  let evt: any;
  try {
    evt = JSON.parse(data.toString());
  } catch {
    return;
  }

  switch (evt.type) {
    case "status":
      if (evt.status === "connected") {
        console.log("[callsim] Deepgram session live\n");
        setTimeout(nextTurn, 3500); // let the greeting play first
      }
      break;
    case "transcript":
      console.log(`[${evt.role === "user" ? "heard " : "agent "}] ${evt.content}`);
      break;
    case "AgentThinking":
    case "AgentStartedSpeaking":
      agentBusy = true;
      break;
    case "AgentAudioDone":
      agentBusy = false;
      setTimeout(nextTurn, 1200);
      break;
    case "function_call":
      functionCalls.push({ name: evt.name, arguments: evt.arguments });
      console.log(`\n  ⚡ FUNCTION CALL  ${evt.name}`);
      console.log(`     ${JSON.stringify(evt.arguments)}\n`);
      break;
    case "function_error":
      console.error(`  ✗ function_error ${evt.name}: ${evt.error}`);
      break;
    case "error":
      console.error("[callsim] error:", evt.message);
      break;
  }
});

ws.on("error", (e) => {
  console.error(`[callsim] ws error: ${e.message}`);
  console.error(`  is the backend running on ${PORT}?  (cd backend && npm run dev)`);
  process.exit(1);
});

function finish() {
  const prepared = functionCalls.find((f) => f.name === "preparar_turno");
  console.log("\n──────────── result ────────────");
  console.log(`function calls: ${functionCalls.map((f) => f.name).join(", ") || "(none)"}`);
  if (!prepared) {
    console.log("\n❌ preparar_turno never fired — the widget got nothing.");
    process.exit(1);
  }
  console.log("\n✅ preparar_turno fired with:");
  console.log(JSON.stringify(prepared.arguments, null, 2));
  if (widgetGot) {
    console.log("\n✅ delivered to the widget as (after defaults are filled in):");
    console.log(JSON.stringify(widgetGot, null, 2));
  } else {
    console.log("\n❌ the function fired but nothing reached the widget hub.");
  }
  process.exit(widgetGot ? 0 : 1);
}

setTimeout(() => {
  try {
    ws.close();
  } catch {}
  finish();
}, 90_000);
