(() => {
  'use strict';

  const STORAGE_KEY = 'paper-between-markdown-card-v1';
  const DEFAULTS = { theme: 'minimal', fontSize: 18, lineHeight: 1.75, width: 720, background: '#fffefb' };
  const SAMPLE = `# 把知识，变成一张好看的卡片

> 书写是思考的显影液。先把想法写下来，再让它变得清晰。

## 一个简单的工作流

1. 在左侧输入 **Markdown**
2. 选择喜欢的排版主题
3. 调整字号、行距与纸张宽度
4. 导出一张可以分享的 PNG 长图

### 支持的内容

| 内容 | 支持情况 |
| --- | :---: |
| 标题、段落、列表 | ✓ |
| 引用与代码块 | ✓ |
| GFM 表格 | ✓ |

\`\`\`js
const safeHTML = DOMPurify.sanitize(
  marked.parse(markdown)
);
\`\`\`

---

所有内容只保存在你的浏览器中。`;

  const $ = selector => document.querySelector(selector);
  const elements = {
    input: $('#markdownInput'), rendered: $('#renderedMarkdown'), card: $('#exportTarget'),
    fontSize: $('#fontSize'), lineHeight: $('#lineHeight'), width: $('#contentWidth'), background: $('#backgroundColor'),
    fontValue: $('#fontSizeValue'), lineValue: $('#lineHeightValue'), widthValue: $('#contentWidthValue'), backgroundValue: $('#backgroundValue'),
    saveStatus: $('#saveStatus'), wordCount: $('#wordCount'), toast: $('#toast'), exportButton: $('#exportButton'),
    fileInput: $('#fileInput'), editorPanel: $('#editorPanel'), previewPanel: $('#previewPanel'), editTab: $('#editTab'), previewTab: $('#previewTab')
  };

  const allowedTags = ['h1','h2','h3','h4','h5','h6','p','br','hr','strong','em','del','ul','ol','li','blockquote','pre','code','table','thead','tbody','tr','th','td','a'];
  const sanitizeConfig = {
    RETURN_DOM_FRAGMENT: true,
    ALLOWED_TAGS: allowedTags,
    ALLOWED_ATTR: ['href','title'],
    FORBID_TAGS: ['img','svg','math','style','script','form','input','button','textarea','select','iframe','object','embed','audio','video','canvas','template'],
    FORBID_ATTR: ['style','class','id','name','target','src','srcset'],
    SANITIZE_NAMED_PROPS: true,
    KEEP_CONTENT: true
  };

  let state = loadState();
  let saveTimer;
  let toastTimer;

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return { markdown: typeof saved.markdown === 'string' ? saved.markdown : SAMPLE, settings: { ...DEFAULTS, ...(saved.settings || {}) } };
    } catch {
      return { markdown: SAMPLE, settings: { ...DEFAULTS } };
    }
  }

  function renderMarkdown() {
    const dirtyHTML = marked.parse(elements.input.value, { gfm: true, breaks: true });
    const cleanFragment = DOMPurify.sanitize(dirtyHTML, sanitizeConfig);
    elements.rendered.replaceChildren(cleanFragment);
    const count = elements.input.value.replace(/\s/g, '').length;
    elements.wordCount.textContent = `${count} 字`;
    scheduleSave();
  }

  function applySettings(settings = state.settings) {
    const theme = ['minimal','magazine','sticky'].includes(settings.theme) ? settings.theme : DEFAULTS.theme;
    elements.card.className = `card theme-${theme}`;
    elements.card.style.width = `${settings.width}px`;
    elements.card.style.setProperty('--card-bg', settings.background);
    elements.rendered.style.fontSize = `${settings.fontSize}px`;
    elements.rendered.style.lineHeight = String(settings.lineHeight);
    elements.rendered.style.setProperty('--mobile-font', `${settings.fontSize}px`);
    elements.fontSize.value = settings.fontSize;
    elements.lineHeight.value = settings.lineHeight;
    elements.width.value = settings.width;
    elements.background.value = settings.background;
    elements.fontValue.value = `${settings.fontSize} px`;
    elements.lineValue.value = Number(settings.lineHeight).toFixed(2).replace(/0$/, '');
    elements.widthValue.value = `${settings.width} px`;
    elements.backgroundValue.value = settings.background.toUpperCase();
    document.querySelectorAll('.theme-option').forEach(label => {
      const selected = label.querySelector('input').value === theme;
      label.classList.toggle('selected', selected);
      label.querySelector('input').checked = selected;
    });
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    elements.saveStatus.textContent = '正在保存…';
    saveTimer = setTimeout(saveNow, 260);
  }

  function saveNow() {
    state.markdown = elements.input.value;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      elements.saveStatus.textContent = '草稿已保存';
    } catch {
      elements.saveStatus.textContent = '浏览器存储已满';
    }
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add('show');
    toastTimer = setTimeout(() => elements.toast.classList.remove('show'), 2400);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadMarkdown() {
    saveNow();
    downloadBlob(new Blob([elements.input.value], { type: 'text/markdown;charset=utf-8' }), `markdown-card-${dateStamp()}.md`);
    showToast('Markdown 已下载');
  }

  async function exportPNG() {
    elements.exportButton.disabled = true;
    elements.exportButton.querySelector('span').textContent = '正在生成…';
    showMobilePanel('preview');
    try {
      if (document.fonts?.ready) await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const rect = elements.card.getBoundingClientRect();
      const maxDimension = 16000;
      const scale = Math.min(2, maxDimension / Math.max(rect.width, 1), maxDimension / Math.max(elements.card.scrollHeight, 1));
      if (scale < 0.25) throw new Error('内容过长，请先减小字号或拆分内容');
      const canvas = await html2canvas(elements.card, {
        backgroundColor: state.settings.background,
        scale,
        useCORS: false,
        allowTaint: false,
        logging: false,
        width: Math.ceil(rect.width),
        height: elements.card.scrollHeight,
        windowWidth: Math.ceil(rect.width)
      });
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png', 1));
      if (!blob) throw new Error('浏览器未能生成图片');
      downloadBlob(blob, `markdown-card-${dateStamp()}.png`);
      showToast(scale < 1 ? '长图已导出（为兼容超长画布已自动缩放）' : 'PNG 长图已导出');
    } catch (error) {
      showToast(error.message || '导出失败，请缩短内容后重试');
    } finally {
      elements.exportButton.disabled = false;
      elements.exportButton.querySelector('span').textContent = '导出 PNG';
    }
  }

  function dateStamp() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }

  function showMobilePanel(panel) {
    const isEdit = panel === 'edit';
    elements.editorPanel.classList.toggle('active-mobile', isEdit);
    elements.previewPanel.classList.toggle('active-mobile', !isEdit);
    elements.editTab.classList.toggle('active', isEdit);
    elements.previewTab.classList.toggle('active', !isEdit);
    elements.editTab.setAttribute('aria-selected', String(isEdit));
    elements.previewTab.setAttribute('aria-selected', String(!isEdit));
  }

  elements.input.value = state.markdown;
  applySettings();
  renderMarkdown();

  elements.input.addEventListener('input', renderMarkdown);
  document.querySelectorAll('input[name=theme]').forEach(input => input.addEventListener('change', event => {
    state.settings.theme = event.target.value;
    const themedDefaults = { minimal: '#fffefb', magazine: '#f8f3e8', sticky: '#fff2a8' };
    state.settings.background = themedDefaults[state.settings.theme];
    applySettings(); scheduleSave();
  }));
  elements.fontSize.addEventListener('input', event => { state.settings.fontSize = Number(event.target.value); applySettings(); scheduleSave(); });
  elements.lineHeight.addEventListener('input', event => { state.settings.lineHeight = Number(event.target.value); applySettings(); scheduleSave(); });
  elements.width.addEventListener('input', event => { state.settings.width = Number(event.target.value); applySettings(); scheduleSave(); });
  elements.background.addEventListener('input', event => { state.settings.background = event.target.value; applySettings(); scheduleSave(); });

  $('#resetButton').addEventListener('click', () => { state.settings = { ...DEFAULTS }; applySettings(); scheduleSave(); showToast('样式已恢复默认'); });
  $('#importButton').addEventListener('click', () => elements.fileInput.click());
  $('#downloadButton').addEventListener('click', downloadMarkdown);
  elements.exportButton.addEventListener('click', exportPNG);
  elements.fileInput.addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { showToast('文件超过 2 MB，未导入'); return; }
    elements.input.value = await file.text();
    renderMarkdown();
    showToast(`已导入 ${file.name}`);
    event.target.value = '';
  });
  elements.editTab.addEventListener('click', () => showMobilePanel('edit'));
  elements.previewTab.addEventListener('click', () => showMobilePanel('preview'));
  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); downloadMarkdown(); }
  });
})();
