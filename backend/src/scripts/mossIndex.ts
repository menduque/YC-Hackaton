/**
 * Build the Moss index the agent retrieves from at conversation time.
 * Run once: `npm run moss:index`
 *
 * Two kinds of document:
 *  - `kb`      — small triage//scheduling knowledge base, so `investigar_problema`
 *                can ground what it says instead of improvising.
 *  - `historia`— demo patient history, so `obtener_contexto_paciente` has
 *                something to find. Synthetic — no real patient data.
 *
 * Indexing is deliberately offline: it takes seconds, and doing it inside a live
 * call would stall the conversation.
 */
import { CLINICAL_INDEX, moss } from "../clients/moss.js";

const docs: { id: string; text: string; metadata?: Record<string, string> }[] = [
  // --- Triage / scheduling knowledge base ---------------------------------
  {
    id: "kb-cefalea",
    text: "Dolor de cabeza (cefalea): la mayoría son tensionales y se manejan en consulta ambulatoria con clínica general. Señales de alarma que requieren atención urgente el mismo día: dolor súbito e intensísimo, fiebre alta con rigidez de nuca, déficit neurológico, confusión, o dolor tras un golpe en la cabeza.",
    metadata: { kind: "kb", tema: "cefalea", especialidad: "clinica" },
  },
  {
    id: "kb-dolor-pecho",
    text: "Dolor de pecho: no se agenda como consulta programada. Opresión en el pecho, dolor que irradia a brazo o mandíbula, sudoración o falta de aire requieren emergencias inmediatamente. Indicar al paciente que consulte a una guardia.",
    metadata: { kind: "kb", tema: "dolor toracico", especialidad: "emergencias" },
  },
  {
    id: "kb-control",
    text: "Consulta de control o chequeo anual: se agenda con clínica general, dura 30 minutos, y conviene traer estudios previos y la lista de medicación actual. No requiere ayuno salvo que se pidan análisis de sangre.",
    metadata: { kind: "kb", tema: "control", especialidad: "clinica" },
  },
  {
    id: "kb-ayuno",
    text: "Análisis de sangre de rutina: requieren ayuno de 8 a 12 horas. Se puede tomar agua. La medicación habitual se mantiene salvo indicación médica en contrario.",
    metadata: { kind: "kb", tema: "laboratorio" },
  },
  {
    id: "kb-dermatologia",
    text: "Lunares, manchas o lesiones en la piel: se derivan a dermatología. Si el lunar cambió de color, tamaño o forma, o sangra, se prioriza el turno.",
    metadata: { kind: "kb", tema: "piel", especialidad: "dermatologia" },
  },
  {
    id: "kb-pediatria",
    text: "Pacientes menores de 16 años: se agendan con pediatría y deben venir acompañados por madre, padre o tutor con documento.",
    metadata: { kind: "kb", tema: "pediatria", especialidad: "pediatria" },
  },
  {
    id: "kb-documentacion",
    text: "Para el turno hay que traer DNI y credencial de la obra social. Si la cobertura figura inactiva, el turno se agenda igual y la recepción lo verifica antes de la consulta.",
    metadata: { kind: "kb", tema: "administrativo" },
  },
  {
    id: "kb-cancelacion",
    text: "Cancelaciones y reprogramaciones: avisar con al menos 24 horas de anticipación. Los turnos se confirman por recepción; el sistema deja el turno preparado pero no confirmado.",
    metadata: { kind: "kb", tema: "administrativo" },
  },

  // --- Synthetic demo patient history -------------------------------------
  {
    id: "historia-30111222-1",
    text: "Paciente DNI 30111222, Ana Pérez, 41 años. Antecedentes: hipertensión arterial diagnosticada en 2023, migraña episódica. Medicación actual: enalapril 10mg por día.",
    metadata: { kind: "historia", documento: "30111222", source: "demo" },
  },
  {
    id: "historia-30111222-2",
    text: "Ana Pérez, última consulta en marzo de 2026 por cefalea recurrente. Se indicó control de presión arterial y seguimiento en tres meses. Presión registrada 138/88.",
    metadata: { kind: "historia", documento: "30111222", source: "demo" },
  },
  {
    id: "historia-30111222-3",
    text: "Ana Pérez: alergia registrada a penicilina. No fumadora. Sin cirugías previas.",
    metadata: { kind: "historia", documento: "30111222", source: "demo" },
  },
];

if (!moss.isConfigured) {
  console.error("Moss not configured — set MOSS_PROJECT_ID and MOSS_PROJECT_KEY (SETUP.md §4)");
  process.exit(1);
}

console.log(`Building "${CLINICAL_INDEX}" with ${docs.length} documents…`);
await moss.buildIndex(CLINICAL_INDEX, docs);
console.log("done.");

// Prove it's queryable before we call it a success.
for (const q of ["me duele mucho la cabeza", "¿tengo que venir en ayunas?", "Ana Pérez presión"]) {
  const hits = await moss.retrieve(q, { k: 2 });
  console.log(`\n"${q}"`);
  for (const h of hits) console.log(`  ${h.score.toFixed(3)}  ${h.text.slice(0, 90)}…`);
}

process.exit(0);
