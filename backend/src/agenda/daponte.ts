/**
 * Dr. Franco Daponte's agenda — the single source of truth for what the voice
 * agent is allowed to offer.
 *
 * Why this file exists: `buscar_disponibilidad` used to return an invented grid
 * of times, so the agent offered slots that don't exist in Treelan and the RPA
 * aborted at fill time ("El horario X no existe en esta agenda"). Now every time
 * the agent says out loud comes from here, and `preparar_turno` refuses anything
 * that isn't a free slot in this table.
 *
 * The demo window is **hardcoded to September 26–29, 2026** (handoff §9.11).
 * Every date the agent produces is coerced to year 2026 — a caller saying
 * "the 28th" or an LLM defaulting to 2025 both land on 2026-09-28.
 *
 * Refreshing this against the live Treelan grid (takes ~30s):
 *   1. Open turno.php for the day with the widget loaded, in the console run:
 *        copy(JSON.stringify(OidoRpa.leerSlots().map(s => ({hora:s.hora, estado:s.estado}))))
 *   2. curl -X POST localhost:8787/v1/agenda/2026-09-28 \
 *        -H 'content-type: application/json' -d '{"slots": <paste>}'
 *   That overrides the day in memory; paste it here to make it permanent.
 */

export const DOCTOR = {
  /** Exactly as it reads in Treelan's Profesional_Select — the RPA matches on this. */
  label: "DAPONTE Franco",
  display: "Dr. Franco Daponte",
  profesionalId: "e3244abc-6a1d-11eb-a788-94de80a26d48",
  sede: "Montañeses",
  sedeId: "cfe6a025-1b9d-102d-b564-6096d05021b3",
  especialidad: "Ophthalmology",
} as const;

/** The demo runs in 2026 and only in 2026. */
export const AGENDA_YEAR = 2026;

export type EstadoSlot = "libre" | "ocupado" | "bloqueado";
export type Franja = "morning" | "afternoon" | "any";

export interface Slot {
  hora: string; // HH:MM, exactly as the Treelan grid renders it
  estado: EstadoSlot;
}

export interface DiaAgenda {
  fecha: string; // YYYY-MM-DD
  slots: Slot[];
}

// --------------------------------------------------------------- construcción

const pad = (n: number) => String(n).padStart(2, "0");

/** Half-hour grid, `desde` inclusive → `hasta` exclusive. Treelan renders HH:MM. */
function grilla(desde: string, hasta: string, paso = 30): string[] {
  const min = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
  const out: string[] = [];
  for (let m = min(desde); m < min(hasta); m += paso) {
    out.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
  }
  return out;
}

function dia(
  fecha: string,
  bloques: Array<[string, string]>,
  ocupados: string[] = [],
  bloqueados: string[] = [],
): DiaAgenda {
  const slots = bloques
    .flatMap(([a, b]) => grilla(a, b))
    .map<Slot>((hora) => ({
      hora,
      estado: ocupados.includes(hora)
        ? "ocupado"
        : bloqueados.includes(hora)
          ? "bloqueado"
          : "libre",
    }));
  return { fecha, slots };
}

/**
 * The four demo days. Consultorio Montañeses, half-hour grid.
 * `ocupados` / `bloqueados` are there so the agenda reads like a real one — the
 * agent can never offer them.
 */
const AGENDA: Record<string, DiaAgenda> = Object.fromEntries(
  [
    // Sábado 26 — sólo turno mañana.
    dia("2026-09-26", [["09:00", "12:00"]], ["10:00", "11:30"]),
    // Domingo 27 — guardia acotada de mañana.
    dia("2026-09-27", [["10:00", "12:30"]], ["10:30"]),
    // Lunes 28 — día completo.
    dia(
      "2026-09-28",
      [
        ["09:00", "13:00"],
        ["14:30", "18:00"],
      ],
      ["09:00", "10:30", "15:00", "16:30"],
      ["13:00"],
    ),
    // Martes 29 — día completo. 11:00 y 12:00 quedan libres a propósito: son el
    // slot canónico de la demo (payload.example.json).
    dia(
      "2026-09-29",
      [
        ["09:00", "13:00"],
        ["14:30", "19:00"],
      ],
      ["09:30", "11:30", "14:30", "17:00"],
    ),
  ].map((d) => [d.fecha, d]),
);

/**
 * Slots already handed to a caller in this process. Keyed `fecha hora` → callId.
 * They stop being offered, but the same call can still re-prepare its own slot
 * (the RPA may need a second run if Treelan hiccups).
 */
const reservados = new Map<string, string>();

const clave = (fecha: string, hora: string) => `${fecha} ${hora}`;

// ------------------------------------------------------------ normalización

const MESES: Record<string, number> = {
  enero: 1, ene: 1, january: 1, jan: 1,
  febrero: 2, feb: 2, february: 2,
  marzo: 3, mar: 3, march: 3,
  abril: 4, abr: 4, april: 4, apr: 4,
  mayo: 5, may: 5,
  junio: 6, jun: 6, june: 6,
  julio: 7, jul: 7, july: 7,
  agosto: 8, ago: 8, august: 8, aug: 8,
  septiembre: 9, setiembre: 9, sep: 9, sept: 9, september: 9,
  octubre: 10, oct: 10, october: 10,
  noviembre: 11, nov: 11, november: 11,
  diciembre: 12, dic: 12, december: 12, dec: 12,
};

const iso = (mes: number, d: number) => `${AGENDA_YEAR}-${pad(mes)}-${pad(d)}`;

/**
 * Anything the caller or the LLM can say for a date → `2026-MM-DD`.
 * The year is **always** forced to 2026: whatever year arrives is discarded.
 */
export function normalizarFecha(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;

  // 2025-09-28 / 2026-9-28 → year ignored on purpose.
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(Number(m[2]), Number(m[3]));

  // "september 28", "sept. 28"
  m = s.match(/([a-záéíóúñ]{3,})\.?\s+(\d{1,2})/);
  if (m && MESES[m[1]]) return iso(MESES[m[1]], Number(m[2]));

  // "28 de septiembre", "28 september"
  m = s.match(/(\d{1,2})\s+(?:de\s+)?([a-záéíóúñ]{3,})/);
  if (m && MESES[m[2]]) return iso(MESES[m[2]], Number(m[1]));

  // 9/28, 28/09, 28-09-2025
  m = s.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-]\d{2,4})?$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12) return iso(b, a); // DD/MM
    return iso(a, b); // MM/DD (the agent speaks English)
  }

  // "the 28th", "28" → the demo window is September, so assume it.
  m = s.match(/^(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?$/);
  if (m) return iso(9, Number(m[1]));

  return null;
}

/** "9", "9:30", "2 pm", "14:00", "noon" → "HH:MM". Never rounds to a nearby slot. */
export function normalizarHora(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase().replace(/\./g, "");
  if (/^(noon|mediodia|mediodía)$/.test(s)) return "12:00";

  const m = s.match(/^(\d{1,2})(?:[:h](\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  // No am/pm and an hour the clinic can't mean in the morning: 1–6 → afternoon.
  if (!m[3] && h >= 1 && h <= 6) h += 12;
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}

export function normalizarFranja(raw: unknown): Franja {
  const s = String(raw ?? "any").trim().toLowerCase();
  if (/^(morning|ma[nñ]ana|am)$/.test(s)) return "morning";
  if (/^(afternoon|tarde|evening|pm)$/.test(s)) return "afternoon";
  return "any";
}

export const franjaDe = (hora: string): Exclude<Franja, "any"> =>
  Number(hora.slice(0, 2)) < 13 ? "morning" : "afternoon";

// -------------------------------------------------------------------- consulta

const FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * "Monday, September 28, 2026" — what the agent should say out loud.
 * A garbled date (a mis-parsed "13/45" lands on 2026-45-13) falls back to the
 * raw string instead of throwing: the caller is mid-call and deserves the
 * "here are the open days" answer, not a tool error.
 */
export function etiquetaDia(fecha: string): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? fecha : FMT.format(d);
}

export function diaDeAgenda(fecha: string): DiaAgenda | null {
  return AGENDA[fecha] ?? null;
}

/** Every day the doctor actually works in the demo window. */
export function diasAbiertos(): string[] {
  return Object.keys(AGENDA).sort();
}

export function slotsLibres(
  fecha: string,
  franja: Franja = "any",
  callId?: string,
): string[] {
  const d = diaDeAgenda(fecha);
  if (!d) return [];
  return d.slots
    .filter((s) => s.estado === "libre")
    .filter((s) => franja === "any" || franjaDe(s.hora) === franja)
    .filter((s) => {
      const owner = reservados.get(clave(fecha, s.hora));
      return !owner || owner === callId;
    })
    .map((s) => s.hora);
}

export type EstadoConsulta = EstadoSlot | "inexistente" | "sin-agenda" | "tomado";

/** What `preparar_turno` checks before pushing anything to the widget. */
export function estadoDeSlot(
  fecha: string,
  hora: string,
  callId?: string,
): EstadoConsulta {
  const d = diaDeAgenda(fecha);
  if (!d) return "sin-agenda";
  const slot = d.slots.find((s) => s.hora === hora);
  if (!slot) return "inexistente";
  if (slot.estado !== "libre") return slot.estado;
  const owner = reservados.get(clave(fecha, hora));
  if (owner && owner !== callId) return "tomado";
  return "libre";
}

/** Hold a slot for this call so a later call in the same demo isn't offered it. */
export function reservar(fecha: string, hora: string, callId: string): void {
  reservados.set(clave(fecha, hora), callId);
}

export function liberar(fecha: string, hora: string): void {
  reservados.delete(clave(fecha, hora));
}

/** Compact summary of the whole window — what the agent offers when a day is closed. */
export function resumenDias(callId?: string) {
  return diasAbiertos().map((fecha) => {
    const libres = slotsLibres(fecha, "any", callId);
    return {
      fecha,
      dia: etiquetaDia(fecha),
      libres: libres.length,
      primeros: libres.slice(0, 3),
    };
  });
}

/** Live override with what `OidoRpa.leerSlots()` read off the real grid. */
export function reemplazarDia(
  fecha: string,
  slots: Array<Slot | string>,
): DiaAgenda {
  const norm: Slot[] = slots
    .map((s) =>
      typeof s === "string"
        ? { hora: normalizarHora(s) ?? "", estado: "libre" as EstadoSlot }
        : { hora: normalizarHora(s.hora) ?? "", estado: s.estado ?? "libre" },
    )
    .filter((s) => s.hora);
  AGENDA[fecha] = { fecha, slots: norm };
  return AGENDA[fecha];
}

/** Whole table, for `GET /v1/agenda` and the panel. */
export function agendaCompleta(callId?: string) {
  return {
    doctor: DOCTOR,
    year: AGENDA_YEAR,
    dias: diasAbiertos().map((fecha) => ({
      fecha,
      dia: etiquetaDia(fecha),
      slots: diaDeAgenda(fecha)!.slots,
      libres: slotsLibres(fecha, "any", callId),
    })),
  };
}
