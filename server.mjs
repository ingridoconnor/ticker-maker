import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const tmpDir = path.join(__dirname, "tmp");
const uploadDir = path.join(tmpDir, "uploads");
const outputDir = path.join(tmpDir, "outputs");
const port = Number(process.env.PORT || 4000);
const ffmpegCommand = resolveFfmpegCommand();

await mkdir(uploadDir, { recursive: true });
await mkdir(outputDir, { recursive: true });

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      const filters = await detectFfmpegFilters();
      sendJson(res, 200, { ok: true, ffmpegCommand, filters });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/export") {
      await handleExport(req, res, url);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/transcode") {
      await handleTranscode(req, res);
      return;
    }

    if (req.method === "GET") {
      await serveStatic(url.pathname, res);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed." });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : "Something went wrong.",
    });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Ticker Maker running on port ${port}`);
  console.log(`Using FFmpeg command: ${ffmpegCommand}`);
});

async function handleExport(req, res, url) {
  const settings = parseSettings(url.searchParams.get("settings"));
  const uploadPath = path.join(uploadDir, `${Date.now()}-upload`);
  const outputPath = path.join(outputDir, `${Date.now()}-ticker.mp4`);

  try {
    await writeRequestToFile(req, uploadPath);
    await renderTickerVideo(uploadPath, outputPath, settings);
    const outputStat = await stat(outputPath);

    res.writeHead(200, {
      "Content-Type": "video/mp4",
      "Content-Length": outputStat.size,
      "Content-Disposition": 'attachment; filename="ticker-maker-export.mp4"',
    });

    createReadStream(outputPath)
      .on("close", () => {
        cleanup(uploadPath);
        cleanup(outputPath);
      })
      .pipe(res);
  } catch (error) {
    cleanup(uploadPath);
    cleanup(outputPath);
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : "Could not render video.",
    });
  }
}

async function handleTranscode(req, res) {
  const uploadPath = path.join(uploadDir, `${Date.now()}-browser-render.webm`);
  const outputPath = path.join(outputDir, `${Date.now()}-ticker.mp4`);

  try {
    await writeRequestToFile(req, uploadPath);
    await transcodeToMp4(uploadPath, outputPath);
    const outputStat = await stat(outputPath);

    res.writeHead(200, {
      "Content-Type": "video/mp4",
      "Content-Length": outputStat.size,
      "Content-Disposition": 'attachment; filename="ticker-maker-export.mp4"',
    });

    createReadStream(outputPath)
      .on("close", () => {
        cleanup(uploadPath);
        cleanup(outputPath);
      })
      .pipe(res);
  } catch (error) {
    cleanup(uploadPath);
    cleanup(outputPath);
    sendJson(res, 500, {
      error:
        error instanceof Error
          ? `Browser render succeeded, but MP4 conversion failed.\n${error.message}`
          : "Browser render succeeded, but MP4 conversion failed.",
    });
  }
}

function writeRequestToFile(req, filePath) {
  return new Promise((resolve, reject) => {
    const stream = createWriteStream(filePath);
    req.pipe(stream);
    req.on("error", reject);
    stream.on("error", reject);
    stream.on("finish", resolve);
  });
}

function parseSettings(raw) {
  let parsed = {};

  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
  }

  return {
    text:
      typeof parsed.text === "string" && parsed.text.trim()
        ? parsed.text
        : "BREAKING ... TICKER MAKER ...",
    bannerColor: sanitizeHex(parsed.bannerColor, "#050505"),
    textColor: sanitizeHex(parsed.textColor, "#ffffff"),
    fontFamily:
      typeof parsed.fontFamily === "string" ? parsed.fontFamily : "Arial Black",
    fontSize: clamp(Number(parsed.fontSize) || 42, 24, 96),
    bannerHeight: clamp(Number(parsed.bannerHeight) || 140, 80, 320),
    opacity: clamp(Number(parsed.opacity) || 0.88, 0.1, 1),
    speed: clamp(Number(parsed.speed) || 14, 4, 30),
    verticalPosition: clamp(
      Number(parsed.verticalPosition ?? (parsed.placement === "top" ? 0 : 100)),
      0,
      100,
    ),
  };
}

async function renderTickerVideo(inputPath, outputPath, settings) {
  let drawtextError;
  let subtitleError;

  try {
    await renderTickerVideoWithDrawtext(inputPath, outputPath, settings);
    return;
  } catch (error) {
    if (!error.stderr?.includes("No such filter: 'drawtext'")) {
      throw formatFfmpegError(error);
    }

    drawtextError = error;
    await cleanup(outputPath);
  }

  try {
    await renderTickerVideoWithSubtitles(inputPath, outputPath, settings);
    return;
  } catch (error) {
    if (!error.stderr?.includes("No such filter: 'subtitles'")) {
      throw formatFfmpegError(error);
    }

    subtitleError = error;
    await cleanup(outputPath);
  }

  try {
    await renderTickerVideoWithSvgOverlay(inputPath, outputPath, settings);
  } catch (svgError) {
    throw new Error(
      [
        "FFmpeg could not render the ticker with drawtext, subtitles, or SVG overlay fallback.",
        `The app is currently using: ${ffmpegCommand}.`,
        'Run `/opt/homebrew/bin/ffmpeg -filters | grep -E "drawtext|subtitles|overlay"` and `/opt/homebrew/bin/ffmpeg -decoders | grep svg` in Terminal to see what your FFmpeg supports.',
        "",
        "Drawtext error:",
        trimStderr(drawtextError?.stderr),
        "",
        "Subtitle fallback error:",
        trimStderr(subtitleError?.stderr),
        "",
        "SVG overlay fallback error:",
        trimStderr(svgError.stderr),
      ].join("\n"),
    );
  }
}

function renderTickerVideoWithDrawtext(inputPath, outputPath, settings) {
  const fontPath = resolveFont(settings.fontFamily);
  const ffmpegSpeed = Math.round(settings.speed * 28);
  const bannerHeight = Math.round(settings.bannerHeight);
  const bannerY = `(h-${bannerHeight})*${settings.verticalPosition}/100`;
  const fontOption = fontPath
    ? `fontfile='${escapeFilterPath(fontPath)}'`
    : `font='${escapeDrawtext(settings.fontFamily)}'`;
  const filter = [
    "scale='if(gt(a,9/16),-1,1080)':'if(gt(a,9/16),1920,-1)'",
    "crop=1080:1920",
    `drawbox=x=0:y=${bannerY}:w=iw:h=${bannerHeight}:color=${hexForFfmpeg(
      settings.bannerColor,
    )}@${settings.opacity.toFixed(2)}:t=fill`,
    `drawtext=${fontOption}:text='${escapeDrawtext(
      settings.text,
    )}':fontcolor=${hexForFfmpeg(settings.textColor)}:fontsize=${Math.round(
      settings.fontSize,
    )}:x='w-mod(t*${ffmpegSpeed}\\,w+tw)':y='${bannerY}+(${bannerHeight}-th)/2'`,
  ].join(",");

  const args = [
    "-y",
    "-i",
    inputPath,
    "-vf",
    filter,
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "28",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    outputPath,
  ];

  return runProcess(ffmpegCommand, args);
}

async function transcodeToMp4(inputPath, outputPath) {
  const args = [
    "-y",
    "-i",
    inputPath,
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "28",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    outputPath,
  ];

  try {
    await runProcess(ffmpegCommand, args);
  } catch (error) {
    throw formatFfmpegError(error);
  }
}

async function renderTickerVideoWithSubtitles(inputPath, outputPath, settings) {
  const duration = await getVideoDuration(inputPath);
  const bannerHeight = Math.round(settings.bannerHeight);
  const bannerY = `(h-${bannerHeight})*${settings.verticalPosition}/100`;
  const assPath = path.join(outputDir, `${Date.now()}-ticker.ass`);
  const ass = makeTickerAss(settings, duration, bannerHeight);

  await writeFile(assPath, ass, "utf8");

  const filter = [
    "scale='if(gt(a,9/16),-1,1080)':'if(gt(a,9/16),1920,-1)'",
    "crop=1080:1920",
    `drawbox=x=0:y=${bannerY}:w=iw:h=${bannerHeight}:color=${hexForFfmpeg(
      settings.bannerColor,
    )}@${settings.opacity.toFixed(2)}:t=fill`,
    `subtitles=filename='${escapeFilterPath(assPath)}'`,
  ].join(",");

  const args = [
    "-y",
    "-i",
    inputPath,
    "-vf",
    filter,
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "28",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    outputPath,
  ];

  try {
    await runProcess(ffmpegCommand, args);
  } finally {
    cleanup(assPath);
  }
}

async function renderTickerVideoWithSvgOverlay(
  inputPath,
  outputPath,
  settings,
) {
  const bannerHeight = Math.round(settings.bannerHeight);
  const ffmpegSpeed = Math.round(settings.speed * 28);
  const svgPath = path.join(outputDir, `${Date.now()}-ticker.svg`);
  const svg = makeTickerSvg(settings, bannerHeight);

  await writeFile(svgPath, svg, "utf8");

  const videoFilter = [
    "scale='if(gt(a,9/16),-1,1080)':'if(gt(a,9/16),1920,-1)'",
    "crop=1080:1920",
    `drawbox=x=0:y=(h-${bannerHeight})*${settings.verticalPosition}/100:w=iw:h=${bannerHeight}:color=${hexForFfmpeg(
      settings.bannerColor,
    )}@${settings.opacity.toFixed(2)}:t=fill`,
  ].join(",");

  const filter = [
    `[0:v]${videoFilter}[base]`,
    "[1:v]format=rgba[ticker]",
    `[base][ticker]overlay=x='main_w-mod(t*${ffmpegSpeed}\\,main_w+overlay_w)':y='(main_h-${bannerHeight})*${settings.verticalPosition}/100':format=auto[v]`,
  ].join(";");

  const args = [
    "-y",
    "-i",
    inputPath,
    "-loop",
    "1",
    "-i",
    svgPath,
    "-filter_complex",
    filter,
    "-map",
    "[v]",
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "28",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    "-movflags",
    "+faststart",
    outputPath,
  ];

  try {
    await runProcess(ffmpegCommand, args);
  } finally {
    cleanup(svgPath);
  }
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      const message =
        error.code === "ENOENT"
          ? [
              "FFmpeg was not found on this computer.",
              `The app tried to use: ${command}.`,
              "Install it with `brew install ffmpeg`, then restart the app.",
              "If FFmpeg is already installed, run the app with `FFMPEG_PATH=/path/to/ffmpeg npm run dev`.",
            ].join(" ")
          : error.message;

      reject(
        Object.assign(new Error(message), {
          stderr,
          stdout,
          originalError: error,
        }),
      );
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        Object.assign(new Error(`Process failed with exit code ${code}.`), {
          stderr,
          stdout,
          exitCode: code,
        }),
      );
    });
  });
}

function formatFfmpegError(error) {
  if (error.message?.startsWith("FFmpeg was not found")) return error;
  return new Error(`FFmpeg failed.\n${trimStderr(error.stderr)}`);
}

async function detectFfmpegFilters() {
  try {
    const filters = await runProcess(ffmpegCommand, [
      "-hide_banner",
      "-filters",
    ]);
    const decoders = await runProcess(ffmpegCommand, [
      "-hide_banner",
      "-decoders",
    ]);
    return {
      drawtext:
        filters.stdout.includes("drawtext") ||
        filters.stderr.includes("drawtext"),
      subtitles:
        filters.stdout.includes("subtitles") ||
        filters.stderr.includes("subtitles"),
      overlay:
        filters.stdout.includes("overlay") ||
        filters.stderr.includes("overlay"),
      svg:
        decoders.stdout.toLowerCase().includes("svg") ||
        decoders.stderr.toLowerCase().includes("svg"),
    };
  } catch {
    return { drawtext: false, subtitles: false, overlay: false, svg: false };
  }
}

async function getVideoDuration(inputPath) {
  const ffprobeCommand = resolveFfprobeCommand();

  try {
    const result = await runProcess(ffprobeCommand, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      inputPath,
    ]);
    const duration = Number.parseFloat(result.stdout.trim());
    return Number.isFinite(duration) && duration > 0 ? duration : 30;
  } catch {
    return 30;
  }
}

function makeTickerAss(settings, duration, bannerHeight) {
  const fontSize = Math.round(settings.fontSize);
  const top = ((1920 - bannerHeight) * settings.verticalPosition) / 100;
  const baseline = Math.round(top + (bannerHeight + fontSize * 0.72) / 2);
  const durationMs = Math.max(1000, Math.round(duration * 1000));
  const estimatedTextWidth = Math.max(
    1600,
    Math.round(settings.text.length * fontSize * 0.7),
  );
  const endX = -estimatedTextWidth - 160;
  const color = hexToAssColor(settings.textColor);
  const fontFamily = escapeAssPlainText(settings.fontFamily);
  const text = escapeAssPlainText(settings.text);

  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1080",
    "PlayResY: 1920",
    "WrapStyle: 2",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Ticker,${fontFamily},${fontSize},${color},${color},&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    `Dialogue: 0,0:00:00.00,${formatAssTime(duration)},Ticker,,0,0,0,,{\\move(1080,${baseline},${endX},${baseline},0,${durationMs})}${text}`,
  ].join("\n");
}

function makeTickerSvg(settings, bannerHeight) {
  const fontSize = Math.round(settings.fontSize);
  const width = Math.max(
    1800,
    Math.round(settings.text.length * fontSize * 0.76) + 240,
  );
  const y = Math.round(bannerHeight / 2);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${bannerHeight}" viewBox="0 0 ${width} ${bannerHeight}">`,
    `<text x="80" y="${y}" fill="${settings.textColor}" font-family="${escapeXml(
      settings.fontFamily,
    )}" font-size="${fontSize}" font-weight="900" dominant-baseline="middle">${escapeXml(
      settings.text,
    )}</text>`,
    "</svg>",
  ].join("");
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatAssTime(totalSeconds) {
  const safeSeconds = Math.max(0.1, totalSeconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = Math.floor(safeSeconds % 60);
  const centiseconds = Math.floor((safeSeconds % 1) * 100);

  return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}.${centiseconds.toString().padStart(2, "0")}`;
}

function hexToAssColor(hex) {
  const red = hex.slice(1, 3);
  const green = hex.slice(3, 5);
  const blue = hex.slice(5, 7);
  return `&H00${blue}${green}${red}`;
}

function escapeAssPlainText(text) {
  return String(text)
    .replace(/[{}]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, " ");
}

function trimStderr(stderr) {
  if (!stderr) return "No FFmpeg output was captured.";
  return stderr.split("\n").filter(Boolean).slice(-12).join("\n");
}

async function serveStatic(pathname, res) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(publicDir, safePath));

  if (!filePath.startsWith(publicDir)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const file = await readFile(filePath);
    res.writeHead(200, { "Content-Type": contentType(filePath) });
    res.end(file);
  } catch {
    sendText(res, 404, "Not found");
  }
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sendText(res, status, body) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
}

function sanitizeHex(value, fallback) {
  if (typeof value !== "string") return fallback;
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function hexForFfmpeg(hex) {
  return `0x${hex.slice(1)}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeDrawtext(text) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/%/g, "\\%");
}

function escapeFilterPath(filePath) {
  return filePath
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}

function resolveFont(fontFamily) {
  const fontsByFamily = {
    "Arial Black": [
      "/System/Library/Fonts/Supplemental/Arial Black.ttf",
      "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
      "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ],
    Impact: [
      "/System/Library/Fonts/Supplemental/Impact.ttf",
      "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf",
    ],
    "Courier New": [
      "/System/Library/Fonts/Supplemental/Courier New Bold.ttf",
      "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
    ],
    Georgia: [
      "/System/Library/Fonts/Supplemental/Georgia Bold.ttf",
      "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
    ],
    Verdana: [
      "/System/Library/Fonts/Supplemental/Verdana.ttf",
      "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ],
  };

  const candidates = fontsByFamily[fontFamily] || fontsByFamily["Arial Black"];
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

function resolveFfmpegCommand() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;

  const candidates = [
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/usr/bin/ffmpeg",
  ];

  return candidates.find((candidate) => existsSync(candidate)) || "ffmpeg";
}

function resolveFfprobeCommand() {
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;

  if (ffmpegCommand.endsWith("/ffmpeg")) {
    const sibling = `${ffmpegCommand.slice(0, -"/ffmpeg".length)}/ffprobe`;
    if (existsSync(sibling)) return sibling;
  }

  const candidates = [
    "/opt/homebrew/bin/ffprobe",
    "/usr/local/bin/ffprobe",
    "/usr/bin/ffprobe",
  ];

  return candidates.find((candidate) => existsSync(candidate)) || "ffprobe";
}

function cleanup(filePath) {
  rm(filePath, { force: true }).catch(() => {});
}
