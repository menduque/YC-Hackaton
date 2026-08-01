/**
 * Primitivas del RPA de agendamiento en Treelan.
 *
 * MODO DEMO: este archivo NO contiene ninguna llamada que apriete "Aceptar".
 * El unico control que submitea form1 es `input[type=image]#button` y no se
 * referencia en ningun click. Ver README.
 *
 * Todo lo de aca fue verificado en vivo contra daponteojos.selfip.com.
 */

(() => {
  const SEDE_MONTANESES = 'cfe6a025-1b9d-102d-b564-6096d05021b3';
  const PROF_DAPONTE_FRANCO = 'e3244abc-6a1d-11eb-a788-94de80a26d48';
  const PROF_LABEL = 'DAPONTE Franco';

  // Busqueda de pacientes (pacientes.php). Verificado en vivo: el form es un
  // POST plano, sin onsubmit, asi que no hace falta manejar el DOM ni navegar
  // la pestania — alcanza un fetch same-origin con la sesion ya abierta.
  const PACIENTES_URL = 'pacientes.php';
  const CAMPO_DNI = 'paciente_dni';
  const CAMPO_APELLIDO = 'paciente_apellido';
  const CAMPO_NOMBRE = 'paciente_nombres';
  const CAMPO_TIPO_DOC = 'turno_tipo_doc';
  const FORM_BUSQUEDA = 'top_form';
  // La tabla de resultados es la unica cuyo header contiene esto.
  const HEADER_RESULTADOS = 'Nro Doc.';

  const VERDE = '#A4F751'; // dia con slots libres
  const ROJO = '#F58683'; // dia sin disponibilidad

  const MESES = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const norm = (s) =>
    String(s ?? '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  /** Error de negocio: el flujo no puede continuar, con motivo mostrable. */
  class RpaStop extends Error {
    constructor(message, detail) {
      super(message);
      this.name = 'RpaStop';
      this.detail = detail ?? null;
    }
  }

  // ---------------------------------------------------------------- highlight

  function highlight(el, color = VERDE) {
    if (!el || !el.style) return;
    el.dataset.oidoOutline = el.style.outline || '';
    el.dataset.oidoBg = el.style.backgroundColor || '';
    el.style.outline = `3px solid ${color}`;
    el.style.backgroundColor = color === VERDE ? '#f0fff0' : '#fff0f0';
  }

  function unhighlight(el) {
    if (!el || !el.style) return;
    el.style.outline = el.dataset.oidoOutline || '';
    el.style.backgroundColor = el.dataset.oidoBg || '';
  }

  /** Marca un campo como no resuelto y lo deja en rojo (no se limpia). */
  function markUnresolved(el) {
    if (!el || !el.style) return;
    el.style.outline = '3px solid #d92b2b';
    el.style.backgroundColor = '#fff0f0';
  }

  // ------------------------------------------------------------------- espera

  async function waitFor(fn, { timeout = 15000, interval = 120, what = 'condicion' } = {}) {
    const limite = Date.now() + timeout;
    for (;;) {
      let valor = null;
      try {
        valor = fn();
      } catch {
        valor = null;
      }
      if (valor) return valor;
      if (Date.now() > limite) throw new RpaStop(`Timeout esperando ${what}`);
      await sleep(interval);
    }
  }

  /** Documento de un iframe same-origin, solo cuando termino de cargar. */
  function frameDoc(frame) {
    try {
      const doc = frame && frame.contentDocument;
      if (!doc || doc.readyState === 'loading') return null;
      return doc;
    } catch {
      return null;
    }
  }

  /** Espera a que el iframe navegue a un documento distinto del anterior. */
  function waitForFrameReload(frame, docAnterior, what) {
    return waitFor(
      () => {
        const doc = frameDoc(frame);
        if (!doc || doc === docAnterior) return null;
        if (!doc.body || !doc.body.childElementCount) return null;
        return doc;
      },
      { what: what || 'recarga del iframe' },
    );
  }

  // -------------------------------------------------------------- calendarios

  /** El calendario 1 de calendarios.php (los 6 son iframes same-origin). */
  function calendarFrame() {
    const frames = document.querySelectorAll('iframe');
    if (!frames.length) throw new RpaStop('No encontre los calendarios en la pagina');
    return frames[0];
  }

  /** Selecciona sede + profesional y envia el form del calendario. */
  async function configurarCalendario(frame, { tick = 450 } = {}) {
    const doc = await waitFor(
      () => {
        const d = frameDoc(frame);
        return d && d.querySelector('select[name=Sede_Select]') ? d : null;
      },
      { what: 'el calendario' },
    );

    const sede = doc.querySelector('select[name=Sede_Select]');
    const prof = doc.querySelector('select[name=Profesional_Select]');
    if (!sede || !prof) throw new RpaStop('El calendario no expone los selects de sede/profesional');

    const optProf = [...prof.options].find((o) => norm(o.text) === norm(PROF_LABEL));
    if (!optProf) throw new RpaStop(`No encontre a "${PROF_LABEL}" en la lista de profesionales`);

    highlight(sede);
    sede.value = SEDE_MONTANESES;
    await sleep(tick);

    highlight(prof);
    prof.value = optProf.value;
    await sleep(tick);

    const submit = doc.querySelector('input[type=submit]');
    if (!submit) throw new RpaStop('El calendario no tiene boton OK');

    const antes = doc;
    submit.click();
    return waitForFrameReload(frame, antes, 'el calendario del profesional');
  }

  /** Lee mes/anio del encabezado del calendario. */
  function leerMes(doc) {
    const txt = norm(doc.body.innerText);
    for (let i = 0; i < 12; i += 1) {
      const m = txt.match(new RegExp(`${MESES[i]}\\s+(\\d{4})`));
      if (m) return { mes: i + 1, anio: Number(m[1]), indice: Number(m[1]) * 12 + i };
    }
    return null;
  }

  function indiceDe(mes, anio) {
    return anio * 12 + (mes - 1);
  }

  /** Links de navegacion (mes anterior/siguiente, anio anterior/siguiente). */
  function navLinks(doc) {
    return [...doc.querySelectorAll('a')]
      .map((a) => {
        const href = a.getAttribute('href') || '';
        const m = href.match(/MMes=(\d+)/);
        const y = href.match(/MAnio=(\d+)/);
        if (!m || !y) return null;
        return { a, indice: indiceDe(Number(m[1]), Number(y[1])) };
      })
      .filter(Boolean);
  }

  /** Navega el calendario hasta el mes objetivo clickeando las flechas. */
  async function irAlMes(frame, { mes, anio }, { tick = 350, maxPasos = 30 } = {}) {
    let doc = await waitFor(() => frameDoc(frame), { what: 'el calendario' });
    const objetivo = indiceDe(mes, anio);

    for (let paso = 0; paso < maxPasos; paso += 1) {
      const actual = leerMes(doc);
      if (!actual) throw new RpaStop('No pude leer el mes del calendario');
      if (actual.indice === objetivo) return doc;

      const candidatos = navLinks(doc);
      let mejor = null;
      for (const c of candidatos) {
        const dist = Math.abs(c.indice - objetivo);
        if (dist < Math.abs(actual.indice - objetivo) && (!mejor || dist < mejor.dist)) {
          mejor = { ...c, dist };
        }
      }
      if (!mejor) throw new RpaStop('El calendario no ofrece navegacion hacia ese mes');

      highlight(mejor.a);
      await sleep(tick);
      const antes = doc;
      mejor.a.click();
      doc = await waitForFrameReload(frame, antes, 'el mes siguiente');
    }
    throw new RpaStop('Demasiados saltos de mes; abortado');
  }

  /** Celdas del mes con su estado. */
  function diasDelMes(doc) {
    return [...doc.querySelectorAll('td')]
      .filter((td) => /^\d{1,2}$/.test(td.textContent.trim()))
      .map((td) => {
        const bg = td.getAttribute('bgcolor');
        const link = td.querySelector('a');
        return {
          dia: Number(td.textContent.trim()),
          td,
          link,
          estado: bg === VERDE ? 'libre' : bg === ROJO ? 'completo' : 'sin-agenda',
        };
      });
  }

  /**
   * Resuelve el dia y devuelve la URL de turno.php.
   * No clickea el link: su onclick usa popMeTurnos(), que abre un popup aparte.
   */
  async function resolverDia(doc, dia, { tick = 500 } = {}) {
    const celdas = diasDelMes(doc);
    const libres = celdas.filter((c) => c.estado === 'libre').map((c) => c.dia);
    const celda = celdas.find((c) => c.dia === dia);

    if (!celda) throw new RpaStop(`El dia ${dia} no existe en este mes`, { libres });
    if (celda.estado === 'sin-agenda') {
      throw new RpaStop(`El ${dia} no hay agenda para este profesional`, { libres });
    }
    if (celda.estado === 'completo') {
      throw new RpaStop(`El ${dia} no tiene disponibilidad`, { libres });
    }
    if (!celda.link) throw new RpaStop(`El dia ${dia} no es clickeable`, { libres });

    const raw = (celda.link.getAttribute('onclick') || '').match(/'([^']+)'/);
    if (!raw) throw new RpaStop('No pude extraer la URL del dia');

    highlight(celda.td, '#1e6fd9');
    await sleep(tick);

    return new URL(raw[1], doc.baseURI).href;
  }

  // -------------------------------------------------------------------- turno

  function gridFrame() {
    return document.querySelector('iframe[name=body_right]');
  }

  function panelFrame() {
    return document.querySelector('iframe[name=body_left]');
  }

  /** Lee los slots de la grilla con su estado real. */
  function leerSlots() {
    const doc = frameDoc(gridFrame());
    if (!doc) return null;
    return [...doc.querySelectorAll('tr[id]')]
      .filter((tr) => /^\d+$/.test(tr.id))
      .map((tr) => {
        const tds = [...tr.children];
        const generar = tr.querySelector('a[href*="acc=gnr"]');
        const bloqueado = tr.querySelector('a[href*="acc=desblck"]');
        return {
          tr,
          generar,
          turnoId: tr.id,
          hora: tds[2] ? tds[2].textContent.trim() : '',
          paciente: tds[4] ? tds[4].textContent.trim() : '',
          // Unico predicado confiable: la accion Generar. El bgcolor de la fila
          // es zebra striping y un slot bloqueado se ve verde igual que uno libre.
          estado: generar ? 'libre' : bloqueado ? 'bloqueado' : 'ocupado',
        };
      });
  }

  /** Abre el panel Generar Turno para una hora, validando que este libre. */
  async function abrirGenerar(hora, { tick = 500 } = {}) {
    // Un dia sin agenda devuelve HTML vacio: ni siquiera hay iframes.
    if (!document.querySelectorAll('iframe').length) {
      throw new RpaStop('Ese dia no tiene agenda cargada');
    }

    const slots = await waitFor(() => {
      const s = leerSlots();
      return s && s.length ? s : null;
    }, { what: 'la grilla de horarios' });

    const libres = slots.filter((s) => s.estado === 'libre').map((s) => s.hora);
    const slot = slots.find((s) => s.hora === hora);

    if (!slot) throw new RpaStop(`El horario ${hora} no existe en esta agenda`, { libres });
    if (slot.estado !== 'libre') {
      throw new RpaStop(`El horario ${hora} esta ${slot.estado}`, { libres });
    }

    highlight(slot.tr, '#1e6fd9');
    await sleep(tick);

    const panel = panelFrame();
    const antes = frameDoc(panel);
    slot.generar.click();

    const doc = await waitFor(
      () => {
        const d = frameDoc(panel);
        if (!d || d === antes) return null;
        return d.querySelector('#turno_apellido') ? d : null;
      },
      { what: 'el panel Generar Turno' },
    );

    return { doc, turnoId: slot.turnoId, hora: slot.hora };
  }

  /** Titulo del panel, para verificar que agarro el slot correcto. */
  function horaDelPanel(doc) {
    const m = (doc.body.innerText || '').match(/Hora:\s*(\d{1,2}:\d{2})/);
    return m ? m[1] : null;
  }

  // ------------------------------------------------------------------ llenado

  function fire(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /**
   * Escribe en 10 chunks en vez de caracter a caracter: Chrome estrangula los
   * timers de las pestanias en segundo plano a ~1 tick/s, y caracter a caracter
   * tarda minutos. Nunca hace focus(): una tecla suelta de alguien usando la
   * laptop aterriza en el campo enfocado (paso en vivo: "TEST" quedo "TESTsw").
   */
  async function escribir(el, valor, { tick = 45, pausa = 140, chunks = 10 } = {}) {
    if (!el) return false;
    const s = String(valor ?? '');
    if (!s) return false;

    highlight(el);
    el.value = '';
    const n = Math.max(1, Math.ceil(s.length / chunks));
    for (let i = 0; i < s.length; i += n) {
      el.value = s.slice(0, i + n);
      await sleep(tick);
    }
    el.value = s;
    fire(el);
    await sleep(pausa);
    unhighlight(el);
    return true;
  }

  /** Match exacto -> prefijo -> unico "contiene". Nunca devuelve "lo parecido". */
  function buscarOpcion(sel, etiqueta) {
    const t = norm(etiqueta);
    if (!t) return null;
    const opts = [...sel.options].filter((o) => o.value);
    return (
      opts.find((o) => norm(o.text) === t) ||
      opts.find((o) => norm(o.text).startsWith(t)) ||
      (opts.filter((o) => norm(o.text).includes(t)).length === 1
        ? opts.filter((o) => norm(o.text).includes(t))[0]
        : null)
    );
  }

  async function elegir(el, etiqueta, { pausa = 380 } = {}) {
    if (!el) return { ok: false, motivo: 'campo ausente' };
    if (!etiqueta) return { ok: false, motivo: 'sin valor dictado' };

    highlight(el);
    const opt = buscarOpcion(el, etiqueta);
    if (!opt) {
      markUnresolved(el);
      return { ok: false, motivo: `"${etiqueta}" no existe en las ${el.options.length} opciones` };
    }
    el.value = opt.value;
    fire(el);
    await sleep(pausa);
    unhighlight(el);
    return { ok: true, texto: opt.text.trim() };
  }

  async function marcarRadio(el, { pausa = 380 } = {}) {
    if (!el) return false;
    highlight(el);
    el.checked = true;
    fire(el);
    await sleep(pausa);
    unhighlight(el);
    return true;
  }

  // -------------------------------------------------- busqueda de pacientes

  /**
   * Trae pacientes.php y devuelve su form de busqueda ya parseado.
   *
   * Armamos el body a partir del form real en vez de hardcodear la lista de
   * campos: Treelan manda varios selects (Deudor, Condicion, Procedencia) cuyo
   * valor por defecto no es obvio, y mandar el form completo es lo que verifique
   * que funciona. Un GET extra es barato y esto sobrevive cambios del form.
   */
  async function traerFormBusqueda() {
    const res = await fetch(PACIENTES_URL, { credentials: 'include' });
    if (!res.ok) throw new RpaStop(`Treelan respondio ${res.status} al abrir la busqueda`);
    const html = await decodificar(res);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const form = doc.forms[FORM_BUSQUEDA];
    if (!form) {
      throw new RpaStop('No se encontro el form de busqueda de pacientes (sesion vencida?)');
    }
    return form;
  }

  /**
   * pacientes.php se sirve en ISO-8859-1, no UTF-8. Con res.text() los acentos
   * y el simbolo de grado salen rotos ("cespedes 1244 1?B").
   */
  async function decodificar(res) {
    const buf = await res.arrayBuffer();
    return new TextDecoder('iso-8859-1').decode(buf);
  }

  /** Filas de la tabla de resultados -> objetos. [] si no hubo coincidencias. */
  function parsearResultados(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // Ojo: hay que exigir que UNA CELDA del header sea exactamente "Nro Doc.".
    // Con un innerText.includes() matchea antes una tabla contenedora de 1 fila
    // que envuelve a la de resultados, y la busqueda devuelve vacio siempre.
    const tabla = [...doc.querySelectorAll('table')].find((t) =>
      [...(t.rows[0]?.cells || [])].some(
        (c) => c.textContent.trim() === HEADER_RESULTADOS,
      ),
    );
    // Sin resultados la tabla existe igual, con solo la fila de header: no hay
    // ningun cartel de "no se encontro" que buscar.
    if (!tabla || tabla.rows.length < 2) return [];

    return [...tabla.rows]
      .slice(1)
      .map((tr) =>
        // Treelan intercala celdas espaciadoras vacias entre columna y columna.
        [...tr.cells].map((td) => td.textContent.trim()).filter((s) => s.length),
      )
      .filter((c) => c.length >= 4)
      .map((c) => {
        const nombreCompleto = c[1] || '';
        const coma = nombreCompleto.indexOf(',');
        return {
          hc: c[0] || '',
          apellido: coma >= 0 ? nombreCompleto.slice(0, coma).trim() : nombreCompleto,
          nombre: coma >= 0 ? nombreCompleto.slice(coma + 1).trim() : '',
          nombreCompleto,
          dni: c[2] || '',
          fechaNacimiento: c[3] || '',
          domicilio: c[4] || '',
          estado: c[5] || '',
          procedencia: c[6] || '',
        };
      });
  }

  /**
   * Busca un paciente por documento o por nombre y devuelve lo que Treelan lista.
   *
   * Ojo con multi-resultado: no es teorico. En la base real hay tres pacientes
   * cargados con el DNI comodin 99999999, asi que quien llame tiene que
   * desambiguar. Nunca devolvemos "el mas parecido".
   */
  async function buscarPaciente({ dni, apellido, nombre, tipoDoc } = {}) {
    const form = await traerFormBusqueda();
    const fd = new FormData(form);
    if (dni) {
      fd.set(CAMPO_DNI, String(dni));
      fd.set(CAMPO_TIPO_DOC, tipoDoc || 'DNI');
    }
    if (apellido) fd.set(CAMPO_APELLIDO, String(apellido));
    if (nombre) fd.set(CAMPO_NOMBRE, String(nombre));

    const body = new URLSearchParams();
    for (const [k, v] of fd.entries()) body.append(k, typeof v === 'string' ? v : '');
    // El submit es <input type="image">: el server espera sus coordenadas.
    body.append('button3.x', '40');
    body.append('button3.y', '15');

    const res = await fetch(PACIENTES_URL, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      credentials: 'include',
    });
    if (!res.ok) throw new RpaStop(`Treelan respondio ${res.status} al buscar el paciente`);

    const pacientes = parsearResultados(await decodificar(res));
    return { encontrado: pacientes.length > 0, cantidad: pacientes.length, pacientes };
  }

  // ------------------------------------------- busqueda VISIBLE en pacientes.php
  // buscarPaciente() de arriba resuelve por fetch y es la que contesta al agente:
  // es instantanea y no toca la pestania. Lo de aca abajo es el mismo trabajo
  // hecho a la vista, para que en la demo se vea a Mira usando el EHR. Nunca es
  // la fuente de la respuesta, asi que si algo falla la llamada sigue igual.

  const enPacientes = () => /\/pacientes\.php/.test(location.pathname);

  /** El form de busqueda tal como esta montado en la pagina (no por fetch). */
  function formBusquedaVivo() {
    return (
      document.getElementById(FORM_BUSQUEDA) ||
      document.querySelector(`form[name="${FORM_BUSQUEDA}"]`) ||
      [...document.forms].find((f) => f.querySelector(`[name="${CAMPO_DNI}"]`)) ||
      null
    );
  }

  /** Escribe el DNI en el campo real y deja el foco marcado para la camara. */
  async function tipearDni(dni, { tick = 45, pausa = 140 } = {}) {
    const form = formBusquedaVivo();
    if (!form) throw new RpaStop('No encontre el formulario de busqueda en pacientes.php');
    const campo = form.querySelector(`[name="${CAMPO_DNI}"]`);
    if (!campo) throw new RpaStop(`No encontre el campo ${CAMPO_DNI}`);

    const tipo = form.querySelector(`[name="${CAMPO_TIPO_DOC}"]`);
    if (tipo) await elegir(tipo, 'DNI', { pausa });

    highlight(campo);
    await escribir(campo, String(dni), { tick, pausa, chunks: 10 });
    await sleep(pausa);
    return { form, campo };
  }

  /**
   * Aprieta el buscar del form. Es un <input type=image>, asi que un .click()
   * alcanza: el navegador manda el POST con las coordenadas y navega la pestania
   * a la misma URL, ahora con resultados.
   */
  function ejecutarBusqueda(form) {
    const submit =
      form.querySelector('input[type=image][name^="button"]') ||
      form.querySelector('input[type=image]') ||
      form.querySelector('input[type=submit]');
    if (!submit) throw new RpaStop('No encontre el boton de buscar en pacientes.php');
    highlight(submit);
    submit.click();
    return true;
  }

  /** Los resultados ya renderizados en la pagina actual. */
  function resultadosEnPagina() {
    return parsearResultados(document.documentElement.outerHTML);
  }

  /**
   * Abre la ficha del paciente cuyo documento coincide.
   *
   * OJO: es lo unico de este archivo que NO esta verificado contra el DOM real —
   * nunca vi la fila de resultados de pacientes.php. Asume que la fila tiene un
   * <a> que lleva a la ficha y agarra el primero. Si el supuesto no se cumple
   * devuelve false en vez de romper: la llamada ya fue contestada por fetch.
   */
  function abrirFicha(dni) {
    const objetivo = String(dni ?? '').replace(/[.\s-]/g, '');
    const tabla = [...document.querySelectorAll('table')].find((t) =>
      [...(t.rows[0]?.cells || [])].some((c) => c.textContent.trim() === HEADER_RESULTADOS),
    );
    if (!tabla || tabla.rows.length < 2) return false;

    const fila =
      [...tabla.rows]
        .slice(1)
        .find((tr) =>
          [...tr.cells].some(
            (td) => td.textContent.trim().replace(/[.\s-]/g, '') === objetivo,
          ),
        ) || tabla.rows[1];
    if (!fila) return false;

    const link = fila.querySelector('a[href]');
    if (!link) return false;
    highlight(fila);
    link.click();
    return true;
  }

  /** Cancelar de Treelan: recarga el panel vacio. No agenda nada. */
  function resetPanel() {
    const doc = frameDoc(panelFrame());
    if (!doc) return false;
    const cancelar = [...doc.querySelectorAll('a')].find(
      (a) => (a.getAttribute('href') || '') === 'turno_acc.php',
    );
    if (!cancelar) return false;
    cancelar.click();
    return true;
  }

  globalThis.OidoRpa = {
    RpaStop,
    SEDE_MONTANESES,
    PROF_DAPONTE_FRANCO,
    PROF_LABEL,
    sleep,
    norm,
    waitFor,
    frameDoc,
    calendarFrame,
    configurarCalendario,
    leerMes,
    irAlMes,
    diasDelMes,
    resolverDia,
    gridFrame,
    panelFrame,
    leerSlots,
    abrirGenerar,
    horaDelPanel,
    escribir,
    elegir,
    marcarRadio,
    markUnresolved,
    resetPanel,
    buscarPaciente,
    parsearResultados,
    PACIENTES_URL,
    enPacientes,
    formBusquedaVivo,
    tipearDni,
    ejecutarBusqueda,
    resultadosEnPagina,
    abrirFicha,
  };
})();
