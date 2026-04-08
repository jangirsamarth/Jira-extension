const backendUrlEl = document.getElementById("backendUrl");
const projectKeyEl = document.getElementById("projectKey");
const issueTypeEl = document.getElementById("issueType");
const epicModeEl = document.getElementById("epicMode");
const epicKeyEl = document.getElementById("epicKey");
const epicTitleEl = document.getElementById("epicTitle");
const epicDescriptionEl = document.getElementById("epicDescription");
const rawInputEl = document.getElementById("rawInput");
const captureBtn = document.getElementById("captureBtn");
const createBtn = document.getElementById("createBtn");
const shotStatusEl = document.getElementById("shotStatus");
const statusEl = document.getElementById("status");
const existingEpicWrap = document.getElementById("existingEpicWrap");
const newEpicWrap = document.getElementById("newEpicWrap");

let screenshotBlob = null;

function status(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#dc2626" : "#0f172a";
}

function normalizeBaseUrl() {
  return backendUrlEl.value.replace(/\/+$/, "");
}

async function loadProjects() {
  const res = await fetch(`${normalizeBaseUrl()}/api/jira/projects`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Could not load Jira projects.");

  projectKeyEl.innerHTML = "";
  for (const project of data.projects || []) {
    const option = document.createElement("option");
    option.value = project.key;
    option.textContent = `${project.key} - ${project.name}`;
    projectKeyEl.appendChild(option);
  }
}

async function loadEpics() {
  const projectKey = projectKeyEl.value;
  if (!projectKey) return;

  const res = await fetch(
    `${normalizeBaseUrl()}/api/jira/epics?projectKey=${encodeURIComponent(projectKey)}`
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Could not load epics.");

  epicKeyEl.innerHTML = "";
  for (const epic of data.epics || []) {
    const option = document.createElement("option");
    option.value = epic.key;
    option.textContent = `${epic.key} - ${epic.summary}`;
    epicKeyEl.appendChild(option);
  }
}

function updateEpicControls() {
  const isEpicType = issueTypeEl.value === "Epic";
  if (isEpicType) {
    epicModeEl.value = "none";
    epicModeEl.disabled = true;
    existingEpicWrap.classList.add("hidden");
    newEpicWrap.classList.add("hidden");
    return;
  }

  epicModeEl.disabled = false;
  const mode = epicModeEl.value;
  existingEpicWrap.classList.toggle("hidden", mode !== "existing");
  newEpicWrap.classList.toggle("hidden", mode !== "new");
}

captureBtn.addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    const response = await fetch(dataUrl);
    screenshotBlob = await response.blob();
    shotStatusEl.textContent = "Screenshot captured";
    status("Screenshot ready.");
  } catch (error) {
    status(`Capture failed: ${error.message}`, true);
  }
});

createBtn.addEventListener("click", async () => {
  try {
    const rawInput = rawInputEl.value.trim();
    if (!rawInput) {
      throw new Error("Please enter raw description.");
    }

    const formData = new FormData();
    formData.append("rawInput", rawInput);
    formData.append("issueType", issueTypeEl.value);
    formData.append("projectKey", projectKeyEl.value);
    formData.append("epicMode", epicModeEl.value);
    formData.append("epicKey", epicKeyEl.value || "");
    formData.append("epicTitle", epicTitleEl.value || "");
    formData.append("epicDescription", epicDescriptionEl.value || "");
    if (screenshotBlob) {
      formData.append("screenshot", screenshotBlob, "captured-screenshot.png");
    }

    status("Creating Jira issue...");
    const res = await fetch(`${normalizeBaseUrl()}/api/jira/quick-create`, {
      method: "POST",
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Creation failed.");
    }

    status(`Created ${data.issue.key}.`);
    if (data.browseUrl) {
      chrome.tabs.create({ url: data.browseUrl });
    }
  } catch (error) {
    status(error.message, true);
  }
});

issueTypeEl.addEventListener("change", updateEpicControls);
epicModeEl.addEventListener("change", updateEpicControls);
projectKeyEl.addEventListener("change", async () => {
  try {
    await loadEpics();
  } catch (error) {
    status(error.message, true);
  }
});

(async function init() {
  try {
    await loadProjects();
    await loadEpics();
    updateEpicControls();
    status("Ready.");
  } catch (error) {
    status(error.message, true);
  }
})();
