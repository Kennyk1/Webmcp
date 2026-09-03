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

const TOOL_EXECUTORS = {
  get_overdue_tasks: async () => tasks.filter(isOverdue),
  get_task_activity: async ({ taskId }) => {
    const task = tasks.find((t) => t.id === taskId);
    return task ? task.activityLog : { error: "not_found" };
  },
  suggest_completions: async () => {
    const overdue = tasks.filter(isOverdue);
    const candidates = overdue
      .map((task) => {
        const signal = findCompletionSignal(task);
        return signal ? { id: task.id, title: task.title, reason: signal } : null;
      })
      .filter(Boolean);
    return { overdueCount: overdue.length, candidates };
  },
  search_tasks: async ({ query, status, tag }) => {
    let results = tasks;
    if (status) results = results.filter((t) => t.status === status);
    if (tag) results = results.filter((t) => t.tag === tag);
    if (query) results = results.filter((t) => t.title.toLowerCase().includes(String(query).toLowerCase()));
    return results;
  },
  add_task: async ({ title, tag, dueDate }) => {
    const task = {
      id: crypto.randomUUID(),
      title,
      status: "todo",
      tag: tag || "general",
      dueDate: dueDate || daysFromNow(7),
      activityLog: []
    };
    tasks.unshift(task);
    return task;
  },
  bulk_update_status: async ({ taskIds, status, confirmed }) => {
    if (confirmed !== true) {
      return {
        error: "confirmation_required",
        message: "Ask the user for explicit approval in this conversation first, then call again with confirmed:true."
      };
    }
    const updated = [];
    (taskIds || []).forEach((id) => {
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
    return { updated };
  }
};

const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "get_overdue_tasks",
      description: "List all tasks that are past their due date and not marked done.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "get_task_activity",
      description: "Get the activity log for a specific task by id.",
      parameters: {
        type: "object",
        properties: { taskId: { type: "string" } },
        required: ["taskId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "suggest_completions",
      description: "Scan overdue tasks for activity-log signals suggesting the task is actually complete. Read-only.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "search_tasks",
      description: "Search tasks by free-text query, status, or tag.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          status: { type: "string", enum: ["todo", "doing", "done"] },
          tag: { type: "string" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "add_task",
      description: "Create a new task.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          tag: { type: "string" },
          dueDate: { type: "string", description: "YYYY-MM-DD" }
        },
        required: ["title"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "bulk_update_status",
      description: "Update the status of one or more tasks. Requires confirmed=true, which must only be set after the user has explicitly approved the change earlier in this conversation.",
      parameters: {
        type: "object",
        properties: {
          taskIds: { type: "array", items: { type: "string" } },
          status: { type: "string", enum: ["todo", "doing", "done"] },
          confirmed: { type: "boolean" }
        },
        required: ["taskIds", "status", "confirmed"]
      }
    }
  }
];

async function callRouter(messages) {
  const url = process.env.AGENT_ROUTER_URL || "https://router.fiazzytech.live/gpt/v1/chat/completions";
  const model = process.env.AGENT_ROUTER_MODEL || "gpt-5.6-sol";
  const apiKey = process.env.AGENT_ROUTER_API_KEY;
  if (!apiKey) throw new Error("AGENT_ROUTER_API_KEY is not set");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "codex_cli_rs/0.101.0",
      Originator: "codex_cli_rs",
      Version: "0.101.0"
    },
    body: JSON.stringify({
      model,
      messages,
      tools: TOOL_DEFS,
      tool_choice: "auto",
      max_tokens: 600,
      stream: false
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`router ${res.status}: ${text}`);
  }
  return res.json();
}

app.post("/api/agent-chat", async (req, res) => {
  const { history } = req.body || {};
  if (!Array.isArray(history) || history.length === 0) {
    return res.status(400).json({ error: "history is required" });
  }

  const systemPrompt = {
    role: "system",
    content:
      "You are a task assistant with tool access to a task board. Reads are always fine. " +
      "Never call bulk_update_status with confirmed:true unless the user has explicitly said yes to that exact change earlier in this conversation. " +
      "If you haven't asked yet, ask first and stop."
  };
  const messages = [systemPrompt, ...history];
  const toolLog = [];

  try {
    for (let turn = 0; turn < 5; turn++) {
      const data = await callRouter(messages);
      const choice = data.choices[0].message;
      messages.push(choice);

      if (!choice.tool_calls || choice.tool_calls.length === 0) {
        return res.json({ reply: choice.content, toolLog });
      }

      for (const call of choice.tool_calls) {
        const args = JSON.parse(call.function.arguments || "{}");
        const executor = TOOL_EXECUTORS[call.function.name];
        const result = executor ? await executor(args) : { error: "unknown_tool" };
        toolLog.push({ name: call.function.name, args, result });
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }
    res.json({ reply: "Reached max tool-call turns without a final answer.", toolLog });
  } catch (err) {
    res.status(502).json({ error: "router_failed", message: String((err && err.message) || err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Agent task board running on port ${PORT}`);
});
