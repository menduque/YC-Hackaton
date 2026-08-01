import type { WebSocketServer, WebSocket } from "ws";
import type { OidoFieldMessage, OidoScheduleMessage } from "../types.js";

/**
 * Transport C (handoff §2): the Treelan content script opens a WS to us keyed by
 * ?callId=… ; when a payload is ready we push { type:'OIDO_SCHEDULE', payload }.
 * Localhost-friendly, avoids externally_connectable.
 */
const byCallId = new Map<string, Set<WebSocket>>();

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

    // Keepalive: the extension's service worker sends {type:'ping'} every ~15s;
    // replying keeps its MV3 idle-timer from sleeping mid-call.
    ws.on("message", (data) => {
      let msg: any;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg?.type === "ping") ws.send(JSON.stringify({ type: "pong" }));
    });

    ws.on("close", () => {
      set!.delete(ws);
      if (set!.size === 0) byCallId.delete(callId);
    });
  });
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
