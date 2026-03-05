'use strict';

// State
const state = {
  currentTool: 'pointer',
  color: '#FF0000',
  strokeSize: 4,
  isDrawing: false,
  startX: 0,
  startY: 0,
  currentPath: [],
  history: [],
  historyIndex: -1,
  screenshotDataUrl: null,
  annotations: [],
  undoStack: [],
  redoStack: [],
  textPos: null,
};

// DOM refs
const screens = {
  initial: document.getElementById('screen-initial'),
  loading: document.getElementById('screen-loading'),
  editor: document.getElementById('screen-editor'),
  share: document.getElementById('screen-share'),
};

let screenshotCanvas, annotationCanvas, screenshotCtx, annotationCtx;
let capturedImageData = null;

// =====================
// Navigation
// =====================
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  const screen = screens[name];
  if (screen) screen.classList.add('active');
}

// =====================
// History (localStorage)
// =====================
function loadHistory() {
  try {
    const raw = localStorage.getItem('screenshot_history');
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveToHistory(dataUrl) {
  const history = loadHistory();
  const entry = {
    id: Date.now(),
    dataUrl,
    timestamp: new Date().toLocaleString('ja-JP'),
  };
  history.unshift(entry);
  const trimmed = history.slice(0, 10); // Keep last 10
  localStorage.setItem('screenshot_history', JSON.stringify(trimmed));
  return entry;
}

function renderHistory() {
  const history = loadHistory();
  const list = document.getElementById('history-list');
  if (history.length === 0) {
    list.innerHTML = '<div class="history-empty">履歴なし</div>';
    return;
  }
  list.innerHTML = history.map(entry => `
    <div class="history-item" data-id="${entry.id}" title="${entry.timestamp}">
      <img src="${entry.dataUrl}" alt="screenshot">
    </div>
  `).join('');

  list.querySelectorAll('.history-item').forEach(item => {
    item.addEventListener('click', () => {
      const entry = history.find(h => h.id === parseInt(item.dataset.id));
      if (entry) openEditor(entry.dataUrl);
    });
  });
}

// =====================
// Screenshot capture
// =====================
async function captureCurrentTab() {
  showScreen('loading');
  try {
    const response = await chrome.runtime.sendMessage({ action: 'captureTab' });
    if (response.error) throw new Error(response.error);
    return response.dataUrl;
  } catch (err) {
    alert('撮影に失敗しました: ' + err.message);
    showScreen('initial');
    return null;
  }
}

async function captureTabAndEdit() {
  const dataUrl = await captureCurrentTab();
  if (dataUrl) openEditor(dataUrl);
}

// Area selection: inject overlay into the active tab
async function captureArea() {
  showScreen('loading');

  try {
    // First capture full tab
    const response = await chrome.runtime.sendMessage({ action: 'captureTab' });
    if (response.error) throw new Error(response.error);
    const fullDataUrl = response.dataUrl;

    // Inject area selector into the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: injectAreaSelector,
      args: [fullDataUrl],
    });

    // Listen for the selected area from the injected script
    const messageListener = (message) => {
      if (message.action === 'areaSelected') {
        chrome.runtime.onMessage.removeListener(messageListener);
        if (message.dataUrl) {
          openEditor(message.dataUrl);
        } else {
          showScreen('initial');
        }
      }
    };
    chrome.runtime.onMessage.addListener(messageListener);
  } catch (err) {
    alert('範囲選択に失敗しました: ' + err.message);
    showScreen('initial');
  }
}

// This function is injected into the active tab
function injectAreaSelector(fullDataUrl) {
  // Remove existing overlay if any
  const existing = document.getElementById('__screenshot_overlay__');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = '__screenshot_overlay__';
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    z-index: 2147483647; cursor: crosshair;
    background: rgba(0,0,0,0.4);
  `;

  const selection = document.createElement('div');
  selection.style.cssText = `
    position: absolute; border: 2px solid #4361ee;
    background: rgba(67,97,238,0.1);
    pointer-events: none;
  `;
  overlay.appendChild(selection);

  const hint = document.createElement('div');
  hint.style.cssText = `
    position: fixed; top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    color: white; font-size: 18px; font-family: sans-serif;
    text-shadow: 0 2px 4px rgba(0,0,0,0.8);
    pointer-events: none;
  `;
  hint.textContent = 'ドラッグして範囲を選択 | Escキーでキャンセル';
  overlay.appendChild(hint);

  let startX, startY, isSelecting = false;

  overlay.addEventListener('mousedown', (e) => {
    isSelecting = true;
    startX = e.clientX;
    startY = e.clientY;
    hint.style.display = 'none';
    selection.style.display = 'block';
  });

  overlay.addEventListener('mousemove', (e) => {
    if (!isSelecting) return;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    Object.assign(selection.style, {
      left: x + 'px', top: y + 'px',
      width: w + 'px', height: h + 'px',
    });
  });

  overlay.addEventListener('mouseup', (e) => {
    if (!isSelecting) return;
    isSelecting = false;
    overlay.remove();

    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);

    if (w < 10 || h < 10) {
      chrome.runtime.sendMessage({ action: 'areaSelected', dataUrl: null });
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, x * dpr, y * dpr, w * dpr, h * dpr, 0, 0, w * dpr, h * dpr);
      chrome.runtime.sendMessage({ action: 'areaSelected', dataUrl: canvas.toDataURL('image/png') });
    };
    img.src = fullDataUrl;
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      overlay.remove();
      chrome.runtime.sendMessage({ action: 'areaSelected', dataUrl: null });
    }
  }, { once: true });

  document.body.appendChild(overlay);
}

// =====================
// Editor
// =====================
function openEditor(dataUrl) {
  state.screenshotDataUrl = dataUrl;
  state.undoStack = [];
  state.redoStack = [];

  screenshotCanvas = document.getElementById('screenshot-canvas');
  annotationCanvas = document.getElementById('annotation-canvas');
  screenshotCtx = screenshotCanvas.getContext('2d');
  annotationCtx = annotationCanvas.getContext('2d');

  const img = new Image();
  img.onload = () => {
    const maxW = 480;
    const maxH = 420;
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    const scale = Math.min(maxW / w, maxH / h, 1);
    w = Math.round(w * scale);
    h = Math.round(h * scale);

    screenshotCanvas.width = w;
    screenshotCanvas.height = h;
    annotationCanvas.width = w;
    annotationCanvas.height = h;
    screenshotCanvas.style.width = w + 'px';
    screenshotCanvas.style.height = h + 'px';
    annotationCanvas.style.width = w + 'px';
    annotationCanvas.style.height = h + 'px';

    const container = document.querySelector('.canvas-container');
    container.style.width = w + 'px';
    container.style.height = h + 'px';
    container.style.minWidth = w + 'px';

    screenshotCtx.drawImage(img, 0, 0, w, h);

    // Save initial state to undo stack
    capturedImageData = screenshotCtx.getImageData(0, 0, w, h);

    showScreen('editor');
    document.getElementById('copy-feedback').classList.add('hidden');
  };
  img.src = dataUrl;
}

function getCanvasPos(e) {
  const rect = annotationCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (annotationCanvas.width / rect.width),
    y: (e.clientY - rect.top) * (annotationCanvas.height / rect.height),
  };
}

function saveAnnotationState() {
  const imageData = annotationCtx.getImageData(
    0, 0, annotationCanvas.width, annotationCanvas.height
  );
  state.undoStack.push(imageData);
  state.redoStack = [];
}

function drawAnnotation(e) {
  if (!state.isDrawing) return;
  const pos = getCanvasPos(e);

  annotationCtx.strokeStyle = state.color;
  annotationCtx.lineWidth = parseInt(state.strokeSize);
  annotationCtx.lineCap = 'round';
  annotationCtx.lineJoin = 'round';

  if (state.currentTool === 'pen') {
    annotationCtx.lineTo(pos.x, pos.y);
    annotationCtx.stroke();
  }
}

function startDrawing(e) {
  const pos = getCanvasPos(e);
  state.isDrawing = true;
  state.startX = pos.x;
  state.startY = pos.y;
  saveAnnotationState();

  if (state.currentTool === 'pen') {
    annotationCtx.beginPath();
    annotationCtx.moveTo(pos.x, pos.y);
  } else if (state.currentTool === 'text') {
    showTextInput(pos.x, pos.y);
    state.isDrawing = false;
  }
}

function endDrawing(e) {
  if (!state.isDrawing) return;
  const pos = getCanvasPos(e);
  state.isDrawing = false;

  annotationCtx.strokeStyle = state.color;
  annotationCtx.fillStyle = state.color;
  annotationCtx.lineWidth = parseInt(state.strokeSize);
  annotationCtx.lineCap = 'round';
  annotationCtx.lineJoin = 'round';

  if (state.currentTool === 'arrow') {
    drawArrow(annotationCtx, state.startX, state.startY, pos.x, pos.y);
  } else if (state.currentTool === 'rect') {
    const w = pos.x - state.startX;
    const h = pos.y - state.startY;
    annotationCtx.strokeRect(state.startX, state.startY, w, h);
  } else if (state.currentTool === 'blur') {
    applyBlur(state.startX, state.startY, pos.x, pos.y);
  }
}

function drawArrow(ctx, fromX, fromY, toX, toY) {
  const headLen = Math.max(15, ctx.lineWidth * 3);
  const angle = Math.atan2(toY - fromY, toX - fromX);

  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(toX - headLen * Math.cos(angle - Math.PI / 6), toY - headLen * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(toX - headLen * Math.cos(angle + Math.PI / 6), toY - headLen * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

function applyBlur(x1, y1, x2, y2) {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const w = Math.abs(x2 - x1);
  const h = Math.abs(y2 - y1);
  if (w < 4 || h < 4) return;

  // Get pixels from screenshot canvas and pixelate them
  const imgData = screenshotCtx.getImageData(x, y, w, h);
  const pixelSize = 10;
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = w;
  tempCanvas.height = h;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.putImageData(imgData, 0, 0);

  // Pixelate by drawing small then scaling up
  const blurCanvas = document.createElement('canvas');
  blurCanvas.width = Math.max(1, Math.floor(w / pixelSize));
  blurCanvas.height = Math.max(1, Math.floor(h / pixelSize));
  const blurCtx = blurCanvas.getContext('2d');
  blurCtx.drawImage(tempCanvas, 0, 0, blurCanvas.width, blurCanvas.height);

  annotationCtx.save();
  annotationCtx.imageSmoothingEnabled = false;
  annotationCtx.drawImage(blurCanvas, x, y, w, h);
  annotationCtx.restore();
}

function showTextInput(x, y) {
  const overlay = document.getElementById('text-input-overlay');
  const input = document.getElementById('text-input');
  const rect = annotationCanvas.getBoundingClientRect();
  const scaleX = rect.width / annotationCanvas.width;
  const scaleY = rect.height / annotationCanvas.height;

  state.textPos = { x, y };
  overlay.classList.remove('hidden');
  overlay.style.left = (x * scaleX + rect.left - document.querySelector('.canvas-container').getBoundingClientRect().left) + 'px';
  overlay.style.top = (y * scaleY + rect.top - document.querySelector('.canvas-container').getBoundingClientRect().top) + 'px';
  input.value = '';
  input.focus();
}

function commitTextInput() {
  const overlay = document.getElementById('text-input-overlay');
  const input = document.getElementById('text-input');
  const text = input.value.trim();

  if (text && state.textPos) {
    saveAnnotationState();
    annotationCtx.font = `${Math.max(14, parseInt(state.strokeSize) * 3)}px sans-serif`;
    annotationCtx.fillStyle = state.color;
    annotationCtx.strokeStyle = 'rgba(0,0,0,0.5)';
    annotationCtx.lineWidth = 2;
    // Add text with outline for readability
    text.split('\n').forEach((line, i) => {
      const lineY = state.textPos.y + (i + 1) * parseInt(annotationCtx.font);
      annotationCtx.strokeText(line, state.textPos.x, lineY);
      annotationCtx.fillText(line, state.textPos.x, lineY);
    });
  }

  overlay.classList.add('hidden');
  state.textPos = null;
}

function undo() {
  if (state.undoStack.length === 0) return;
  const current = annotationCtx.getImageData(0, 0, annotationCanvas.width, annotationCanvas.height);
  state.redoStack.push(current);
  const prev = state.undoStack.pop();
  annotationCtx.putImageData(prev, 0, 0);
}

function redo() {
  if (state.redoStack.length === 0) return;
  const current = annotationCtx.getImageData(0, 0, annotationCanvas.width, annotationCanvas.height);
  state.undoStack.push(current);
  const next = state.redoStack.pop();
  annotationCtx.putImageData(next, 0, 0);
}

function getMergedDataUrl() {
  const merged = document.createElement('canvas');
  merged.width = screenshotCanvas.width;
  merged.height = screenshotCanvas.height;
  const ctx = merged.getContext('2d');
  ctx.drawImage(screenshotCanvas, 0, 0);
  ctx.drawImage(annotationCanvas, 0, 0);
  return merged.toDataURL('image/png');
}

async function copyToClipboard() {
  const dataUrl = getMergedDataUrl();

  try {
    const blob = await fetch(dataUrl).then(r => r.blob());
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': blob })
    ]);
    saveToHistory(dataUrl);
    renderHistory();
    const feedback = document.getElementById('copy-feedback');
    feedback.classList.remove('hidden');
    setTimeout(() => feedback.classList.add('hidden'), 4000);
  } catch (err) {
    // Fallback: copy as base64 data URL text
    try {
      await navigator.clipboard.writeText(dataUrl);
      alert('クリップボードにコピーしました（テキスト形式）');
    } catch {
      alert('クリップボードへのコピーに失敗しました。ダウンロードをお試しください。');
    }
  }
}

function downloadScreenshot() {
  const dataUrl = getMergedDataUrl();
  saveToHistory(dataUrl);
  renderHistory();

  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `screenshot_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.png`;
  a.click();
}

function createShareLink() {
  const dataUrl = getMergedDataUrl();
  const entry = saveToHistory(dataUrl);
  renderHistory();

  // Open share screen
  document.getElementById('share-preview-img').src = dataUrl;
  const linkInput = document.getElementById('share-link-input');
  linkInput.value = 'data:image/png;base64,...（クリップボードから貼り付け可能）';
  showScreen('share');

  // Also copy to clipboard automatically
  fetch(dataUrl).then(r => r.blob()).then(blob => {
    navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }).catch(() => {});
}

// =====================
// Event bindings
// =====================
document.addEventListener('DOMContentLoaded', () => {
  // Render history
  renderHistory();

  // Initial buttons
  document.getElementById('btn-capture-tab').addEventListener('click', captureTabAndEdit);
  document.getElementById('btn-capture-area').addEventListener('click', captureArea);
  document.getElementById('btn-clear-history').addEventListener('click', () => {
    localStorage.removeItem('screenshot_history');
    renderHistory();
  });

  // Tool buttons
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentTool = btn.dataset.tool;
      if (annotationCanvas) {
        annotationCanvas.style.cursor = state.currentTool === 'pointer' ? 'default' : 'crosshair';
      }
    });
  });

  document.getElementById('color-picker').addEventListener('input', (e) => {
    state.color = e.target.value;
  });
  document.getElementById('stroke-size').addEventListener('change', (e) => {
    state.strokeSize = parseInt(e.target.value);
  });

  document.getElementById('btn-undo').addEventListener('click', undo);
  document.getElementById('btn-redo').addEventListener('click', redo);
  document.getElementById('btn-back').addEventListener('click', () => {
    showScreen('initial');
    renderHistory();
  });
  document.getElementById('btn-copy-clipboard').addEventListener('click', copyToClipboard);
  document.getElementById('btn-copy-link').addEventListener('click', createShareLink);
  document.getElementById('btn-download').addEventListener('click', downloadScreenshot);

  // Canvas drawing events
  // These are set up after editor is opened (canvas is ready)
  const setupCanvasEvents = () => {
    const canvas = document.getElementById('annotation-canvas');
    if (!canvas) return;
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', drawAnnotation);
    canvas.addEventListener('mouseup', endDrawing);
    canvas.addEventListener('mouseleave', endDrawing);
  };

  // Observer to setup canvas events when editor becomes active
  const observer = new MutationObserver(() => {
    if (screens.editor.classList.contains('active')) {
      setupCanvasEvents();
    }
  });
  observer.observe(screens.editor, { attributes: true, attributeFilter: ['class'] });

  // Text input events
  document.getElementById('text-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commitTextInput();
    }
    if (e.key === 'Escape') {
      document.getElementById('text-input-overlay').classList.add('hidden');
      state.textPos = null;
    }
  });
  document.getElementById('text-input').addEventListener('blur', commitTextInput);

  // Share screen
  document.getElementById('btn-share-clipboard').addEventListener('click', async () => {
    const img = document.getElementById('share-preview-img');
    try {
      const blob = await fetch(img.src).then(r => r.blob());
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      document.getElementById('btn-share-clipboard').textContent = '✅ コピー済み！Teams・メールに貼り付けできます';
    } catch (err) {
      alert('コピーに失敗しました');
    }
  });

  document.getElementById('btn-copy-link-share').addEventListener('click', async () => {
    const img = document.getElementById('share-preview-img');
    try {
      const blob = await fetch(img.src).then(r => r.blob());
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      document.getElementById('btn-copy-link-share').textContent = '✅';
    } catch {
      navigator.clipboard.writeText(img.src);
    }
  });

  document.getElementById('btn-share-back').addEventListener('click', () => showScreen('editor'));

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'z') undo();
    if (e.ctrlKey && e.key === 'y') redo();
    if (e.ctrlKey && e.key === 'c' && screens.editor.classList.contains('active')) {
      copyToClipboard();
    }
  });
});
