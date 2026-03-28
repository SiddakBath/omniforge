import { spawn } from 'child_process';

export async function runWebCommand(): Promise<void> {
  const child = spawn('npm', ['run', 'dev', '-w', '@openforge/web'], {
    stdio: 'inherit',
    shell: true,
  });

  await new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`openforge web exited with code ${code}`));
      }
    });
  });
}
