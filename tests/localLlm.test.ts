import { describe, it, expect, vi, afterEach } from 'vitest';
import { localChat, listLocalModels } from '../services/localLlmService';

const server = { label: 'LM Studio', baseUrl: 'http://localhost:1234/v1/', model: '' };
afterEach(() => vi.unstubAllGlobals());

describe('localLlmService', () => {
  it('lists models and picks the first when none configured', async () => {
    const calls: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      calls.push({ url, body: init?.body && JSON.parse(init.body) });
      if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'qwen3-8b' }, { id: 'llama' }] }));
      return new Response(JSON.stringify({ choices: [{ message: { content: '<think>hmm</think>{"ok":true}' } }] }));
    }));
    const out = await localChat(server, 'hi', { json: true, system: 'be brief' });
    expect(out).toBe('{"ok":true}');
    expect(calls[0].url).toBe('http://localhost:1234/v1/models');
    expect(calls[1].url).toBe('http://localhost:1234/v1/chat/completions');
    expect(calls[1].body.model).toBe('qwen3-8b');
    expect(calls[1].body.messages[0].content).toMatch(/be brief[\s\S]*JSON only/);
  });

  it('gives a clear error when the server is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    await expect(listLocalModels(server)).rejects.toThrow(/not reachable/);
  });
});
