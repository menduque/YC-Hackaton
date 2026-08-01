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
      // Sin este log el modo de falla es invisible: el payload de la llamada
      // llega al service worker, no encuentra pestania, y el widget se queda
      // mostrando el payload de ejemplo como si nunca hubiera habido llamada.
      console.error('[oido] payload recibido pero NO hay pestania de Treelan abierta:', msg);
      sendResponse({ ok: false, error: 'No hay una pestania de Treelan abierta y logueada.' });
      return;
    }
    console.log('[oido] payload de la llamada -> pestania', tab.id, msg);
    chrome.tabs.sendMessage(tab.id, msg, (resp) => {
      if (chrome.runtime.lastError) {
        console.error('[oido] la pestania no recibio el payload:', chrome.runtime.lastError.message);
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      console.log('[oido] la pestania arranco el RPA:', resp);
      sendResponse(resp || { ok: true });
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
const OIDO_BACKEND_PORT = 8789;
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
    if (msg && msg.type === 'OIDO_SCHEDULE') reenviarATreelan(msg, () => {});
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
  }
  return false;
});
ensureBackendWS(); // intento inicial al evaluar el service worker
