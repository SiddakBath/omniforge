import { displayBanner } from '../utils/banner.js';
import {
  getSchedulerServiceStatus,
  installSchedulerService,
  uninstallSchedulerService,
} from '../core/scheduler-service.js';
import { printError, printInfo, printSuccess } from '../utils/interactive.js';

type SchedulerServiceAction = 'install' | 'uninstall' | 'status';

const VALID_ACTIONS: ReadonlySet<string> = new Set(['install', 'uninstall', 'status']);

export async function runSchedulerServiceCommand(actionInput = 'status'): Promise<void> {
  console.clear?.();
  displayBanner();

  const normalized = actionInput.trim().toLowerCase();
  if (!VALID_ACTIONS.has(normalized)) {
    throw new Error(`Invalid action "${actionInput}". Use: install, uninstall, or status.`);
  }

  const action = normalized as SchedulerServiceAction;

  if (action === 'install') {
    await installFlow();
    return;
  }

  if (action === 'uninstall') {
    await uninstallFlow();
    return;
  }

  await statusFlow();
}

async function installFlow(): Promise<void> {
  printInfo('Configuring automatic scheduler startup...');
  await installSchedulerService();

  const status = await getSchedulerServiceStatus();
  printSuccess('Automatic scheduler startup is enabled.');
  printInfo(`Platform: ${status.platform}`);
  printInfo(`Installed: ${status.installed ? 'yes' : 'no'}`);
  printInfo(`Running: ${status.running ? 'yes' : 'no'}`);
  printInfo(status.details);
}

async function uninstallFlow(): Promise<void> {
  printInfo('Removing automatic scheduler startup...');
  await uninstallSchedulerService();

  const status = await getSchedulerServiceStatus();
  printSuccess('Automatic scheduler startup is disabled.');
  printInfo(`Installed: ${status.installed ? 'yes' : 'no'}`);
  if (status.details) {
    printInfo(status.details);
  }
}

async function statusFlow(): Promise<void> {
  const status = await getSchedulerServiceStatus();

  printInfo(`Platform: ${status.platform}`);
  printInfo(`Installed: ${status.installed ? 'yes' : 'no'}`);
  printInfo(`Auto start: ${status.autoStart ? 'yes' : 'no'}`);
  printInfo(`Running: ${status.running ? 'yes' : 'no'}`);
  printInfo(status.details);

  if (!status.installed) {
    printError('Automatic scheduler startup is not configured.', 'Run: omniforge scheduler-service install');
  }
}
