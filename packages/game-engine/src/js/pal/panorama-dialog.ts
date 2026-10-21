import dialogService, { type DialogLine } from '../../services/dialog-service.js';

const DEFAULT_FONT = '"Noto Sans CJK SC", "Microsoft YaHei", sans-serif';

type Unsubscribe = () => void;

type Signal<T> = {
  subscribe: (handler: (value: T) => void) => Unsubscribe;
};

type DialogStatus = {
  active?: boolean;
  awaitingInput?: boolean;
  [key: string]: unknown;
};

type DialogSignals = {
  currentLine?: Signal<DialogLine | null>;
  status?: Signal<DialogStatus>;
};

type DialogServiceLike = {
  signals?: DialogSignals;
};

type PanoramaDialogOptions = {
  dialogService?: DialogServiceLike;
};

class PanoramaDialogOverlay {
  initialized: boolean;
  enabled: boolean;
  active: boolean;
  hasContent: boolean;
  container: HTMLDivElement | null;
  portraitEl: HTMLDivElement | null;
  textEl: HTMLDivElement | null;
  nameEl: HTMLDivElement | null;
  dialog: DialogServiceLike | null;
  subscriptions: Unsubscribe[];
  currentText: string;
  currentSpeaker: string | null;
  lastLineIndex: number | null;

  constructor() {
    this.initialized = false;
    this.enabled = false;
    this.active = false;
    this.hasContent = false;
    this.container = null;
    this.portraitEl = null;
    this.textEl = null;
    this.nameEl = null;
    this.dialog = null;
    this.subscriptions = [];
    this.currentText = '';
    this.currentSpeaker = null;
    this.lastLineIndex = null;
  }

  init(options: PanoramaDialogOptions = {}) {
    if (this.initialized || typeof document === 'undefined') {
      return;
    }
    const wrap = document.getElementById('wrap') || document.body;
    if (!wrap) {
      return;
    }
    const container = document.createElement('div');
    container.id = 'pal-panorama-dialog';
    container.style.position = 'absolute';
    container.style.left = '50%';
    container.style.bottom = '120px';
    container.style.transform = 'translateX(-50%)';
    container.style.width = '76%';
    container.style.maxWidth = '960px';
    container.style.padding = '18px 28px';
    container.style.boxSizing = 'border-box';
    container.style.borderRadius = '18px';
    container.style.border = '1px solid rgba(255, 255, 255, 0.15)';
    container.style.background = 'rgba(0, 0, 0, 0.55)';
    container.style.color = '#fff';
    container.style.fontFamily = DEFAULT_FONT;
    container.style.fontSize = '20px';
    container.style.lineHeight = '1.5';
    container.style.display = 'none';
    container.style.zIndex = '8';
    container.style.pointerEvents = 'none';

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '16px';

    const portrait = document.createElement('div');
    portrait.style.width = '72px';
    portrait.style.height = '72px';
    portrait.style.flex = '0 0 auto';
    portrait.style.borderRadius = '12px';
    portrait.style.background = 'rgba(255, 255, 255, 0.12)';
    portrait.style.backgroundSize = 'cover';
    portrait.style.backgroundPosition = 'center';
    portrait.style.display = 'none';

    const textStack = document.createElement('div');
    textStack.style.flex = '1';
    textStack.style.display = 'flex';
    textStack.style.flexDirection = 'column';
    textStack.style.gap = '6px';

    const nameEl = document.createElement('div');
    nameEl.style.fontWeight = '600';
    nameEl.style.fontSize = '18px';
    nameEl.style.letterSpacing = '0.02em';
    nameEl.style.opacity = '0.95';
    nameEl.style.display = 'none';

    const textEl = document.createElement('div');
    textEl.style.whiteSpace = 'pre-wrap';
    textEl.style.wordBreak = 'break-word';

    textStack.appendChild(nameEl);
    textStack.appendChild(textEl);
    row.appendChild(portrait);
    row.appendChild(textStack);
    container.appendChild(row);
    wrap.appendChild(container);

    this.container = container;
    this.portraitEl = portrait;
    this.textEl = textEl;
    this.nameEl = nameEl;
    this.dialog = options.dialogService || (dialogService as DialogServiceLike);
    this.initialized = true;

    this.bindSignals();

    if (typeof window !== 'undefined') {
      (window as any).PAL_PANORAMA_DIALOG = this;
    }
  }

  bindSignals() {
    if (!this.dialog || !this.dialog.signals) {
      return;
    }
    const register = <T>(signal: Signal<T> | undefined, handler: (value: T) => void) => {
      if (!signal || typeof signal.subscribe !== 'function') {
        return;
      }
      const unsubscribe = signal.subscribe(handler);
      this.subscriptions.push(unsubscribe);
    };
    register(this.dialog.signals.currentLine, (line) => this.applyLine(line));
    register(this.dialog.signals.status, (status) => this.applyStatus(status));
  }

  setMode(mode: string) {
    const nextEnabled = mode === 'panorama';
    if (this.enabled === nextEnabled) {
      this.updateVisibility();
      return;
    }
    this.enabled = nextEnabled;
    if (!nextEnabled) {
      this.clear();
    }
    this.updateVisibility();
  }

  resolveSpeaker(line: DialogLine | null) {
    if (!line) {
      return '';
    }
    const metadata = (line.metadata || {}) as Record<string, unknown>;
    return (
      (metadata as any).speaker ||
      (metadata as any).name ||
      (metadata as any).source ||
      line.source ||
      ''
    );
  }

  resolvePortrait(line: DialogLine | null) {
    if (!line || !line.metadata) {
      return null;
    }
    const metadata = line.metadata as Record<string, unknown>;
    return (
      (metadata as any).portraitUrl ||
      (metadata as any).portrait ||
      (metadata as any).avatar ||
      (metadata as any).avatarUrl ||
      null
    );
  }

  applyLine(line: DialogLine | null) {
    if (!line || !line.text) {
      this.hasContent = false;
      this.renderSpeaker(null);
      this.renderPortrait(null);
      this.renderText('');
      this.currentText = '';
      this.currentSpeaker = null;
      this.lastLineIndex = null;
      this.updateVisibility();
      return;
    }
    const resolvedSpeaker = this.resolveSpeaker(line);
    const lineIndex = Number.isFinite(line.line as number) ? (line.line as number) : null;
    const shouldReset =
      !this.hasContent ||
      this.currentSpeaker !== resolvedSpeaker ||
      lineIndex === null ||
      lineIndex === 0 ||
      (this.lastLineIndex != null && lineIndex <= this.lastLineIndex);

    const trimmed = (line.text || '').trim();
    if (shouldReset) {
      this.currentText = trimmed;
    } else if (trimmed) {
      this.currentText = this.currentText ? `${this.currentText} ${trimmed}` : trimmed;
    }

    this.currentSpeaker = resolvedSpeaker;
    this.lastLineIndex = lineIndex;
    this.hasContent = true;
    const decoratedText = resolvedSpeaker
      ? `${resolvedSpeaker}：${this.currentText || ''}`.trim()
      : (this.currentText || resolvedSpeaker || '');
    this.renderText(decoratedText);
    this.renderSpeaker(resolvedSpeaker);
    this.renderPortrait(this.resolvePortrait(line));
    this.updateVisibility();
  }

  applyStatus(status: DialogStatus = {}) {
    this.active = !!status.active;
    if (!this.active && status.awaitingInput !== true) {
      this.clear();
    } else {
      this.updateVisibility();
    }
  }

  renderText(text: string) {
    if (!this.textEl) {
      return;
    }
    this.textEl.textContent = text || '';
  }

  renderSpeaker(name: string | null) {
    this.currentSpeaker = name || null;
    if (!this.nameEl) {
      return;
    }
    this.nameEl.textContent = '';
    this.nameEl.style.display = 'none';
  }

  renderPortrait(url: string | null) {
    if (!this.portraitEl) {
      return;
    }
    if (url) {
      this.portraitEl.style.display = '';
      this.portraitEl.style.backgroundImage = `url(${url})`;
    } else {
      this.portraitEl.style.display = 'none';
      this.portraitEl.style.backgroundImage = 'none';
    }
  }

  clear() {
    this.hasContent = false;
    this.renderText('');
    this.renderSpeaker(null);
    this.renderPortrait(null);
    this.currentText = '';
    this.currentSpeaker = null;
    this.lastLineIndex = null;
    this.updateVisibility();
  }

  updateVisibility() {
    if (!this.container) {
      return;
    }
    const shouldShow = this.enabled && this.active && this.hasContent;
    this.container.style.display = shouldShow ? 'flex' : 'none';
  }
}

const panoramaDialog = new PanoramaDialogOverlay();

export default panoramaDialog;
