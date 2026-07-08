const settings = {
  text: "BREAKING NEWS!!......",
  bannerColor: "#050505",
  textColor: "#ffffff",
  fontFamily: "Arial Black",
  fontSize: 42,
  bannerHeight: 140,
  opacity: 0.88,
  speed: 14,
  verticalPosition: 100,
};

const presets = {
  classic: {
    bannerColor: "#050505",
    textColor: "#ffffff",
    fontFamily: "Arial Black",
    opacity: 0.88,
  },
  emergency: {
    bannerColor: "#c40018",
    textColor: "#fff36d",
    fontFamily: "Impact",
    opacity: 0.94,
  },
  tabloid: {
    bannerColor: "#ffd400",
    textColor: "#111111",
    fontFamily: "Arial Black",
    opacity: 0.96,
  },
  publicAccess: {
    bannerColor: "#0037a6",
    textColor: "#f7f7f7",
    fontFamily: "Courier New",
    opacity: 0.9,
  },
};

let videoFile = null;

const dom = {
  previewVideo: document.querySelector("#previewVideo"),
  emptyPreview: document.querySelector("#emptyPreview"),
  tickerBar: document.querySelector("#tickerBar"),
  tickerText: document.querySelector("#tickerText"),
  playButton: document.querySelector("#playButton"),
  restartButton: document.querySelector("#restartButton"),
  muteButton: document.querySelector("#muteButton"),
  timeLabel: document.querySelector("#timeLabel"),
  exportButton: document.querySelector("#exportButton"),
  downloadLink: document.querySelector("#downloadLink"),
  error: document.querySelector("#error"),
  videoInput: document.querySelector("#videoInput"),
  fileName: document.querySelector("#fileName"),
  textInput: document.querySelector("#textInput"),
  bannerColorInput: document.querySelector("#bannerColorInput"),
  textColorInput: document.querySelector("#textColorInput"),
  fontInput: document.querySelector("#fontInput"),
  fontSizeInput: document.querySelector("#fontSizeInput"),
  bannerHeightInput: document.querySelector("#bannerHeightInput"),
  opacityInput: document.querySelector("#opacityInput"),
  speedInput: document.querySelector("#speedInput"),
  verticalPositionInput: document.querySelector("#verticalPositionInput"),
  fontSizeLabel: document.querySelector("#fontSizeLabel"),
  bannerHeightLabel: document.querySelector("#bannerHeightLabel"),
  opacityLabel: document.querySelector("#opacityLabel"),
  speedLabel: document.querySelector("#speedLabel"),
  verticalPositionLabel: document.querySelector("#verticalPositionLabel"),
};

dom.videoInput.addEventListener("change", (event) => {
  videoFile = event.target.files?.[0] || null;
  dom.downloadLink.hidden = true;
  dom.downloadLink.removeAttribute("href");

  if (!videoFile) {
    dom.previewVideo.hidden = true;
    dom.emptyPreview.hidden = false;
    dom.exportButton.disabled = true;
    setPreviewControlsEnabled(false);
    dom.fileName.textContent = "MP4 or MOV works best.";
    return;
  }

  dom.previewVideo.src = URL.createObjectURL(videoFile);
  dom.previewVideo.muted = false;
  dom.previewVideo.volume = 1;
  dom.previewVideo.hidden = false;
  dom.emptyPreview.hidden = true;
  dom.exportButton.disabled = false;
  setPreviewControlsEnabled(true);
  syncPlaybackControls();
  dom.fileName.textContent = videoFile.name;
});

dom.playButton.addEventListener("click", async () => {
  if (!videoFile) return;

  if (dom.previewVideo.paused) {
    await dom.previewVideo.play();
  } else {
    dom.previewVideo.pause();
  }

  syncPlaybackControls();
});

dom.restartButton.addEventListener("click", async () => {
  if (!videoFile) return;
  dom.previewVideo.currentTime = 0;
  await dom.previewVideo.play();
  syncPlaybackControls();
});

dom.muteButton.addEventListener("click", () => {
  dom.previewVideo.muted = !dom.previewVideo.muted;
  syncPlaybackControls();
});

dom.previewVideo.addEventListener("play", syncPlaybackControls);
dom.previewVideo.addEventListener("pause", syncPlaybackControls);
dom.previewVideo.addEventListener("volumechange", syncPlaybackControls);
dom.previewVideo.addEventListener("loadedmetadata", syncPlaybackControls);
dom.previewVideo.addEventListener("timeupdate", syncPlaybackControls);

dom.textInput.addEventListener("input", (event) => {
  settings.text = event.target.value;
  render();
});

dom.bannerColorInput.addEventListener("input", (event) => {
  settings.bannerColor = event.target.value;
  render();
});

dom.textColorInput.addEventListener("input", (event) => {
  settings.textColor = event.target.value;
  render();
});

dom.fontInput.addEventListener("input", (event) => {
  settings.fontFamily = event.target.value;
  render();
});

dom.fontSizeInput.addEventListener("input", (event) => {
  settings.fontSize = Number(event.target.value);
  render();
});

dom.bannerHeightInput.addEventListener("input", (event) => {
  settings.bannerHeight = Number(event.target.value);
  render();
});

dom.opacityInput.addEventListener("input", (event) => {
  settings.opacity = Number(event.target.value);
  render();
});

dom.speedInput.addEventListener("input", (event) => {
  settings.speed = Number(event.target.value);
  render();
});

dom.verticalPositionInput.addEventListener("input", (event) => {
  settings.verticalPosition = Number(event.target.value);
  render();
});

document.querySelectorAll("[data-preset]").forEach((button) => {
  button.addEventListener("click", () => {
    Object.assign(settings, presets[button.dataset.preset]);
    syncControls();
    render();
  });
});

dom.exportButton.addEventListener("click", async () => {
  if (!videoFile) return;

  dom.exportButton.disabled = true;
  dom.exportButton.textContent = "Rendering on server...";
  dom.downloadLink.hidden = true;
  setError("");

  try {
    const response = await fetch(
      `/api/export?settings=${encodeURIComponent(JSON.stringify(settings))}`,
      {
        method: "POST",
        headers: {
          "Content-Type": videoFile.type || "application/octet-stream",
        },
        body: videoFile,
      },
    );

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error || "Export failed.");
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    dom.downloadLink.href = url;
    dom.downloadLink.download = "ticker-maker-export.mp4";
    dom.downloadLink.textContent = "Download MP4 export";
    dom.downloadLink.hidden = false;
  } catch (error) {
    setError(error instanceof Error ? error.message : "Something went wrong.");
  } finally {
    dom.exportButton.disabled = !videoFile;
    dom.exportButton.textContent = "Export MP4";
  }
});

async function renderBrowserExport() {
  await ensureVideoReady();

  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1920;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Could not create a browser canvas renderer.");
  }

  const mimeType = chooseRecorderMimeType();
  if (!mimeType) {
    throw new Error(
      "This browser does not support MediaRecorder video export.",
    );
  }

  const fps = 30;
  const canvasStream = canvas.captureStream(fps);
  const sourceStream = getVideoCaptureStream(dom.previewVideo);

  if (sourceStream) {
    sourceStream
      .getAudioTracks()
      .forEach((track) => canvasStream.addTrack(track));
  }

  const chunks = [];
  const recorder = new MediaRecorder(canvasStream, {
    mimeType,
    videoBitsPerSecond: 8_000_000,
    audioBitsPerSecond: 160_000,
  });

  const previous = {
    currentTime: dom.previewVideo.currentTime,
    paused: dom.previewVideo.paused,
    loop: dom.previewVideo.loop,
    volume: dom.previewVideo.volume,
    muted: dom.previewVideo.muted,
  };

  dom.previewVideo.pause();
  dom.previewVideo.loop = false;
  dom.previewVideo.muted = false;
  dom.previewVideo.volume = 0;

  await seekVideo(0);

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });

  const stopped = new Promise((resolve) => {
    recorder.addEventListener("stop", resolve, { once: true });
  });

  let animationId = null;

  function drawFrame() {
    drawExportFrame(context, canvas, dom.previewVideo, settings);

    if (!dom.previewVideo.ended && !dom.previewVideo.paused) {
      animationId = requestAnimationFrame(drawFrame);
    }
  }

  recorder.start(100);
  await dom.previewVideo.play();
  drawFrame();

  await Promise.race([
    waitForEvent(dom.previewVideo, "ended"),
    waitForDuration((dom.previewVideo.duration || 30) * 1000 + 750),
  ]);

  if (animationId !== null) cancelAnimationFrame(animationId);
  drawExportFrame(context, canvas, dom.previewVideo, settings);

  if (recorder.state !== "inactive") recorder.stop();
  await stopped;

  dom.previewVideo.pause();
  dom.previewVideo.loop = previous.loop;
  dom.previewVideo.volume = previous.volume;
  dom.previewVideo.muted = previous.muted;
  dom.previewVideo.currentTime = Math.min(
    previous.currentTime,
    dom.previewVideo.duration || 0,
  );
  if (!previous.paused) await dom.previewVideo.play();
  syncPlaybackControls();

  return new Blob(chunks, { type: mimeType });
}

function drawExportFrame(context, canvas, video, currentSettings) {
  context.clearRect(0, 0, canvas.width, canvas.height);
  drawCoverVideo(context, canvas, video);

  const bannerHeight = currentSettings.bannerHeight;
  const bannerY =
    ((canvas.height - bannerHeight) * currentSettings.verticalPosition) / 100;

  context.save();
  context.globalAlpha = currentSettings.opacity;
  context.fillStyle = currentSettings.bannerColor;
  context.fillRect(0, bannerY, canvas.width, bannerHeight);
  context.restore();

  const fontSize = currentSettings.fontSize;
  const fontFamily = currentSettings.fontFamily;
  const text = currentSettings.text || "TYPE YOUR TICKER TEXT";
  const duration = Math.max(6, 28 - currentSettings.speed);
  const elapsed = video.currentTime || 0;
  const progress = (elapsed % duration) / duration;

  context.font = `900 ${fontSize}px ${fontFamily}, Arial, sans-serif`;
  context.fillStyle = currentSettings.textColor;
  context.textBaseline = "middle";

  const textWidth = context.measureText(text).width;
  const x = canvas.width - progress * (canvas.width + textWidth + 160);
  const y = bannerY + bannerHeight / 2;

  context.save();
  context.beginPath();
  context.rect(0, bannerY, canvas.width, bannerHeight);
  context.clip();
  context.fillText(text, x, y);
  context.restore();
}

function drawCoverVideo(context, canvas, video) {
  const videoWidth = video.videoWidth || canvas.width;
  const videoHeight = video.videoHeight || canvas.height;
  const scale = Math.max(
    canvas.width / videoWidth,
    canvas.height / videoHeight,
  );
  const width = videoWidth * scale;
  const height = videoHeight * scale;
  const x = (canvas.width - width) / 2;
  const y = (canvas.height - height) / 2;

  context.drawImage(video, x, y, width, height);
}

function chooseRecorderMimeType() {
  const types = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];

  return types.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function getVideoCaptureStream(video) {
  if (typeof video.captureStream === "function") return video.captureStream();
  if (typeof video.mozCaptureStream === "function")
    return video.mozCaptureStream();
  return null;
}

function ensureVideoReady() {
  if (dom.previewVideo.readyState >= 2) return Promise.resolve();
  return waitForEvent(dom.previewVideo, "loadeddata");
}

function seekVideo(time) {
  return new Promise((resolve) => {
    const video = dom.previewVideo;

    if (Math.abs(video.currentTime - time) < 0.05 && video.readyState >= 2) {
      resolve();
      return;
    }

    video.addEventListener("seeked", resolve, { once: true });
    video.currentTime = time;
  });
}

function waitForEvent(target, eventName) {
  return new Promise((resolve) => {
    target.addEventListener(eventName, resolve, { once: true });
  });
}

function waitForDuration(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function syncControls() {
  dom.textInput.value = settings.text;
  dom.bannerColorInput.value = settings.bannerColor;
  dom.textColorInput.value = settings.textColor;
  dom.fontInput.value = settings.fontFamily;
  dom.fontSizeInput.value = settings.fontSize;
  dom.bannerHeightInput.value = settings.bannerHeight;
  dom.opacityInput.value = settings.opacity;
  dom.speedInput.value = settings.speed;
  dom.verticalPositionInput.value = settings.verticalPosition;
}

function render() {
  const duration = Math.max(6, 28 - settings.speed);

  dom.tickerText.textContent = settings.text || "TYPE YOUR TICKER TEXT";
  dom.tickerText.style.color = settings.textColor;
  dom.tickerText.style.fontFamily = settings.fontFamily;
  dom.tickerText.style.fontSize = `${settings.fontSize}px`;
  dom.tickerText.style.animationDuration = `${duration}s`;

  dom.tickerBar.style.height = `${settings.bannerHeight}px`;
  dom.tickerBar.style.backgroundColor = settings.bannerColor;
  dom.tickerBar.style.opacity = settings.opacity;
  dom.tickerBar.style.top = `${settings.verticalPosition}%`;
  dom.tickerBar.style.transform = `translateY(-${settings.verticalPosition}%)`;

  dom.fontSizeLabel.textContent = `Font Size: ${settings.fontSize}px`;
  dom.bannerHeightLabel.textContent = `Banner Height: ${settings.bannerHeight}px`;
  dom.opacityLabel.textContent = `Opacity: ${Math.round(settings.opacity * 100)}%`;
  dom.speedLabel.textContent = `Speed: ${settings.speed}`;
  dom.verticalPositionLabel.textContent = `Vertical Position: ${settings.verticalPosition}%`;
}

function setError(message) {
  dom.error.textContent = message;
  dom.error.hidden = !message;
}

function setPreviewControlsEnabled(enabled) {
  dom.playButton.disabled = !enabled;
  dom.restartButton.disabled = !enabled;
  dom.muteButton.disabled = !enabled;
}

function syncPlaybackControls() {
  dom.playButton.textContent = dom.previewVideo.paused ? "Play" : "Pause";
  dom.muteButton.textContent = dom.previewVideo.muted ? "Unmute" : "Mute";
  dom.timeLabel.textContent = `${formatTime(dom.previewVideo.currentTime)} / ${formatTime(
    dom.previewVideo.duration,
  )}`;
}

function formatTime(value) {
  if (!Number.isFinite(value)) return "0:00";

  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60)
    .toString()
    .padStart(2, "0");

  return `${minutes}:${seconds}`;
}

syncControls();
render();
