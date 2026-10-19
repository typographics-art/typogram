# Agentic Engineering: Building Multi-Agent Systems

A practical, build-ready guide to orchestrating AI agents, written for a machine to read and act on. The claim throughout: these systems are not magic. They are ordinary software built with AI components. Design them the way you design software, and add intelligence only where it earns its place.

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

Each agent decides who gets the work next: desk, then billing, then tech. Flexible. Risk: the work can go in circles, agents passing it back and forth with no one finishing.

### Group chat

All agents share one conversation. Easy to wire up. Risk: as the conversation grows, cost climbs, details are lost, and decisions conflict. Many voices, one thread, no owner.

Autonomy buys flexibility and costs control. Reach for it only when a fixed route cannot express the task.

## 4. State: give each agent its own copy

The clash: two agents both write the same file, guide.md. One overwrites the other, and work is lost.

The fix is the one software has always used for parallel work, a copy each plus a system around it:

- A copy each. Give every agent its own workspace, a git worktree (wt-a, wt-b). They never write over each other.
- Claims. Each unit of work is claimed by exactly one agent (Task 1 to A, Task 2 to B). No two agents take the same task.
- Merges. Each workspace merges back to the main line. Conflicts are settled at merge time, and the work comes back together.

Shared mutable state is where multi-agent systems break. Isolate it, claim it, merge it.

## 5. How to choose

One question decides the shape: do you know the steps?

- Yes: explicit control. Use a workflow (sequential, parallel, conditional).
- No: emergent control. Use autonomy. The answer shows up only by trying.

And the rule that matters most: even then, start with a workflow. Lay down the steps you do know, run it, and watch where it breaks. Replace only the broken step with an autonomous agent. You end up with a mostly-explicit pipeline and one or two intelligent joints, which is cheaper, more reliable, and easier to debug than autonomy everywhere.

## 6. Evaluation: is it working?

You cannot improve what you cannot measure. Build the evaluation before you scale the system.

1. Write the test jobs first. Decide what good looks like, and include the awkward cases, the inputs that are easy to get wrong.
2. Grade two ways. Use code when there is a right answer: check it with code (exact match, a schema, a passing test). Use a judge when it is a judgement call: a second model reviews the output. And check the judge too, grade the grader against a few known-good and known-bad examples, or it will quietly drift.
3. Run the simplest version alongside the complex one. In one published test, a single model call beat a team of agents on every axis: quality 9.7 against 9.3, tokens 355 against 15,343, model calls 1 against 3 or more. For a simple task, one model call often wins. Do not add agents you cannot justify with a measured gain.

## 7. Optimisation: where most of the value is

When the system works but is not good enough, optimise in this order. Most of the value is here, not in more agents.

1. Instructions. The prompt and the guidelines each agent follows. Sharper instructions fix more than extra agents do.
2. Tools. What each agent can actually do. The right tool, well described, beats a clever plan over the wrong tools.

## 8. The agent loop

Inside a single agent is a loop. Understand it, and bound it.

- Gather context: read the task, fetch what you need.
- Take action: the model requests tool calls; you execute them and feed the results back.
- Run the loop: repeat gather-and-act until the work is done or a limit is hit.
- Verify: before finishing, the agent checks its own work.
- Turn-limit guard: cap the iterations, and raise a clear "max turns exceeded" rather than loop forever.
- Plan between calls: for hard tasks, let the model plan its next step between tool calls.

A healthy loop is: gather context, take action, re-run the loop, verify the work, with a turn limit so it cannot run away.

## 9. Reference architecture: a working system

One concrete system that puts the patterns together. One message runs it all, and a human only at the end.

- Intake: one message (from a phone, Slack, or a client) creates a card on a task board with three columns, NEW, PICKED UP, DONE.
- Listener: watches the board, picks up a new card, and starts the flow. Everything after is automatic.
- Report block: an agent gathers sources, does the work, and runs its own checks for accuracy, structure, and writing. Then a judge, a second agent seeing the work for the first time, reads the report. After a few fix cycles it is handed back to the human. During testing, plant a fault on purpose (a quote changed to claim more than it says) and confirm the judge catches it.
- Fan-out: split the work into several isolated sandboxes, each running a different model (for example Opus, Sonnet, and a GPT model) building the same deliverable. A copy each, no shared state.
- Human at the end: the person picks the best of the several outputs. That is the only human step.
- Everything is logged: a live event stream and an explicit per-step status, so you can see what each agent did and why.

## 10. Build procedure

Do this, in order:

1. Define good: write the test jobs, including the awkward cases.
2. Start with one model call. Measure quality, tokens, and calls.
3. If one call is enough, ship it. It often is.
4. If not, draw the workflow (sequential, parallel, conditional) and write the route in code.
5. Find the one step that cannot be pre-scripted. Make only that step an autonomous agent, and pick its pattern (plan-based, handoff, or group chat) with its failure-mode guard.
6. If agents write shared artifacts, give each its own copy (a worktree), add claims, and merge back.
7. Add a judge for judgement-call outputs, and grade the judge.
8. Optimise instructions first, then tools.
9. Keep a human at the end for the pick or the approval.
10. Treat it as software: log every step, cap every loop, handle every failure.

## 11. Prompts you can reuse

Worker agent:

"You are {role}. Goal: {task}. Tools available: {tools}. Gather the context you need, then do the work. Before you finish, verify your output against these checks: {accuracy, structure, writing}. If you cannot finish within {N} steps, stop and report exactly what is blocking you. Do not guess."

Judge agent:

"You are a reviewer seeing this work for the first time. The task was: {task}. The source is: {source}. Check the output for accuracy (every quote and number must appear in the source, unchanged), structure ({required sections}), and writing ({rules}). List each problem and a concrete fix. Do not rewrite the work; only judge it."

Router (a conditional step):

"Read the request below. Choose exactly one route from this set: {routes}. Return only the route name, nothing else. Request: {request}."

Lead or planner (plan-based):

"Break this goal into independent tasks that can be worked in parallel: {goal}. Assign each task to one worker. After each worker returns, check its result; retry a failed task up to {N} times; then assemble the final result. Report which tasks failed."

## 12. Guidelines to keep

- Start explicit; add emergence only where the workflow breaks.
- Prefer one model call; justify every added agent with a measured win.
- Give each agent its own copy of shared state; settle conflicts at merge.
- Use a judge for judgement calls, and check the judge.
- Define good with test jobs before you build.
- Most gains come from instructions and tools, not more agents.
- Keep a human at the end.
- It is software: name the control and the state, log it, cap the loops, handle failure.

## Credits and provenance

The framing (the two questions; the explicit-to-emergent spectrum; the six patterns; start with a workflow and add autonomy only where it breaks; evaluate before you scale) is from Kem's "Agentic Engineering: Demystifying Orchestration" live class at the Glitch Cat Club. This page is an independent written synthesis for machine reading, set as a Typographics Art one-pager and signed by typographics-art.org. Each section carries its own hash, so you can verify a single quoted section against the sealed document; the whole page carries the issuer's Ed25519 signature.
