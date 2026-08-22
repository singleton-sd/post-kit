---
name: Task-Driven Development
description: Work through GitHub issues one at a time with dependency checks, scoped staging, and review-ready commit messages. Use when the user asks to work on issues from GitHub, a todo list, backlog folder, or workflow document.
tags: [operations, tasks, workflow, github, git]
audience: [engineers, tech-leads, all]
status: stable
---

# Task-Driven Development

Use this skill when implementing work from GitHub Issues or a workflow document. Follow
[`docs/github-source-of-truth.md`](../../../docs/github-source-of-truth.md) — the authoritative
policy for how engineering work is identified, sequenced, and executed. This skill applies that
policy to the per-issue implementation loop; it does not restate the policy.

## Issue and chat titles

- When talking about issues (chat, plans, PR/issue comments, summaries), use the **issue title**, not the raw issue number, as the primary label.
- Numbers are fine in URLs, branch names (`<type>/<issue-number>-<kebab-title>`), and as a secondary reference after the title.
- When picking up an issue, set the Cursor **chat title** to that issue's title.

## Out of scope → follow-up issues

When planning an issue, every **Out of scope** item that is real follow-up work must have a GitHub issue. Emit a **Pending / out-of-scope backlog** table (Title, Depends on, Notes), then file each missing row:

1. Search existing issues by title/intent first (`gh issue list --search "<keywords>"`) — do not invent duplicates.
2. Create missing issues with acceptance criteria: `gh issue create --title "..." --body "..."`.
3. Wire dependency by adding a `Depends on: #<parent>` (and, on the parent, `Blocks: #<new>`) line to the issue body — see `docs/github-source-of-truth.md` section 5.
4. Leave new backlog issues **unassigned**; filing an issue does not claim it.
5. Mention new issue numbers on the parent issue/PR description (a comment is fine, but prefer linking rather than a comment dump).

## Core rules

1. Gather context first:
   - Read the workflow or reference document.
   - List the relevant issues and their state (open/closed, labels, `Depends on`).
   - Read the selected issue's full body and comments before editing files.
   - Inspect repo conventions and existing implementation patterns.
   - Create the issue worktree with `pnpm worktree:add` (see `AGENTS.md`).

2. Work one issue at a time:
   - Keep each implementation scoped to one issue.
   - Do not mix files for different issues in the same staged set.
   - Do not start the next issue until the current one is staged and summarized.

3. Readiness and claiming:
   - An issue is **agent-ready** only when it meets `docs/github-source-of-truth.md` section 4 (clear
     goal, scope, testable acceptance criteria, stated constraints, and — critically — **no
     unresolved `Depends on`**, section 5). Verify readiness from the issue body alone; do not guess.
   - **Claim before plan/implement** (including Plan mode when asked to pick up an issue):
     1. `gh issue view <n> --json state,body,labels` — confirm it is open, agent-ready,
        and has no unresolved `Depends on`.
     2. Check no open PR already declares `Closes #<n>` (`gh pr list --search "linked:<n>"` or
        `gh pr list --search "in:body #<n>"`). If one exists, do not start a second PR.
     3. Create the branch/worktree from `origin/main` and open a PR for it as soon as practical.
   - There is no separate claim token, assignment, or "in progress" status field to set. The
     branch/worktree plus the linked open PR is the claim. If work is abandoned, close the PR
     (or leave an issue comment) so the issue reads as available again.
   - **Handoff:** open (or update) the PR with `Closes #<n>` in the body. That is the entire
     handoff — merging the PR closes the issue automatically. There is no separate status
     transition, label pipeline, or `pr:gate` step.
   - **Automated review:** connected GitHub bots review the PR once it's open. Agents must not
     pick up another agent's open PR to review it. Agents may address bot or human feedback on
     their own PR directly (fetch comments, fix or reply in-thread, push).
   - **Steward:** when asked to check open PRs, re-poll mergeable state / required CI / new
     comments for each. Push a fix or reply directly on the PR when actionable.
   - **Dirty PR:** follow `AGENTS.md`'s "Shared hub files / conflict playbook" section. Prefer
     `git merge origin/main`. Do not hand-merge `pnpm-lock.yaml` — take main's lockfile then
     `pnpm install`.
   - **Hub ownership:** do not edit `.cursor/skills/**`, root `package.json`,
     `AGENTS.md` / `SETUP.md` / `docs/pr-pipelines.md`, or workflows unless the issue requires it.
   - When the implementation is finished, do **not** close the issue yourself. Opening the PR
     with `Closes #<n>` and letting a human merge is what closes it.
   - If an issue is a duplicate or already delivered by another issue, say so in a comment and
     link the delivering issue/PR; let a human close it (or close it with `state_reason:
     "not_planned"` only when the user explicitly asks you to).

4. Staging and commits:
   - Stage only files changed for the current issue.
   - Do not commit unless the user explicitly asks.
   - Provide a review-ready commit message after staging.
   - Use one issue per commit message.
   - Format/lint gate is **staged files only**: rely on the husky pre-commit hook
     (`lint-staged`), or run `pnpm lint:staged` manually before commit. Do not default to
     full-repo `pnpm format:check` / `pnpm lint` as the agent gate, and never bypass hooks with
     `--no-verify` for format/lint.

5. Human test plan:
   - Every PR must include a **Test plan** written for a human, not just a list of automated
     commands.
   - Explain what changed, where the new or changed behavior can be found, any setup or test
     data required, numbered steps to exercise it, and the expected result for each step.
   - Include the exact page, route, API endpoint, package API, or workflow to inspect when
     available.
   - Add a **Feedback focus** section that tells the human where comments are most useful. State
     explicitly when a change has no user-facing behavior.

6. Commit type selection:
   - Use `feat` for new user-facing behavior, scripts, workflows, or capabilities.
   - Use `fix` for bug fixes.
   - Use `chore` for maintenance, scaffolding, config-only setup, or repository housekeeping.
   - Use `docs` for documentation-only changes.
   - Follow the repository's commit message format and length rules (`git-conventions`).

7. Requirement drift and inconsistencies:
   - If issue text conflicts with user clarification, repo conventions, or existing config names,
     ask the user before expanding scope.
   - Do not implement future-issue behavior just because an issue example implies it. Keep the
     current issue scoped to the clarified work.
   - When the clarified scope differs from the GitHub issue, update the issue body/comment to
     reflect the actual work before final handoff.
   - Call out known mismatches, such as example path names that do not exist in config, in the
     final summary or as a question for the user.

## End-of-task response

When an issue is implemented and staged, report:

```text
Implementation staged for #<issue-number>: [issue title]

Staged files:
- path/to/file
- path/to/other-file

Verified:
- command that passed

Human test plan:
1. Where to find the change and what to do
   Expected: observable result

Feedback focus:
- area where human comments are most useful

Proposed commit message:
type: #<issue-number> Summary

Status:
PR is open with `Closes #<issue-number>`; ready for review.
```

Only say the issue is complete when the PR has actually merged (which closes it).

## Moving to the next task

When the user says "next", "next task", or similar:

1. If the previous issue's PR is open and ready, leave it open — do not close it yourself.
2. Verify the next issue is agent-ready and has no unresolved `Depends on` (sections 4-5).
3. Confirm no existing open PR owns it, then create its worktree from `origin/main` and open a
   linked PR as soon as practical.
4. Only after a successful claim, read details, implement, verify, and stage.
5. Leave the issue's PR open until the user asks to merge or move on again.
