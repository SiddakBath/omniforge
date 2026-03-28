# OpenForge architecture

## Core responsibilities

### `packages/core`

- **Provider abstraction** via `LLMClient.complete(messages, tools, stream)`
- **Runtime loop** for tool-use turn execution
- **Generator pipeline**
  1. Skill audit
  2. Skill creation
  3. Required parameter enforcement
  4. Agent session assembly
- **Storage layer** for config, params, skills, and sessions

### `packages/cli`

- Onboarding wizard
- Agent creation flow
- Session resume flow
- Skill and settings views

### `packages/web`

- Local Next.js app mirroring CLI capabilities
- API routes calling core services directly
- Dark minimal UX with session sidebar flow

## Session lifecycle

1. User describes requested automation.
2. Generator chooses existing/new skills.
3. Missing required params are blocked until filled.
4. Session is assembled and persisted.
5. Agent runtime executes loop with tool calls.
6. Checkpoint written at end of each completed turn.

## Design constraints

- Local-first only (`~/.openforge/`)
- No external OpenForge backend
- Strict TypeScript interfaces exported from core
- Provider/model selection remains user-controlled
