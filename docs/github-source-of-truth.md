# GitHub engineering source of truth

Status: **authoritative**.

This document is the single, canonical policy for how engineering work is
identified, sequenced, executed, and closed for `post-kit`.

Where another document, skill, or instruction file describes engineering
workflow differently, **this document wins** unless that other document has
itself been updated to supersede it. Do not copy this policy's content into
other files — link to this document instead.

## 1. System ownership boundaries

Each kind of information has exactly one authoritative system. Do not
duplicate an authoritative record in a second system "just in case," and do
not treat a non-authoritative copy (a comment, a mirrored status, a stale
export) as the source of truth.

| System | Owns | Does NOT own |
| --- | --- | --- |
| **ClickUp** | Private business/commercial planning org-wide: business ideas, commercial strategy, pricing, sales information, customer-private information, contracts, commercially sensitive roadmap, other private business planning. | Anything in this repo's engineering execution lifecycle. This repository has **no** ClickUp engineering integration and no leftover migration issues. |
| **GitHub Issues** | Engineering work units: features ready for engineering, technical discovery, bugs, infrastructure work, technical debt, engineering dependencies, executable work assigned to agents. | Commercial/business planning content that has not yet crossed the engineering boundary (see section 3). |
| **GitHub Project** | Engineering prioritisation, engineering lifecycle/status, backlog visibility, ready/in-progress/review/done views. | The definition of the work itself (that's the Issue body) or implementation history (that's the PR). Configuration is documented in [`docs/github-project.md`](./github-project.md). |
| **Repository documentation** (`docs/**`, `AGENTS.md`, `.github/agents/**`) | Technical knowledge required by engineers and AI agents: architecture, conventions, runbooks, pipelines. Agent skills are **not** stored here — install from [`singleton-sd/ai-plattform-skills`](https://github.com/singleton-sd/ai-plattform-skills) via `pnpm sync:skills`. | Business/commercial knowledge; skill source files. |
| **Pull requests** | Implementation, code review, review discussion, CI validation, merge state. | Task definition or prioritisation — a PR implements an Issue, it does not replace one. |

ClickUp remains a real, actively used system for the business/commercial
categories above. It is not part of how PostKit engineering work is defined,
sequenced, claimed, or closed.

## 2. No ClickUp engineering integration

No step of the PostKit engineering lifecycle may require reading from or
writing to ClickUp:

- Engineering work is **not** created as a ClickUp task.
- Engineering status is **not** read from or written to ClickUp.
- Agents do **not** claim engineering work via a ClickUp field.
- PR handoff does **not** depend on a ClickUp transition, comment, or custom
  field.
- GitHub activity (issues, PRs, CI) is **not** mirrored into ClickUp.

Do not add ClickUp engineering integrations, scripts, flags, or tests to
this repository.

## 3. Engineering lifecycle

```text
Idea / business requirement (private planning, or informal)
        |
        v
engineering boundary crossed
   (goal, scope, and acceptance criteria are clear enough to build)
        |
        v
GitHub Issue created
        |
        v
dependency / readiness evaluation
   (Depends on / Blocks / Parent resolved — see section 5)
        |
        v
agent claims the issue
        |
        v
branch / worktree created from origin/main
        |
        v
implementation
        |
        v
fetch + rebase (or merge, per repo conflict playbook) origin/main
        |
        v
relevant tests run
        |
        v
PR opened, linked to the issue (Closes #N)
        |
        v
review / review feedback addressed
        |
        v
merge (human only)
        |
        v
issue closed / GitHub Project column = Done
```

No step in this chain touches ClickUp. An idea may originate in private
business planning, but the moment it becomes actionable engineering work, a
GitHub Issue is opened and the GitHub Issue becomes the work's identity from
that point forward.

### Crossing the engineering boundary

An idea "crosses the boundary" into engineering when someone (human or
agent) can state, from the idea, a concrete engineering goal, a rough scope,
and at least a first pass at acceptance criteria. At that point:

1. Open a GitHub Issue capturing the goal, scope, acceptance criteria, and
   any known dependencies/constraints.
2. Do not require access to a private planning tool to understand or execute
   the issue.
3. Private business bookkeeping is out of scope for engineering agents.

## 4. Agent-ready definition

A GitHub Issue is **agent-ready** when all of the following are true:

- It has a clearly defined goal/problem statement.
- Its implementation scope is sufficient to start work without further
  business clarification (an agent should not need to guess intent).
- It has explicit acceptance criteria (a checklist, or clearly stated
  "done when" conditions).
- Relevant constraints are stated (architecture, security, performance,
  compatibility, or anything else that bounds the solution space).
- Relevant technical references are present or discoverable (linked docs,
  related code, related issues).
- Any previously open questions have been resolved to the point that an
  implementer would not have to make an unrecorded judgment call on
  something that materially changes the outcome.
- **It has no unresolved blocking dependency** (see section 5). An issue
  blocked by another open issue is never agent-ready, regardless of how
  well-specified it is.

An issue lacking any of the above is not agent-ready. Refining it into a
ready state is discovery/refinement work, not implementation work, and
should be resolved (via issue edits/comments, or a linked discovery issue)
before an implementation agent claims it.

## 5. Issue dependency semantics and parallel execution

Express relationships between GitHub Issues using explicit, greppable lines
in the issue body (or `gh`/API sub-issue relationships where the repository
has them configured):

```text
Depends on: #123
Blocks: #456
Parent: #100
```

### Semantics

- **`Depends on: #N`** — this issue must not be started until issue `#N` is
  closed (merged and closed, not just PR-open). An agent must treat an issue
  with an unresolved `Depends on` as **not agent-ready**.
- **`Blocks: #N`** — informational inverse of `Depends on`, written on the
  blocking issue so readers can see downstream impact without cross-checking
  every other issue. `Blocks` is not itself a gate; the gate is the
  `Depends on` line on the blocked issue.
- **`Parent: #N`** — this issue is a sub-issue/work item of a larger tracking
  issue `#N` (e.g. an epic). A parent issue is not "done" as a unit of
  implementation; its children are the actual work.

### Rules

- An issue with an unresolved `Depends on` must not be claimed or started.
- Issues with no dependency relationship between them may run concurrently
  in separate worktrees/branches, regardless of whether they touch the same
  repository area — as long as their expected file sets do not
  substantially overlap (see the shared hub-file guidance already defined
  in `AGENTS.md`).
- Agents must not build on another agent's unmerged branch unless the issue
  explicitly declares that dependency (`Depends on: #N` naming that agent's
  issue). Start from `origin/main`, not from another open branch.
- Integration work (an issue whose purpose is to combine multiple upstream
  results) waits until all of its declared `Depends on` issues are closed,
  then starts from the updated `origin/main`.
- Cross-issue coordination happens through GitHub issue comments and PR
  descriptions/links — never through undocumented assumptions or
  out-of-band chat that isn't reflected in the issue.

### Example

```text
#2 Email package ─────┐
#3 Functions API ─────┼──> #5 Wire API to package
#4 Infra ─────────────┘

#6 Documentation runs independently.
```

`#5` declares `Depends on: #2`, `Depends on: #3`, `Depends on: #4`.
`#2`, `#3`, `#4`, and `#6` declare no dependency on each other.

Ready immediately: `#2`, `#3`, `#4`, `#6`.
Blocked: `#5` (until `#2`, `#3`, and `#4` are all closed).

## 6. Issue / branch / worktree / PR relationships

### GitHub issue identity convention

The **GitHub issue number** (`#N`) is the canonical identifier for a unit of
engineering work. Do not invent a parallel identifier for engineering work.

### Branch naming

```text
<type>/<issue-number>-<kebab-title>
```

Examples:

```text
feat/1-bootstrap-monorepo
fix/12-login-redirect
docs/8-github-engineering-source-of-truth
```

`<type>` follows conventional-commit-style prefixes (`feat`, `fix`, `docs`,
`chore`, `refactor`, `test`, etc.) matching the primary nature of the change.

Worktree folder names mirror the branch's `<issue-number>-<kebab-title>`
portion, following the worktree layout in `AGENTS.md` (parent workspace
`main/` + `worktrees/<slug>/`). Create every new worktree from
`origin/main`.

### PR linking

Every PR must link the issue it implements using a GitHub closing keyword in
the PR body, e.g.:

```text
Closes #1
```

This is what drives "issue closed" as part of the lifecycle in section 3 —
merging the PR automatically closes the linked issue. Use `Closes` (or
`Fixes`/`Resolves`) rather than a plain issue reference, so closure is
automatic and does not depend on a human remembering to close it separately.

### Repository workflow

1. Never work directly on `main`.
2. `git fetch origin` before starting.
3. Create the branch/worktree from `origin/main`.
4. Do not incorporate another agent's branch unless the issue explicitly
   declares that dependency (section 5).
5. Before pushing completed implementation:
   - `git fetch origin`
   - rebase (or merge, per the repository's existing conflict playbook for
     shared hub files in `AGENTS.md`) onto `origin/main`
   - resolve conflicts
   - run the relevant test suite
6. Push with `--force-with-lease` after a rebase, never plain `--force`.
7. Open/update the PR, with `Closes #N` linking the originating issue.
8. If `origin/main` changes while CI/review is running and branch
   protection or mergeability requires it, rebase again and re-push.
9. Humans merge. Agents do not approve or merge their own PRs.

## 7. Public-repository safety boundary

This repository is **public**. Anything committed or posted to it — issues,
PR descriptions and comments, commits, branch names, repository docs,
Actions logs/output — must be treated as permanently and publicly visible,
even if later edited or deleted.

**Never place in the public repository:**

- Secrets, credentials, API tokens, connection strings, deploy tokens.
- Private customer data or anything that identifies a specific customer.
- Customer contracts or confidential commercial agreements.
- Sensitive pricing negotiations or commercial terms.
- Private customer requirements that name or identify the customer.
- Any other information whose disclosure creates commercial, security, or
  privacy risk.

**May remain public:** generic architecture, implementation details,
engineering requirements, and ordinary product capability descriptions.

Keep private business detail **out of this public repository**. If
engineering work legitimately needs to reference something in the "never"
list (e.g. a real customer's specific requirement), write the GitHub Issue
in generic terms and keep the private detail in the private business
planning system — not here.
