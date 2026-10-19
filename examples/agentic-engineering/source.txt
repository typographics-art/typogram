# Agentic Engineering: Building Multi-Agent Systems

A practical, build-ready guide to orchestrating AI agents, written for a machine to read and act on. It is general: it names the patterns for building agents and, for each kind of application, shows which pattern to reach for, how to hold state and memory, and how to choose the model. The claim throughout: these systems are not magic. They are ordinary software built with AI components. Design them the way you design software, and add intelligence only where it earns its place.

## 1. The two questions

Every multi-agent design is the answer to two questions:

1. Who controls the flow? Who decides what happens next.
2. How do agents share state? How they share what they know.

Each answer sits on a spectrum. At one end is EXPLICIT CONTROL: you decide everything up front, in code. At the other is EMERGENT CONTROL: the model decides at run time. Most real systems live in between, an explicit skeleton with intelligence at the joints. Name where each part of your system sits before you build it.

## 2. Workflow patterns: explicit control, routed in code

Use a workflow when you already know the steps. The route is fixed in code; the model only fills in each step. Three shapes cover almost everything.

### Sequential

One step after another. Use it when the steps are known and ordered: draft, then check, then publish.

### Parallel

Fan out, then bring the results back. Use it for parts that do not depend on each other: summarise ten documents at once, then combine.

### Conditional

Read the request and pick the route. Use it when the path depends on the input: a triage step that sends a ticket to the right handler.

Frameworks such as LangGraph express exactly this. A workflow is just a graph of steps:

```
# LangGraph (graph.py)
graph.add_edge("draft", "check")              # sequential: draft, then check
graph.add_conditional_edges("triage", route)  # conditional: triage picks the route
```

If you can draw the graph, write it in code. The model is a node, not the orchestrator.

## 3. Autonomous patterns: emergent control, routed by the model

Use autonomy when you do NOT know the steps, when the path only shows up by trying. Each pattern has a failure mode; know it before you choose it.

### Plan-based

A lead agent plans the work, hands out tasks, checks the results, and retries failures, like a project manager. Risk: the lead is a single point of failure. If its plan is wrong, everything downstream is wrong.

### Handoff

Each agent decides who gets the work next: desk, then billing, then tech. Flexible. Risk: the work can go in circles, agents passing it back and forth with no one finishing — so cap the hops (a maximum number of handoffs) and end in a clear failure instead of forever.

### Group chat

All agents share one conversation. Easy to wire up. Risk: as the conversation grows, cost climbs, details are lost, and decisions conflict. Many voices, one thread, no owner.

Autonomy buys flexibility and costs control. Reach for it only when a fixed route cannot express the task.

## 4. State: give each agent its own copy

The clash: two agents both write the same file, guide.md. One overwrites the other, and work is lost.

The fix is the one software has always used for parallel work, a copy each plus a system around it:

- A copy each. Give every agent its own workspace — a git worktree for code, or a separate branch, row or document version for data. They never write over each other.
- Claims. Each unit of work is claimed by exactly one agent (Task 1 to A, Task 2 to B). No two agents take the same task.
- Merges. Each workspace merges back to the main line. Conflicts are settled at merge time, and the work comes back together.

Shared mutable state is where multi-agent systems break. Isolate it, claim it, merge it.

## 5. Memory and context

An agent does not remember on its own between runs; it gathers the context it needs each time. Design the memory, do not hope for it.

- Durable state lives OUTSIDE the agent: a task board (NEW, PICKED UP, DONE), saved blocks, files, a database. The agent reads from it and writes to it; if the agent restarts, the state is still there.
- Working context is gathered per turn: at the start of each run the agent fetches the task, the relevant files, and prior results, and keeps only what it needs.
- A long shared conversation is NOT memory. Leaning on an ever-growing chat is the group-chat failure mode: cost climbs, details are lost, decisions conflict. Persist the facts that must survive; recompute or re-fetch the rest.
- Each agent gets its own working copy of mutable state (section 4). Agents share through claimed, merged artifacts, not a shared scratchpad.

## 6. Model choice

The model is a replaceable part. Choose it to the task, not the task to the model.

- Start with the smallest, cheapest model that passes your evaluation. Many tasks need only one call to a capable model.
- Escalate only where it breaks: a stronger model for the one hard step, a cheaper one for the routine steps. Mixed-model pipelines are normal.
- When quality is subjective (a design, a draft), run several models on the same task in isolation, a sandbox each, and let a human or a judge pick the best. Different models have different strengths; trying a few and choosing beats arguing about which is best.
- Measure the choice: compare quality, tokens, and calls across models on your test jobs before you commit.

## 7. How to choose

One question decides the shape: do you know the steps?

- Yes: explicit control. Use a workflow (sequential, parallel, conditional).
- No: emergent control. Use autonomy. The answer shows up only by trying.

And the rule that matters most: even then, start with a workflow. Lay down the steps you do know, run it, and watch where it breaks. Replace only the broken step with an autonomous agent. You end up with a mostly-explicit pipeline and one or two intelligent joints, which is cheaper, more reliable, and easier to debug than autonomy everywhere.

### By use case

Match the pattern to the work:

- Known, fixed pipeline (document processing, data extraction, a report with the same steps every time): a sequential workflow. Route it in code; each step is a model call or a tool.
- Independent subtasks (summarise many files, grade many answers, enrich many records): a parallel workflow. Fan out, bring the results back.
- Routing or triage (classify a request, send a ticket to the right handler, choose a tool): a conditional workflow. One model reads the input and picks the route.
- Open-ended work with an unknown path (research a question, fix a bug, investigate a system): an autonomous agent loop. The agent gathers, acts, verifies, and repeats until done, bounded by a turn limit.
- A goal that splits into sub-goals (build a feature, run a campaign): plan-based. A lead plans and hands out, then checks and retries; guard its single point of failure.
- A chain of specialists (intake, then billing, then technical): handoff. Each agent picks who is next; guard against going in circles.
- Several candidates to choose among (design a page, draft copy, propose options): a parallel fan-out to several models or prompts, then a human or a judge picks the best.
- A deliverable that must be correct (a legal brief, a published report, anything cited): a worker plus a judge, a second model that reviews it; and check the judge.

Most real applications combine these: a fixed pipeline with one autonomous step, or a router that dispatches to several workflows. Start from the case closest to yours, build it explicitly, and add autonomy only where it breaks.

## 8. Evaluation: is it working?

You cannot improve what you cannot measure. Build the evaluation before you scale the system.

1. Write the test jobs first. Decide what good looks like, and include the awkward cases, the inputs that are easy to get wrong.
2. Grade two ways. Use code when there is a right answer: check it with code (exact match, a schema, a passing test). Use a judge when it is a judgement call: a second model reviews the output. And check the judge too, grade the grader against a few known-good and known-bad examples, or it will quietly drift.
3. Run the simplest version alongside the complex one. On many tasks a single call to a capable model matches or beats a team of agents at a fraction of the tokens and calls — so for a simple task, one call often wins. Do not add an agent you cannot justify with a measured gain on your own test jobs.

## 9. Optimisation: where most of the value is

When the system works but is not good enough, optimise in this order. Most of the value is near the top, not in more agents.

1. Instructions. The prompt and the guidelines each agent follows. Sharper instructions fix more than extra agents do.
2. Tools. What each agent can actually do. The right tool, well described, beats a clever plan over the wrong tools.
3. Context and retrieval. What you put in front of the model each turn — the right facts, not more text. Fix what it sees before you change how it thinks.
4. Model choice. Escalate the one hard step to a stronger model, or try several (section 6), before you add structure.
5. Only then, more agents. Extra agents and steps are the most expensive change and usually the smallest gain; justify each with a measured win.

## 10. The agent loop

Inside a single agent is a loop. Understand it, and bound it.

- Gather context: read the task, fetch what you need.
- Take action: the model requests tool calls; you execute them and feed the results back.
- Run the loop: repeat gather-and-act until the work is done or a limit is hit.
- Verify: before finishing, the agent checks its own work.
- Turn-limit guard: cap the iterations, and raise a clear "max turns exceeded" rather than loop forever.
- Plan between calls: for hard tasks, let the model plan its next step between tool calls.

A healthy loop is: gather context, take action, re-run the loop, verify the work, with a turn limit so it cannot run away.

## 11. Reference architecture: a working system

One concrete system that puts the patterns together. It is an example of the general shape, not the only one. One message runs it all, and a human only at the end.

- Intake: one message (from a phone, Slack, or a client) creates a card on a task board with three columns, NEW, PICKED UP, DONE.
- Listener: watches the board, picks up a new card, and starts the flow. Everything after is automatic.
- Report block: an agent gathers sources, does the work, and runs its own checks for accuracy, structure, and writing. Then a judge, a second agent seeing the work for the first time, reads the report. After a few fix cycles it is handed back to the human. During testing, plant a fault on purpose (a quote changed to claim more than it says) and confirm the judge catches it.
- Fan-out: split the work into several isolated sandboxes, each running a different model (for example three frontier models from different providers) building the same deliverable. A copy each, no shared state.
- Human at the end: the person picks the best of the several outputs. That is the only human step.
- Everything is logged: a live event stream and an explicit per-step status, so you can see what each agent did and why.

## 12. Build procedure

Do this, in order:

1. Define good: write the test jobs, including the awkward cases.
2. Start with one call to the smallest model that could work. Measure quality, tokens, and calls.
3. If one call is enough, ship it. It often is.
4. If not, draw the workflow (sequential, parallel, conditional) and write the route in code.
5. Find the one step that cannot be pre-scripted. Make only that step an autonomous agent, and pick its pattern (plan-based, handoff, or group chat) with its failure-mode guard.
6. Design the memory: keep durable state outside the agents (a board, files), and give each agent its own working copy; add claims and merges for shared artifacts.
7. Choose the model per step: cheapest that passes; a stronger one only for the hard step; several in parallel when the output is subjective.
8. Add a judge for judgement-call outputs, and grade the judge.
9. Optimise instructions first, then tools.
10. Scope the authority (section 15): least-privilege, sandboxed tools; a human gate before anything irreversible; treat tool output as untrusted input; set token and time budgets, not just a turn limit.
11. Keep a human at the end for the pick or the approval, and treat the whole thing as software: log every step, cap every loop, handle every failure.

## 13. Prompts you can reuse

Worker agent:

"You are {role}. Goal: {task}. Tools available: {tools}. Gather the context you need, then do the work. Before you finish, verify your output against these checks: {accuracy, structure, writing}. If you cannot finish within {N} steps, stop and report exactly what is blocking you. Do not guess."

Judge agent:

"You are a reviewer seeing this work for the first time. The task was: {task}. The source is: {source}. Check the output for accuracy (every quote and number must appear in the source, unchanged), structure ({required sections}), and writing ({rules}). List each problem and a concrete fix. Do not rewrite the work; only judge it."

Router (a conditional step):

"Read the request below. Choose exactly one route from this set: {routes}. Return only the route name, nothing else. Request: {request}."

Lead or planner (plan-based):

"Break this goal into independent tasks that can be worked in parallel: {goal}. Assign each task to one worker. After each worker returns, check its result; retry a failed task up to {N} times; then assemble the final result. Report which tasks failed."

## 14. Guidelines to keep

- Start explicit; add emergence only where the workflow breaks.
- Prefer one model call; justify every added agent with a measured win.
- Choose the model to the task: cheapest that passes, escalate only the hard step, try several when quality is subjective.
- Keep durable state outside the agents; give each its own copy; settle conflicts at merge. A long chat is not memory.
- Use a judge for judgement calls, and check the judge.
- Define good with test jobs before you build.
- Most gains come from instructions and tools, not more agents.
- Keep a human at the end.
- Scope the agent's authority: least-privilege, sandboxed tools; a human gate before anything irreversible; tool output is untrusted input; cap tokens and time, not just turns.
- It is software: name the control and the state, log it, cap the loops, handle failure.

## 15. Safety, permissions and cost

An agent that calls tools acts in the world; treat that as the main risk surface, not an afterthought.

- Tool output is untrusted input. A document, web page, or API response the agent reads can carry instructions aimed at the model (prompt injection). Keep the system prompt and the task authoritative; treat retrieved text as data to analyse, never as commands to obey.
- Least privilege for tools. Give each agent only the tools and scopes it needs, and sandbox anything that runs code or touches the filesystem, network, or a real account. A read-only task gets read-only tools.
- A human gate before irreversible actions. Spending money, deleting data, sending a message, deploying — put an explicit approval or a hard allowlist in front of these, and show what will happen before it happens.
- Budgets, not just turn limits. Cap tokens and wall-clock time per task as well as iterations, and stop with a clear "budget exceeded" rather than running up a bill.
- Idempotency and retries. Tools fail and time out; make each action safe to repeat (an idempotency key, or check-then-act), retry transient failures with backoff, and surface a permanent failure instead of looping.

An agent is software with the authority to act. Scope that authority, log every action, and keep a human in front of anything you cannot undo.

## Provenance

This page is a written synthesis by typographics-art.org of the field's common, publicly documented agent-building patterns, set out for a machine to read and act on — not a claim to have invented them. It is set as a Typographics Art one-pager: each section carries its own hash, and the whole page carries the issuer's Ed25519 signature. Verify it at typographics-art.org/v; the signing key is published at typographics-art.org/keys and mirrored on GitHub, npm and PyPI.
