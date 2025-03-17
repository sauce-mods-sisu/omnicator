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
const entireWindow = document.getElementById('omnicator');
const chatWindow = document.getElementById('chats-output');
const configBtn = document.getElementById('config-btn');
const configPanel = document.getElementById('config-panel');
const closeConfigBtn = document.getElementById('close-config-btn');
const saveConfigBtn = document.getElementById('save-config-btn');
const configForm = document.getElementById('config-form'); // form inside config panel

// New DOM references for the excluded countries dropdown and pills container.
const excludedSelect = document.getElementById('excluded-country-codes-input');
const excludedPillsContainer = document.getElementById('excluded-country-pills');

/** Configuration settings keys **/
const COST_PER_TOKEN_KEY = 'costPerTokenSetting';
const EXCLUDED_COUNTRY_CODES_KEY = 'excludedCountryCodesSetting';
const MESSAGE_TIMEOUT_KEY = 'messageTimeout';
const MESSAGE_LIMIT_KEY = 'messageLimit';

/** Global tracking variables **/
let accumulatedTokens = 0;
let accumulatedCost = 0;
let costPerToken = parseFloat(common.settingsStore.get(COST_PER_TOKEN_KEY)) || 0.00000015;
let messageTimeout = parseFloat(common.settingsStore.get(MESSAGE_TIMEOUT_KEY)) || 120; // default seconds
let messageLimit = parseInt(common.settingsStore.get(MESSAGE_LIMIT_KEY)) || 8;

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
const chatGptRole = "You are a translator that identifies the language being written and translates to English. " +
  "Return the determined language of the message in braces such as [English] " +
  "followed by the translated message with nothing else. ";

/**
 * Sample chat message:
 * {"from":4840821,"to":0,"_f3":1,"firstName":"Ryan","lastName":"M. YT@RideItBetterCycling",
 * "message":"Testing","avatar":"https://static-cdn.zwift.com/prod/profile/dcca3831-3085098",
 * "countryCode":840,"eventSubgroup":0,"ts":1742095490940.415,"team":"SISU"}
 */
const chatGptUrl = 'https://api.openai.com/v1/chat/completions';

/* ===============================
   Dragging functionality
   =============================== */
let isDragging = false;
let offsetX = 0;
let offsetY = 0;
chatWindow.addEventListener('mousedown', (e) => {
  isDragging = true;
  offsetX = e.clientX - chatWindow.offsetLeft;
  offsetY = e.clientY - chatWindow.offsetTop;
});
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

/** Append a new message to the chat messages container **/
function addMessageToChats(firstName, lastName, message, countryCode) {
  firstName = firstName ?? "";
  lastName = lastName ?? "";
  
  const messageDiv = document.createElement('div');
  messageDiv.className = "message";
  
  // Convert countryCode (number) to a string with leading zeros (3 digits)
  const codeStr = String(countryCode).padStart(3, '0');
  
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
  messageText.textContent = message;

  if (codeStr in flagIcons) {
    const flagImg = document.createElement('img');
    flagImg.src = flagIcons[codeStr].url;
    flagImg.alt = "Flag";
    flagImg.className = "message-flag"; // Use CSS to control size.
    chatContainerSpan.appendChild(flagImg);
  }
  
  // Append elements in the desired order.
  chatContainerSpan.appendChild(messageName);
  chatContainerSpan.appendChild(colonText);
  chatContainerSpan.appendChild(messageText);

  messageDiv.appendChild(chatContainerSpan);
  
  const chatMessages = document.getElementById('chat-messages');
  
  // Insert new messages at the top.
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
   ChatGPT Completions & Translation
   =============================== */
/**
 * Translates a message using the ChatGPT API.
 * If the country code is in the excluded list, displays the original message.
 */
function translate(message, firstName, lastName, countryCode) {
  const codeStr = String(countryCode).padStart(3, '0');
  
  if (excludedCountryCodes.has(codeStr)) {
    console.log(`Not translating message from ${codeStr}`);
    addMessageToChats(firstName, lastName, message, codeStr);
    return;
  }
  
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  };
  
  const requestBody = {
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: chatGptRole },
      { role: "user", content: message }
    ]
  };
  
  fetch(chatGptUrl, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(requestBody)
  })
    .then(response => response.json())
    .then(data => {
      console.log("ChatGPT response:", data);
      const translatedMessage = data.choices[0]?.message?.content;
      if (translatedMessage) {
        addMessageToChats(firstName, lastName, translatedMessage, codeStr);
      } else {
        console.error("No translated message received", data);
      }
      if (data.usage && data.usage.total_tokens) {
        accumulatedTokens += data.usage.total_tokens;
        accumulatedCost += data.usage.total_tokens * costPerToken;
        updateCostDisplay();
      }
    })
    .catch(error => {
      console.error('Error:', error);
    });
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
    translate(message, firstName, lastName, countryCode);
  });
}

/* ===============================
   Initialization
   =============================== */
function init() {
  initConfigPanel();
}

document.addEventListener('DOMContentLoaded', () => {
  init();
  main();
});
