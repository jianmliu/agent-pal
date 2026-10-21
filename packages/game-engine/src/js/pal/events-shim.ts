export type EventDispatcher = {
  fire?: (...args: unknown[]) => unknown;
  on?: (...args: unknown[]) => unknown;
  off?: (...args: unknown[]) => unknown;
  extend?: (target: unknown, source: unknown) => void;
};

type EventShim = EventDispatcher & { Events?: EventDispatcher };

const utils = {} as EventShim;

export default utils;
