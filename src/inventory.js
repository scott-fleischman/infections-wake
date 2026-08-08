import { ITEMS, BLOCKS, RECIPES, B } from './config.js';

// Unified item id space: item keys (e.g. "stone_pick") and blocks as "b:<id>".
// This lets the hotbar/inventory hold both materials/tools and placeable blocks.

export function itemDef(id) {
  if (id == null) return null;
  if (typeof id === 'string' && id.startsWith('b:')) {
    const bid = Number(id.slice(2));
    const bd = BLOCKS[bid];
    return { name: bd.name, color: colorOf(bd), stack: 99, block: bid, def: bd, tool: null };
  }
  const it = ITEMS[id];
  if (!it) return null;
  return { ...it, key: id };
}

function colorOf(bd) {
  const c = Array.isArray(bd.col) ? bd.col[0] : bd.col;
  return c ?? 0x888888;
}

export class Inventory {
  constructor(game, size = 30) {
    this.game = game;
    this.size = size;
    this.slots = new Array(size).fill(null); // {id, n}
    this.selected = 0;
    this.hotbarCount = 6;
  }

  selectedSlot() { return this.slots[this.selected]; }
  selectedItem() {
    const s = this.slots[this.selected];
    if (!s) return null;
    const def = itemDef(s.id);
    return def ? { id: s.id, n: s.n, def } : null;
  }

  count(id) {
    let c = 0;
    for (const s of this.slots) if (s && s.id === id) c += s.n;
    return c;
  }

  stackMax(id) { const d = itemDef(id); return d ? (d.stack || 99) : 99; }

  add(id, n = 1) {
    const max = this.stackMax(id);
    // fill existing stacks
    for (const s of this.slots) {
      if (s && s.id === id && s.n < max) {
        const put = Math.min(n, max - s.n); s.n += put; n -= put;
        if (n <= 0) return 0;
      }
    }
    // new stacks
    for (let i = 0; i < this.size; i++) {
      if (!this.slots[i]) {
        const put = Math.min(n, max);
        this.slots[i] = { id, n: put }; n -= put;
        if (n <= 0) return 0;
      }
    }
    return n; // overflow that didn't fit
  }

  remove(id, n = 1) {
    for (let i = 0; i < this.size; i++) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const take = Math.min(n, s.n); s.n -= take; n -= take;
        if (s.n <= 0) this.slots[i] = null;
        if (n <= 0) return true;
      }
    }
    return n <= 0;
  }

  has(cost) { return Object.entries(cost).every(([id, n]) => this.count(id) >= n); }

  // Click-move (wishlist #7): move a whole slot record between two slots —
  // merge same-id stacks (up to stackMax, remainder stays), otherwise swap.
  // Records move intact so tool durability (`dur`) is never touched.
  moveSlot(from, to) {
    if (from === to || from < 0 || to < 0 || from >= this.size || to >= this.size) return;
    const a = this.slots[from], b = this.slots[to];
    if (!a) return;
    if (!b) { this.slots[to] = a; this.slots[from] = null; return; }
    if (b.id === a.id && a.dur == null && b.dur == null) {
      const put = Math.min(a.n, this.stackMax(a.id) - b.n);
      if (put > 0) {
        b.n += put; a.n -= put;
        if (a.n <= 0) this.slots[from] = null;
        return;
      }
    }
    this.slots[from] = b;
    this.slots[to] = a;
  }

  // Consume durability from selected tool; returns true if it broke.
  useToolDurability(amount = 1) {
    const s = this.slots[this.selected];
    if (!s) return false;
    const def = itemDef(s.id);
    if (!def || !def.tool || def.dur == null) return false;
    s.dur = (s.dur ?? def.dur) - amount;
    if (s.dur <= 0) {
      this.slots[this.selected] = null;
      this.game.toast(`${def.name} broke.`, 'important');
      return true;
    }
    return false;
  }

  // Armor is passive while carried (§11.1 combat branch): absorb a fraction of
  // a hit and take durability wear. Returns the absorb fraction or 0.
  wearArmor(amount) {
    for (let i = 0; i < this.size; i++) {
      const s = this.slots[i];
      if (!s) continue;
      const def = itemDef(s.id);
      if (!def || !def.armor) continue;
      s.dur = (s.dur ?? def.dur) - amount;
      if (s.dur <= 0) {
        this.slots[i] = null;
        this.game.toast(`${def.name} gave out.`, 'important');
      }
      return def.armor;
    }
    return 0;
  }

  craft(recipe) {
    if (!this.has(recipe.cost)) return false;
    if (recipe.tierUnlock && !this.game.tiers.has(recipe.tierUnlock)) return false;
    if (recipe.needsUnlock && !this.game.unlocks[recipe.needsUnlock]) return false;
    for (const [id, n] of Object.entries(recipe.cost)) this.remove(id, n);
    for (const [id, n] of Object.entries(recipe.out)) {
      const overflow = this.add(id, n);
      if (overflow > 0) this.game.dropItemAt(this.game.player.pos, id, overflow);
    }
    return true;
  }

  availableRecipes(station) {
    return RECIPES.filter(r => (r.station || null) === (station || null));
  }

  serialize() {
    return { slots: this.slots, selected: this.selected };
  }
  load(data) {
    this.slots = data.slots || this.slots;
    this.selected = data.selected || 0;
    while (this.slots.length < this.size) this.slots.push(null);
  }
}
