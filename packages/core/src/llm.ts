import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import type { LLMClient, LLMResponse, LLMStreamEvent, Message, ToolCall, ToolDefinition } from './types.js';
import type { ProviderCatalogEntry } from './types.js';

type OpenAICompatible = OpenAI;

function toOpenAIMessages(messages: Message[]): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: message.toolCallId ?? '',
        content: message.content,
      };
    }
    return {
      role: message.role as 'system' | 'user' | 'assistant',
      content: message.content,
    };
  });
}

function toOpenAITools(tools: ToolDefinition[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export class OpenAICompatibleClient implements LLMClient {
  private readonly client: OpenAICompatible;
  private readonly model: string;

  constructor(provider: ProviderCatalogEntry, apiKey: string, model: string) {
    this.model = model;
    this.client = new OpenAI({ apiKey, baseURL: provider.baseUrl });
  }

  async complete(messages: Message[], tools: ToolDefinition[], stream = false): Promise<LLMResponse | AsyncIterable<LLMStreamEvent>> {
    if (!stream) {
      const openAIMessages = toOpenAIMessages(messages);
      const openAITools = toOpenAITools(tools);
      
      const requestBody: Parameters<typeof this.client.chat.completions.create>[0] = {
        model: this.model,
        messages: openAIMessages,
      };
      
      if (openAITools.length > 0) {
        requestBody.tools = openAITools;
      }
      
      const response = await this.client.chat.completions.create({
        ...requestBody,
        stream: false,
      });

      const choice = response.choices[0]?.message;
      const toolCalls: ToolCall[] = (choice?.tool_calls ?? []).reduce<ToolCall[]>((acc: ToolCall[], call) => {
        if (call.type === 'function') {
          acc.push({
            id: call.id,
            name: call.function.name,
            input: JSON.parse(call.function.arguments || '{}') as Record<string, unknown>,
          });
        }
        return acc;
      }, []);

      return {
        text: choice?.content ?? '',
        toolCalls,
      };
    }

    const streamResult = await this.client.chat.completions.create({
      model: this.model,
      messages: toOpenAIMessages(messages),
      ...(tools.length > 0 && { tools: toOpenAITools(tools) }),
      stream: true,
    });

    return this.streamOpenAI(streamResult);
  }

  private async *streamOpenAI(streamResult: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>): AsyncIterable<LLMStreamEvent> {
    for await (const chunk of streamResult) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        yield { type: 'text-delta', text: delta.content };
      }
    }
    yield { type: 'done' };
  }
}

export class AnthropicClient implements LLMClient {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.model = model;
    this.client = new Anthropic({ apiKey });
  }

  async complete(messages: Message[], tools: ToolDefinition[]): Promise<LLMResponse> {
    const systemBlocks = messages.filter((m) => m.role === 'system').map((m) => m.content);
    const conversational: Anthropic.Messages.MessageParam[] = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      }));

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: systemBlocks.join('\n\n'),
      messages: conversational,
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters as Anthropic.Messages.Tool.InputSchema,
      })),
    });

    const contentBlocks = response.content as Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: unknown;
    }>;

    const text = contentBlocks.reduce((acc: string, block) => {
      if (block.type === 'text') {
        return acc + (block.text ?? '');
      }
      return acc;
    }, '');

    const toolCalls: ToolCall[] = contentBlocks.reduce<ToolCall[]>((acc, block) => {
      if (block.type === 'tool_use') {
        acc.push({
          id: block.id ?? '',
          name: block.name ?? '',
          input: (block.input ?? {}) as Record<string, unknown>,
        });
      }
      return acc;
    }, []);

    return { text, toolCalls };
  }
}

export class GeminiClient implements LLMClient {
  private readonly client: GoogleGenAI;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.model = model;
    this.client = new GoogleGenAI({ apiKey });
  }

  async complete(messages: Message[], tools: ToolDefinition[]): Promise<LLMResponse> {
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: messages.map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      })),
      config: {
        tools: tools.map((tool) => ({
          functionDeclarations: [
            {
              name: tool.name,
              description: tool.description,
              parametersJsonSchema: tool.parameters,
            },
          ],
        })),
      },
    });

    const text = response.text ?? '';
    const toolCalls: ToolCall[] = [];

    return { text, toolCalls };
  }
}

export function assertNonStreamingResponse(response: LLMResponse | AsyncIterable<LLMStreamEvent>): LLMResponse {
  if (Symbol.asyncIterator in (response as object)) {
    throw new Error('Expected non-streaming response.');
  }
  return response as LLMResponse;
}
