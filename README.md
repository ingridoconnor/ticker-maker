# Ticker Maker

A local full-stack prototype for a reusable, customizable scrolling news-ticker video tool.

## What It Does

- Upload a video.
- Preview it in an Instagram-friendly frame.
- Customize ticker text, colors, font, size, banner height, opacity, and speed.
- Export by rendering the ticker in the browser, then converting the rendered WebM to MP4 on the backend.

## Run Locally

```bash
npm run dev
```

Then open:

```text
http://localhost:4000
```

No package install is needed. This version uses plain HTML/CSS/JS, Node's built-in server APIs, and the system `ffmpeg` binary.

`npm run dev` starts one Node server. That one server handles both:

- the frontend at `http://localhost:4000`
- backend routes like `/api/health`, `/api/transcode`, and the older `/api/export`

You do not need to run a separate frontend server.

## If Export Says `spawn ffmpeg ENOENT`

That means the app is running, but your computer cannot find FFmpeg.

On a Mac, install it with Homebrew:

```bash
brew install ffmpeg
```

Then confirm it works:

```bash
which ffmpeg
ffmpeg -version
```

Restart the app:

```bash
npm run dev
```

If FFmpeg is already installed but the app still cannot find it, pass the full path:

```bash
FFMPEG_PATH=/opt/homebrew/bin/ffmpeg npm run dev
```

On older Intel Macs, the path may be:

```bash
FFMPEG_PATH=/usr/local/bin/ffmpeg npm run dev
```

## If Export Says `No such filter: 'drawtext'`

The app needs an FFmpeg build with the `drawtext` filter so it can burn the moving text into the video.

Check the FFmpeg you want the app to use:

```bash
$(brew --prefix)/bin/ffmpeg -filters | grep drawtext
```

If nothing prints, install the Homebrew FFmpeg build:

```bash
brew install ffmpeg
```

Then, in Terminal from the `ticker-maker-prototype` project folder, stop the app with `Ctrl+C` if it is already running and start it again with the Homebrew FFmpeg path:

```bash
FFMPEG_PATH=$(brew --prefix)/bin/ffmpeg npm run dev
```

The server will print which FFmpeg it is using. You can also open this in your browser:

```text
http://localhost:4000/api/health
```

You should see something like:

```json
{"ok":true,"ffmpegCommand":"/opt/homebrew/bin/ffmpeg","filters":{"drawtext":true,"subtitles":true,"overlay":true,"svg":true}}
```

If `drawtext` is false but `subtitles` is true, export can still work because the app has a subtitle-based ticker fallback.

If both are false, export can still work if `overlay` and `svg` are true, because the app has an SVG ticker fallback.

## Notes

- The main export path renders vertical `1080x1920` video in the browser first.
- The backend then transcodes that browser-rendered WebM to MP4.
- If MP4 conversion fails, the app offers the WebM export as a fallback download.
- Uploaded and rendered files are stored in `tmp`, which is ignored by git.
- This is an MVP scaffold: no accounts, no cloud storage, no deployment config yet.
