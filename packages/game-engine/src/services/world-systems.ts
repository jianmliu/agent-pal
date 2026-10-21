import EventBus from './event-bus';
import collisionSystem from '../ecs/systems/collision-system';
import npcMoveSystem from '../ecs/systems/npc-move-system';
import renderMapSystem from '../ecs/systems/render-map-system';
import renderEventObjectSystem from '../ecs/systems/render-event-object-system';
import { WorldService } from './world-service';

const DEFAULT_PIPELINE = ['collision', 'movement', 'map', 'eventObjects'];

type SystemFn = (context: any) => void;

export class WorldSystemManager extends EventBus {
  worldService: WorldService | null;
  private _systems: Map<string, SystemFn[]>;
  private _pipeline: string[];
  private _context: any;

  constructor(worldService: WorldService | null, baseContext: any = {}) {
    super();
    this.worldService = worldService;
    this._systems = new Map();
    this._pipeline = DEFAULT_PIPELINE.slice();
    this._context = Object.assign({}, baseContext);
  }

  setContext(context: any) {
    this._context = context || {};
  }

  register(phase: string, systemFn: SystemFn) {
    if (!phase || typeof systemFn !== 'function') {
      throw new Error('phase and system function are required');
    }
    let list = this._systems.get(phase);
    if (!list) {
      list = [];
      this._systems.set(phase, list);
    }
    list.push(systemFn);
  }

  run(phase: string, context?: any) {
    const systems = this._systems.get(phase);
    if (!systems || systems.length === 0) {
      return;
    }
    const runtime = Object.assign(
      {},
      this._context,
      context,
      {
        worldService: this.worldService,
        world: this.worldService
      }
    );
    for (let i = 0; i < systems.length; i++) {
      systems[i](runtime);
    }
  }

  runPipeline(phases?: string | string[], context?: any) {
    let effective: string[] = [];
    if (!phases) {
      effective = this._pipeline.slice();
    } else if (Array.isArray(phases)) {
      effective = phases;
    } else {
      effective = [phases];
    }
    for (let i = 0; i < effective.length; i++) {
      this.run(effective[i], context);
    }
  }

  clearPipeline() {
    this._pipeline = [];
  }
}

interface CreateWorldSystemManagerOptions {
  worldService?: WorldService;
  context?: any;
}

export default function createWorldSystemManager(options: CreateWorldSystemManagerOptions = {}) {
  const manager = new WorldSystemManager(options.worldService || null, options.context);
  manager.register('collision', collisionSystem);
  manager.register('movement', npcMoveSystem);
  manager.register('map', renderMapSystem);
  manager.register('eventObjects', renderEventObjectSystem);
  return manager;
}

export { renderMapSystem, renderEventObjectSystem, DEFAULT_PIPELINE };
