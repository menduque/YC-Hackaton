/**
 * Indexa el KB de medicaciones riesgosas en glaucoma (kb/glaucoma.ts).
 * Correr una vez: `npm run moss:interacciones`
 *
 * Aparte de `moss:index` porque son dos corpus distintos y `buildIndex`
 * reemplaza el indice entero: si compartieran nombre, cada script borraria al
 * otro. Indexar es offline a proposito — hacerlo dentro de una llamada en vivo
 * frenaria la conversacion.
 */
import { moss } from "../clients/moss.js";
import { FUENTE, INTERACCIONES, INTERACCIONES_INDEX, buscarInteracciones } from "../kb/glaucoma.js";

if (!moss.isConfigured) {
  console.error("Moss no configurado — falta MOSS_PROJECT_ID / MOSS_PROJECT_KEY (SETUP.md §4)");
  console.error("Sin keys el KB igual responde, por overlap de palabras. Esto solo indexa.");
  process.exit(1);
}

console.log(`Fuente: ${FUENTE.organizacion} — ${FUENTE.url}`);
console.log(`Construyendo "${INTERACCIONES_INDEX}" con ${INTERACCIONES.length} documentos…`);
await moss.buildIndex(INTERACCIONES_INDEX, INTERACCIONES);
console.log("listo.");

// No lo damos por bueno hasta verlo contestar lo que va a preguntar el paciente.
for (const q of [
  "I have a cold, can I take DayQuil?",
  "is Benadryl ok for my allergies?",
  "my doctor put me on prednisone",
  "my eye hurts and I see halos around the lights",
]) {
  const hits = await buscarInteracciones(q, 2);
  console.log(`\n"${q}"`);
  for (const h of hits) console.log(`  ${h.score.toFixed(3)}  ${h.text.slice(0, 100)}…`);
}

process.exit(0);
