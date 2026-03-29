# OpenForge

OpenForge is a local-first, open-source agentic framework:

> you describe it, the LLM builds it, you run it.

No YAML. No marketplace. No config sprawl.

## What ships

- **Monorepo** with TypeScript packages:
  - `@openforge/core` — runtime engine, storage, provider abstraction, generator pipeline
  - `@openforge/cli` — interactive terminal experience (onboarding, create, sessions, skills, settings)
  - `@openforge/web` — local Next.js UI with the same core flows
- **Provider catalog** in [providers/catalog.json](providers/catalog.json)
- **Built-in tools (capabilities)** in core runtime
- **Skills** as markdown workflow guides in [skills/](skills/)
- **Portable local state** in `~/.openforge/`

## Quick install

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

### 5) Run local web UI

```bash
npm run dev
```

Then open http://localhost:3000.

## Architecture overview

See [docs/architecture.md](docs/architecture.md).

At runtime, each turn follows:

```text
user message
     ↓
LLM call (system prompt + history + tools)
     ↓
if tool_use → execute tool → append tool_result → loop
if text     → stream to user → await next user message
```

Sessions are checkpointed after complete turns and can be resumed.

## Local storage model

OpenForge writes all state to `~/.openforge/`:

- `config.json` — generator defaults and provider keys
- `params.json` — required skill params (secret values encrypted at rest)
- `skills/<skill-id>/SKILL.md` — reusable generated skill playbooks
- `sessions/*.json` — agent sessions with full history and checkpoints

## Contributing

1. Fork and clone.
2. `npm install`
3. `npm run typecheck`
4. Make focused changes with tests/examples.
5. Open a PR with:
   - motivation
   - architecture impact
   - before/after behavior

## Notes

- Provider catalog includes: Anthropic, OpenAI, Gemini, DeepSeek, xAI, Groq, Mistral, OpenRouter.
- Anthropic and Gemini use native SDK paths; compatible providers use OpenAI-style API routing.
- Skills are markdown playbooks with YAML frontmatter metadata.
- Tools are runtime capabilities and are injected separately from skills.
