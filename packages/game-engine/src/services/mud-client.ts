import { Subject } from 'rxjs';
import worldAbi from '../mud/worldAbi.js';
import { writeMudRecord, removeMudRecord } from '../state/ecs-context.js';
import type { MudConfig } from './mud-config.js';

type MudDeps = {
  createStoreSync: any;
  logToRecord?: any;
  logToTable?: any;
  isTableRegistrationLog?: any;
  mudTables?: any;
  createPublicClient: any;
  createWalletClient: any;
  privateKeyToAccount: any;
  custom?: any;
  http: any;
  webSocket?: any;
};

export type MudClient = {
  components: unknown;
  onSync: (callback: (message: unknown) => void) => () => void;
  stop: () => void;
  connectWallet: (opts?: Partial<MudConfig>) => Promise<unknown>;
  writeSystem: ((functionName: string, args: unknown[]) => Promise<unknown>) | null;
};

let mudDepsPromise: Promise<MudDeps> | null = null;

function loadMudDependencies(): Promise<MudDeps> {
  if (!mudDepsPromise) {
    mudDepsPromise = new Promise((resolve, reject) => {
      const req = (globalThis as any).require;
      const context = req && (req as any).s && (req as any).s.contexts ? (req as any).s.contexts._ : null;
      const hasStoreSync = !!(context && context.config && context.config.paths && context.config.paths['@latticexyz/store-sync']);
      if (!hasStoreSync) {
        reject(new Error('[mud-client] Browser bundle for @latticexyz/store-sync/viem is not available yet.'));
        return;
      }
      req(
        ['@latticexyz/store-sync', 'viem'],
        (storeSync: any, viem: any) => {
          if (!storeSync || !viem) {
            reject(new Error('Failed to load mud dependencies'));
            return;
          }
          resolve({
            createStoreSync: storeSync.createStoreSync,
            logToRecord: storeSync.logToRecord,
            logToTable: storeSync.logToTable,
            isTableRegistrationLog: storeSync.isTableRegistrationLog,
            mudTables: storeSync.mudTables,
            createPublicClient: viem.createPublicClient,
            createWalletClient: viem.createWalletClient,
            privateKeyToAccount: viem.privateKeyToAccount,
            custom: viem.custom,
            http: viem.http,
            webSocket: viem.webSocket
          });
        },
        reject
      );
    });
  }
  return mudDepsPromise;
}

export async function createMudClient(config: MudConfig): Promise<MudClient> {
  const { rpcUrl, wsUrl, worldAddress, chainId = 31337, privateKey } = config || ({} as MudConfig);
  if (!rpcUrl || !wsUrl || !worldAddress) {
    throw new Error('[mud-client] Missing rpcUrl/wsUrl/worldAddress');
  }

  const {
    createStoreSync,
    logToRecord,
    logToTable,
    isTableRegistrationLog,
    mudTables,
    createPublicClient,
    createWalletClient,
    privateKeyToAccount,
    custom,
    http
  } = await loadMudDependencies();

  const wrapInjectedTransport = (provider: any) => {
    if (!provider) {
      return null;
    }
    if (typeof custom === 'function') {
      return custom(provider);
    }
    return ({ retryDelay = 150, timeout }: { retryDelay?: number; timeout?: number } = {}) => ({
      key: 'injected-provider',
      name: 'Injected Provider',
      type: 'custom',
      retryDelay,
      timeout,
      request: (args: any) => provider.request(args)
    });
  };

  const chain = {
    id: chainId,
    name: 'mud',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } }
  };

  const transport = http(rpcUrl);

  const publicClient = createPublicClient({
    chain,
    transport
  });

  let walletClient: any = null;
  let walletAccount: any = null;

  if (privateKey) {
    walletAccount = privateKeyToAccount(privateKey);
    walletClient = createWalletClient({
      account: walletAccount,
      chain,
      transport
    });
  }

  const tableRegistry = new Map<string, any>();
  if (mudTables) {
    Object.values(mudTables).forEach((table: any) => {
      if (table && table.tableId) {
        tableRegistry.set(table.tableId, table);
      }
    });
  }

  const subject = new Subject<any>();
  const storageAdapter = async (block: any) => {
    const logs = Array.isArray(block?.logs) ? block.logs : [];
    for (const log of logs) {
      if (isTableRegistrationLog && isTableRegistrationLog(log)) {
        const table = logToTable ? logToTable(log) : null;
        if (table && table.tableId) {
          tableRegistry.set(table.tableId, table);
          subject.next({
            type: 'tableRegistration',
            table,
            blockNumber: block.blockNumber
          });
        }
        continue;
      }
      const table = tableRegistry.get((log as any)?.args?.tableId);
      if (!table) {
        subject.next({ type: 'unknownTable', log });
        continue;
      }
      const keyTuple = Array.isArray((log as any)?.args?.keyTuple) ? (log as any).args.keyTuple : [];
      if ((log as any).eventName === 'Store_DeleteRecord') {
        removeMudRecord(table.tableId, keyTuple);
        subject.next({
          type: 'delete',
          table,
          keyTuple,
          blockNumber: block.blockNumber
        });
        continue;
      }
      if (typeof logToRecord === 'function') {
        try {
          const record = logToRecord({ table, log });
          writeMudRecord({
            tableId: table.tableId,
            tableName: `${table.namespace || ''}/${table.name || ''}`,
            keyTuple,
            record
          });
          subject.next({
            type: 'record',
            table,
            keyTuple,
            record,
            blockNumber: block.blockNumber
          });
        } catch (err) {
          subject.next({ type: 'decodeError', error: err, log, table });
        }
      }
    }
  };

  const syncClient = await createStoreSync({
    address: worldAddress,
    publicClient,
    storageAdapter,
    startBlock: 0n
  });

  const subscription = syncClient.storedBlockLogs$.subscribe(() => {});

  const onSync = (callback: (message: unknown) => void) => {
    if (typeof callback !== 'function') {
      return () => {};
    }
    const sub = subject.subscribe(callback as any);
    return () => sub.unsubscribe();
  };

  const writeSystem = walletClient && walletAccount
    ? (functionName: string, args: unknown[]) =>
        walletClient.writeContract({
          address: worldAddress,
          abi: worldAbi,
          functionName,
          args,
          account: walletAccount
        })
    : null;

  return {
    components: null,
    onSync,
    stop: () => {
      subscription.unsubscribe();
    },
    connectWallet: async (opts: Partial<MudConfig> = {}) => {
      if (opts.privateKey) {
        walletAccount = privateKeyToAccount(opts.privateKey);
        walletClient = createWalletClient({
          account: walletAccount,
          chain,
          transport
        });
        return walletAccount;
      }
      if (typeof window === 'undefined' || !(window as any).ethereum) {
        throw new Error('No injected wallet available');
      }
      const injectedTransport = wrapInjectedTransport((window as any).ethereum);
      const injectedClient = createWalletClient({
        chain,
        transport: injectedTransport
      });
      const addresses = await injectedClient.requestAddresses();
      if (!Array.isArray(addresses) || addresses.length === 0) {
        throw new Error('No accounts returned');
      }
      walletAccount = addresses[0];
      walletClient = injectedClient;
      return walletAccount;
    },
    writeSystem
  };
}
