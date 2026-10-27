import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createSocketServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
async function freePort() {
  const socket = createSocketServer();
  await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

async function apiStatus(url) {
  try {
    const response = await fetch(`${url}/api/me`, { signal: AbortSignal.timeout(500) });
    await response.body?.cancel();
    return response.status;
  } catch {
    return null;
  }
}

test(
  'dev starts and restarts the API, reuses it, and stops only the backend it owns',
  { timeout: 20000 },
  async () => {
    const data = await mkdtemp(join(tmpdir(), 'iit-voice-dev-'));
    const port = await freePort(),
      api = `http://127.0.0.1:${port}`;
    const previous = { ...process.env };
    Object.assign(process.env, {
      IIT_VOICE_API_PORT: String(port),
      IIT_VOICE_DATA: data,
      DATABASE_URL: '',
      GEMINI_API_KEY: '',
      IIT_VOICE_DEMO_LOGIN: '0',
    });
    let first, second;
    try {
      const options = {
        root,
        configFile: join(root, 'vite.config.js'),
        logLevel: 'silent',
        server: { host: '127.0.0.1', port: 0, strictPort: true },
      };
      first = await createServer(options);
      await first.listen();
      assert.equal(
        await apiStatus(api),
        401,
        'Backend must be ready without a separate Python command'
      );
      assert.equal(
        await apiStatus(first.resolvedUrls.local[0].replace(/\/$/, '')),
        401,
        'Vite must proxy to the started API'
      );
      await first.restart();
      assert.equal(await apiStatus(api), 401, 'Restarting Vite must bring the backend back online');
      assert.equal(
        await apiStatus(first.resolvedUrls.local[0].replace(/\/$/, '')),
        401,
        'The restarted frontend must proxy to the API'
      );
      second = await createServer(options);
      await second.listen();
      assert.equal(await apiStatus(second.resolvedUrls.local[0].replace(/\/$/, '')), 401);
      await second.close();
      second = null;
      assert.equal(
        await apiStatus(api),
        401,
        'A reused backend must survive closing the second frontend'
      );
      await first.close();
      first = null;
      for (let attempt = 0; attempt < 30 && (await apiStatus(api)) !== null; attempt++)
        await delay(100);
      assert.equal(await apiStatus(api), null, 'The frontend owner must stop its backend');
    } finally {
      await second?.close();
      await first?.close();
      for (const name of [
        'IIT_VOICE_API_PORT',
        'IIT_VOICE_DATA',
        'GEMINI_API_KEY',
        'IIT_VOICE_DEMO_LOGIN',
      ]) {
        if (previous[name] === undefined) delete process.env[name];
        else process.env[name] = previous[name];
      }
      await rm(data, { recursive: true, force: true });
    }
  }
);

test(
  'dev reuses a healthy API even when database-backed authentication is slow',
  { timeout: 10000 },
  async () => {
    const port = await freePort();
    const requests = [];
    const backend = createHttpServer((request, response) => {
      requests.push(request.url);
      const send = () =>
        response
          .writeHead(request.url === '/api/health' ? 200 : 401, {
            server: 'IITVoice',
            'content-type': 'application/json',
          })
          .end('{}');
      if (request.url === '/api/me') setTimeout(send, 1200);
      else send();
    });
    await new Promise((resolve) => backend.listen(port, '127.0.0.1', resolve));
    const previous = process.env.IIT_VOICE_API_PORT;
    process.env.IIT_VOICE_API_PORT = String(port);
    let frontend;
    try {
      frontend = await createServer({
        root,
        configFile: join(root, 'vite.config.js'),
        logLevel: 'silent',
        server: { host: '127.0.0.1', port: 0, strictPort: true },
      });
      await frontend.listen();
      const response = await fetch(frontend.resolvedUrls.local[0] + 'api/me');
      assert.equal(response.status, 401, 'Slow cloud-backed requests must still be proxied');
      await response.body?.cancel();
      assert.ok(requests.includes('/api/health'));
    } finally {
      await frontend?.close();
      await new Promise((resolve) => backend.close(resolve));
      if (previous === undefined) delete process.env.IIT_VOICE_API_PORT;
      else process.env.IIT_VOICE_API_PORT = previous;
    }
  }
);
