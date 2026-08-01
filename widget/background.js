/**
 * Service worker del widget de demo.
 *
 * Unico rol: recibir el payload que surge de la llamada con el paciente desde
 * una pagina externa autorizada (el panel de control del agente de voz) y
 * reenviarlo al content script que corre sobre la pestania de Treelan.
 *
 *   Pagina externa
 *     -> chrome.runtime.sendMessage(EXT_ID, { type:'OIDO_SCHEDULE', payload })
 *        -> onMessageExternal (aca)
 *           -> chrome.tabs.sendMessage(tabDeTreelan, msg)
 *              -> content.js: arrancarCon(payload)  // navega y llena
 *
 * Las paginas autorizadas se declaran en manifest.externally_connectable.matches.
 * (localhost NO es un match valido para externally_connectable: para dev local
 *  usar un tunel/deploy con dominio real, o el transporte "pull" via WebSocket
 *  que abre el content script — ver INTEGRATION.md.)
 *
 * MODO DEMO: esto solo dispara el llenado; nunca confirma el turno.
 */

const TREELAN_GLOB = 'https://daponteojos.selfip.com/treelan/*';

function reenviarATreelan(msg, sendResponse) {
  chrome.tabs.query({ url: TREELAN_GLOB }, (tabs) => {
    const tab = (tabs || []).find((t) => t.id != null);
    if (!tab) {
      sendResponse({ ok: false, error: 'No hay una pestania de Treelan abierta y logueada.' });
      return;
    }
    chrome.tabs.sendMessage(tab.id, msg, (resp) => {
      if (!chrome.runtime.lastError) {
        sendResponse(resp || { ok: true });
        return;
      }
      // "Receiving end does not exist": la pestania existe pero no hay content
      // script vivo en ella. Pasa SIEMPRE que recargas la extension teniendo
      // Treelan ya abierto — Chrome mata el content script viejo y no inyecta
      // el nuevo en pestanias que ya estaban cargadas. La llamada corre
      // perfecta, el payload llega hasta aca y se pierde en el ultimo salto.
      // Lo inyectamos a mano y reintentamos una vez.
      console.warn('[oido] content script ausente, inyectando:', chrome.runtime.lastError.message);
      chrome.scripting.executeScript(
        { target: { tabId: tab.id }, files: ['rpa.js', 'content.js'] },
        () => {
          if (chrome.runtime.lastError) {
            sendResponse({ ok: false, error: `no pude inyectar: ${chrome.runtime.lastError.message}` });
            return;
          }
          // Un respiro para que content.js registre su onMessage.
          setTimeout(() => {
            chrome.tabs.sendMessage(tab.id, msg, (resp2) => {
              if (chrome.runtime.lastError) {
                sendResponse({ ok: false, error: chrome.runtime.lastError.message });
                return;
              }
              sendResponse(resp2 || { ok: true });
            });
          }, 200);
        },
      );
    });
  });
}

chrome.runtime.onMessageExternal.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'OIDO_SCHEDULE') {
    sendResponse({ ok: false, error: 'tipo de mensaje desconocido' });
    return false;
  }
  reenviarATreelan(msg, sendResponse);
  return true; // respuesta asincrona
});

// ---- Transporte B: pull por WebSocket desde el service worker ---------------
// El backend arma el payload con lo que surge de la llamada y lo empuja como
// { type:'OIDO_SCHEDULE', payload } por este WS (keyed por callId). El SW lo
// reenvia a la pestania de Treelan. Corre en contexto chrome-extension:// asi
// que no lo frena el mixed-content de la pagina HTTPS ni la CSP de Treelan.
// Puerto del backend de esta copia del repo. Cada workspace de Conductor corre
// en el suyo (8787, 8788, 8789…): si cambias el PORT del .env, cambialo aca y
// agregalo a manifest.host_permissions, si no el SW no puede abrir el WS.
const OIDO_BACKEND_PORT = 8790;
// callId: tiene que ser EL MISMO que usa el panel del micrófono. El panel lo
// saca de ?callId= y si no hay, usa 'demo' — por eso hay que abrirlo SIN query
// string. Si no coinciden, el push del backend no llega a ningún lado y la
// llamada termina igual de bien: por eso conviene mirar /health -> widgets.
const OIDO_BACKEND_WS = `ws://localhost:${OIDO_BACKEND_PORT}/v1/voice/stream?callId=demo`;
let oidoWS = null;
let oidoPing = null;

function ensureBackendWS() {
  if (oidoWS && (oidoWS.readyState === WebSocket.OPEN || oidoWS.readyState === WebSocket.CONNECTING)) {
    return;
  }
  try {
    oidoWS = new WebSocket(OIDO_BACKEND_WS);
  } catch {
    return;
  }
  oidoWS.addEventListener('open', () => {
    // Keepalive: el pong que responde el backend resetea el idle-timer del SW.
    clearInterval(oidoPing);
    oidoPing = setInterval(() => {
      try { oidoWS.send(JSON.stringify({ type: 'ping' })); } catch {}
    }, 15000);
  });
  oidoWS.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (!msg) return;
    if (msg.type === 'OIDO_SCHEDULE') {
      // El backend ya considero "entregado" el payload al mandarlo por el WS,
      // pero todavia falta el salto que mas se cae: encontrar la pestania de
      // Treelan. Si ese salto falla y nadie avisa, la llamada termina perfecta
      // y en el EHR no pasa nada. Devolvemos el resultado para que quede en el
      // log del backend.
      reenviarATreelan(msg, (res) => {
        if (res && res.ok !== false) return;
        try {
          oidoWS.send(JSON.stringify({
            type: 'OIDO_DELIVERY',
            ok: false,
            error: (res && res.error) || 'el content script no respondio',
          }));
        } catch {}
      });
      return;
    }
    // Busqueda de paciente y lectura de la historia clinica: a diferencia de
    // OIDO_SCHEDULE, el backend espera la respuesta (con eso decide que dice el
    // agente), asi que la devolvemos por el mismo WS correlacionada por id.
    if (msg.type === 'OIDO_BUSCAR_PACIENTE' || msg.type === 'OIDO_LEER_HISTORIA') {
      reenviarATreelan(msg, (res) => {
        const r = res || { ok: false, error: 'sin respuesta del content script' };
        try {
          oidoWS.send(JSON.stringify({ type: 'OIDO_RESULT', id: msg.id, ...r }));
        } catch {}
      });
      return;
    }
    // 'pong' se ignora: su llegada ya mantuvo vivo al service worker.
  });
  oidoWS.addEventListener('close', () => {
    clearInterval(oidoPing);
    oidoWS = null;
    setTimeout(ensureBackendWS, 2000); // reconexion
  });
  oidoWS.addEventListener('error', () => { try { oidoWS.close(); } catch {} });
}

// Despertadores: al arrancar el navegador, al instalar, y cuando el content
// script de Treelan carga (nos manda OIDO_WS_ENSURE) por si el SW se durmio.
chrome.runtime.onStartup.addListener(ensureBackendWS);
chrome.runtime.onInstalled.addListener(ensureBackendWS);
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'OIDO_WS_ENSURE') {
    ensureBackendWS();
    sendResponse({ ok: true });
    return false;
  }
  // La ficha que el content script leyo de paciente.php, camino al backend para
  // que la indexe en Moss. El POST sale de aca y no del content script: la pagina
  // de Treelan es HTTPS y un fetch a http://localhost se bloquea como mixed
  // content. Este contexto es chrome-extension://, asi que no.
  if (msg && msg.type === 'OIDO_HISTORIA') {
    fetch(`http://localhost:${OIDO_BACKEND_PORT}/v1/pacientes/contexto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg.historia),
    })
      .then((r) => r.json())
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, error: (e && e.message) || String(e) }));
    return true; // respuesta asincrona
  }
  // Veredicto del RPA (content.js -> aca -> backend -> Task en MedPlum). Llega
  // despues de una navegacion completa, asi que el SW pudo haberse dormido y
  // perdido el WS: reconectar no serviria a tiempo, se pierde el reporte y el
  // Task queda en 'requested', que es una lectura honesta de lo que paso.
  if (msg && msg.type === 'OIDO_RPA_RESULT') {
    ensureBackendWS();
    try {
      if (oidoWS && oidoWS.readyState === WebSocket.OPEN) oidoWS.send(JSON.stringify(msg));
    } catch {}
    sendResponse({ ok: true });
    return false;
  }
  return false;
});
ensureBackendWS(); // intento inicial al evaluar el service worker
