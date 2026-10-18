/* Fog Mirror — all image processing stays in this browser tab. */
(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const stage = $('#mirror-stage');
  const video = $('#camera');
  const fogCanvas = $('#fog-canvas');
  const handCanvas = $('#hand-canvas');
  const fogCtx = fogCanvas.getContext('2d');
  const handCtx = handCanvas.getContext('2d');
  const startButton = $('#start-camera');
  const retryButton = $('#retry-camera');
  const captureButton = $('#capture');
  const undoButton = $('#undo');
  const brushButton = $('#toggle-brush');
  const refogButton = $('#refog');
  const permissionPanel = $('#permission-panel');
  const errorPanel = $('#error-panel');
  const errorMessage = $('#error-message');
  const cameraStatus = $('#camera-status b');
  const gestureStatus = $('#gesture-status');
  const brushIndicator = $('#brush-indicator');
  const palmProgress = $('#palm-progress');
  const countdown = $('#countdown');
  const flash = $('#flash');
  const toast = $('#toast');

  const state = {
    stream: null,
    hands: null,
    cameraActive: false,
    trackerRunning: false,
    strokes: [],
    redoStack: [],
    currentStroke: null,
    lastSmoothedPoint: null,
    strokeSmoothing: 0.38, // retained from Aurora Air Canvas
    brushMode: 'fine',
    brushSizes: { fine: 30, wide: 76 },
    pointerActive: false,
    pinchLatched: false,
    victoryLatched: false,
    palmStartedAt: 0,
    palmTriggered: false,
    gesture: 'IDLE',
    captureInProgress: false,
    lastBrushToast: 0,
    fogSeed: 68421,
    resizeObserver: null,
    frameRequest: 0,
    syntheticFrameRequest: 0,
    lastInferenceAt: 0,
    mediaPipePromise: null,
    mediaPipeBase: 'https://cdn.jsdelivr.net/npm/@mediapipe/hands',
    destroyed: false
  };

  class Stroke {
    constructor(size, source = 'pointer') {
      this.size = size;
      this.source = source;
      this.points = [];
    }
  }

  function showToast(message, type = '') {
    toast.textContent = message;
    toast.className = `toast show ${type}`.trim();
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => { toast.className = 'toast'; }, 2600);
  }

  function setGesture(label) {
    if (state.gesture === label) return;
    state.gesture = label;
    const names = {
      IDLE: '手势待机', DRAW: '食指擦雾', PINCH: '捏合切换笔触',
      PALM: '保持手掌张开', REFOG: '镜面重新起雾', VICTORY: '剪刀手 · 自拍'
    };
    gestureStatus.textContent = names[label] || label;
  }

  function seededRandom() {
    state.fogSeed = (state.fogSeed * 48271) % 2147483647;
    return state.fogSeed / 2147483647;
  }

  function paintFogTexture() {
    const { width, height } = fogCanvas;
    if (!width || !height) return;
    state.fogSeed = 68421;
    fogCtx.save();
    fogCtx.globalCompositeOperation = 'source-over';
    fogCtx.clearRect(0, 0, width, height);

    const base = fogCtx.createLinearGradient(0, 0, width, height);
    base.addColorStop(0, 'rgba(225, 235, 231, .76)');
    base.addColorStop(.45, 'rgba(189, 203, 199, .68)');
    base.addColorStop(1, 'rgba(219, 228, 224, .72)');
    fogCtx.fillStyle = base;
    fogCtx.fillRect(0, 0, width, height);

    fogCtx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 18; i += 1) {
      const x = seededRandom() * width;
      const y = seededRandom() * height;
      const r = (0.12 + seededRandom() * .28) * Math.min(width, height);
      const cloud = fogCtx.createRadialGradient(x, y, 0, x, y, r);
      cloud.addColorStop(0, `rgba(255,255,255,${.08 + seededRandom() * .08})`);
      cloud.addColorStop(1, 'rgba(255,255,255,0)');
      fogCtx.fillStyle = cloud;
      fogCtx.fillRect(x - r, y - r, r * 2, r * 2);
    }

    fogCtx.globalCompositeOperation = 'source-over';
    fogCtx.lineCap = 'round';
    const drops = Math.max(42, Math.round(width * height / 16000));
    for (let i = 0; i < drops; i += 1) {
      const x = seededRandom() * width;
      const y = seededRandom() * height;
      const r = 1.2 + seededRandom() * 4.8;
      fogCtx.beginPath();
      fogCtx.ellipse(x, y, r * .72, r * (1.1 + seededRandom()), 0, 0, Math.PI * 2);
      fogCtx.fillStyle = 'rgba(255,255,255,.17)';
      fogCtx.fill();
      fogCtx.strokeStyle = 'rgba(65,82,79,.12)';
      fogCtx.lineWidth = 1;
      fogCtx.stroke();
    }
    fogCtx.restore();
  }

  function eraseSegment(a, b, size) {
    fogCtx.save();
    fogCtx.globalCompositeOperation = 'destination-out';
    fogCtx.lineCap = 'round';
    fogCtx.lineJoin = 'round';
    fogCtx.lineWidth = size;
    fogCtx.shadowColor = 'rgba(0,0,0,.72)';
    fogCtx.shadowBlur = size * .22;
    fogCtx.beginPath();
    fogCtx.moveTo(a.x, a.y);
    fogCtx.lineTo(b.x, b.y);
    fogCtx.stroke();
    fogCtx.restore();
  }

  function redrawFog() {
    paintFogTexture();
    [...state.strokes, ...(state.currentStroke ? [state.currentStroke] : [])].forEach((stroke) => {
      for (let i = 1; i < stroke.points.length; i += 1) {
        eraseSegment(stroke.points[i - 1], stroke.points[i], stroke.size);
      }
    });
    updateUndoState();
  }

  function beginStroke(point, source = 'pointer') {
    if (state.captureInProgress) return;
    const size = state.brushSizes[state.brushMode];
    state.currentStroke = new Stroke(size, source);
    state.currentStroke.points.push(point);
    state.lastSmoothedPoint = point;
  }

  function continueStroke(rawPoint, source = 'pointer') {
    if (state.captureInProgress) return;
    if (!state.currentStroke || state.currentStroke.source !== source) beginStroke(rawPoint, source);
    const previous = state.lastSmoothedPoint || rawPoint;
    const smoothed = {
      x: Math.round(previous.x + (rawPoint.x - previous.x) * state.strokeSmoothing),
      y: Math.round(previous.y + (rawPoint.y - previous.y) * state.strokeSmoothing)
    };
    state.currentStroke.points.push(smoothed);
    eraseSegment(previous, smoothed, state.currentStroke.size);
    state.lastSmoothedPoint = smoothed;
  }

  function commitStroke(source) {
    if (!state.currentStroke || (source && state.currentStroke.source !== source)) return;
    const stroke = state.currentStroke;
    if (stroke.points.length === 1) {
      const p = stroke.points[0];
      stroke.points.push({ x: p.x + .1, y: p.y + .1 });
      eraseSegment(p, stroke.points[1], stroke.size);
    }
    if (stroke.points.length > 1) {
      state.strokes.push(stroke);
      state.redoStack = [];
    }
    state.currentStroke = null;
    state.lastSmoothedPoint = null;
    updateUndoState();
  }

  function updateUndoState() {
    undoButton.disabled = state.strokes.length === 0;
  }

  function refog(fromGesture = false) {
    state.strokes = [];
    state.redoStack = [];
    state.currentStroke = null;
    state.lastSmoothedPoint = null;
    paintFogTexture();
    updateUndoState();
    setGesture(fromGesture ? 'REFOG' : 'IDLE');
    showToast('镜面重新起雾了');
  }

  function undo() {
    commitStroke();
    if (!state.strokes.length) return;
    state.redoStack.push(state.strokes.pop());
    redrawFog();
    showToast('已撤销最后一笔');
  }

  function toggleBrush(fromGesture = false) {
    state.brushMode = state.brushMode === 'fine' ? 'wide' : 'fine';
    const wide = state.brushMode === 'wide';
    brushButton.classList.toggle('wide', wide);
    brushButton.querySelector('b').textContent = wide ? '粗笔' : '细笔';
    brushIndicator.classList.toggle('wide', wide);
    brushIndicator.querySelector('b').textContent = wide ? '粗笔' : '细笔';
    brushIndicator.classList.add('show');
    window.clearTimeout(toggleBrush.timer);
    toggleBrush.timer = window.setTimeout(() => brushIndicator.classList.remove('show'), 1200);
    if (fromGesture) setGesture('PINCH');
    showToast(`已切换为${wide ? '粗笔' : '细笔'}`);
  }

  function pointFromEvent(event) {
    const rect = fogCanvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width * fogCanvas.width,
      y: (event.clientY - rect.top) / rect.height * fogCanvas.height
    };
  }

  function bindPointerFallback() {
    fogCanvas.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      state.pointerActive = true;
      fogCanvas.setPointerCapture?.(event.pointerId);
      beginStroke(pointFromEvent(event), 'pointer');
      setGesture('DRAW');
    });
    fogCanvas.addEventListener('pointermove', (event) => {
      if (!state.pointerActive) return;
      event.preventDefault();
      continueStroke(pointFromEvent(event), 'pointer');
    }, { passive: false });
    const finish = () => {
      if (!state.pointerActive) return;
      state.pointerActive = false;
      commitStroke('pointer');
      setGesture('IDLE');
    };
    fogCanvas.addEventListener('pointerup', finish);
    fogCanvas.addEventListener('pointercancel', finish);
    window.addEventListener('pointerup', finish);
  }

  function resizeCanvases() {
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const oldW = fogCanvas.width;
    const oldH = fogCanvas.height;
    const newW = Math.round(rect.width * ratio);
    const newH = Math.round(rect.height * ratio);
    if (oldW === newW && oldH === newH) return;
    if (oldW && oldH && state.strokes.length) {
      const scaleX = newW / oldW;
      const scaleY = newH / oldH;
      state.strokes.forEach((stroke) => {
        stroke.size *= (scaleX + scaleY) / 2;
        stroke.points.forEach((p) => { p.x *= scaleX; p.y *= scaleY; });
      });
    }
    fogCanvas.width = handCanvas.width = newW;
    fogCanvas.height = handCanvas.height = newH;
    state.brushSizes.fine = Math.max(24, newW * .022);
    state.brushSizes.wide = Math.max(64, newW * .055);
    redrawFog();
  }

  function absolutePoint(landmark) {
    return {
      x: (1 - landmark.x) * fogCanvas.width,
      y: landmark.y * fogCanvas.height
    };
  }

  function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function fingerExtended(landmarks, tip, pip) {
    const wrist = landmarks[0];
    return distance(landmarks[tip], wrist) > distance(landmarks[pip], wrist) * 1.10;
  }

  function fingerStates(landmarks) {
    const palm = Math.max(distance(landmarks[5], landmarks[17]), .001);
    const thumbOpen = distance(landmarks[4], landmarks[5]) > distance(landmarks[3], landmarks[5]) * 1.16;
    return {
      thumb: thumbOpen,
      index: fingerExtended(landmarks, 8, 6),
      middle: fingerExtended(landmarks, 12, 10),
      ring: fingerExtended(landmarks, 16, 14),
      pinky: fingerExtended(landmarks, 20, 18),
      pinch: distance(landmarks[4], landmarks[8]) / palm < .36
    };
  }

  function drawCursor(point, mode) {
    handCtx.clearRect(0, 0, handCanvas.width, handCanvas.height);
    const r = mode === 'wide' ? state.brushSizes.wide / 2 : state.brushSizes.fine / 2;
    handCtx.save();
    handCtx.beginPath();
    handCtx.arc(point.x, point.y, r, 0, Math.PI * 2);
    handCtx.strokeStyle = '#d9ff70';
    handCtx.lineWidth = Math.max(3, handCanvas.width * .002);
    handCtx.shadowColor = '#d9ff70';
    handCtx.shadowBlur = 16;
    handCtx.stroke();
    handCtx.restore();
  }

  function resetPalmProgress() {
    state.palmStartedAt = 0;
    state.palmTriggered = false;
    palmProgress.classList.remove('visible');
    palmProgress.style.setProperty('--progress', '0%');
  }

  function onHandResults(results) {
    handCtx.clearRect(0, 0, handCanvas.width, handCanvas.height);
    const landmarks = results.multiHandLandmarks?.[0];
    if (!landmarks) {
      commitStroke('hand');
      state.pinchLatched = false;
      state.victoryLatched = false;
      resetPalmProgress();
      setGesture('IDLE');
      return;
    }

    const fingers = fingerStates(landmarks);
    const point = absolutePoint(landmarks[8]);
    const openPalm = fingers.thumb && fingers.index && fingers.middle && fingers.ring && fingers.pinky;
    const victory = fingers.index && fingers.middle && !fingers.ring && !fingers.pinky && !fingers.pinch;

    if (openPalm) {
      commitStroke('hand');
      state.pinchLatched = false;
      state.victoryLatched = false;
      setGesture('PALM');
      if (!state.palmStartedAt) state.palmStartedAt = performance.now();
      const held = performance.now() - state.palmStartedAt;
      const progress = Math.min(held / 800, 1);
      palmProgress.classList.add('visible');
      palmProgress.style.setProperty('--progress', `${Math.round(progress * 100)}%`);
      if (progress >= 1 && !state.palmTriggered) {
        state.palmTriggered = true;
        refog(true);
      }
      return;
    }
    resetPalmProgress();

    if (victory) {
      commitStroke('hand');
      setGesture('VICTORY');
      if (!state.victoryLatched && state.cameraActive && !state.captureInProgress) {
        state.victoryLatched = true;
        startCountdown();
      }
      return;
    }
    state.victoryLatched = false;

    if (fingers.pinch) {
      commitStroke('hand');
      if (!state.pinchLatched) toggleBrush(true);
      state.pinchLatched = true;
      drawCursor(point, state.brushMode);
      return;
    }
    state.pinchLatched = false;

    if (fingers.index && !fingers.middle && !state.captureInProgress) {
      setGesture('DRAW');
      continueStroke(point, 'hand');
      drawCursor(point, state.brushMode);
    } else {
      commitStroke('hand');
      setGesture('IDLE');
    }
  }

  function friendlyCameraError(error) {
    if (!window.isSecureContext) return '当前页面不是 HTTPS。请使用 HTTPS 或 localhost 后再开启摄像头。';
    if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') return '摄像头权限被拒绝。请在浏览器网站设置中允许访问后重试。';
    if (error?.name === 'NotFoundError') return '没有找到可用的摄像头。你仍可使用鼠标或触摸体验。';
    if (error?.name === 'NotReadableError') return '摄像头可能正被其他应用占用。关闭占用它的应用后再试。';
    return '摄像头或手势模型未能启动。请检查网络、权限后重试。';
  }

  function withTimeout(promise, milliseconds, message) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(message)), milliseconds);
    });
    return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer));
  }

  function startTrackingLoop() {
    const tick = async (time) => {
      if (!state.cameraActive || state.destroyed) return;
      // 24fps is responsive for drawing while keeping phone heat and battery use in check.
      if (!state.trackerRunning && time - state.lastInferenceAt >= 42 && video.readyState >= 2) {
        state.trackerRunning = true;
        state.lastInferenceAt = time;
        try { await state.hands?.send({ image: video }); }
        catch (error) { console.warn('Hand tracking frame skipped', error); }
        finally { state.trackerRunning = false; }
      }
      state.frameRequest = window.requestAnimationFrame(tick);
    };
    state.frameRequest = window.requestAnimationFrame(tick);
  }

  function loadMediaPipe() {
    if (typeof window.Hands === 'function') return Promise.resolve();
    if (state.mediaPipePromise) return state.mediaPipePromise;
    const sources = [
      'https://cdn.jsdelivr.net/npm/@mediapipe/hands',
      'https://unpkg.com/@mediapipe/hands'
    ];
    const trySource = (index) => new Promise((resolve, reject) => {
      if (index >= sources.length) {
        reject(new Error('MediaPipe CDN unavailable'));
        return;
      }
      const base = sources[index];
      const script = document.createElement('script');
      script.src = `${base}/hands.js`;
      script.crossOrigin = 'anonymous';
      script.onload = () => {
        if (typeof window.Hands === 'function') {
          state.mediaPipeBase = base;
          resolve();
        } else {
          script.remove();
          trySource(index + 1).then(resolve, reject);
        }
      };
      script.onerror = () => {
        script.remove();
        trySource(index + 1).then(resolve, reject);
      };
      document.head.appendChild(script);
    });
    state.mediaPipePromise = trySource(0).catch((error) => {
      state.mediaPipePromise = null;
      throw error;
    });
    return withTimeout(state.mediaPipePromise, 18000, 'MediaPipe CDN timed out').catch((error) => {
      state.mediaPipePromise = null;
      throw error;
    });
  }

  async function initializeCamera() {
    if (state.cameraActive) return;
    errorPanel.hidden = true;
    permissionPanel.hidden = false;
    startButton.disabled = true;
    startButton.lastElementChild.textContent = '正在请求摄像头…';
    cameraStatus.textContent = '正在连接镜头';

    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('getUserMedia unavailable');
      const stream = await withTimeout(navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'user' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 }
        }
      }), 15000, 'Camera permission timed out');
      state.stream = stream;
      video.srcObject = stream;
      await video.play();

      state.cameraActive = true;
      stage.classList.add('camera-ready');
      permissionPanel.hidden = true;
      errorPanel.hidden = true;
      captureButton.disabled = false;
      cameraStatus.textContent = '镜头已开启 · 正在加载手势';
      showToast('镜头已开启，正在准备手势识别');

      startButton.lastElementChild.textContent = '正在加载手势模型…';
      try {
        await loadMediaPipe();
        const hands = new window.Hands({
          locateFile: (file) => `${state.mediaPipeBase}/${file}`
        });
        hands.setOptions({
          maxNumHands: 1,
          modelComplexity: 0,
          minDetectionConfidence: .58,
          minTrackingConfidence: .55,
          selfieMode: false
        });
        hands.onResults(onHandResults);
        state.hands = hands;
        startTrackingLoop();
        cameraStatus.textContent = '镜头与手势已开启';
        showToast('镜头与手势识别已就绪');
      } catch (modelError) {
        console.warn('Hand tracking unavailable; camera remains active', modelError);
        cameraStatus.textContent = '镜头已开启 · 手势不可用';
        gestureStatus.textContent = '请使用鼠标 / 触摸';
        showToast('手势模型未加载，镜头与触摸操作仍可用', 'error');
      }
    } catch (error) {
      console.error('Camera initialization failed', error);
      stopCamera();
      permissionPanel.hidden = true;
      errorPanel.hidden = false;
      errorMessage.textContent = friendlyCameraError(error);
      cameraStatus.textContent = '镜头不可用';
      showToast('未能打开摄像头，可继续使用鼠标或触摸', 'error');
    } finally {
      startButton.disabled = false;
      startButton.lastElementChild.textContent = '开启前置镜头';
    }
  }

  function stopCamera() {
    state.cameraActive = false;
    state.stream?.getTracks().forEach((track) => track.stop());
    state.stream = null;
    video.pause();
    video.srcObject = null;
    window.cancelAnimationFrame(state.frameRequest);
    window.cancelAnimationFrame(state.syntheticFrameRequest);
    state.frameRequest = 0;
    state.syntheticFrameRequest = 0;
    state.hands?.close?.();
    state.hands = null;
    state.trackerRunning = false;
    stage.classList.remove('camera-ready');
    captureButton.disabled = true;
    cameraStatus.textContent = '镜头已关闭';
    handCtx.clearRect(0, 0, handCanvas.width, handCanvas.height);
  }

  async function startSyntheticCameraForQa() {
    const source = document.createElement('canvas');
    source.width = 960;
    source.height = 540;
    const ctx = source.getContext('2d');
    const render = (time = 0) => {
      const gradient = ctx.createLinearGradient(0, 0, source.width, source.height);
      gradient.addColorStop(0, '#4d6c71');
      gradient.addColorStop(1, '#172125');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, source.width, source.height);
      ctx.fillStyle = 'rgba(217,255,112,.9)';
      ctx.beginPath();
      ctx.arc(source.width * .5 + Math.sin(time / 700) * 80, source.height * .48, 110, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      ctx.font = '600 30px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('FOG MIRROR · QA CAMERA', source.width / 2, source.height - 46);
      state.syntheticFrameRequest = window.requestAnimationFrame(render);
    };
    render();
    const stream = source.captureStream(12);
    state.stream = stream;
    video.srcObject = stream;
    await video.play();
    state.cameraActive = true;
    stage.classList.add('camera-ready');
    permissionPanel.hidden = true;
    errorPanel.hidden = true;
    captureButton.disabled = false;
    cameraStatus.textContent = 'QA 合成镜头已开启';
  }

  function drawVideoCover(ctx, source, width, height) {
    const vw = source.videoWidth || width;
    const vh = source.videoHeight || height;
    const scale = Math.max(width / vw, height / vh);
    const sw = width / scale;
    const sh = height / scale;
    const sx = (vw - sw) / 2;
    const sy = (vh - sh) / 2;
    ctx.save();
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, width, height);
    ctx.restore();
  }

  function renderExportCanvas() {
    const target = document.createElement('canvas');
    const maxWidth = 1600;
    const aspect = fogCanvas.width / fogCanvas.height;
    target.width = Math.min(maxWidth, Math.max(1080, video.videoWidth || fogCanvas.width));
    target.height = Math.round(target.width / aspect);
    const ctx = target.getContext('2d');
    drawVideoCover(ctx, video, target.width, target.height);
    ctx.drawImage(fogCanvas, 0, 0, target.width, target.height);

    const gradient = ctx.createLinearGradient(0, target.height * .72, 0, target.height);
    gradient.addColorStop(0, 'rgba(5,10,11,0)');
    gradient.addColorStop(1, 'rgba(5,10,11,.56)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, target.width, target.height);

    const now = new Date();
    const date = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const pad = Math.round(target.width * .045);
    ctx.fillStyle = 'rgba(255,255,255,.94)';
    ctx.font = `500 ${Math.round(target.width * .025)}px ${getComputedStyle(document.body).fontFamily}`;
    ctx.fillText('FOG MIRROR', pad, target.height - pad * .72);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,.76)';
    ctx.font = `500 ${Math.round(target.width * .019)}px ${getComputedStyle(document.body).fontFamily}`;
    ctx.fillText(date, target.width - pad, target.height - pad * .72);
    return target;
  }

  function savePng() {
    if (!state.cameraActive || video.readyState < 2) {
      showToast('请先开启摄像头再拍照', 'error');
      return;
    }
    const canvas = renderExportCanvas();
    const date = new Date().toISOString().slice(0, 10);
    if (canvas.toBlob) {
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = `fog-mirror-${date}-${Date.now()}.png`;
        link.href = url;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1200);
      }, 'image/png');
    } else {
      const link = document.createElement('a');
      link.download = `fog-mirror-${date}-${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    }
    showToast('自拍已生成，只保存在你的设备上');
  }

  async function startCountdown() {
    if (state.captureInProgress || !state.cameraActive) return;
    state.captureInProgress = true;
    captureButton.disabled = true;
    commitStroke();
    for (const value of ['3', '2', '1']) {
      countdown.textContent = value;
      await new Promise((resolve) => window.setTimeout(resolve, 900));
      if (!state.cameraActive || state.destroyed) {
        countdown.textContent = '';
        state.captureInProgress = false;
        return;
      }
    }
    countdown.textContent = '';
    flash.classList.remove('fire');
    void flash.offsetWidth;
    flash.classList.add('fire');
    savePng();
    await new Promise((resolve) => window.setTimeout(resolve, 520));
    state.captureInProgress = false;
    captureButton.disabled = !state.cameraActive;
  }

  function skipCameraPanel() {
    permissionPanel.hidden = true;
    errorPanel.hidden = true;
    showToast('用鼠标或手指在镜面上写字吧');
  }

  startButton.addEventListener('click', initializeCamera);
  retryButton.addEventListener('click', initializeCamera);
  $('#skip-camera').addEventListener('click', skipCameraPanel);
  $('#continue-manual').addEventListener('click', skipCameraPanel);
  captureButton.addEventListener('click', startCountdown);
  refogButton.addEventListener('click', () => refog(false));
  undoButton.addEventListener('click', undo);
  brushButton.addEventListener('click', () => toggleBrush(false));
  bindPointerFallback();

  state.resizeObserver = new ResizeObserver(resizeCanvases);
  state.resizeObserver.observe(stage);
  resizeCanvases();
  $('#year').textContent = new Date().getFullYear();
  if (new URLSearchParams(location.search).get('qa') === '1') {
    startSyntheticCameraForQa().catch((error) => console.error('QA camera failed', error));
  }

  const teardown = () => {
    state.destroyed = true;
    stopCamera();
  };
  window.addEventListener('pagehide', teardown);
  window.addEventListener('beforeunload', teardown);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.cameraActive) {
      stopCamera();
      permissionPanel.hidden = false;
      showToast('页面离开后，摄像头已关闭');
    }
  });
})();
