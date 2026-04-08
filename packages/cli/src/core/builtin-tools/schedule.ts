import { computeNextDailyRunAt, isValidDailyTime, isValidIanaTimeZone } from '../agent-schedule.js';
import {
  cancelScheduledTask,
  createScheduledTask,
  listScheduledTasks,
  type ScheduledTaskAction,
  type ScheduledTaskRecurrence,
} from '../scheduled-tasks.js';
import { getSchedulerServiceStatus, installSchedulerService } from '../scheduler-service.js';
import type { BuiltinToolSpec } from './types.js';

function normalizeIsoTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString();
}

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export const scheduleTool: BuiltinToolSpec = {
  definition: {
    category: 'builtin',
    name: 'schedule',
    description:
      'Create/list/cancel scheduled tasks. Supports recurring daily tasks and one-time tasks for agent runs or built-in tool calls.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'list', 'cancel'],
          default: 'list',
        },
        task_id: { type: 'string' },
        limit: { type: 'number', default: 25 },
        label: { type: 'string' },
        repeat: { type: 'string', enum: ['once', 'daily'], default: 'once' },
        run_at: { type: 'string', description: 'ISO timestamp for one-time tasks.' },
        daily_time: { type: 'string', description: 'HH:mm for daily tasks.' },
        timezone: { type: 'string', description: 'IANA timezone for daily tasks.' },
        payload_kind: { type: 'string', enum: ['builtin_tool', 'agent_run'] },
        tool_name: { type: 'string' },
        tool_input: { type: 'object' },
        target_agent_id: {
          type: 'string',
          description: 'Agent id for agent_run payload. Use "self" to target the current agent.',
        },
        prompt: { type: 'string' },
      },
      required: ['action'],
    },
  },
  aliases: ['schedule_task', 'schedule-task', 'scheduler_task'],
  execute: async (call, context) => {
    const action = String(call.input.action ?? 'list').trim().toLowerCase();

    if (action === 'list') {
      const limitRaw = Number(call.input.limit ?? 25);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 25;
      const tasks = await listScheduledTasks();
      return {
        ok: true,
        output: JSON.stringify(
          {
            count: tasks.length,
            tasks: tasks.slice(0, limit),
          },
          null,
          2,
        ),
      };
    }

    if (action === 'cancel') {
      const taskId = String(call.input.task_id ?? '').trim();
      if (!taskId) {
        return { ok: false, output: 'task_id is required for action=cancel' };
      }

      const canceled = await cancelScheduledTask(taskId);
      if (!canceled) {
        return { ok: false, output: `Scheduled task not found: ${taskId}` };
      }

      return {
        ok: true,
        output: JSON.stringify(
          {
            canceled: true,
            task: canceled,
          },
          null,
          2,
        ),
      };
    }

    if (action !== 'create') {
      return { ok: false, output: `Unsupported action: ${action}. Use create, list, or cancel.` };
    }

    const label = String(call.input.label ?? '').trim() || 'Scheduled task';
    const repeat = String(call.input.repeat ?? 'once').trim().toLowerCase();

    let recurrence: ScheduledTaskRecurrence;
    let firstRunAt: string;

    if (repeat === 'daily') {
      const dailyTime = String(call.input.daily_time ?? '').trim();
      const timezone = String(call.input.timezone ?? '').trim() || 'UTC';
      if (!isValidDailyTime(dailyTime)) {
        return { ok: false, output: 'daily_time is required for repeat=daily and must be HH:mm.' };
      }
      if (!isValidIanaTimeZone(timezone)) {
        return { ok: false, output: 'timezone is invalid. Use a valid IANA timezone, e.g. America/New_York.' };
      }

      recurrence = {
        type: 'daily',
        dailyTime,
        timezone,
      };
      firstRunAt = computeNextDailyRunAt(dailyTime, timezone);
    } else {
      const runAt = normalizeIsoTimestamp(call.input.run_at);
      if (!runAt) {
        return { ok: false, output: 'run_at is required for repeat=once and must be a valid ISO timestamp.' };
      }
      recurrence = { type: 'once' };
      firstRunAt = runAt;
    }

    const payloadKind = String(call.input.payload_kind ?? '').trim().toLowerCase();
    let taskAction: ScheduledTaskAction;

    if (payloadKind === 'agent_run') {
      const rawTarget = String(call.input.target_agent_id ?? '').trim();
      const targetAgentId = rawTarget === 'self' || rawTarget.length === 0 ? context.currentAgentId : rawTarget;
      if (!targetAgentId) {
        return {
          ok: false,
          output: 'target_agent_id is required for payload_kind=agent_run when no current agent context exists.',
        };
      }

      const prompt = String(call.input.prompt ?? '').trim();
      taskAction = {
        kind: 'agent_run',
        agentId: targetAgentId,
        ...(prompt ? { prompt } : {}),
      };
    } else if (payloadKind === 'builtin_tool') {
      const toolName = String(call.input.tool_name ?? '').trim();
      if (!toolName) {
        return { ok: false, output: 'tool_name is required for payload_kind=builtin_tool.' };
      }

      taskAction = {
        kind: 'builtin_tool',
        toolName,
        toolInput: toObject(call.input.tool_input),
        workspaceRoot: context.workspaceRoot,
        context: {
          ...(context.provider ? { provider: context.provider } : {}),
          ...(context.model ? { model: context.model } : {}),
          ...(context.currentAgentId ? { currentAgentId: context.currentAgentId } : {}),
        },
      };
    } else {
      return {
        ok: false,
        output: 'payload_kind is required and must be one of: builtin_tool, agent_run.',
      };
    }

    const task = await createScheduledTask({
      label,
      ...(context.currentAgentId ? { createdByAgentId: context.currentAgentId } : {}),
      recurrence,
      firstRunAt,
      action: taskAction,
    });

    let autoStartNote = 'Automatic scheduler startup is already configured.';
    try {
      const service = await getSchedulerServiceStatus();
      if (!service.installed) {
        await installSchedulerService();
        autoStartNote = 'Automatic scheduler startup was enabled for this user.';
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      autoStartNote = `Could not verify automatic startup: ${message}`;
    }

    return {
      ok: true,
      output: JSON.stringify(
        {
          scheduled: true,
          task,
          autoStart: autoStartNote,
        },
        null,
        2,
      ),
    };
  },
};
