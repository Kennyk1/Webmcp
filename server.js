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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Agent task board running on port ${PORT}`);
});
