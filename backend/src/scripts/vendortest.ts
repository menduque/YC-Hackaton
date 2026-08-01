/**
 * Smoke-test the vendor clients through the same handlers the Deepgram agent
 * calls. Run: `npx tsx src/scripts/vendortest.ts`
 *
 * Anything unconfigured reports as SKIP rather than failing, so this is safe to
 * run at any point during setup.
 */
import { vendorStatus } from "../config.js";
import { dispatchFunction } from "../functions/index.js";
import { resolveFixture } from "../clients/stedi.js";

const ctx = { callId: "vendortest" };

function heading(s: string) {
  console.log(`\n\x1b[1m${s}\x1b[0m`);
}

console.log("vendor status:", vendorStatus());

heading("payer → Stedi fixture mapping");
for (const payer of ["OSDE", "Swiss Medical", "Galeno", "PAMI", "Particular", "Cobertura Rara"]) {
  const { mock, matched } = resolveFixture(payer);
  console.log(`  ${payer.padEnd(16)} → ${mock.id.padEnd(28)} ${matched ? "" : "(fallback)"}`);
}

heading("verificar_cobertura (real Stedi test-mode call)");
try {
  const res: any = await dispatchFunction("verificar_cobertura", { payer: "OSDE" }, ctx);
  console.log(`  eligible   ${res.eligible}`);
  console.log(`  payer      ${res.payerName}  (fixture ${res.fixtureId})`);
  console.log(`  mode       ${res.applicationMode}`);
  console.log(`  summary    ${res.summary}`);
  console.log(`  copays     ${res.copays.map((c: any) => `${c.service} $${c.amount}`).join(" | ")}`);
} catch (err) {
  console.log(`  SKIP/FAIL: ${(err as Error).message}`);
}

heading("verificar_cobertura — inactive coverage");
try {
  const res: any = await dispatchFunction("verificar_cobertura", { payer: "Particular" }, ctx);
  console.log(`  eligible   ${res.eligible}`);
  console.log(`  summary    ${res.summary}`);
} catch (err) {
  console.log(`  SKIP/FAIL: ${(err as Error).message}`);
}

heading("buscar_disponibilidad — a day Dr. Daponte works");
console.log(" ", await dispatchFunction("buscar_disponibilidad", { fecha: "2026-09-29" }, ctx));

heading("buscar_disponibilidad — a day he doesn't (must offer the open days)");
console.log(" ", await dispatchFunction("buscar_disponibilidad", { fecha: "2025-08-05" }, ctx));

heading("investigar_problema (Moss)");
try {
  console.log(" ", await dispatchFunction("investigar_problema", { sintoma: "dolor de cabeza" }, ctx));
} catch (err) {
  console.log(`  SKIP/FAIL: ${(err as Error).message}`);
}

heading("obtener_contexto_paciente (Moss + MedPlum)");
try {
  const res: any = await dispatchFunction("obtener_contexto_paciente", { documento: "30111222" }, ctx);
  console.log(`  moss    ${res.history.status}`, res.history.reason?.message ?? "");
  console.log(`  medplum ${res.fhir.status}`, res.fhir.reason?.message ?? "");
} catch (err) {
  console.log(`  SKIP/FAIL: ${(err as Error).message}`);
}

heading("medplum write (Appointment + Communication) — pass --write to run");
if (process.argv.includes("--write")) {
  try {
    const { medplum } = await import("../clients/medplum.js");
    const res = await medplum.writeAppointmentAndCommunication({
      callId: "vendortest",
      turno: {
        fecha: "2026-08-05",
        hora: "14:30",
        doctor: "Dra. Daponte",
        motivo: "Consulta",
        comentarios:
          "Paciente refiere cefalea recurrente de dos semanas. Antecedente de HTA. Solicita control.",
        paciente: {
          apellido: "Pérez",
          nombre: "Ana",
          tipoDoc: "DNI",
          documento: "30111222",
        },
      },
    });
    console.log(`  Appointment/${res.appointmentId}  (status: proposed — NOT booked)`);
    console.log(`  Communication/${res.communicationId}`);
  } catch (err) {
    console.log(`  SKIP/FAIL: ${(err as Error).message}`);
  }
} else {
  console.log("  skipped (creates real resources) — rerun with --write");
}

heading("preparar_turno — slot outside the agenda (must be refused)");
console.log(
  " ",
  await dispatchFunction(
    "preparar_turno",
    {
      fecha: "2026-09-29",
      hora: "10:15",
      paciente: { apellido: "Pérez", nombre: "Ana", tipoDoc: "DNI", documento: "30111222" },
    },
    ctx,
  ),
);

heading("preparar_turno (no widget connected — should still succeed)");
console.log(
  " ",
  await dispatchFunction(
    "preparar_turno",
    {
      fecha: "2026-09-29",
      hora: "12:00",
      paciente: {
        apellido: "Pérez",
        nombre: "Ana",
        tipoDoc: "DNI",
        documento: "30111222",
        celular: "11 5555-1234",
        email: "ana@demo.ai",
      },
      cobertura: "OSDE",
      motivo: "Consulta",
      usaLC: true,
      comentarios: "Visión borrosa hace dos semanas. Usa lentes de contacto.",
    },
    ctx,
  ),
);

process.exit(0);
