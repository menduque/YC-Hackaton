import { matchPorPalabras, moss } from "../clients/moss.js";

/**
 * Memoria de historias clinicas leidas de Treelan.
 *
 * La ficha del paciente (paciente.php) trae 70 consultas, 54 antecedentes y seis
 * solapas mas: ~35.000 caracteres. Eso no entra en el prompt del agente de voz y
 * tampoco conviene — el 99% no tiene nada que ver con lo que el paciente esta
 * preguntando. Asi que la ficha se parte en documentos y se indexa en Moss:
 * durante la llamada el agente recupera los tres o cuatro pedazos que importan.
 *
 * Dos caminos llegan aca (ver widget/content.js):
 *  - el operador abre la pestania de un paciente en Treelan, y
 *  - buscar_paciente identifica a quien llama y precarga su ficha.
 *
 * El indice es por paciente (`oido-hc-<documento>`) en vez de uno solo con todos:
 * `buildIndex` reemplaza el indice entero, asi que compartirlo obligaria a
 * reindexar a todos los pacientes cada vez que se lee una ficha. Ademas
 * `buildIndex` deja el indice cargado en memoria, y con eso la consulta durante
 * la llamada es local (~1ms) en lugar de un round-trip a la nube.
 */

export interface Antecedente {
  texto: string;
  desde?: string;
}

export interface ConsultaHC {
  fecha: string;
  hora?: string;
  profesional?: string;
  texto: string;
}

export interface SeccionFicha {
  titulo: string;
  texto: string;
}

/** Lo que devuelve `OidoRpa.leerHistoria()` en la pestania de Treelan. */
export interface HistoriaTreelan {
  hc?: string;
  nombreCompleto?: string;
  apellido?: string;
  nombre?: string;
  documento?: string;
  fechaNacimiento?: string;
  edad?: string;
  telefono?: string;
  celular?: string;
  domicilio?: string;
  cobertura?: string;
  plan?: string;
  nroAfiliado?: string;
  primeraVisita?: string;
  ultimaVisita?: string;
  antecedentes?: Antecedente[];
  consultas?: ConsultaHC[];
  secciones?: SeccionFicha[];
  leidoEn?: string;
}

export interface DocHistoria {
  id: string;
  text: string;
  metadata: Record<string, string>;
}

interface Guardada {
  historia: HistoriaTreelan;
  documento: string;
  docs: DocHistoria[];
  index: string;
  enMoss: boolean;
}

const porDocumento = new Map<string, Guardada>();

/** Los DNI llegan dictados por voz ("41.172.745") y desde Treelan sin puntos. */
export const normalizarDoc = (v: unknown) => String(v ?? "").replace(/[.\s-]/g, "").trim();

export const indiceDe = (documento: string) => `oido-hc-${normalizarDoc(documento)}`;

/**
 * Guarda la ficha y la indexa. Nunca lanza por culpa de Moss: si el vendor no
 * esta configurado o falla, la historia igual queda en memoria y las consultas
 * caen al matcher por palabras de mas abajo. Una llamada en vivo no se puede
 * quedar sin contexto porque se cayo un indice.
 */
export async function guardarHistoria(historia: HistoriaTreelan) {
  const documento = normalizarDoc(historia.documento);
  if (!documento) throw new Error("La historia no trae documento");

  const docs = documentos(historia, documento);
  const index = indiceDe(documento);
  const guardada: Guardada = { historia, documento, docs, index, enMoss: false };
  porDocumento.set(documento, guardada);

  if (moss.isConfigured) {
    try {
      await moss.buildIndex(index, docs);
      guardada.enMoss = true;
    } catch (err) {
      console.warn(`[historia] Moss no pudo indexar ${index}: ${(err as Error).message}`);
    }
  }

  return {
    documento,
    hc: historia.hc ?? "",
    paciente: historia.nombreCompleto ?? "",
    consultas: historia.consultas?.length ?? 0,
    antecedentes: historia.antecedentes?.length ?? 0,
    docs: docs.length,
    index,
    moss: guardada.enMoss,
  };
}

export function historiaDe(documento: string): HistoriaTreelan | undefined {
  return porDocumento.get(normalizarDoc(documento))?.historia;
}

export function hayHistoria(documento: string): boolean {
  return porDocumento.has(normalizarDoc(documento));
}

/**
 * Lo que el agente recupera en la llamada. `pregunta` es lo que dijo el paciente
 * ("¿tengo que seguir con las gotas?"), no un keyword armado por nosotros: Moss
 * es semantico y le rinde mas la frase entera.
 */
export async function consultarHistoria(documento: string, pregunta: string, k = 4) {
  const guardada = porDocumento.get(normalizarDoc(documento));
  if (!guardada) return [];

  if (guardada.enMoss) {
    try {
      const hits = await moss.retrieve(pregunta, { k, index: guardada.index });
      if (hits.length) return hits.map((h) => ({ text: h.text, score: h.score, source: h.source }));
    } catch (err) {
      console.warn(`[historia] Moss fallo al consultar: ${(err as Error).message}`);
    }
  }
  return matchPorPalabras(guardada.docs, pregunta, k);
}

/**
 * Ficha de un vistazo, para que el agente sepa con quien habla sin tener que
 * preguntarle nada a Moss. Va acotado a proposito: es contexto para una
 * conversacion, no un resumen clinico.
 */
export function resumenHistoria(historia: HistoriaTreelan, opts?: { consultas?: number }) {
  const h = historia;
  const partes: string[] = [];

  const quien = [h.nombreCompleto, h.hc && `HC ${h.hc}`, h.edad && `${h.edad} años`]
    .filter(Boolean)
    .join(", ");
  if (quien) partes.push(quien + ".");
  if (h.cobertura) partes.push(`Cobertura: ${[h.cobertura, h.plan && `plan ${h.plan}`].filter(Boolean).join(" ")}.`);
  if (h.primeraVisita || h.ultimaVisita) {
    partes.push(
      `Primera visita ${h.primeraVisita || "?"}, última ${h.ultimaVisita || "?"}` +
        ` (${h.consultas?.length ?? 0} consultas registradas).`,
    );
  }

  const ant = antecedentesRelevantes(h.antecedentes ?? []);
  if (ant.length) partes.push(`Antecedentes: ${ant.map((a) => a.texto).join("; ")}.`);

  const ultimas = (h.consultas ?? []).slice(0, opts?.consultas ?? 3);
  if (ultimas.length) {
    partes.push("Últimas consultas:");
    for (const c of ultimas) partes.push(`- ${c.fecha} (${c.profesional ?? "s/d"}): ${unaLinea(c.texto, 220)}`);
  }

  return partes.join("\n");
}

// ------------------------------------------------------------------ documentos

/**
 * Un documento por consulta (mas antecedentes y solapas). Ese es el grano que
 * quiere el agente: recupera "la consulta del 29 de julio" entera, no una
 * oracion suelta que no se entiende sin el resto.
 */
function documentos(h: HistoriaTreelan, documento: string): DocHistoria[] {
  const base = { documento, hc: h.hc ?? "", paciente: h.nombreCompleto ?? "" };
  const docs: DocHistoria[] = [
    {
      id: "ficha",
      text: [
        `${h.nombreCompleto ?? ""} (HC ${h.hc ?? ""}, DNI ${documento}).`,
        h.fechaNacimiento && `Nacimiento ${h.fechaNacimiento}${h.edad ? `, ${h.edad} años` : ""}.`,
        h.cobertura && `Cobertura ${h.cobertura}${h.plan ? ` plan ${h.plan}` : ""}${h.nroAfiliado ? `, afiliado ${h.nroAfiliado}` : ""}.`,
        h.domicilio && `Domicilio ${h.domicilio}.`,
        (h.telefono || h.celular) && `Teléfono ${h.telefono || h.celular}.`,
        (h.primeraVisita || h.ultimaVisita) &&
          `Primera visita ${h.primeraVisita || "?"}, última visita ${h.ultimaVisita || "?"}.`,
      ]
        .filter(Boolean)
        .join(" "),
      metadata: { ...base, kind: "ficha", source: "treelan" },
    },
  ];

  const ant = antecedentesRelevantes(h.antecedentes ?? []);
  // De a ocho: uno por antecedente serian 54 documentos de seis palabras, y con
  // tan poco texto el score semantico es ruido.
  for (let i = 0; i < ant.length; i += 8) {
    const grupo = ant.slice(i, i + 8);
    docs.push({
      id: `antecedentes-${i / 8}`,
      text: `Antecedentes personales y familiares: ${grupo
        .map((a) => (a.desde ? `${a.texto} (desde ${a.desde})` : a.texto))
        .join("; ")}.`,
      metadata: { ...base, kind: "antecedentes", source: "treelan" },
    });
  }

  (h.consultas ?? []).forEach((c, i) => {
    docs.push({
      id: `consulta-${i}`,
      text: recortar(
        `Consulta del ${c.fecha}${c.profesional ? ` con el Dr. ${c.profesional}` : ""}: ${c.texto}`,
        1400,
      ),
      metadata: { ...base, kind: "consulta", fecha: c.fecha, source: "treelan" },
    });
  });

  (h.secciones ?? []).forEach((s, i) => {
    docs.push({
      id: `seccion-${i}`,
      text: recortar(`${s.titulo}: ${s.texto}`, 1400),
      metadata: { ...base, kind: "seccion", titulo: s.titulo, source: "treelan" },
    });
  });

  return docs;
}

/**
 * La ficha real viene con duplicados ("miopía" cuatro veces) y con basura de
 * pruebas ("PRUEBA OIDO - BORRAR"). Nada de eso puede terminar dicho en voz alta.
 */
function antecedentesRelevantes(antecedentes: Antecedente[]): Antecedente[] {
  const vistos = new Set<string>();
  const out: Antecedente[] = [];
  for (const a of [...antecedentes].reverse()) {
    const texto = (a.texto ?? "").trim();
    const clave = texto.toLowerCase();
    if (!texto || texto.length < 3 || vistos.has(clave)) continue;
    if (/^(prueba|test)\b/i.test(texto) || /borrar/i.test(texto)) continue;
    vistos.add(clave);
    out.push({ ...a, texto });
    if (out.length >= 20) break;
  }
  return out;
}

const recortar = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const unaLinea = (s: string, n: number) => recortar(String(s ?? "").replace(/\s+/g, " ").trim(), n);
