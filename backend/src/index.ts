import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config, vendorStatus } from "./config.js";
import { registerWidgetHub, pushSchedule, setRpaResultHandler } from "./ws/widgetHub.js";
import { medplum } from "./clients/medplum.js";
import { dispatchFunction } from "./functions/index.js";
import { AGENT_FUNCTIONS } from "./deepgram/agentConfig.js";
import { bridgeBrowserToDeepgram } from "./deepgram/bridge.js";
import { agendaCompleta, normalizarFecha, reemplazarDia } from "./agenda/daponte.js";
import { consultarHistoria, guardarHistoria, historiaDe, resumenHistoria } from "./session/historias.js";
import type { HistoriaTreelan } from "./session/historias.js";
import type { TurnoPayload } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
// 2mb: una ficha de Treelan con 70 consultas ronda los 100kb de JSON, justo el
// default de express.json().
app.use(express.json({ limit: "2mb" }));

// El service worker de la extension postea desde un origen chrome-extension://,
// asi que el POST de la ficha se come un preflight. Esto es un server de dev en
// localhost: mas barato abrirlo que pelearse con CORS.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

// Serve the mic control panel at /
app.use(express.static(join(__dirname, "..", "..", "panel")));

// --- health / status ---
app.get("/health", (_req, res) => {
  res.json({ ok: true, vendors: vendorStatus() });
});

// The agent function schema, handy for the panel / debugging.
app.get("/v1/agent/functions", (_req, res) => {
  res.json(AGENT_FUNCTIONS);
});

// Dr. Daponte's agenda — what the voice agent is allowed to offer.
app.get("/v1/agenda", (req, res) => {
  res.json(agendaCompleta(req.query.callId ? String(req.query.callId) : undefined));
});

// Override one day with what the widget read off the real Treelan grid:
//   POST /v1/agenda/2026-09-28  { "slots": [{"hora":"09:00","estado":"libre"}, …] }
// (`OidoRpa.leerSlots()` in the Treelan tab produces exactly this shape.)
app.post("/v1/agenda/:fecha", (req, res) => {
  const fecha = normalizarFecha(req.params.fecha);
  const slots = (req.body as any)?.slots;
  if (!fecha || !Array.isArray(slots)) {
    res.status(400).json({ ok: false, error: "expected { slots: [{hora, estado}] }" });
    return;
  }
  res.json({ ok: true, dia: reemplazarDia(fecha, slots) });
});

// The Treelan tab pushes a patient chart here whenever the operator opens one.
// That's the "read the patient tab → the voice agent knows them" path: by the
// time the phone rings, the chart is already chunked and indexed in Moss.
app.post("/v1/pacientes/contexto", async (req, res) => {
  try {
    res.json({ ok: true, ...(await guardarHistoria(req.body as HistoriaTreelan)) });
  } catch (err) {
    res.status(400).json({ ok: false, error: (err as Error).message });
  }
});

// What the agent would see for a patient, without making a call. Add ?q=… to
// exercise the retrieval instead of just the summary.
app.get("/v1/pacientes/:documento/contexto", async (req, res) => {
  const documento = String(req.params.documento);
  const historia = historiaDe(documento);
  if (!historia) {
    res.status(404).json({ ok: false, error: "No hay historia cargada para ese documento" });
    return;
  }
  const q = req.query.q ? String(req.query.q) : "";
  res.json({
    ok: true,
    resumen: resumenHistoria(historia),
    relevante: q ? await consultarHistoria(documento, q) : [],
  });
});

// Manual trigger for testing the widget without a live call:
// POST /v1/voice/prepare?callId=demo  with a TurnoPayload body.
app.post("/v1/voice/prepare", (req, res) => {
  const callId = String(req.query.callId ?? "demo");
  const delivered = pushSchedule({
    type: "OIDO_SCHEDULE",
    callId,
    payload: req.body as TurnoPayload,
  });
  res.json({ delivered });
});

// Debug: invoke a Deepgram function handler by name (once vendors are wired).
app.post("/v1/agent/call/:name", async (req, res) => {
  const callId = String(req.query.callId ?? "demo");
  try {
    const result = await dispatchFunction(req.params.name, req.body, { callId });
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// --- server + WS (two paths, routed on upgrade) ---
const server = createServer(app);

// Widget "pull" transport (Treelan content script connects here).
const widgetWss = new WebSocketServer({ noServer: true });
registerWidgetHub(widgetWss);

// Voice agent: the browser mic panel connects here; we bridge it to Deepgram.
const agentWss = new WebSocketServer({ noServer: true });
agentWss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const callId = url.searchParams.get("callId") ?? "demo";
  console.log(`[agent] browser connected callId=${callId}`);
  bridgeBrowserToDeepgram(ws as any, callId);
});

// Close the loop: the widget reports what the RPA managed to do on the Treelan
// page, and that becomes the status of the MedPlum Task the booking created. A
// Task left at `requested` means nobody ever picked the job up.
setRpaResultHandler(async ({ taskId, ok, cargados, error }) => {
  if (!medplum.isConfigured) return;
  await medplum.updateTaskStatus(
    taskId,
    ok ? "completed" : "failed",
    ok
      ? `Treelan form filled${cargados ? ` (${cargados} fields)` : ""}. NOT confirmed — ` +
          "the front desk still has to press Aceptar."
      : `RPA did not complete: ${error ?? "unknown error"}`,
  );
  console.log(`[medplum] Task/${taskId} status=${ok ? "completed" : "failed"}`);
});

server.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  if (pathname === "/v1/voice/stream") {
    widgetWss.handleUpgrade(req, socket, head, (ws) => widgetWss.emit("connection", ws, req));
  } else if (pathname === "/v1/agent") {
    agentWss.handleUpgrade(req, socket, head, (ws) => agentWss.emit("connection", ws, req));
  } else {
    socket.destroy();
  }
});

server.listen(config.port, () => {
  const v = vendorStatus();
  console.log(`\n  Oído backend on http://localhost:${config.port}`);
  console.log(`  mic panel:      http://localhost:${config.port}/`);
  console.log(`  agent WS:       ws://localhost:${config.port}/v1/agent?callId=…`);
  console.log(`  widget WS:      ws://localhost:${config.port}/v1/voice/stream?callId=…`);
  console.log(`  vendors ready:  ${fmt(v)}\n`);
  const missing = Object.entries(v).filter(([, ok]) => !ok).map(([k]) => k);
  if (missing.length) console.log(`  waiting on keys for: ${missing.join(", ")}  (see SETUP.md)\n`);

  // Log in to MedPlum now, so the first `preparar_turno` of a live call isn't
  // also paying for the client-credentials round-trip.
  medplum
    .warmUp()
    .then(() => v.medplum && console.log(`  medplum:        signed in, project ${config.medplum.projectId}\n`))
    .catch((err) => console.error(`  medplum:        sign-in FAILED — ${err.message}\n`));
});

function fmt(v: Record<string, boolean>) {
  return Object.entries(v).map(([k, ok]) => `${ok ? "✓" : "✗"} ${k}`).join("   ");
}
