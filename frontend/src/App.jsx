import { useEffect, useMemo, useState } from "react";

const ISSUE_TYPES = ["Story", "Task", "Bug", "Epic"];

function App() {
  const [rawInput, setRawInput] = useState("");
  const [issueType, setIssueType] = useState("Story");
  const [projectKey, setProjectKey] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [adfDescription, setAdfDescription] = useState(null);
  const [projects, setProjects] = useState([]);
  const [epics, setEpics] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [epicsLoading, setEpicsLoading] = useState(false);
  const [epicMode, setEpicMode] = useState("none");
  const [epicKey, setEpicKey] = useState("");
  const [epicTitle, setEpicTitle] = useState("");
  const [epicDescription, setEpicDescription] = useState("");
  const [images, setImages] = useState([]);
  const [simulateOnly, setSimulateOnly] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const canRefine = useMemo(() => rawInput.trim().length > 0, [rawInput]);
  const canCreate = useMemo(() => {
    return projectKey.trim() && issueType && title.trim() && description.trim();
  }, [projectKey, issueType, title, description]);

  useEffect(() => {
    const loadEpics = async () => {
      if (!projectKey) return;
      try {
        setEpicsLoading(true);
        const response = await fetch(
          `/api/jira/epics?projectKey=${encodeURIComponent(projectKey)}`
        );
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Unable to load Jira epics.");
        }
        setEpics(data.epics || []);
        if ((data.epics || []).length > 0) {
          setEpicKey(data.epics[0].key);
        } else {
          setEpicKey("");
        }
      } catch (err) {
        setError(err.message || "Unable to load Jira epics.");
      } finally {
        setEpicsLoading(false);
      }
    };

    loadEpics();
  }, [projectKey]);

  useEffect(() => {
    const loadProjects = async () => {
      try {
        setProjectsLoading(true);
        const response = await fetch("/api/jira/projects");
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Unable to load Jira projects.");
        }

        setProjects(data.projects || []);
        if (!projectKey && data.projects?.length > 0) {
          setProjectKey(data.projects[0].key);
        }
      } catch (err) {
        setError(err.message || "Unable to load Jira projects.");
      } finally {
        setProjectsLoading(false);
      }
    };

    loadProjects();
  }, []);

  const handleRefine = async () => {
    try {
      setError("");
      setResult(null);
      setIsRefining(true);

      const response = await fetch("/api/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawInput,
          issueType,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Refine failed.");
      }

      setTitle(data.title || "");
      setDescription(data.description || "");
      setAdfDescription(data.adfDescription || null);
    } catch (err) {
      setError(err.message || "Unable to refine text.");
    } finally {
      setIsRefining(false);
    }
  };

  const handleCreateJira = async () => {
    try {
      setError("");
      setResult(null);
      setIsCreating(true);

      const response = await fetch("/api/jira/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectKey: projectKey.trim().toUpperCase(),
          issueType,
          summary: title.trim(),
          description: description.trim(),
          adfDescription,
          simulate: simulateOnly,
          epicMode: issueType === "Epic" ? "none" : epicMode,
          epicKey,
          epicTitle,
          epicDescription,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Jira creation failed.");
      }

      if (!simulateOnly && images.length > 0 && data.issue?.key) {
        const formData = new FormData();
        formData.append("issueKey", data.issue.key);
        images.forEach((file) => formData.append("images", file));

        const attachResponse = await fetch("/api/jira/attach", {
          method: "POST",
          body: formData,
        });
        const attachData = await attachResponse.json();
        if (!attachResponse.ok) {
          throw new Error(attachData.error || "Image upload failed.");
        }

        data.attachments = attachData.attachments || [];
      }

      setResult(data);
    } catch (err) {
      setError(err.message || "Unable to create Jira issue.");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-800">
      <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold">Jira Smart-Composer</h1>
          <p className="mt-2 text-sm text-slate-500">
            Paste rough notes and transform them into production-ready Jira tickets.
          </p>

          <label className="mt-6 block text-sm font-medium">Raw Input</label>
          <textarea
            value={rawInput}
            onChange={(event) => setRawInput(event.target.value)}
            placeholder="Paste meeting notes, bug details, or feature ideas..."
            className="mt-2 h-56 w-full rounded-xl border border-slate-300 p-3 text-sm outline-none transition focus:border-slate-500"
          />

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium">Issue Type</label>
              <select
                value={issueType}
                onChange={(event) => setIssueType(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white p-2.5 text-sm outline-none transition focus:border-slate-500"
              >
                {ISSUE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium">Project Key</label>
              <select
                value={projectKey}
                onChange={(event) => setProjectKey(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white p-2.5 text-sm outline-none transition focus:border-slate-500"
              >
                {!projectsLoading && projects.length === 0 && (
                  <option value="">No Jira projects found</option>
                )}
                {projects.map((project) => (
                  <option key={project.id} value={project.key}>
                    {project.key} - {project.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            type="button"
            onClick={handleRefine}
            disabled={!canRefine || isRefining}
            className="mt-5 w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {isRefining ? "Refining with Gemini..." : "Refine"}
          </button>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold">Preview & Edit</h2>
          <p className="mt-2 text-sm text-slate-500">
            Review generated content before sending to Jira.
          </p>

          <label className="mt-6 block text-sm font-medium">Title</label>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Generated title appears here"
            className="mt-2 w-full rounded-xl border border-slate-300 p-2.5 text-sm outline-none transition focus:border-slate-500"
          />

          <label className="mt-4 block text-sm font-medium">Description</label>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Generated description and acceptance criteria"
            className="mt-2 h-64 w-full rounded-xl border border-slate-300 p-3 text-sm outline-none transition focus:border-slate-500"
          />

          <label className="mt-4 block text-sm font-medium">
            Images (optional)
          </label>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => {
              const files = Array.from(event.target.files || []);
              setImages(files);
            }}
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white p-2.5 text-sm outline-none transition file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm hover:file:bg-slate-200 focus:border-slate-500"
          />
          {images.length > 0 && (
            <p className="mt-2 text-xs text-slate-500">
              {images.length} image(s) selected
            </p>
          )}

          <button
            type="button"
            onClick={handleCreateJira}
            disabled={!canCreate || isCreating}
            className="mt-5 w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
          >
            {isCreating ? "Creating in Jira..." : "Create in Jira"}
          </button>

          {issueType !== "Epic" && (
            <>
              <label className="mt-4 block text-sm font-medium">Epic Handling</label>
              <select
                value={epicMode}
                onChange={(event) => setEpicMode(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white p-2.5 text-sm outline-none transition focus:border-slate-500"
              >
                <option value="none">None</option>
                <option value="existing">Attach to existing Epic</option>
                <option value="new">Create new Epic first</option>
              </select>

              {epicMode === "existing" && (
                <>
                  <label className="mt-3 block text-sm font-medium">
                    Existing Epic
                  </label>
                  <select
                    value={epicKey}
                    onChange={(event) => setEpicKey(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-300 bg-white p-2.5 text-sm outline-none transition focus:border-slate-500"
                  >
                    {!epicsLoading && epics.length === 0 && (
                      <option value="">No epics found</option>
                    )}
                    {epics.map((epic) => (
                      <option key={epic.key} value={epic.key}>
                        {epic.key} - {epic.summary}
                      </option>
                    ))}
                  </select>
                </>
              )}

              {epicMode === "new" && (
                <>
                  <label className="mt-3 block text-sm font-medium">
                    New Epic Title
                  </label>
                  <input
                    value={epicTitle}
                    onChange={(event) => setEpicTitle(event.target.value)}
                    placeholder="Enter epic title"
                    className="mt-2 w-full rounded-xl border border-slate-300 p-2.5 text-sm outline-none transition focus:border-slate-500"
                  />
                  <label className="mt-3 block text-sm font-medium">
                    New Epic Description
                  </label>
                  <textarea
                    value={epicDescription}
                    onChange={(event) => setEpicDescription(event.target.value)}
                    placeholder="Optional epic description"
                    className="mt-2 h-24 w-full rounded-xl border border-slate-300 p-3 text-sm outline-none transition focus:border-slate-500"
                  />
                </>
              )}
            </>
          )}

          <label className="mt-3 flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={simulateOnly}
              onChange={(event) => setSimulateOnly(event.target.checked)}
            />
            Simulate only (validate Jira JSON without API call)
          </label>
          {simulateOnly && images.length > 0 && (
            <p className="mt-2 text-xs text-amber-600">
              Simulate mode is ON, so images will not be uploaded.
            </p>
          )}
        </section>
      </div>

      {(error || result) && (
        <section className="mx-auto mt-6 w-full max-w-6xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {result && (
            <div className="space-y-2 text-sm text-slate-700">
              <p>
                <span className="font-semibold">
                  {result.simulated ? "Simulation:" : "Created:"}
                </span>{" "}
                {result.simulated ? "No Jira issue created" : result.issue?.key}
              </p>
              {result.browseUrl && (
                <a
                  href={result.browseUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 underline"
                >
                  Open in Jira
                </a>
              )}
              {Array.isArray(result.attachments) && result.attachments.length > 0 && (
                <p>
                  <span className="font-semibold">Attachments:</span>{" "}
                  {result.attachments.length}
                </p>
              )}
              <pre className="overflow-x-auto rounded-xl bg-slate-900 p-3 text-xs text-slate-100">
                {JSON.stringify(result.payload, null, 2)}
              </pre>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

export default App;
