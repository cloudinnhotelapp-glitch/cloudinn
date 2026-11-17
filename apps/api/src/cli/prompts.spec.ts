// Unit tests for the hidden password prompt: nothing typed is echoed, editing keys work, and only a real terminal is accepted.
import { EventEmitter } from 'node:events';
import { BootstrapRefusedError } from '../super-admin/bootstrap/first-super-admin.js';
import { promptHidden, type PromptInput } from './prompts.js';

// A fake terminal input that records raw-mode changes.
function fakeTerminal(isTTY = true) {
  const input = Object.assign(new EventEmitter(), {
    isTTY,
    rawModes: [] as boolean[],
    setRawMode(mode: boolean) {
      input.rawModes.push(mode);
    },
    setEncoding() {},
    resume() {},
    pause() {},
  });
  return input;
}

// A fake output that keeps everything written.
function fakeOutput() {
  const written: string[] = [];
  return { written, write: (text: string) => written.push(text) };
}

// Tests for promptHidden.
describe('hidden prompt', () => {
  // Proves the typed value is returned, never written to the screen, and the terminal is restored.
  it('returns the typed value without echoing it', async () => {
    const input = fakeTerminal();
    const output = fakeOutput();
    const answer = promptHidden('Password: ', input as PromptInput, output);
    input.emit('data', 'Harbour-');
    input.emit('data', 'Lanterx\u007fn-58!');
    input.emit('data', '\u001b[A');
    input.emit('data', '\r');
    await expect(answer).resolves.toBe('Harbour-Lantern-58!');
    expect(output.written.join('')).toBe('Password: \n');
    expect(input.rawModes).toEqual([true, false]);
    expect(input.listenerCount('data')).toBe(0);
  });

  // Proves Ctrl+C cancels and restores the terminal.
  it('cancels on Ctrl+C', async () => {
    const input = fakeTerminal();
    const answer = promptHidden('Password: ', input as PromptInput, fakeOutput());
    input.emit('data', 'abc\u0003');
    await expect(answer).rejects.toThrow(/Cancelled/);
    expect(input.rawModes).toEqual([true, false]);
  });

  // Proves piped (non-terminal) input is refused.
  it('refuses input that is not an interactive terminal', async () => {
    await expect(promptHidden('Password: ', fakeTerminal(false) as PromptInput, fakeOutput())).rejects.toBeInstanceOf(BootstrapRefusedError);
  });
});
