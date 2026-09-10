import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const ShopStatus = Object.freeze({
  CLOSED: 'closed',
  OPEN: 'open',
  PAUSED: 'paused',
});

const copy = (value) => structuredClone(value);

export function createInitialState(adminIds = []) {
  return {
    shopStatus: ShopStatus.CLOSED,
    adminIds: [...new Set(adminIds.map(String))],
    users: {},
    menu: [
      { id: 'americano', name: 'Americano', available: true },
      { id: 'latte', name: 'Latte', available: true },
      { id: 'cappuccino', name: 'Cappuccino', available: true },
    ],
    orders: [],
    nextOrderId: 1,
  };
}

export class JsonStore {
  constructor(filePath, initialState) {
    this.filePath = filePath;
    this.initialState = initialState;
    this.state = null;
  }

  async load() {
    try {
      this.state = JSON.parse(await readFile(this.filePath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.state = copy(this.initialState);
      await this.save();
    }
    this.state.users ??= {};
    return this.get();
  }

  get() {
    if (!this.state) throw new Error('Store has not been loaded.');
    return copy(this.state);
  }

  async update(mutator) {
    if (!this.state) throw new Error('Store has not been loaded.');
    const draft = copy(this.state);
    const result = await mutator(draft);
    this.state = draft;
    await this.save();
    return result;
  }

  async save() {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(this.state, null, 2));
    await rename(temporaryPath, this.filePath);
  }
}
