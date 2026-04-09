# OmniForge

OmniForge is a local-first, open-source AI automation app:

> you describe it, the LLM builds it, you run it.

No YAML. No marketplace. No config sprawl.

## Built for users first

OmniForge is for people who want automation outcomes, not framework plumbing.

- Describe what you want in plain language.
- Let OmniForge generate and run the workflow.
- Keep control of your data and provider keys locally.

## What ships

- **End-user CLI app** (`omniforge`) for onboarding, creating automations, and running agents
- **Local-first runtime** with encrypted secrets and portable state in `~/.omniforge/`
- **Provider support** through [providers/catalog.json](providers/catalog.json)
- **Reusable skills** in [skills/](skills/)
- **Open-source monorepo** for transparent, community-driven development

## Quick start (recommended)

Install the CLI globally:

```bash
npm install -g omniforge
```

Run onboarding:

```bash
omniforge onboard
```

Update configuration later (provider/model + web search):

```bash
omniforge config
```

Create your first automation:

```bash
omniforge create "Monitor my Gmail for investor replies and draft follow-ups in my tone"
```

Resume an existing agent:

```bash
omniforge agents
```

## Run from source (development)

```bash
git clone https://github.com/siddakBath/omniforge.git
cd omniforge
npm install
npm run build
```

First-time onboarding:

```bash
npm run dev:cli -- onboard
```

Create and manage agents:

```bash
npm run dev:cli -- create "Your automation description"
npm run dev:cli -- agents
```

Optional: configure scheduler startup from source:

```bash
npm run dev:cli -- scheduler-service install
```

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

OmniForge writes all state to `~/.omniforge/`:

- `config.json` — generator defaults and provider keys
- `config.json` — generator defaults, provider keys, and web search settings
- `params.json` — required skill params (secret values encrypted at rest)
- `skills/<skill-id>/SKILL.md` — reusable generated skill playbooks
- `agents/<agent-id>/agent.json` — persisted agent state (messages, checkpoints, status)
- `agents/<agent-id>/system-prompt.md` — agent system instruction
- `agents/<agent-id>/data/` — agent working directory for file tools

Optional per-agent daily schedule is stored in the `schedule` field inside `agent.json`.

Runtime context is bounded automatically to the most recent messages (default `60`), while always injecting `system-prompt.md` at the top for every model call. Configure with `OMNIFORGE_MAX_CONTEXT_MESSAGES`.

Scheduling is timezone-aware (IANA timezone) and runs once per day at configured `HH:mm` local time.
The scheduler dynamically reloads schedule changes and runs catch-up jobs missed during downtime.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, standards, and pull request requirements.

## Open-source project standards

- License: [LICENSE](LICENSE)
- Security policy: [SECURITY.md](SECURITY.md)
- Code of conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

## Notes

- Provider catalog includes: Anthropic, OpenAI, Gemini, Ollama (local), DeepSeek, xAI, Groq, Mistral, OpenRouter.
- Anthropic and Gemini use native SDK paths; compatible providers use OpenAI-style API routing.
- Skills are markdown playbooks with YAML frontmatter metadata.
- Tools are runtime capabilities and are injected separately from skills.
