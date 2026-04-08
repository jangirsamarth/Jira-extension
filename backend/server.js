import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import { GoogleGenAI } from "@google/genai";
import multer from "multer";
import FormData from "form-data";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({
  path: [path.resolve(__dirname, ".env"), path.resolve(__dirname, "../.env")],
});

const app = express();
const PORT = process.env.PORT || 4000;

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));
const upload = multer({ storage: multer.memoryStorage() });

function missingEnvVars(requiredKeys) {
  return requiredKeys.filter((key) => !process.env[key]);
}

function jiraBaseUrl() {
  const domain = process.env.JIRA_DOMAIN || "";
  const normalized = domain.startsWith("http") ? domain : `https://${domain}`;
  return normalized.replace(/\/+$/, "");
}

function jiraAuthHeaders() {
  const auth = Buffer.from(
    `${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`
  ).toString("base64");
  return {
    Authorization: `Basic ${auth}`,
    Accept: "application/json",
  };
}

function ensureJiraEnvOrThrow() {
  const missing = missingEnvVars(["JIRA_DOMAIN", "JIRA_EMAIL", "JIRA_API_TOKEN"]);
  if (missing.length > 0) {
    const error = new Error(`Missing env vars: ${missing.join(", ")}`);
    error.status = 400;
    throw error;
  }
}

async function createJiraIssue(payload) {
  const response = await axios.post(`${jiraBaseUrl()}/rest/api/3/issue`, payload, {
    headers: {
      ...jiraAuthHeaders(),
      "Content-Type": "application/json",
    },
  });
  return response.data;
}

async function attachFilesToIssue(issueKey, files) {
  if (!files || files.length === 0) return [];

  const formData = new FormData();
  for (const file of files) {
    formData.append("file", file.buffer, {
      filename: file.originalname,
      contentType: file.mimetype || "application/octet-stream",
    });
  }

  const response = await axios.post(
    `${jiraBaseUrl()}/rest/api/3/issue/${issueKey}/attachments`,
    formData,
    {
      headers: {
        ...jiraAuthHeaders(),
        "X-Atlassian-Token": "no-check",
        ...formData.getHeaders(),
      },
    }
  );
  return response.data;
}

function buildIssuePayload({
  projectKey,
  issueType,
  summary,
  description,
  adfDescription,
  parentEpicKey,
  priority,
  assigneeId,
  labels,
}) {
  const payload = {
    fields: {
      project: { key: projectKey },
      summary,
      issuetype: { name: issueType },
      description: adfDescription || markdownToAdf(description),
    },
  };

  if (parentEpicKey && issueType !== "Epic") {
    payload.fields.parent = { key: parentEpicKey };
  }
  if (priority) {
    payload.fields.priority = { name: priority };
  }
  if (assigneeId) {
    payload.fields.assignee = { accountId: assigneeId };
  }
  if (labels && labels.length > 0) {
    payload.fields.labels = labels;
  }

  return payload;
}

function markdownToAdf(markdown) {
  const lines = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return {
      version: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "No description provided." }],
        },
      ],
    };
  }

  const content = lines.map((line) => ({
    type: "paragraph",
    content: [{ type: "text", text: line }],
  }));

  return { version: 1, type: "doc", content };
}

async function generateTicket(rawInput, issueType) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY");
  }

  const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const systemPrompt = `
You are a senior Product Manager writing Jira tickets.
Return strict JSON with keys: title, description, acceptanceCriteria.
Rules:
- title: concise and specific, max 90 characters.
- description: professional and complete.
- For Story: include "As a ... I want ... so that ...".
- For Bug: include actual/expected behavior and impact.
- For Epic: include objective, scope, and outcomes.
- acceptanceCriteria: array of 3-7 short bullet strings, measurable and testable.
- Do not include markdown code fences or extra keys.
`.trim();

  const prompt = `
Issue type: ${issueType}
Raw notes:
${rawInput}
`.trim();

  const response = await genAI.models.generateContent({
    model: "gemini-2.5-flash",
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: "application/json",
    },
    contents: prompt,
  });

  const text = response.text?.trim();
  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Gemini response was not valid JSON.");
  }

  const acceptanceCriteria = Array.isArray(parsed.acceptanceCriteria)
    ? parsed.acceptanceCriteria.filter((item) => typeof item === "string" && item.trim())
    : [];

  return {
    title: String(parsed.title || "").trim(),
    description: String(parsed.description || "").trim(),
    acceptanceCriteria,
  };
}

app.get("/api/health", (_req, res) => {
  const missing = missingEnvVars([
    "JIRA_DOMAIN",
    "JIRA_EMAIL",
    "JIRA_API_TOKEN",
    "GEMINI_API_KEY",
  ]);
  res.json({
    ok: missing.length === 0,
    missingEnv: missing,
  });
});

app.post("/api/refine", async (req, res) => {
  try {
    const missing = missingEnvVars(["GEMINI_API_KEY"]);
    if (missing.length > 0) {
      return res.status(400).json({
        error: `Missing env vars: ${missing.join(", ")}`,
      });
    }

    const { rawInput, issueType } = req.body || {};
    if (!rawInput || !issueType) {
      return res
        .status(400)
        .json({ error: "rawInput and issueType are required." });
    }

    const refined = await generateTicket(rawInput, issueType);
    const criteriaText = refined.acceptanceCriteria
      .map((item) => `- ${item}`)
      .join("\n");
    const combinedDescription = `${refined.description}\n\nAcceptance Criteria:\n${criteriaText}`;

    return res.json({
      title: refined.title,
      description: combinedDescription.trim(),
      acceptanceCriteria: refined.acceptanceCriteria,
      adfDescription: markdownToAdf(combinedDescription),
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to refine input with Gemini.",
    });
  }
});

app.post("/api/jira/create", async (req, res) => {
  try {
    const {
      projectKey,
      issueType,
      summary,
      description,
      adfDescription,
      simulate,
      epicMode,
      epicKey,
      epicTitle,
      epicDescription,
    } = req.body || {};
    if (!projectKey || !issueType || !summary || !description) {
      return res.status(400).json({
        error: "projectKey, issueType, summary, and description are required.",
      });
    }

    let parentEpicKey = "";
    let createdEpic = null;
    if (issueType !== "Epic") {
      if (epicMode === "existing" && epicKey) {
        parentEpicKey = String(epicKey).trim();
      }
      if (epicMode === "new" && epicTitle) {
        const epicPayload = buildIssuePayload({
          projectKey,
          issueType: "Epic",
          summary: String(epicTitle).trim(),
          description: String(epicDescription || epicTitle).trim(),
        });
        if (!simulate) {
          ensureJiraEnvOrThrow();
          const epicIssue = await createJiraIssue(epicPayload);
          createdEpic = epicIssue;
          parentEpicKey = epicIssue.key;
        } else {
          parentEpicKey = "SIM-EPIC";
        }
      }
    }

    const payload = buildIssuePayload({
      projectKey,
      issueType,
      summary,
      description,
      adfDescription,
      parentEpicKey,
    });

    if (simulate) {
      return res.json({
        created: false,
        simulated: true,
        payload,
        createdEpic,
        note: "Simulation mode enabled. Jira API was not called.",
      });
    }

    ensureJiraEnvOrThrow();
    const response = await createJiraIssue(payload);

    return res.json({
      created: true,
      issue: response,
      createdEpic,
      payload,
      browseUrl: `${jiraBaseUrl()}/browse/${response?.key || ""}`,
    });
  } catch (error) {
    const jiraErrors = error.response?.data?.errors || {};
    if (jiraErrors.project) {
      return res.status(400).json({
        created: false,
        error:
          "Invalid project key. Use a valid Jira project key you can access (for your account it appears to be ACN).",
      });
    }

    const details =
      error.response?.data?.errorMessages?.join(", ") ||
      jiraErrors ||
      error.message;
    return res.status(500).json({
      created: false,
      error: `Failed to create Jira issue: ${JSON.stringify(details)}`,
    });
  }
});

app.post("/api/jira/attach", upload.array("images", 10), async (req, res) => {
  try {
    ensureJiraEnvOrThrow();

    const issueKey = String(req.body?.issueKey || "").trim();
    if (!issueKey) {
      return res.status(400).json({ error: "issueKey is required." });
    }

    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ error: "At least one image is required." });
    }

    const response = await attachFilesToIssue(issueKey, files);

    return res.json({
      attached: true,
      issueKey,
      attachments: response,
    });
  } catch (error) {
    const details =
      error.response?.data?.errorMessages?.join(", ") ||
      error.response?.data?.errors ||
      error.message;
    return res.status(500).json({
      attached: false,
      error: `Failed to attach image(s): ${JSON.stringify(details)}`,
    });
  }
});

app.get("/api/jira/projects", async (_req, res) => {
  try {
    ensureJiraEnvOrThrow();

    const response = await axios.get(
      `${jiraBaseUrl()}/rest/api/3/project/search?maxResults=50`,
      {
        headers: jiraAuthHeaders(),
      }
    );

    const projects = (response.data?.values || []).map((project) => ({
      id: project.id,
      key: project.key,
      name: project.name,
    }));
    return res.json({ projects });
  } catch (error) {
    const details =
      error.response?.data?.errorMessages?.join(", ") ||
      error.response?.data?.errors ||
      error.message;
    return res.status(500).json({
      error: `Failed to load Jira projects: ${JSON.stringify(details)}`,
    });
  }
});

app.get("/api/jira/epics", async (req, res) => {
  try {
    ensureJiraEnvOrThrow();
    const projectKey = String(req.query.projectKey || "").trim();
    if (!projectKey) {
      return res.status(400).json({ error: "projectKey query param is required." });
    }

    const jql = encodeURIComponent(
      `project = ${projectKey} AND issuetype = Epic ORDER BY updated DESC`
    );
    const response = await axios.get(
      `${jiraBaseUrl()}/rest/api/3/search/jql?jql=${jql}&maxResults=50&fields=summary`,
      {
        headers: jiraAuthHeaders(),
      }
    );

    const epics = (response.data?.issues || []).map((issue) => ({
      key: issue.key,
      summary: issue.fields?.summary || issue.key,
    }));
    return res.json({ epics });
  } catch (error) {
    const details =
      error.response?.data?.errorMessages?.join(", ") ||
      error.response?.data?.errors ||
      error.message;
    return res.status(500).json({
      error: `Failed to load Jira epics: ${JSON.stringify(details)}`,
    });
  }
});

// =================== NEW ENDPOINTS ===================

app.get("/api/jira/members", async (req, res) => {
  try {
    ensureJiraEnvOrThrow();
    const projectKey = String(req.query.projectKey || "").trim();
    if (!projectKey) return res.status(400).json({ error: "projectKey is required." });

    const response = await axios.get(
      `${jiraBaseUrl()}/rest/api/3/user/assignable/search?project=${encodeURIComponent(projectKey)}&maxResults=50`,
      { headers: jiraAuthHeaders() }
    );
    const members = (response.data || []).map((u) => ({
      accountId: u.accountId,
      displayName: u.displayName,
      avatarUrl: u.avatarUrls?.["24x24"] || "",
    }));
    return res.json({ members });
  } catch (error) {
    const details = error.response?.data?.errorMessages?.join(", ") || error.message;
    return res.status(500).json({ error: `Failed to load members: ${details}` });
  }
});

app.get("/api/jira/labels", async (_req, res) => {
  try {
    ensureJiraEnvOrThrow();
    const response = await axios.get(
      `${jiraBaseUrl()}/rest/api/3/label?maxResults=200`,
      { headers: jiraAuthHeaders() }
    );
    return res.json({ labels: response.data?.values || [] });
  } catch (error) {
    const details = error.response?.data?.errorMessages?.join(", ") || error.message;
    return res.status(500).json({ error: `Failed to load labels: ${details}` });
  }
});

app.get("/api/jira/boards", async (req, res) => {
  try {
    ensureJiraEnvOrThrow();
    const projectKey = String(req.query.projectKey || "").trim();
    if (!projectKey) return res.status(400).json({ error: "projectKey is required." });

    const response = await axios.get(
      `${jiraBaseUrl()}/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(projectKey)}&maxResults=10`,
      { headers: jiraAuthHeaders() }
    );
    const boards = (response.data?.values || []).map((b) => ({
      id: b.id,
      name: b.name,
      type: b.type,
    }));
    return res.json({ boards });
  } catch (error) {
    const details = error.response?.data?.errorMessages?.join(", ") || error.message;
    return res.status(500).json({ error: `Failed to load boards: ${details}` });
  }
});

app.get("/api/jira/sprints", async (req, res) => {
  try {
    ensureJiraEnvOrThrow();
    const boardId = String(req.query.boardId || "").trim();
    if (!boardId) return res.status(400).json({ error: "boardId is required." });

    const response = await axios.get(
      `${jiraBaseUrl()}/rest/agile/1.0/board/${boardId}/sprint?state=active,future&maxResults=20`,
      { headers: jiraAuthHeaders() }
    );
    const sprints = (response.data?.values || []).map((s) => ({
      id: s.id,
      name: s.name,
      state: s.state,
    }));
    return res.json({ sprints });
  } catch (error) {
    const details = error.response?.data?.errorMessages?.join(", ") || error.message;
    return res.status(500).json({ error: `Failed to load sprints: ${details}` });
  }
});

app.post("/api/jira/quick-create", upload.single("screenshot"), async (req, res) => {
  try {
    ensureJiraEnvOrThrow();
    const {
      rawInput,
      issueType,
      projectKey,
      epicMode,
      epicKey,
      epicTitle,
      epicDescription,
      title: overrideTitle,
      description: overrideDesc,
      priority,
      assigneeId,
      labels: labelsJson,
      sprintId,
      skipAI,
    } = req.body || {};

    if (!rawInput || !issueType || !projectKey) {
      return res.status(400).json({
        error: "rawInput, issueType, and projectKey are required.",
      });
    }

    const isSkipAI = String(skipAI) === "true";
    let finalTitle = overrideTitle;
    let finalDescription = overrideDesc;

    // Only call AI if we didn't explicitly skip AI and we lack title/description
    if (!isSkipAI && (!finalTitle || !finalDescription)) {
      const refined = await generateTicket(rawInput, issueType);
      const criteriaText = refined.acceptanceCriteria.map((item) => `- ${item}`).join("\n");
      finalTitle = finalTitle || refined.title;
      finalDescription = finalDescription || `${refined.description}\n\nAcceptance Criteria:\n${criteriaText}`;
    }

    // Fallback if AI was skipped but title/description are missing
    if (isSkipAI) {
      finalTitle = finalTitle || (rawInput ? rawInput.substring(0, 50) + "..." : "New Ticket");
      finalDescription = finalDescription || rawInput || "No description provided.";
    }

    let parsedLabels = [];
    try { parsedLabels = JSON.parse(labelsJson || "[]"); } catch { /* ignore */ }

    let parentEpicKey = "";
    let createdEpic = null;
    if (issueType !== "Epic") {
      if (epicMode === "existing" && epicKey) {
        parentEpicKey = String(epicKey).trim();
      }
      if (epicMode === "new" && epicTitle) {
        const epicPayload = buildIssuePayload({
          projectKey,
          issueType: "Epic",
          summary: String(epicTitle).trim(),
          description: String(epicDescription || epicTitle).trim(),
        });
        createdEpic = await createJiraIssue(epicPayload);
        parentEpicKey = createdEpic.key;
      }
    }

    const payload = buildIssuePayload({
      projectKey,
      issueType,
      summary: finalTitle,
      description: finalDescription,
      adfDescription: markdownToAdf(finalDescription),
      parentEpicKey,
      priority: priority || undefined,
      assigneeId: assigneeId || undefined,
      labels: parsedLabels.length > 0 ? parsedLabels : undefined,
    });

    const issue = await createJiraIssue(payload);

    // Move to sprint if requested
    if (sprintId) {
      try {
        await axios.post(
          `${jiraBaseUrl()}/rest/agile/1.0/sprint/${sprintId}/issue`,
          { issues: [issue.key] },
          { headers: { ...jiraAuthHeaders(), "Content-Type": "application/json" } }
        );
      } catch { /* sprint assignment is best-effort */ }
    }

    const attachments = req.file ? await attachFilesToIssue(issue.key, [req.file]) : [];

    return res.json({
      created: true,
      issue,
      createdEpic,
      attachments,
      browseUrl: `${jiraBaseUrl()}/browse/${issue.key}`,
    });
  } catch (error) {
    const details =
      error.response?.data?.errorMessages?.join(", ") ||
      error.response?.data?.errors ||
      error.message;
    return res.status(500).json({
      created: false,
      error: `Quick create failed: ${JSON.stringify(details)}`,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
