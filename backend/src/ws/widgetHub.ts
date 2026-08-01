import type { WebSocketServer, WebSocket } from "ws";
import type {
  OidoFieldMessage,
  OidoRpaResultMessage,
  OidoScheduleMessage,
} from "../types.js";

/**
 * Transport C (handoff §2): the Treelan content script opens a WS to us keyed by
 * ?callId=… ; when a payload is ready we push { type:'OIDO_SCHEDULE', payload }.
 * Localhost-friendly, avoids externally_connectable.
 */
const byCallId = new Map<string, Set<WebSocket>>();

/**
 * In-flight requestWidget() calls, keyed by the id we put on the wire. The
 * widget echoes that id back in { type:'OIDO_RESULT', id, ... }.
 */
interface Pending {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
const pending = new Map<string, Pending>();
let seq = 0;

/**
 * Where an unsolicited RPA verdict goes. Wired at boot (index.ts) to the MedPlum
 * Task update, so the hub itself stays free of vendor imports.
 */
type RpaResultHandler = (
  msg: OidoRpaResultMessage & { callId: string },
) => void | Promise<void>;
let rpaResultHandler: RpaResultHandler | undefined;

export function setRpaResultHandler(fn: RpaResultHandler) {
  rpaResultHandler = fn;
}

export function registerWidgetHub(wss: WebSocketServer) {
  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const callId = url.searchParams.get("callId");
    if (!callId) {
      ws.close(1008, "callId required");
      return;
    }
    let set = byCallId.get(callId);
    if (!set) byCallId.set(callId, (set = new Set()));
    set.add(ws);
    console.log(`[widget-hub] connected callId=${callId} (${set.size} client/s)`);

    // Three inbound messages:
    // - {type:'ping'}: keepalive. The extension's service worker sends it every
    //   ~15s; replying keeps its MV3 idle-timer from sleeping mid-call.
    // - {type:'OIDO_RESULT', id, ok, result, error}: the reply to a
    //   requestWidget() we sent earlier.
    // - {type:'OIDO_RPA_RESULT', taskId, ok, ...}: unsolicited, once the fill on
    //   the Treelan page finishes. Nobody is awaiting it — it closes the MedPlum
    //   Task instead.
    ws.on("message", (data) => {
      let msg: any;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg?.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }
      if (msg?.type === "OIDO_RESULT" && typeof msg.id === "string") {
        settle(msg.id, msg);
        return;
      }
      if (msg?.type === "OIDO_RPA_RESULT" && typeof msg.taskId === "string") {
        console.log(
          `[widget-hub] RPA ${msg.ok ? "completed" : "failed"} callId=${callId} task=${msg.taskId}`,
        );
        // The widget is not waiting on us; never let a vendor error surface here.
        void Promise.resolve(rpaResultHandler?.({ ...msg, callId })).catch((err) =>
          console.error("[widget-hub] RPA result handler failed:", (err as Error).message),
        );
      }
    });

    ws.on("close", () => {
      set!.delete(ws);
      if (set!.size === 0) byCallId.delete(callId);
    });
  });
}

/**
 * Ask the widget to do something and wait for its answer.
 *
 * The other direction (pushSchedule) is fire-and-forget: it only reports how
 * many sockets it reached. This one correlates an id so a handler can await a
 * real result — which is what a patient lookup needs, since the answer decides
 * what the agent says next.
 */
export function requestWidget<T = any>(
  callId: string,
  type: string,
  payload: unknown,
  timeoutMs = 8000,
): Promise<T> {
  const id = `req-${++seq}`;
  const reached = broadcast(callId, { type, id, callId, payload });
  if (reached === 0) {
    // Fail now instead of burning the full timeout while the caller waits on
    // the phone — there is nobody to answer.
    return Promise.reject(
      new Error("No Treelan widget connected — is the tab open and logged in?"),
    );
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Widget did not answer ${type} within ${timeoutMs}ms`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
  });
}

function settle(id: string, msg: any) {
  const p = pending.get(id);
  if (!p) return; // already timed out, or not ours
  pending.delete(id);
  clearTimeout(p.timer);
  if (msg.ok === false) p.reject(new Error(msg.error || "Widget reported an error"));
  else p.resolve(msg.result);
}

/** Push the full appointment payload to any widget connected on this callId. */
export function pushSchedule(msg: OidoScheduleMessage): number {
  return broadcast(msg.callId, msg);
}

/** V2: push a single consolidated field (handoff §7). */
export function pushField(msg: OidoFieldMessage): number {
  return broadcast(msg.callId, msg);
}

function broadcast(callId: string, msg: unknown): number {
  const set = byCallId.get(callId);
  if (!set || set.size === 0) {
    console.warn(`[widget-hub] no widget connected for callId=${callId}`);
    return 0;
  }
  const data = JSON.stringify(msg);
  for (const ws of set) ws.send(data);
  return set.size;
}
