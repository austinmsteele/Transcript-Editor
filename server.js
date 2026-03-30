import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 4173);
const DEFAULT_DATA_DIR = process.env.DATA_DIR || path.join(__dirname, ".data");
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS || 10000);
const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024;
const PROJECT_ID_PATTERN = /^[a-z0-9-]{8,}$/i;
const STATIC_MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
const AUDIO_MIME_TYPES = {
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".wav": "audio/wav",
  ".webm": "video/webm",
};

export function createApp({ rootDir = __dirname, dataDir = DEFAULT_DATA_DIR } = {}) {
  const projectsDir = path.join(dataDir, "projects");
  const audioDir = path.join(dataDir, "audio");
  const storageReadyPromise = Promise.all([
    mkdir(projectsDir, { recursive: true }),
    mkdir(audioDir, { recursive: true }),
  ]);

  return async function handleRequest(request, response) {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

    try {
      await storageReadyPromise;

      if (request.method === "GET" && url.pathname === "/health") {
        respondJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/interview-projects") {
        await handleCreateProject(response, { projectsDir });
        return;
      }

      const audioMatch = /^\/api\/interview-projects\/([^/]+)\/audio$/.exec(url.pathname);
      if (audioMatch) {
        const projectId = normalizeProjectId(audioMatch[1]);
        if (!projectId) {
          respondJson(response, 400, { error: "Invalid project id." });
          return;
        }

        if (request.method === "PUT") {
          await handleUploadProjectAudio(request, response, {
            projectId,
            projectsDir,
            audioDir,
            searchParams: url.searchParams,
          });
          return;
        }

        if (request.method === "GET" || request.method === "HEAD") {
          await handleReadProjectAudio(request, response, {
            projectId,
            projectsDir,
            audioDir,
          });
          return;
        }

        respondMethodNotAllowed(response, ["GET", "HEAD", "PUT"]);
        return;
      }

      const projectMatch = /^\/api\/interview-projects\/([^/]+)$/.exec(url.pathname);
      if (projectMatch) {
        const projectId = normalizeProjectId(projectMatch[1]);
        if (!projectId) {
          respondJson(response, 400, { error: "Invalid project id." });
          return;
        }

        if (request.method === "GET") {
          await handleReadProject(response, { projectId, projectsDir });
          return;
        }

        if (request.method === "PUT") {
          await handleUpdateProject(request, response, { projectId, projectsDir });
          return;
        }

        respondMethodNotAllowed(response, ["GET", "PUT"]);
        return;
      }

      if (request.method === "GET" || request.method === "HEAD") {
        await handleStaticFile(request, response, { rootDir, pathname: url.pathname, searchParams: url.searchParams });
        return;
      }

      respondMethodNotAllowed(response, ["GET", "HEAD"]);
    } catch (error) {
      if (error instanceof HttpError) {
        respondJson(response, error.statusCode, { error: error.message });
        return;
      }

      console.error(error);
      respondJson(response, 500, { error: "Internal server error." });
    }
  };
}

export function startServer(options = {}) {
  const server = createServer(createApp(options));
  const port = options.port ?? PORT;
  const host = options.host ?? HOST;
  server.listen(port, host, () => {
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : options.port ?? PORT;
    console.log(`Interview Timestamps Editor running at http://${host}:${actualPort}`);
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const server = startServer();
  installGracefulShutdown(server);
}

function installGracefulShutdown(
  server,
  { signals = ["SIGTERM", "SIGINT"], shutdownTimeoutMs = SHUTDOWN_TIMEOUT_MS } = {},
) {
  let isShuttingDown = false;
  const cleanupHandlers = [];

  const shutdown = (signal) => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    console.log(`${signal} received, shutting down gracefully.`);

    const forceCloseTimer = setTimeout(() => {
      console.error(`Graceful shutdown timed out after ${shutdownTimeoutMs}ms.`);
      if (typeof server.closeAllConnections === "function") {
        server.closeAllConnections();
      }
      process.exit(1);
    }, shutdownTimeoutMs);
    forceCloseTimer.unref?.();

    server.close((error) => {
      clearTimeout(forceCloseTimer);
      for (const cleanup of cleanupHandlers) {
        cleanup();
      }

      if (error) {
        console.error("Error while shutting down the server.", error);
        process.exit(1);
        return;
      }

      process.exit(0);
    });

    if (typeof server.closeIdleConnections === "function") {
      server.closeIdleConnections();
    }
  };

  for (const signal of signals) {
    const handler = () => shutdown(signal);
    process.once(signal, handler);
    cleanupHandlers.push(() => {
      process.removeListener(signal, handler);
    });
  }
}

async function handleCreateProject(response, { projectsDir }) {
  const project = createEmptyProject(randomUUID());
  await writeStoredProject(projectsDir, project);
  respondJson(response, 201, { project: serializeProjectForClient(project) });
}

async function handleReadProject(response, { projectId, projectsDir }) {
  const project = await readStoredProject(projectsDir, projectId);
  if (!project) {
    respondJson(response, 404, { error: "Shared project not found." });
    return;
  }

  respondJson(response, 200, { project: serializeProjectForClient(project) });
}

async function handleUpdateProject(request, response, { projectId, projectsDir }) {
  const project = await readStoredProject(projectsDir, projectId);
  if (!project) {
    respondJson(response, 404, { error: "Shared project not found." });
    return;
  }

  const payload = await readJsonBody(request);
  const updatedProject = {
    ...project,
    version: nextProjectVersion(project),
    updatedAt: new Date().toISOString(),
    projectName: collapseWhitespace(payload?.projectName) || project.projectName || "Untitled Project",
    transcriptFileName: String(payload?.transcriptFileName || "").trim(),
    transcriptWarning: String(payload?.transcriptWarning || "").trim(),
    speakerEditorOpen: payload?.speakerEditorOpen !== false,
    speakerAssignments: Array.isArray(payload?.speakerAssignments) ? payload.speakerAssignments : [],
    bites: Array.isArray(payload?.bites) ? payload.bites : [],
  };

  await writeStoredProject(projectsDir, updatedProject);
  respondJson(response, 200, { project: serializeProjectForClient(updatedProject) });
}

async function handleUploadProjectAudio(request, response, { projectId, projectsDir, audioDir, searchParams }) {
  const project = await readStoredProject(projectsDir, projectId);
  if (!project) {
    respondJson(response, 404, { error: "Shared project not found." });
    return;
  }

  const audioPath = getAudioPath(audioDir, projectId);
  const audioSize = await writeRequestBodyToFile(request, audioPath);
  if (!audioSize) {
    respondJson(response, 400, { error: "No audio payload received." });
    return;
  }

  const fileName = sanitizeFileName(searchParams.get("filename")) || project.audioFileName || "audio";
  const contentType = String(request.headers["content-type"] || "").trim()
    || getMimeTypeForFile(fileName)
    || "application/octet-stream";
  const updatedProject = {
    ...project,
    version: nextProjectVersion(project),
    updatedAt: new Date().toISOString(),
    audioAvailable: true,
    audioContentType: contentType,
    audioFileName: fileName,
    audioSize,
  };

  await writeStoredProject(projectsDir, updatedProject);
  respondJson(response, 200, { project: serializeProjectForClient(updatedProject) });
}

async function handleReadProjectAudio(request, response, { projectId, projectsDir, audioDir }) {
  const project = await readStoredProject(projectsDir, projectId);
  if (!project?.audioAvailable) {
    respondJson(response, 404, { error: "Shared project audio not found." });
    return;
  }

  const audioPath = getAudioPath(audioDir, projectId);
  let audioStats;
  try {
    audioStats = await stat(audioPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      respondJson(response, 404, { error: "Shared project audio not found." });
      return;
    }
    throw error;
  }

  const totalSize = audioStats.size;
  const rangeHeader = String(request.headers.range || "").trim();
  const contentType = project.audioContentType || getMimeTypeForFile(project.audioFileName) || "application/octet-stream";
  const baseHeaders = {
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Type": contentType,
    "Content-Length": String(totalSize),
    "X-Content-Type-Options": "nosniff",
  };

  if (!rangeHeader) {
    response.writeHead(200, baseHeaders);
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    await streamFile(response, createReadStream(audioPath));
    return;
  }

  const parsedRange = parseByteRange(rangeHeader, totalSize);
  if (!parsedRange) {
    response.writeHead(416, {
      ...baseHeaders,
      "Content-Range": `bytes */${totalSize}`,
    });
    response.end();
    return;
  }

  const { start, end } = parsedRange;
  response.writeHead(206, {
    ...baseHeaders,
    "Content-Length": String(end - start + 1),
    "Content-Range": `bytes ${start}-${end}/${totalSize}`,
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  await streamFile(response, createReadStream(audioPath, { start, end }));
}

async function handleStaticFile(request, response, { rootDir, pathname, searchParams }) {
  const normalizedPathname = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(rootDir, `.${normalizedPathname}`);

  if (!isPathInside(rootDir, filePath)) {
    respondJson(response, 403, { error: "Forbidden." });
    return;
  }

  try {
    const contents = await readFile(filePath);
    const extension = path.extname(filePath);
    const isHtml = extension === ".html";
    const cacheControl = isHtml
      ? "no-store"
      : searchParams.has("v")
        ? "public, max-age=31536000, immutable"
        : "public, max-age=0";

    response.writeHead(200, {
      "Cache-Control": cacheControl,
      "Content-Type": STATIC_MIME_TYPES[extension] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });

    if (request.method === "GET") {
      response.end(contents);
      return;
    }

    response.end();
  } catch (error) {
    if (error?.code === "ENOENT") {
      respondJson(response, 404, { error: "Not found." });
      return;
    }
    throw error;
  }
}

async function readJsonBody(request) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_JSON_BODY_BYTES) {
      throw new HttpError(413, "Request body too large.");
    }
    chunks.push(chunk);
  }

  if (!totalBytes) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Invalid JSON body.");
  }
}

async function writeRequestBodyToFile(request, destinationPath) {
  const tempPath = `${destinationPath}.${randomUUID()}.tmp`;
  const output = createWriteStream(tempPath);
  let totalBytes = 0;

  try {
    for await (const chunk of request) {
      totalBytes += chunk.length;
      if (!output.write(chunk)) {
        await once(output, "drain");
      }
    }

    await new Promise((resolve, reject) => {
      output.on("error", reject);
      output.end(resolve);
    });

    await rename(tempPath, destinationPath);
    return totalBytes;
  } catch (error) {
    output.destroy();
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function readStoredProject(projectsDir, projectId) {
  try {
    const raw = await readFile(getProjectPath(projectsDir, projectId), "utf8");
    return normalizeStoredProject(JSON.parse(raw), projectId);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeStoredProject(projectsDir, project) {
  const projectPath = getProjectPath(projectsDir, project.id);
  const tempPath = `${projectPath}.${randomUUID()}.tmp`;
  await writeFile(tempPath, JSON.stringify(project, null, 2));
  await rename(tempPath, projectPath);
}

function createEmptyProject(id) {
  const timestamp = new Date().toISOString();
  return {
    id,
    version: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    projectName: "",
    transcriptFileName: "",
    transcriptWarning: "",
    speakerEditorOpen: true,
    speakerAssignments: [],
    bites: [],
    audioAvailable: false,
    audioContentType: "",
    audioFileName: "",
    audioSize: 0,
  };
}

function normalizeStoredProject(project, projectId) {
  const safeProject = project && typeof project === "object" ? project : {};
  return {
    ...createEmptyProject(projectId),
    ...safeProject,
    id: projectId,
    version: Math.max(0, Number(safeProject.version) || 0),
    projectName: collapseWhitespace(safeProject.projectName) || "",
    transcriptFileName: String(safeProject.transcriptFileName || "").trim(),
    transcriptWarning: String(safeProject.transcriptWarning || "").trim(),
    speakerEditorOpen: safeProject.speakerEditorOpen !== false,
    speakerAssignments: Array.isArray(safeProject.speakerAssignments) ? safeProject.speakerAssignments : [],
    bites: Array.isArray(safeProject.bites) ? safeProject.bites : [],
    audioAvailable: Boolean(safeProject.audioAvailable),
    audioContentType: String(safeProject.audioContentType || "").trim(),
    audioFileName: String(safeProject.audioFileName || "").trim(),
    audioSize: Math.max(0, Number(safeProject.audioSize) || 0),
  };
}

function serializeProjectForClient(project) {
  return {
    id: project.id,
    version: project.version,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    projectName: project.projectName,
    transcriptFileName: project.transcriptFileName,
    transcriptWarning: project.transcriptWarning,
    speakerEditorOpen: project.speakerEditorOpen,
    speakerAssignments: project.speakerAssignments,
    bites: project.bites,
    audioAvailable: Boolean(project.audioAvailable),
    audioFileName: project.audioFileName,
  };
}

function getProjectPath(projectsDir, projectId) {
  return path.join(projectsDir, `${projectId}.json`);
}

function getAudioPath(audioDir, projectId) {
  return path.join(audioDir, `${projectId}.bin`);
}

function normalizeProjectId(value) {
  const projectId = String(value || "").trim();
  return PROJECT_ID_PATTERN.test(projectId) ? projectId : "";
}

function sanitizeFileName(value) {
  return String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function collapseWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function nextProjectVersion(project) {
  return Math.max(0, Number(project?.version) || 0) + 1;
}

function getMimeTypeForFile(fileName) {
  return AUDIO_MIME_TYPES[path.extname(String(fileName || "")).toLowerCase()] || "";
}

function parseByteRange(rangeHeader, totalSize) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader);
  if (!match || totalSize <= 0) {
    return null;
  }

  const startText = match[1];
  const endText = match[2];

  if (!startText && !endText) {
    return null;
  }

  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      return null;
    }
    return {
      start: Math.max(0, totalSize - suffixLength),
      end: totalSize - 1,
    };
  }

  const start = Number(startText);
  const end = endText ? Number(endText) : totalSize - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= totalSize) {
    return null;
  }

  return {
    start,
    end: Math.min(end, totalSize - 1),
  };
}

function isPathInside(rootDir, targetPath) {
  const relativePath = path.relative(rootDir, targetPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

async function streamFile(response, stream) {
  try {
    for await (const chunk of stream) {
      if (!response.write(chunk)) {
        await once(response, "drain");
      }
    }
    response.end();
  } catch (error) {
    stream.destroy();
    throw error;
  }
}

function respondJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

function respondMethodNotAllowed(response, allowedMethods) {
  response.writeHead(405, {
    Allow: allowedMethods.join(", "),
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify({ error: "Method not allowed." }));
}

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}
