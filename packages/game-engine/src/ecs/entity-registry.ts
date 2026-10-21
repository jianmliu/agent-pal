const DEFAULT_COMPONENT_FACTORY = () => new Map<number, any>();

export class EntityRegistry {
  private _nextEntityId: number;
  private _entities: Set<number>;
  private _componentStores: Map<string, Map<number, any>>;
  private _tags: Map<string, Set<number>>;
  private _entityTags: Map<number, Set<string>>;
  private _createComponentStore: (name: string) => Map<number, any>;

  constructor(options: { createComponentStore?: (name: string) => Map<number, any> } = {}) {
    this._nextEntityId = 1;
    this._entities = new Set();
    this._componentStores = new Map();
    this._tags = new Map();
    this._entityTags = new Map();
    this._createComponentStore = options.createComponentStore || DEFAULT_COMPONENT_FACTORY;
  }

  createEntity(metadata?: { tags?: string | string[] }): number {
    const entityId = this._nextEntityId++;
    this._entities.add(entityId);
    if (metadata && metadata.tags) {
      const tags = Array.isArray(metadata.tags) ? metadata.tags : [metadata.tags];
      tags.forEach((tag) => this.tagEntity(entityId, tag));
    }
    return entityId;
  }

  destroyEntity(entityId: number): boolean {
    if (!this._entities.has(entityId)) {
      return false;
    }
    this._entities.delete(entityId);
    this._componentStores.forEach((store) => store.delete(entityId));
    const entityTagSet = this._entityTags.get(entityId);
    if (entityTagSet) {
      entityTagSet.forEach((tag) => {
        const tagged = this._tags.get(tag);
        if (tagged) {
          tagged.delete(entityId);
          if (tagged.size === 0) {
            this._tags.delete(tag);
          }
        }
      });
      this._entityTags.delete(entityId);
    }
    return true;
  }

  clear() {
    this._entities.clear();
    this._componentStores.clear();
    this._tags.clear();
    this._entityTags.clear();
    this._nextEntityId = 1;
  }

  hasEntity(entityId: number): boolean {
    return this._entities.has(entityId);
  }

  tagEntity(entityId: number, tag: string) {
    if (!this._entities.has(entityId) || !tag) {
      return;
    }
    let tagged = this._tags.get(tag);
    if (!tagged) {
      tagged = new Set();
      this._tags.set(tag, tagged);
    }
    tagged.add(entityId);

    let entityTags = this._entityTags.get(entityId);
    if (!entityTags) {
      entityTags = new Set();
      this._entityTags.set(entityId, entityTags);
    }
    entityTags.add(tag);
  }

  getEntitiesByTag(tag: string): number[] {
    const tagged = this._tags.get(tag);
    if (!tagged) {
      return [];
    }
    return Array.from(tagged);
  }

  _getStore(componentName: string): Map<number, any> {
    if (!componentName) {
      throw new Error('componentName is required');
    }
    let store = this._componentStores.get(componentName);
    if (!store) {
      store = this._createComponentStore(componentName);
      this._componentStores.set(componentName, store);
    }
    return store;
  }

  addComponent(entityId: number, componentName: string, data: any) {
    if (!this._entities.has(entityId)) {
      throw new Error(`Entity ${entityId} does not exist`);
    }
    const store = this._getStore(componentName);
    store.set(entityId, data);
  }

  removeComponent(entityId: number, componentName: string) {
    const store = this._componentStores.get(componentName);
    if (store) {
      store.delete(entityId);
    }
  }

  getComponent(entityId: number, componentName: string): any {
    const store = this._componentStores.get(componentName);
    return store ? store.get(entityId) : undefined;
  }

  hasComponent(entityId: number, componentName: string): boolean {
    const store = this._componentStores.get(componentName);
    return store ? store.has(entityId) : false;
  }

  getComponents(entityId: number): Record<string, any> {
    const components: Record<string, any> = {};
    this._componentStores.forEach((store, name) => {
      if (store.has(entityId)) {
        components[name] = store.get(entityId);
      }
    });
    return components;
  }

  iterateEntitiesWith(componentNames: string | string[]): number[] {
    const names = Array.isArray(componentNames) ? componentNames : [componentNames];
    if (names.length === 0) {
      return [];
    }
    const primaryStore = this._componentStores.get(names[0]);
    if (!primaryStore) {
      return [];
    }
    const result: number[] = [];
    primaryStore.forEach((_, entityId) => {
      if (!this._entities.has(entityId)) {
        return;
      }
      for (let i = 1; i < names.length; i++) {
        const store = this._componentStores.get(names[i]);
        if (!store || !store.has(entityId)) {
          return;
        }
      }
      result.push(entityId);
    });
    return result;
  }
}

export default function createEntityRegistry(options?: any) {
  return new EntityRegistry(options);
}
