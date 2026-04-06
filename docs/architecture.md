# OpenForge architecture

## Core responsibilities

### `packages/core`

- **Provider abstraction** via `LLMClient.complete(messages, tools, stream)`
- **Runtime loop** for tool-use turn execution
- **Built-in tool capability layer** (file IO, terminal commands, HTTP, web search)
- **Generator pipeline**
  1. Skill audit
  2. Skill markdown generation (workflow guides)
  3. Required parameter enforcement
  4. Agent assembly
- **Storage layer** for config, params, skills, and agents

### `packages/cli`

- Onboarding wizard
- Agent creation flow
- Agent resume flow
- Skill and settings views

## Agent lifecycle

1. User describes requested automation.
2. Generator chooses existing/new skills (workflow guides).
3. Missing required params are blocked until filled.
4. Agent system prompt is assembled with tools and skills injected separately.
5. Agent state and prompt are persisted in the agent folder.
6. Agent runtime executes loop with tool calls.
7. Checkpoint written at end of each completed turn.

## Persistence model (`~/.openforge`)

- `config.json`
- `params.json`
- `skills/<skill-id>/SKILL.md`
- `agents/<agent-id>/agent.json`
- `agents/<agent-id>/system-prompt.md`
- `agents/<agent-id>/data/`

## Context management

- Runtime sends only the most recent non-system messages (bounded context window).
- The system prompt is always injected as the first message from `system-prompt.md`.
- Max message count is configurable via `OPENFORGE_MAX_CONTEXT_MESSAGES` (default `60`).

## Scheduling

- Agents can define an optional daily schedule (`HH:mm` + IANA timezone + optional prompt).
- A long-running CLI scheduler (`openforge scheduler`) polls due agents and executes one turn.
- Schedule metadata is stored in `agents/<agent-id>/agent.json` and updated after each run:
  - `nextRunAt` (UTC)
  - `lastRunAt` (UTC)

## Design constraints

- Local-first only (`~/.openforge/`)
- No external OpenForge backend
- Strict TypeScript interfaces exported from core
- Provider/model selection remains user-controlled
