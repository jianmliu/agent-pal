/**
 * PAL wire protocol codec — JSON-per-frame parse/serialize with hand-written
 * guards (no runtime schema dep). Parsers return null on anything malformed;
 * callers answer with error{code:'bad-msg'} or drop the frame.
 */
import { type ClientMsg, type ServerMsg } from './messages.js';
export declare function serialize(msg: ClientMsg | ServerMsg): string;
export declare function parseClientMsg(raw: string): ClientMsg | null;
export declare function parseServerMsg(raw: string): ServerMsg | null;
