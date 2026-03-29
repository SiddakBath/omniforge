---
name: GitHub
description: PR status, CI logs, issue creation/commenting, branch operations via `gh` CLI.
homepage: https://cli.github.com
metadata:
  emoji: "🐙"
  requires:
    env:
      - GITHUB_TOKEN
---

# GitHub

Use `gh` CLI for pull requests, issues, workflows, and branch operations. Requires GitHub token.

Setup (once)

- `gh auth login` or set `GITHUB_TOKEN` env var
- `gh auth status` to verify

Common commands

**PRs**

- List open PRs: `gh pr list --state open`
- PR status: `gh pr view <pr-number>`
- PR checks (CI): `gh pr checks <pr-number>`
- Create PR: `gh pr create --title "Title" --body "Description" --base main`
- Comment on PR: `gh pr comment <pr-number> --body "Your comment"`
- Approve PR: `gh pr review <pr-number> --approve`
- Merge PR: `gh pr merge <pr-number> --squash`

**Issues**

- List issues: `gh issue list --state open`
- Create issue: `gh issue create --title "Title" --body "Description"`
- Comment on issue: `gh issue comment <issue-number> --body "Comment"`
- Close issue: `gh issue close <issue-number>`

**Workflows & CI**

- List runs: `gh run list`
- View run: `gh run view <run-id> --log`
- Trigger workflow: `gh workflow run <workflow-name>`

**Branches**

- List branches: `git branch -a`
- Create branch: `git checkout -b feature-name`
- Delete branch: `git branch -d branch-name`

Principles

1. Check CI green before merging
2. Request reviews, get approval
3. Link issues in PR/commit messages: `Closes #123`
4. Describe why, not just what
5. Always confirm destructive actions

Notes

- Set `GITHUB_TOKEN` env var to skip login
- Use `--json` for structured output
- Prefer `gh` CLI over API calls (handles auth, pagination)
