# OpenForge

OpenForge is a local-first, open-source AI automation app:

> you describe it, the LLM builds it, you run it.

No YAML. No marketplace. No config sprawl.

## Built for users first

OpenForge is for people who want automation outcomes, not framework plumbing.

- Describe what you want in plain language.
- Let OpenForge generate and run the workflow.
- Keep control of your data and provider keys locally.

You can still extend it as a developer, but the product goal is simple: **non-developers can use it successfully**.

## What ships

- **End-user CLI app** (`openforge`) for onboarding, creating automations, and running agents
- **Local-first runtime** with encrypted secrets and portable state in `~/.openforge/`
- **Provider support** through [providers/catalog.json](providers/catalog.json)
- **Reusable skills** in [skills/](skills/)
- **Open-source monorepo** for transparent, community-driven development

## Quick start (recommended)

Install the CLI globally:

```bash
npm install -g @openforge/cli
```

Run onboarding:

```bash
openforge onboard
```

Create your first automation:

```bash
openforge create "Monitor my Gmail for investor replies and draft follow-ups in my tone"
```

Resume an existing agent:

```bash
openforge agents
```

Run scheduled agents continuously:

```bash
openforge scheduler
```

## Developer setup (from source)

### 1) Install dependencies

```bash
npm install
```

### 2) Build workspace

```bash
npm run build
```

### 3) First-time onboarding (CLI)

```bash
npm run dev:cli -- onboard
```

This sets your default generator provider/model and stores keys in `~/.openforge/config.json`.

### 4) Create an agent

```bash
npm run dev:cli -- create "I need an agent that monitors my Gmail for investor replies and drafts follow-ups in my voice"
```

### 5) Run local CLI

```bash
npm run dev
```

Then use the interactive CLI to continue managing agents and skills.

## Architecture overview

See [docs/architecture.md](docs/architecture.md).

At runtime, each turn follows:

```text
user message
     ↓
LLM call (system prompt + recent history + tools)
     ↓
if tool_use → execute tool → append tool_result → loop
if text     → stream to user → await next user message
```

Agents are checkpointed after complete turns and can be resumed.

## Local storage model

OpenForge writes all state to `~/.openforge/`:

- `config.json` — generator defaults and provider keys
- `params.json` — required skill params (secret values encrypted at rest)
- `skills/<skill-id>/SKILL.md` — reusable generated skill playbooks
- `agents/<agent-id>/agent.json` — persisted agent state (messages, checkpoints, status)
- `agents/<agent-id>/system-prompt.md` — agent system instruction
- `agents/<agent-id>/data/` — agent working directory for file tools

Optional per-agent daily schedule is stored in the `schedule` field inside `agent.json`.

Runtime context is bounded automatically to the most recent messages (default `60`), while always injecting `system-prompt.md` at the top for every model call. Configure with `OPENFORGE_MAX_CONTEXT_MESSAGES`.

Scheduling is timezone-aware (IANA timezone) and runs once per day at configured `HH:mm` local time.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, standards, and pull request requirements.

## Open-source project standards

- License: [LICENSE](LICENSE)
- Security policy: [SECURITY.md](SECURITY.md)
- Code of conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

## Notes

- Provider catalog includes: Anthropic, OpenAI, Gemini, DeepSeek, xAI, Groq, Mistral, OpenRouter.
- Anthropic and Gemini use native SDK paths; compatible providers use OpenAI-style API routing.
- Skills are markdown playbooks with YAML frontmatter metadata.
- Tools are runtime capabilities and are injected separately from skills.
