/**
 * Fake widget: exercises the backend↔widget request/response channel without
 * Chrome in the loop.
 *
 * Connects on the widget WS, answers OIDO_BUSCAR_PACIENTE with canned Treelan
 * rows, then drives buscar_paciente + preparar_turno over HTTP and prints the
 * OIDO_SCHEDULE payload the real extension would receive.
 *
 *   npx tsx src/scripts/widgetLoopback.ts
 */
import WebSocket from "ws";

const BASE = process.env.OIDO_BASE ?? "http://localhost:8787";
const CALL_ID = "loopback";

const FILA = {
  hc: "112708",
  apellido: "DAPONTE",
  nombre: "Cristobal",
  nombreCompleto: "DAPONTE, Cristobal",
  dni: "41172745",
  fechaNacimiento: "04-05-1998",
  domicilio: "cespedes 1244 1°B",
  estado: "--",
  procedencia: "Barrio",
};

/** Stands in for Treelan: exact-match on the document, like the real grid. */
function buscar(dni: string) {
  const pacientes = dni === FILA.dni ? [FILA] : dni === "99999999" ? [FILA, FILA] : [];
  return { encontrado: pacientes.length > 0, cantidad: pacientes.length, pacientes };
}

async function call(name: string, body: unknown) {
  const res = await fetch(`${BASE}/v1/agent/call/${name}?callId=${CALL_ID}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

const ws = new WebSocket(`${BASE.replace("http", "ws")}/v1/voice/stream?callId=${CALL_ID}`);
let schedule: any = null;
let refs: any = null;

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === "OIDO_BUSCAR_PACIENTE") {
    console.log(`  ← widget got OIDO_BUSCAR_PACIENTE id=${msg.id}`, msg.payload);
    ws.send(
      JSON.stringify({
        type: "OIDO_RESULT",
        id: msg.id,
        ok: true,
        result: buscar(msg.payload.dni),
      }),
    );
  }
  if (msg.type === "OIDO_SCHEDULE") {
    schedule = msg.payload;
    refs = msg.medplum ?? null;
    // Stand in for the real RPA finishing on the Treelan page: the widget reports
    // back and the backend closes the MedPlum Task. Unsolicited and correlated by
    // taskId, because the real fill crosses a full page navigation.
    if (refs?.taskId) {
      ws.send(
        JSON.stringify({ type: "OIDO_RPA_RESULT", taskId: refs.taskId, ok: true, cargados: 11 }),
      );
    }
  }
});

ws.on("open", async () => {
  console.log("fake widget connected\n");

  console.log("1) buscar_paciente 41.172.745 (real round-trip through the WS)");
  console.log(JSON.stringify(await call("buscar_paciente", { documento: "41.172.745" }), null, 2));

  console.log("\n2) buscar_paciente 99999999 (two matches → must ask, not guess)");
  console.log(JSON.stringify(await call("buscar_paciente", { documento: "99999999" }), null, 2));

  console.log("\n3) buscar_paciente 30111222 (no match)");
  console.log(JSON.stringify(await call("buscar_paciente", { documento: "30111222" }), null, 2));

  // Re-identify and book immediately, WITHOUT awaiting the mid-call MedPlum
  // upsert that identification kicks off. That overlap is the lost-update race:
  // if the two Patient writes aren't serialized, the mobile number below gets
  // silently dropped by whichever write lands second.
  void call("buscar_paciente", { documento: "41172745" });
  console.log("\n4) preparar_turno with NO patient object — filled from the lookup");
  const turno: any = await call("preparar_turno", {
    fecha: "2026-09-29",
    hora: "12:00",
    cobertura: "OSDE",
    usaLC: false,
    comentarios: "Blurry vision at distance for a month.",
    // Only the call knows this — Treelan's chart doesn't have it. It must
    // survive on the Patient no matter which upsert finishes last.
    paciente: { celular: "11 5555-1234" },
  });
  console.log(`   delivered=${turno.result.delivered} faltantes=${JSON.stringify(turno.result.faltantes)}`);
  console.log(`   medplum=${JSON.stringify(turno.result.medplum)}`);

  await new Promise((r) => setTimeout(r, 600));
  console.log("\n   OIDO_SCHEDULE payload the extension would fill into Treelan:");
  console.log(JSON.stringify(schedule, null, 2));
  console.log(
    "\n   MedPlum refs on that message:",
    refs
      ? JSON.stringify(refs)
      : "none — MedPlum unconfigured or too slow, so the RPA got the locally built payload",
  );

  ws.close();
  process.exit(0);
});

ws.on("error", (e) => {
  console.error("fake widget could not connect:", e.message);
  process.exit(1);
});
