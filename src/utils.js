import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function makeRunId(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function writeText(filePath, content) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content, "utf8");
}

export async function writeJson(filePath, value) {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readText(filePath) {
  return fs.readFile(filePath, "utf8");
}

export function extractJson(text) {
  const fencedMatch = text.match(/```json\s*([\s\S]*?)```/i);
  if (fencedMatch) {
    return JSON.parse(fencedMatch[1]);
  }

  const firstBrace = text.indexOf("{");
  const firstBracket = text.indexOf("[");
  let start = -1;

  if (firstBrace === -1) {
    start = firstBracket;
  } else if (firstBracket === -1) {
    start = firstBrace;
  } else {
    start = Math.min(firstBrace, firstBracket);
  }

  if (start === -1) {
    throw new Error("Model output does not contain JSON.");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  const openChar = text[start];
  const closeChar = openChar === "{" ? "}" : "]";

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === openChar) {
      depth += 1;
    } else if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(text.slice(start, index + 1));
      }
    }
  }

  throw new Error("Failed to parse JSON from model output.");
}

export async function runCommand(bin, args, options = {}) {
  const { stdout, stderr } = await execFileAsync(bin, args, options);
  return { stdout, stderr };
}

export function normalizeChatText(content) {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item?.type === "text") {
          return item.text || "";
        }
        return "";
      })
      .join("\n");
  }
  return String(content || "");
}

export function escapeSubtitlePath(filePath) {
  return filePath.replaceAll("\\", "\\\\").replaceAll(":", "\\:");
}

export function pickColor(index) {
  const palette = [
    [26, 71, 112],
    [81, 33, 99],
    [104, 51, 37],
    [17, 90, 72],
    [94, 37, 53],
  ];
  return palette[index % palette.length];
}

export async function createPlaceholderPpm(filePath, index) {
  const width = 160;
  const height = 90;
  const [r, g, b] = pickColor(index);
  const lines = [`P3`, `${width} ${height}`, `255`];

  for (let y = 0; y < height; y += 1) {
    const row = [];
    for (let x = 0; x < width; x += 1) {
      const mix = Math.floor(((x + y) / (width + height)) * 36);
      row.push(`${Math.min(255, r + mix)} ${Math.min(255, g + mix)} ${Math.min(255, b + mix)}`);
    }
    lines.push(row.join(" "));
  }

  await writeText(filePath, lines.join("\n"));
}

export function secondsToSrtTime(totalSeconds) {
  const ms = Math.round(totalSeconds * 1000);
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  const pad = (value, size = 2) => String(value).padStart(size, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
}

