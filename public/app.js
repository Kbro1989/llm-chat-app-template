/* === MATRIX RAIN === */
const canvas = document.getElementById("matrix");
const ctx = canvas.getContext("2d");
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
const chars = "01";
const fontSize = 16;
const columns = Math.floor(canvas.width / fontSize);
const drops = Array(columns).fill(1);

function drawMatrix() {
  ctx.fillStyle = "rgba(0,0,0,0.05)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = `hsl(${Math.random() * 120 + 120},100%,60%)`;
  ctx.font = `${fontSize}px monospace`;
  drops.forEach((y, i) => {
    const text = chars[Math.floor(Math.random() * chars.length)];
    ctx.fillText(text, i * fontSize, y * fontSize);
    if (y * fontSize > canvas.height && Math.random() > 0.975) drops[i] = 0;
    drops[i]++;
  });
}
setInterval(drawMatrix, 33);

/* === CHAT === */
const chatBox = document.getElementById("chat-box");
const chatInput = document.getElementById("chat-input");
const sendBtn = document.getElementById("send-btn");
const micBtn = document.getElementById("mic-btn");

function appendMessage(sender, msg, image) {
  const div = document.createElement("div");
  div.innerHTML = `<b>${sender}:</b> ${msg}`;
  if (image) {
    const img = document.createElement("img");
    img.src = `data:image/png;base64,${image}`;
    div.appendChild(img);
  }
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

async function sendMessage(msg) {
  appendMessage("You", msg);
  chatInput.value = "";
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: msg }),
  });
  const data = await res.json();
  appendMessage("AI", data.reply);

  // If AI reply suggests image generation
  if (/image|picture|scene|concept/i.test(msg)) {
    const imgRes = await fetch("/api/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: msg }),
    });
    const imgData = await imgRes.json();
    appendMessage("AI (image)", "", imgData.image);
  }
}

sendBtn.onclick = () => {
  const msg = chatInput.value.trim();
  if (msg) sendMessage(msg);
};

document.querySelectorAll(".quick").forEach((b) =>
  b.addEventListener("click", () => sendMessage(b.dataset.prompt))
);

/* === VOICE INPUT === */
if ("webkitSpeechRecognition" in window) {
  const rec = new webkitSpeechRecognition();
  rec.continuous = false;
  rec.interimResults = false;
  rec.lang = "en-US";
  micBtn.onclick = () => {
    rec.start();
    micBtn.textContent = "🎙️ Listening...";
  };
  rec.onresult = (e) => {
    chatInput.value = e.results[0][0].transcript;
    micBtn.textContent = "🎤";
  };
  rec.onerror = () => (micBtn.textContent = "🎤");
}

/* === D1 EXPLORER === */
const projectInput = document.getElementById("project-id");
const fileView = document.getElementById("file-view");
const editor = document.getElementById("file-editor");
const saveStatus = document.getElementById("save-status");
let currentFile = null;
let autosaveTimer;

async function refreshFiles() {
  const pid = projectInput.value.trim();
  if (!pid) return;
  const res = await fetch(`/api/structure/${pid}`);
  const data = await res.json();

  fileView.innerHTML = "";
  const folderMap = {};
  data.folders.forEach((f) => {
    const div = document.createElement("div");
    div.className = "folder";
    div.textContent = `📁 ${f.name}`;
    div.dataset.id = f.folder_id;
    div.onclick = () => {
      const files = fileView.querySelectorAll(`.file[data-folder='${f.folder_id}']`);
      files.forEach((el) => el.classList.toggle("hidden"));
    };
    folderMap[f.folder_id] = div;
    fileView.appendChild(div);
  });

  data.files.forEach((f) => {
    const div = document.createElement("div");
    div.className = "file";
    div.dataset.id = f.file_id;
    div.dataset.folder = f.folder_id;
    div.textContent = `📄 ${f.name}`;
    div.onclick = () => loadFile(f.file_id);
    fileView.appendChild(div);
  });
}

async function loadFile(id) {
  const pid = projectInput.value.trim();
  const res = await fetch(`/api/structure/${pid}`);
  const data = await res.json();
  const file = data.files.find((x) => x.file_id === id);
  currentFile = file;
  editor.value = file.content;
  saveStatus.textContent = "💾 Loaded";
}

async function saveFile() {
  if (!currentFile) return;
  saveStatus.textContent = "💾 Saving...";
  saveStatus.classList.add("saving");
  await fetch("/api/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: currentFile.file_id, content: editor.value }),
  });
  saveStatus.textContent = "✅ Saved";
  saveStatus.classList.remove("saving");
}

editor.addEventListener("input", () => {
  clearTimeout(autosaveTimer);
  saveStatus.textContent = "💾 Editing...";
  autosaveTimer = setTimeout(saveFile, 1500);
});

document.getElementById("add-folder").onclick = async () => {
  const pid = projectInput.value.trim();
  const name = prompt("Folder name:");
  if (!pid || !name) return;
  await fetch("/api/folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_id: pid, name }),
  });
  refreshFiles();
};

document.getElementById("add-file").onclick = async () => {
  const pid = projectInput.value.trim();
  const name = prompt("File name:");
  if (!pid || !name) return;
  await fetch("/api/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_id: pid, name }),
  });
  refreshFiles();
};

document.getElementById("save-file").onclick = saveFile;
projectInput.addEventListener("change", refreshFiles);
