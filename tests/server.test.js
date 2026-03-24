import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createApp } from "../server.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

test("server stores shared projects and streams uploaded audio", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "interview-editor-"));
  const server = createServer(createApp({ rootDir, dataDir }));

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    await rm(dataDir, { recursive: true, force: true });
  });

  const address = server.address();
  assert.equal(typeof address, "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const healthResponse = await fetch(`${baseUrl}/health`);
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(await healthResponse.json(), { ok: true });

  const createResponse = await fetch(`${baseUrl}/api/interview-projects`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(createResponse.status, 201);
  const createdPayload = await createResponse.json();
  const projectId = createdPayload.project.id;

  assert.match(projectId, /^[a-z0-9-]{8,}$/i);
  assert.equal(createdPayload.project.audioAvailable, false);
  assert.equal(createdPayload.project.version, 0);

  const audioBytes = Buffer.from("RIFFtestWAVEdata");
  const uploadResponse = await fetch(
    `${baseUrl}/api/interview-projects/${projectId}/audio?filename=episode.wav`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "audio/wav",
      },
      body: audioBytes,
    },
  );
  assert.equal(uploadResponse.status, 200);
  const uploadedPayload = await uploadResponse.json();
  assert.equal(uploadedPayload.project.audioAvailable, true);
  assert.equal(uploadedPayload.project.audioFileName, "episode.wav");
  assert.equal(uploadedPayload.project.version, 1);

  const saveResponse = await fetch(`${baseUrl}/api/interview-projects/${projectId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      projectName: "Episode Draft",
      transcriptFileName: "episode.txt",
      transcriptWarning: "",
      speakerEditorOpen: false,
      speakerAssignments: [{ id: "speaker-1", label: "Speaker 1", name: "Host" }],
      bites: [
        {
          id: "bite-1",
          transcriptSegmentId: "segment-1",
          startTime: 0,
          endTime: 8,
          text: "Keep this line.",
          comments: ["Producer note"],
          deleted: false,
          orderIndex: 0,
        },
      ],
    }),
  });
  assert.equal(saveResponse.status, 200);
  const savedPayload = await saveResponse.json();
  assert.equal(savedPayload.project.projectName, "Episode Draft");
  assert.equal(savedPayload.project.bites.length, 1);
  assert.equal(savedPayload.project.version, 2);

  const loadResponse = await fetch(`${baseUrl}/api/interview-projects/${projectId}`);
  assert.equal(loadResponse.status, 200);
  const loadedPayload = await loadResponse.json();
  assert.equal(loadedPayload.project.projectName, "Episode Draft");
  assert.equal(loadedPayload.project.audioAvailable, true);
  assert.equal(loadedPayload.project.audioFileName, "episode.wav");

  const rangedAudioResponse = await fetch(`${baseUrl}/api/interview-projects/${projectId}/audio`, {
    headers: {
      Range: "bytes=0-3",
    },
  });
  assert.equal(rangedAudioResponse.status, 206);
  assert.equal(rangedAudioResponse.headers.get("content-range"), `bytes 0-3/${audioBytes.length}`);
  const rangedBytes = Buffer.from(await rangedAudioResponse.arrayBuffer());
  assert.deepEqual(rangedBytes, audioBytes.subarray(0, 4));
});
