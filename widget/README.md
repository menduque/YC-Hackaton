# Oído — Widget de demo de agendamiento (Treelan)

Extensión de Chrome **solo para demo**. Inyecta un panel en Treelan que, a partir de un payload JSON
(el que mañana va a emitir el agente de voz), ejecuta el RPA de agendamiento completo:

```
calendarios.php → sede + profesional → mes → día → turno.php → slot libre → panel → campos cargados
```

y **frena antes de `Aceptar`**.

> **No confirma turnos.** `Aceptar` es `input[type=image]#button`, el único control que submitea
> `form1`. No hay ninguna llamada a `.click()` sobre ese selector en este directorio, y no existe un
> flag para habilitarlo. Treelan es la instalación de producción de Daponte: un submit crea un turno
> real en la agenda de un médico.

## Instalar

1. `chrome://extensions` → activar **Modo desarrollador**.
2. **Cargar descomprimida** → elegir esta carpeta (`demo/oido-turnos-widget/`).
3. Abrir `https://daponteojos.selfip.com/treelan/calendarios.php` con la sesión ya iniciada.
4. El widget aparece abajo a la derecha.

## Correr la demo

1. Revisar el payload del `<textarea>` (viene precargado con `payload.example.json`).
2. Tildar **modo lento** si vas a grabar: el tipeo y las transiciones se hacen más visibles.
3. **▶ Agendar turno**.
4. El log va marcando cada paso: sede y profesional, mes, día con disponibilidad, slot libre con su
   `turno_id`, panel abierto, campos cargados.
5. Cierre: **Reset** — aprieta el `Cancelar` de Treelan, que solo recarga el panel vacío.

Para grabar: ventana al frente y zoom 100%. Chrome estrangula los timers de las pestañas en segundo
plano (~1 tick/s), así que si la ventana pierde el foco el tipeo se arrastra.

## Payload

```jsonc
{
  "fecha": "2026-09-29",          // YYYY-MM-DD, autoritativo
  "hora":  "11:00",               // HH:MM tal cual aparece en la grilla
  "paciente": { "apellido": "", "nombre": "", "tipoDoc": "DNI", "documento": "",
                "domicilio": "", "telefono": "", "celular": "", "email": "" },
  "cobertura": "OSDE",            // se matchea contra las 166 opciones del EHR
  "motivo": "Consulta",           // se matchea contra las 115 opciones del EHR
  "usaLC": false,                 // obligatorio en Treelan, sin default
  "comentarios": "…",
  "enviaRecordatorio": true
}
```

Obligatorios en Treelan: **apellido, nombre, cobertura y `usaLC`**. Los campos vacíos simplemente no
se escriben.

## Qué hace cuando no puede

Nunca acomoda la fecha ni la hora por su cuenta, y nunca elige una opción "parecida":

| caso | qué hace |
|---|---|
| día sin agenda / día completo | aborta con motivo y lista los días libres del mes |
| horario ocupado, bloqueado o inexistente | aborta con motivo y lista los horarios libres del día |
| cobertura o motivo sin match confiable | deja el campo **en rojo**, sigue con el resto y lo avisa en el log |
| `usaLC` sin dictar | marca el campo en rojo y avisa que es obligatorio |

## Detalles del EHR que el código respeta

- **`a[href*="acc=gnr"]` es el único predicado de "slot libre".** El `bgcolor` de la fila es zebra
  striping, no estado: un turno bloqueado se ve verde igual que uno libre y tiene texto en PACIENTE.
- **En `turno.php` los nombres de los iframes están invertidos** respecto de la posición visual:
  `body_right` es la grilla (izquierda) y `body_left` es el panel (medio).
- **El link del día no se clickea**: su `onclick` llama a `popMeTurnos()`, que abre un popup aparte.
  Se extrae la URL y se navega la pestaña.
- **No se hace `focus()` al escribir, y se hace `blur()` al terminar.** En una corrida real el campo
  Apellido quedó como `TESTsw`: dos teclas sueltas cayeron en el campo enfocado.
- **El tipeo va en 10 chunks por campo**, no caracter a caracter, por el throttling de timers.
- Un día sin agenda devuelve HTML vacío: la página no tiene ni iframes.
- No existe *Swiss Medical* en el vademécum de Daponte (ni `SMG`, ni `medical`, ni `suizo`). Sí OSDE,
  GALENO, MEDIFE, OMINT, PARTICULAR, SIN CARGO. Y no hay motivos cardiológicos: es oftalmología.

## Recibir el payload desde la llamada (ya cableado)

El widget ya acepta que **el payload venga de la llamada con el paciente**, no solo del `<textarea>`.
El punto de entrada único es `arrancarCon(payload, lento, origen)` y hay tres transportes:

- **`background.js`** (service worker) escucha `chrome.runtime.onMessageExternal` y reenvía
  `{ type:'OIDO_SCHEDULE', payload }` a la pestaña de Treelan. Las páginas autorizadas se declaran en
  `manifest.externally_connectable.matches` (hoy hay un placeholder `oido-control.example.com` —
  **reemplazar** por el dominio real del panel de control; `localhost` no es válido ahí).
- **`content.js`** escucha `chrome.runtime.onMessage` y arranca el RPA con el payload recibido.
- **Pull por WebSocket** desde el content script (recomendado para dev local): ver `HANDOFF-NUEVO-REPO.md` §2.

La máquina de estados no cambia: el origen del dato no altera cómo se llena el formulario.

## Historia clínica → contexto del agente de voz

Además de agendar, el widget **lee** la ficha del paciente (`paciente.php`) y la manda al
backend, que la parte en documentos y la indexa en Moss. Durante la llamada el agente
recupera de ahí (`obtener_contexto_paciente`) en vez de tener 35.000 caracteres de historia
en el prompt.

Las siete solapas del paciente (H.C., Ficha, Derivaciones, Diagnósticos, Protocolos,
Quirúrgico, Histórico) son Spry — puro cliente — así que el server las manda **todas** en el
mismo HTML: un solo GET trae la historia entera, sin clickear ni navegar.

Dos disparadores, ambos de solo lectura:

- **El operador abre la pestaña de un paciente.** `content.js` detecta que está parado en
  `paciente.php`, parsea lo que ya está cargado y se lo manda al service worker, que lo
  postea a `POST /v1/pacientes/contexto`. El POST sale del service worker y no del content
  script porque Treelan es HTTPS y un `fetch` a `http://localhost` se bloquea como mixed
  content (mismo motivo que el WS).
- **`buscar_paciente` identifica a quien llama.** La fila de resultados no tiene `<a>`: la
  URL de la ficha sale del `onclick` (`Link_Tables('paciente.php?p_id=…&id=…')`). El backend
  pide `OIDO_LEER_HISTORIA` por el WS y la lectura corre en paralelo al saludo del agente.

Para probarlo sin Chrome: `npx tsx src/scripts/widgetLoopback.ts` desde `backend/`.

Ver **`HANDOFF-NUEVO-REPO.md`** para el pipeline completo (Deepgram + Moss + Stedi + MedPlum) y el
mapeo campo por campo de qué sale de la llamada.
