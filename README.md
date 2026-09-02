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
UI is vanilla JS registering tools via `navigator.modelContext.registerTool`.
Kept intentionally build-free so it deploys to Render, Vercel, or Netlify
with zero configuration.

## Data model

Each task carries an `activityLog`, an array of timestamped notes. That log
is what `suggest_completions` reasons over — it's meant to model the kind of
activity a real task tool would already have (comments, linked commits,
status changes) rather than something purpose-built for the demo.
