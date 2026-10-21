import reactiveContext from '../state/reactive-context.js';

type ObservableLike<T = unknown> = {
  subscribe: (...args: any[]) => any;
};

type SignalLike<T = unknown> = {
  value: T;
  subscribe?: (...args: any[]) => any;
  asObservable?: () => ObservableLike<T>;
  complete?: () => void;
};

type Projector<T = unknown, R = unknown> = (value: T) => R;

interface AdapterObservable<T = unknown> {
  (): ObservableLike<T>;
  asObservable: () => ObservableLike<T>;
  subscribe: (...args: any[]) => any;
  getValue?: () => T;
  label: string;
}

interface AdapterOptions<T = unknown, R = T> {
  name?: string;
  getValue?: () => R;
  observe?: (() => ObservableLike<R>) | ObservableLike<R>;
  signal?: SignalLike<T> | null;
  projector?: Projector<T, R> | null;
}

function validateObservable<T>(stream: ObservableLike<T> | null | undefined, label?: string): ObservableLike<T> {
  if (!stream || typeof stream.subscribe !== 'function') {
    throw new TypeError(`[adapter] ${label || 'stream'} is not an Observable`);
  }
  return stream;
}

export function createAdapterObservable<T = unknown, R = T>(options: AdapterOptions<T, R> = {}): AdapterObservable<R> {
  const {
    name = 'adapter$',
    getValue = null,
    observe,
    signal = null,
    projector = null
  } = options;

  if (!observe && !signal) {
    throw new TypeError('[adapter] createAdapterObservable requires either observe() or signal');
  }

  const compute =
    typeof getValue === 'function'
      ? getValue
      : (signal
        ? (() => {
            const value = signal.value;
            return typeof projector === 'function' ? projector(value) : (value as unknown as R);
          })
        : (() => undefined as unknown as R));

  let cachedStream: ObservableLike<R> | null = null;

  const resolveStream = (): ObservableLike<R> => {
    if (cachedStream) {
      return cachedStream;
    }
    if (observe) {
      cachedStream = validateObservable(
        typeof observe === 'function' ? observe() : observe,
        name
      );
    } else if (signal) {
      cachedStream = reactiveContext.signalToObservable(signal as any, () => compute()) as ObservableLike<R>;
    }
    return cachedStream as ObservableLike<R>;
  };

  const facade = function adapterObservable() {
    return resolveStream();
  } as AdapterObservable<R>;

  facade.asObservable = () => resolveStream();
  facade.subscribe = (...args: any[]) => resolveStream().subscribe(...args);
  if (compute) {
    facade.getValue = compute;
  }
  facade.label = name;

  return facade;
}

export function attachAdapterObservable<T = unknown, R = T>(target: AdapterObservable<R>, options: AdapterOptions<T, R>) {
  if (typeof target !== 'function') {
    throw new TypeError('[adapter] attachAdapterObservable target must be a function');
  }
  const observable = createAdapterObservable(options);
  target.asObservable = observable.asObservable;
  target.subscribe = observable.subscribe;
  if (observable.getValue) {
    target.getValue = observable.getValue;
  }
  target.label = observable.label;
  return target;
}
