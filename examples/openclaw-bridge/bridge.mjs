#!/usr/bin/env node
/**
 * Voice PE Realtime ↔ OpenClaw bridge — reference implementation.
 *
 * One tiny HTTP server on the machine where OpenClaw's gateway runs. It
 * implements the add-on's whole agent contract (see docs/agent-integration.md):
 *
 *   POST <secret path>  {"question": "...", "room": "kitchen"} → {"answer": "..."}
 *       Runs one OpenClaw agent turn (fresh session per request). If the turn
 *       outlives ASK_TIMEOUT_MS, replies "still working" immediately, lets the
 *       turn finish, and POSTs the eventual answer to that room's announce
 *       endpoint itself — report-back is a guarantee, not model goodwill.
 *
 *   POST <secret path>  {"recall": "grandma phone"} → {"matches": ["..."]}
 *       No agent turn: greps OpenClaw's own memory markdown (MEMORY.md, the
 *       most recent dailies, person-files) and returns matching lines. This is
 *       what makes voice recall sub-second.
 *
 * Configuration (environment, all optional unless marked):
 *   ASK_PORT            listen port                        (default 3338)
 *   ASK_PATH            secret URL path, e.g. /ask-<random> — REQUIRED, or put
 *                       it in a .ask-path file next to this script
 *   OPENCLAW_BIN        openclaw executable                (default "openclaw")
 *   OPENCLAW_AGENT      agent id to run                    (default "main")
 *   OPENCLAW_WORKSPACE  workspace dir for recall greps     (default ~/.openclaw/workspace)
 *   ASK_TIMEOUT_MS      sync window before "still working" (default 120000)
 *   ANNOUNCE_HOST       Home Assistant host IP/name — required for report-back
 *   ANNOUNCE_MAP        room=port list, e.g. "kitchen=8090,workshop=8091"
 *   ANNOUNCE_TOKEN      bearer token for the announce endpoint, or put it in a
 *                       .announce-token file next to this script
 *
 * Generate secrets:  echo "/ask-$(openssl rand -hex 12)" > .ask-path
 *                    openssl rand -hex 24 > .announce-token
 * Then set openclaw_url in the add-on to http://<this-machine>:3338<ask path>.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const readOptional = (f) => {
  try { return readFileSync(join(HERE, f), "utf8").trim(); } catch { return ""; }
};

const BIN = process.env.OPENCLAW_BIN || "openclaw";
const AGENT = process.env.OPENCLAW_AGENT || "main";
const PORT = Number(process.env.ASK_PORT || 3338);
const ASK_PATH = process.env.ASK_PATH || readOptional(".ask-path");
const WORKSPACE =
  process.env.OPENCLAW_WORKSPACE || join(homedir(), ".openclaw", "workspace");
const ASK_TIMEOUT_MS = Number(process.env.ASK_TIMEOUT_MS || 120000);
const ANNOUNCE_HOST = process.env.ANNOUNCE_HOST || "";
const ANNOUNCE_TOKEN = process.env.ANNOUNCE_TOKEN || readOptional(".announce-token");
const ANNOUNCE_PORTS = Object.fromEntries(
  (process.env.ANNOUNCE_MAP || "")
    .split(",").map((p) => p.trim().split("=")).filter((p) => p.length === 2)
    .map(([room, port]) => [room.toLowerCase(), Number(port)]),
);
const DEFAULT_ROOM = Object.keys(ANNOUNCE_PORTS)[0];

if (!ASK_PATH) {
  console.error("[bridge] ASK_PATH is required (env or .ask-path file). See header.");
  process.exit(1);
}

// Deliver a late answer to the room that asked. Requires ANNOUNCE_HOST,
// ANNOUNCE_MAP and ANNOUNCE_TOKEN; silently logs (never throws) otherwise.
async function announce(text, room) {
  const port = ANNOUNCE_PORTS[room] || ANNOUNCE_PORTS[DEFAULT_ROOM];
  if (!ANNOUNCE_HOST || !port || !ANNOUNCE_TOKEN) {
    console.log("[bridge] late answer NOT announced (announce not configured)");
    return false;
  }
  try {
    const r = await fetch(`http://${ANNOUNCE_HOST}:${port}/announce`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ANNOUNCE_TOKEN}`,
      },
      body: JSON.stringify({ message: text.slice(0, 590) }),
    });
    console.log(`[bridge] late answer announced (${room || "default"}): HTTP ${r.status}`);
    return r.ok;
  } catch (e) {
    console.log(`[bridge] late announce failed: ${String(e).slice(0, 120)}`);
    return false;
  }
}

// Deterministic recall: grep the workspace memory markdown. Filename counts
// toward the match so person-files (grandma.md) rank their detail lines
// ("- **Phone:** ...") above incidental mentions elsewhere.
function localRecall(query) {
  const terms = query.toLowerCase().split(/[^a-z0-9+]+/).filter((t) => t.length >= 3);
  if (!terms.length) return [];
  const files = [join(WORKSPACE, "MEMORY.md")];
  try {
    const dailies = readdirSync(join(WORKSPACE, "memory"))
      .filter((f) => f.endsWith(".md")).sort().slice(-30);
    files.push(...dailies.map((f) => join(WORKSPACE, "memory", f)));
  } catch { /* no memory dir yet */ }
  const scored = [];
  for (const file of files) {
    let text = "";
    try { text = readFileSync(file, "utf8"); } catch { continue; }
    const fname = file.split("/").pop().toLowerCase();
    for (const line of text.split("\n")) {
      const l = line.toLowerCase() + " " + fname;
      const hits = terms.filter((t) => l.includes(t)).length;
      if (hits > 0 && line.trim().length > 3)
        scored.push({ hits, line: line.trim().slice(0, 300), src: fname });
    }
  }
  scored.sort((x, y) => y.hits - x.hits);
  return scored.slice(0, 25).map((m) => `[${m.src}] ${m.line}`);
}

function runAgent(question, room) {
  return new Promise((resolve) => {
    const sessionKey = `voicepe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const directive =
      "[Voice request — you are answering someone speaking to their voice assistant " +
      "out loud. Act immediately using your available tools; do NOT deliberate or ask " +
      "clarifying questions — make the most reasonable assumption and do it. LOOKUPS: " +
      "when asked for a person or fact, be THOROUGH before answering not-found — check " +
      "memory files, then every source you would use for a direct request. When you " +
      "find such a fact, silently save it to a memory file (memory/<name>.md) so " +
      "future recall is instant. If the task clearly needs minutes of work (research, " +
      "multi-step jobs), reply NOW that you will report back, then do the work and " +
      "report via the Voice PE announce endpoint (see your TOOLS.md). Otherwise reply " +
      "in ONE short spoken sentence stating what you did or the answer.] ";
    const roomNote = room
      ? `[This request came from the ${room} Voice PE — announce results to that room.] `
      : "";
    const args = ["agent", "--agent", AGENT, "--session-key", sessionKey,
                  "--message", directive + roomNote + question];
    const p = spawn(BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "", timedOut = false;
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("close", (code) => {
      const text = out.trim();
      if (timedOut) {
        // The HTTP caller is long gone — deliver the answer to the room.
        if (code === 0 && text) announce(text, room);
        return;
      }
      if (code === 0 && text) resolve(text);
      else resolve(`(Could not get an answer right now.${err ? " " + err.trim().slice(0, 200) : ""})`);
    });
    setTimeout(() => {
      timedOut = true;
      resolve("(Still working on that — I'll tell you when it's ready.)");
    }, ASK_TIMEOUT_MS);
  });
}

const server = createServer((req, res) => {
  if (req.method !== "POST" || req.url !== ASK_PATH) {
    res.writeHead(404).end();
    return;
  }
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", async () => {
    let question = "", recall = "", room = "";
    try {
      const parsed = JSON.parse(body);
      question = String(parsed?.question || "").trim();
      recall = String(parsed?.recall || "").trim();
      room = String(parsed?.room || "").trim().toLowerCase();
    } catch { /* fall through to 400 */ }
    if (recall) {
      const matches = localRecall(recall);
      console.log(`[bridge] recall: ${recall.slice(0, 80)} -> ${matches.length} lines`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ matches }));
      return;
    }
    if (!question) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ answer: "question required" }));
      return;
    }
    console.log(`[bridge] question (${room || "?"}): ${question.slice(0, 120)}`);
    const answer = await runAgent(question, room);
    console.log(`[bridge] answer: ${answer.slice(0, 120)}`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ answer }));
  });
});
server.listen(PORT, "0.0.0.0", () => console.log(`[bridge] listening on :${PORT}${ASK_PATH}`));
