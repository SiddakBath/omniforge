# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com), and this project adheres to [Semantic Versioning](https://semver.org).

## [0.1.0] - 2026-04-09

### Added
- Local-first, open-source AI automation app with LLM-powered agent generation.
- End-user CLI (`omniforge`) for onboarding, creating agents, and managing automations.
- Local-first runtime with encrypted secrets and portable state in `~/.omniforge/`.
- Provider support through [providers/catalog.json](providers/catalog.json): Anthropic, OpenAI, Gemini, Ollama, DeepSeek, xAI, Groq, Mistral, OpenRouter.
- Reusable skills framework in [skills/](skills/) with markdown playbooks and YAML frontmatter.
- Agent scheduling with timezone-aware daily execution (optional).
- Cross-platform scheduler auto-start management (`omniforge scheduler-service install|status|uninstall`).
- Built-in tools: file I/O, web search, HTTP requests, terminal execution, patch application.
- Bounded context history (default 60 messages, configurable via `OMNIFORGE_MAX_CONTEXT_MESSAGES`).
- Agent state persistence with checkpointing under `~/.omniforge/agents/<agent-id>/`.
- Open-source governance: `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`.
- CI/CD workflows: build, lint, typecheck on PR; automated release to GitHub and npm on version tags.
- Dependabot configuration for weekly npm dependency updates.

### Security
- Zero vulnerabilities verified with `npm audit --omit=dev`.
- Secrets encrypted at rest in `~/.omniforge/params.json`.
- Local-first data model keeps user data and provider keys off remote servers.
