// ============================================================
//  Jira Smart Composer – popup.js (v2)
// ============================================================

const $ = (id) => document.getElementById(id);

// ==================== STATE ====================
const state = {
  step: 1,
  screenshotDataUrl: null,
  screenshotMode: "full", // full | crop | none
  pageUrl: "",
  pageTitle: "",
  // Config
  projectKey: "",
  issueType: "Story",
  priority: "Medium",
  assigneeId: "",
  labels: [],
  sprintId: "",
  storyPoints: "",
  epicMode: "none",
  epicKey: "",
  epicTitle: "",
  epicDesc: "",
  // Preview (from AI)
  title: "",
  description: "",
  acceptanceCriteria: [],
  adfDescription: null,
  // Data lists
  projects: [],
  epics: [],
  members: [],
  availableLabels: [],
  sprints: [],
  boards: [],
  // Settings
  backendUrl: "http://localhost:4000",
  defaultIssueType: "Story",
};

// ==================== CROP STATE ====================
let cropImg = null;
let cropStart = null;
let cropEnd = null;

// ==================== HELPERS ====================
function baseUrl() {
  return state.backendUrl.replace(/\/+$/, "");
}

function showToast(msg, type = "info") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  $("toastContainer").appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

async function api(path, opts = {}) {
  const res = await fetch(`${baseUrl()}${path}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ==================== STEP NAVIGATION ====================
function goToStep(n) {
  if (n < 1 || n > 4) return;
  state.step = n;

  document.querySelectorAll(".step-panel").forEach((p) => p.classList.remove("active"));
  $(`step${n}`).classList.add("active");

  // Update indicators
  document.querySelectorAll(".step-item").forEach((el) => {
    const s = parseInt(el.dataset.step);
    el.classList.remove("active", "completed");
    if (s === n) el.classList.add("active");
    else if (s < n) el.classList.add("completed");
  });
  document.querySelectorAll(".step-line").forEach((el) => {
    const after = parseInt(el.dataset.after);
    el.classList.toggle("completed", after < n);
  });

  // Bottom bar
  $("prevBtn").disabled = n === 1;
  if (n === 4) {
    $("nextBtn").classList.add("hidden");
    $("prevBtn").classList.add("hidden");
  } else if (n === 3) {
    $("nextBtn").textContent = "Create in Jira 🚀";
    $("nextBtn").classList.remove("hidden");
    $("prevBtn").classList.remove("hidden");
  } else {
    $("nextBtn").textContent = "Next →";
    $("nextBtn").classList.remove("hidden");
    $("prevBtn").classList.remove("hidden");
  }

  // Auto-actions on step entry
  if (n === 3) refineWithAI();
  if (n === 4) createInJira();
}

// ==================== SCREENSHOT – FULL PAGE ====================
async function captureFullPage() {
  try {
    const response = await chrome.runtime.sendMessage({ action: "captureTab" });
    if (response.error) throw new Error(response.error);
    state.screenshotDataUrl = response.dataUrl;
    showScreenshotPreview();
    showToast("Screenshot captured!", "success");
  } catch (err) {
    showToast(`Capture failed: ${err.message}`, "error");
  }
}

function showScreenshotPreview() {
  if (!state.screenshotDataUrl) return;
  $("screenshotImg").src = state.screenshotDataUrl;
  $("screenshotPreview").classList.remove("hidden");
}

function clearScreenshot() {
  state.screenshotDataUrl = null;
  $("screenshotPreview").classList.add("hidden");
  $("screenshotImg").src = "";
}

// ==================== SCREENSHOT – CROP ====================
async function startCropMode() {
  try {
    const response = await chrome.runtime.sendMessage({ action: "captureTab" });
    if (response.error) throw new Error(response.error);
    openCropModal(response.dataUrl);
  } catch (err) {
    showToast(`Capture failed: ${err.message}`, "error");
  }
}

function openCropModal(dataUrl) {
  cropStart = null;
  cropEnd = null;
  $("cropConfirmBtn").disabled = true;
  $("cropModal").classList.remove("hidden");

  cropImg = new Image();
  cropImg.onload = () => {
    const canvas = $("cropCanvas");
    const maxW = 386;
    const maxH = 340;
    const scale = Math.min(maxW / cropImg.width, maxH / cropImg.height, 1);
    canvas.width = Math.round(cropImg.width * scale);
    canvas.height = Math.round(cropImg.height * scale);
    canvas.getContext("2d").drawImage(cropImg, 0, 0, canvas.width, canvas.height);
  };
  cropImg.src = dataUrl;
}

function setupCropCanvas() {
  const canvas = $("cropCanvas");

  canvas.addEventListener("mousedown", (e) => {
    const r = canvas.getBoundingClientRect();
    cropStart = { x: e.clientX - r.left, y: e.clientY - r.top };
    cropEnd = null;
  });

  canvas.addEventListener("mousemove", (e) => {
    if (!cropStart) return;
    const r = canvas.getBoundingClientRect();
    cropEnd = { x: e.clientX - r.left, y: e.clientY - r.top };
    redrawCrop();
  });

  canvas.addEventListener("mouseup", () => {
    if (cropStart && cropEnd) {
      const w = Math.abs(cropEnd.x - cropStart.x);
      const h = Math.abs(cropEnd.y - cropStart.y);
      $("cropConfirmBtn").disabled = w < 5 || h < 5;
    }
  });
}

function redrawCrop() {
  const canvas = $("cropCanvas");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(cropImg, 0, 0, canvas.width, canvas.height);

  if (!cropStart || !cropEnd) return;

  const x = Math.min(cropStart.x, cropEnd.x);
  const y = Math.min(cropStart.y, cropEnd.y);
  const w = Math.abs(cropEnd.x - cropStart.x);
  const h = Math.abs(cropEnd.y - cropStart.y);

  // Darken outside selection
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Clear & redraw selected region
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(cropImg, 0, 0, canvas.width, canvas.height);
  ctx.restore();

  // Selection border
  ctx.strokeStyle = "#6366F1";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 3]);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
}

function confirmCrop() {
  if (!cropImg || !cropStart || !cropEnd) return;

  const canvas = $("cropCanvas");
  const scaleX = cropImg.width / canvas.width;
  const scaleY = cropImg.height / canvas.height;

  const sx = Math.min(cropStart.x, cropEnd.x) * scaleX;
  const sy = Math.min(cropStart.y, cropEnd.y) * scaleY;
  const sw = Math.abs(cropEnd.x - cropStart.x) * scaleX;
  const sh = Math.abs(cropEnd.y - cropStart.y) * scaleY;

  const tmp = document.createElement("canvas");
  tmp.width = sw;
  tmp.height = sh;
  tmp.getContext("2d").drawImage(cropImg, sx, sy, sw, sh, 0, 0, sw, sh);

  state.screenshotDataUrl = tmp.toDataURL("image/png");
  showScreenshotPreview();
  closeCropModal();
  showToast("Region cropped!", "success");
}

function closeCropModal() {
  $("cropModal").classList.add("hidden");
  cropStart = null;
  cropEnd = null;
}

// ==================== DATA LOADING ====================
async function loadProjects() {
  try {
    const data = await api("/api/jira/projects");
    state.projects = data.projects || [];
    const el = $("projectKey");
    el.innerHTML = "";
    if (state.projects.length === 0) {
      el.innerHTML = '<option value="">No projects found</option>';
      return;
    }
    state.projects.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.key;
      opt.textContent = `${p.key} – ${p.name}`;
      el.appendChild(opt);
    });
    if (!state.projectKey) state.projectKey = state.projects[0].key;
    el.value = state.projectKey;
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function loadEpics() {
  if (!state.projectKey) return;
  try {
    const data = await api(`/api/jira/epics?projectKey=${encodeURIComponent(state.projectKey)}`);
    state.epics = data.epics || [];
    const el = $("epicKey");
    el.innerHTML = "";
    state.epics.forEach((e) => {
      const opt = document.createElement("option");
      opt.value = e.key;
      opt.textContent = `${e.key} – ${e.summary}`;
      el.appendChild(opt);
    });
    if (state.epics.length > 0) state.epicKey = state.epics[0].key;
  } catch { /* ignore */ }
}

async function loadMembers() {
  if (!state.projectKey) return;
  try {
    const data = await api(`/api/jira/members?projectKey=${encodeURIComponent(state.projectKey)}`);
    state.members = data.members || [];
    const el = $("assignee");
    el.innerHTML = '<option value="">Unassigned</option>';
    state.members.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.accountId;
      opt.textContent = m.displayName;
      el.appendChild(opt);
    });
  } catch { /* ignore – endpoint may not exist yet */ }
}

async function loadLabels() {
  try {
    const data = await api("/api/jira/labels");
    state.availableLabels = data.labels || [];
    const el = $("labelsSelect");
    el.innerHTML = '<option value="">+ Add label...</option>';
    state.availableLabels.forEach((l) => {
      const opt = document.createElement("option");
      opt.value = l;
      opt.textContent = l;
      el.appendChild(opt);
    });
  } catch { /* ignore */ }
}

async function loadBoardsAndSprints() {
  if (!state.projectKey) return;
  try {
    const boardData = await api(`/api/jira/boards?projectKey=${encodeURIComponent(state.projectKey)}`);
    state.boards = boardData.boards || [];
    if (state.boards.length === 0) return;

    const sprintData = await api(`/api/jira/sprints?boardId=${state.boards[0].id}`);
    state.sprints = sprintData.sprints || [];
    const el = $("sprint");
    el.innerHTML = '<option value="">Backlog</option>';
    state.sprints.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = `${s.name}${s.state === "active" ? " (active)" : ""}`;
      el.appendChild(opt);
    });
  } catch { /* ignore */ }
}

async function checkHealth() {
  try {
    const data = await api("/api/health");
    const dot = $("connectionDot");
    dot.classList.toggle("connected", data.ok);
    dot.classList.toggle("disconnected", !data.ok);
    dot.title = data.ok ? "Connected" : `Missing: ${data.missingEnv?.join(", ")}`;
  } catch {
    const dot = $("connectionDot");
    dot.classList.add("disconnected");
    dot.classList.remove("connected");
    dot.title = "Backend unreachable";
  }
}

// ==================== LABELS MANAGEMENT ====================
function addLabel(value) {
  if (!value || state.labels.includes(value)) return;
  state.labels.push(value);
  renderLabels();
}

function removeLabel(value) {
  state.labels = state.labels.filter((l) => l !== value);
  renderLabels();
}

function renderLabels() {
  const container = $("selectedLabels");
  container.innerHTML = "";
  state.labels.forEach((l) => {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.innerHTML = `${l} <button class="tag-remove" type="button" data-label="${l}">✕</button>`;
    container.appendChild(tag);
  });
}

// ==================== EPIC CONTROLS ====================
function updateEpicVisibility() {
  const isEpic = state.issueType === "Epic";
  $("epicSection").classList.toggle("hidden", isEpic);
  $("storyPointsGroup").style.display = state.issueType === "Story" ? "" : "none";

  if (isEpic) { state.epicMode = "none"; return; }

  $("existingEpicWrap").classList.toggle("hidden", state.epicMode !== "existing");
  $("newEpicWrap").classList.toggle("hidden", state.epicMode !== "new");
}

// ==================== AI REFINE ====================
async function refineWithAI() {
  $("refiningState").classList.remove("hidden");
  $("previewContent").classList.add("hidden");

  try {
    const rawInput = $("rawInput").value.trim();
    if (!rawInput) throw new Error("Please add notes first.");

    const useAI = $("useGenAICheckbox").checked;

    if (useAI) {
      const data = await api("/api/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawInput, issueType: state.issueType }),
      });

      state.title = data.title || "";
      state.description = data.description || "";
      state.acceptanceCriteria = data.acceptanceCriteria || [];
      state.adfDescription = data.adfDescription || null;
    } else {
      // Manual skip AI mode
      state.title = "";
      state.description = rawInput;
      state.acceptanceCriteria = [];
      state.adfDescription = null;
    }

    // Populate preview
    $("previewTitle").value = state.title;
    $("previewDescription").value = state.description;

    const list = $("criteriaList");
    list.innerHTML = "";
    state.acceptanceCriteria.forEach((c) => {
      const div = document.createElement("div");
      div.className = "criteria-item";
      div.innerHTML = `<span class="criteria-bullet"></span><span>${c}</span>`;
      list.appendChild(div);
    });

    // Screenshot preview
    if (state.screenshotDataUrl) {
      $("previewScreenshotImg").src = state.screenshotDataUrl;
      $("previewScreenshot").classList.remove("hidden");
    } else {
      $("previewScreenshot").classList.add("hidden");
    }

    $("refiningState").classList.add("hidden");
    $("previewContent").classList.remove("hidden");
  } catch (err) {
    showToast(err.message, "error");
    goToStep(1);
  }
}

// ==================== CREATE IN JIRA ====================
async function createInJira() {
  $("creatingState").classList.remove("hidden");
  $("successState").classList.add("hidden");

  try {
    // Sync editable fields from preview
    const finalTitle = $("previewTitle").value.trim() || state.title;
    const finalDesc = $("previewDescription").value.trim() || state.description;

    const formData = new FormData();
    formData.append("rawInput", $("rawInput").value.trim());
    formData.append("issueType", state.issueType);
    formData.append("projectKey", state.projectKey);
    formData.append("epicMode", state.epicMode);
    formData.append("epicKey", state.epicKey || "");
    formData.append("epicTitle", state.epicTitle || "");
    formData.append("epicDescription", state.epicDesc || "");
    formData.append("title", finalTitle);
    formData.append("description", finalDesc);
    formData.append("priority", state.priority);
    formData.append("assigneeId", state.assigneeId);
    formData.append("labels", JSON.stringify(state.labels));
    formData.append("sprintId", state.sprintId);
    formData.append("storyPoints", state.storyPoints);
    formData.append("skipAI", !$("useGenAICheckbox").checked);

    if (state.screenshotDataUrl) {
      const blob = await fetch(state.screenshotDataUrl).then((r) => r.blob());
      formData.append("screenshot", blob, "screenshot.png");
    }

    const res = await fetch(`${baseUrl()}/api/jira/quick-create`, {
      method: "POST",
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Creation failed");

    // Success
    $("creatingState").classList.add("hidden");
    $("successState").classList.remove("hidden");
    $("createdKey").textContent = data.issue?.key || "Done";
    $("openInJiraBtn").href = data.browseUrl || "#";
    showToast(`${data.issue?.key} created!`, "success");

    // Save to recent
    saveRecent({ key: data.issue?.key, url: data.browseUrl, title: finalTitle, time: Date.now() });
  } catch (err) {
    showToast(err.message, "error");
    $("creatingState").classList.add("hidden");
    goToStep(3);
  }
}

// ==================== SETTINGS ====================
async function loadSettings() {
  const saved = await chrome.storage.sync.get(["backendUrl", "defaultIssueType"]);
  if (saved.backendUrl) state.backendUrl = saved.backendUrl;
  if (saved.defaultIssueType) state.defaultIssueType = saved.defaultIssueType;
  $("backendUrl").value = state.backendUrl;
  $("defaultIssueType").value = state.defaultIssueType;
  $("issueType").value = state.defaultIssueType;
  state.issueType = state.defaultIssueType;
}

async function saveSettings() {
  state.backendUrl = $("backendUrl").value.replace(/\/+$/, "");
  state.defaultIssueType = $("defaultIssueType").value;
  await chrome.storage.sync.set({
    backendUrl: state.backendUrl,
    defaultIssueType: state.defaultIssueType,
  });
  $("settingsPanel").classList.add("hidden");
  showToast("Settings saved", "success");
  checkHealth();
  loadProjects();
}

// ==================== RECENT TICKETS ====================
async function saveRecent(ticket) {
  const saved = await chrome.storage.local.get(["recentTickets"]);
  const recent = saved.recentTickets || [];
  recent.unshift(ticket);
  if (recent.length > 10) recent.pop();
  await chrome.storage.local.set({ recentTickets: recent });
}

// ==================== PAGE CONTEXT ====================
async function capturePageContext() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.pageUrl = tab?.url || "";
    state.pageTitle = tab?.title || "";
    $("pageUrl").textContent = state.pageUrl || "No page detected";
    $("pageUrl").title = state.pageUrl;
  } catch {
    $("pageUrl").textContent = "Unable to detect page";
  }
}

// ==================== BIND EVENTS ====================
function bindEvents() {
  // Navigation
  $("nextBtn").addEventListener("click", () => {
    if (state.step === 3) { goToStep(4); return; }
    if (state.step < 4) goToStep(state.step + 1);
  });
  $("prevBtn").addEventListener("click", () => {
    if (state.step > 1) goToStep(state.step - 1);
  });

  // Screenshot modes
  $("captureFullBtn").addEventListener("click", () => {
    setActiveMode("captureFullBtn");
    state.screenshotMode = "full";
    captureFullPage();
  });
  $("captureCropBtn").addEventListener("click", () => {
    setActiveMode("captureCropBtn");
    state.screenshotMode = "crop";
    startCropMode();
  });
  $("captureNoneBtn").addEventListener("click", () => {
    setActiveMode("captureNoneBtn");
    state.screenshotMode = "none";
    clearScreenshot();
  });
  $("recaptureBtn").addEventListener("click", () => {
    if (state.screenshotMode === "crop") startCropMode();
    else captureFullPage();
  });
  $("removeScreenshotBtn").addEventListener("click", clearScreenshot);

  // Crop modal
  setupCropCanvas();
  $("cropConfirmBtn").addEventListener("click", confirmCrop);
  $("cropCancelBtn").addEventListener("click", closeCropModal);

  // Config fields
  $("projectKey").addEventListener("change", (e) => {
    state.projectKey = e.target.value;
    loadEpics();
    loadMembers();
    loadBoardsAndSprints();
  });
  $("issueType").addEventListener("change", (e) => {
    state.issueType = e.target.value;
    updateEpicVisibility();
  });
  $("priority").addEventListener("change", (e) => { state.priority = e.target.value; });
  $("assignee").addEventListener("change", (e) => { state.assigneeId = e.target.value; });
  $("sprint").addEventListener("change", (e) => { state.sprintId = e.target.value; });
  $("storyPoints").addEventListener("change", (e) => { state.storyPoints = e.target.value; });
  $("epicMode").addEventListener("change", (e) => {
    state.epicMode = e.target.value;
    updateEpicVisibility();
  });
  $("epicKey").addEventListener("change", (e) => { state.epicKey = e.target.value; });
  $("epicTitle").addEventListener("input", (e) => { state.epicTitle = e.target.value; });
  $("epicDescription").addEventListener("input", (e) => { state.epicDesc = e.target.value; });

  // Labels
  $("labelsSelect").addEventListener("change", (e) => {
    addLabel(e.target.value);
    e.target.value = "";
  });
  $("selectedLabels").addEventListener("click", (e) => {
    if (e.target.classList.contains("tag-remove")) {
      removeLabel(e.target.dataset.label);
    }
  });

  // Settings
  $("settingsBtn").addEventListener("click", () => $("settingsPanel").classList.remove("hidden"));
  $("closeSettingsBtn").addEventListener("click", () => $("settingsPanel").classList.add("hidden"));
  $("saveSettingsBtn").addEventListener("click", saveSettings);

  // Create another
  $("createAnotherBtn").addEventListener("click", () => {
    state.screenshotDataUrl = null;
    state.title = "";
    state.description = "";
    state.acceptanceCriteria = [];
    $("rawInput").value = "";
    clearScreenshot();
    goToStep(1);
  });
}

function setActiveMode(activeId) {
  ["captureFullBtn", "captureCropBtn", "captureNoneBtn"].forEach((id) => {
    $(id).classList.toggle("active", id === activeId);
  });
}

// ==================== INIT ====================
async function init() {
  await loadSettings();
  bindEvents();
  capturePageContext();
  checkHealth();
  updateEpicVisibility();

  // Load Jira data
  await loadProjects();
  loadEpics();
  loadMembers();
  loadLabels();
  loadBoardsAndSprints();
}

init();
