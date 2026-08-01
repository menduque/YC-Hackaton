// Oído mic panel: capture 16k PCM -> backend -> Deepgram; play 24k PCM back.
const CALL_ID = new URLSearchParams(location.search).get("callId") || "demo";
const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/v1/agent?callId=${CALL_ID}`;

const $ = (id) => document.getElementById(id);
const btn = $("btn"), dot = $("dot"), statusEl = $("status"), log = $("log"), fns = $("fns");
const timerEl = $("timer"), callLabel = $("calllabel");

let ws, micCtx, playCtx, processor, source, stream;
let nextTime = 0;
let running = false;
let tickId = null;

/** Green phone → red hang-up, plus a live call timer. */
function setCallUi(activa) {
  btn.classList.toggle("stop", activa);
  const label = activa ? "Cortar" : "Llamar";
  btn.setAttribute("aria-label", activa ? "Cortar la llamada" : "Iniciar llamada");
  btn.title = label;
  callLabel.textContent = label;
  timerEl.classList.toggle("on", activa);

  clearInterval(tickId);
  tickId = null;
  if (!activa) {
    timerEl.textContent = "00:00";
    return;
  }
  const desde = Date.now();
  const pintar = () => {
    const s = Math.floor((Date.now() - desde) / 1000);
    timerEl.textContent =
      `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };
  pintar();
  tickId = setInterval(pintar, 1000);
}

btn.onclick = () => (running ? stop() : start());

async function start() {
  setStatus("conectando…");
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
  } catch (e) {
    setStatus("micrófono denegado");
    return;
  }

  // Capture context resamples to 16 kHz for us.
  micCtx = new AudioContext({ sampleRate: 16000 });
  playCtx = new AudioContext({ sampleRate: 24000 });
  await micCtx.resume();
  await playCtx.resume();
  nextTime = 0;

  ws = new WebSocket(WS_URL);
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    source = micCtx.createMediaStreamSource(stream);
    processor = micCtx.createScriptProcessor(4096, 1, 1);
    const zero = micCtx.createGain();
    zero.gain.value = 0;
    source.connect(processor);
    processor.connect(zero);
    zero.connect(micCtx.destination);
    processor.onaudioprocess = (ev) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(floatTo16BitPCM(ev.inputBuffer.getChannelData(0)).buffer);
    };
    running = true;
    setCallUi(true);
    setStatus("en llamada", "on");
  };

  ws.onmessage = (ev) => {
    if (ev.data instanceof ArrayBuffer) return playPcm(ev.data);
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    handleEvent(m);
  };

  ws.onclose = () => { setStatus("desconectado"); teardown(); };
  ws.onerror = () => setStatus("error de conexión");
}

function handleEvent(m) {
  switch (m.type) {
    case "transcript":
      addMsg(m.role, m.content);
      break;
    case "user_speaking":
      setStatus("escuchando…", "on");
      break;
    case "AgentStartedSpeaking":
      setStatus("hablando…", "speaking");
      break;
    case "AgentThinking":
      setStatus("pensando…", "on");
      break;
    case "AgentAudioDone":
      setStatus("en llamada", "on");
      break;
    case "function_call":
      addFn(m.name, m.arguments);
      break;
    case "function_result":
      if (m.name === "buscar_paciente") showPaciente(m.result);
      break;
    case "function_error":
      addFn(m.name, { error: m.error });
      break;
    case "status":
      if (m.status === "closed") setStatus("agente cerró la sesión");
      break;
    case "error":
      setStatus("error: " + m.message);
      break;
  }
}

function stop() {
  if (ws && ws.readyState === WebSocket.OPEN) ws.close();
  teardown();
  setStatus("desconectado");
}

function teardown() {
  running = false;
  setCallUi(false);
  try { processor && (processor.onaudioprocess = null); } catch {}
  try { source && source.disconnect(); } catch {}
  try { stream && stream.getTracks().forEach((t) => t.stop()); } catch {}
  try { micCtx && micCtx.close(); } catch {}
  try { playCtx && playCtx.close(); } catch {}
}

// --- audio helpers ---
function floatTo16BitPCM(input) {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}
function playPcm(buf) {
  if (!playCtx) return;
  const int16 = new Int16Array(buf);
  const f32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 0x8000;
  const audioBuf = playCtx.createBuffer(1, f32.length, 24000);
  audioBuf.getChannelData(0).set(f32);
  const src = playCtx.createBufferSource();
  src.buffer = audioBuf;
  src.connect(playCtx.destination);
  const now = playCtx.currentTime;
  if (nextTime < now) nextTime = now + 0.04;
  src.start(nextTime);
  nextTime += audioBuf.duration;
}

// --- UI ---
function setStatus(text, cls) {
  statusEl.textContent = text;
  dot.className = "dot" + (cls ? " " + cls : "");
}
function addMsg(role, content) {
  const last = log.lastElementChild;
  // merge consecutive interim updates from the same role
  if (last && last.dataset.role === role && last.dataset.merge === "1") {
    last.querySelector(".body").textContent = content;
  } else {
    const el = document.createElement("div");
    el.className = "msg " + (role === "user" ? "user" : "assistant");
    el.dataset.role = role;
    el.dataset.merge = "1";
    el.innerHTML = `<div class="who">${role === "user" ? "Paciente" : "Mira"}</div><div class="body"></div>`;
    el.querySelector(".body").textContent = content;
    log.appendChild(el);
  }
  log.scrollTop = log.scrollHeight;
}
function addFn(name, args) {
  if (fns.querySelector(".hint")) fns.innerHTML = "";
  const el = document.createElement("div");
  el.className = "fn";
  el.innerHTML = `<b>${name}</b><pre>${escapeHtml(JSON.stringify(args, null, 2))}</pre>`;
  fns.prepend(el);
}
function showPaciente(r) {
  if (!r) return;
  const box = document.getElementById("paciente");
  if (r.ambiguo) {
    box.innerHTML =
      `<div class="pac nuevo"><div class="who">varios coinciden</div>` +
      `<div class="nom">${escapeHtml(String(r.opciones ? r.opciones.length : "?"))} pacientes</div>` +
      `<div class="meta">desambiguando por fecha de nacimiento</div></div>`;
    return;
  }
  if (!r.encontrado) {
    box.innerHTML =
      `<div class="pac nuevo"><div class="who">paciente nuevo</div>` +
      `<div class="nom">sin ficha</div>` +
      `<div class="meta">se da de alta en la llamada</div></div>`;
    return;
  }
  box.innerHTML =
    `<div class="pac"><div class="who">paciente identificado</div>` +
    `<div class="nom">${escapeHtml(`${r.nombre || ""} ${r.apellido || ""}`.trim())}</div>` +
    `<div class="meta">HC ${escapeHtml(r.hc || "—")} · ${escapeHtml(r.fechaNacimiento || "—")}</div></div>`;
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
