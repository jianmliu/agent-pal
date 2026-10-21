export type MudConfig = {
  rpcUrl: string;
  wsUrl: string;
  worldAddress: string;
  chainId?: number;
  privateKey?: string | null;
  [key: string]: any;
};

export function getMudConfig(): MudConfig {
  if (typeof window !== 'undefined') {
    const cfg = (window as any).PAL_CONFIG?.mud;
    if (cfg && cfg.rpcUrl && cfg.wsUrl && cfg.worldAddress) {
      return cfg as MudConfig;
    }
  }
  throw new Error('[mud-config] PAL_CONFIG.mud (rpcUrl/wsUrl/worldAddress) must be provided');
}
