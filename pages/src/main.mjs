import * as common from '/pages/src/common.mjs';
import { flagIcons } from './flags.js';

/** Ephemeral API Key Setup **/
// Check sessionStorage for API key; if not found, show the API key modal.
let apiKey = sessionStorage.getItem('userApiKey');
if (!apiKey) {
  document.getElementById('api-key-modal').classList.remove('hidden');
}
const saveApiKeyBtn = document.getElementById('save-api-key-btn');
saveApiKeyBtn.addEventListener('click', () => {
  const keyInput = document.getElementById('api-key-input');
  if (keyInput.value) {
    apiKey = keyInput.value;
    sessionStorage.setItem('userApiKey', apiKey);
    document.getElementById('api-key-modal').classList.add('hidden');
  }
});

/** DOM references **/
const chatWindow = document.getElementById('chats-output');
const configBtn = document.getElementById('config-btn');
const configPanel = document.getElementById('config-panel');
const closeConfigBtn = document.getElementById('close-config-btn');
const saveConfigBtn = document.getElementById('save-config-btn');
const configForm = document.getElementById('config-form'); // form inside config panel
const languageSelect = document.getElementById('language-select');

// New DOM references for the excluded countries dropdown and pills container.
const excludedSelect = document.getElementById('excluded-country-codes-input');
const excludedPillsContainer = document.getElementById('excluded-country-pills');

/** Configuration settings keys **/
const COST_PER_TOKEN_KEY = 'costPerTokenSetting';
const EXCLUDED_COUNTRY_CODES_KEY = 'excludedCountryCodesSetting';
const MESSAGE_TIMEOUT_KEY = 'messageTimeout';
const MESSAGE_LIMIT_KEY = 'messageLimit';
const USER_BASE_LANGUAGE_KEY = 'userLanguage';

/** Global tracking variables **/
const defaultLanguage = "English";
const languageTokenPlaceholder = "{USER_LANGUAGE_OF_CHOICE}";

let accumulatedTokens = 0;
let accumulatedCost = 0;
let costPerToken = parseFloat(common.settingsStore.get(COST_PER_TOKEN_KEY)) || 0.00000015;
let messageTimeout = parseFloat(common.settingsStore.get(MESSAGE_TIMEOUT_KEY)) || 120; // default seconds
let messageLimit = parseInt(common.settingsStore.get(MESSAGE_LIMIT_KEY)) || 8;
// NOTE: Instead of relying solely on the global variable, we now reload it when needed.
let userLanguage = common.settingsStore.get(USER_BASE_LANGUAGE_KEY) || defaultLanguage;

// Populate the dropdown for excluded countries using flagIcons data.
for (const [code, data] of Object.entries(flagIcons)) {
  const option = document.createElement('option');
  option.value = code; // Keys are strings like "840"
  option.textContent = data.name; // Display country name
  excludedSelect.appendChild(option);
}

// Excluded country codes set (default to exclude US ("840") if not set)
let excludedCountryCodes = new Set();
{
  const storedExcluded = common.settingsStore.get(EXCLUDED_COUNTRY_CODES_KEY);
  if (storedExcluded) {
    try {
      // Expecting a JSON array of strings, e.g. ["840", "826"]
      excludedCountryCodes = new Set(JSON.parse(storedExcluded));
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

/** ChatGPT role **/
const chatGptRole = `You are a translator that identifies the language of the provided message and translates it to ${languageTokenPlaceholder}. ` +
  `Return the name of language, translated to ${languageTokenPlaceholder}, inside braces [...] followed by the translated message, with nothing else.`;

/**
 * ChatGPT API URL
 */
const chatGptUrl = 'https://api.openai.com/v1/chat/completions';

/* ===============================
   Dragging functionality
   =============================== */
let isDragging = false;
let offsetX = 0;
let offsetY = 0;

document.addEventListener('mousemove', (e) => {
  if (isDragging) {
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
  tokenCountEl.textContent = `Tokens Used: ${accumulatedTokens}`;
  estimatedCostEl.textContent = `Estimated Cost: $${accumulatedCost.toFixed(4)}`;
}

/* ===============================
   ChatGPT Completions & Translation (Model)
   =============================== */
/**
 * Translates a message using the ChatGPT API.
 * Returns a promise that resolves to an object:
 * {
 *   firstName,
 *   lastName,
 *   countryCode,      // padded, e.g. "840"
 *   originalMessage,
 *   translatedMessage
 * }
 */
async function translate(message, firstName, lastName, countryCode) {
  const codeStr = String(countryCode).padStart(3, '0');
  
  // If the country is excluded, return the original message.
  if (excludedCountryCodes.has(codeStr)) {
    return {
      firstName,
      lastName,
      countryCode: codeStr,
      originalMessage: message,
      translatedMessage: message
    };
  }
  
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  };
  
  // Always reload the language from storage in case it changed.
  userLanguage = common.settingsStore.get(USER_BASE_LANGUAGE_KEY) || defaultLanguage;
  const chatGptRoleReplacingLanguage = chatGptRole.replaceAll(languageTokenPlaceholder, userLanguage);
  const requestBody = {
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: chatGptRoleReplacingLanguage },
      { role: "user", content: message }
    ]
  };
  
  try {
    const response = await fetch(chatGptUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(requestBody)
    });
    const data = await response.json();
    console.log("ChatGPT response:", data);
    const translatedMessage = data.choices[0]?.message?.content;
    if (!translatedMessage) {
      throw new Error("No translated message received");
    }
    if (data.usage && data.usage.total_tokens) {
      accumulatedTokens += data.usage.total_tokens;
      accumulatedCost += data.usage.total_tokens * costPerToken;
      updateCostDisplay();
    }
    return {
      firstName,
      lastName,
      countryCode: codeStr,
      originalMessage: message,
      translatedMessage: translatedMessage
    };
  } catch (error) {
    console.error('Error during translation:', error);
    throw error;
  }
}

/* ===============================
   View Logic: Adding Message to Chats
   =============================== */
function addMessageToChats(translationResult) {
  const { firstName, lastName, countryCode, originalMessage, translatedMessage } = translationResult;
  
  const messageDiv = document.createElement('div');
  messageDiv.className = "message";
  
  // Store original data for re-translation.
  messageDiv.setAttribute('data-original-message', originalMessage);
  messageDiv.setAttribute('data-first-name', firstName);
  messageDiv.setAttribute('data-last-name', lastName);
  messageDiv.setAttribute('data-country-code', countryCode);
  
  const chatContainerSpan = document.createElement('span');
  
  // Create a span for the message name.
  const messageName = document.createElement('span');
  messageName.className = "message-name";
  messageName.textContent = `${firstName} ${lastName}`;
  
  // Create a text node for the colon separator.
  const colonText = document.createTextNode(': ');
  
  // Create a span for the message text.
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
  
  chatContainerSpan.appendChild(messageName);
  chatContainerSpan.appendChild(colonText);
  chatContainerSpan.appendChild(messageText);
  messageDiv.appendChild(chatContainerSpan);
  
  // Attach click event for re-translation.
  messageDiv.addEventListener('click', () => {
    reTranslateMessage(messageDiv);
  });
  
  const chatMessages = document.getElementById('chat-messages');
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

/* ===============================
   Re-translation on Message Click
   =============================== */
function reTranslateMessage(messageDiv) {
  const originalMessage = messageDiv.getAttribute('data-original-message');
  const firstName = messageDiv.getAttribute('data-first-name');
  const lastName = messageDiv.getAttribute('data-last-name');
  const countryCode = messageDiv.getAttribute('data-country-code');
  
  // If the country is excluded, skip re-translation.
  if (excludedCountryCodes.has(countryCode)) {
    console.log(`Re-translation skipped for excluded country ${countryCode}`);
    return;
  }
  
  translate(originalMessage, firstName, lastName, countryCode)
    .then(result => {
      const messageText = messageDiv.querySelector('.message-text');
      if (messageText) {
        messageText.textContent = result.translatedMessage;
      }
    })
    .catch(error => console.error('Error during re-translation:', error));
}

/* ===============================
   Header Update for Language Display
   =============================== */
// Reload the language value from storage before updating the header.
function updateHudHeaderLanguage() {
  userLanguage = common.settingsStore.get(USER_BASE_LANGUAGE_KEY) || defaultLanguage;
  languageSelect.value = userLanguage;
  const hudLanguageDisplay = document.getElementById('hud-language-display');
  const selectedOption = languageSelect.options[languageSelect.selectedIndex];
  if (hudLanguageDisplay && selectedOption) {
    hudLanguageDisplay.textContent = selectedOption.textContent;
  }
}

/* ===============================
   Configuration Panel Logic
   =============================== */
function initConfigPanel() {
  configBtn.addEventListener('click', () => {
    configPanel.classList.remove('hidden');
  
    const costInput = document.getElementById('cost-per-token-input');
    if (costInput) costInput.value = costPerToken.toFixed(8);
  
    const timeoutInput = document.getElementById('message-timeout');
    if (timeoutInput) timeoutInput.value = messageTimeout;
  
    const limitInput = document.getElementById('message-limit');
    if (limitInput) limitInput.value = messageLimit;
  
    // Set language dropdown value from the stored userLanguage.
    const languageSelect = document.getElementById('language-select');
    if (languageSelect) {
      userLanguage = common.settingsStore.get(USER_BASE_LANGUAGE_KEY) || defaultLanguage;
      languageSelect.value = userLanguage;
      updateHudHeaderLanguage();
    }
    updateExcludedCountryPills();
  });
  
  closeConfigBtn.addEventListener('click', () => {
    configPanel.classList.add('hidden');
  });
  
  const addExcludedBtn = document.getElementById('add-excluded-btn');
  addExcludedBtn.addEventListener('click', () => {
    const selectedCode = excludedSelect.value;
    if (!excludedCountryCodes.has(selectedCode)) {
      excludedCountryCodes.add(selectedCode);
      updateExcludedCountryPills();
    }
  });
  
  saveConfigBtn.addEventListener('click', (e) => {
    console.log("Saving options");
    e.preventDefault();
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
  
    const newLanguage = formData.get('language-select');
    if (newLanguage) {
      userLanguage = newLanguage;
      console.log(`Setting new language to ${userLanguage}`);
      common.settingsStore.set(USER_BASE_LANGUAGE_KEY, userLanguage);
      updateHudHeaderLanguage();
    }
  
    common.settingsStore.set(EXCLUDED_COUNTRY_CODES_KEY, JSON.stringify(Array.from(excludedCountryCodes)));
    configPanel.classList.add('hidden');
  });
}

/* ===============================
   Main app (renderer, watchers)
   =============================== */
async function main() {
  common.subscribe('chat', async messageData => {
    const { firstName, lastName, countryCode, message } = messageData;
    try {
      const result = await translate(message, firstName, lastName, countryCode);
      addMessageToChats(result);
    } catch (error) {
      console.error("Translation error:", error);
    }
  });
}

/* ===============================
   Initialization
   =============================== */
function init() {
  initConfigPanel();
}

document.addEventListener('DOMContentLoaded', () => {
  // Load the stored language and update the header immediately.
  updateHudHeaderLanguage();
  init();
  main();
});
