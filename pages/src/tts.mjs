/**
 * KittenTTS WASM module for Omnicator
 *
 * Runs the KittenTTS Mini 0.8 ONNX model entirely client-side via
 * ONNX Runtime Web (WASM backend). The ~78 MB model is downloaded once
 * from HuggingFace and cached in IndexedDB for instant subsequent loads.
 *
 * Public API:
 *   init()                 – preload model + voices (call once at startup)
 *   speak(text, voice)     – synthesize and play immediately; returns a Promise
 *   enqueue(text, voice)   – add to playback queue; non-blocking
 *   clearQueue()           – stop current playback and drain the queue
 *   getQueueDepth()        – number of messages waiting in the queue
 *   stop()                 – abort current playback
 *   isReady()              – true after init() resolves
 *   getLoadProgress()      – 0-100 during model download
 *   VOICES                 – available voice map
 */

const MODEL_URL =
  'https://huggingface.co/KittenML/kitten-tts-mini-0.8/resolve/main/kitten_tts_mini_v0_8.onnx';
const ORT_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist';

// SRI hash for ort.min.js at the version pinned above.
// ⚠️  When bumping ORT_CDN to a new version, recompute with:
//   $url = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@<NEW_VER>/dist/ort.min.js'
//   $bytes = (Invoke-WebRequest $url -OutFile "$env:TEMP\ort.min.js" -UseBasicParsing; [IO.File]::ReadAllBytes("$env:TEMP\ort.min.js"))
//   "sha384-" + [Convert]::ToBase64String(([Security.Cryptography.SHA384]::Create()).ComputeHash($bytes))
const ORT_SRI = 'sha384-viYmIzsXdPb1ErOTdWrs+j0B4FjltSSGeHvt08cedBpoO5xvp3qMRSo05NZTuuzh';
const SAMPLE_RATE = 24000;
const DB_NAME = 'OmnicatorTTSCache';
const DB_VERSION = 1;
const STORE = 'models';

export const VOICES = {
  Bella:  'expr-voice-2-f',
  Jasper: 'expr-voice-2-m',
  Luna:   'expr-voice-3-f',
  Bruno:  'expr-voice-3-m',
  Rosie:  'expr-voice-4-f',
  Hugo:   'expr-voice-4-m',
  Kiki:   'expr-voice-5-f',
  Leo:    'expr-voice-5-m',
};

/* ── internal state ─────────────────────────────── */
let ort = null;           // onnxruntime-web namespace
let session = null;       // InferenceSession
let voiceData = null;     // { "expr-voice-2-m": [[...], ...], ... }
let phonemize = null;     // phonemizer.js phonemize function
let audioCtx = null;
let currentSource = null; // for stop()
let loadProgress = 0;
let _ready = false;

/* ── speak queue ─────────────────────────────────── */
const MAX_QUEUE_DEPTH = 10;
const _queue = [];
let _queueRunning = false;

export function isReady() { return _ready; }
export function getLoadProgress() { return loadProgress; }
export function getQueueDepth() { return _queue.length; }

/**
 * Add a message to the sequential playback queue.
 * If the queue is full the oldest pending item is dropped to stay current.
 * Returns immediately — does not block the caller.
 */
export function enqueue(text, voice = 'Bella', speed = 1.0) {
  if (_queue.length >= MAX_QUEUE_DEPTH) _queue.shift();
  _queue.push({ text, voice, speed });
  if (!_queueRunning) _drainQueue();
}

async function _drainQueue() {
  if (_queue.length === 0) { _queueRunning = false; return; }
  _queueRunning = true;
  const { text, voice, speed } = _queue.shift();
  try { await speak(text, voice, speed); } catch (e) { console.debug('[tts] queue speak error:', e); }
  _drainQueue();
}

/**
 * Stop current playback and discard all queued messages.
 */
export function clearQueue() {
  _queue.length = 0;
  stop();
  _queueRunning = false;
}

/* ── IndexedDB cache ────────────────────────────── */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE))
        db.createObjectStore(STORE, { keyPath: 'url' });
    };
  });
}

async function getCached(url) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction([STORE], 'readonly');
      const req = tx.objectStore(STORE).get(url);
      req.onsuccess = () => resolve(req.result?.data ?? null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

async function putCache(url, data) {
  try {
    const db = await openDB();
    const tx = db.transaction([STORE], 'readwrite');
    tx.objectStore(STORE).put({ url, data, ts: Date.now() });
  } catch (e) { console.warn('[tts] cache write failed:', e); }
}

/* ── model download with progress ───────────────── */
async function downloadModel(url, onProgress) {
  const cached = await getCached(url);
  if (cached) { onProgress?.(100); return cached; }

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Model download failed: ${resp.status}`);

  const total = +(resp.headers.get('content-length') || 0);
  const reader = resp.body.getReader();
  const chunks = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total > 0) onProgress?.(Math.round((received / total) * 100));
  }

  const buf = new ArrayBuffer(received);
  const view = new Uint8Array(buf);
  let pos = 0;
  for (const c of chunks) { view.set(c, pos); pos += c.length; }

  await putCache(url, buf);
  return buf;
}

/* ── character tokenizer (matches official TextCleaner) ── */
const _buildCharMap = () => {
  const pad = '$';
  const punct = ';:,.!?¡¿—…\u201C\u00AB\u00BB\u201D\u201C ';
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const ipa =
    'ɑɐɒæɓʙβɔɕçɗɖðʤəɘɚɛɜɝɞɟʄɡɠɢʛɦɧħɥʜɨɪʝɭɬɫɮʟɱɯɰŋɳɲɴøɵɸθœɶʘɹɺɾɻʀʁɽʂʃʈʧʉʊʋⱱʌɣɤʍχʎʏʑʐʒʔʡʕʢǀǁǂǃˈˌːˑʼʴʰʱʲʷˠˤ˞↓↑→↗↘\u2018̩\u2019ᵻ';
  const symbols = [pad, ...punct, ...letters, ...ipa];
  const map = new Map();
  symbols.forEach((ch, i) => map.set(ch, i));
  return map;
};
const CHAR_MAP = _buildCharMap();

/**
 * Mirrors Python basic_english_tokenize: split on word boundaries (Unicode-aware),
 * then rejoin with spaces so punctuation gets its own space-separated slot.
 */
function basicEnglishTokenize(text) {
  return (text.match(/[\p{L}\p{M}\p{N}_]+|[^\p{L}\p{M}\p{N}_\s]/gu) || []).join(' ');
}

/**
 * Split long text into ≤400-char chunks at sentence boundaries (matches official chunker).
 */
function chunkText(text, maxLen = 400) {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks = [];
  for (const s of sentences) {
    const trimmed = s.trim();
    if (!trimmed) continue;
    if (trimmed.length <= maxLen) {
      chunks.push(trimmed);
    } else {
      const words = trimmed.split(/\s+/);
      let buf = '';
      for (const w of words) {
        if (buf && buf.length + w.length + 1 > maxLen) {
          chunks.push(buf);
          buf = w;
        } else {
          buf = buf ? buf + ' ' + w : w;
        }
      }
      if (buf) chunks.push(buf);
    }
  }
  return chunks.length ? chunks : [text];
}

/**
 * Phonemize text via espeak-ng, then tokenize into model input IDs.
 * Matches the official Python pipeline: phonemize → basic_english_tokenize → TextCleaner.
 */
async function phonemizeAndTokenize(text) {
  let cleaned = text.trim();
  if (!cleaned) return [0, 0];

  if (!'.!?,;:'.includes(cleaned[cleaned.length - 1])) {
    cleaned += ',';
  }

  const trailingPunct = cleaned.match(/[.!?,;:]+$/)?.[0] || '';

  const result = await phonemize(cleaned, 'en-us');
  let ipa = (result || []).join(' ');

  if (trailingPunct && ipa && !'.!?,;:'.includes(ipa[ipa.length - 1])) {
    ipa += trailingPunct;
  }

  const normalized = basicEnglishTokenize(ipa);

  const ids = [0];
  for (const ch of normalized) {
    const id = CHAR_MAP.get(ch);
    if (id !== undefined) ids.push(id);
  }
  ids.push(0);
  return ids;
}

/** Yield to the browser event loop so it can paint/handle input between heavy WASM ops. */
const _yield = () => new Promise(r => setTimeout(r, 0));

/* ── public API ─────────────────────────────────── */

/**
 * Preload ONNX Runtime, model, and voice data.
 * @param {function} onProgress  – callback(percent: 0-100) during model download
 */
export async function init(onProgress) {
  if (_ready) return;

  console.log('[tts] step 1/5 – loading onnxruntime-web…');
  if (!ort) {
    if (window.ort) {
      ort = window.ort;
    } else {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `${ORT_CDN}/ort.min.js`;
        script.integrity = ORT_SRI;
        script.crossOrigin = 'anonymous';
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Failed to load ort.min.js from ${ORT_CDN}`));
        document.head.appendChild(script);
      });
      ort = window.ort;
    }
    ort.env.wasm.wasmPaths = `${ORT_CDN}/`;
    ort.env.wasm.proxy = true; // run inference in a Web Worker; keeps main thread responsive
  }
  console.log('[tts] step 1/5 – onnxruntime-web loaded ✓');

  console.log('[tts] step 2/5 – loading phonemizer (espeak-ng WASM)…');
  if (!phonemize) {
    const phonemizerUrl = new URL('./phonemizer.js', import.meta.url).href;
    const mod = await import(phonemizerUrl);
    phonemize = mod.phonemize;
    await phonemize('test', 'en-us');
  }
  console.log('[tts] step 2/5 – phonemizer ready ✓');

  console.log('[tts] step 3/5 – downloading model (may be cached)…');
  const modelBuf = await downloadModel(MODEL_URL, (p) => {
    loadProgress = p;
    onProgress?.(p);
  });
  console.log('[tts] step 3/5 – model ready ✓');

  console.log('[tts] step 4/5 – creating WASM inference session…');
  session = await ort.InferenceSession.create(modelBuf, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  console.log('[tts] step 4/5 – session created ✓');

  console.log('[tts] step 5/5 – loading voice data…');
  const voicesUrl = new URL('./voices.json', import.meta.url).href;
  const voiceResp = await fetch(voicesUrl);
  if (!voiceResp.ok) throw new Error(`Failed to load voices.json (${voiceResp.status}) from ${voicesUrl}`);
  voiceData = await voiceResp.json();
  console.log('[tts] step 5/5 – voices loaded ✓');

  _ready = true;
  loadProgress = 100;
  console.log('[tts] fully initialized');
}

/**
 * Synthesize and play text.
 * @param {string} text
 * @param {string} voice – friendly name (e.g. "Bella") or internal id
 * @param {number} speed – 0.5–2.0
 * @returns {Promise<void>} resolves when playback finishes
 */
export async function speak(text, voice = 'Bella', speed = 1.0) {
  if (!_ready) throw new Error('TTS not initialized – call init() first');

  const voiceId = VOICES[voice] || voice;
  const vdata = voiceData[voiceId];
  if (!vdata) throw new Error(`Unknown voice: ${voice}`);

  const chunks = chunkText(text);
  const audioParts = [];

  for (const chunk of chunks) {
    await _yield(); // let the browser paint between chunks
    const tokens = await phonemizeAndTokenize(chunk);
    await _yield(); // yield again before ONNX inference
    const inputIds = new ort.Tensor('int64', BigInt64Array.from(tokens.map(BigInt)), [1, tokens.length]);

    const refIdx = Math.min(chunk.length, vdata.length - 1);
    const style = new ort.Tensor('float32', new Float32Array(vdata[refIdx]), [1, 256]);
    const speedT = new ort.Tensor('float32', new Float32Array([speed]), [1]);

    const results = await session.run({ input_ids: inputIds, style, speed: speedT });
    const outputKey = session.outputNames[0];
    const raw = results[outputKey].data;
    audioParts.push(raw.slice(0, Math.max(0, raw.length - 5000)));
  }

  const totalLen = audioParts.reduce((s, p) => s + p.length, 0);
  const audio = new Float32Array(totalLen);
  let off = 0;
  for (const p of audioParts) { audio.set(p, off); off += p.length; }

  // peak-limit only if clipping (preserves original dynamics)
  let peak = 0;
  for (let i = 0; i < audio.length; i++) peak = Math.max(peak, Math.abs(audio[i]));
  if (peak > 0.95) {
    const s = 0.95 / peak;
    for (let i = 0; i < audio.length; i++) audio[i] *= s;
  }

  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const audioBuf = audioCtx.createBuffer(1, audio.length, SAMPLE_RATE);
  audioBuf.getChannelData(0).set(audio);

  stop();
  return new Promise((resolve) => {
    const src = audioCtx.createBufferSource();
    src.buffer = audioBuf;
    src.connect(audioCtx.destination);
    src.onended = () => { currentSource = null; resolve(); };
    currentSource = src;
    src.start();
  });
}

/** Stop current playback if any. */
export function stop() {
  if (currentSource) {
    try { currentSource.stop(); } catch {}
    currentSource = null;
  }
}
