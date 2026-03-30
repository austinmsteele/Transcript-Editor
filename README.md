# Interview Timestamps Editor

Browser-based interview editor for uploading audio, lining it up with a transcript, and sharing editable project links with collaborators.

## Current build

- Upload audio files (`.mp3`, `.wav`, `.m4a`, `.mp4`, `.mov`, `.webm`)
- Upload an existing transcript (`.txt`, `.srt`, `.vtt`)
- Review and edit transcript lines
- Extract soundbites into reorderable script cards
- Sync cards to source audio playback
- Add producer notes, tone tags, and filters
- Save the current project and share it with others through a link
- Export the active sequence through a print-ready PDF view

## Local run

Install dependencies and start the server:

```bash
npm install
npm start
```

Then open [http://localhost:4173](http://localhost:4173).

Shared project data is stored in `.data/` by default.

## Deploy on Render

This repo now includes `render.yaml` for a Render web service.

- Push this project to GitHub, GitLab, or Bitbucket.
- In Render, create a new Blueprint instance from the repo.
- Keep the included persistent disk enabled so shared project links and uploaded audio survive restarts and redeploys.
- Render will install with `npm ci`, start with `npm start`, and check service health at `/health`.
- The included Blueprint mounts persistent storage at `/var/data` and sets `DATA_DIR=/var/data` so uploaded audio and saved projects survive deploys.
- Deploy, then open the generated `onrender.com` URL and share links from there.

The server uses the `DATA_DIR` environment variable for shared project storage. The included Render config mounts a disk at `/var/data` and points `DATA_DIR` there automatically.

The Node server also handles `SIGTERM` and `SIGINT` gracefully so Render restarts can finish in-flight requests before the process exits.

## Tests

```bash
npm test
```
