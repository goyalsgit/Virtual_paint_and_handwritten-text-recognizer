const elements = {
  appShell: document.getElementById("appShell"),
  videoStage: document.getElementById("videoStage"),
  videoInput: document.getElementById("videoInput"),
  youtubeUrlInput: document.getElementById("youtubeUrlInput"),
  loadYoutubeBtn: document.getElementById("loadYoutubeBtn"),
  startCameraBtn: document.getElementById("startCameraBtn"),
  dropZone: document.getElementById("dropZone"),
  mediaPlayer: document.getElementById("mediaPlayer"),
  youtubePlayerWrap: document.getElementById("youtubePlayerWrap"),
  youtubePlayer: document.getElementById("youtubePlayer"),
  emptyState: document.getElementById("emptyState"),
  currentTime: document.getElementById("currentTime"),
  durationTime: document.getElementById("durationTime"),
  seekBar: document.getElementById("seekBar"),
  fsCurrentTime: document.getElementById("fsCurrentTime"),
  fsDurationTime: document.getElementById("fsDurationTime"),
  fsSeekBar: document.getElementById("fsSeekBar"),
  fileName: document.getElementById("fileName"),
  lastAction: document.getElementById("lastAction"),
  gestureName: document.getElementById("gestureName"),
  detectedGesture: document.getElementById("detectedGesture"),
  detectedCommand: document.getElementById("detectedCommand"),
  speedBadge: document.getElementById("speedBadge"),
  playStateBadge: document.getElementById("playStateBadge"),
  cameraStatus: document.getElementById("cameraStatus"),
  webcamInput: document.getElementById("webcamInput"),
  webcamCanvas: document.getElementById("webcamCanvas"),
  toastHost: document.getElementById("toastHost"),
  gestureCursor: document.getElementById("gestureCursor"),
  fsExitBtn: document.getElementById("fsExitBtn"),
};

const state = {
  sourceType: "none",
  currentVideoUrl: null,
  currentFileName: null,
  youtubePlayer: null,
  youtubePlayerReady: false,
  youtubeVideoId: null,
  stageFocusMode: false,
  cameraStream: null,
  hands: null,
  handLoopActive: false,
  handLoopBusy: false,
  webcamReady: false,
  wristHistory: [],
  indexHistory: [],
  cooldowns: new Map(),
  lastSeenHandAt: 0,
  lastCommandAt: 0,
  pendingStaticGestureKey: null,
  pendingStaticGestureFrames: 0,
  activeStaticGestureKey: null,
  // Cursor state
  cursorX: -200,
  cursorY: -200,
  cursorVisible: false,
  cursorMode: "none",       // "pointer" | "scroll" | "click" | "none"
  lastScrollY: null,        // index tip Y in previous frame for scroll
  clickCooldown: false,     // prevent rapid repeat clicks
};

const ctx = elements.webcamCanvas.getContext("2d");
const MIN_COMMAND_GAP_MS = 400;
const STATIC_GESTURE_STABILITY_FRAMES = 5;
let youtubeApiPromise = null;

const COMMAND_MAP = {
  togglePlayPause:  { label: "Play / Pause",   cooldown: MIN_COMMAND_GAP_MS },
  seekForwardSmall: { label: "Forward 10s",     cooldown: MIN_COMMAND_GAP_MS },
  seekBackwardSmall:{ label: "Backward 10s",    cooldown: MIN_COMMAND_GAP_MS },
  seekForwardLarge: { label: "Skip +10s",       cooldown: MIN_COMMAND_GAP_MS },
  seekBackwardLarge:{ label: "Skip -10s",       cooldown: MIN_COMMAND_GAP_MS },
  volumeUp:         { label: "Volume Up",       cooldown: MIN_COMMAND_GAP_MS },
  volumeDown:       { label: "Volume Down",     cooldown: MIN_COMMAND_GAP_MS },
  toggleFullscreen: { label: "Fullscreen",      cooldown: 1500 },
};

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  elements.toastHost.appendChild(toast);
  window.setTimeout(() => {
    toast.remove();
  }, 2600);
}

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function setLastAction(text) {
  elements.lastAction.textContent = text;
}

function setGestureDisplay(name, commandLabel = "None") {
  elements.gestureName.textContent = name;
  elements.detectedGesture.textContent = name;
  elements.detectedCommand.textContent = commandLabel;
}

// Reference to the drop-zone so we can put videoStage back on exit
let _videoStageOriginalParent = null;

function setStageFocusMode(enabled) {
  state.stageFocusMode = enabled;
  document.body.classList.toggle("stage-focus-mode", enabled);
  // Lock/unlock scroll on both html and body so no scrollable area exists in fullscreen
  document.documentElement.style.overflow = enabled ? "hidden" : "";
  document.body.style.overflow = enabled ? "hidden" : "";

  const videoStage = elements.videoStage;

  if (enabled) {
    // Move videoStage out of its clipping ancestors (drop-zone → player-col → glass)
    // directly onto <body> so position:fixed works from the true viewport
    _videoStageOriginalParent = videoStage.parentElement;
    document.body.appendChild(videoStage);
  } else {
    // Put it back where it was
    if (_videoStageOriginalParent && videoStage.parentElement === document.body) {
      _videoStageOriginalParent.appendChild(videoStage);
    }
    _videoStageOriginalParent = null;
  }
}

function requireMedia() {
  if (state.sourceType === "local" && state.currentVideoUrl) {
    return true;
  }

  if (state.sourceType === "youtube" && state.youtubePlayerReady && state.youtubePlayer) {
    return true;
  }

  showToast("Choose a local video or paste a YouTube link first.");
  elements.lastAction.textContent = "No media loaded";
  return false;
}

function switchVisualSource(sourceType) {
  const showLocal = sourceType === "local";
  const showYoutube = sourceType === "youtube";
  elements.mediaPlayer.classList.toggle("hidden", !showLocal);
  elements.youtubePlayerWrap.classList.toggle("hidden", !showYoutube);
  elements.emptyState.classList.toggle("hidden", sourceType !== "none");
}

function clearLocalSource() {
  if (state.currentVideoUrl) {
    URL.revokeObjectURL(state.currentVideoUrl);
  }
  state.currentVideoUrl = null;
  state.currentFileName = null;
  elements.mediaPlayer.pause();
  elements.mediaPlayer.removeAttribute("src");
  elements.mediaPlayer.load();
}

function clearYoutubeSource() {
  if (state.youtubePlayer) {
    try { state.youtubePlayer.stopVideo(); } catch (_e) {}
  }
  state.youtubePlayerReady = false;
  state.youtubeVideoId = null;
}

function destroyYoutubePlayer() {
  if (state.youtubePlayer) {
    try { state.youtubePlayer.destroy(); } catch (_e) {}
    state.youtubePlayer = null;
  }
  state.youtubePlayerReady = false;
  state.youtubeVideoId = null;
  // Re-create the empty target div for next YouTube load
  elements.youtubePlayerWrap.innerHTML = '<div id="youtubePlayer"></div>';
}

function getYoutubeStateLabel() {
  if (!state.youtubePlayerReady || !window.YT || !state.youtubePlayer) {
    return "Idle";
  }

  const playerState = state.youtubePlayer.getPlayerState();
  if (playerState === YT.PlayerState.PLAYING) return "Playing";
  if (playerState === YT.PlayerState.PAUSED) return "Paused";
  if (playerState === YT.PlayerState.ENDED) return "Ended";
  if (playerState === YT.PlayerState.BUFFERING) return "Buffering";
  return "Ready";
}

function getActiveCurrentTime() {
  if (state.sourceType === "youtube" && state.youtubePlayerReady && state.youtubePlayer) {
    return Number(state.youtubePlayer.getCurrentTime()) || 0;
  }
  return elements.mediaPlayer.currentTime || 0;
}

function getActiveDuration() {
  if (state.sourceType === "youtube" && state.youtubePlayerReady && state.youtubePlayer) {
    return Number(state.youtubePlayer.getDuration()) || 0;
  }
  return Number.isNaN(elements.mediaPlayer.duration) ? 0 : elements.mediaPlayer.duration;
}

function getActivePlaybackRate() {
  if (state.sourceType === "youtube" && state.youtubePlayerReady && state.youtubePlayer) {
    return Number(state.youtubePlayer.getPlaybackRate()) || 1;
  }
  return elements.mediaPlayer.playbackRate || 1;
}

function getActiveVolume() {
  if (state.sourceType === "youtube" && state.youtubePlayerReady && state.youtubePlayer) {
    return (Number(state.youtubePlayer.getVolume()) || 0) / 100;
  }
  return elements.mediaPlayer.volume;
}

function setActiveVolume(vol) {
  const bounded = Math.max(0, Math.min(1, vol));
  if (state.sourceType === "youtube" && state.youtubePlayerReady && state.youtubePlayer) {
    state.youtubePlayer.setVolume(Math.round(bounded * 100));
  } else {
    elements.mediaPlayer.volume = bounded;
  }
  setLastAction(`Volume: ${Math.round(bounded * 100)}%`);
  showToast(`Volume ${Math.round(bounded * 100)}%`);
}

function isActivePaused() {
  if (state.sourceType === "youtube" && state.youtubePlayerReady && state.youtubePlayer && window.YT) {
    return state.youtubePlayer.getPlayerState() !== YT.PlayerState.PLAYING;
  }
  return elements.mediaPlayer.paused;
}

function updatePlayerMeta() {
  const current = getActiveCurrentTime();
  const duration = getActiveDuration();
  const timeStr = formatTime(current);
  const durStr = formatTime(duration);

  elements.currentTime.textContent = timeStr;
  elements.durationTime.textContent = durStr;
  elements.fsCurrentTime.textContent = timeStr;
  elements.fsDurationTime.textContent = durStr;
  elements.speedBadge.textContent = `${Math.round(getActiveVolume() * 100)}%`;
  elements.playStateBadge.textContent =
    state.sourceType === "youtube" ? getYoutubeStateLabel() : (elements.mediaPlayer.paused ? "Paused" : "Playing");

  if (duration > 0 && !elements.seekBar.matches(":active") && !elements.fsSeekBar.matches(":active")) {
    const val = String((current / duration) * 1000);
    elements.seekBar.value = val;
    elements.fsSeekBar.value = val;
  } else if (state.sourceType === "none") {
    elements.seekBar.value = "0";
    elements.fsSeekBar.value = "0";
    elements.speedBadge.textContent = "1.00x";
    elements.playStateBadge.textContent = "Idle";
  }
}

function normalizeYoutubeInput(input) {
  const trimmed = (input || "").trim();
  if (!trimmed) {
    return "";
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function extractYouTubeVideoId(input) {
  if (!input) {
    return null;
  }

  try {
    const url = new URL(normalizeYoutubeInput(input));
    const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");

    if (host === "youtu.be") {
      return url.pathname.split("/").filter(Boolean)[0] || null;
    }

    if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com") || host.endsWith("music.youtube.com")) {
      if (url.pathname === "/watch") {
        return url.searchParams.get("v");
      }

      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "live") {
        return parts[1] || null;
      }
    }
  } catch (_error) {
    const match = input.trim().match(/([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
  }

  return null;
}

function ensureYouTubeApi() {
  if (window.YT && window.YT.Player) {
    return Promise.resolve();
  }

  if (youtubeApiPromise) {
    return youtubeApiPromise;
  }

  youtubeApiPromise = new Promise((resolve, reject) => {
    const previousCallback = window.onYouTubeIframeAPIReady;
    let settled = false;

    const finishResolve = () => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearInterval(pollId);
      window.clearTimeout(timeoutId);
      resolve();
    };

    const finishReject = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearInterval(pollId);
      window.clearTimeout(timeoutId);
      reject(error);
    };

    window.onYouTubeIframeAPIReady = () => {
      if (typeof previousCallback === "function") {
        previousCallback();
      }
      finishResolve();
    };

    const existingScript = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    if (!existingScript) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => finishReject(new Error("YouTube API failed to load"));
      document.head.appendChild(script);
    }

    const pollId = window.setInterval(() => {
      if (window.YT && window.YT.Player) {
        finishResolve();
      }
    }, 120);

    const timeoutId = window.setTimeout(() => {
      if (!(window.YT && window.YT.Player)) {
        finishReject(new Error("Timed out waiting for YouTube API"));
      }
    }, 10000);
  });

  return youtubeApiPromise;
}

function setActivePlaybackRate(rate) {
  if (!requireMedia()) {
    return;
  }

  const bounded = Math.max(0.5, Math.min(rate, 2.0));
  if (state.sourceType === "youtube" && state.youtubePlayerReady && state.youtubePlayer) {
    state.youtubePlayer.setPlaybackRate(bounded);
  } else {
    elements.mediaPlayer.playbackRate = bounded;
  }
  updatePlayerMeta();
  setLastAction(`Playback speed set to ${bounded.toFixed(2)}x`);
}

function setActiveTime(seconds) {
  if (!requireMedia()) {
    return;
  }

  const duration = getActiveDuration();
  const target = Math.max(0, Math.min(seconds, duration || seconds));
  if (state.sourceType === "youtube" && state.youtubePlayerReady && state.youtubePlayer) {
    state.youtubePlayer.seekTo(target, true);
  } else {
    elements.mediaPlayer.currentTime = target;
  }
}

function seekBy(seconds) {
  if (!requireMedia()) {
    return;
  }

  setActiveTime(getActiveCurrentTime() + seconds);
  setLastAction(`Jumped ${seconds >= 0 ? "forward" : "backward"} ${Math.abs(seconds)}s`);
}

async function playActive(source) {
  if (!requireMedia()) {
    return;
  }

  if (state.sourceType === "youtube" && state.youtubePlayerReady && state.youtubePlayer) {
    state.youtubePlayer.playVideo();
  } else {
    await elements.mediaPlayer.play().catch(() => {});
  }
  setLastAction(`Play triggered by ${source}`);
}

function pauseActive(source) {
  if (!requireMedia()) {
    return;
  }

  if (state.sourceType === "youtube" && state.youtubePlayerReady && state.youtubePlayer) {
    state.youtubePlayer.pauseVideo();
  } else {
    elements.mediaPlayer.pause();
  }
  setLastAction(`Pause triggered by ${source}`);
}

function toggleFullscreenForActivePlayer() {
  if (!requireMedia()) {
    return;
  }

  // EXIT
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    if (document.exitFullscreen) document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    setStageFocusMode(false);
    setLastAction("Exited fullscreen");
    return;
  }

  if (state.stageFocusMode) {
    setStageFocusMode(false);
    setLastAction("Exited fullscreen");
    return;
  }

  // ENTER — always use CSS fullscreen fallback so it works consistently
  // regardless of whether we have a user-gesture token (button click vs gesture).
  // Native requestFullscreen requires a synchronous user gesture and silently
  // fails when called from an async MediaPipe callback, producing the
  // "half-page" result. The CSS fallback is reliable in all cases.
  setStageFocusMode(true);
  setLastAction("Fullscreen toggled");
}



async function loadYouTubeUrl(rawUrl) {
  const videoId = extractYouTubeVideoId(rawUrl);
  if (!videoId) {
    showToast("Paste a valid YouTube video link.");
    return;
  }

  await ensureYouTubeApi();
  clearLocalSource();
  setStageFocusMode(false);
  state.sourceType = "youtube";
  state.youtubeVideoId = videoId;
  state.youtubePlayerReady = false;
  state.currentFileName = normalizeYoutubeInput(rawUrl);
  elements.fileName.textContent = state.currentFileName;
  elements.seekBar.value = "0";
  switchVisualSource("youtube");
  setLastAction("Loading YouTube video...");

  if (!state.youtubePlayer) {
    state.youtubePlayer = new YT.Player("youtubePlayer", {
      videoId,
      host: "https://www.youtube.com",
      playerVars: {
        autoplay: 1,
        controls: 1,
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
        enablejsapi: 1,
        origin: window.location.origin,
      },
      events: {
        onReady: (event) => {
          state.youtubePlayerReady = true;
          event.target.playVideo();
          updatePlayerMeta();
          setLastAction("YouTube video loaded");
          showToast("YouTube video loaded");
        },
        onStateChange: () => {
          updatePlayerMeta();
        },
        onError: (event) => {
          state.youtubePlayerReady = false;
          const errorMessages = {
            2: "Invalid video ID.",
            5: "Video cannot play in this player.",
            100: "Video not found or private.",
            101: "Video owner has disabled embedding.",
            150: "Video owner has disabled embedding.",
            153: "Video owner has disabled embedding.",
          };
          const msg = errorMessages[event.data] || `Player error (${event.data}).`;
          setLastAction(msg);
          showToast(`YouTube: ${msg} Try a different video.`);
        },
      },
    });
  } else {
    state.youtubePlayerReady = true;
    state.youtubePlayer.loadVideoById(videoId);
    state.youtubePlayer.playVideo();
    updatePlayerMeta();
    setLastAction("YouTube video loaded");
    showToast("YouTube video loaded");
  }
}

function loadVideoFile(file) {
  if (!file) {
    return;
  }

  destroyYoutubePlayer();
  clearLocalSource();
  setStageFocusMode(false);
  state.sourceType = "none";
  switchVisualSource("none");

  state.sourceType = "local";
  state.currentVideoUrl = URL.createObjectURL(file);
  state.currentFileName = file.name;
  elements.mediaPlayer.src = state.currentVideoUrl;
  elements.mediaPlayer.load();
  elements.mediaPlayer.playbackRate = 1;
  elements.seekBar.value = "0";
  elements.fsSeekBar.value = "0";
  elements.fileName.textContent = file.name;
  elements.youtubeUrlInput.value = "";
  switchVisualSource("local");
  setLastAction("Video loaded from local storage");
  updatePlayerMeta();
  showToast(`Loaded ${file.name}`);
}

async function handleCommand(command, source = "button") {
  switch (command) {
    case "togglePlayPause":
      if (!requireMedia()) return;
      if (isActivePaused()) {
        await playActive(source);
      } else {
        pauseActive(source);
      }
      break;
    case "play":
      await playActive(source);
      break;
    case "pause":
      pauseActive(source);
      break;
    case "seekForwardSmall":
      seekBy(10);
      break;
    case "seekBackwardSmall":
      seekBy(-10);
      break;
    case "seekForwardLarge":
      seekBy(10);
      break;
    case "seekBackwardLarge":
      seekBy(-10);
      break;
    case "volumeUp":
      setActiveVolume(getActiveVolume() + 0.1);
      break;
    case "volumeDown":
      setActiveVolume(getActiveVolume() - 0.1);
      break;
    case "fullscreen":
    case "toggleFullscreen":
      toggleFullscreenForActivePlayer();
      break;
  }

  updatePlayerMeta();
}

function isFingerExtended(landmarks, tipIndex, pipIndex) {
  return landmarks[tipIndex].y < landmarks[pipIndex].y;
}

function isFingerFolded(landmarks, tipIndex, pipIndex) {
  return landmarks[tipIndex].y > landmarks[pipIndex].y - 0.01;
}

function distanceBetween(landmarks, firstIndex, secondIndex) {
  const first = landmarks[firstIndex];
  const second = landmarks[secondIndex];
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function isThumbExtended(landmarks, handedness) {
  const thumbTip = landmarks[4];
  const thumbIp = landmarks[3];
  const thumbMcp = landmarks[2];
  if (handedness === "Right") {
    return thumbTip.x < thumbIp.x && thumbIp.x < thumbMcp.x;
  }
  return thumbTip.x > thumbIp.x && thumbIp.x > thumbMcp.x;
}

function isThumbUpPose(landmarks, handedness) {
  const thumbTip = landmarks[4];
  const thumbMcp = landmarks[2];

  // FIST REJECTION: in a closed fist the thumb tip sits close to the
  // index/middle finger tips or knuckles — reject if that's the case
  const thumbNearIndex  = distanceBetween(landmarks, 4, 8)  < 0.09;
  const thumbNearMiddle = distanceBetween(landmarks, 4, 12) < 0.09;
  const thumbNearIndexMcp = distanceBetween(landmarks, 4, 5) < 0.08;
  if (thumbNearIndex || thumbNearMiddle || thumbNearIndexMcp) return false;

  // Thumb tip must be clearly above the wrist
  const thumbRaised =
    thumbTip.y < landmarks[0].y - 0.04 &&
    thumbTip.y < landmarks[5].y;

  // Thumb must be extended away from its base
  const thumbFar =
    distanceBetween(landmarks, 4, 2) > 0.11 ||
    distanceBetween(landmarks, 4, 5) > 0.12;

  // Mostly vertical direction
  const verticalDominant =
    Math.abs(thumbTip.y - thumbMcp.y) > Math.abs(thumbTip.x - thumbMcp.x) * 0.9;

  // All other fingers folded
  const foldedOthers =
    isFingerFolded(landmarks, 8, 6) &&
    isFingerFolded(landmarks, 12, 10) &&
    isFingerFolded(landmarks, 16, 14) &&
    isFingerFolded(landmarks, 20, 18);

  return thumbFar && thumbRaised && verticalDominant && foldedOthers;
}

function isThumbDownPose(landmarks, handedness) {
  const thumbTip = landmarks[4];
  const thumbMcp = landmarks[2];

  // FIST REJECTION: thumb tucked near index MCP knuckle = fist
  const thumbNearIndexMcp = distanceBetween(landmarks, 4, 5) < 0.06;
  if (thumbNearIndexMcp) return false;

  // Thumb tip must be below the wrist
  const thumbLowered = thumbTip.y > landmarks[0].y + 0.01;

  // Thumb must be extended away from its base
  const thumbFar =
    distanceBetween(landmarks, 4, 2) > 0.07 ||
    distanceBetween(landmarks, 4, 5) > 0.07;

  // Mostly vertical direction
  const verticalDominant =
    Math.abs(thumbTip.y - thumbMcp.y) > Math.abs(thumbTip.x - thumbMcp.x) * 0.5;

  // Fingers not spread wide open (use distance instead of Y-axis fold check
  // since Y-axis breaks on inverted hand)
  const fingersNotOpen =
    distanceBetween(landmarks, 8, 0) < 0.5 &&
    distanceBetween(landmarks, 12, 0) < 0.5;

  return thumbFar && thumbLowered && verticalDominant && fingersNotOpen;
}

function classifyStaticGesture(landmarks, handedness) {
  const thumbFolded = !isThumbExtended(landmarks, handedness);
  const index = isFingerExtended(landmarks, 8, 6);
  const middle = isFingerExtended(landmarks, 12, 10);
  const ring = isFingerExtended(landmarks, 16, 14);
  const pinky = isFingerExtended(landmarks, 20, 18);
  const thumbIndexDistance = distanceBetween(landmarks, 4, 8);

  // Check thumb poses FIRST — inverted hand can fool other checks
  if (isThumbUpPose(landmarks, handedness)) {
    return { name: "Thumb Up", command: "volumeUp", repeat: true };
  }

  if (isThumbDownPose(landmarks, handedness)) {
    return { name: "Thumb Down", command: "volumeDown", repeat: true };
  }

  // Three fingers up (index + middle + ring), pinky folded, thumb folded
  if (thumbFolded && index && middle && ring && !pinky) {
    return { name: "Three Fingers Up", command: "toggleFullscreen" };
  }

  if (thumbIndexDistance < 0.04 && middle && ring && pinky) {
    return { name: "OK Sign", command: "togglePlayPause" };
  }

  return null;
}

function classifySwipe(landmarks) {
  const extendedCount = [
    isFingerExtended(landmarks, 8, 6),
    isFingerExtended(landmarks, 12, 10),
    isFingerExtended(landmarks, 16, 14),
    isFingerExtended(landmarks, 20, 18),
  ].filter(Boolean).length;

  if (extendedCount < 2) {
    state.wristHistory = [];
    return null;
  }

  const now = performance.now();
  state.wristHistory.push({ x: landmarks[0].x, y: landmarks[0].y, t: now });
  state.wristHistory = state.wristHistory.filter((p) => now - p.t <= 800);

  if (state.wristHistory.length < 3) return null;

  const first = state.wristHistory[0];
  const last  = state.wristHistory[state.wristHistory.length - 1];
  const deltaX  = last.x - first.x;
  const deltaY  = Math.abs(last.y - first.y);
  const elapsed = last.t - first.t;

  if (Math.abs(deltaX) >= 0.06 && deltaY < 0.18 && elapsed < 800) {
    state.wristHistory = [];
    if (deltaX < 0) {
      return { name: "Swipe Right", command: "seekForwardLarge" };
    }
    return { name: "Swipe Left", command: "seekBackwardLarge" };
  }

  return null;
}

function classifyIndexSwipe(landmarks, handedness) {
  // Removed — two-finger swipe no longer used
  state.indexHistory = [];
  return null;
}

function canTrigger(command) {
  const config = COMMAND_MAP[command];
  const now = performance.now();
  const last = state.cooldowns.get(command) || 0;

  if (now - state.lastCommandAt < MIN_COMMAND_GAP_MS) {
    return false;
  }

  if (!config || now - last >= config.cooldown) {
    state.cooldowns.set(command, now);
    state.lastCommandAt = now;
    return true;
  }

  return false;
}

function getGestureKey(result) {
  return result ? `${result.command}:${result.name}` : null;
}

function stabilizeStaticGesture(result) {
  const key = getGestureKey(result);

  if (!key) {
    state.pendingStaticGestureKey = null;
    state.pendingStaticGestureFrames = 0;
    state.activeStaticGestureKey = null;
    return null;
  }

  if (state.pendingStaticGestureKey === key) {
    state.pendingStaticGestureFrames += 1;
  } else {
    state.pendingStaticGestureKey = key;
    state.pendingStaticGestureFrames = 1;
  }

  if (state.activeStaticGestureKey === key) {
    return null;
  }

  if (state.pendingStaticGestureFrames < STATIC_GESTURE_STABILITY_FRAMES) {
    return null;
  }

  state.activeStaticGestureKey = key;
  return result;
}

// Thumb hold-repeat state
const _thumbRepeat = {
  command: null,
  name: null,
  heldSince: null,    // timestamp when gesture first detected
  lastFired: null,    // timestamp of last repeat fire
  interval: 300,      // ms between repeats
  delay: 1000,        // ms before repeating starts
};

function _clearThumbRepeat() {
  _thumbRepeat.command = null;
  _thumbRepeat.name = null;
  _thumbRepeat.heldSince = null;
  _thumbRepeat.lastFired = null;
}

async function dispatchGesture(result) {
  if (!result) {
    // Only clear repeat if no gesture at all — thumb may flicker briefly
    if (_thumbRepeat.command) {
      const now = performance.now();
      // Give 200ms grace before clearing, handles brief detection gaps
      if (!_thumbRepeat.lastFired || now - _thumbRepeat.lastFired > 200) {
        _clearThumbRepeat();
      }
    }
    return;
  }

  // Handle repeating thumb gestures
  if (result.repeat) {
    const now = performance.now();

    if (_thumbRepeat.command !== result.command) {
      // New thumb gesture — fire immediately on first detection
      _thumbRepeat.command = result.command;
      _thumbRepeat.name = result.name;
      _thumbRepeat.heldSince = now;
      _thumbRepeat.lastFired = now;
      setGestureDisplay(result.name, COMMAND_MAP[result.command].label);
      await handleCommand(result.command, "gesture");
      showToast(`${result.name}`);
    } else {
      // Same gesture held — check if we should repeat
      const heldFor = now - _thumbRepeat.heldSince;
      const sinceLastFire = now - _thumbRepeat.lastFired;
      if (heldFor >= _thumbRepeat.delay && sinceLastFire >= _thumbRepeat.interval) {
        _thumbRepeat.lastFired = now;
        setGestureDisplay(result.name, COMMAND_MAP[result.command].label);
        await handleCommand(result.command, "gesture");
      }
    }
    return;
  }

  // Non-repeating gesture
  _clearThumbRepeat();
  if (!canTrigger(result.command)) return;
  setGestureDisplay(result.name, COMMAND_MAP[result.command].label);
  await handleCommand(result.command, "gesture");
  showToast(`${result.name} detected`);
}

function clearCanvasPlaceholder() {
  ctx.save();
  ctx.clearRect(0, 0, elements.webcamCanvas.width, elements.webcamCanvas.height);
  ctx.fillStyle = "#03101c";
  ctx.fillRect(0, 0, elements.webcamCanvas.width, elements.webcamCanvas.height);
  ctx.fillStyle = "rgba(152, 168, 188, 0.95)";
  ctx.font = "18px Space Grotesk";
  ctx.fillText("Camera preview will appear here", 28, 48);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Gesture cursor — smooth lerp, always visible, hidden in fullscreen
// ---------------------------------------------------------------------------

const _cursor = {
  targetX: window.innerWidth / 2,
  targetY: window.innerHeight / 2,
  renderedX: window.innerWidth / 2,
  renderedY: window.innerHeight / 2,
  smoothRawX: 0.5,
  smoothRawY: 0.5,
  bufX: Array(6).fill(0.5),
  bufY: Array(6).fill(0.5),
  bufIdx: 0,
  lastMoveAt: 0,
};

const FS_EXIT_HIDE_MS = 3000; // hide exit button after 3s of no movement

// Rendered cursor chases target — lower = smoother/slower
const CURSOR_LERP = 0.25;
// Raw landmark EMA smoothing — lower = smoother/slower
const RAW_SMOOTH = 0.4;
// Buffer size for rolling average
const BUF_SIZE = 6;

// Map hand position from a central zone to full screen
// Wider zone = less sensitive, less edge jitter
const ZONE_MIN_X = 0.15;
const ZONE_MAX_X = 0.85;
const ZONE_MIN_Y = 0.10;
const ZONE_MAX_Y = 0.85;

function _mapToScreen(raw, zMin, zMax) {
  return Math.max(0, Math.min(1, (raw - zMin) / (zMax - zMin)));
}

function _cursorRafLoop() {
  _cursor.renderedX += (_cursor.targetX - _cursor.renderedX) * CURSOR_LERP;
  _cursor.renderedY += (_cursor.targetY - _cursor.renderedY) * CURSOR_LERP;

  const cursor = elements.gestureCursor;
  const inFullscreen = state.stageFocusMode
    || !!document.fullscreenElement
    || !!document.webkitFullscreenElement;

  cursor.style.display = inFullscreen ? "none" : "block";
  cursor.style.left = _cursor.renderedX.toFixed(1) + "px";
  cursor.style.top  = _cursor.renderedY.toFixed(1) + "px";

  // Show/hide the exit button based on cursor movement in fullscreen
  if (elements.fsExitBtn) {
    const cursorMoved = performance.now() - _cursor.lastMoveAt < FS_EXIT_HIDE_MS;
    elements.fsExitBtn.classList.toggle("fs-visible", inFullscreen && cursorMoved);
  }

  requestAnimationFrame(_cursorRafLoop);
}

// Last known smoothed hand position — used for delta movement
const _handPrev = { x: null, y: null, warmup: 0 };

// How many frames to skip after hand enters before applying delta (buffer warmup)
const CURSOR_WARMUP_FRAMES = 8;

// Sensitivity multiplier: how many pixels the cursor moves per unit of hand movement
const CURSOR_SENSITIVITY = 2.5;

function updateGestureCursor(landmarks, handedness) {
  const index    = isFingerExtended(landmarks, 8, 6);
  const middle   = isFingerExtended(landmarks, 12, 10);
  const ring     = isFingerExtended(landmarks, 16, 14);
  const pinky    = isFingerExtended(landmarks, 20, 18);
  const thumbOut = isThumbExtended(landmarks, handedness);

  // Flip X because canvas is mirrored
  const rawX = 1 - landmarks[8].x;
  const rawY = landmarks[8].y;

  // On first frame after hand enters, reset all smoothing buffers to current position
  if (_handPrev.x === null) {
    _cursor.smoothRawX = rawX;
    _cursor.smoothRawY = rawY;
    _cursor.bufX.fill(rawX);
    _cursor.bufY.fill(rawY);
    _handPrev.warmup = 0;
  }

  // Step 1: EMA smoothing
  _cursor.smoothRawX += (rawX - _cursor.smoothRawX) * RAW_SMOOTH;
  _cursor.smoothRawY += (rawY - _cursor.smoothRawY) * RAW_SMOOTH;

  // Step 2: rolling average
  _cursor.bufX[_cursor.bufIdx] = _cursor.smoothRawX;
  _cursor.bufY[_cursor.bufIdx] = _cursor.smoothRawY;
  _cursor.bufIdx = (_cursor.bufIdx + 1) % BUF_SIZE;
  const avgX = _cursor.bufX.reduce((a, b) => a + b, 0) / BUF_SIZE;
  const avgY = _cursor.bufY.reduce((a, b) => a + b, 0) / BUF_SIZE;

  // Step 3: delta movement — only move cursor when in pointer or click pose
  const isMovingPose = (index && !middle && !ring && !pinky && !thumbOut) ||
                       (index && middle && !ring && !pinky && !thumbOut);

  if (isMovingPose) {
    _handPrev.warmup++;
    if (_handPrev.x !== null && _handPrev.warmup > CURSOR_WARMUP_FRAMES) {
      const dx = (avgX - _handPrev.x) * window.innerWidth  * CURSOR_SENSITIVITY;
      const dy = (avgY - _handPrev.y) * window.innerHeight * CURSOR_SENSITIVITY;

      if (Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3) {
        _cursor.targetX = Math.max(0, Math.min(window.innerWidth,  _cursor.targetX + dx));
        _cursor.targetY = Math.max(0, Math.min(window.innerHeight, _cursor.targetY + dy));
        _cursor.lastMoveAt = performance.now();
      }
    }
    _handPrev.x = avgX;
    _handPrev.y = avgY;
  } else {
    // Any other gesture — freeze cursor, reset prev so re-entry doesn't jump
    _handPrev.x = null;
    _handPrev.y = null;
    _handPrev.warmup = 0;
  }

  const cursor = elements.gestureCursor;

  // CLICK: index + middle joined, ring/pinky/thumb folded
  const isClickPose = index && middle && !ring && !pinky && !thumbOut
    && distanceBetween(landmarks, 8, 12) < 0.04;

  // POINTER: only index up, rest folded — moves cursor
  const isPointerPose = index && !middle && !ring && !pinky && !thumbOut;

  if (isClickPose) {
    cursor.className = "mode-click";
    if (!state.clickCooldown) {
      state.clickCooldown = true;
      const el = document.elementFromPoint(_cursor.renderedX, _cursor.renderedY);
      if (el && el !== cursor) {
        el.dispatchEvent(new MouseEvent("click", {
          bubbles: true, cancelable: true, view: window,
          clientX: _cursor.renderedX, clientY: _cursor.renderedY,
        }));
      }
      setTimeout(() => { state.clickCooldown = false; }, 1500);
    }
  } else if (isPointerPose) {
    cursor.className = "mode-pointer";
  } else {
    cursor.className = "mode-idle";
  }
  state.lastScrollY = null;
}

function hideGestureCursor() {
  state.lastScrollY = null;
  elements.gestureCursor.className = "mode-idle";
}

async function onResults(results) {
  ctx.save();
  ctx.clearRect(0, 0, elements.webcamCanvas.width, elements.webcamCanvas.height);
  ctx.translate(elements.webcamCanvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(results.image, 0, 0, elements.webcamCanvas.width, elements.webcamCanvas.height);

  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    state.lastSeenHandAt = performance.now();
    const landmarks = results.multiHandLandmarks[0];
    const handedness =
      results.multiHandedness?.[0]?.label ||
      results.multiHandedness?.[0]?.classification?.[0]?.label ||
      "Right";

    drawConnectors(ctx, landmarks, HAND_CONNECTIONS, {
      color: "#64d9ff",
      lineWidth: 3,
    });
    drawLandmarks(ctx, landmarks, {
      color: "#ffb347",
      fillColor: "#ff7a18",
      radius: 4,
    });

    const rawStatic = classifyStaticGesture(landmarks, handedness);
    // Repeat gestures (thumb up/down) bypass stabilization so hold-repeat works
    const staticGesture = (rawStatic && rawStatic.repeat)
      ? rawStatic
      : stabilizeStaticGesture(rawStatic);
    const indexSwipeGesture = classifyIndexSwipe(landmarks, handedness);
    const swipeGesture = indexSwipeGesture || classifySwipe(landmarks);
    await dispatchGesture(staticGesture || swipeGesture);

    // Update gesture cursor
    updateGestureCursor(landmarks, handedness);
  } else {
    state.wristHistory = [];
    state.indexHistory = [];
    state.pendingStaticGestureKey = null;
    state.pendingStaticGestureFrames = 0;
    state.activeStaticGestureKey = null;
    _clearThumbRepeat();
    hideGestureCursor();
    _handPrev.x = null;
    _handPrev.y = null;
    _handPrev.warmup = 0;
    if (performance.now() - state.lastSeenHandAt > 800) {
      setGestureDisplay("No hand", "None");
    }
  }

  ctx.restore();
}

async function ensureHandsLoaded() {
  if (state.hands) {
    return state.hands;
  }

  if (!window.Hands || !window.drawConnectors || !window.drawLandmarks) {
    throw new Error("MediaPipe browser files did not load.");
  }

  state.hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });

  state.hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.72,
    minTrackingConfidence: 0.68,
  });

  state.hands.onResults((results) => {
    onResults(results).catch((error) => {
      console.error(error);
      showToast("Gesture processing error. Check the browser console.");
    });
  });

  return state.hands;
}

async function processingLoop() {
  if (!state.handLoopActive) {
    return;
  }

  if (
    state.hands &&
    state.webcamReady &&
    !state.handLoopBusy &&
    elements.webcamInput.readyState >= 2
  ) {
    state.handLoopBusy = true;
    try {
      await state.hands.send({ image: elements.webcamInput });
    } finally {
      state.handLoopBusy = false;
    }
  }

  window.requestAnimationFrame(() => {
    processingLoop().catch((error) => {
      console.error(error);
      showToast("Frame processing failed.");
    });
  });
}

async function startCamera() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((track) => track.stop());
    state.cameraStream = null;
    state.handLoopActive = false;
    state.webcamReady = false;
    elements.webcamInput.srcObject = null;
    elements.startCameraBtn.textContent = "Start Camera";
    elements.cameraStatus.textContent = "Offline";
    elements.cameraStatus.className = "status-pill offline";
    showToast("Start the camera to begin gesture detection.");
    setGestureDisplay("Waiting...", "None");
    clearCanvasPlaceholder();
    return;
  }

  try {
    await ensureHandsLoaded();

    state.cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: "user",
      },
      audio: false,
    });

    elements.webcamInput.srcObject = state.cameraStream;
    await elements.webcamInput.play();
    state.webcamReady = true;
    state.handLoopActive = true;
    elements.startCameraBtn.textContent = "Stop Camera";
    elements.cameraStatus.textContent = "Online";
    elements.cameraStatus.className = "status-pill online";
    showToast("Camera live. Show one hand clearly inside the frame.");
    showToast("Webcam started");
    processingLoop().catch((error) => {
      console.error(error);
      showToast("Could not start frame loop.");
    });
  } catch (error) {
    console.error(error);
    showToast("Camera access failed. Allow webcam permission and retry.");
    showToast("Unable to start webcam");
  }
}

function bindPlayerEvents() {
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      setStageFocusMode(false);
    }
    updatePlayerMeta();
  });

  document.addEventListener("webkitfullscreenchange", () => {
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      setStageFocusMode(false);
    }
    updatePlayerMeta();
  });

  // Escape key exits CSS fallback fullscreen
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.stageFocusMode) {
      setStageFocusMode(false);
    }
  });

  // When gesture sets _gestureFSPending, the next real user interaction
  // (click anywhere on the page) fires native requestFullscreen
  document.addEventListener("click", () => {
    if (_gestureFSPending) {
      _gestureFSPending = false;
      toggleFullscreenForActivePlayer();
    }
  }, true);
  elements.videoInput.addEventListener("change", (event) => {
    const [file] = event.target.files || [];
    loadVideoFile(file);
  });

  elements.loadYoutubeBtn.addEventListener("click", () => {
    loadYouTubeUrl(elements.youtubeUrlInput.value).catch((error) => {
      console.error(error);
      showToast("Could not load the YouTube video.");
    });
  });

  elements.youtubeUrlInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      loadYouTubeUrl(elements.youtubeUrlInput.value).catch((error) => {
        console.error(error);
        showToast("Could not load the YouTube video.");
      });
    }
  });

  elements.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("dragover");
  });

  elements.dropZone.addEventListener("click", () => {
    elements.videoInput.click();
  });

  elements.dropZone.addEventListener("dragleave", () => {
    elements.dropZone.classList.remove("dragover");
  });

  elements.dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("dragover");
    const [file] = event.dataTransfer.files || [];
    loadVideoFile(file);
  });

  elements.mediaPlayer.addEventListener("loadedmetadata", updatePlayerMeta);
  elements.mediaPlayer.addEventListener("timeupdate", updatePlayerMeta);
  elements.mediaPlayer.addEventListener("play", updatePlayerMeta);
  elements.mediaPlayer.addEventListener("pause", updatePlayerMeta);
  elements.mediaPlayer.addEventListener("ratechange", updatePlayerMeta);
  elements.mediaPlayer.addEventListener("ended", () => {
    elements.playStateBadge.textContent = "Ended";
    setLastAction("Playback completed");
  });

  elements.seekBar.addEventListener("input", () => {
    if (!requireMedia()) {
      elements.seekBar.value = "0";
      return;
    }

    const duration = getActiveDuration();
    if (duration <= 0) {
      return;
    }

    const target = (Number(elements.seekBar.value) / 1000) * duration;
    setActiveTime(target);
    updatePlayerMeta();
  });

  elements.fsSeekBar.addEventListener("input", () => {
    if (!requireMedia()) {
      elements.fsSeekBar.value = "0";
      return;
    }

    const duration = getActiveDuration();
    if (duration <= 0) {
      return;
    }

    const target = (Number(elements.fsSeekBar.value) / 1000) * duration;
    setActiveTime(target);
    updatePlayerMeta();
  });

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.getAttribute("data-action");

      // Fullscreen button gets its own direct handler — must be synchronous
      // and not go through async handleCommand to satisfy browser user-gesture requirement
      if (action === "fullscreen") {
        toggleFullscreenForActivePlayer();
        return;
      }

      const actionMap = {
        "seek-back-large": "seekBackwardLarge",
        "seek-back-small": "seekBackwardSmall",
        "seek-forward-small": "seekForwardSmall",
        "seek-forward-large": "seekForwardLarge",
        "volume-down": "volumeDown",
        "volume-up": "volumeUp",
        play: "play",
        pause: "pause",
      };
      await handleCommand(actionMap[action], "button");
    });
  });

  elements.startCameraBtn.addEventListener("click", () => {
    startCamera().catch((error) => {
      console.error(error);
      showToast("Camera toggle failed");
    });
  });

  // Fullscreen exit button — exits both native and CSS fullscreen
  elements.fsExitBtn.addEventListener("click", () => {
    toggleFullscreenForActivePlayer();
  });
}

function initialize() {
  clearCanvasPlaceholder();
  switchVisualSource("none");
  updatePlayerMeta();
  bindPlayerEvents();
  setGestureDisplay("Waiting...", "None");
  window.setInterval(updatePlayerMeta, 250);
  // Start cursor at center, begin smooth render loop
  elements.gestureCursor.className = "mode-idle";
  requestAnimationFrame(_cursorRafLoop);
}

initialize();
