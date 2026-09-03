# Signal — an agent-native task board

Signal is a task board built for the WebMCP Challenge. It doesn't just expose
task data to an agent — it exposes structured reasoning signals and a write
gate that only opens after a human explicitly approves the change.

## The idea

Agents scraping a normal task board have to guess: click into each card,
parse dates from the DOM, infer whether something is actually finished.
Signal exposes that as a clean tool contract instead:

- `get_overdue_tasks` — structured list, no scraping
- `get_task_activity` — the raw activity log for a task
- `suggest_completions` — server-side heuristic that scans activity logs for
  completion signals (deployed, merged and closed, confirmed receipt, etc.)
  and returns candidates with a human-readable reason for each
- `search_tasks` / `add_task` — normal read/write helpers
- `bulk_update_status` — the only tool that changes task state. It requires
  `confirmed: true`, which the tool contract itself enforces server-side. A
  call without it is rejected with `412 confirmation_required`. This isn't
  prompt-engineered politeness — it's baked into the API.

That last point is the core of the pitch: the interface is the safety
mechanism, not the agent's judgment.

## Demo flow

1. Agent calls `get_overdue_tasks` → sees 7 overdue.
2. Agent calls `suggest_completions` → gets candidates with reasons pulled
   from real activity log entries.
3. Agent tells the user: *"I found 7 overdue tasks. 3 appear completed based
   on your project activity. Want me to mark those done?"*
4. User approves.
5. Agent calls `bulk_update_status` with `confirmed: true`.
6. Board updates live.

The page also ships a "Run agent demo" button in the Agent panel that plays
out this exact flow locally, for anyone testing without an agent-enabled
browser in front of them.

## Tool Forge — agents that extend their own toolset

Signal also lets an agent propose a *new* tool at runtime, composed only
from existing read primitives, which becomes real and callable only after
a human clicks Approve:

- `propose_tool(name, description, steps)` — steps are a short pipeline
  (`call` a whitelisted primitive like `get_overdue_tasks` or
  `search_tasks`, then optionally `filter` the result). This does **not**
  register anything. It records the proposal server-side and renders an
  approval card in the Agent panel.
- `list_tool_proposals()` — read-only, lets an agent check what it
  proposed and whether it's pending, approved, or rejected.

There's no code generation and no `eval`. A proposed tool can only be a
composition of primitives the server already whitelists
(`ALLOWED_PRIMITIVES` in `server.js`), so the worst a proposal can do is
combine existing reads in a new way — it can't reach new data or perform
writes.

Registration itself happens in `approveProposal()`, which only ever runs
from a real click on the Approve button. No tool's `execute()` function
calls `registerTool()` directly — new tools are a function of UI state
(the approval card being clicked), not one tool triggering another. That
mirrors the WebMCP spec's own guidance against tools registering tools
directly.

## Project files — a scratch workspace for the agent

A small in-memory file store the agent can read and write, shown in the
UI under `/workspace/...`:

- `write_project_file(path, content)`
- `read_project_file(path)`
- `list_project_files()`

Useful as a place for an agent to leave an artifact behind — notes, a
generated script, a draft file — that persists across the conversation
and is visible to the user in the same page, not buried in chat history.

## Run locally

```
npm install
npm start
```

Open `http://localhost:3000`.

To test the WebMCP tools themselves, open the page in an agent-enabled
browser (ChatGPT's in-app browser, or Chrome with
`chrome://flags/#enable-webmcp-testing` turned on) and ask the agent about
your overdue tasks.

## Stack

Plain Express backend, in-memory store, no frontend build step — the whole
UI is vanilla JS registering tools via `document.modelContext.registerTool`.
Kept intentionally build-free so it deploys to Render, Vercel, or Netlify
with zero configuration.

## Data model

Each task carries an `activityLog`, an array of timestamped notes. That log
is what `suggest_completions` reasons over — it's meant to model the kind of
activity a real task tool would already have (comments, linked commits,
status changes) rather than something purpose-built for the demo.
