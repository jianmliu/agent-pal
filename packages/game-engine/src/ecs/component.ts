/**
 * 类型化组件定义。EntityRegistry 本身按名字存任意值;这里给名字配上类型、默认值和校验,
 * 让 WorldWriter / 读取方按定义而不是按字符串打交道(docs/specs/agent-pal.md §6.1、agent-pal-waits.md W1)。
 */
export interface ComponentDef<T> {
  readonly name: string;
  /** 新建一份默认值(每次调用返回新对象) */
  create(): T;
  /** 写入前校验;不合法就抛错。缺省不校验 */
  validate?(value: unknown): void;
}

export function defineComponent<T>(
  name: string,
  options: { create: () => T; validate?: (value: unknown) => void }
): ComponentDef<T> {
  if (!name) {
    throw new Error('defineComponent: name is required');
  }
  const def: ComponentDef<T> = {
    name,
    create: options.create,
    validate: options.validate
  };
  return Object.freeze(def);
}
