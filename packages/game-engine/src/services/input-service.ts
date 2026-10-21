import {ownedRewardWaitScope} from './battle-reward-wait';
import EventBus from './event-bus.js';
import worldService from './world-service.js';
import config from '../js/pal/config';

export enum Key {
  Menu = 1,
  Search = 2,
  Down = 4,
  Left = 8,
  Up = 16,
  Right = 32,
  PageUp = 64,
  PageDown = 128,
  Repeat = 256,
  Auto = 512,
  Defend = 1024,
  UseItem = 2048,
  ThrowItem = 4096,
  Flee = 8192,
  Status = 16384,
  Force = 32768,
  Home = 65536,
  End = 131072
}

export enum Direction {
  South = 0,
  West = 1,
  North = 2,
  East = 3,
  Unknown = 4
}

const MIN_DEADZONE = -16384;
const MAX_DEADZONE = 16384;
const TOUCH_MOVE_THRESHOLD = 12;
const TOUCH_TAP_DISTANCE = 16;
const TOUCH_TAP_TIME = 350;
// Menus poll `keyPress` once per frame (24 FPS ≈ 42ms). sdlpal latches presses
// until PAL_ClearKeyState; here keyup clears the bit, so a tap whose keydown and
// keyup land inside one frame (fast tap, busy main thread, synthetic input) was
// never seen. Keep each press visible for at least ~2 frames.
const MIN_KEY_HOLD_MS = 100;

const KeyCodes = {
  A: 65, B: 66, C: 67, D: 68, E: 69, F: 70, G: 71, H: 72, I: 73, J: 74, K: 75, L: 76, M: 77,
  N: 78, O: 79, P: 80, Q: 81, R: 82, S: 83, T: 84, U: 85, V: 86, W: 87, X: 88, Y: 89, Z: 90,
  KP0: 96, KP1: 97, KP2: 98, KP3: 99, KP4: 100, KP5: 101, KP6: 102, KP7: 103, KP8: 104, KP9: 105,
  ENTER: 13, RETURN: 13, CTRL: 17, ALT: 18, ESC: 27, ESCAPE: 27, SPACE: 32,
  PAGEUP: 33, PAGEDOWN: 34, END: 35, HOME: 36, LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, INSERT: 45
};

const KeyCodesToPalKeys: Record<number, Key> = {};
KeyCodesToPalKeys[KeyCodes.UP]       = KeyCodesToPalKeys[KeyCodes.KP8]    = Key.Up;
KeyCodesToPalKeys[KeyCodes.DOWN]     = KeyCodesToPalKeys[KeyCodes.KP2]    = Key.Down;
KeyCodesToPalKeys[KeyCodes.LEFT]     = KeyCodesToPalKeys[KeyCodes.KP4]    = Key.Left;
KeyCodesToPalKeys[KeyCodes.RIGHT]    = KeyCodesToPalKeys[KeyCodes.KP6]    = Key.Right;
KeyCodesToPalKeys[KeyCodes.ESCAPE]   = KeyCodesToPalKeys[KeyCodes.INSERT] = KeyCodesToPalKeys[KeyCodes.KP0]  = Key.Menu;
KeyCodesToPalKeys[KeyCodes.RETURN]   = KeyCodesToPalKeys[KeyCodes.SPACE]  = KeyCodesToPalKeys[KeyCodes.CTRL] = Key.Search;
KeyCodesToPalKeys[KeyCodes.PAGEUP]   = KeyCodesToPalKeys[KeyCodes.KP9]    = Key.PageUp;
KeyCodesToPalKeys[KeyCodes.PAGEDOWN] = KeyCodesToPalKeys[KeyCodes.KP3]    = Key.PageDown;
KeyCodesToPalKeys[KeyCodes.HOME]     = KeyCodesToPalKeys[KeyCodes.KP7]    = Key.Home;
KeyCodesToPalKeys[KeyCodes.END]      = KeyCodesToPalKeys[KeyCodes.KP1]    = Key.End;
KeyCodesToPalKeys[KeyCodes.R] = Key.Repeat;
KeyCodesToPalKeys[KeyCodes.A] = Key.Auto;
KeyCodesToPalKeys[KeyCodes.D] = Key.Defend;
KeyCodesToPalKeys[KeyCodes.E] = Key.UseItem;
KeyCodesToPalKeys[KeyCodes.W] = Key.ThrowItem;
KeyCodesToPalKeys[KeyCodes.Q] = Key.Flee;
KeyCodesToPalKeys[KeyCodes.S] = Key.Status;
KeyCodesToPalKeys[KeyCodes.F] = Key.Force;

const PalKeysToPalDirs: Record<number, Direction> = {};
PalKeysToPalDirs[Key.Up]    = Direction.North;
PalKeysToPalDirs[Key.Down]  = Direction.South;
PalKeysToPalDirs[Key.Left]  = Direction.West;
PalKeysToPalDirs[Key.Right] = Direction.East;

class InputService extends EventBus {
  public keyPress: number = 0;
  public dir: Direction = Direction.Unknown;
  public prevDir: Direction = Direction.Unknown;
  public listening: boolean = false;
  public touchListening: boolean = false;
  public lastUserInputAt: number = 0;
  public lastSimulatedAt: number = 0;
  public lastConfirmInputAt: number = 0;
  public allowSimulatedConfirm: boolean = false;
  private _touchState: any = null;
  private _simulating: boolean = false;
  private _pressedAt: Record<number, number> = {};
  private _pendingRelease: Record<number, ReturnType<typeof setTimeout>> = {};

  constructor() {
    super();
    this.handleKeyboardEvent = this.handleKeyboardEvent.bind(this);
  }

  public init() {
    console.debug('[INPUT-SERVICE] init');
    if (this.listening) return;
    this.dir = this.prevDir = Direction.Unknown;
    
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.handleKeyboardEvent);
      window.addEventListener('keyup', this.handleKeyboardEvent);
      
      if (!this.touchListening && config.enableTouch && ('ontouchstart' in window || (window.navigator && window.navigator.maxTouchPoints > 0))) {
        this.touchListening = this.setupTouchListeners();
      }
    }
    this.listening = true;
  }

  public shutdown() {
    if (!this.listening) return;
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.handleKeyboardEvent);
      window.removeEventListener('keyup', this.handleKeyboardEvent);
    }
    if (this.touchListening) {
      this.removeTouchListeners();
      this.touchListening = false;
    }
    this.listening = false;
  }

  public isKeyPressed(key: number): boolean {
    return !!(this.keyPress & key);
  }

  public clear() {
    this.keyPress = 0;
  }

  public simulateKeyPress(palKey: number, duration?: number) {
    if (!Number.isFinite(palKey)) return;
    const holdDuration = Number.isFinite(duration) ? Math.max(16, duration!) : 120;
    this.lastSimulatedAt = Date.now();
    this._simulating = true;
    try {
      this.pressKey(palKey);
    } finally {
      this._simulating = false;
    }
    setTimeout(() => {
      this.releaseKey(palKey);
    }, holdDuration);
  }

  public isSimulatedInputActive(thresholdMs = 250): boolean {
    if (!this.lastSimulatedAt) return false;
    if (this.lastUserInputAt >= this.lastSimulatedAt) return false;
    const age = Date.now() - this.lastSimulatedAt;
    return age >= 0 && age <= thresholdMs;
  }

  public *waitForKey(timeout: number, capability?:unknown): Generator<Promise<void>, void, unknown> {
    const scoped=ownedRewardWaitScope(capability);
    if(scoped){if(!scoped.active)throw new Error('reward wait retired');return yield* this.waitForRewardKey(timeout,scoped);}
    this.clear();
    const endtime = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + timeout;
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    
    // Helper for sleep
    const sleepByFrame = (frames: number) => new Promise<void>(resolve => setTimeout(resolve, (1000/24) * frames));

    while (timeout === 0 || now() < endtime) {
      if (this.isKeyPressed(Key.Search | Key.Menu)) {
        break;
      }
      yield sleepByFrame(1);
    }
  }

  private *waitForRewardKey(timeout:number,scope:NonNullable<ReturnType<typeof ownedRewardWaitScope>>):Generator<Promise<void>,void,unknown> {
    this.clear();
    const inputBinding=typeof performance!=='undefined'?{performance,now:performance.now}:{Date,getTime:Date.prototype.getTime,now:Date.now};
    const now=()=>typeof performance!=='undefined'?performance.now():Date.now();
    scope.begin(scope.token,timeout,now()+timeout,inputBinding);
    const latch=(event:{data:number})=>scope.latch(event.data);this.on('keydown',latch);
    try{
      while(true){
        const sampled=now();
        if(timeout!==0&&sampled>=scope.deadline){scope.poll(sampled,false);break;}
        if(this.isKeyPressed(Key.Search|Key.Menu)){scope.poll(sampled,false);break;}
        scope.poll(sampled,true);
        const gate=scope.pause();if(gate)yield gate;
        if(!scope.active)throw new Error('reward wait retired');
        const sleep=new Promise<void>((resolve,reject)=>{
          const timer=setTimeout(()=>{scope.setTimer(null);resolve();},1000/24);
          scope.setTimer((error,primary)=>{try{clearTimeout(timer);}finally{queueMicrotask(()=>reject(primary?primary():error));}});
        });
        yield sleep;
        this.keyPress|=scope.takeLatched();
      }
    }finally{this.off('keydown',latch);scope.close();}
  }

  private pressKey(palKey: number) {
    if (palKey in this._pendingRelease) {
      clearTimeout(this._pendingRelease[palKey]);
      delete this._pendingRelease[palKey];
    }
    this._pressedAt[palKey] = Date.now();
    if (!this._simulating) {
      this.lastUserInputAt = Date.now();
      if (palKey & (Key.Search | Key.Menu)) {
        this.lastConfirmInputAt = this.lastUserInputAt;
      }
    }
    const previous = this.keyPress;
    this.keyPress |= palKey;
    if (palKey in PalKeysToPalDirs) {
      if (this.dir !== PalKeysToPalDirs[palKey]) {
        this.prevDir = (worldService.isInBattle() ? Direction.Unknown : this.dir);
        this.dir = PalKeysToPalDirs[palKey];
        // console.trace('[INPUT] turn from %d to %d', this.prevDir, this.dir);
      }
    }
    if (previous !== this.keyPress) {
      // console.trace('[INPUT] press %d', palKey);
    }
    this.fire('keydown', palKey);
  }

  private releaseKey(palKey: number) {
    const heldFor = Date.now() - (this._pressedAt[palKey] ?? 0);
    if (heldFor < MIN_KEY_HOLD_MS) {
      if (!(palKey in this._pendingRelease)) {
        this._pendingRelease[palKey] = setTimeout(() => {
          delete this._pendingRelease[palKey];
          this.releaseKey(palKey);
        }, MIN_KEY_HOLD_MS - heldFor);
      }
      return;
    }
    const previous = this.keyPress;
    this.keyPress &= ~palKey;
    if (palKey in PalKeysToPalDirs) {
      if (this.dir === PalKeysToPalDirs[palKey]) {
        // console.trace('[INPUT] walking %d back to %d', this.dir, this.prevDir);
        this.dir = this.prevDir;
        this.prevDir = Direction.Unknown;
      } else if (this.prevDir === PalKeysToPalDirs[palKey]) {
        // console.trace('[INPUT] cancel prev walking %d', this.prevDir);
        this.prevDir = Direction.Unknown;
      }
    }
    if (previous !== this.keyPress) {
      // console.trace('[INPUT] release %d', palKey);
    }
    this.fire('keyup', palKey);
  }

  private handleKeyboardEvent(evt: KeyboardEvent) {
    let processed = false;
    const keyCode = evt.keyCode;
    if (keyCode in KeyCodesToPalKeys) {
      processed = true;
      const palKey = KeyCodesToPalKeys[keyCode];
      if (evt.type === 'keydown' && evt.repeat && (palKey & (Key.Search | Key.Menu))) {
        evt.preventDefault();
        evt.stopPropagation();
        return;
      }
      switch (evt.type) {
        case 'keydown':
          this.pressKey(palKey);
          break;
        case 'keyup':
          this.releaseKey(palKey);
          break;
      }
      if (processed) {
        evt.preventDefault();
        evt.stopPropagation();
      }
    }
  }

  private setupTouchListeners(): boolean {
    if (typeof document === 'undefined') return false;
    const cvs = document.getElementById('cvs');
    if (!cvs) {
      console.warn('[INPUT] canvas element not found, touch disabled');
      return false;
    }

    const state = {
      key: null as number | null,
      identifier: null as number | null,
      startX: 0,
      startY: 0,
      startTime: 0,
      moved: false
    };
    this._touchState = state;

    const setDirectionalKey = (newKey: number | null) => {
      if (state.key === newKey) return;
      if (state.key) {
        this.releaseKey(state.key);
      }
      state.key = newKey;
      if (newKey) {
        this.pressKey(newKey);
      }
    };

    const directionFromPoint = (clientX: number, clientY: number) => {
      const rect = cvs.getBoundingClientRect();
      const width = rect.width || (cvs as HTMLCanvasElement).width;
      const height = rect.height || (cvs as HTMLCanvasElement).height;
      if (!width || !height) return null;
      const relX = clientX - rect.left;
      const relY = clientY - rect.top;
      if (relX < 0 || relY < 0 || relX > width || relY > height) return null;
      const offsetX = relX - width / 2;
      const offsetY = relY - height / 2;
      if (Math.abs(offsetX) > Math.abs(offsetY)) {
        return offsetX < 0 ? Key.Left : Key.Right;
      }
      return offsetY < 0 ? Key.Up : Key.Down;
    };

    const handleTouchStart = (ev: TouchEvent) => {
      if (state.identifier !== null) return;
      const touch = ev.changedTouches[0];
      state.identifier = touch.identifier;
      state.startX = touch.clientX;
      state.startY = touch.clientY;
      state.startTime = Date.now();
      state.moved = false;
      setDirectionalKey(directionFromPoint(touch.clientX, touch.clientY));
      ev.preventDefault();
    };

    const handleTouchMove = (ev: TouchEvent) => {
      for (let i = 0; i < ev.changedTouches.length; ++i) {
        const touch = ev.changedTouches[i];
        if (touch.identifier !== state.identifier) continue;
        const dx = touch.clientX - state.startX;
        const dy = touch.clientY - state.startY;
        if (!state.moved && (Math.abs(dx) > TOUCH_MOVE_THRESHOLD || Math.abs(dy) > TOUCH_MOVE_THRESHOLD)) {
          state.moved = true;
        }
        setDirectionalKey(directionFromPoint(touch.clientX, touch.clientY));
        ev.preventDefault();
        break;
      }
    };

    const handleTouchEnd = (ev: TouchEvent) => {
      for (let i = 0; i < ev.changedTouches.length; ++i) {
        const touch = ev.changedTouches[i];
        if (touch.identifier !== state.identifier) continue;
        setDirectionalKey(null);
        state.identifier = null;
        const duration = Date.now() - state.startTime;
        const dx = touch.clientX - state.startX;
        const dy = touch.clientY - state.startY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (!state.moved && distance < TOUCH_TAP_DISTANCE && duration < TOUCH_TAP_TIME) {
          this.pressKey(Key.Search);
          this.releaseKey(Key.Search);
        }
        ev.preventDefault();
        break;
      }
    };

    cvs.addEventListener('touchstart', handleTouchStart, { passive: false });
    cvs.addEventListener('touchmove', handleTouchMove, { passive: false });
    cvs.addEventListener('touchend', handleTouchEnd, { passive: false });
    cvs.addEventListener('touchcancel', handleTouchEnd, { passive: false });
    
    (this as any)._touchHandlers = { handleTouchStart, handleTouchMove, handleTouchEnd };
    return true;
  }

  private removeTouchListeners() {
    if (typeof document === 'undefined') return;
    const cvs = document.getElementById('cvs');
    if (!cvs) return;
    const handlers = (this as any)._touchHandlers;
    if (handlers) {
      cvs.removeEventListener('touchstart', handlers.handleTouchStart);
      cvs.removeEventListener('touchmove', handlers.handleTouchMove);
      cvs.removeEventListener('touchend', handlers.handleTouchEnd);
      cvs.removeEventListener('touchcancel', handlers.handleTouchEnd);
    }
    if (this._touchState) {
      this._touchState.key = null;
      this._touchState.identifier = null;
      this._touchState = null;
    }
  }
}

const inputService = new InputService();
export default inputService;
