# Contributing to OmniForge

Thanks for contributing to OmniForge.

## Development setup

1. Fork and clone the repository.
2. Install dependencies:
   - `npm install`
3. Validate workspace health:
   - `npm run check`
4. Run the CLI in development mode:
   - `npm run dev:cli -- --help`

## Pull request checklist

Before opening a PR, ensure all of the following are true:

- `npm run build` passes.
- `npm run lint` passes.
- `npm run typecheck` passes.
- You updated docs when behavior changed.
- You included tests when practical.
- You kept changes focused and backwards compatible where possible.

## Commit and PR guidance

- Use clear, imperative commit messages.
- Keep PRs small and reviewable.
- Explain motivation, design decisions, and risks.
- Link related issues in the PR description.

## Reporting issues

When filing bugs, include:

- Expected behavior
- Actual behavior
- Reproduction steps
- Operating system and Node.js version
- Relevant logs (with secrets redacted)

## Security issues

Do not open public issues for vulnerabilities.

Please report via the process in [SECURITY.md](SECURITY.md).
