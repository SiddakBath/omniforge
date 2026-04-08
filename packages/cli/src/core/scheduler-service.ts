import { mkdir, rm, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { OMNIFORGE_HOME } from './paths.js';

export type SchedulerServicePlatform = 'windows' | 'macos' | 'linux';

export interface SchedulerServiceStatus {
  platform: SchedulerServicePlatform;
  installed: boolean;
  running: boolean;
  autoStart: boolean;
  details: string;
}

const WINDOWS_TASK_NAME = 'OmniForge Scheduler';
const MACOS_LABEL = 'com.omniforge.scheduler';
const LINUX_SERVICE_NAME = 'omniforge-scheduler.service';

interface CommandResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

interface SchedulerLaunchCommand {
  command: string;
  args: string[];
}

export async function getSchedulerServiceStatus(): Promise<SchedulerServiceStatus> {
  const platform = detectPlatform();
  if (platform === 'windows') {
    return getWindowsStatus();
  }
  if (platform === 'macos') {
    return getMacOsStatus();
  }
  return getLinuxStatus();
}

export async function installSchedulerService(): Promise<void> {
  const launch = getSchedulerLaunchCommand();
  const platform = detectPlatform();

  if (platform === 'windows') {
    await installWindowsService(launch);
    return;
  }

  if (platform === 'macos') {
    await installMacOsService(launch);
    return;
  }

  await installLinuxService(launch);
}

export async function uninstallSchedulerService(): Promise<void> {
  const platform = detectPlatform();

  if (platform === 'windows') {
    await uninstallWindowsService();
    return;
  }

  if (platform === 'macos') {
    await uninstallMacOsService();
    return;
  }

  await uninstallLinuxService();
}

function detectPlatform(): SchedulerServicePlatform {
  switch (process.platform) {
    case 'win32':
      return 'windows';
    case 'darwin':
      return 'macos';
    case 'linux':
      return 'linux';
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

function getSchedulerLaunchCommand(): SchedulerLaunchCommand {
  const entry = resolveCliEntryPath();

  return {
    command: process.execPath,
    args: [entry, 'scheduler'],
  };
}

function resolveCliEntryPath(): string {
  const argEntry = process.argv[1];
  if (argEntry && existsSync(argEntry)) {
    return argEntry;
  }

  const currentModuleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidateFromSource = path.resolve(currentModuleDir, '..', 'index.ts');
  if (existsSync(candidateFromSource)) {
    return candidateFromSource;
  }

  const candidateFromDist = path.resolve(currentModuleDir, '..', 'index.js');
  if (existsSync(candidateFromDist)) {
    return candidateFromDist;
  }

  throw new Error('Unable to resolve OmniForge CLI entrypoint for service installation.');
}

async function getWindowsStatus(): Promise<SchedulerServiceStatus> {
  const startupScriptPath = getWindowsStartupScriptPath();

  const query = await runCommand('schtasks', ['/Query', '/TN', WINDOWS_TASK_NAME, '/FO', 'LIST', '/V']);
  if (query.ok) {
    const statusMatch = /Status:\s*(.+)/i.exec(query.stdout);
    const statusText = statusMatch?.[1]?.trim() ?? 'Unknown';

    return {
      platform: 'windows',
      installed: true,
      running: /running/i.test(statusText),
      autoStart: true,
      details: `Task Scheduler status: ${statusText}`,
    };
  }

  if (!existsSync(startupScriptPath)) {
    return {
      platform: 'windows',
      installed: false,
      running: false,
      autoStart: false,
      details: 'Automatic startup is not installed.',
    };
  }

  return {
    platform: 'windows',
    installed: true,
    running: false,
    autoStart: true,
    details: 'Startup folder entry installed.',
  };
}

async function installWindowsService(launch: SchedulerLaunchCommand): Promise<void> {
  const startupScriptPath = getWindowsStartupScriptPath();
  const taskCommand = buildWindowsTaskCommand(launch.command, launch.args);

  const created = await runCommand('schtasks', [
    '/Create',
    '/TN',
    WINDOWS_TASK_NAME,
    '/SC',
    'ONLOGON',
    '/TR',
    taskCommand,
    '/F',
  ]);

  if (created.ok) {
    const started = await runCommand('schtasks', ['/Run', '/TN', WINDOWS_TASK_NAME]);
    if (!started.ok) {
      throw new Error(started.stderr || started.stdout || 'Created task but failed to start it.');
    }
    return;
  }

  const errorText = `${created.stderr}\n${created.stdout}`;
  if (!/access is denied/i.test(errorText)) {
    throw new Error(created.stderr || created.stdout || 'Failed to create Windows scheduled task.');
  }

  await mkdir(path.dirname(startupScriptPath), { recursive: true });
  const startupScript = buildWindowsStartupScript(launch.command, launch.args);
  await writeFile(startupScriptPath, startupScript, 'utf8');

  const child = spawn(launch.command, launch.args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

async function uninstallWindowsService(): Promise<void> {
  const startupScriptPath = getWindowsStartupScriptPath();

  const removed = await runCommand('schtasks', ['/Delete', '/TN', WINDOWS_TASK_NAME, '/F']);
  if (!removed.ok && !/cannot find|cannot find the file|access is denied/i.test(`${removed.stderr} ${removed.stdout}`)) {
    throw new Error(removed.stderr || removed.stdout || 'Failed to delete Windows scheduled task.');
  }

  if (existsSync(startupScriptPath)) {
    await rm(startupScriptPath, { force: true });
  }
}

function buildWindowsTaskCommand(command: string, args: string[]): string {
  return [command, ...args].map((part) => `"${part.replaceAll('"', '""')}"`).join(' ');
}

function buildWindowsStartupScript(command: string, args: string[]): string {
  const cmd = [command, ...args].map((part) => `"${part.replaceAll('"', '""')}"`).join(' ');
  return `@echo off\r\nstart "" /min ${cmd}\r\n`;
}

function getWindowsStartupScriptPath(): string {
  const appData = process.env.APPDATA;
  if (!appData) {
    throw new Error('APPDATA is not defined, unable to configure Windows startup.');
  }
  return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'OmniForge Scheduler.cmd');
}

function getLaunchAgentPaths(): { dir: string; plistPath: string } {
  const dir = path.join(homedir(), 'Library', 'LaunchAgents');
  const plistPath = path.join(dir, `${MACOS_LABEL}.plist`);
  return { dir, plistPath };
}

async function getMacOsStatus(): Promise<SchedulerServiceStatus> {
  const { plistPath } = getLaunchAgentPaths();
  if (!existsSync(plistPath)) {
    return {
      platform: 'macos',
      installed: false,
      running: false,
      autoStart: false,
      details: 'LaunchAgent not installed.',
    };
  }

  const domain = getMacOsDomainTarget();
  const printed = await runCommand('launchctl', ['print', `${domain}/${MACOS_LABEL}`]);
  if (!printed.ok) {
    return {
      platform: 'macos',
      installed: true,
      running: false,
      autoStart: true,
      details: 'LaunchAgent installed but not currently loaded.',
    };
  }

  const running = /state\s*=\s*running/i.test(printed.stdout) || /pid\s*=\s*\d+/i.test(printed.stdout);

  return {
    platform: 'macos',
    installed: true,
    running,
    autoStart: true,
    details: running ? 'LaunchAgent loaded and running.' : 'LaunchAgent loaded.',
  };
}

async function installMacOsService(launch: SchedulerLaunchCommand): Promise<void> {
  const { dir, plistPath } = getLaunchAgentPaths();
  const logsDir = path.join(OMNIFORGE_HOME, 'logs');

  await mkdir(dir, { recursive: true });
  await mkdir(logsDir, { recursive: true });

  const plist = buildLaunchAgentPlist({
    label: MACOS_LABEL,
    command: launch.command,
    args: launch.args,
    stdoutPath: path.join(logsDir, 'scheduler.log'),
    stderrPath: path.join(logsDir, 'scheduler.error.log'),
    workingDirectory: homedir(),
  });

  await writeFile(plistPath, plist, 'utf8');

  const domain = getMacOsDomainTarget();

  await runCommand('launchctl', ['bootout', domain, plistPath]);

  const bootstrap = await runCommand('launchctl', ['bootstrap', domain, plistPath]);
  if (!bootstrap.ok) {
    throw new Error(bootstrap.stderr || bootstrap.stdout || 'Failed to bootstrap LaunchAgent.');
  }

  await runCommand('launchctl', ['enable', `${domain}/${MACOS_LABEL}`]);

  const kickstart = await runCommand('launchctl', ['kickstart', '-k', `${domain}/${MACOS_LABEL}`]);
  if (!kickstart.ok) {
    throw new Error(kickstart.stderr || kickstart.stdout || 'Failed to start LaunchAgent.');
  }
}

async function uninstallMacOsService(): Promise<void> {
  const { plistPath } = getLaunchAgentPaths();
  const domain = getMacOsDomainTarget();

  await runCommand('launchctl', ['bootout', domain, plistPath]);
  await runCommand('launchctl', ['disable', `${domain}/${MACOS_LABEL}`]);

  if (existsSync(plistPath)) {
    await rm(plistPath, { force: true });
  }
}

function getMacOsDomainTarget(): string {
  if (typeof process.getuid !== 'function') {
    throw new Error('Unable to determine current macOS user id.');
  }
  return `gui/${process.getuid()}`;
}

function buildLaunchAgentPlist(input: {
  label: string;
  command: string;
  args: string[];
  stdoutPath: string;
  stderrPath: string;
  workingDirectory: string;
}): string {
  const allArgs = [input.command, ...input.args];
  const argumentLines = allArgs.map((part) => `    <string>${xmlEscape(part)}</string>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(input.label)}</string>
  <key>ProgramArguments</key>
  <array>
${argumentLines}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(input.workingDirectory)}</string>
  <key>StandardOutPath</key>
  <string>${xmlEscape(input.stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(input.stderrPath)}</string>
</dict>
</plist>
`;
}

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function getLinuxServicePaths(): { dir: string; servicePath: string } {
  const dir = path.join(homedir(), '.config', 'systemd', 'user');
  const servicePath = path.join(dir, LINUX_SERVICE_NAME);
  return { dir, servicePath };
}

async function getLinuxStatus(): Promise<SchedulerServiceStatus> {
  const { servicePath } = getLinuxServicePaths();
  if (!existsSync(servicePath)) {
    return {
      platform: 'linux',
      installed: false,
      running: false,
      autoStart: false,
      details: 'User service not installed.',
    };
  }

  const enabled = await runCommand('systemctl', ['--user', 'is-enabled', LINUX_SERVICE_NAME]);
  const active = await runCommand('systemctl', ['--user', 'is-active', LINUX_SERVICE_NAME]);

  const autoStart = enabled.ok && /enabled/i.test(enabled.stdout);
  const running = active.ok && /active/i.test(active.stdout);

  return {
    platform: 'linux',
    installed: true,
    running,
    autoStart,
    details: `systemd user service: ${running ? 'active' : 'inactive'}${autoStart ? ', enabled' : ''}`,
  };
}

async function installLinuxService(launch: SchedulerLaunchCommand): Promise<void> {
  const available = await runCommand('systemctl', ['--user', '--version']);
  if (!available.ok) {
    throw new Error('systemd user services are unavailable on this Linux environment.');
  }

  const { dir, servicePath } = getLinuxServicePaths();
  await mkdir(dir, { recursive: true });

  const serviceFile = buildLinuxSystemdService({
    command: launch.command,
    args: launch.args,
  });
  await writeFile(servicePath, serviceFile, 'utf8');

  const reload = await runCommand('systemctl', ['--user', 'daemon-reload']);
  if (!reload.ok) {
    throw new Error(reload.stderr || reload.stdout || 'Failed to reload systemd user daemon.');
  }

  const enableNow = await runCommand('systemctl', ['--user', 'enable', '--now', LINUX_SERVICE_NAME]);
  if (!enableNow.ok) {
    throw new Error(enableNow.stderr || enableNow.stdout || 'Failed to enable/start scheduler service.');
  }
}

async function uninstallLinuxService(): Promise<void> {
  const { servicePath } = getLinuxServicePaths();

  await runCommand('systemctl', ['--user', 'disable', '--now', LINUX_SERVICE_NAME]);

  if (existsSync(servicePath)) {
    await rm(servicePath, { force: true });
  }

  await runCommand('systemctl', ['--user', 'daemon-reload']);
}

function buildLinuxSystemdService(input: { command: string; args: string[] }): string {
  const exec = [input.command, ...input.args].map(quoteSystemdArg).join(' ');

  return `[Unit]
Description=OmniForge Scheduler Service
After=default.target

[Service]
Type=simple
ExecStart=${exec}
WorkingDirectory=${quoteSystemdArg(homedir())}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`;
}

function quoteSystemdArg(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk);
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk);
    });

    child.on('error', (error) => {
      resolve({
        ok: false,
        code: null,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
      });
    });

    child.on('close', (code) => {
      resolve({
        ok: code === 0,
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}
