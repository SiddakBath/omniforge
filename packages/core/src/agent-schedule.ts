import type { Agent } from './types.js';

interface TimeZoneParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidIanaTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function isValidDailyTime(dailyTime: string): boolean {
  return TIME_PATTERN.test(dailyTime);
}

export function computeNextDailyRunAt(dailyTime: string, timezone: string, fromDate = new Date()): string {
  const parsed = parseDailyTime(dailyTime);
  if (!parsed) {
    throw new Error(`Invalid daily time "${dailyTime}". Expected HH:mm.`);
  }
  if (!isValidIanaTimeZone(timezone)) {
    throw new Error(`Invalid timezone "${timezone}". Expected a valid IANA timezone.`);
  }

  const now = fromDate;
  const nowParts = getTimeZoneParts(now, timezone);

  let candidate = zonedLocalToUtc(
    nowParts.year,
    nowParts.month,
    nowParts.day,
    parsed.hour,
    parsed.minute,
    timezone,
  );

  if (candidate.getTime() <= now.getTime()) {
    const localDate = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day));
    localDate.setUTCDate(localDate.getUTCDate() + 1);
    candidate = zonedLocalToUtc(
      localDate.getUTCFullYear(),
      localDate.getUTCMonth() + 1,
      localDate.getUTCDate(),
      parsed.hour,
      parsed.minute,
      timezone,
    );
  }

  return candidate.toISOString();
}

export function setAgentDailySchedule(
  agent: Agent,
  input: {
    dailyTime: string;
    timezone: string;
    prompt?: string;
  },
  fromDate = new Date(),
): Agent {
  const nextRunAt = computeNextDailyRunAt(input.dailyTime, input.timezone, fromDate);
  const trimmedPrompt = input.prompt?.trim();

  return {
    ...agent,
    schedule: {
      enabled: true,
      dailyTime: input.dailyTime,
      timezone: input.timezone,
      ...(trimmedPrompt ? { prompt: trimmedPrompt } : {}),
      nextRunAt,
      ...(agent.schedule?.lastRunAt ? { lastRunAt: agent.schedule.lastRunAt } : {}),
    },
  };
}

export function clearAgentSchedule(agent: Agent): Agent {
  const { schedule: _removed, ...rest } = agent;
  return rest;
}

export function isAgentScheduleDue(agent: Agent, now = new Date()): boolean {
  const schedule = agent.schedule;
  if (!schedule?.enabled) {
    return false;
  }

  const nextRunAt = schedule.nextRunAt ?? computeNextDailyRunAt(schedule.dailyTime, schedule.timezone, now);
  return new Date(nextRunAt).getTime() <= now.getTime();
}

export function markAgentScheduledRunCompleted(agent: Agent, ranAt = new Date()): Agent {
  const schedule = agent.schedule;
  if (!schedule?.enabled) {
    return agent;
  }

  return {
    ...agent,
    schedule: {
      ...schedule,
      lastRunAt: ranAt.toISOString(),
      nextRunAt: computeNextDailyRunAt(schedule.dailyTime, schedule.timezone, new Date(ranAt.getTime() + 1000)),
    },
  };
}

export function deferAgentSchedule(agent: Agent, fromDate = new Date()): Agent {
  const schedule = agent.schedule;
  if (!schedule?.enabled) {
    return agent;
  }

  return {
    ...agent,
    schedule: {
      ...schedule,
      nextRunAt: computeNextDailyRunAt(schedule.dailyTime, schedule.timezone, new Date(fromDate.getTime() + 1000)),
    },
  };
}

function parseDailyTime(dailyTime: string): { hour: number; minute: number } | undefined {
  const match = TIME_PATTERN.exec(dailyTime);
  if (!match) {
    return undefined;
  }
  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
  };
}

function getTimeZoneParts(date: Date, timezone: string): TimeZoneParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function zonedLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  const offset1 = getTimeZoneOffsetMs(new Date(utcGuess), timezone);
  let timestamp = utcGuess - offset1;

  const offset2 = getTimeZoneOffsetMs(new Date(timestamp), timezone);
  if (offset1 !== offset2) {
    timestamp = utcGuess - offset2;
  }

  return new Date(timestamp);
}

function getTimeZoneOffsetMs(date: Date, timezone: string): number {
  const parts = getTimeZoneParts(date, timezone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, 0);
  return asUtc - date.getTime();
}
