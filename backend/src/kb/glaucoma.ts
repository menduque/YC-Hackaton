import { matchPorPalabras, moss } from "../clients/moss.js";
import type { MossHit } from "../clients/moss.js";

/**
 * Medicaciones riesgosas en glaucoma — el corpus detras de `medical_interactions`.
 *
 * Fuente: American Academy of Ophthalmology, "What Medications Can Be Dangerous
 * for Glaucoma Patients?" (ver FUENTE). Los hechos (drogas, clases, mecanismo,
 * que hacer) estan resumidos aca; el texto es propio, no una copia del articulo.
 *
 * Vive en un modulo y no solo en el indice a proposito: es lo que se indexa, y
 * tambien contra lo que cae el fallback por palabras cuando no hay keys de Moss.
 *
 * Indice aparte de `oido-clinical` porque `buildIndex` reemplaza el indice
 * entero: si compartieran nombre, `npm run moss:index` se llevaria esto puesto.
 */

export const INTERACCIONES_INDEX = process.env.MOSS_INTERACCIONES_INDEX ?? "oido-interacciones";

export const FUENTE = {
  organizacion: "American Academy of Ophthalmology",
  titulo: "What Medications Can Be Dangerous for Glaucoma Patients?",
  url: "https://www.aao.org/eye-health/tips-prevention/dangerous-medications-glaucoma-dayquil-bendadryl",
};

export interface DocInteraccion {
  id: string;
  text: string;
  metadata: Record<string, string>;
}

/** `angulo-cerrado` = narrow/closed-angle; `abierto` = open-angle. */
const doc = (
  id: string,
  tipo: string,
  text: string,
  extra: Record<string, string> = {},
): DocInteraccion => ({
  id,
  text,
  metadata: { kind: "interaccion", glaucoma: tipo, source: "aao", url: FUENTE.url, ...extra },
});

export const INTERACCIONES: DocInteraccion[] = [
  doc(
    "esteroides",
    "abierto",
    "Steroids raise eye pressure and are the main medication risk in OPEN-ANGLE glaucoma. " +
      "Every form counts: pills, creams, inhalers, IV and especially anything applied on or " +
      "near the eyes. The patient should tell their ophthalmologist they are on steroids and " +
      "keep up with pressure checks. Examples: prednisone, cortisone, hydrocortisone cream, " +
      "inhaled corticosteroids, steroid eye drops.",
    { clase: "corticosteroids" },
  ),
  doc(
    "resfrio",
    "angulo-cerrado",
    "Over-the-counter cold and flu remedies that combine antihistamines and decongestants can " +
      "narrow the drainage angle and trigger an attack in NARROW-ANGLE glaucoma. Named examples: " +
      "DayQuil, NyQuil, Alka-Seltzer Plus. The advice is to avoid them; plain Alka-Seltzer, " +
      "without the antihistamine or decongestant, is fine.",
    { clase: "cold and flu", marcas: "DayQuil NyQuil Alka-Seltzer Plus" },
  ),
  doc(
    "antihistaminicos",
    "angulo-cerrado",
    "Allergy medication — antihistamines and decongestants — can narrow the drainage angle in " +
      "NARROW-ANGLE glaucoma. Named examples: diphenhydramine (Benadryl), loratadine (Claritin), " +
      "fexofenadine (Allegra), cetirizine (Zyrtec). Avoid them, or check with the ophthalmologist " +
      "first.",
    { clase: "antihistamines", marcas: "Benadryl Claritin Allegra Zyrtec" },
  ),
  doc(
    "asma-epoc",
    "angulo-cerrado",
    "Inhaled asthma and COPD medication can narrow the drainage angle in NARROW-ANGLE glaucoma: " +
      "ipratropium bromide (Atrovent) and tiotropium bromide (Spiriva). Check with the " +
      "ophthalmologist before using them.",
    { clase: "asthma COPD inhalers", marcas: "Atrovent Spiriva" },
  ),
  doc(
    "antidepresivos",
    "angulo-cerrado",
    "Antidepressants and anti-anxiety medication can narrow the drainage angle in NARROW-ANGLE " +
      "glaucoma: fluoxetine (Prozac), paroxetine (Paxil), amitriptyline (Elavil), imipramine " +
      "(Tofranil), duloxetine (Cymbalta). Check with the ophthalmologist before using them.",
    { clase: "antidepressants", marcas: "Prozac Paxil Elavil Tofranil Cymbalta" },
  ),
  doc(
    "vejiga",
    "angulo-cerrado",
    "Medication for incontinence and overactive bladder can narrow the drainage angle in " +
      "NARROW-ANGLE glaucoma: tolterodine (Detrol), oxybutynin (Ditropan). Check with the " +
      "ophthalmologist before using them.",
    { clase: "bladder", marcas: "Detrol Ditropan" },
  ),
  doc(
    "migrana",
    "angulo-cerrado",
    "Migraine medication can narrow the drainage angle in NARROW-ANGLE glaucoma: sumatriptan " +
      "(Imitrex), and topiramate (Topamax), which is also used for seizures. Check with the " +
      "ophthalmologist before using them.",
    { clase: "migraine", marcas: "Imitrex Topamax" },
  ),
  doc(
    "sulfas",
    "angulo-cerrado",
    "Sulfa-containing drugs can narrow the drainage angle in NARROW-ANGLE glaucoma: topiramate " +
      "(Topamax) for seizures and migraine, acetazolamide (Diamox), and " +
      "trimethoprim-sulfamethoxazole (Bactrim) for infections. Check with the ophthalmologist " +
      "before using them.",
    { clase: "sulfa drugs", marcas: "Topamax Diamox Bactrim" },
  ),
  doc(
    "espasmos-parkinson",
    "angulo-cerrado",
    "Muscle spasm and Parkinson's medication can narrow the drainage angle in NARROW-ANGLE " +
      "glaucoma: orphenadrine (Norflex), trihexyphenidyl (Artane). Check with the ophthalmologist " +
      "before using them.",
    { clase: "muscle spasm Parkinson", marcas: "Norflex Artane" },
  ),
  doc(
    "gastrointestinal",
    "angulo-cerrado",
    "Gastrointestinal medication can narrow the drainage angle in NARROW-ANGLE glaucoma: " +
      "cimetidine (Tagamet), ranitidine (Zantac). Check with the ophthalmologist before using them.",
    { clase: "gastrointestinal", marcas: "Tagamet Zantac" },
  ),
  doc(
    "mareo",
    "angulo-cerrado",
    "Scopolamine motion-sickness patches can narrow the drainage angle in NARROW-ANGLE glaucoma, " +
      "and the risk is worse if the medication gets rubbed into the eye from the fingers. Keep it " +
      "away from the eyes.",
    { clase: "motion sickness", marcas: "scopolamine" },
  ),
  doc(
    "botox",
    "angulo-cerrado",
    "Botulinum toxin (Botox) injected around the eyes can narrow the drainage angle in " +
      "NARROW-ANGLE glaucoma. Check with the ophthalmologist before the injection.",
    { clase: "injections", marcas: "Botox" },
  ),
  doc(
    "gotas-dilatadoras",
    "angulo-cerrado",
    "The dilating drops used in a routine eye exam can narrow the drainage angle in NARROW-ANGLE " +
      "glaucoma. The patient should tell the eye doctor about their glaucoma before the exam.",
    { clase: "dilating drops" },
  ),
  doc(
    "senales-de-alarma",
    "angulo-cerrado",
    "Warning signs of an acute angle-closure attack: eye pain, nausea or vomiting, foggy vision, " +
      "halos or rainbows around lights, and headache. This is an emergency — stop the medication " +
      "and call the ophthalmologist or go to an emergency room immediately. Do not wait for an " +
      "appointment.",
    { clase: "emergency", urgente: "si" },
  ),
  doc(
    "matices",
    "general",
    "Context that changes the answer: which type of glaucoma the patient has decides whether a " +
      "drug is risky, and a drug that is safe in one type can be dangerous in the other. Many " +
      "people with narrow angles do not know it. Taking several at-risk medications at once adds " +
      "up. And after a laser iridotomy or cataract surgery, medications that used to be risky " +
      "generally stop being so.",
    { clase: "caveats" },
  ),
];

/**
 * Lo que corre en la llamada. Semantico si hay Moss; si no, overlap de palabras
 * contra los mismos documentos — peor, pero contesta.
 */
export async function buscarInteracciones(consulta: string, k = 4): Promise<MossHit[]> {
  if (moss.isConfigured) {
    try {
      const hits = await moss.retrieve(consulta, { k, index: INTERACCIONES_INDEX });
      if (hits.length) return hits;
    } catch (err) {
      console.warn(`[interacciones] Moss fallo: ${(err as Error).message}`);
    }
  }
  return matchPorPalabras(INTERACCIONES, consulta, k);
}

/** Suena a glaucoma? Se usa para decidir si la interaccion aplica a este paciente. */
export const mencionaGlaucoma = (texto: unknown) => /glaucoma/i.test(String(texto ?? ""));
