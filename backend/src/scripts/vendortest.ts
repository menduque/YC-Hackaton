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

// Note the `--`: `npm run vendortest --write` swallows the flag as an npm config
// and silently skips this block.
heading("medplum write (Patient → Appointment → Task → Communication) — `npm run vendortest -- --write`");
if (process.argv.includes("--write")) {
  try {
    const { medplum } = await import("../clients/medplum.js");
    const turno = {
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
    };

    // Stage A: the mid-call upsert, with only what buscar_paciente knows.
    const early = await medplum.upsertPatient(turno.paciente, { hc: "112708" });
    console.log(`  Patient/${early.id}  (stage A — identified mid-call)`);

    // Stage B: the same Patient topped up with everything the call produced. The
    // address must survive even though stage A never carried one — that's the
    // merge bug this guards against.
    const full = await medplum.upsertPatient(
      { ...turno.paciente, domicilio: "Av. Montañeses 2500, CABA", celular: "11 5555-1234" },
      { patientId: early.id, hc: "112708" },
    );
    console.log(`  Patient/${full.id}  (stage B — same id? ${full.id === early.id ? "yes" : "NO — BUG"})`);
    console.log(`    identifiers ${full.identifier?.map((i) => `${i.system?.split("/").pop()}=${i.value}`).join(" ")}`);
    console.log(`    address     ${full.address?.[0]?.text ?? "(none)"}`);

    const appointment = await medplum.createAppointment({ turno, patientId: full.id, callId: "vendortest" });
    console.log(`  Appointment/${appointment.id}  (status: proposed — NOT booked)`);

    const task = await medplum.createBookingTask({
      turno,
      appointmentId: appointment.id as string,
      patientId: full.id,
      callId: "vendortest",
    });
    console.log(`  Task/${task.id}  (status: ${task.status})`);

    const done = await medplum.updateTaskStatus(task.id as string, "completed", "vendortest run");
    console.log(`  Task/${done.id}  → ${done.status}`);

    const comm = await medplum.createCommunication({
      turno,
      patientId: full.id,
      appointmentId: appointment.id,
      callId: "vendortest",
    });
    console.log(`  Communication/${comm?.id}`);

    // The projection the RPA actually fills into Treelan.
    console.log("  fhirPatientToTurno →", JSON.stringify(medplum.fhirPatientToTurno(full, turno.paciente)));
  } catch (err) {
    console.log(`  SKIP/FAIL: ${(err as Error).message}`);
  }
} else {
  console.log("  skipped (creates real resources) — rerun with: npm run vendortest -- --write");
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
