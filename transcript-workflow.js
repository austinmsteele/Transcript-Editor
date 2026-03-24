import { makeId } from "./id.js";

const DEFAULT_DRAFT_LINES = [
  "Opening line from the interview.",
  "Set up the context in one concise beat.",
  "Add the strongest detail from the conversation.",
  "Keep the emotional pivot here.",
  "Use a clean supporting line.",
  "Bridge into the next thought.",
  "Short clarifying answer.",
  "Hold the useful concrete detail.",
  "Drop in the strongest follow-up.",
  "Land on the closing takeaway.",
];

export function formatTimecode(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

export function buildTranscriptDraft({ duration, fileName = "" }) {
  const safeDuration = Number.isFinite(duration) && duration > 1 ? duration : 90;
  const segmentCount = clamp(Math.ceil(safeDuration / 18), 1, 18);
  const baseDuration = safeDuration / segmentCount;
  let cursor = 0;

  return Array.from({ length: segmentCount }, (_, index) => {
    const startTime = cursor;
    const remaining = safeDuration - cursor;
    const segmentsLeft = segmentCount - index;
    const offset = index % 3 === 0 ? 2 : index % 3 === 1 ? -1 : 1;
    const minimumSlice = safeDuration >= 24 ? 4 : 1;
    const maxSlice = Math.max(minimumSlice, remaining - (segmentsLeft - 1) * minimumSlice);
    const durationSlice =
      index === segmentCount - 1
        ? remaining
        : clamp(baseDuration + offset, minimumSlice, maxSlice);
    const endTime =
      index === segmentCount - 1 ? safeDuration : Math.min(safeDuration, startTime + durationSlice);
    cursor = endTime;

    return {
      id: makeId("transcript"),
      startTime,
      endTime: Math.min(safeDuration, Math.max(endTime, startTime + minimumSlice)),
      text: DEFAULT_DRAFT_LINES[index % DEFAULT_DRAFT_LINES.length],
      sourceName: fileName,
      notes: "",
      priority: null,
      deleted: false,
      orderIndex: index,
    };
  });
}

export function transcriptionToSegments(result, duration = 0) {
  const fallbackEnd = Number.isFinite(duration) && duration > 0 ? duration : 1;
  const chunks = Array.isArray(result?.chunks) && result.chunks.length
    ? result.chunks
    : [{ text: result?.text ?? "", timestamp: [0, fallbackEnd] }];

  return chunks
    .map((chunk, index, allChunks) => {
      const startTime = toSafeTimestamp(chunk?.timestamp?.[0], 0);
      const nextStart = toSafeTimestamp(allChunks[index + 1]?.timestamp?.[0], fallbackEnd);
      const rawEnd = toSafeTimestamp(chunk?.timestamp?.[1], nextStart || fallbackEnd);
      const endTime = Math.max(startTime + 0.2, rawEnd || nextStart || fallbackEnd);
      const text = String(chunk?.text ?? "").trim();

      if (!text) {
        return null;
      }

      return {
        id: makeId("transcript"),
        startTime,
        endTime,
        text,
        notes: "",
        priority: null,
        deleted: false,
        orderIndex: index,
      };
    })
    .filter(Boolean);
}

export function parseTranscriptText(contents, options = {}) {
  const normalized = String(contents ?? "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const jsonSegments = parseTranscriptJson(normalized);
  if (jsonSegments.length) {
    return jsonSegments;
  }

  const timecodedSegments = parseTimecodedTranscript(normalized);
  if (timecodedSegments.length) {
    return timecodedSegments;
  }

  return parseParagraphTranscript(normalized, options.duration);
}

export function extractSoundbites(transcriptSegments, existingSoundbites = []) {
  const previousByTranscriptId = new Map(
    existingSoundbites.map((soundbite) => [soundbite.transcriptSegmentId, soundbite]),
  );

  const extracted = [...transcriptSegments]
    .sort((left, right) => (left.orderIndex ?? 0) - (right.orderIndex ?? 0))
    .filter((segment) => segment.text.trim())
    .map((segment, index) => {
      const existing = previousByTranscriptId.get(segment.id);

      return {
        id: existing?.id ?? makeId("bite"),
        transcriptSegmentId: segment.id,
        startTime: segment.startTime,
        endTime: segment.endTime,
        text: segment.text.trim(),
        priority: segment.priority ?? existing?.priority ?? null,
        notes: String(segment.notes ?? existing?.notes ?? ""),
        deleted: segment.deleted ?? existing?.deleted ?? false,
        orderIndex: segment.orderIndex ?? existing?.orderIndex ?? index,
      };
    });

  return normalizeOrderIndices(extracted);
}

export function getVisibleSoundbites(soundbites) {
  return normalizeOrderIndices(soundbites.filter((soundbite) => !soundbite.deleted));
}

export function getRemovedSoundbites(soundbites) {
  return soundbites.filter((soundbite) => soundbite.deleted);
}

export function priorityLabel(priority) {
  switch (priority) {
    case "red":
      return "HIGH";
    case "yellow":
      return "MEDIUM";
    case "green":
      return "LOW";
    default:
      return "UNMARKED";
  }
}

export function buildTranscriptDownload(transcriptSegments, sourceName = "transcript") {
  const lines = [
    `Source: ${sourceName}`,
    `Generated: ${new Date().toLocaleString()}`,
    "",
  ];

  transcriptSegments.forEach((segment) => {
    lines.push(
      `${formatTimecode(segment.startTime)} - ${formatTimecode(segment.endTime)}`,
      segment.text.trim(),
      "",
    );
  });

  return lines.join("\n");
}

export function buildPrintHtml({ sourceName = "Audio Edit Script", soundbites = [] }) {
  const activeSoundbites = getVisibleSoundbites(soundbites);
  const cards = activeSoundbites
    .map((soundbite, index) => {
      const priority = priorityLabel(soundbite.priority);
      const noteBlock = soundbite.notes.trim()
        ? `<p class="notes">${escapeHtml(soundbite.notes.trim())}</p>`
        : "";

      return `
        <article class="card priority-${soundbite.priority ?? "none"}">
          <header class="card-head">
            <div class="index">${String(index + 1).padStart(2, "0")}</div>
            <div class="timecode">${formatTimecode(soundbite.startTime)} - ${formatTimecode(soundbite.endTime)}</div>
            <div class="priority">${priority}</div>
          </header>
          <p class="text">${escapeHtml(soundbite.text)}</p>
          ${noteBlock}
        </article>
      `;
    })
    .join("");

  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <title>${escapeHtml(sourceName)}</title>
      <style>
        :root {
          color-scheme: light;
          --ink: #1f1914;
          --muted: #6f665d;
          --border: rgba(31, 25, 20, 0.16);
          --red: #cf534b;
          --yellow: #d0a13a;
          --green: #4d8e64;
        }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          padding: 40px;
          color: var(--ink);
          font-family: "Avenir Next", "Segoe UI", sans-serif;
          background: #fffdf8;
        }
        header {
          display: flex;
          justify-content: space-between;
          align-items: end;
          gap: 20px;
          margin-bottom: 28px;
          border-bottom: 1px solid var(--border);
          padding-bottom: 18px;
        }
        h1 {
          margin: 0;
          font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif;
          font-size: 30px;
          line-height: 1;
        }
        .meta {
          color: var(--muted);
          font-size: 12px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }
        .cards {
          display: grid;
          gap: 14px;
        }
        .card {
          border: 1px solid var(--border);
          border-left-width: 6px;
          border-radius: 18px;
          padding: 18px 20px;
          background: #ffffff;
        }
        .priority-red { border-left-color: var(--red); }
        .priority-yellow { border-left-color: var(--yellow); }
        .priority-green { border-left-color: var(--green); }
        .priority-none { border-left-color: #c8c0b8; }
        .card-head {
          display: grid;
          grid-template-columns: 54px 1fr 110px;
          gap: 14px;
          align-items: center;
          font-size: 12px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .timecode {
          font-family: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace;
          letter-spacing: 0.03em;
          text-transform: none;
        }
        .priority {
          text-align: right;
        }
        .text {
          margin: 14px 0 0;
          font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif;
          font-size: 18px;
          line-height: 1.6;
          white-space: pre-wrap;
        }
        .notes {
          margin: 12px 0 0;
          font-size: 14px;
          line-height: 1.5;
          color: var(--muted);
          white-space: pre-wrap;
        }
      </style>
    </head>
    <body>
      <header>
        <div>
          <div class="meta">Audio Edit Script</div>
          <h1>${escapeHtml(sourceName)}</h1>
        </div>
        <div class="meta">${activeSoundbites.length} soundbites</div>
      </header>
      <main class="cards">${cards}</main>
    </body>
  </html>`;
}

function normalizeOrderIndices(soundbites) {
  return [...soundbites]
    .sort((left, right) => left.orderIndex - right.orderIndex)
    .map((soundbite, index) => ({
      ...soundbite,
      orderIndex: index,
    }));
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toSafeTimestamp(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function parseTranscriptJson(contents) {
  try {
    const parsed = JSON.parse(contents);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry, index) => {
        const text = String(entry?.text ?? "").trim();
        if (!text) {
          return null;
        }

        const startTime = toSafeTimestamp(
          Number(entry?.startTime ?? entry?.start ?? entry?.timestamp?.[0]),
          index === 0 ? 0 : null,
        );
        const endTime = toSafeTimestamp(
          Number(entry?.endTime ?? entry?.end ?? entry?.timestamp?.[1]),
          Number.isFinite(startTime) ? startTime + estimateSegmentDuration(text) : null,
        );

        return {
          id: makeId("transcript"),
          startTime: Number.isFinite(startTime) ? startTime : index * 8,
          endTime: Number.isFinite(endTime) ? Math.max(endTime, startTime + 0.2) : (index + 1) * 8,
          text,
          notes: "",
          priority: null,
          deleted: false,
          orderIndex: index,
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function parseTimecodedTranscript(contents) {
  const segments = [];
  const lines = contents
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^(source|generated):/i.test(line));
  let activeSegment = null;

  for (const line of lines) {
    const match = line.match(/^(\d{1,2}:\d{2}:\d{2})\s*-\s*(\d{1,2}:\d{2}:\d{2})(?:\s+(.*))?$/);
    if (match) {
      if (activeSegment?.text) {
        segments.push(activeSegment);
      }

      activeSegment = {
        id: makeId("transcript"),
        startTime: parseTimecode(match[1]),
        endTime: Math.max(parseTimecode(match[2]), parseTimecode(match[1]) + 0.2),
        text: match[3]?.trim() ?? "",
        notes: "",
        priority: null,
        deleted: false,
        orderIndex: segments.length,
      };
      continue;
    }

    if (activeSegment) {
      activeSegment.text = activeSegment.text ? `${activeSegment.text} ${line}` : line;
    }
  }

  if (activeSegment?.text) {
    segments.push(activeSegment);
  }

  return segments;
}

function parseParagraphTranscript(contents, duration = 0) {
  const blocks = contents
    .split(/\n\s*\n+/)
    .map((block) => block.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : null;
  let cursor = 0;

  return blocks.map((text, index) => {
    const estimatedDuration = estimateSegmentDuration(text);
    const remaining = safeDuration == null ? estimatedDuration : Math.max(safeDuration - cursor, 0.2);
    const segmentsLeft = blocks.length - index;
    const maxDuration = safeDuration == null ? estimatedDuration : remaining / segmentsLeft;
    const slice = Math.max(0.2, safeDuration == null ? estimatedDuration : maxDuration);
    const startTime = safeDuration == null ? cursor : Math.min(cursor, safeDuration);
    const endTime = safeDuration == null
      ? startTime + estimatedDuration
      : Math.min(safeDuration, startTime + slice);
    cursor = endTime;

    return {
      id: makeId("transcript"),
      startTime,
      endTime: Math.max(endTime, startTime + 0.2),
      text,
      notes: "",
      priority: null,
      deleted: false,
      orderIndex: index,
    };
  });
}

function estimateSegmentDuration(text) {
  const wordCount = String(text).trim().split(/\s+/).filter(Boolean).length;
  return clamp(wordCount / 2.8, 2.5, 14);
}

function parseTimecode(value) {
  const [hours, minutes, seconds] = value.split(":").map(Number);
  return (hours * 3600) + (minutes * 60) + seconds;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
