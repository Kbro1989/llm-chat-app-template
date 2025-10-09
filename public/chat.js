// DOM elements
const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendButton = document.getElementById("send-button");
const typingIndicator = document.getElementById("typing-indicator");

// Session identifier
const SESSION_ID = "default-session";

// Chat history
let chatHistory = [];
let isProcessing = false;

// Auto-resize textarea
userInput.addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = this.scrollHeight + "px";
});

// Enter key sends message
userInput.addEventListener("keydown", function (e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

sendButton.addEventListener("click", sendMessage);

// Load chat history from D1
async function loadChatHistory() {
  try {
    const res = await fetch(`/api/chat?sessionId=${SESSION_ID}`);
    const messages = await res.json();
    chatMessages.innerHTML = "";
    messages.forEach((msg) => addMessageToChat(msg.role, msg.content));
    chatHistory = messages;
  } catch (err) {
    console.error("Failed to load chat history:", err);
  }
}

// Add message to chat UI
function addMessageToChat(role, content) {
  const messageEl = document.createElement("div");
  messageEl.className = `message ${role}-message`;
  messageEl.innerHTML = `<p>${content}</p>`;
  chatMessages.appendChild(messageEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Send user message
async function sendMessage() {
  const message = userInput.value.trim();
  if (!message || isProcessing) return;

  isProcessing = true;
  userInput.disabled = true;
  sendButton.disabled = true;

  addMessageToChat("user", message);
  chatHistory.push({ role: "user", content: message });
  userInput.value = "";
  userInput.style.height = "auto";
  typingIndicator.classList.add("visible");

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: SESSION_ID, messages: chatHistory }),
    });

    if (!res.ok) throw new Error("Failed to get response");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let assistantText = "";

    const assistantEl = document.createElement("div");
    assistantEl.className = "message assistant-message";
    assistantEl.innerHTML = "<p></p>";
    chatMessages.appendChild(assistantEl);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      assistantText += chunk;
      assistantEl.querySelector("p").textContent = assistantText;
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    chatHistory.push({ role: "assistant", content: assistantText });
  } catch (err) {
    console.error(err);
    addMessageToChat("assistant", "Error processing request.");
  } finally {
    typingIndicator.classList.remove("visible");
    isProcessing = false;
    userInput.disabled = false;
    sendButton.disabled = false;
    userInput.focus();
  }
}

// Load history on page load
loadChatHistory();
