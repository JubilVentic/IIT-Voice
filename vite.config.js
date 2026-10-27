import { defineConfig } from 'vite';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const apiPort = Number(process.env.IIT_VOICE_API_PORT || 8000);
if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535)
  throw new Error('IIT_VOICE_API_PORT must be a port from 1 to 65535.');
const apiUrl = `http://127.0.0.1:${apiPort}`;

async function apiReady() {
  try {
    const response = await fetch(`${apiUrl}/api/me`, { signal: AbortSignal.timeout(500) });
    await response.body?.cancel();
    return (
      [200, 401].includes(response.status) && response.headers.get('server')?.startsWith('IITVoice')
    );
  } catch {
    return false;
  }
}

export default defineConfig({
  plugins: [
    {
      name: 'iit-voice-python-api',
      async configureServer(server) {
        if (await apiReady()) {
          server.config.logger.info(`Using IIT Voice API at ${apiUrl}`);
          return;
        }
        const backend = spawn(
          process.env.IIT_VOICE_PYTHON || 'python3',
          ['-u', '-B', 'server.py', '--port', String(apiPort)],
          { cwd: server.config.root, stdio: 'inherit' }
        );
        let stopping = false,
          ready = false,
          failure,
          stopped;
        const stop = () => {
          stopping = true;
          process.off('exit', stop);
          if (!stopped)
            stopped = new Promise((resolve) => {
              if (backend.exitCode !== null || backend.signalCode !== null) return resolve();
              backend.once('close', resolve);
              backend.kill();
            });
          return stopped;
        };
        // Vite creates the replacement server before closing the old one.
        // Finish stopping our API first so the replacement starts a fresh process.
        const restart = server.restart;
        server.restart = async (...args) => {
          await stop();
          return restart(...args);
        };
        server.httpServer.once('close', stop);
        process.once('exit', stop);
        backend.once('error', (error) => {
          failure = new Error(`Could not start Python API: ${error.message}`);
        });
        backend.once('exit', (code, signal) => {
          if (stopping) return;
          failure = new Error(
            `Python API stopped (${signal || code}). Check the Python error above; install requirements.txt if dependencies are missing.`
          );
          if (ready) {
            server.config.logger.error(failure.message);
            process.exitCode = 1;
            void server.close();
          }
        });
        for (let attempt = 0; attempt < 50; attempt++) {
          if (failure) {
            stop();
            throw failure;
          }
          if (await apiReady()) {
            ready = true;
            return;
          }
          await delay(100);
        }
        stop();
        throw new Error(
          `Python API did not become ready at ${apiUrl}. Check the Python output above.`
        );
      },
    },
  ],
  esbuild: { jsx: 'automatic' },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': { target: apiUrl, changeOrigin: false } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
