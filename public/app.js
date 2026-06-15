const state = {
  user: null,
  documents: [],
  threads: [],
  activeDocumentIds: new Set(),
  currentThreadId: null,
  authMode: "login",
  pollTimer: null,
};

const $ = (selector) => document.querySelector(selector);
const sourceStrip = $("#sourceStrip");
const questionForm = $("#questionForm");
const questionInput = $("#questionInput");
const emptyState = $("#emptyState");
const answerView = $("#answerView");
const evidenceList = $("#evidenceList");
const evidencePanel = $("#evidencePanel");
const uploadModal = $("#uploadModal");
const authModal = $("#authModal");
const toast = $("#toast");

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...options.headers,
    },
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/api/auth/")) showAuth();
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function showToast(message, isError = false) {
  clearTimeout(showToast.timer);
  toast.textContent = message;
  toast.style.background = isError ? "var(--coral)" : "var(--ink)";
  toast.classList.remove("hidden");
  showToast.timer = setTimeout(() => toast.classList.add("hidden"), 2600);
}

function showAuth() {
  authModal.classList.remove("hidden");
}

function hideAuth() {
  authModal.classList.add("hidden");
}

function setAuthMode(mode) {
  state.authMode = mode;
  const register = mode === "register";
  $("#authTitle").textContent = register ? "Create your workspace" : "Sign in to Hogyoku";
  $("#authName").parentElement.classList.toggle("hidden", !register);
  $("#authName").required = register;
  $("#authSwitch").textContent = register
    ? "Already have an account? Sign in"
    : "Create a new account";
  $(".auth-submit").textContent = register ? "Create account" : "Sign in";
  $("#authPassword").autocomplete = register ? "new-password" : "current-password";
  $("#authError").classList.add("hidden");
}

async function submitAuth(event) {
  event.preventDefault();
  const error = $("#authError");
  error.classList.add("hidden");
  const body = {
    email: $("#authEmail").value.trim(),
    password: $("#authPassword").value,
  };
  if (state.authMode === "register") body.displayName = $("#authName").value.trim();
  try {
    await api(`/api/auth/${state.authMode}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const session = await api("/api/auth/me");
    state.user = session.user;
    hideAuth();
    updateProfile();
    await Promise.all([loadDocuments(), loadThreads()]);
  } catch (authError) {
    error.textContent = authError.message;
    error.classList.remove("hidden");
  }
}

function updateProfile() {
  if (!state.user) return;
  const initials = state.user.displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  $(".profile-button .avatar").textContent = initials;
  $(".profile-button strong").textContent = state.user.displayName;
  $(".profile-button small").textContent = state.user.email;
  $(".question-row .avatar").textContent = initials;
}

async function loadDocuments() {
  const payload = await api("/api/documents");
  state.documents = payload.documents;
  const known = new Set(state.documents.map((document) => document.id));
  state.activeDocumentIds.forEach((id) => {
    if (!known.has(id)) state.activeDocumentIds.delete(id);
  });
  state.documents.forEach((document) => {
    if (!state.activeDocumentIds.has(document.id) && document.status === "ready") {
      state.activeDocumentIds.add(document.id);
    }
  });
  renderDocuments();
  scheduleDocumentPolling();
}

function renderDocuments() {
  sourceStrip.innerHTML = state.documents
    .map((document) => {
      const active = state.activeDocumentIds.has(document.id);
      const visual = document.mimeType.startsWith("image/");
      return `
        <button class="source-chip ${active ? "active" : ""}" data-document="${document.id}">
          <span class="file-type ${visual ? "visual" : ""}">${visual ? "SCAN" : document.mimeType === "application/pdf" ? "PDF" : "DOC"}</span>
          <span>
            <strong>${escapeHtml(document.title)}</strong>
            <small>${document.pageCount || "—"} pages · ${document.chunkCount} chunks</small>
          </span>
          <i class="source-status ${document.status}" title="${document.status}"></i>
        </button>
      `;
    })
    .join("");
  sourceStrip.insertAdjacentHTML(
    "beforeend",
    '<button class="add-source" id="addSourceButton">＋ Add sources</button>',
  );
  sourceStrip.querySelectorAll(".source-chip").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.document;
      if (state.activeDocumentIds.has(id)) state.activeDocumentIds.delete(id);
      else state.activeDocumentIds.add(id);
      renderDocuments();
    });
  });
  $("#addSourceButton").addEventListener("click", openUpload);
  $("#libraryCount").textContent = state.documents.length;
  $("#usageLabel").textContent = `${state.documents.length} / 20`;
  $("#usageBar").style.width = `${Math.min((state.documents.length / 20) * 100, 100)}%`;
  const readyChunks = state.documents.reduce((sum, item) => sum + item.chunkCount, 0);
  $(".index-health > div:last-child > span").innerHTML = `<i></i> ${readyChunks} evidence chunks`;
}

function scheduleDocumentPolling() {
  clearTimeout(state.pollTimer);
  if (state.documents.some((document) => ["queued", "processing"].includes(document.status))) {
    state.pollTimer = setTimeout(() => loadDocuments().catch(console.error), 2500);
  }
}

async function uploadFiles(files) {
  const list = [...files];
  for (const file of list) {
    const row = document.createElement("div");
    row.className = "upload-row";
    row.innerHTML = `
      <span class="file-type">${escapeHtml(file.name.split(".").pop().slice(0, 4).toUpperCase())}</span>
      <div><strong>${escapeHtml(file.name)}</strong><small>${formatBytes(file.size)}</small></div>
      <span class="upload-status">Uploading...</span>
    `;
    $("#uploadList").prepend(row);
    const form = new FormData();
    form.append("file", file);
    try {
      const payload = await api("/api/documents", { method: "POST", body: form });
      state.documents.unshift(payload.document);
      row.querySelector(".upload-status").textContent = "Queued ✓";
      renderDocuments();
      scheduleDocumentPolling();
    } catch (error) {
      row.querySelector(".upload-status").textContent = "Failed";
      row.querySelector(".upload-status").style.color = "var(--coral)";
      showToast(error.message, true);
    }
  }
}

async function loadThreads() {
  const payload = await api("/api/threads");
  state.threads = payload.threads;
  renderThreads();
}

function renderThreads() {
  const section = $(".sidebar-section");
  section.querySelectorAll(".thread-item").forEach((item) => item.remove());
  const html = state.threads.slice(0, 8).map((thread) => `
    <button class="thread-item ${thread.id === state.currentThreadId ? "active" : ""}" data-thread="${thread.id}">
      <span class="thread-dot ${thread.id === state.currentThreadId ? "" : "muted"}"></span>
      <span>
        <strong>${escapeHtml(thread.title)}</strong>
        <small>${thread.messageCount} messages · ${new Date(thread.updatedAt).toLocaleDateString()}</small>
      </span>
    </button>
  `).join("");
  section.insertAdjacentHTML("beforeend", html || `
    <button class="thread-item"><span class="thread-dot muted"></span><span><strong>No threads yet</strong><small>Ask your first question</small></span></button>
  `);
  section.querySelectorAll("[data-thread]").forEach((button) => {
    button.addEventListener("click", () => openThread(button.dataset.thread));
  });
}

async function openThread(threadId) {
  try {
    const payload = await api(`/api/threads/${threadId}`);
    state.currentThreadId = threadId;
    renderThreads();
    const userMessage = [...payload.messages].reverse().find((message) => message.role === "user");
    const assistantMessage = [...payload.messages].reverse().find((message) => message.role === "assistant");
    if (userMessage && assistantMessage) renderAnswer(userMessage.content, assistantMessage);
  } catch (error) {
    showToast(error.message, true);
  }
}

async function askQuestion(event) {
  event.preventDefault();
  const question = questionInput.value.trim();
  if (!question) return;
  const submit = $(".send-button");
  submit.disabled = true;
  submit.textContent = "…";
  try {
    const payload = await api("/api/ask", {
      method: "POST",
      body: JSON.stringify({
        question,
        threadId: state.currentThreadId,
        documentIds: [...state.activeDocumentIds],
      }),
    });
    state.currentThreadId = payload.threadId;
    renderAnswer(question, payload.message);
    questionInput.value = "";
    await loadThreads();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    submit.disabled = false;
    submit.textContent = "↑";
  }
}

function renderAnswer(question, message) {
  emptyState.classList.add("hidden");
  answerView.classList.remove("hidden");
  $("#questionText").textContent = question;
  const answerHtml = escapeHtml(message.content)
    .replace(/\n\n/g, "</p><p>")
    .replace(/\[(\d+)\]/g, '<button class="citation" data-citation="$1">[$1]</button>');
  $("#answerCopy").innerHTML = `<p>${answerHtml}</p>`;
  const verification = message.verification || { supported: false, score: 0, claims: [] };
  $("#answerStatus").textContent = verification.supported
    ? `Verified against ${message.citations.length} evidence passages`
    : "Evidence verification needs review";
  const badge = $("#confidenceBadge");
  badge.textContent = verification.supported ? "Verified" : "Evidence too weak";
  badge.classList.toggle("weak", !verification.supported);
  $("#verificationScore").textContent = `${verification.score}%`;
  $("#verificationBar").style.width = `${verification.score}%`;
  $("#claimList").innerHTML = (verification.claims || [])
    .map((claim) => `<span class="claim-pill">${escapeHtml(claim.text.slice(0, 80))}</span>`)
    .join("");
  $("#retrievedCount").textContent = message.citations.length;
  $("#latencyValue").textContent = message.modelMode === "extractive" ? "Local" : "Model";
  renderEvidence(message.citations);
  document.querySelectorAll(".citation").forEach((button) => {
    button.addEventListener("click", () => focusEvidence(button.dataset.citation));
  });
}

function renderEvidence(citations = []) {
  evidenceList.innerHTML = citations.length
    ? citations.map((citation) => `
      <article class="evidence-card" data-rank="${citation.index}">
        <div class="evidence-card-top">
          <span class="evidence-rank">${citation.index}</span>
          <span class="evidence-source">
            <strong>${escapeHtml(citation.documentTitle)}</strong>
            <small>Page ${citation.pageNumber || "—"} · ${escapeHtml(citation.kind.toUpperCase())}</small>
          </span>
        </div>
        <blockquote>${escapeHtml(citation.snippet)}</blockquote>
        <div class="evidence-meta"><span>${escapeHtml(citation.kind)}</span><span>Hybrid + reranked</span></div>
      </article>
    `).join("")
    : `<div class="evidence-placeholder"><span>!</span><strong>No evidence returned</strong><p>Try broadening your source selection.</p></div>`;
}

function focusEvidence(rank) {
  evidencePanel.classList.add("open");
  document.querySelectorAll(".evidence-card").forEach((card) => {
    card.classList.toggle("highlighted", card.dataset.rank === String(rank));
  });
  document.querySelector(`.evidence-card[data-rank="${rank}"]`)?.scrollIntoView({
    behavior: "smooth",
    block: "center",
  });
}

function newThread() {
  state.currentThreadId = null;
  answerView.classList.add("hidden");
  emptyState.classList.remove("hidden");
  renderThreads();
  questionInput.focus();
}

function openUpload() {
  uploadModal.classList.remove("hidden");
}

function closeUpload() {
  uploadModal.classList.add("hidden");
}

function bindEvents() {
  $("#authForm").addEventListener("submit", submitAuth);
  $("#authSwitch").addEventListener("click", () =>
    setAuthMode(state.authMode === "login" ? "register" : "login"),
  );
  questionForm.addEventListener("submit", askQuestion);
  questionInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      questionForm.requestSubmit();
    }
  });
  questionInput.addEventListener("input", () => {
    questionInput.style.height = "auto";
    questionInput.style.height = `${Math.min(questionInput.scrollHeight, 110)}px`;
  });
  document.querySelectorAll(".suggestion").forEach((button) => {
    button.addEventListener("click", () => {
      questionInput.value = button.lastChild.textContent.trim();
      questionForm.requestSubmit();
    });
  });
  $("#newThreadButton").addEventListener("click", newThread);
  $("#attachButton").addEventListener("click", openUpload);
  $("#closeUpload").addEventListener("click", closeUpload);
  $("#closeEvidence").addEventListener("click", () => evidencePanel.classList.remove("open"));
  $("#whyButton").addEventListener("click", () => focusEvidence(1));
  $("#themeButton").addEventListener("click", () => document.body.classList.toggle("dark"));
  $("#searchButton").addEventListener("click", () => questionInput.focus());
  $("#copyButton").addEventListener("click", async () => {
    await navigator.clipboard.writeText($("#answerCopy").innerText);
    showToast("Answer copied");
  });
  $("#fileInput").addEventListener("change", (event) => uploadFiles(event.target.files));
  uploadModal.addEventListener("click", (event) => {
    if (event.target === uploadModal) closeUpload();
  });
  const dropZone = $("#dropZone");
  ["dragenter", "dragover"].forEach((name) => dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    dropZone.classList.add("dragging");
  }));
  ["dragleave", "drop"].forEach((name) => dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragging");
  }));
  dropZone.addEventListener("drop", (event) => uploadFiles(event.dataTransfer.files));
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      newThread();
    }
    if (event.key === "Escape") {
      closeUpload();
      evidencePanel.classList.remove("open");
    }
  });
}

async function initialize() {
  bindEvents();
  setAuthMode("login");
  try {
    const session = await api("/api/auth/me");
    state.user = session.user;
    updateProfile();
    await Promise.all([loadDocuments(), loadThreads()]);
  } catch {
    showAuth();
  }
}

initialize();
