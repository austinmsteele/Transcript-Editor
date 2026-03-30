import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

test("server process exits cleanly on SIGTERM for Render-style shutdowns", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "interview-editor-render-"));
  const child = spawn(process.execPath, ["server.js"], {
    cwd: rootDir,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      HOST: "127.0.0.1",
      PORT: "0",
      SHUTDOWN_TIMEOUT_MS: "2000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await once(child, "close").catch(() => {});
    }
    await rm(dataDir, { recursive: true, force: true });
  });

  await waitFor(
    () => /running at http:\/\/127\.0\.0\.1:\d+/i.test(stdout),
    5000,
    `Server did not start in time.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
  );

  const exitPromise = once(child, "exit");
  child.kill("SIGTERM");

  const [code, signal] = await Promise.race([
    exitPromise,
    createTimeoutPromise(5000, `Server did not exit after SIGTERM.\nstdout:\n${stdout}\nstderr:\n${stderr}`),
  ]);

  assert.equal(signal, null);
  assert.equal(code, 0, `Expected a clean exit.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  assert.match(stdout, /SIGTERM received, shutting down gracefully\./);
  assert.equal(stderr, "");
});

function createTimeoutPromise(timeoutMs, message) {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });
}

async function waitFor(check, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(message);
}
