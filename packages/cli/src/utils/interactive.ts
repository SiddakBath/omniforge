/**
 * Shared interactive utilities for TUI commands with enhanced polish and feedback
 */
import * as readline from 'readline';
import { COLORS } from './colors.js';

export interface SelectOption {
  label: string;
  value: string;
  description?: string;
}

/**
 * Interactive menu selection with keyboard navigation - enhanced version
 */
export async function selectFromList(
  title: string,
  options: SelectOption[],
  pageSize = 10
): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    let selected = 0;
    let page = 0;

    const totalPages = Math.ceil(options.length / pageSize);
    const startIdx = page * pageSize;
    const endIdx = Math.min(startIdx + pageSize, options.length);

    const showMenu = () => {
      console.clear?.();
      console.log(`\n${COLORS.bright}✨ ${title}${COLORS.reset}\n`);

      const currentPage = options.slice(page * pageSize, (page + 1) * pageSize);
      currentPage.forEach((opt, i) => {
        const actualIndex = page * pageSize + i;
        const prefix = actualIndex === selected ? `${COLORS.white}${COLORS.bright}❯${COLORS.reset} ` : '  ';
        const label = actualIndex === selected ? `${COLORS.bright}${opt.label}${COLORS.reset}` : opt.label;
        console.log(`${prefix}${label}`);
        if (opt.description && actualIndex === selected) {
          console.log(`   ${COLORS.gray}└─ ${opt.description}${COLORS.reset}`);
        }
      });

      console.log(`\n${COLORS.gray}↑↓ Navigate • Enter to select • Ctrl+C to exit${COLORS.reset}`);
      if (totalPages > 1) {
        console.log(`${COLORS.dim}Page ${page + 1} of ${totalPages}${COLORS.reset}\n`);
      } else {
        console.log();
      }
    };

    showMenu();

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    const handleKeyPress = (buffer: any, key: any) => {
      if (key && key.ctrl && key.name === 'c') {
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        process.stdin.off('keypress', handleKeyPress);
        rl.close();
        process.exit(0);
      }
      if (key && key.name === 'up') {
        if (selected > 0) {
          selected--;
        } else {
          selected = options.length - 1;
          page = Math.floor((options.length - 1) / pageSize);
        }
        showMenu();
      }
      if (key && key.name === 'down') {
        if (selected < options.length - 1) {
          selected++;
        } else {
          selected = 0;
          page = 0;
        }
        showMenu();
      }
      if (key && key.name === 'pageup') {
        page = Math.max(0, page - 1);
        selected = page * pageSize;
        showMenu();
      }
      if (key && key.name === 'pagedown') {
        page = Math.min(totalPages - 1, page + 1);
        selected = page * pageSize;
        showMenu();
      }
      if (key && key.name === 'return') {
        // Update page if needed
        const requiredPage = Math.floor(selected / pageSize);
        if (requiredPage !== page) {
          page = requiredPage;
        }

        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        process.stdin.off('keypress', handleKeyPress);
        rl.close();
        const selectedOption = options[selected];
        if (selectedOption) {
          resolve(selectedOption.value);
        }
      }
    };

    process.stdin.on('keypress', handleKeyPress);
  });
}

/**
 * Text input prompt with better visual feedback
 */
export function promptInput(question: string, defaultValue?: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    const displayQuestion = defaultValue ? `${question} ${COLORS.gray}[${defaultValue}]${COLORS.reset}` : question;
    rl.question(`${COLORS.white}${displayQuestion}${COLORS.reset}: `, (answer) => {
      rl.close();
      resolve(answer || defaultValue || '');
    });
  });
}

/**
 * Password input prompt (masked) with visual feedback
 */
export function promptPassword(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    process.stdout.write(`${COLORS.white}${question}${COLORS.reset}: `);
    process.stdin.setRawMode(true);
    process.stdin.resume();

    let password = '';
    process.stdin.on('data', (char: Buffer) => {
      const c = char.toString();
      if (c === '\n' || c === '\r' || c === '\u0004') {
        process.stdin.setRawMode(false);
        process.stdout.write('\n');
        process.stdin.pause();
        rl.close();
        resolve(password);
      } else if (c === '\u0003') {
        process.exit();
      } else if (c === '\u007f') {
        // Backspace
        password = password.slice(0, -1);
        process.stdout.write('\b \b');
      } else {
        password += c;
        process.stdout.write('*');
      }
    });
  });
}

/**
 * Confirmation prompt with clear visual options
 */
export async function promptConfirm(question: string, defaultYes = true): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    const options = defaultYes ? '(Y/n)' : '(y/N)';
    rl.question(`${COLORS.white}${question}${COLORS.reset} ${COLORS.gray}${options}${COLORS.reset}: `, (answer) => {
      rl.close();
      if (!answer) {
        resolve(defaultYes);
      } else {
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
      }
    });
  });
}

/**
 * Success message with formatting
 */
export function printSuccess(message: string): void {
  console.log(`${COLORS.green}${COLORS.bright}✔${COLORS.reset} ${message}`);
}

/**
 * Error message with formatting
 */
export function printError(message: string, details?: string): void {
  console.error(`${COLORS.red}${COLORS.bright}✖${COLORS.reset} ${message}`);
  if (details) {
    console.error(`${COLORS.gray}  ${details}${COLORS.reset}`);
  }
}

/**
 * Warning message with formatting
 */
export function printWarning(message: string, details?: string): void {
  console.log(`${COLORS.yellow}${COLORS.bright}⚠${COLORS.reset} ${message}`);
  if (details) {
    console.log(`${COLORS.gray}  ${details}${COLORS.reset}`);
  }
}

/**
 * Info message with formatting
 */
export function printInfo(message: string, details?: string): void {
  console.log(`${COLORS.white}${COLORS.bright}ℹ${COLORS.reset} ${message}`);
  if (details) {
    console.log(`${COLORS.gray}  ${details}${COLORS.reset}`);
  }
}

/**
 * Divider for visual separation
 */
export function printDivider(): void {
  console.log(`${COLORS.gray}${'─'.repeat(50)}${COLORS.reset}`);
}
