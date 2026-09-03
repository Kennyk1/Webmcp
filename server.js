const express = require("express");
const path = require("path");
const crypto = require("crypto");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const COMPLETION_SIGNALS = [
  "deployed",
  "shipped",
  "merged and closed",
  "closed",
  "confirmed receipt",
  "signed off",
  "all subtasks checked",
  "live in production"
];

function daysFromNow(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function timestamp(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

let tasks = [
  {
    id: "t1",
    title: "Ship pricing page redesign",
    status: "doing",
    tag: "design",
    dueDate: daysFromNow(-4),
    activityLog: [
      { timestamp: timestamp(6), note: "Started implementation" },
      { timestamp: timestamp(1), note: "Deployed to production" }
    ]
  },
  {
    id: "t2",
    title: "Fix checkout race condition",
    status: "doing",
    tag: "engineering",
    dueDate: daysFromNow(-2),
    activityLog: [
      { timestamp: timestamp(3), note: "Reproduced locally" },
      { timestamp: timestamp(1), note: "PR merged and closed" }
    ]
  },
  {
    id: "t3",
    title: "Send Q3 board update",
    status: "todo",
    tag: "ops",
    dueDate: daysFromNow(-1),
    activityLog: [
      { timestamp: timestamp(2), note: "Draft written" }
    ]
  },
  {
    id: "t4",
    title: "Renew SOC2 vendor questionnaire",
    status: "todo",
    tag: "compliance",
    dueDate: daysFromNow(-6),
    activityLog: []
  },
  {
    id: "t5",
    title: "Client onboarding walkthrough",
    status: "doing",
    tag: "success",
    dueDate: daysFromNow(-3),
    activityLog: [
      { timestamp: timestamp(2), note: "Scheduled call" },
      { timestamp: timestamp(1), note: "Client confirmed receipt of materials" }
    ]
  },
  {
    id: "t6",
    title: "Rotate API signing keys",
    status: "todo",
    tag: "security",
    dueDate: daysFromNow(-5),
    activityLog: []
  },
  {
    id: "t7",
    title: "Migrate analytics pipeline",
    status: "doing",
    tag: "engineering",
    dueDate: daysFromNow(-1),
    activityLog: [
      { timestamp: timestamp(4), note: "Schema mapped" },
      { timestamp: timestamp(3), note: "Backfill running" }
    ]
  },
  {
    id: "t8",
    title: "Write Q4 hiring plan",
    status: "todo",
    tag: "ops",
    dueDate: daysFromNow(3),
    activityLog: []
  }
];

const ALLOWED_PRIMITIVES = ["get_overdue_tasks", "search_tasks"];
const ALLOWED_FILTER_OPS = ["equals", "includes"];

let toolProposals = [];

function isValidSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0 || steps.length > 4) return false;
  return steps.every((step) => {
    if (step.type === "call") {
      if (!ALLOWED_PRIMITIVES.includes(step.action)) return false;
      if (step.params && typeof step.params !== "object") return false;
      return true;
    }
    if (step.type === "filter") {
      return (
        typeof step.field === "string" &&
        ALLOWED_FILTER_OPS.includes(step.op) &&
        (typeof step.value === "string" || typeof step.value === "number")
      );
    }
    return false;
  });
}

let projectFiles = {};

function isOverdue(task) {
  return task.status !== "done" && task.dueDate < daysFromNow(0);
}

function findCompletionSignal(task) {
  for (const entry of task.activityLog) {
    const note = entry.note.toLowerCase();
    const hit = COMPLETION_SIGNALS.find((signal) => note.includes(signal));
    if (hit) return entry.note;
  }
  return null;
}

app.get("/api/tasks", (req, res) => {
  res.json(tasks);
});

app.post("/api/tasks", (req, res) => {
  const { title, tag, dueDate } = req.body || {};
  if (!title) return res.status(400).json({ error: "title is required" });
  const task = {
    id: crypto.randomUUID(),
    title,
    status: "todo",
    tag: tag || "general",
    dueDate: dueDate || daysFromNow(7),
    activityLog: []
  };
  tasks.unshift(task);
  res.status(201).json(task);
});

app.get("/api/tasks/overdue", (req, res) => {
  res.json(tasks.filter(isOverdue));
});

app.get("/api/tasks/:id/activity", (req, res) => {
  const task = tasks.find((t) => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: "task not found" });
  res.json(task.activityLog);
});

app.get("/api/tasks/summary", (req, res) => {
  const summary = { todo: 0, doing: 0, done: 0, overdue: 0 };
  tasks.forEach((task) => {
    summary[task.status] += 1;
    if (isOverdue(task)) summary.overdue += 1;
  });
  res.json(summary);
});

app.post("/api/tasks/suggest-completions", (req, res) => {
  const overdue = tasks.filter(isOverdue);
  const candidates = overdue
    .map((task) => {
      const signal = findCompletionSignal(task);
      return signal ? { id: task.id, title: task.title, reason: signal } : null;
    })
    .filter(Boolean);
  res.json({ overdueCount: overdue.length, candidates });
});

app.patch("/api/tasks/:id", (req, res) => {
  const task = tasks.find((t) => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: "task not found" });
  const { status, note } = req.body || {};
  if (status) task.status = status;
  if (note) task.activityLog.push({ timestamp: new Date().toISOString(), note });
  res.json(task);
});

app.post("/api/tasks/bulk-update", (req, res) => {
  const { taskIds, status, confirmed } = req.body || {};
  if (!Array.isArray(taskIds) || !status) {
    return res.status(400).json({ error: "taskIds and status are required" });
  }
  if (confirmed !== true) {
    return res.status(412).json({
      error: "confirmation_required",
      message: "This write requires explicit user confirmation before it can be applied."
    });
  }
  const updated = [];
  taskIds.forEach((id) => {
    const task = tasks.find((t) => t.id === id);
    if (task) {
      task.status = status;
      task.activityLog.push({
        timestamp: new Date().toISOString(),
        note: `Marked ${status} via agent, user-confirmed`
      });
      updated.push(task);
    }
  });
  res.json({ updated });
});

app.get("/api/tasks/search", (req, res) => {
  const { query, status, tag } = req.query;
  let results = tasks;
  if (status) results = results.filter((t) => t.status === status);
  if (tag) results = results.filter((t) => t.tag === tag);
  if (query) {
    const q = String(query).toLowerCase();
    results = results.filter((t) => t.title.toLowerCase().includes(q));
  }
  res.json(results);
});

app.post("/api/tool-proposals", (req, res) => {
  const { name, description, steps } = req.body || {};
  if (!name || !description || !isValidSteps(steps)) {
    return res.status(400).json({
      error: "invalid_proposal",
      message: "name, description, and steps (composed only from allowed primitives) are required."
    });
  }
  if (!/^[a-z][a-z0-9_]{2,40}$/.test(name)) {
    return res.status(400).json({ error: "invalid_name", message: "Tool names must be lowercase snake_case." });
  }
  const proposal = {
    id: crypto.randomUUID(),
    name,
    description,
    steps,
    status: "pending",
    createdAt: new Date().toISOString()
  };
  toolProposals.unshift(proposal);
  res.status(201).json(proposal);
});

app.get("/api/tool-proposals", (req, res) => {
  res.json(toolProposals);
});

app.patch("/api/tool-proposals/:id", (req, res) => {
  const proposal = toolProposals.find((p) => p.id === req.params.id);
  if (!proposal) return res.status(404).json({ error: "not_found" });
  const { status } = req.body || {};
  if (!["approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "invalid_status" });
  }
  proposal.status = status;
  proposal.decidedAt = new Date().toISOString();
  res.json(proposal);
});

app.get("/api/files", (req, res) => {
  const list = Object.entries(projectFiles).map(([filePath, f]) => ({
    path: filePath,
    updatedAt: f.updatedAt,
    size: f.content.length
  }));
  res.json(list);
});

app.get("/api/files/content", (req, res) => {
  const { path: filePath } = req.query;
  if (!filePath || !projectFiles[filePath]) {
    return res.status(404).json({ error: "not_found" });
  }
  res.json({ path: filePath, content: projectFiles[filePath].content });
});

app.put("/api/files", (req, res) => {
  const { path: filePath, content } = req.body || {};
  if (!filePath || typeof content !== "string") {
    return res.status(400).json({ error: "path and content are required" });
  }
  if (content.length > 20000) {
    return res.status(413).json({ error: "file_too_large" });
  }
  projectFiles[filePath] = { content, updatedAt: new Date().toISOString() };
  res.status(201).json({ path: filePath, updatedAt: projectFiles[filePath].updatedAt });
});

app.post("/api/files/edit", (req, res) => {
  const { path: filePath, old_str, new_str } = req.body || {};
  if (!filePath || typeof old_str !== "string" || typeof new_str !== "string") {
    return res.status(400).json({ error: "path, old_str, and new_str are required" });
  }
  const file = projectFiles[filePath];
  if (!file) return res.status(404).json({ error: "not_found" });
  const occurrences = file.content.split(old_str).length - 1;
  if (occurrences !== 1) {
    return res.status(409).json({
      error: "match_count_invalid",
      message: `old_str matched ${occurrences} time(s); it must match exactly once. Add more surrounding context to make it unique.`,
      occurrences
    });
  }
  const updated = file.content.replace(old_str, new_str);
  if (updated.length > 20000) {
    return res.status(413).json({ error: "file_too_large" });
  }
  file.content = updated;
  file.updatedAt = new Date().toISOString();
  res.json({ path: filePath, updatedAt: file.updatedAt });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Agent task board running on port ${PORT}`);
});
