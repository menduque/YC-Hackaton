/**
 * Widget de demo + orquestador del RPA de agendamiento en Treelan.
 *
 * MODO DEMO: completa el turno y FRENA. Nunca aprieta "Aceptar"
 * (`input[type=image]#button`, el unico control que submitea form1).
 *
 * El flujo cruza una navegacion de pagina completa (calendarios.php ->
 * turno.php), asi que el trabajo pendiente vive en sessionStorage y el content
 * script lo retoma al recargarse.
 */

(() => {
  const R = globalThis.OidoRpa;
  if (!R) return;

  const JOB_KEY = 'oido_demo_job_v1';
  const JOB_TTL_MS = 10 * 60 * 1000;

  const VELOCIDADES = {
    normal: { tick: 45, pausa: 140, sel: 380, paso: 450 },
    lento: { tick: 110, pausa: 320, sel: 750, paso: 850 },
  };

  const PAYLOAD_DEFAULT = {
    fecha: '2026-09-29',
    hora: '12:00',
    paciente: {
      apellido: 'TEST',
      nombre: 'Test',
      tipoDoc: 'DNI',
      documento: '12345678',
      domicilio: 'Av. Montaneses 2500, CABA',
      telefono: '011 4788-0000',
      celular: '11 5555-1234',
      email: 'demo@oido.ai',
    },
    cobertura: 'OSDE',
    motivo: 'Consulta',
    usaLC: false,
    comentarios: 'Paciente con warfarina.',
  };

  // ------------------------------------------------------------------ estado

  function leerJob() {
    try {
      const raw = sessionStorage.getItem(JOB_KEY);
      if (!raw) return null;
      const job = JSON.parse(raw);
      if (!job || Date.now() - (job.startedAt || 0) > JOB_TTL_MS) {
        sessionStorage.removeItem(JOB_KEY);
        return null;
      }
      return job;
    } catch {
      return null;
    }
  }

  function guardarJob(job) {
    try {
      sessionStorage.setItem(JOB_KEY, JSON.stringify(job));
    } catch {
      /* noop */
    }
  }

  function borrarJob() {
    try {
      sessionStorage.removeItem(JOB_KEY);
    } catch {
      /* noop */
    }
  }

  let job = leerJob();

  // --------------------------------------------------------------------- UI

  const CSS = `
    :host { all: initial; }
    .panel {
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
      width: 340px; max-height: 82vh; display: flex; flex-direction: column;
      font: 13px/1.45 -apple-system, "Segoe UI", Roboto, sans-serif; color: #16211c;
      background: #fff; border: 1px solid #cfd8d3; border-radius: 12px;
      box-shadow: 0 10px 34px rgba(0,0,0,.22); overflow: hidden;
    }
    .hd {
      display: flex; align-items: center; gap: 8px; padding: 10px 12px;
      background: #16211c; color: #fff; cursor: default;
    }
    .hd b { font-size: 13px; font-weight: 650; flex: 1; }
    .hd button {
      background: transparent; border: 0; color: #9fb3a8; font-size: 15px;
      cursor: pointer; padding: 0 4px; line-height: 1;
    }
    .demo {
      background: #fff4d6; color: #7a5600; padding: 6px 12px;
      font-size: 11.5px; font-weight: 600; border-bottom: 1px solid #f0e2bb;
    }
    .body { padding: 12px; overflow-y: auto; }
    .body.oculto { display: none; }
    label { display: block; font-size: 11px; font-weight: 650; color: #5b6b63;
            text-transform: uppercase; letter-spacing: .03em; margin: 0 0 5px; }
    textarea {
      width: 100%; box-sizing: border-box; height: 168px; resize: vertical;
      font: 11.5px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
      border: 1px solid #cfd8d3; border-radius: 8px; padding: 8px; color: #16211c;
      background: #fbfdfc;
    }
    .fila { display: flex; gap: 8px; align-items: center; margin-top: 10px; }
    .btn {
      flex: 1; border: 0; border-radius: 8px; padding: 9px 12px; cursor: pointer;
      font: 600 13px/1 -apple-system, "Segoe UI", Roboto, sans-serif;
    }
    .btn.run { background: #1f7a4d; color: #fff; }
    .btn.run:disabled { background: #9db5a8; cursor: default; }
    .btn.sec { flex: 0 0 auto; background: #eef2f0; color: #3c4b44; }
    .vel { display: flex; align-items: center; gap: 5px; font-size: 11.5px; color: #5b6b63; }
    .log { list-style: none; margin: 12px 0 0; padding: 0; border-top: 1px solid #eef2f0; }
    .log li { display: flex; gap: 7px; padding: 5px 0; font-size: 12px; border-bottom: 1px solid #f4f7f5; }
    .log .ico { flex: 0 0 14px; text-align: center; }
    .log .ok .ico { color: #1f7a4d; }
    .log .warn .ico { color: #b8860b; }
    .log .err .ico { color: #c0392b; }
    .log .info .ico { color: #7b8b83; }
    .log .err span, .log .warn span { font-weight: 600; }
    .vacio { color: #7b8b83; font-size: 12px; padding: 10px 0 2px; }
  `;

  const host = document.createElement('div');
  host.id = 'oido-demo-widget';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>${CSS}</style>
    <div class="panel">
      <div class="hd"><b>Oido · Agendamiento</b><button id="tog" title="Contraer">–</button></div>
      <div class="demo">MODO DEMO — no confirma el turno</div>
      <div class="body" id="body">
        <label for="pl">Payload (Deepgram / MedPlum)</label>
        <textarea id="pl" spellcheck="false"></textarea>
        <div class="fila">
          <button class="btn run" id="run">▶ Agendar turno</button>
          <button class="btn sec" id="reset">Reset</button>
        </div>
        <div class="fila">
          <label class="vel"><input type="checkbox" id="lento"> modo lento (para grabar)</label>
        </div>
        <ul class="log" id="log"></ul>
      </div>
    </div>
  `;

  const $ = (id) => shadow.getElementById(id);

  function montar() {
    if (!document.body || document.getElementById('oido-demo-widget')) return;
    document.body.appendChild(host);

    $('pl').value = JSON.stringify(job ? job.payload : PAYLOAD_DEFAULT, null, 2);
    $('lento').checked = Boolean(job && job.lento);
    $('run').addEventListener('click', arrancar);
    $('reset').addEventListener('click', reset);
    $('tog').addEventListener('click', () => {
      const b = $('body');
      b.classList.toggle('oculto');
      $('tog').textContent = b.classList.contains('oculto') ? '+' : '–';
    });
    render();
  }

  function render() {
    const ul = $('log');
    if (!ul) return;
    const lineas = (job && job.log) || [];
    if (!lineas.length) {
      ul.innerHTML = '<li class="vacio">Sin corridas todavia.</li>';
      return;
    }
    const ico = { ok: '✓', warn: '⚠', err: '✕', info: '·' };
    ul.innerHTML = lineas
      .map(
        (l) =>
          `<li class="${l.t}"><i class="ico">${ico[l.t] || '·'}</i><span>${escapar(l.txt)}</span></li>`,
      )
      .join('');
    // Scrollear el contenedor del widget, nunca la pagina de Treelan.
    const cont = $('body');
    if (cont) cont.scrollTop = cont.scrollHeight;
  }

  function escapar(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  function log(t, txt) {
    if (!job) return;
    job.log = job.log || [];
    job.log.push({ t, txt });
    guardarJob(job);
    render();
  }

  function corriendo(v) {
    const b = $('run');
    if (b) {
      b.disabled = v;
      b.textContent = v ? 'Ejecutando…' : '▶ Agendar turno';
    }
  }

  // ---------------------------------------------------------------- acciones

  function reset() {
    borrarJob();
    job = null;
    const ok = R.resetPanel();
    job = { payload: leerPayloadDelTextarea() || PAYLOAD_DEFAULT, log: [], startedAt: Date.now(), phase: 'idle' };
    log('info', ok ? 'Panel reseteado (Cancelar). Nada quedo cargado.' : 'Nada que resetear.');
    corriendo(false);
  }

  function leerPayloadDelTextarea() {
    try {
      return JSON.parse($('pl').value);
    } catch {
      return null;
    }
  }

  function arrancar() {
    const payload = leerPayloadDelTextarea();
    if (!payload) {
      job = { payload: PAYLOAD_DEFAULT, log: [], startedAt: Date.now(), phase: 'error' };
      log('err', 'El payload no es JSON valido.');
      return;
    }
    arrancarCon(payload, $('lento') ? $('lento').checked : false, 'widget');
  }

  /**
   * Punto de entrada unico del RPA. El payload puede venir del textarea o de la
   * llamada con el paciente (background -> onMessage). El origen del dato NO
   * cambia la maquina de estados: lo que se llena sale del payload y punto.
   */
  function arrancarCon(payload, lento, origen) {
    if (!payload || typeof payload !== 'object') {
      job = { payload: PAYLOAD_DEFAULT, log: [], startedAt: Date.now(), phase: 'error' };
      log('err', 'Payload ausente o invalido.');
      return { ok: false, error: 'payload invalido' };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.fecha || ''))) {
      job = { payload, log: [], startedAt: Date.now(), phase: 'error' };
      log('err', 'Falta "fecha" en formato YYYY-MM-DD.');
      return { ok: false, error: 'fecha invalida' };
    }
    if (!/^\d{1,2}:\d{2}$/.test(String(payload.hora || ''))) {
      job = { payload, log: [], startedAt: Date.now(), phase: 'error' };
      log('err', 'Falta "hora" en formato HH:MM.');
      return { ok: false, error: 'hora invalida' };
    }

    job = { payload, lento: Boolean(lento), log: [], startedAt: Date.now(), phase: 'calendario' };
    guardarJob(job);

    // Si el widget esta montado, reflejar el payload que llego de la llamada.
    const ta = $('pl');
    if (ta) ta.value = JSON.stringify(payload, null, 2);
    const lc = $('lento');
    if (lc) lc.checked = Boolean(lento);
    if (origen && origen !== 'widget') log('info', `Payload recibido de la llamada (${origen}).`);
    render();

    if (enCalendarios()) {
      fase1();
    } else {
      log('info', 'Yendo al calendario…');
      location.href = new URL('calendarios.php', location.href).href;
    }
    return { ok: true, started: true };
  }

  const enCalendarios = () => /\/calendarios\.php/.test(location.pathname);
  const enTurno = () => /\/turno\.php/.test(location.pathname);

  function velocidad() {
    return VELOCIDADES[job && job.lento ? 'lento' : 'normal'];
  }

  function fallar(err) {
    if (err && err.name === 'RpaStop') {
      log('err', err.message);
      const libres = err.detail && err.detail.libres;
      if (libres && libres.length) log('info', `Libres: ${libres.join(' · ')}`);
      else if (libres) log('info', 'No hay alternativas libres en ese periodo.');
    } else {
      log('err', `Error inesperado: ${(err && err.message) || err}`);
    }
    if (job) {
      job.phase = 'error';
      guardarJob(job);
    }
    corriendo(false);
  }

  /** Fase 1 — calendarios.php: sede, profesional, mes, dia. Termina navegando. */
  async function fase1() {
    corriendo(true);
    const v = velocidad();
    try {
      const [anio, mes, dia] = job.payload.fecha.split('-').map(Number);
      const frame = R.calendarFrame();

      await R.configurarCalendario(frame, { tick: v.paso });
      log('ok', `Sede Montaneses · ${R.PROF_LABEL}`);

      const doc = await R.irAlMes(frame, { mes, anio }, { tick: v.paso });
      const m = R.leerMes(doc);
      log('ok', `Calendario en ${String(m.mes).padStart(2, '0')}/${m.anio}`);

      const url = await R.resolverDia(doc, dia, { tick: v.paso });
      log('ok', `Dia ${dia} con disponibilidad`);

      job.phase = 'turno';
      job.turnoUrl = url;
      guardarJob(job);
      location.href = url;
    } catch (err) {
      fallar(err);
    }
  }

  /** Fase 2 — turno.php: slot, panel y llenado. Frena antes de Aceptar. */
  async function fase2() {
    corriendo(true);
    const v = velocidad();
    try {
      const { doc, turnoId, hora } = await R.abrirGenerar(job.payload.hora, { tick: v.paso });
      log('ok', `Slot ${hora} libre (turno_id ${turnoId})`);

      const horaPanel = R.horaDelPanel(doc);
      if (horaPanel && horaPanel !== hora) {
        throw new R.RpaStop(`El panel abrio en ${horaPanel} y esperaba ${hora}`);
      }
      log('ok', `Panel abierto — Hora: ${horaPanel || hora}`);

      const res = await llenar(doc, job.payload, v);
      log('ok', `${res.cargados} campos cargados`);
      res.avisos.forEach((a) => log('warn', a));
      log('info', 'Listo. "Aceptar" NO se toco: el turno no esta confirmado.');

      job.phase = 'done';
      guardarJob(job);
    } catch (err) {
      fallar(err);
    } finally {
      corriendo(false);
    }
  }

  /** Escribe el payload en el panel. Cero focus(); blur al final. */
  async function llenar(doc, p, v) {
    const pac = p.paciente || {};
    const opts = { tick: v.tick, pausa: v.pausa, chunks: 10 };
    const avisos = [];
    let cargados = 0;

    const tipoDoc = await R.elegir(doc.getElementById('turno_tipo_doc'), pac.tipoDoc || 'DNI', {
      pausa: v.sel,
    });
    if (tipoDoc.ok) cargados += 1;
    else avisos.push(`Tipo de documento: ${tipoDoc.motivo}`);

    const textos = [
      ['turno_apellido', pac.apellido],
      ['turno_nombres', pac.nombre],
      ['turno_nro_doc', pac.documento],
      ['turno_domicilio', pac.domicilio],
      ['turno_telefono', pac.telefono],
      ['turno_celular', pac.celular],
      ['turno_mail', pac.email],
    ];
    for (const [id, valor] of textos) {
      if (await R.escribir(doc.getElementById(id), valor, opts)) cargados += 1;
    }

    const cob = await R.elegir(doc.getElementById('turno_deudor'), p.cobertura, { pausa: v.sel });
    if (cob.ok) cargados += 1;
    else avisos.push(`Cobertura sin cargar — ${cob.motivo}`);

    const mot = await R.elegir(doc.getElementById('Motivo'), p.motivo, { pausa: v.sel });
    if (mot.ok) cargados += 1;
    else avisos.push(`Motivo sin cargar — ${mot.motivo}`);

    if (typeof p.usaLC === 'boolean') {
      const radio = doc.getElementById(p.usaLC ? 'lc_si' : 'lc_no');
      if (await R.marcarRadio(radio, { pausa: v.sel })) cargados += 1;
    } else {
      R.markUnresolved(doc.getElementById('lc_si'));
      avisos.push('Usa LC? sin dictar (es obligatorio en Treelan)');
    }

    if (await R.escribir(doc.getElementById('turno_comentario'), p.comentarios, opts)) cargados += 1;

    if (p.enviaRecordatorio === false) {
      const chk = doc.getElementById('envia_recordatorio');
      if (chk && chk.checked) {
        chk.checked = false;
        chk.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    // Ninguna tecla suelta debe caer en un campo del formulario.
    if (doc.activeElement && doc.activeElement.blur) doc.activeElement.blur();

    return { cargados, avisos };
  }

  // ----------------------------------------------------------------- arranque

  function ruta() {
    if (!job) return;
    if (job.phase === 'calendario' && enCalendarios()) {
      fase1();
    } else if (job.phase === 'turno' && enTurno()) {
      fase2();
    } else if (job.phase === 'turno' && !enTurno()) {
      log('err', 'Se perdio la pagina de turnos; volve a arrancar.');
      job.phase = 'error';
      guardarJob(job);
    }
  }

  function iniciar() {
    montar();
    // Un tick para que Treelan termine de armar sus iframes.
    setTimeout(ruta, 400);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar, { once: true });
  } else {
    iniciar();
  }

  // ---- Ingesta desde la llamada (Deepgram/MedPlum -> background -> aca) ------
  // El backend arma el payload con lo que surge de la llamada con el paciente y
  // lo empuja como { type: 'OIDO_SCHEDULE', payload, lento? }. El background
  // (background.js) lo reenvia a esta pestaña. Ver INTEGRATION.md.
  try {
    if (globalThis.chrome && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (!msg || msg.type !== 'OIDO_SCHEDULE') return false;
        montar(); // asegurar el widget montado antes de arrancar
        const res = arrancarCon(msg.payload, msg.lento, msg.origen || 'externo');
        sendResponse(res);
        return false;
      });
    }
  } catch {
    /* fuera de un content script (p. ej. abierto como archivo): ignorar */
  }

  // ---- Transporte B: el WS al backend vive en el service worker ---------------
  // La pagina de Treelan es HTTPS; un ws:// desde aca podria bloquearse como
  // mixed content. En cambio el background (contexto chrome-extension://) abre el
  // WS a ws://localhost sin ese problema y nos reenvia el payload por
  // chrome.runtime.onMessage (manejado arriba). Al cargar, despertamos al SW para
  // que asegure la conexion.
  try {
    if (globalThis.chrome && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: 'OIDO_WS_ENSURE' }, () => void chrome.runtime.lastError);
    }
  } catch {
    /* fuera de un content script: el widget sigue aceptando payload a mano */
  }
})();
