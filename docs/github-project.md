# GitHub Project — PostKit Engineering

This document is the mechanical companion to
[`docs/github-source-of-truth.md`](./github-source-of-truth.md), which owns
*policy* (system ownership, the engineering lifecycle, the agent-ready
definition, dependency semantics). This document owns *how to configure it in
GitHub*: the Project's fields, views, labels, and native automation. Where
anything here reads like it's restating policy, the source of truth document
wins — this file only adds configuration detail.

## Current status

The live organization Project is
[PostKit Engineering](https://github.com/orgs/singleton-sd/projects/2)
(project number **2**). It is linked to `singleton-sd/post-kit`. Status
options are `Backlog`, `Ready for Agent`, `In Progress`, `In Review`, and
`Done`. Area options are `API`, `Packages`, `Infra/CI`, `Docs`,
`Cross-cutting`. Enable the built-in `Item added to project`, `Item closed`,
`Pull request linked to issue`, and `Pull request merged` workflows in the
Project UI if they are not already on. Views (Backlog / Ready for Agent /
In Progress / In Review / Roadmap / Done) are configured in the Project UI.

## Project fields

| Field | Type | Options / source | Notes |
| --- | --- | --- | --- |
| **Status** | built-in single select | `Backlog`, `Ready for Agent`, `In Progress`, `In Review`, `Done` | Every Projects v2 board ships a `Status` field; edit its options to this set instead of adding a second status field. `Ready for Agent` = agent-ready per [section 4](./github-source-of-truth.md#4-agent-ready-definition) **and** no unresolved `Depends on`. |
| **Priority** | single select | `Urgent`, `High`, `Medium`, `Low` | Reuse the organization-level `Priority` issue field if it already exists instead of creating a duplicate project-only field. |
| **Type** | single select (mirrors native GitHub Issue Type) | `Feature`, `Bug`, `Discovery`, `Task` | Prefer showing the built-in `Issue Type` system field on the Project instead of a second manually-maintained single select, once `Discovery` exists. |
| **Area** | single select, project-scoped | `API`, `Packages`, `Infra/CI`, `Docs`, `Cross-cutting` | Matches this repo's architecture split (see the Architecture section of `AGENTS.md`). |

This is deliberately minimal — four fields total. Do not add fields like
Claim Token, Preview URL, Token Estimate, or Token Spent: claiming is "who
is assigned + issue moved to In Progress," and token accounting has no GitHub
analogue worth tracking here.

## Views

| View | Filter | Sort / group |
| --- | --- | --- |
| **Backlog** | `Status = Backlog` | grouped by Area |
| **Ready for Agent** | `Status = "Ready for Agent"` | grouped by Priority |
| **In Progress** | `Status = "In Progress"` | grouped by assignee |
| **In Review** | `Status = "In Review"` | sorted by updated (oldest first, so stale reviews surface) |
| **Roadmap** | no status filter | Projects v2 "Roadmap" layout (or a table grouped by Priority) — timeline visibility across the backlog |
| **Done** | `Status = Done` | sorted by closed date, most recent first |

## Setup reference (one-time)

Run with a `gh` CLI authenticated with the `project` scope
(`gh auth refresh -s project`):

```bash
# 1. Create the project
gh project create --owner singleton-sd --title "PostKit Engineering" --format json
# note the returned "number" (project number) and "id" (project node id)

# 2. Edit the built-in Status field's options to match the lifecycle
gh project field-list <project-number> --owner singleton-sd
# Status already exists; edit its single-select options in the Project UI
# (Settings → Fields → Status) to: Backlog, Ready for Agent, In Progress,
# In Review, Done — `gh project field-create` cannot edit an existing field's
# options, only create new fields.

# 3. Create the remaining fields
gh project field-create <project-number> --owner singleton-sd \
  --name "Priority" --data-type SINGLE_SELECT \
  --single-select-options "Urgent,High,Medium,Low"

gh project field-create <project-number> --owner singleton-sd \
  --name "Type" --data-type SINGLE_SELECT \
  --single-select-options "Feature,Bug,Discovery,Task"

gh project field-create <project-number> --owner singleton-sd \
  --name "Area" --data-type SINGLE_SELECT \
  --single-select-options "API,Packages,Infra/CI,Docs,Cross-cutting"

# 4. Link the repository
gh project link <project-number> --owner singleton-sd --repo singleton-sd/post-kit
```

The six views listed above are created in the Project UI. GitHub's Projects
API supports setting their names, layouts, and filters, but grouping and
sorting remain UI-only.

## Built-in Project automation to enable (Project → Workflows tab)

No custom scripting needed — Projects v2 ships these as toggles:

- **Item added to project** → set Status: `Backlog`
- **Auto-add to project**: filter `is:issue` (add `is:pull-request` too if
  PRs should also appear on the board) scoped to this repository, so new
  issues land on the board without a manual "add to project" step
- **Item reopened** → set Status: `Backlog`
- **Pull request merged** → set Status: `Done` (this is what closes the loop
  with `Closes #N` — see [section 6](./github-source-of-truth.md#6-issue--branch--worktree--pr-relationships))
- **Item closed** → set Status: `Done`
- **Auto-archive items**: `Status = Done` for 2+ weeks (optional housekeeping,
  keeps the Done view from growing unbounded without deleting history)

`Code review approved` is not applicable — per the Solo-repo merge section of
`AGENTS.md`, this repository does not require approving reviews.

## Manual step: add a Discovery issue type

If the organization has native Issue Types `Task`, `Bug`, `Feature` but no
`Discovery` type, an organization owner should:

1. Organization → Settings → Planning → Issue types
   (`https://github.com/organizations/singleton-sd/settings/issue-types`)
2. "New issue type" → name `Discovery`, description "Investigation, spike, or
   open design question that must resolve before a Feature/Bug can be
   scoped", pick a color.

Until that lands: file discovery work with the `Discovery` issue template
(`.github/ISSUE_TEMPLATE/discovery.yml`, which distinguishes it via the
`[Discovery]` title prefix and the `needs-requirements` label it applies by
default) and set the native Issue Type to `Task` as the closest available
fallback.

## Labels

Three labels represent lifecycle state that a Status column doesn't capture
on its own:

| Label | Meaning | Set | Cleared |
| --- | --- | --- | --- |
| `agent-ready` | Issue meets every criterion in [section 4](./github-source-of-truth.md#4-agent-ready-definition) | On triage, once the issue is well-specified and unblocked | If a criterion regresses (e.g. new unresolved question) |
| `blocked` | Issue has an unresolved `Depends on:` line ([section 5](./github-source-of-truth.md#5-issue-dependency-semantics-and-parallel-execution)) | When `Depends on` is added, or the referenced issue is still open | When every `Depends on` issue is closed |
| `needs-requirements` | Goal, scope, or acceptance criteria are not yet resolved — refinement work remains | Applied by default on `Discovery` issues; also usable to flag an under-specified Feature/Bug | Once goal/scope/acceptance criteria are filled in |

`.github/workflows/bootstrap-issue-labels.yml` ensures these three labels
exist in the repository (idempotent — same `ensure()` pattern already used by
`.github/workflows/pr-hygiene.yml` for its CI/conflict labels). It does not
toggle them on any issue: whether an issue clears the agent-ready bar is a
judgment call for whoever triages it (human or agent), not something CI can
infer from issue text.

Hygiene labels (`needs-rebase`, `ci-failed`, `has-feedback`,
`ready-for-human`) are owned by `.github/workflows/pr-hygiene.yml` — see
[`docs/pr-pipelines.md`](./pr-pipelines.md). `preview-blocked` is created
but never set in v1 (no preview environments).

These are intentionally the only new issue-lifecycle labels. Everything else
— issue type, priority, area, status — is a Project field or a native GitHub
field.

## Agent-deterministic query/update

Once the Project exists, an implementation agent can query and update it
without touching the UI:

```bash
# Find items in Ready for Agent, oldest first
gh project item-list <project-number> --owner singleton-sd --format json \
  | jq '[.items[] | select(.status == "Ready for Agent")] | sort_by(.content.createdAt)'

# After claiming (assigning yourself + starting a branch), move it to In Progress
gh project item-edit --project-id <project-node-id> --id <item-id> \
  --field-id <status-field-id> --single-select-option-id <in-progress-option-id>
```

Field/option node IDs come from `gh project field-list <project-number>
--owner singleton-sd --format json`. If a given environment's `gh` build
predates the `project` subcommands, the equivalent GraphQL mutation is
`updateProjectV2ItemFieldValue` against the `Status` field — see
[GitHub's Projects v2 API docs](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects).

Issue-level relationships (`Depends on` / `Blocks` / `Parent`) are read
directly from the issue body as greppable text, or via the sub-issue API
(`sub_issue_write` / `GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues`)
where a `Parent` relationship has also been recorded as a native sub-issue —
see [section 5](./github-source-of-truth.md#5-issue-dependency-semantics-and-parallel-execution)
for the authoritative semantics.

## Relationship to issue templates and PR template

- `.github/ISSUE_TEMPLATE/feature.yml`, `bug.yml`, `discovery.yml` capture
  goal/scope/acceptance criteria, an explicit `Dependencies` field for the
  `Depends on` / `Blocks` / `Parent` lines, and an agent-ready checklist that
  mirrors [section 4](./github-source-of-truth.md#4-agent-ready-definition).
- `.github/pull_request_template.md`'s `Closes #` line is what the "Pull
  request merged → Status: Done" Project automation (and native GitHub issue
  auto-closing) both key off of.
