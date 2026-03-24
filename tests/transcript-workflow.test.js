import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPrintHtml,
  buildTranscriptDownload,
  buildTranscriptDraft,
  extractSoundbites,
  formatTimecode,
  getVisibleSoundbites,
  parseTranscriptText,
  priorityLabel,
  transcriptionToSegments,
} from "../transcript-workflow.js";

test("formatTimecode renders clean hh:mm:ss output", () => {
  assert.equal(formatTimecode(0), "00:00:00");
  assert.equal(formatTimecode(65), "00:01:05");
  assert.equal(formatTimecode(3661), "01:01:01");
});

test("buildTranscriptDraft returns ordered draft segments inside duration", () => {
  const segments = buildTranscriptDraft({ duration: 92, fileName: "mixdown.wav" });

  assert.equal(segments.length >= 4, true);
  assert.equal(segments[0].startTime, 0);
  assert.equal(segments.at(-1).endTime, 92);
  assert.equal(segments.every((segment) => segment.endTime > segment.startTime), true);
});

test("extractSoundbites preserves existing notes and priority", () => {
  const transcriptSegments = [
    { id: "a", startTime: 0, endTime: 8, text: "First line" },
    { id: "b", startTime: 8, endTime: 12, text: "Second line" },
  ];
  const existing = [
    {
      id: "bite-a",
      transcriptSegmentId: "a",
      startTime: 0,
      endTime: 8,
      text: "First line",
      priority: "red",
      notes: "Keep",
      deleted: false,
      orderIndex: 0,
    },
  ];

  const soundbites = extractSoundbites(transcriptSegments, existing);

  assert.equal(soundbites[0].priority, "red");
  assert.equal(soundbites[0].notes, "Keep");
  assert.equal(soundbites[1].priority, null);
});

test("extractSoundbites rebuilds notes from transcript segments", () => {
  const transcriptSegments = [
    {
      id: "a",
      startTime: 0,
      endTime: 8,
      text: "First line",
      notes: "Producer note",
      priority: "yellow",
      deleted: false,
      orderIndex: 0,
    },
  ];

  const soundbites = extractSoundbites(transcriptSegments, []);

  assert.equal(soundbites[0].notes, "Producer note");
  assert.equal(soundbites[0].priority, "yellow");
});

test("transcriptionToSegments converts timestamped ASR chunks into transcript rows", () => {
  const segments = transcriptionToSegments(
    {
      text: "Hello world.",
      chunks: [
        { text: "Hello", timestamp: [0, 1.4] },
        { text: "world.", timestamp: [1.4, 3.2] },
      ],
    },
    3.2,
  );

  assert.equal(segments.length, 2);
  assert.equal(segments[0].text, "Hello");
  assert.equal(segments[1].startTime, 1.4);
  assert.equal(segments[1].endTime, 3.2);
});

test("buildTranscriptDownload serializes timecoded transcript text", () => {
  const text = buildTranscriptDownload(
    [{ id: "a", startTime: 0, endTime: 8, text: "Opening line" }],
    "session.wav",
  );

  assert.match(text, /Source: session\.wav/);
  assert.match(text, /00:00:00 - 00:00:08/);
  assert.match(text, /Opening line/);
});

test("parseTranscriptText reads exported timecoded transcript files", () => {
  const segments = parseTranscriptText(`
    Source: session.wav
    Generated: 3/23/2026, 10:00:00 AM

    00:00:00 - 00:00:08
    Opening line

    00:00:08 - 00:00:12
    Follow-up answer
  `);

  assert.equal(segments.length, 2);
  assert.equal(segments[0].startTime, 0);
  assert.equal(segments[1].endTime, 12);
  assert.equal(segments[1].text, "Follow-up answer");
});

test("parseTranscriptText falls back to paragraph blocks for plain text files", () => {
  const segments = parseTranscriptText(`
    First paragraph of the transcript.

    Second paragraph with more detail.
  `);

  assert.equal(segments.length, 2);
  assert.equal(segments[0].text, "First paragraph of the transcript.");
  assert.equal(segments[1].startTime > segments[0].startTime, true);
});

test("print html excludes deleted soundbites and includes notes", () => {
  const html = buildPrintHtml({
    sourceName: "session.wav",
    soundbites: [
      {
        id: "a",
        transcriptSegmentId: "a",
        startTime: 0,
        endTime: 8,
        text: "Keep this line",
        priority: "yellow",
        notes: "Producer note",
        deleted: false,
        orderIndex: 0,
      },
      {
        id: "b",
        transcriptSegmentId: "b",
        startTime: 8,
        endTime: 12,
        text: "Remove this line",
        priority: "red",
        notes: "",
        deleted: true,
        orderIndex: 1,
      },
    ],
  });

  assert.match(html, /Keep this line/);
  assert.match(html, /Producer note/);
  assert.doesNotMatch(html, /Remove this line/);
});

test("visible soundbites filters deleted entries and reorders cleanly", () => {
  const visible = getVisibleSoundbites([
    {
      id: "a",
      transcriptSegmentId: "a",
      startTime: 0,
      endTime: 8,
      text: "Keep",
      priority: null,
      notes: "",
      deleted: false,
      orderIndex: 2,
    },
    {
      id: "b",
      transcriptSegmentId: "b",
      startTime: 8,
      endTime: 12,
      text: "Cut",
      priority: null,
      notes: "",
      deleted: true,
      orderIndex: 1,
    },
  ]);

  assert.equal(visible.length, 1);
  assert.equal(visible[0].orderIndex, 0);
});

test("priorityLabel returns internal export labels", () => {
  assert.equal(priorityLabel("red"), "HIGH");
  assert.equal(priorityLabel("yellow"), "MEDIUM");
  assert.equal(priorityLabel("green"), "LOW");
  assert.equal(priorityLabel(null), "UNMARKED");
});
