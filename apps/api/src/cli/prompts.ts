// Terminal prompts for operator commands: a normal visible prompt, and a hidden prompt for passwords that echoes nothing
// (not even asterisks) and works only in an interactive terminal, so a password is never piped, logged, or displayed.
import { createInterface } from 'node:readline/promises';
import { BootstrapRefusedError } from '../super-admin/bootstrap/first-super-admin.js';

// The parts of an input stream the hidden prompt needs (process.stdin in real use; a fake in tests).
export interface PromptInput extends NodeJS.EventEmitter {
  isTTY?: boolean;
  setRawMode?: (mode: boolean) => unknown;
  setEncoding(encoding: BufferEncoding): unknown;
  resume(): unknown;
  pause(): unknown;
}

// The part of an output stream the prompts write to.
export interface PromptOutput {
  write(text: string): unknown;
}

// Asks a question with a visible answer.
export async function promptVisible(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

// Asks for a secret without echoing it. Enter finishes, Backspace deletes, Ctrl+C cancels, and arrow or other escape
// keys are ignored. Refuses when the input is not an interactive terminal.
export function promptHidden(question: string, input: PromptInput = process.stdin, output: PromptOutput = process.stdout): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!input.isTTY || typeof input.setRawMode !== 'function') {
      reject(new BootstrapRefusedError('The password must be typed at an interactive terminal; piped input is not accepted.'));
      return;
    }
    const setRawMode = input.setRawMode.bind(input);
    let value = '';
    output.write(question);

    // Restores the terminal and stops listening.
    const finish = () => {
      input.off('data', onData);
      setRawMode(false);
      input.pause();
      output.write('\n');
    };

    // Handles typed or pasted characters.
    function onData(chunk: string | Buffer) {
      const text = chunk.toString();
      if (text.startsWith('\u001b')) return;
      for (const ch of text) {
        if (ch === '\r' || ch === '\n') {
          finish();
          resolve(value);
          return;
        }
        if (ch === '\u0003' || ch === '\u0004') {
          finish();
          reject(new BootstrapRefusedError('Cancelled; nothing was changed.'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') {
          value = [...value].slice(0, -1).join('');
          continue;
        }
        if (ch >= ' ') value += ch;
      }
    }

    setRawMode(true);
    input.setEncoding('utf8');
    input.on('data', onData);
    input.resume();
  });
}
