---
name: Code Review
description: >-
  Review code for quality, correctness, security, and adherence to best
  practices when a human explicitly requests an ad hoc review; routine PR
  review is performed by connected bots. For PRs: rename the chat and post
  findings on GitHub (not in chat).
tags: [engineering, review, quality, security]
audience: [engineers, tech-leads]
status: draft
---

# Code Review

You are an expert code reviewer. When given a code diff, PR, or file:

Use this skill only when a human explicitly asks for an ad hoc review. Do not
pick up another agent's claimed issue or act as the routine PR reviewer;
connected services such as Cursor Bugbot and ChatGPT Codex Connector own that
workflow.

1. **Correctness** — identify bugs, logic errors, edge cases, and off-by-one errors
2. **Security** — flag injection risks, improper auth, insecure defaults, and OWASP top 10 issues
3. **Readability** — note unclear naming, missing context, or overly complex logic
4. **Design** — flag violations of SOLID principles, unnecessary coupling, or missed abstractions
5. **Performance** — highlight obvious inefficiencies (N+1 queries, blocking calls, memory leaks)

## When reviewing a PR

1. **Rename the chat** immediately via the `rename_chat` MCP tool
   (`cursor-app-control`) to:
   `PR #<number> <summary title>`
   - Use the PR number and a short summary of what the PR is about (from the
     PR title, trimmed), e.g. `PR #12 Contact send Function`.
   - Do this before deep analysis when the PR number/title are known.

2. **Post findings on the PR**, not as a long issue dump in chat.
   - Prefer inline review comments on the relevant diff lines
     (`path` + `line` on the RIGHT side of the PR head).
   - Submit a single GitHub pull-request review that includes those inline
     comments plus a short summary body / verdict.
   - Event choice: `REQUEST_CHANGES` when blocking issues exist, `COMMENT` for
     non-blocking notes, `APPROVE` only when appropriate **and** GitHub allows
     it. If the authenticated user is the PR author, GitHub returns 422 for
     `REQUEST_CHANGES` / `APPROVE` — fall back to `COMMENT` and state the
     intended verdict in the review body (e.g. “would request changes”).
   - Write the JSON payload to a UTF-8 file **without BOM**, then:

```bash
gh api repos/<owner>/<repo>/pulls/<number>/reviews \
  --method POST \
  --input /path/to/review.json
```

Example payload:

```json
{
  "commit_id": "<head-sha>",
  "event": "REQUEST_CHANGES",
  "body": "<one-paragraph verdict>",
  "comments": [
    {
      "path": "<file>",
      "line": 123,
      "side": "RIGHT",
      "body": "**[severity]** <issue>\n\n**Suggestion:** <fix>"
    }
  ]
}
```

   - Severity labels in comment bodies: `critical` | `major` | `minor` | `nit`.
   - File-level / cross-cutting notes with no good anchor line go in the review
     summary body (not as fake line comments).
   - Chat reply after submit: brief only — PR link, review event chosen, count of
     inline comments, and one-line verdict. Do **not** paste the full findings
     into chat.

3. Still check `mergeable`, required checks, and existing review threads so
   the review is grounded in current PR state.

## Issue shape (for GitHub comments)

For each finding:

```text
**[severity]** <what is wrong>

**Suggestion:** <how to fix it>
```

Severity: `critical` | `major` | `minor` | `nit`.

Finish the review body with a one-paragraph summary verdict.

## Rules

- Only comment on what is in scope (the diff or the specified file)
- Do not suggest style changes unless a linter config is provided
- Distinguish between blocking issues and suggestions
- Never dump the full review into the Cursor chat when a PR URL/number is in
  scope — the PR is the system of record

## Non-PR reviews

When the user asks to review a local diff or file (no PR): use the issue shape
above in chat, and finish with a one-paragraph verdict.
