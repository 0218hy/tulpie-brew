import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { completeCurrentOrder, createOrder, markNotified, notificationTargets, setShopStatus } from '../src/queue.js';
import { createInitialState, JsonStore, ShopStatus } from '../src/state.js';

test('loads old notification flags without losing the next-to-current alert', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tulpie-state-'));
  try {
    const file = join(directory, 'state.json');
    const state = createInitialState(['999']);
    setShopStatus(state, ShopStatus.OPEN);
    for (const userId of ['1', '2', '3']) {
      const order = createOrder(state, { userId, name: userId, menuItemId: 'americano' });
      delete order.notifiedCurrent;
      delete order.notifiedNext;
      order.notified = userId !== '3';
    }
    await writeFile(file, JSON.stringify(state));

    const store = new JsonStore(file, createInitialState(['999']));
    await store.load();
    assert.deepEqual(
      notificationTargets(store.get()).map(({ order, position }) => `${order.userId}:${position}`),
      ['1:1'],
    );

    await store.update((draft) => markNotified(draft, '1', 1));
    await store.update((draft) => completeCurrentOrder(draft, { userId: '1' }));
    assert.deepEqual(
      notificationTargets(store.get()).map(({ order, position }) => `${order.userId}:${position}`),
      ['2:1', '3:2'],
    );
    assert.ok(JSON.parse(await readFile(file, 'utf8')).orders.every((order) => !('notified' in order)));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('keeps in-memory state unchanged when saving fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tulpie-state-'));
  try {
    const file = join(directory, 'state.json');
    const store = new JsonStore(file, createInitialState(['999']));
    await store.load();

    const temporaryPath = `${file}.tmp`;
    await mkdir(temporaryPath);
    await assert.rejects(
      store.update((draft) => { draft.shopStatus = ShopStatus.OPEN; }),
      { code: 'EISDIR' },
    );
    assert.equal(store.get().shopStatus, ShopStatus.CLOSED);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).shopStatus, ShopStatus.CLOSED);

    await rm(temporaryPath, { recursive: true });
    await store.update((draft) => { draft.shopStatus = ShopStatus.OPEN; });
    assert.equal(store.get().shopStatus, ShopStatus.OPEN);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).shopStatus, ShopStatus.OPEN);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
