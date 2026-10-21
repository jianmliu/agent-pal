/**
 * StoryGraph Service
 *
 * 提供统一的剧情图数据服务，可以被原版游戏引擎和 3D voxel 场景共同使用。
 *
 * 支持两种 StoryGraph 格式:
 *
 * 1. Voxel 场景格式 (opening-storygraph.json):
 *    - scenes: 场景定义，包括地图、角色、对话序列、出口等
 *    - characters: 角色定义，包括 voxel 文件、sprite ID 等
 *    - initialScene: 初始场景 ID
 *
 * 2. 完整游戏格式 (storygraph.json - 由 generate-storygraph.py 生成):
 *    - scenes: 以 "scene-{id}" 为键的场景对话数据
 *    - 每个场景包含 dialogs (入口脚本对话) 和 eventDialogs (事件对话)
 *
 * 使用方式:
 * 1. 原版游戏: import { storyGraphService } from './services/storygraph-service'
 * 2. Voxel 场景: fetch('/opening-storygraph.json')
 */

import config from '../js/pal/config';

// 基础对话条目
export interface DialogEntry {
  msgId: number;
  speaker: string | null;
  text: string;
  type?: 'narration' | 'system' | 'dialog';
  scriptId?: number;
}

export interface SceneExit {
  trigger: 'door' | 'event' | 'auto';
  position?: { x: number; z: number };
  radius?: number;
  nextScene: string;
}

export interface SceneAction {
  action: 'removeCharacters' | 'removeCharacter' | 'spawnCharacter' | 'playScript';
  characters?: string[];
  character?: string;
  scriptId?: number;
  description?: string;
}

export interface CharacterSpawn {
  id: string;
  position: { x: number; z: number };
  label?: string;
  direction?: string;
}

export interface SceneDefinition {
  id: string;
  name: string;
  mapId?: string;
  characters?: string[];
  spawnCharacters?: CharacterSpawn[];
  onEnter?: {
    scriptId?: number;
    description?: string;
  };
  dialogSequence?: DialogEntry[];
  exits?: SceneExit[];
  onComplete?: SceneAction;
  nextScene?: string;
  allowMovement?: boolean;
  hint?: string;
}

export interface CharacterDefinition {
  id: string;
  name: string;
  displayName?: string;
  voxelFile?: string;
  spriteId?: number;
}

// Voxel 场景格式 (用于 3D 场景)
export interface StoryGraph {
  version: number;
  name: string;
  description?: string;
  scenes: Record<string, SceneDefinition>;
  characters: Record<string, CharacterDefinition>;
  initialScene: string;
}

// 完整游戏 storygraph 格式 (由 generate-storygraph.py 生成)

// 脚本操作条目
export interface ScriptOperation {
  scriptId: number;
  opcode: number;
  opcodeName: string;
  description: string;
  operands: number[];
  // 对话相关字段
  msgId?: number;
  text?: string;
  speaker?: string | null;
  // 物品相关字段
  itemName?: string;
  // 场景相关字段
  targetScene?: number;
  // 战斗相关字段
  enemyTeam?: number;
  scriptOnWin?: number;
  scriptOnFlee?: number;
}

// 仅对话格式的事件 (向后兼容)
export interface GameEventDialog {
  eventId: number;
  spriteNum: number;
  position: { x: number; y: number };
  triggerDialogs: DialogEntry[];
  autoDialogs: DialogEntry[];
}

// 仅对话格式的场景 (向后兼容)
export interface GameSceneDialogs {
  sceneId: number;
  name: string;
  mapNum: number;
  scriptOnEnter: number;
  dialogs: DialogEntry[];
  eventDialogs: GameEventDialog[];
}

// 完整格式的事件
export interface FullGameEvent {
  eventId: number;
  index: number;
  spriteNum: number;
  position: { x: number; y: number };
  layer: number;
  triggerMode: number;
  triggerScript: number;
  autoScript: number;
  triggerOperations: ScriptOperation[];
  autoOperations: ScriptOperation[];
}

// 完整格式的场景
export interface FullGameScene {
  sceneId: number;
  name: string;
  mapNum: number;
  scriptOnEnter: number;
  scriptOnTeleport: number;
  enterOperations: ScriptOperation[];
  teleportOperations: ScriptOperation[];
  events: FullGameEvent[];
}

// 仅对话格式 (version: 1)
export interface DialogsOnlyStoryGraph {
  version: 1;
  format: 'dialogs_only';
  generatedAt: string;
  totalScenes: number;
  totalDialogs: number;
  scenes: Record<string, GameSceneDialogs>;
}

// 完整格式 (version: 2)
export interface FullStoryGraph {
  version: 2;
  format: 'full';
  generatedAt: string;
  totalScenes: number;
  totalOperations: number;
  totalDialogs: number;
  opcodeStats: Record<string, number>;
  scenes: Record<string, FullGameScene>;
}

// 联合类型
export type FullGameStoryGraph = DialogsOnlyStoryGraph | FullStoryGraph;

class StoryGraphService {
  private graphs: Map<string, StoryGraph> = new Map();
  private currentGraph: StoryGraph | null = null;
  private currentSceneId: string | null = null;

  // 完整游戏 storygraph (用于 scriptSource === 'storygraph' 模式)
  private fullGameGraph: FullGameStoryGraph | null = null;
  private fullGameGraphLoading: Promise<FullGameStoryGraph | null> | null = null;

  /**
   * 检查是否使用 storygraph 模式
   */
  isStoryGraphMode(): boolean {
    return config.scriptSource === 'storygraph';
  }

  /**
   * 加载完整游戏 storygraph (当 scriptSource === 'storygraph' 时)
   */
  async loadFullGameGraph(): Promise<FullGameStoryGraph | null> {
    if (this.fullGameGraph) {
      return this.fullGameGraph;
    }

    if (this.fullGameGraphLoading) {
      return this.fullGameGraphLoading;
    }

    // 根据配置选择加载哪种格式
    const url = config.storyGraphFormat === 'full'
      ? config.storyGraphFullPath
      : config.storyGraphPath;
    console.log(`[StoryGraph] Loading ${config.storyGraphFormat} storygraph from: ${url}`);

    this.fullGameGraphLoading = (async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          console.warn(`[StoryGraph] Failed to load full game storygraph from ${url}`);
          return null;
        }

        const graph = await response.json() as FullGameStoryGraph;
        this.fullGameGraph = graph;
        console.log(`[StoryGraph] Loaded full game storygraph:`, {
          version: graph.version,
          totalScenes: graph.totalScenes,
          totalDialogs: graph.totalDialogs,
          generatedAt: graph.generatedAt
        });

        return graph;
      } catch (e) {
        console.error(`[StoryGraph] Error loading full game storygraph:`, e);
        return null;
      } finally {
        this.fullGameGraphLoading = null;
      }
    })();

    return this.fullGameGraphLoading;
  }

  /**
   * 获取已加载的完整游戏 storygraph
   */
  getFullGameGraph(): FullGameStoryGraph | null {
    return this.fullGameGraph;
  }

  /**
   * 检查是否为完整格式
   */
  isFullFormat(): boolean {
    return this.fullGameGraph?.version === 2;
  }

  /**
   * 获取完整格式的场景数据
   */
  getFullGameScene(sceneId: number): FullGameScene | null {
    if (!this.fullGameGraph || this.fullGameGraph.version !== 2) return null;
    const key = `scene-${sceneId}`;
    return (this.fullGameGraph as FullStoryGraph).scenes[key] || null;
  }

  /**
   * 获取游戏场景对话数据 (兼容两种格式)
   */
  getGameSceneDialogs(sceneId: number): GameSceneDialogs | null {
    if (!this.fullGameGraph) return null;
    const key = `scene-${sceneId}`;

    if (this.fullGameGraph.version === 1) {
      return (this.fullGameGraph as DialogsOnlyStoryGraph).scenes[key] || null;
    }

    // 从完整格式转换为对话格式
    const fullScene = (this.fullGameGraph as FullStoryGraph).scenes[key];
    if (!fullScene) return null;

    return {
      sceneId: fullScene.sceneId,
      name: fullScene.name,
      mapNum: fullScene.mapNum,
      scriptOnEnter: fullScene.scriptOnEnter,
      dialogs: this.extractDialogsFromOperations(fullScene.enterOperations),
      eventDialogs: fullScene.events.map(event => ({
        eventId: event.eventId,
        spriteNum: event.spriteNum,
        position: event.position,
        triggerDialogs: this.extractDialogsFromOperations(event.triggerOperations),
        autoDialogs: this.extractDialogsFromOperations(event.autoOperations)
      })).filter(e => e.triggerDialogs.length > 0 || e.autoDialogs.length > 0)
    };
  }

  /**
   * 从操作列表中提取对话
   */
  private extractDialogsFromOperations(operations: ScriptOperation[]): DialogEntry[] {
    return operations
      .filter(op => op.opcode === 0xFFFF && op.text)
      .map(op => ({
        msgId: op.msgId!,
        speaker: op.speaker || null,
        text: op.text!,
        scriptId: op.scriptId
      }));
  }

  /**
   * 获取场景的所有脚本操作 (仅完整格式)
   */
  getSceneOperations(sceneId: number): ScriptOperation[] {
    const fullScene = this.getFullGameScene(sceneId);
    if (!fullScene) return [];
    return fullScene.enterOperations;
  }

  /**
   * 获取事件的所有脚本操作 (仅完整格式)
   */
  getEventOperations(sceneId: number, eventId: number): { trigger: ScriptOperation[], auto: ScriptOperation[] } | null {
    const fullScene = this.getFullGameScene(sceneId);
    if (!fullScene) return null;

    const event = fullScene.events.find(e => e.eventId === eventId);
    if (!event) return null;

    return {
      trigger: event.triggerOperations,
      auto: event.autoOperations
    };
  }

  /**
   * 获取事件对话 (按 eventId)
   */
  getEventDialogs(sceneId: number, eventId: number): GameEventDialog | null {
    const sceneDialogs = this.getGameSceneDialogs(sceneId);
    if (!sceneDialogs) return null;

    return sceneDialogs.eventDialogs.find(e => e.eventId === eventId) || null;
  }

  /**
   * 根据消息 ID 获取对话文本 (用于替代 ui.getMsg)
   */
  getMessageText(sceneId: number, msgId: number): string | null {
    if (!this.fullGameGraph) return null;

    // 完整格式直接搜索
    if (this.fullGameGraph.version === 2) {
      const fullGraph = this.fullGameGraph as FullStoryGraph;
      const key = `scene-${sceneId}`;
      const scene = fullGraph.scenes[key];
      if (!scene) return null;

      // 搜索入口操作
      for (const op of scene.enterOperations) {
        if (op.msgId === msgId && op.text) {
          return op.text;
        }
      }

      // 搜索事件操作
      for (const event of scene.events) {
        for (const op of event.triggerOperations) {
          if (op.msgId === msgId && op.text) {
            return op.text;
          }
        }
        for (const op of event.autoOperations) {
          if (op.msgId === msgId && op.text) {
            return op.text;
          }
        }
      }

      return null;
    }

    // 对话格式
    const sceneDialogs = this.getGameSceneDialogs(sceneId);
    if (!sceneDialogs) return null;

    // 在场景入口对话中查找
    for (const dialog of sceneDialogs.dialogs) {
      if (dialog.msgId === msgId) {
        return dialog.text;
      }
    }

    // 在事件对话中查找
    for (const event of sceneDialogs.eventDialogs) {
      for (const dialog of event.triggerDialogs) {
        if (dialog.msgId === msgId) {
          return dialog.text;
        }
      }
      for (const dialog of event.autoDialogs) {
        if (dialog.msgId === msgId) {
          return dialog.text;
        }
      }
    }

    return null;
  }

  /**
   * 获取操作码统计 (仅完整格式)
   */
  getOpcodeStats(): Record<string, number> | null {
    if (!this.fullGameGraph || this.fullGameGraph.version !== 2) return null;
    return (this.fullGameGraph as FullStoryGraph).opcodeStats;
  }

  /**
   * 加载剧情图 (Voxel 场景格式)
   */
  async loadGraph(name: string, url: string): Promise<StoryGraph | null> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`[StoryGraph] Failed to load ${name} from ${url}`);
        return null;
      }

      const graph = await response.json() as StoryGraph;
      this.graphs.set(name, graph);
      console.log(`[StoryGraph] Loaded ${name}:`, {
        scenes: Object.keys(graph.scenes).length,
        characters: Object.keys(graph.characters || {}).length
      });

      return graph;
    } catch (e) {
      console.error(`[StoryGraph] Error loading ${name}:`, e);
      return null;
    }
  }

  /**
   * 设置当前剧情图
   */
  setCurrentGraph(name: string): boolean {
    const graph = this.graphs.get(name);
    if (graph) {
      this.currentGraph = graph;
      this.currentSceneId = graph.initialScene;
      return true;
    }
    return false;
  }

  /**
   * 获取当前剧情图
   */
  getCurrentGraph(): StoryGraph | null {
    return this.currentGraph;
  }

  /**
   * 获取当前场景
   */
  getCurrentScene(): SceneDefinition | null {
    if (!this.currentGraph || !this.currentSceneId) return null;
    return this.currentGraph.scenes[this.currentSceneId] || null;
  }

  /**
   * 获取场景定义
   */
  getScene(sceneId: string): SceneDefinition | null {
    if (!this.currentGraph) return null;
    return this.currentGraph.scenes[sceneId] || null;
  }

  /**
   * 获取角色定义
   */
  getCharacter(charId: string): CharacterDefinition | null {
    if (!this.currentGraph) return null;
    return this.currentGraph.characters[charId] || null;
  }

  /**
   * 切换到指定场景
   */
  transitionToScene(sceneId: string): SceneDefinition | null {
    if (!this.currentGraph) return null;

    const scene = this.currentGraph.scenes[sceneId];
    if (scene) {
      this.currentSceneId = sceneId;
      return scene;
    }
    return null;
  }

  /**
   * 获取当前场景的对话序列
   */
  getDialogSequence(): DialogEntry[] {
    const scene = this.getCurrentScene();
    return scene?.dialogSequence || [];
  }

  /**
   * 检查场景出口触发
   */
  checkExitTrigger(position: { x: number; z: number }): SceneExit | null {
    const scene = this.getCurrentScene();
    if (!scene?.exits) return null;

    for (const exit of scene.exits) {
      if (exit.trigger === 'door') {
        const triggerPos = exit.position || { x: 0, z: 0.7 };
        const triggerRadius = exit.radius || 0.5;

        if (position.z > triggerPos.z &&
            Math.abs(position.x - triggerPos.x) < triggerRadius) {
          return exit;
        }
      }
    }
    return null;
  }

  /**
   * 从原版游戏数据生成 storygraph
   * 可以在运行时动态生成，也可以预先导出为 JSON
   */
  static generateFromGameData(
    gameData: any,
    sceneId: number,
    eventObjects: any[]
  ): Partial<StoryGraph> {
    const scenes: Record<string, SceneDefinition> = {};
    const characters: Record<string, CharacterDefinition> = {};

    // 从事件对象提取角色和脚本信息
    for (const event of eventObjects) {
      if (event.spriteNum > 0) {
        const charId = `event-${event.id || event.index}`;
        characters[charId] = {
          id: charId,
          name: `NPC ${event.spriteNum}`,
          spriteId: event.spriteNum
        };
      }
    }

    // 创建场景定义
    const sceneKey = `scene-${sceneId}`;
    scenes[sceneKey] = {
      id: sceneKey,
      name: gameData.sceneNames?.[sceneId] || `Scene ${sceneId}`,
      characters: Object.keys(characters)
    };

    return {
      scenes,
      characters,
      initialScene: sceneKey
    };
  }
}

// 单例导出
export const storyGraphService = new StoryGraphService();
export default storyGraphService;

// 浏览器全局访问
if (typeof window !== 'undefined') {
  (window as any).storyGraphService = storyGraphService;
}
