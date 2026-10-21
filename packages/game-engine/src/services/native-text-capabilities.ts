import type {NativeTextRuntimeBinding} from '../js/pal/text';
export interface NativeTextCapability {readonly ui:object;readonly generation:number;readonly read:()=>NativeTextRuntimeBinding}
const capabilities=new WeakMap<object,NativeTextCapability>();
/** Called only by actual text.init; no public registration accepts arbitrary callbacks. */
export function registerNativeTextCapability(ui:object,generation:number,read:()=>NativeTextRuntimeBinding):void {
  capabilities.set(ui,Object.freeze({ui,generation,read}));
}
export function nativeTextCapability(ui:object):NativeTextCapability|null {return capabilities.get(ui)??null;}
