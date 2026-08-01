# Handoff — Agendamiento por voz (Deepgram + Moss + Stedi + MedPlum → Oído → Treelan)

> **Para quién es esto:** el equipo que arranca el **repo nuevo** (hackathon). Este documento describe
> cómo construir el agente de voz y las integraciones para que **la información que se carga en el
> turno salga de la llamada con el paciente**, no de un textarea. El RPA que escribe en Treelan **ya
> está hecho y probado en vivo** — vive en esta carpeta (`demo/oido-turnos-widget/`) y se porta tal cual.
>
> **Regla dura que atraviesa todo:** la demo **NO agenda**. Se completa el formulario y se frena antes
> de `Aceptar`. Treelan es la instalación de **producción** de Daponte: cada submit crea un turno real
> en la agenda de un médico real. `commit` nunca existe; no hay flag para habilitar `Aceptar`.

---

## 0. TL;DR del flujo

```
 ☎ Paciente habla
     │ audio (micrófono del browser / WebRTC)
     ▼
 ┌───────────────────┐  transcript + function calls
 │ Deepgram Voice    │────────────────────────────────┐
 │ Agent (es-AR)     │                                 │
 └───────────────────┘                                 ▼
                                      ┌──────────────────────────────────┐
              retrieval de contexto   │ Backend (repo nuevo o backend     │
        ┌─────────────────────────────┤ de Oído en Railway)               │
        ▼                             │  · function handlers de Deepgram   │
   ┌─────────┐                        │  · extractor incremental → payload │
   │  Moss   │  historia + KB médica  │  · empuja payload al widget        │
   │  (RAG)  │                        └───┬───────────────┬───────────────┘
   └─────────┘             Stedi eligibility │           │ MedPlum FHIR
                                            ▼            ▼
                                     ┌──────────┐  ┌──────────────────┐
                                     │  Stedi   │  │ Appointment +    │
                                     │ 270/271  │  │ Communication    │
                                     └──────────┘  └──────────────────┘
        payload { type:'OIDO_SCHEDULE', payload:{…} }
        ─────────────────────────────────────────────┐
                                                      ▼
 ┌──────────────────────────────────────────────────────────────┐
 │ Chrome del consultorio (sesión de Treelan ya logueada)         │
 │  ┌───────────────────────────┐   ┌──────────────────────────┐  │
 │  │ Treelan turno.php          │   │ Widget de Oído (este dir)│  │
 │  │ (RPA llenando campos)      │◄──│ recibe el payload y corre│  │
 │  └───────────────────────────┘   └──────────────────────────┘  │
 └──────────────────────────────────────────────────────────────┘
```

**Punto clave:** el backend **no habla con Treelan**. Treelan no tiene API y exige la sesión del
usuario. El **browser del consultorio es el actuador**; el widget recibe el payload y ejecuta el RPA
sobre la sesión ya logueada.

Reparto de responsabilidades por vendor:

| Capacidad del evento | Vendor | Rol concreto |
|---|---|---|
| "talk to a voice agent" / charting en vivo | **Deepgram** | STT + LLM + TTS + function calling (es rioplatense) |
| "deep researched" / "full context of your history" | **Moss** | RAG: retrieval de historia del paciente + KB médica que **funda** la conversación |
| "how much / insurance coverage" | **Stedi** | eligibility 270/271 antes de fijar la cobertura |
| "clinical documentation for the experts" | **MedPlum** | FHIR: lee historia (contexto) y escribe `Appointment` + `Communication` |
| cargar el turno en el EHR | **Widget RPA** (hecho) | llena Treelan con el payload; **nunca** `Aceptar` |

---

## 0.b — El alcance completo: "la visita del futuro"

El brief del evento es más ancho que agendar. La experiencia completa, **toda antes de ver al médico**,
voz-first:

> *Te registrás hablando con un agente de voz; la conversación se transcribe y se convierte en
> documentación clínica. Cualquier problema que describas se investiga a fondo (aunque sea un simple
> sarpullido) y el agente adapta la charla con el contexto completo de tu historia. Recibís un
> tratamiento n=1 hecho para vos, revisado por expertos, y tus datos se visualizan para que entiendas
> mejor. Y podés preguntar cuánto va a costar y si tu obra social lo cubre.*

Mapeo capacidad → componente → estado. Lo que ya está hecho es el **agendamiento** (el resto es lo que
el nuevo repo construye alrededor, reusando el mismo agente de voz y el mismo backend):

| # | Capacidad del brief | Componente | Vendor / tecnología | Estado |
|---|---|---|---|---|
| 1 | Check-in por voz | Agente de voz (§3) | **Deepgram** Voice Agent | a construir |
| 2 | "charted as it happens" → documentación clínica | Extractor incremental → nota FHIR | transcript Deepgram → LLM (Claude) → **MedPlum** `DocumentReference`/`Composition` | a construir |
| 3 | "any health issue deep researched" | Motor de investigación | **Moss** (retrieval sobre KB médica) + LLM que sintetiza | a construir |
| 4 | "full context of your history" | Contexto del paciente | **Moss** + **MedPlum** read (`Condition`, `MedicationStatement`) | a construir |
| 5 | "n=1 treatment customized" | Plan de tratamiento personalizado | LLM (Claude) grounded en 3+4 | a construir |
| 6 | "peer reviewed by experts" | Revisión del plan | LLM multi-agente (panel de jueces) o human-in-the-loop | a construir |
| 7 | "data is visualized" | Dashboard del paciente | UI (React) con los datos de 2–5 | a construir |
| 8 | "how much / insurance coverage" | Costo + eligibility | **Stedi** 270/271 (+ estimación) | a construir |
| 9 | "check in" → reservar el turno | RPA de agendamiento | **Widget** (esta carpeta) → Treelan | **hecho** |

**La columna vertebral es una sola:** el **agente de Deepgram con function calling**. Cada capacidad de
arriba es una `function` (o un paso post-llamada) que el agente dispara, y cada `function` pega contra
un vendor. Eso es lo que hace que todo "encaje" en un solo flujo en vez de ser features sueltas:

```
Deepgram (voz + function calling)  ── spine ──┐
  ├─ obtener_contexto_paciente()  → Moss + MedPlum read      (#3, #4)
  ├─ investigar_problema(sintoma) → Moss + LLM               (#3)
  ├─ verificar_cobertura()        → Stedi                    (#8)
  ├─ preparar_turno(payload)      → Widget RPA → Treelan      (#9)  ← hecho
  └─ (post-llamada) escribir_nota / plan / peer-review → MedPlum + LLM  (#2, #5, #6)
Dashboard (React) lee todo lo anterior y lo visualiza                  (#7)
```

El resto de este documento detalla el spine (§3 Deepgram), cada vendor (§4 Moss, §5 Stedi, §6 MedPlum)
y el contrato de datos del agendamiento (§1–2), que es la pieza ya construida. Las capacidades 2, 5, 6 y
7 son **LLM + UI propios** (no un vendor con llave): plan y peer-review con Claude (ver el skill
`claude-api` para model ids y pricing), visualización con React.

---

## 1. El contrato de datos del agendamiento (la pieza ya construida)

Todo converge en **un solo objeto**: el `payload`. Es lo que el backend arma con lo que surge de la
llamada y lo que el widget consume. **De dónde sale cada campo:**

```jsonc
{
  "fecha": "2026-09-29",        // ← slot confirmado en voz contra disponibilidad real (buscar_disponibilidad)
  "hora":  "12:00",             // ← idem. HH:MM tal cual la grilla de Treelan
  "paciente": {
    "apellido":  "TEST",        // ← dictado por el paciente (obligatorio en Treelan)
    "nombre":    "Test",        // ← dictado (obligatorio)
    "tipoDoc":   "DNI",         // ← dictado; default DNI
    "documento": "12345678",    // ← dictado dígito por dígito y reconfirmado
    "domicilio": "…",           // ← dictado, o traído de MedPlum si el paciente ya existe
    "telefono":  "…",           // ← dictado / MedPlum
    "celular":   "…",           // ← dictado / MedPlum
    "email":     "…"            // ← dictado deletreado (arroba + dominio confirmados)
  },
  "cobertura": "OSDE",          // ← dictado; validado por Stedi antes de escribirlo
  "motivo":    "Consulta",      // ← inferido del motivo de consulta (matchea 115 opciones del EHR)
  "usaLC":     false,           // ← dictado (obligatorio en Treelan, sin default)
  "comentarios": "Paciente con warfarina.",  // ← resumen clínico de la llamada (mismo texto que va a MedPlum)
  "enviaRecordatorio": true     // ← default true
}
```

**Mapeo payload → campo real de Treelan** (lo resuelve el widget, ya está codificado en `content.js`):

| payload | `name`/`id` en Treelan | tipo | obligatorio |
|---|---|---|---|
| `paciente.apellido` | `turno_apellido` | text | **sí** |
| `paciente.nombre` | `turno_nombres` | text | **sí** |
| `paciente.tipoDoc` | `turno_tipo_doc` | select | default DNI |
| `paciente.documento` | `turno_nro_doc` | text (numérico) | |
| `paciente.domicilio` | `turno_domicilio` | text | |
| `paciente.telefono` | `turno_telefono` | text | |
| `paciente.celular` | `turno_celular` | text | |
| `paciente.email` | `turno_mail` | text | |
| `cobertura` | `turno_deudor` | select (166) | **sí** |
| `motivo` | `Motivo` | select (115) | **sí** (default Consulta) |
| `usaLC` | radio `lc_si`/`lc_no` | radio | **sí**, sin default |
| `comentarios` | `turno_comentario` | textarea | |
| `enviaRecordatorio` | `envia_recordatorio` | checkbox | viene tildado |

Reglas de resolución que el widget ya respeta (no reimplementar en el backend):
- **fecha/hora nunca se "acomodan" solas.** Si el día no atiende / está lleno, o el horario está
  ocupado/bloqueado/inexistente, el widget **aborta con motivo** y lista los libres. El backend debe
  ofrecerle al paciente uno de esos libres, no forzar.
- **cobertura/motivo**: match exacto → prefijo → único "contiene". Sin match confiable, el campo queda
  **en rojo** y se avisa; no se elige "lo parecido".
- **usaLC** siempre explícito; si falta, queda en rojo (es obligatorio).

> **Ojo con el guion (verificado):** este Treelan es **oftalmológico**. No hay motivos cardiológicos ni
> "Swiss Medical" en el vademécum. Sí existen OSDE, GALENO, MEDIFE, OMINT, PARTICULAR, SIN CARGO, y
> motivos como Consulta / Control de rutina. El dato clínico cardiológico (warfarina, arritmia) viaja
> en `comentarios` + MedPlum, no en un código del EHR.

Constantes del EHR (ya en `rpa.js`):
- Sede **Montañeses**: `cfe6a025-1b9d-102d-b564-6096d05021b3`
- Profesional **DAPONTE Franco**: `e3244abc-6a1d-11eb-a788-94de80a26d48`
- URL base: `https://daponteojos.selfip.com/treelan/`

---

## 2. Cómo el payload llega al widget (tres transportes)

El widget (`content.js`) ya expone un único punto de entrada, `arrancarCon(payload, lento, origen)`, y
escucha `chrome.runtime.onMessage` para `{ type:'OIDO_SCHEDULE', payload, lento? }`. El backend solo
tiene que hacer llegar ese mensaje. Tres formas, en orden de simpleza para el hackathon:

### A. `externally_connectable` (canónico, requiere dominio real)
El panel de control del agente de voz (una web) hace:
```js
chrome.runtime.sendMessage(EXT_ID, { type: 'OIDO_SCHEDULE', payload });
```
`background.js` lo recibe en `onMessageExternal` y lo reenvía a la pestaña de Treelan. Requisitos:
- Agregar el origen del panel a `manifest.externally_connectable.matches`
  (hoy hay un placeholder `https://oido-control.example.com/*` — **reemplazar**).
- **`localhost` NO es un match válido** para `externally_connectable`. Para dev local: túnel/deploy con
  dominio real (Vercel, ngrok con dominio) o usar el transporte C.

### B. `chrome.tabs.sendMessage` desde tu propio background (si toda la orquestación vive en la extensión)
Si el WebSocket con el backend lo mantiene la extensión, el service worker recibe el evento del backend
y hace `chrome.tabs.sendMessage(tabTreelan, { type:'OIDO_SCHEDULE', payload })`. El content script ya lo
maneja. (El SW de MV3 se duerme; para un WS persistente conviene el side panel del producto real, no un
widget de demo.)

### C. "Pull" desde el content script (lo más robusto para localhost) — **recomendado para el hackathon**
El content script abre un WebSocket (o hace polling) al backend, keyed por `callId`, y cuando la
extracción está lista recibe el payload y llama `arrancarCon`. Evita `externally_connectable` y su
límite de localhost. Sketch para agregar en `content.js`:
```js
// Config: BACKEND_WS = 'wss://tu-backend/v1/voice/stream?callId=…'
const ws = new WebSocket(BACKEND_WS);
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.type === 'OIDO_SCHEDULE') arrancarCon(msg.payload, false, 'ws');
  // (V2) if (msg.type === 'field') { … streaming por campo, ver §6 }
};
```
Para la V2 de streaming por campo (ver §6) este es el canal natural.

### Fallback: textarea manual
El widget siempre permite pegar el payload a mano y apretar **▶ Agendar turno**. Es la red de
seguridad si el backend falla en vivo.

---

## 3. Deepgram — el agente de voz

### 3.1 Qué crear
- Cuenta/proyecto Deepgram + **una API key** (`DEEPGRAM_API_KEY`). El "agente" **no se crea en un
  panel**: se configura en código al abrir el WS (mensaje `Settings` con prompt, functions, idioma,
  modelo TTS).
- **Producto recomendado:** **Voice Agent API** (STT+LLM+TTS+function calling en una sola conexión WS).
  Alternativa con más control y más latencia: STT `nova-3` (`language: es`) + LLM propio (Claude) + TTS
  `aura-2`.
- **Audio (hackathon):** micrófono del browser (WebRTC). Cero telefonía. Solo si hace falta llamada
  real: Twilio Media Streams → WS → Deepgram (suma un punto de falla).
- **Verificar antes del vivo:** calidad de la voz TTS en **español rioplatense** (que use *vos*, no *tú*).

### 3.2 Rol y captura (el prompt)
Recepcionista de un consultorio **oftalmológico**. Corta, concreta, confirma datos. Captura **en el
orden del formulario** para que el llenado se vea prolijo: apellido, nombre, tipo+nº de documento,
domicilio, teléfono, celular, email, cobertura, motivo, uso de lentes de contacto, comentarios.

Reglas críticas:
- DNI **dígito por dígito** y reconfirmado.
- Email **deletreado**, confirmando arroba y dominio.
- Fecha/hora: **siempre** confirmar en voz contra la disponibilidad real (`buscar_disponibilidad`).
- Si el paciente se corrige, **reemitir el campo** (el protocolo por campo es idempotente, §6).
- **Nunca** prometer el turno como confirmado. Cierre: *"te lo dejo preparado y recepción lo confirma"*.

### 3.3 Functions a declarar
```jsonc
[
  { "name": "buscar_disponibilidad",
    "description": "Horarios libres reales del Dr. Daponte Franco en Montañeses",
    "parameters": { "fecha": "YYYY-MM-DD", "franja": "mañana|tarde|cualquiera" } },

  { "name": "obtener_contexto_paciente",
    "description": "Trae historia + hallazgos relevantes (Moss/MedPlum) para personalizar la charla",
    "parameters": { "documento": "string" } },

  { "name": "investigar_problema",
    "description": "Deep research de un síntoma/problema contra la KB médica (Moss + LLM)",
    "parameters": { "sintoma": "string", "contexto": "string" } },

  { "name": "verificar_cobertura",
    "description": "Eligibility check contra el financiador (Stedi)",
    "parameters": { "payer": "string", "nro_afiliado": "string", "documento": "string" } },

  { "name": "preparar_turno",
    "description": "Carga el turno en el EHR sin confirmarlo (queda listo para que recepción acepte)",
    "parameters": { /* el payload de §1 */ } }
]
```
- `buscar_disponibilidad` es lo que hace que la demo no sea teatro: la disponibilidad sale del **Treelan
  real**, leída por el mismo browser (el widget expone `leerSlots()` / `diasDelMes()` en `rpa.js`; el
  backend puede pedírselo por el mismo canal WS, o exponer un endpoint que el widget alimente).
- `preparar_turno` **es** el `{type:'OIDO_SCHEDULE', payload}` de §2 — su handler empuja el payload al
  widget. **No** debe existir una función que confirme/acepte.

### 3.4 Eventos a consumir
`ConversationText` (transcript de usuario y agente, interim + final), `FunctionCallRequest`,
`UserStartedSpeaking` / `AgentAudioDone` (para el indicador de "quién habla" en el panel).

---

## 4. Moss — contexto / deep research (RAG)

**Qué es (verificado en moss.dev):** un runtime de **búsqueda semántica** local-first (Rust/WASM),
lookups sub-10ms, con búsqueda híbrida (semántica + keyword). Modelos `moss-minilm` (rápido) y
`moss-mediumlm` (más preciso). **No hace tool-calling** — es la capa de **retrieval**; las tools las
declara y ejecuta Deepgram/el LLM.

**Rol en el flujo:** cubre "deep researched" + "full context of your history".
- Indexás (a) la **historia del paciente demo** y (b) una **KB médica** (p. ej. notas sobre warfarina /
  anticoagulación, interacciones, precauciones oftalmológicas).
- Cuando el paciente menciona un síntoma o un fármaco, `obtener_contexto_paciente` / un paso de
  retrieval consulta Moss y **funda** la conversación y el `comentarios` del payload.

**Setup:** cuenta en `portal.usemoss.dev` → `MOSS_PROJECT_ID` + `MOSS_PROJECT_KEY`; SDK
`@moss-dev/moss` (JS/TS) o `moss` (Python). **Antes del vivo hay que indexar** algo real para que el
retrieval no vuelva vacío. Referencia útil: su ejemplo de voice agent con LiveKit (Deepgram STT + LLM +
Moss retrieval).

---

## 5. Stedi — eligibility / cobertura

- **Qué hace:** eligibility check X12 **270/271**. Es **US-céntrico**; OSDE no existe como payer real
  → esto es **demo de integración**: payer de prueba en sandbox, o "OSDE" mapeado a un payer de prueba.
- **Dónde engancha:** `verificar_cobertura` corre **justo antes** de que el widget fije `turno_deudor`.
  El panel muestra el badge `Verificando… → ELEGIBLE` y recién ahí se escribe la cobertura. Narrativa
  honesta: *"valido cobertura antes de reservar"*, sin mentir que Treelan lo hace.
- **Qué conseguir del portal de test:** API key de **sandbox**, un **payer id de prueba**, y la
  **respuesta esperada** (para que el badge sea determinístico en el vivo).

---

## 6. MedPlum — registro FHIR

- **Qué crear:** cuenta + un **Project**, y dentro un **ClientApplication** para credenciales de máquina.
- **Qué pasar al backend:** base URL (`api.medplum.com` o self-hosted), `client_id`, `client_secret`,
  `projectId`.
- **Read (contexto):** antes/durante la llamada, leer `Patient` + `Condition` + `MedicationStatement`
  del paciente demo para que "full context of your history" sea real. **Cargar el `Patient` demo con
  una `Condition` y una `MedicationStatement` de warfarina** antes de la demo.
- **Write (después del fill):** `Appointment` (fecha/hora/practitioner/patient) + `Communication` con el
  resumen clínico dirigido al médico (y otro al paciente). El texto del `Communication` y el de
  `comentarios`/`turno_comentario` salen de **la misma extracción**, para que se vea la coherencia
  entre el EHR local y el registro FHIR.

Si querés apoyarte en el **backend de Oído existente** (Railway `oido-ui-production`) en vez de un
backend nuevo: el patrón de cliente autenticado ya existe (`src/background/backend-client.ts`, token on
demand, timeout duro). Habría que agregar endpoints `/v1/voice/*` y exponer un WebSocket ahí. Para el
hackathon suele ser más limpio un backend chico y aislado en el repo nuevo.

---

## 7. Streaming por campo (V2, "ver el llenado en vivo")

El widget hoy es **batch**: recibe el payload completo, navega y llena. Para el efecto "el campo se
llena mientras el paciente habla":
- El backend emite por WS, cada vez que **consolida un campo**:
  `{ "type": "field", "callId": "…", "seq": 12, "field": "turno_nro_doc", "value": "12345678" }`
- **Idempotente por campo:** cada `field` trae `seq`; si llega un `seq` menor al último aplicado a ese
  campo, se descarta. Las correcciones del paciente simplemente reescriben.
- Reusar las primitivas de `rpa.js`: `escribir()` (10 chunks, highlight verde), `elegir()`,
  `marcarRadio()`. El `slot` (fecha+hora) se resuelve apenas se confirma (navega a `turno.php`, abre el
  panel) — eso ya se ve.

No es necesario para un MVP; el batch ya es demo-able. Documentado para no rediseñar el protocolo después.

---

## 8. El widget que ya está hecho (esta carpeta)

| archivo | rol |
|---|---|
| `rpa.js` | primitivas del RPA (calendario, slots, panel, `escribir/elegir/marcarRadio`, `resetPanel`). **DOM verificado en vivo.** Nunca referencia el botón Aceptar. |
| `content.js` | orquestador + widget UI. Punto de entrada `arrancarCon(payload,…)`; máquina de estados calendarios→turno con persistencia en `sessionStorage`; listener `onMessage` para ingesta desde la llamada. |
| `background.js` | service worker: `onMessageExternal` → reenvía `OIDO_SCHEDULE` a la pestaña de Treelan. |
| `manifest.json` | MV3. `host_permissions` + `externally_connectable` (placeholder a reemplazar) + content scripts. |
| `payload.example.json` | payload de ejemplo (hoy: TEST, 29/09 12:00, warfarina). |
| `README.md` | cómo instalar y correr la demo. |

**Trampas del EHR que el código ya respeta** (respetarlas si se reescribe):
- `a[href*="acc=gnr"]` es el **único** predicado de "slot libre". El `bgcolor` de la fila es zebra
  striping; un slot **bloqueado** se ve verde y tiene texto en PACIENTE.
- En `turno.php` los iframes están **invertidos**: `body_right` = grilla, `body_left` = panel.
- El link del día **no se clickea** (su `onclick` llama `popMeTurnos()` → popup). Se extrae la URL y se
  navega la pestaña.
- **No `focus()` al escribir; `blur()` al terminar** (en vivo "TEST" quedó "TESTsw" por teclas sueltas).
- Tipeo en **10 chunks** por campo (Chrome estrangula timers de pestañas en background a ~1 tick/s).
- Día sin agenda → `turno.php` devuelve **HTML vacío, 0 iframes**: es el chequeo más barato de "no atiende".
- `Motivo = Consulta`/`Control…` evita el `confirm()` de "orden médica" que **congela** la automatización.

---

## 9. Checklist de accesos y llaves (para el equipo)

**Llaves**
1. `DEEPGRAM_API_KEY` + decisión Voice Agent API vs STT+LLM propio.
2. `MOSS_PROJECT_ID` + `MOSS_PROJECT_KEY` (y datos indexados: historia demo + KB médica).
3. Stedi: API key sandbox + payer id de prueba + respuesta esperada.
4. MedPlum: base URL + `client_id` + `client_secret` + `projectId` (+ `Patient` demo cargado).
5. (Opcional) Twilio si la llamada es telefónica.
6. Dónde corre el backend (repo nuevo, o Railway `oido-ui-production`) y si expone un WebSocket.

**Decisiones de producto**
7. Transporte payload→widget: A (`externally_connectable` + dominio real) o C (WS pull, localhost-friendly).
8. Nivel batch (§1–2) o streaming por campo (§7).
9. Motivo válido del guion (no hay cardiológicos: usar Consulta/Control).
10. Identidad del paciente ficticio + guion completo de la llamada.
11. Fecha/hora objetivo + backup (sugerido: 29/09/2026 12:00, backup 30/09).

**Autorización — bloqueante**
12. Confirmación **por escrito** de que en la demo **nunca** se aprieta `Aceptar`. Agendar de verdad
    requiere OK explícito de Daponte (escribe en la agenda de producción de un médico real).

---

## 10. Orden de implementación sugerido (MVP → wow)

Cada paso es demo-able solo: si algo falla en el escenario, cortás en el nivel anterior y sigue siendo redondo.

1. **Widget RPA** con payload a mano (ya está). Red de seguridad.
2. **Deepgram** con function calling + micrófono del browser, disparando `preparar_turno` → widget.
3. **Moss** read (contexto/deep research) + **MedPlum** read (historia) para personalizar la charla.
4. **Stedi** badge de cobertura antes de tocar `turno_deudor`.
5. **MedPlum** write (`Appointment` + `Communication`) después del fill.
6. (Si sobra tiempo) **streaming por campo** (§7) para el efecto "se llena mientras habla".

**Checklist de vivo:** ventana de Chrome enfocada y al frente (si no, timers estrangulados), zoom 100%,
sesión de Treelan refrescada minutos antes, **día vacío** para no mostrar PII de otros pacientes, y un
**video de respaldo** de una corrida completa por si el wifi del venue falla.
