export type Role = 'system' | 'user' | 'assistant' | 'tool';

/** Canonical chat message persisted inside a session. */
export interface Message {
  id: string;
  role: Role;
  content: string;
  toolCallId?: string;
  name?: string;
  createdAt: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  category?: 'builtin';
}

/** Tool invocation emitted by the model runtime. */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Parameter that must be satisfied before an agent can run. */
export interface RequiredParam {
  key: string;
  label: string;
  description: string;
  secret: boolean;
}

/** Reusable skill playbook persisted to ~/.openforge/skills. */
export interface Skill {
  id: string;
  name: string;
  description: string;
  homepage?: string;
  metadata?: Record<string, unknown>;
  content: string;
  requiredParams: RequiredParam[];
  requiredBins: string[];
  createdAt: string;
}

export interface SkillBundle {
  skill: Skill;
  markdown?: string;
}

/** Restorable checkpoint captured after each complete turn. */
export interface Checkpoint {
  id: string;
  messageCount: number;
  createdAt: string;
  status: AgentSession['status'];
}

/** Full persisted agent session record. */
export interface AgentSession {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  skills: string[];
  provider: string;
  model: string;
  status: 'ready' | 'running' | 'paused' | 'complete' | 'error';
  messages: Message[];
  checkpoints: Checkpoint[];
  createdAt: string;
  updatedAt: string;
}

export interface ProviderModel {
  id: string;
  contextWindow: number;
  tags: string[];
}

export interface ProviderCatalogEntry {
  id: string;
  name: string;
  baseUrl: string;
  apiKeyEnv: string;
  authHeader: string;
  sdk: 'native' | 'openai-compatible';
  models: ProviderModel[];
}

export interface OpenForgeConfig {
  generator: {
    provider: string;
    model: string;
  };
  providers: Record<string, { apiKey: string }>;
}

export interface ParamsStore {
  values: Record<string, string>;
  secrets: Record<string, string>;
}

export interface LLMStreamEvent {
  type: 'text-delta' | 'tool-call' | 'done';
  text?: string;
  toolCall?: ToolCall;
}

export interface LLMResponse {
  text: string;
  toolCalls: ToolCall[];
}

export interface LLMClient {
  /**
   * Provider-agnostic completion call.
   * @param messages Full conversation history.
   * @param tools Tool schemas available for this turn.
   * @param stream Whether token/tool events should stream.
   */
  complete(messages: Message[], tools: ToolDefinition[], stream?: boolean): Promise<LLMResponse | AsyncIterable<LLMStreamEvent>>;
}

export interface ToolExecutionResult {
  ok: boolean;
  output: string;
}

export interface ToolExecutor {
  execute(call: ToolCall): Promise<ToolExecutionResult>;
}

export interface GenerationContext {
  request: string;
  availableSkills: Skill[];
}

export interface SkillAuditResult {
  useSkillIds: string[];
  createSkills: Array<Pick<Skill, 'name' | 'description'>>;
}
