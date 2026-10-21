import inputService, { Key, Direction } from '../../services/input-service.js';

// Bridge for legacy code
const input = inputService;

// Ensure global access if needed (legacy pattern)
const root: any = (typeof global !== 'undefined' && (global as any)) ||
  (typeof window !== 'undefined' && window) ||
  (typeof self !== 'undefined' && self) ||
  {};

root.input = input;
root.Key = Key;
root.Direction = Direction;

export { Key, Direction };
export default input;
