import * as common from '/pages/src/common.mjs';
import { flagIcons } from './flags.js';
import * as tts from './tts.mjs';

/* ===============================
   Backend config (NO CLIENT SECRETS — EVER)
   =============================== */
const BACKEND_BASE = 'https://api.rideitbettercycling.com';
const TRANSLATE_URL = `${BACKEND_BASE}/translate`;
const SAUCE_MOD_ID_STORAGE_KEY = 'sauceModId';

/** Generate or load a stable SauceMod client id */
function getOrCreateSauceModId() {
  let id = localStorage.getItem(SAUCE_MOD_ID_STORAGE_KEY);
  if (id) return id;
  // 16 random bytes -> hex
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  id = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  localStorage.setItem(SAUCE_MOD_ID_STORAGE_KEY, id);
  return id;
}
const SAUCE_MOD_ID = getOrCreateSauceModId();

/* =========================================================
   SECURITY HARDENING: fetch wrapper that strips disallowed
   headers no matter what. We NEVER send API keys or bearer.
   ========================================================= */
async function safeFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  // strip any accidental/3rd-party additions:
  headers.delete('authorization');
  headers.delete('Authorization');
  headers.delete('x-api-key');
  headers.delete('X-API-Key');
  options.headers = headers;
  return fetch(url, options);
}

/** DOM references **/
const chatWindow = document.getElementById('chats-output');
const configBtn = document.getElementById('config-btn');
const configPanel = document.getElementById('config-panel');
const closeConfigBtn = document.getElementById('close-config-btn');
const saveConfigBtn = document.getElementById('save-config-btn');
const configForm = document.getElementById('config-form'); // form inside config panel
const languageSelect = document.getElementById('language-select');

const chatMessages = document.getElementById('chat-messages'); // container for delegation

// New DOM references for the excluded countries dropdown and pills container.
const excludedSelect = document.getElementById('excluded-country-codes-input');
const excludedPillsContainer = document.getElementById('excluded-country-pills');

/** Configuration settings keys **/
const COST_PER_TOKEN_KEY = 'costPerTokenSetting';
const EXCLUDED_COUNTRY_CODES_KEY = 'excludedCountryCodesSetting';
const MESSAGE_TIMEOUT_KEY = 'messageTimeout';
const MESSAGE_LIMIT_KEY = 'messageLimit';
const USER_BASE_LANGUAGE_KEY = 'userLanguage';
const CLICK_TO_RETRANSLATE_KEY = 'clickToRetranslateSetting';
const TTS_ENABLED_KEY = 'ttsEnabled';
const TTS_TEST_VOICE_KEY = 'ttsTestVoice';
const TTS_SPEED_KEY = 'ttsSpeed';
const VOICE_PINS_KEY = 'ttsVoicePins';
const VOICE_ROTATION_KEY = 'ttsVoiceRotationIdx';

/** Global tracking variables **/
const defaultLanguage = "English";
const languageTokenPlaceholder = "{USER_LANGUAGE_OF_CHOICE}";

/**
 * Allowed language values — sourced at runtime directly from the <select> so
 * this set can never drift out of sync with the HTML options list.
 * Populated in init() once the DOM is ready; guarded with a fallback set for
 * the rare case the element is missing.
 */
let ALLOWED_LANGUAGES = new Set([defaultLanguage]);

function buildAllowedLanguages() {
  const sel = document.getElementById('language-select');
  if (!sel) return;
  ALLOWED_LANGUAGES = new Set(Array.from(sel.options).map(o => o.value).filter(Boolean));
}

/**
 * Validate a language string against the known-good option list.
 * Any value not in the whitelist (e.g. a prompt-injected localStorage value)
 * is silently replaced with the default language before it reaches the backend.
 */
function sanitizeLanguage(lang) {
  if (ALLOWED_LANGUAGES.has(lang)) return lang;
  console.warn(`[omnicator] Rejecting unsanctioned language value: "${lang}", falling back to "${defaultLanguage}"`);
  return defaultLanguage;
}

let accumulatedTokens = 0;
let accumulatedCost = 0;
let costPerToken = parseFloat(common.settingsStore.get(COST_PER_TOKEN_KEY)) || 0.00000015;
let messageTimeout = parseFloat(common.settingsStore.get(MESSAGE_TIMEOUT_KEY)) || 120; // default seconds
let messageLimit = parseInt(common.settingsStore.get(MESSAGE_LIMIT_KEY)) || 8;
let userLanguage = common.settingsStore.get(USER_BASE_LANGUAGE_KEY) || defaultLanguage;

// Load the click-to-retranslate setting from storage (default true)
let clickToRetranslateEnabled = common.settingsStore.get(CLICK_TO_RETRANSLATE_KEY);
if (clickToRetranslateEnabled === null || clickToRetranslateEnabled === undefined) {
  clickToRetranslateEnabled = true;
} else {
  clickToRetranslateEnabled = clickToRetranslateEnabled === "true";
}

// TTS state
let ttsEnabled = common.settingsStore.get(TTS_ENABLED_KEY) === 'true';
let ttsTestVoice = common.settingsStore.get(TTS_TEST_VOICE_KEY) || 'Bella';
let ttsSpeed = parseFloat(common.settingsStore.get(TTS_SPEED_KEY)) || 1.2;
let ttsInitializing = false;

// Voice pinning — persists per-speaker assignments across sessions
const VOICE_LIST = Object.keys(tts.VOICES); // ['Bella','Jasper','Luna','Bruno','Rosie','Hugo','Kiki','Leo']
let voicePins = {};
try { voicePins = JSON.parse(common.settingsStore.get(VOICE_PINS_KEY) || '{}'); } catch { voicePins = {}; }
let voiceRotationIdx = parseInt(common.settingsStore.get(VOICE_ROTATION_KEY) || '0') % VOICE_LIST.length;

// Prefer the stable numeric Zwift Rider ID; fall back to name for edge cases (system messages, etc.)
function speakerKey(riderId, firstName, lastName) {
  if (riderId != null && riderId !== 0) return `id:${riderId}`;
  return `${(firstName || '').trim().toLowerCase()}|${(lastName || '').trim().toLowerCase()}`;
}

const MAX_VOICE_PINS = 10_000; // ~270 KB at ~27 bytes/entry — well within localStorage limits

function getOrAssignVoice(riderId, firstName, lastName) {
  const key = speakerKey(riderId, firstName, lastName);
  if (voicePins[key]) return voicePins[key];

  // Evict the oldest entry when the cap is reached (V8 preserves insertion order on plain objects)
  const keys = Object.keys(voicePins);
  if (keys.length >= MAX_VOICE_PINS) delete voicePins[keys[0]];

  const voice = VOICE_LIST[voiceRotationIdx % VOICE_LIST.length];
  voiceRotationIdx = (voiceRotationIdx + 1) % VOICE_LIST.length;
  voicePins[key] = voice;
  common.settingsStore.set(VOICE_PINS_KEY, JSON.stringify(voicePins));
  common.settingsStore.set(VOICE_ROTATION_KEY, String(voiceRotationIdx));
  return voice;
}

function clearVoicePins() {
  voicePins = {};
  voiceRotationIdx = 0;
  common.settingsStore.set(VOICE_PINS_KEY, '{}');
  common.settingsStore.set(VOICE_ROTATION_KEY, '0');
}

async function ensureTtsReady() {
  if (tts.isReady() || ttsInitializing) return;
  ttsInitializing = true;
  const statusEl = document.getElementById('tts-status');
  const progressContainer = document.getElementById('tts-progress-container');
  const progressFill = document.getElementById('tts-progress-fill');
  const progressText = document.getElementById('tts-progress-text');
  try {
    if (statusEl) { statusEl.textContent = 'loading...'; statusEl.className = 'tts-status loading'; }
    if (progressContainer) progressContainer.classList.remove('hidden');
    await tts.init((pct) => {
      if (progressFill) progressFill.style.width = pct + '%';
      if (progressText) progressText.textContent = pct < 100 ? `Downloading model... ${pct}%` : 'Initializing...';
    });
    if (statusEl) { statusEl.textContent = 'ready'; statusEl.className = 'tts-status ready'; }
    if (progressContainer) progressContainer.classList.add('hidden');
  } catch (e) {
    console.error('[tts] init failed:', e);
    if (statusEl) { statusEl.textContent = 'error'; statusEl.className = 'tts-status error'; }
    ttsEnabled = false;
  } finally {
    ttsInitializing = false;
  }
}

// Populate the dropdown for excluded countries using flagIcons data.
if (excludedSelect) {
  for (const [code, data] of Object.entries(flagIcons)) {
    const option = document.createElement('option');
    option.value = code; // Keys are strings like "840"
    option.textContent = data.name; // Display country name
    excludedSelect.appendChild(option);
  }
}

// Excluded country codes set (default to exclude US ("840") if not set)
let excludedCountryCodes = new Set();
{
  const storedExcluded = common.settingsStore.get(EXCLUDED_COUNTRY_CODES_KEY);
  if (storedExcluded) {
    try {
      excludedCountryCodes = new Set(JSON.parse(storedExcluded)); // e.g. ["840","826"]
    } catch (err) {
      console.error('Error parsing excluded country codes, using default', err);
      excludedCountryCodes = new Set(["840"]);
    }
  } else {
    excludedCountryCodes = new Set(["840"]);
  }
}

// Function to update the pills display for excluded countries.
function updateExcludedCountryPills() {
  if (!excludedPillsContainer) return;
  excludedPillsContainer.innerHTML = '';
  excludedCountryCodes.forEach(code => {
    const pill = document.createElement('span');
    pill.className = 'excluded-pill';
    pill.textContent = flagIcons[code]?.name || code;

    const removeBtn = document.createElement('button');
    removeBtn.textContent = '×';
    removeBtn.className = 'remove-pill-btn';
    removeBtn.addEventListener('click', () => {
      excludedCountryCodes.delete(code);
      updateExcludedCountryPills();
    });
    pill.appendChild(removeBtn);
    excludedPillsContainer.appendChild(pill);
  });
}
updateExcludedCountryPills();

/* ===============================
   Dragging functionality
   =============================== */
let isDragging = false;
let offsetX = 0;
let offsetY = 0;

document.addEventListener('mousemove', (e) => {
  if (isDragging && chatWindow) {
    chatWindow.style.left = (e.clientX - offsetX) + 'px';
    chatWindow.style.top = (e.clientY - offsetY) + 'px';
  }
});
document.addEventListener('mouseup', () => {
  isDragging = false;
});

// Header elements for token count and cost.
const tokenCountEl = document.getElementById('token-count');
const estimatedCostEl = document.getElementById('estimated-cost');

function updateCostDisplay() {
  if (tokenCountEl) tokenCountEl.textContent = `Tokens Used: ${accumulatedTokens}`;
  if (estimatedCostEl) estimatedCostEl.textContent = `Estimated Cost: $${accumulatedCost.toFixed(4)}`;
}

/* ===============================
   Lightweight state for minimal intrusion
   =============================== */
let isOnline = true;           // Pause translation if offline
let inEvent = false;           // Helps label/route chat subtly
const mutedKey = (fn, ln) => `${(fn||'').trim().toLowerCase()}|${(ln||'').trim().toLowerCase()}`;
const mutedSenders = new Set(); // Optional mute reflection

// One-time logger to avoid spam if topics are missing
const missingTopicLogged = new Set();

/* ===============================
   DDoP helper (client-side fallback parser)
   =============================== */
// In case server returns only raw DDoP string for some reason:
const ddopRe = /^\[LANG=([^|\]]+)\|ISO=([a-z]{2})\]\s*([\s\S]+)$/i;
function parseDdop(content) {
  if (typeof content !== 'string') return null;
  const m = content.trim().match(ddopRe);
  if (!m) return null;
  return {
    langName: m[1].trim(),
    iso: m[2].toLowerCase().trim(),
    message: m[3].trim()
  };
}

/* ===============================
   Backend Translation (NO Authorization, NO API Key, NO HMAC)
   =============================== */
async function translate(message, firstName, lastName, countryCode, channel, riderId = null) {
  const codeStr = String(countryCode).padStart(3, '0');

  // If the country is excluded or we're offline, return the original message.
  if (excludedCountryCodes.has(codeStr) || !isOnline) {
    return {
      riderId,
      firstName,
      lastName,
      countryCode: codeStr,
      originalMessage: message,
      translatedMessage: message,
      channel
    };
  }

  // Always reload the language from storage in case it changed; sanitize before use.
  userLanguage = sanitizeLanguage(common.settingsStore.get(USER_BASE_LANGUAGE_KEY) || defaultLanguage);

  // Whitelisted headers only
  const headers = new Headers({
    'Content-Type': 'application/json',
    'X-Sauce-Mod-Id': SAUCE_MOD_ID
  });

  const body = {
    text: message,
    target_language: userLanguage,
    model: "gpt-4o-mini",
    max_tokens: 1024,
    temperature: 0.2
  };

  try {
    const resp = await safeFetch(TRANSLATE_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      let errDetail = '';
      try { errDetail = JSON.stringify(await resp.json()); } catch {}
      console.warn('Backend error:', resp.status, resp.statusText, errDetail);
      throw new Error(`HTTP ${resp.status} ${resp.statusText} ${errDetail}`);
    }

    const data = await resp.json();
    if (!data || data.success !== true) {
      console.warn('Backend translate failed; falling back to original:', data?.message);
      return {
        riderId, firstName, lastName, countryCode: codeStr,
        originalMessage: message, translatedMessage: message, channel
      };
    }

    // Update token/cost HUD if available
    const usage = data.data?.usage;
    if (usage?.total_tokens) {
      accumulatedTokens += usage.total_tokens;
      accumulatedCost += usage.total_tokens * costPerToken;
      updateCostDisplay();
    }

    // Prefer server-parsed DDoP message -> translation
    const translatedMessage =
      data.data?.translation ??
      parseDdop(data.data?.ddop?.raw || '')?.message ??
      message; // final fallback

    const ddop = data.data?.ddop
      ? {
          langName: data.data.ddop.lang_name || null,
          iso: data.data.ddop.iso || null,
          raw: data.data.ddop.raw || null
        }
      : null;

    console.debug('[translate] ddop:', ddop, '| raw data.data:', data.data);

    return {
      riderId,
      firstName,
      lastName,
      countryCode: codeStr,
      originalMessage: message,
      translatedMessage,
      channel,
      ddop
    };

  } catch (error) {
    console.error('Error during translation:', error);
    // Minimal intrusion fallback: show original
    return {
      riderId,
      firstName,
      lastName,
      countryCode: codeStr,
      originalMessage: message,
      translatedMessage: message,
      channel
    };
  }
}

/* ===============================
   View Logic: Adding Message to Chats
   =============================== */
function addMessageToChats(translationResult) {
  const { riderId, firstName, lastName, countryCode, originalMessage, translatedMessage, channel, ddop } = translationResult;

  // Resolve voice for this speaker before building the DOM so the button closure captures it
  const speakerVoice = ttsEnabled ? getOrAssignVoice(riderId, firstName, lastName) : ttsTestVoice;

  const messageDiv = document.createElement('div');
  messageDiv.className = "message";

  // Store original data for re-translation.
  messageDiv.setAttribute('data-original-message', originalMessage);
  messageDiv.setAttribute('data-first-name', firstName);
  messageDiv.setAttribute('data-last-name', lastName);
  messageDiv.setAttribute('data-country-code', countryCode);
  if (riderId != null) messageDiv.setAttribute('data-rider-id', riderId);

  const chatContainerSpan = document.createElement('span');

  if (channel) {
    const ch = document.createElement('span');
    ch.className = 'message-channel';
    ch.textContent = `【${channel.replace('_chat', '').replace('chat', 'nearby')}】`;
    ch.style.marginRight = '0.25rem';
    ch.style.opacity = '0.75';
    chatContainerSpan.appendChild(ch);
  }

  const messageName = document.createElement('span');
  messageName.className = "message-name";
  messageName.textContent = `${firstName} ${lastName}`;

  const colonText = document.createTextNode(': ');

  const messageText = document.createElement('span');
  messageText.className = "message-text";
  messageText.textContent = translatedMessage;

  if (countryCode in flagIcons) {
    const flagImg = document.createElement('img');
    flagImg.src = flagIcons[countryCode].url;
    flagImg.alt = "Flag";
    flagImg.className = "message-flag";
    chatContainerSpan.appendChild(flagImg);
  }

  // Language source tag — shown whenever the backend identifies the source language
  const langLabel = ddop?.langName || (ddop?.iso ? ddop.iso.toUpperCase() : null);
  if (langLabel) {
    const langTag = document.createElement('span');
    langTag.className = 'message-lang-tag';
    langTag.textContent = langLabel;
    langTag.title = `Translated from ${langLabel}`;
    chatContainerSpan.appendChild(langTag);
  }

  // Voice badge — shows which voice is pinned to this speaker
  if (ttsEnabled) {
    const voiceTag = document.createElement('span');
    voiceTag.className = 'message-voice-tag';
    voiceTag.textContent = speakerVoice;
    voiceTag.title = `Voice: ${speakerVoice}`;
    chatContainerSpan.appendChild(voiceTag);
  }

  chatContainerSpan.appendChild(messageName);
  chatContainerSpan.appendChild(colonText);
  chatContainerSpan.appendChild(messageText);

  if (ttsEnabled && tts.isReady()) {
    const speakBtn = document.createElement('button');
    speakBtn.className = 'tts-speak-btn';
    speakBtn.textContent = '🔊';
    speakBtn.title = `Speak as ${speakerVoice}`;
    speakBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      speakBtn.classList.add('speaking');
      tts.clearQueue();
      tts.speak(translatedMessage, speakerVoice)
        .finally(() => speakBtn.classList.remove('speaking'));
    });
    chatContainerSpan.appendChild(speakBtn);
  }

  messageDiv.appendChild(chatContainerSpan);

  // Left-click still re-translates per-message
  messageDiv.addEventListener('click', () => {
    reTranslateMessage(messageDiv);
  });

  // Auto-speak: enqueue so messages play in order without blocking each other
  if (ttsEnabled && tts.isReady()) {
    tts.enqueue(translatedMessage, speakerVoice, ttsSpeed);
  }

  // Insert newest on top
  if (chatMessages) {
    chatMessages.insertBefore(messageDiv, chatMessages.firstChild);

    setTimeout(() => {
      if (messageDiv.parentElement === chatMessages) {
        chatMessages.removeChild(messageDiv);
      }
    }, messageTimeout * 1000);

    // Enforce the configured message limit.
    while (chatMessages.childNodes.length > messageLimit) {
      chatMessages.removeChild(chatMessages.lastChild);
    }
  }
}

/* ===============================
   Re-translation
   =============================== */
function reTranslateMessage(messageDiv) {
  if (!clickToRetranslateEnabled) return;

  const originalMessage = messageDiv.getAttribute('data-original-message');
  const firstName = messageDiv.getAttribute('data-first-name');
  const lastName = messageDiv.getAttribute('data-last-name');
  const countryCode = messageDiv.getAttribute('data-country-code');
  const riderIdAttr = messageDiv.getAttribute('data-rider-id');
  const riderId = riderIdAttr != null ? Number(riderIdAttr) : null;

  if (excludedCountryCodes.has(countryCode)) {
    console.log(`Re-translation skipped for excluded country ${countryCode}`);
    return;
  }

  translate(originalMessage, firstName, lastName, countryCode, undefined, riderId)
    .then(result => {
      const messageText = messageDiv.querySelector('.message-text');
      if (messageText) {
        messageText.textContent = result.translatedMessage;
      }
    })
    .catch(error => console.error('Error during re-translation:', error));
}

/* ===============================
   Right-click re-translate (robust via delegation)
   =============================== */
if (chatMessages) {
  chatMessages.addEventListener('contextmenu', (e) => {
    const msg = e.target.closest('.message');
    if (!msg) return;
    e.preventDefault();
    e.stopPropagation();
    reTranslateMessage(msg);
  }, true);

  // Optional: middle-click also re-translate
  chatMessages.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    const msg = e.target.closest('.message');
    if (!msg) return;
    e.preventDefault();
    reTranslateMessage(msg);
  }, true);
}

/* ===============================
   Header Update for Language Display
   =============================== */
function updateHudHeaderLanguage() {
  userLanguage = common.settingsStore.get(USER_BASE_LANGUAGE_KEY) || defaultLanguage;
  if (languageSelect) languageSelect.value = userLanguage;
  const hudLanguageDisplay = document.getElementById('hud-language-display');
  const selectedOption = languageSelect?.options[languageSelect.selectedIndex];
  if (hudLanguageDisplay && selectedOption) {
    hudLanguageDisplay.textContent = selectedOption.textContent;
  }
}

/* ===============================
   Configuration Panel Logic
   =============================== */
function initConfigPanel() {
  if (configBtn) {
    configBtn.addEventListener('click', () => {
      if (!configPanel) return;
      configPanel.classList.remove('hidden');

      const costInput = document.getElementById('cost-per-token-input');
      if (costInput) costInput.value = costPerToken.toFixed(8);

      const timeoutInput = document.getElementById('message-timeout');
      if (timeoutInput) timeoutInput.value = messageTimeout;

      const limitInput = document.getElementById('message-limit');
      if (limitInput) limitInput.value = messageLimit;

      const languageSelectEl = document.getElementById('language-select');
      if (languageSelectEl) {
        userLanguage = common.settingsStore.get(USER_BASE_LANGUAGE_KEY) || defaultLanguage;
        languageSelectEl.value = userLanguage;
        updateHudHeaderLanguage();
      }

      const clickToRetranslateCheckbox = document.getElementById('click-to-translate-control');
      if (clickToRetranslateCheckbox) {
        clickToRetranslateCheckbox.checked = clickToRetranslateEnabled;
      }

      const ttsCheckbox = document.getElementById('tts-enabled');
      if (ttsCheckbox) ttsCheckbox.checked = ttsEnabled;
      const ttsVoiceSelect = document.getElementById('tts-voice-select');
      if (ttsVoiceSelect) ttsVoiceSelect.value = ttsTestVoice;
      const ttsSpeedSlider = document.getElementById('tts-speed');
      const ttsSpeedDisplay = document.getElementById('tts-speed-display');
      if (ttsSpeedSlider) ttsSpeedSlider.value = ttsSpeed;
      if (ttsSpeedDisplay) ttsSpeedDisplay.textContent = ttsSpeed.toFixed(2);
      const ttsOpts = document.getElementById('tts-options');
      if (ttsOpts) ttsOpts.classList.toggle('hidden', !ttsEnabled);
      const statusEl = document.getElementById('tts-status');
      if (statusEl) {
        if (tts.isReady()) { statusEl.textContent = 'ready'; statusEl.className = 'tts-status ready'; }
        else if (ttsEnabled) { statusEl.textContent = 'not loaded'; statusEl.className = 'tts-status'; }
        else { statusEl.textContent = ''; statusEl.className = 'tts-status'; }
      }
      const pinsCountEl = document.getElementById('voice-pins-count');
      if (pinsCountEl) {
        const n = Object.keys(voicePins).length;
        pinsCountEl.textContent = n > 0 ? `${n} / ${MAX_VOICE_PINS} pinned` : 'none pinned';
      }

      updateExcludedCountryPills();
    });
  }

  if (closeConfigBtn) {
    closeConfigBtn.addEventListener('click', () => {
      if (configPanel) configPanel.classList.add('hidden');
    });
  }

  const addExcludedBtn = document.getElementById('add-excluded-btn');
  if (addExcludedBtn) {
    addExcludedBtn.addEventListener('click', () => {
      const selectedCode = excludedSelect?.value;
      if (selectedCode && !excludedCountryCodes.has(selectedCode)) {
        excludedCountryCodes.add(selectedCode);
        updateExcludedCountryPills();
      }
    });
  }

  const ttsToggle = document.getElementById('tts-enabled');
  if (ttsToggle) {
    ttsToggle.addEventListener('change', () => {
      const opts = document.getElementById('tts-options');
      if (opts) opts.classList.toggle('hidden', !ttsToggle.checked);
      if (ttsToggle.checked) ensureTtsReady();
    });
  }

  const ttsTestBtn = document.getElementById('tts-test-btn');
  if (ttsTestBtn) {
    ttsTestBtn.addEventListener('click', async () => {
      const voice = document.getElementById('tts-voice-select')?.value || 'Bella';
      const speed = parseFloat(document.getElementById('tts-speed')?.value) || ttsSpeed;
      ttsTestBtn.disabled = true;
      ttsTestBtn.textContent = '…';
      try {
        await ensureTtsReady();
        if (tts.isReady()) await tts.speak('Hello, this is a test of kitten T T S.', voice, speed);
      } catch (e) {
        console.error('[tts] test failed:', e);
      } finally {
        ttsTestBtn.disabled = false;
        ttsTestBtn.textContent = 'Test';
      }
    });
  }

  const ttsSpeedSlider = document.getElementById('tts-speed');
  if (ttsSpeedSlider) {
    ttsSpeedSlider.addEventListener('input', () => {
      const display = document.getElementById('tts-speed-display');
      if (display) display.textContent = parseFloat(ttsSpeedSlider.value).toFixed(2);
    });
  }

  const clearPinsBtn = document.getElementById('clear-voice-pins-btn');
  if (clearPinsBtn) {
    clearPinsBtn.addEventListener('click', () => {
      clearVoicePins();
      tts.clearQueue();
      const pinsCountEl = document.getElementById('voice-pins-count');
      if (pinsCountEl) pinsCountEl.textContent = 'none pinned';
    });
  }

  if (saveConfigBtn) {
    saveConfigBtn.addEventListener('click', (e) => {
      console.log("Saving options");
      e.preventDefault();
      if (!configForm) return;
      const formData = new FormData(configForm);

      const newCost = parseFloat(formData.get('cost-per-token-input'));
      if (!isNaN(newCost)) {
        costPerToken = newCost;
        common.settingsStore.set(COST_PER_TOKEN_KEY, costPerToken.toString());
      }

      const newTimeout = parseFloat(formData.get('message-timeout'));
      if (!isNaN(newTimeout)) {
        messageTimeout = newTimeout;
        common.settingsStore.set(MESSAGE_TIMEOUT_KEY, messageTimeout.toString());
      }

      const newLimit = parseInt(formData.get('message-limit'));
      if (!isNaN(newLimit)) {
        messageLimit = newLimit;
        common.settingsStore.set(MESSAGE_LIMIT_KEY, messageLimit.toString());
      }

      const newLanguage = sanitizeLanguage(formData.get('language-select') || defaultLanguage);
      if (newLanguage) {
        userLanguage = newLanguage;
        console.log(`Setting new language to ${userLanguage}`);
        common.settingsStore.set(USER_BASE_LANGUAGE_KEY, userLanguage);
        updateHudHeaderLanguage();
      }

      const clickToRetranslateCheckbox = document.getElementById('click-to-translate-control');
      if (clickToRetranslateCheckbox) {
        clickToRetranslateEnabled = clickToRetranslateCheckbox.checked;
        common.settingsStore.set(CLICK_TO_RETRANSLATE_KEY, clickToRetranslateEnabled.toString());
      }

      const ttsCheckbox = document.getElementById('tts-enabled');
      if (ttsCheckbox) {
        ttsEnabled = ttsCheckbox.checked;
        common.settingsStore.set(TTS_ENABLED_KEY, ttsEnabled.toString());
        if (ttsEnabled) ensureTtsReady();
      }
      const ttsVoiceSelect = document.getElementById('tts-voice-select');
      if (ttsVoiceSelect) {
        ttsTestVoice = ttsVoiceSelect.value;
        common.settingsStore.set(TTS_TEST_VOICE_KEY, ttsTestVoice);
      }
      const ttsSpeedEl = document.getElementById('tts-speed');
      if (ttsSpeedEl) {
        ttsSpeed = parseFloat(ttsSpeedEl.value) || 1.2;
        common.settingsStore.set(TTS_SPEED_KEY, ttsSpeed.toString());
      }

      common.settingsStore.set(EXCLUDED_COUNTRY_CODES_KEY, JSON.stringify(Array.from(excludedCountryCodes)));
      if (configPanel) configPanel.classList.add('hidden');
    });
  }
}

/* ===============================
   Helpers: topic subscription and normalization
   =============================== */
const CHAT_TOPICS = [
  'chat',         // nearby / open world
  'event_chat',   // group rides / races
  'club_chat',    // club channels
  'direct_chat',  // 1:1 messages
  'system_chat'   // organizer/system announcements that appear as chat
];

const STATE_TOPICS = [
  'event_state',      // entering/leaving an event pen, etc.
  'world_state',      // world/route swaps; optional cleanups
  'net_status',       // online/offline reconnects
  'mute_list_changed' // reflect Sauce mutes if exposed
];

// Normalize expected shape to { riderId, firstName, lastName, countryCode, message }
// `from` is the stable numeric Zwift Rider ID emitted by the Sauce framework.
function normalizeChatData(data) {
  const riderId = data.from ?? data.riderId ?? data.athleteId ?? null;
  const firstName = data.firstName ?? data.fname ?? data.first ?? '';
  const lastName = data.lastName ?? data.lname ?? data.last ?? '';
  const countryCode = data.countryCode ?? data.cc ?? data.country ?? 0;
  const message = data.message ?? data.msg ?? data.text ?? '';
  return { riderId, firstName, lastName, countryCode, message };
}

function subscribeSafe(topic, handler) {
  try {
    common.subscribe(topic, handler);
  } catch (e) {
    if (!missingTopicLogged.has(topic)) {
      missingTopicLogged.add(topic);
      console.debug(`[chat-mod] Topic "${topic}" unavailable; continuing without it.`);
    }
  }
}

/* ===============================
   Main app (renderer, watchers)
   =============================== */
async function main() {
  // Keep original nearby/open-world subscription behavior
  subscribeSafe('chat', async messageData => {
    const { riderId, firstName, lastName, countryCode, message } = normalizeChatData(messageData);

    if (mutedSenders.has(mutedKey(firstName, lastName))) return;

    try {
      const result = await translate(message, firstName, lastName, countryCode, 'chat', riderId);
      addMessageToChats(result);
    } catch (error) {
      console.error("Translation error:", error);
    }
  });

  // Additional chat-like channels (non-intrusive)
  for (const t of CHAT_TOPICS.filter(t => t !== 'chat')) {
    subscribeSafe(t, async messageData => {
      const { riderId, firstName, lastName, countryCode, message } = normalizeChatData(messageData);
      if (mutedSenders.has(mutedKey(firstName, lastName))) return;
      try {
        const result = await translate(message, firstName, lastName, countryCode, t, riderId);
        addMessageToChats(result);
      } catch (err) {
        console.error(`Translation error on ${t}:`, err);
      }
    });
  }

  // State topics (best-effort)
  subscribeSafe('net_status', status => {
    if (typeof status?.online === 'boolean') {
      isOnline = status.online;
    } else if (typeof status === 'string') {
      isOnline = (status.toLowerCase() !== 'offline');
    }
  });

  subscribeSafe('event_state', evt => {
    if (typeof evt?.inEvent === 'boolean') {
      inEvent = evt.inEvent;
    } else if (typeof evt?.type === 'string') {
      inEvent = evt.type.toLowerCase() === 'enter';
    }
  });

  subscribeSafe('world_state', _w => {});

  subscribeSafe('mute_list_changed', payload => {
    try {
      if (Array.isArray(payload?.muted)) {
        mutedSenders.clear();
        for (const m of payload.muted) mutedSenders.add(mutedKey(m.firstName, m.lastName));
      } else if (Array.isArray(payload)) {
        mutedSenders.clear();
        for (const m of payload) mutedSenders.add(mutedKey(m.firstName, m.lastName));
      } else if (payload?.action === 'add' && payload?.user) {
        mutedSenders.add(mutedKey(payload.user.firstName, payload.user.lastName));
      } else if (payload?.action === 'remove' && payload?.user) {
        mutedSenders.delete(mutedKey(payload.user.firstName, payload.user.lastName));
      }
    } catch (e) {
      console.debug('[chat-mod] mute_list_changed payload not understood; ignoring.', e);
    }
  });
}

/* ===============================
   Initialization
   =============================== */
function init() {
  buildAllowedLanguages();
  initConfigPanel();
}

document.addEventListener('DOMContentLoaded', () => {
  updateHudHeaderLanguage();
  init();
  main();
  if (ttsEnabled) ensureTtsReady();
});
