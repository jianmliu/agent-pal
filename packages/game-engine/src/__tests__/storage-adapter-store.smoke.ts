/**
 * Headless smoke test for P0 ④ persistence — proves relationship memory survives
 * a "game restart". No Capacitor/localStorage: a Map-backed KvBackend stands in
 * for durable storage; reopening = a fresh StorageAdapterStore over the SAME map.
 *
 * Run: pnpm --filter @onchainpal/game-engine test:store
 */
import assert from 'node:assert/strict';
import { RelationshipMemory } from '@aigg/npc-agent';
import { StorageAdapterStore, type KvBackend } from '../ai/storage-adapter-store';

// A Map-backed durable backend shared across "restarts".
function makeBackend(): { backend: KvBackend; map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    backend: {
      async getItem(k) {
        return map.has(k) ? (map.get(k) as string) : null;
      },
      async setItem(k, v) {
        map.set(k, v);
      },
      async removeItem(k) {
        map.delete(k);
      }
    }
  };
}

const NPC = 'npc:jiu-jianxian';
const PLAYER = 'player:hero';

async function test1_persistsAcrossRestart() {
  const { backend, map } = makeBackend();

  // --- session 1: drink with 酒剑仙 a few times ---
  const store1 = new StorageAdapterStore({ backend });
  const rel1 = new RelationshipMemory(store1);
  await rel1.applyDelta(NPC, PLAYER, 15, ['drinking-buddy'], 100);
  await rel1.applyDelta(NPC, PLAYER, 10, [], 200);
  const after1 = await rel1.get(NPC, PLAYER);
  assert.equal(after1.affinity, 25, 'affinity accumulated in session 1');

  // data actually landed in the durable backend (not just RAM)
  assert.ok([...map.keys()].some((k) => k.includes(NPC) && k.includes(PLAYER)), 'wrote a scoped key to backend');

  // --- session 2: fresh store over the SAME backend = reopen the game ---
  const store2 = new StorageAdapterStore({ backend });
  const rel2 = new RelationshipMemory(store2);
  const reopened = await rel2.get(NPC, PLAYER);
  assert.equal(reopened.affinity, 25, 'affinity survived restart');
  assert.deepEqual(reopened.tags, ['drinking-buddy'], 'tags survived restart');
  assert.equal(reopened.lastInteractionAt, 200, 'lastInteractionAt survived restart');
  console.log('✓ test1 relationship survives a fresh store over the same backend (restart)');
}

async function test2_scopesAndJsonRoundTrip() {
  const { backend } = makeBackend();
  const store = new StorageAdapterStore({ backend });
  await store.set({ type: 'world' }, 'met_jianxian', 1, { onchain: true });
  await store.set({ type: 'player', playerId: PLAYER }, 'profile', { name: '李逍遥', level: 3 });
  await store.set({ type: 'npc-player', npcId: NPC, playerId: PLAYER }, 'note', { text: '请过酒' });

  assert.equal(await store.get({ type: 'world' }, 'met_jianxian'), 1, 'world scalar round-trips');
  assert.deepEqual(await store.get({ type: 'player', playerId: PLAYER }, 'profile'), { name: '李逍遥', level: 3 }, 'player object round-trips');
  assert.deepEqual(await store.get({ type: 'npc-player', npcId: NPC, playerId: PLAYER }, 'note'), { text: '请过酒' }, 'npc-player object round-trips');
  assert.equal(await store.get({ type: 'world' }, 'missing'), null, 'missing key → null');
  console.log('✓ test2 all three scopes + JSON round-trip + null on miss');
}

async function test3_deleteAndOnchainTag() {
  const { backend } = makeBackend();
  const store = new StorageAdapterStore({ backend });
  await store.set({ type: 'world' }, 'temp', 1, { onchain: true });
  assert.equal(store.onchainKeys.size, 1, 'onchain-tagged write recorded for future sync');
  await store.delete({ type: 'world' }, 'temp');
  assert.equal(await store.get({ type: 'world' }, 'temp'), null, 'deleted key reads null');
  console.log('✓ test3 delete works; onchain tag recorded');
}

async function main() {
  await test1_persistsAcrossRestart();
  await test2_scopesAndJsonRoundTrip();
  await test3_deleteAndOnchainTag();
  console.log('\nALL STORAGE-ADAPTER-STORE SMOKE TESTS PASSED ✅');
}

main().catch((err) => {
  console.error('STORE SMOKE TEST FAILED ❌', err);
  process.exit(1);
});
