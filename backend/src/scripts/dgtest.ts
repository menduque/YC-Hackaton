// Quick liveness check: connect to Deepgram Voice Agent, send Settings, report
// what comes back. Run: npx tsx src/scripts/dgtest.ts
import WebSocket from "ws";
import { config } from "../config.js";
import { buildAgentSettings } from "../deepgram/agentConfig.js";

const dg = new WebSocket("wss://agent.deepgram.com/v1/agent/converse", {
  headers: { Authorization: `Token ${config.deepgram.apiKey}` },
});

const timer = setTimeout(() => {
  console.log("timeout — no terminal event in 8s");
  dg.close();
  process.exit(1);
}, 8000);

dg.on("open", () => {
  console.log("open → sending Settings");
  dg.send(JSON.stringify(buildAgentSettings()));
});
dg.on("message", (d, isBinary) => {
  if (isBinary) {
    console.log("← binary audio chunk", (d as Buffer).length, "bytes (greeting TTS)");
    return;
  }
  const evt = JSON.parse(d.toString());
  console.log("←", evt.type, evt.type === "Error" ? JSON.stringify(evt) : "");
  if (evt.type === "SettingsApplied") console.log("✅ Settings accepted by Deepgram");
  if (evt.type === "Error") {
    clearTimeout(timer);
    dg.close();
    process.exit(1);
  }
});
dg.on("close", (c) => { console.log("closed", c); clearTimeout(timer); process.exit(0); });
dg.on("error", (e) => { console.error("ws error:", e.message); process.exit(1); });

// close a bit after greeting audio starts
setTimeout(() => dg.close(), 5000);
