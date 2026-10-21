import utils from '../js/pal/utils';
import type { EventDispatcher } from '../js/pal/events-shim';

const utilsAny: EventDispatcher & { Events?: EventDispatcher } = utils as unknown as EventDispatcher & { Events?: EventDispatcher };

class EventBus {
  constructor() {
    if (utilsAny?.extend && utilsAny?.Events) {
      utilsAny.extend(this, utilsAny.Events);
    }
  }

  fire(...args: unknown[]): unknown {
    const events: EventDispatcher | undefined = utilsAny?.Events;
    if (events?.fire) {
      return events.fire.apply(this, args);
    }
    return undefined;
  }

  on(...args: unknown[]): unknown {
    const events: EventDispatcher | undefined = utilsAny?.Events;
    if (events?.on) {
      return events.on.apply(this, args);
    }
    return undefined;
  }

  off(...args: unknown[]): unknown {
    const events: EventDispatcher | undefined = utilsAny?.Events;
    if (events?.off) {
      return events.off.apply(this, args);
    }
    return undefined;
  }
}

export default EventBus;
