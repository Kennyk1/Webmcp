const state = { tasks: [] };

const columnMap = { todo: "col-todo", doing: "col-doing", done: "col-done" };

function isOverdue(task) {
  const today = new Date().toISOString().slice(0, 10);
  return task.status !== "done" && task.dueDate < today;
}

function renderBoard() {
  Object.values(columnMap).forEach((id) => {
    document.getElementById(id).innerHTML = "";
  });
  const counts = { todo: 0, doing: 0, done: 0 };
  let overdueCount = 0;

  state.tasks.forEach((task) => {
    counts[task.status] += 1;
    if (isOverdue(task)) overdueCount += 1;

    const card = document.createElement("div");
    card.className = "task-card";

    const title = document.createElement("p");
    title.className = "task-title";
    title.textContent = task.title;

    const meta = document.createElement("div");
    meta.className = "task-meta";

    const tag = document.createElement("span");
    tag.className = "task-tag";
    tag.textContent = task.tag;

    const due = document.createElement("span");
    due.className = "task-due" + (isOverdue(task) ? " overdue" : "");
    due.textContent = task.status === "done" ? "done" : task.dueDate;

    meta.appendChild(tag);
    meta.appendChild(due);
    card.appendChild(title);
    card.appendChild(meta);

    if (task.status !== "done") {
      const actions = document.createElement("div");
      actions.className = "task-actions";
      const nextStatus = task.status === "todo" ? "doing" : "done";
      const btn = document.createElement("button");
      btn.textContent = task.status === "todo" ? "Start" : "Mark done";
      btn.onclick = () => updateTaskStatus(task.id, nextStatus);
      actions.appendChild(btn);
      card.appendChild(actions);
    }

    document.getElementById(columnMap[task.status]).appendChild(card);
  });

  document.getElementById("count-todo").textContent = counts.todo;
  document.getElementById("count-doing").textContent = counts.doing;
  document.getElementById("count-done").textContent = counts.done;
  document.getElementById("summary-overdue").textContent = `${overdueCount} overdue`;
}

async function loadTasks() {
  const res = await fetch("/api/tasks");
  state.tasks = await res.json();
  renderBoard();
}

async function updateTaskStatus(id, status) {
  await fetch(`/api/tasks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });
  await loadTasks();
}

function appendAgentMessage({ text, variant, onApprove }) {
  const thread = document.getElementById("agent-thread");
  const message = document.createElement("div");
  message.className = "agent-message" + (variant ? ` ${variant}` : "");
  const p = document.createElement("p");
  p.style.margin = "0";
  p.textContent = text;
  message.appendChild(p);

  if (onApprove) {
    const row = document.createElement("div");
    row.className = "approve-row";
    const yes = document.createElement("button");
    yes.className = "approve-yes";
    yes.textContent = "Approve";
    yes.onclick = async () => {
      row.remove();
      await onApprove();
    };
    const no = document.createElement("button");
    no.className = "approve-no";
    no.textContent = "Not now";
    no.onclick = () => row.remove();
    row.appendChild(yes);
    row.appendChild(no);
    message.appendChild(row);
  }

  thread.appendChild(message);
  thread.scrollTop = thread.scrollHeight;
  return message;
}

async function runAgentDemo() {
  document.getElementById("agent-thread").innerHTML = "";
  const res = await fetch("/api/tasks/suggest-completions", { method: "POST" });
  const { overdueCount, candidates } = await res.json();

  if (overdueCount === 0) {
    appendAgentMessage({ text: "No overdue tasks right now." });
    return;
  }

  if (candidates.length === 0) {
    appendAgentMessage({ text: `Found ${overdueCount} overdue tasks. No completion signals in the activity log yet.` });
    return;
  }

  const names = candidates.map((c) => `"${c.title}"`).join(", ");
  const text = `I found ${overdueCount} overdue tasks. ${candidates.length} appear completed based on your project activity: ${names}. Want me to mark those done?`;

  appendAgentMessage({
    text,
    variant: "pending",
    onApprove: async () => {
      const ids = candidates.map((c) => c.id);
      await fetch("/api/tasks/bulk-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskIds: ids, status: "done", confirmed: true })
      });
      await loadTasks();
      appendAgentMessage({ text: `Done. Marked ${ids.length} task${ids.length > 1 ? "s" : ""} complete.`, variant: "confirmed" });
    }
  });
}

function listTool(name, description) {
  const li = document.createElement("li");
  const code = document.createElement("code");
  code.textContent = name;
  li.appendChild(code);
  li.appendChild(document.createTextNode(` — ${description}`));
  document.getElementById("tool-list").appendChild(li);
}

function registerWebMcpTools() {
  const statusPill = document.getElementById("webmcp-status");

  if (!("modelContext" in window.navigator)) {
    statusPill.textContent = "WebMCP not detected in this browser";
    statusPill.classList.add("unsupported");
    return;
  }

  statusPill.textContent = "WebMCP tools registered";

  navigator.modelContext.registerTool({
    name: "get_overdue_tasks",
    description: "List all tasks that are past their due date and not marked done.",
    inputSchema: { type: "object", properties: {} },
    execute: async () => {
      const res = await fetch("/api/tasks/overdue");
      return { content: [{ type: "text", text: JSON.stringify(await res.json()) }] };
    }
  });
  listTool("get_overdue_tasks", "returns overdue, non-done tasks");

  navigator.modelContext.registerTool({
    name: "get_task_activity",
    description: "Get the activity log for a specific task by id, to check for completion signals.",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string", description: "The task id" } },
      required: ["taskId"]
    },
    execute: async ({ taskId }) => {
      const res = await fetch(`/api/tasks/${taskId}/activity`);
      return { content: [{ type: "text", text: JSON.stringify(await res.json()) }] };
    }
  });
  listTool("get_task_activity", "returns the log for one task");

  navigator.modelContext.registerTool({
    name: "suggest_completions",
    description: "Scan overdue tasks for activity-log signals that suggest the task is actually complete, and return candidates with a reason for each.",
    inputSchema: { type: "object", properties: {} },
    execute: async () => {
      const res = await fetch("/api/tasks/suggest-completions", { method: "POST" });
      return { content: [{ type: "text", text: JSON.stringify(await res.json()) }] };
    }
  });
  listTool("suggest_completions", "reasons over activity logs, never writes");

  navigator.modelContext.registerTool({
    name: "bulk_update_status",
    description: "Update the status of one or more tasks. Requires confirmed=true, which must only be set after the user has explicitly approved the change in conversation. Calls without confirmed=true are rejected.",
    inputSchema: {
      type: "object",
      properties: {
        taskIds: { type: "array", items: { type: "string" } },
        status: { type: "string", enum: ["todo", "doing", "done"] },
        confirmed: { type: "boolean", description: "Must be true; set only after explicit user approval" }
      },
      required: ["taskIds", "status", "confirmed"]
    },
    execute: async ({ taskIds, status, confirmed }) => {
      const res = await fetch("/api/tasks/bulk-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskIds, status, confirmed })
      });
      const body = await res.json();
      if (!res.ok) {
        return { content: [{ type: "text", text: JSON.stringify(body) }], isError: true };
      }
      await loadTasks();
      return { content: [{ type: "text", text: JSON.stringify(body) }] };
    }
  });
  listTool("bulk_update_status", "the only write tool; rejects unconfirmed calls");

  navigator.modelContext.registerTool({
    name: "search_tasks",
    description: "Search tasks by free-text query, status, or tag.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        status: { type: "string", enum: ["todo", "doing", "done"] },
        tag: { type: "string" }
      }
    },
    execute: async ({ query, status, tag }) => {
      const params = new URLSearchParams();
      if (query) params.set("query", query);
      if (status) params.set("status", status);
      if (tag) params.set("tag", tag);
      const res = await fetch(`/api/tasks/search?${params.toString()}`);
      return { content: [{ type: "text", text: JSON.stringify(await res.json()) }] };
    }
  });
  listTool("search_tasks", "structured filter, no scraping needed");

  navigator.modelContext.registerTool({
    name: "add_task",
    description: "Create a new task.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        tag: { type: "string" },
        dueDate: { type: "string", description: "YYYY-MM-DD" }
      },
      required: ["title"]
    },
    execute: async ({ title, tag, dueDate }) => {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, tag, dueDate })
      });
      const body = await res.json();
      await loadTasks();
      return { content: [{ type: "text", text: JSON.stringify(body) }] };
    }
  });
  listTool("add_task", "creates a task");
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadTasks();
  registerWebMcpTools();
  appendAgentMessage({ text: "Ask your agent to check overdue tasks, or click below to see the approval flow." });
  const demoBtn = document.createElement("button");
  demoBtn.textContent = "Run agent demo";
  demoBtn.className = "approve-yes";
  demoBtn.style.alignSelf = "flex-start";
  demoBtn.onclick = runAgentDemo;
  document.getElementById("agent-thread").appendChild(demoBtn);
});
