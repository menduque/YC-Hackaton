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
  fichaUrl: "paciente.php?p_id=3338b906-1c64-11e6-9f15-94de80a26d48&id=112708",
};

/** Recorte real de la ficha de Treelan, con la forma que devuelve leerHistoria(). */
const HISTORIA = {
  hc: "112708",
  nombreCompleto: "DAPONTE, Cristobal",
  apellido: "DAPONTE",
  nombre: "Cristobal",
  documento: "41172745",
  fechaNacimiento: "04-05-1998",
  edad: "28",
  telefono: "1136842006",
  celular: "1136842006",
  domicilio: "cespedes 1244 1°B - Tigre",
  cobertura: "OSDE",
  plan: "310",
  nroAfiliado: "60814320005",
  primeraVisita: "17-05-2016",
  ultimaVisita: "30-06-2026",
  antecedentes: [
    { texto: "miopía", desde: "11-06-2026" },
    { texto: "glaucoma", desde: "11-06-2026" },
    { texto: "PRUEBA OIDO - BORRAR", desde: "11-06-2026" },
    { texto: "tratamiento con warfarina", desde: "12-06-2026" },
    { texto: "diabetes tipo 2", desde: "17-06-2026" },
    { texto: "traumatismo OI (taponazo, fútbol)", desde: "23-07-2026" },
  ],
  consultas: [
    {
      fecha: "30-07-2026",
      hora: "19:54:06",
      profesional: "DAPONTE, Franco",
      texto:
        "Se indico solicitud medica\n- Diagnóstico: H509 - Estrabismo, no especificado\n" +
        "- Observaciones: AV SC OD 10/20 OI 10/20. BMC sp FO normal AO.",
    },
    {
      fecha: "29-07-2026",
      hora: "20:23:50",
      profesional: "DAPONTE, Franco",
      texto:
        "Motivo de Consulta: Traumatismo ocular por impacto durante partido de fútbol, " +
        "pérdida total de visión en OD.\nReposo durante 2 semanas. Hialuronato en gotas, " +
        "1 gota cada 8 horas durante 2 semanas.",
    },
    {
      fecha: "22-07-2026",
      hora: "16:28:07",
      profesional: "DAPONTE, Franco",
      texto: "Receta Anteojos Lejos. OD 0.00 -0.75 95 / OI 0.00 -0.50 80.\nDiagnóstico: Astigmatismo",
    },
  ],
  secciones: [
    { titulo: "Quirurgico", texto: "25-02-2026 - Cirujano: ALVAREZ BLANCHET Fernanda" },
  ],
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
  if (msg.type === "OIDO_LEER_HISTORIA") {
    console.log(`  ← widget got OIDO_LEER_HISTORIA id=${msg.id}`, msg.payload);
    ws.send(JSON.stringify({ type: "OIDO_RESULT", id: msg.id, ok: true, result: HISTORIA }));
  }
  if (msg.type === "OIDO_SCHEDULE") schedule = msg.payload;
});

ws.on("open", async () => {
  console.log("fake widget connected\n");

  console.log("1) buscar_paciente 41.172.745 (real round-trip through the WS)");
  console.log(JSON.stringify(await call("buscar_paciente", { documento: "41.172.745" }), null, 2));

  console.log("\n2) buscar_paciente 99999999 (two matches → must ask, not guess)");
  console.log(JSON.stringify(await call("buscar_paciente", { documento: "99999999" }), null, 2));

  console.log("\n3) buscar_paciente 30111222 (no match)");
  console.log(JSON.stringify(await call("buscar_paciente", { documento: "30111222" }), null, 2));

  // Re-identify, then book without re-dictating anything.
  await call("buscar_paciente", { documento: "41172745" });

  // buscar_paciente dispara la lectura de la ficha sin esperarla; darle el
  // respiro que en una llamada real se lo da el saludo del agente.
  await new Promise((r) => setTimeout(r, 500));

  console.log("\n4) obtener_contexto_paciente — resumen, sin decir el documento");
  const ctx: any = await call("obtener_contexto_paciente", {});
  console.log(ctx.result.resumen);

  // El agente habla en ingles pero la historia esta en castellano, asi que
  // manda la pregunta traducida (ver agentConfig).
  console.log('\n5) obtener_contexto_paciente — "qué me indicó el doctor por el golpe en el ojo"');
  const rag: any = await call("obtener_contexto_paciente", {
    consulta: "qué me indicó el doctor por el golpe en el ojo jugando al fútbol",
  });
  for (const h of rag.result.relevante) {
    console.log(`   ${h.score.toFixed(3)} [${h.source ?? "?"}] ${h.text.replace(/\s+/g, " ").slice(0, 110)}…`);
  }

  console.log("\n6) preparar_turno with NO patient object — filled from the lookup");
  const turno: any = await call("preparar_turno", {
    fecha: "2026-09-29",
    hora: "12:00",
    cobertura: "OSDE",
    usaLC: false,
    comentarios: "Blurry vision at distance for a month.",
  });
  console.log(`   delivered=${turno.result.delivered} faltantes=${JSON.stringify(turno.result.faltantes)}`);

  await new Promise((r) => setTimeout(r, 300));
  console.log("\n   OIDO_SCHEDULE payload the extension would fill into Treelan:");
  console.log(JSON.stringify(schedule, null, 2));

  ws.close();
  process.exit(0);
});

ws.on("error", (e) => {
  console.error("fake widget could not connect:", e.message);
  process.exit(1);
});
