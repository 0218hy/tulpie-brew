import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const ShopStatus = Object.freeze({
  CLOSED: 'closed',
  OPEN: 'open',
  PAUSED: 'paused',
});

const copy = (value) => structuredClone(value);
const legacyDefaultNames = {
  americano: ['Americano', '🤍☕ White Coffee'],
  latte: ['Latte', '🖤 ☕ Black Coffee'],
  cappuccino: ['Cappuccino', '🍫 Hot Chocolate'],
};

export function createInitialState(adminIds = []) {
  return {
    shopStatus: ShopStatus.CLOSED,
    helpText: 'Choose Order to browse the menu and join the coffee queue. Use My order to check your position.',
    menuMessage: 'Fresh coffee is ready. Choose your drink below.',
    menuImageFileId: null,
    cupsAvailable: 0,
    adminIds: [...new Set(adminIds.map(String))],
    users: {},
    menu: [
      { id: 'americano', name: '🤍☕ White Coffee', description: '', available: true },
      { id: 'latte', name: '🖤 ☕ Black Coffee', description: '', available: true },
      { id: 'cappuccino', name: '🍫 Hot Chocolate', description: '', available: true },
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
    this.state.helpText ??= this.initialState.helpText;
    this.state.menuMessage ??= this.initialState.menuMessage;
    this.state.menuImageFileId ??= null;
    this.state.cupsAvailable = nonNegativeInteger(this.state.cupsAvailable);
    this.state.menu ??= [];
    for (const item of this.state.menu) {
      item.description ??= '';
      const migration = legacyDefaultNames[item.id];
      if (migration && item.name === migration[0]) item.name = migration[1];
    }
    for (const user of Object.values(this.state.users)) user.openNotifications ??= false;
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

export function prepareStateForStartup(state, adminIds = []) {
  state.adminIds = [...new Set([...(state.adminIds ?? []), ...adminIds.map(String)])];
  return state;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}
