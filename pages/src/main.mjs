import * as common from '/pages/src/common.mjs';
import { flagIcons } from './flags.js';

/** DOM references **/
const entireWindow = document.getElementById('omnicator');
const chatWindow = document.getElementById('chats-output');

// Global cost tracking variables
let accumulatedTokens = 0;
let accumulatedCost = 0;
const costPerToken = 0.00000015;  // Adjust according to your pricing

// ChatGPT role
const chatGptRole = "You are a translator that translates to English. " +
  "Return the language of the message in braces such as [Spanish] " +
  "followed by the translated message with nothing else. ";

// ISO 3166-1 Country Codes for English-speaking countries (as needed)
const countryCodesEnglishSpeaking = new Set([840, 826, 124]);

/**
 * {"from":4840821,"to":0,"_f3":1,"firstName":"Ryan","lastName":"M. YT@RideItBetterCycling",
 * "message":"Testing","avatar":"https://static-cdn.zwift.com/prod/profile/dcca3831-3085098",
 * "countryCode":840,"eventSubgroup":0,"ts":1742095490940.415,"team":"SISU"}
 */

const chatGptUrl = 'https://api.openai.com/v1/chat/completions';
const apiKey = "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";

// Dragging functionality
let isDragging = false;
let offsetX = 0;
let offsetY = 0;

// Attach mousedown to chatWindow instead of entireWindow.
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

/** Renderer instance **/
const renderer = new common.Renderer(chatWindow, { fps: 2 });
renderer.addCallback(chatData => {
  console.log(JSON.stringify(chatData));
  if (!chatData) return;
});

// Reference header elements for token count and cost
const tokenCountEl = document.getElementById('token-count');
const estimatedCostEl = document.getElementById('estimated-cost');

function updateCostDisplay() {
  tokenCountEl.textContent = `Tokens: ${accumulatedTokens}`;
  estimatedCostEl.textContent = `Estimated Cost: $${accumulatedCost.toFixed(4)}`;
}

/** Append a new message to the chat messages container **/
function addMessageToChats(message, countryCode) {
  const messageDiv = document.createElement('div');
  messageDiv.className = "message";

  // Create and add flag image if available
  if (countryCode && flagIcons[countryCode]) {
    const flagImg = document.createElement('img');
    flagImg.src = flagIcons[countryCode];
    flagImg.alt = "Flag";
    flagImg.style.width = '24px';
    flagImg.style.height = '24px';
    flagImg.style.marginRight = '8px';
    // Append flag image before the text
    messageDiv.appendChild(flagImg);
  }

  // Add the text message
  const messageText = document.createElement('span');
  messageText.textContent = message;
  messageDiv.appendChild(messageText);

  const chatMessages = document.getElementById('chat-messages');
  chatMessages.appendChild(messageDiv);

  // Remove this message after 2 minutes (120,000 ms)
  setTimeout(() => {
    if (messageDiv.parentElement === chatMessages) {
      chatMessages.removeChild(messageDiv);
    }
  }, 120000);

  // If there are more than 8 messages, remove the oldest until only 7 remain
  while (chatMessages.childNodes.length > 8) {
    chatMessages.removeChild(chatMessages.firstChild);
  }
}

/* ===============================
   ChatGPT Completions & Translation
   =============================== */
/**
 * Translates a message using the ChatGPT API.
 * @param {string} message - The text to translate.
 * @param {string} firstName - The rider's first name.
 * @param {string} lastName - The rider's last name.
 * @param {number} countryCode - The rider's country code.
 */
function translate(message, firstName, lastName, countryCode) {
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
        // Prefix the message with rider details
        const fullMessage = `${firstName} ${lastName} : ${translatedMessage}`;
        // Pass the country code along with the message
        addMessageToChats(fullMessage, countryCode);
      } else {
        console.error("No translated message received", data);
      }
      // Update tokens and cost if usage info is provided
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

function init() {
  // Initialization logic if needed
}

/* ===============================
   Main app (renderer, watchers)
   =============================== */
async function main() {
  // Subscribe to chat messages
  common.subscribe('chat', async messageData => {
    // Extract rider details and the message text
    const { firstName, lastName, countryCode, message } = messageData;
    translate(message, firstName, lastName, countryCode);
    renderer.render();
  });

  // Force re-render on window resize
  addEventListener('resize', () => renderer.render({ force: true }));
  renderer.render();
}

/* ===============================
   Run initialization + main
   =============================== */
document.addEventListener('DOMContentLoaded', () => {
  init();
  main();
});
