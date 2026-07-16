import { itemDef } from './inventory.js';
import { BESTIARY } from './lore.js';
import { STRAINS, RECIPES, SANITY, TIME } from './config.js';
import { el, row, gauge, line, clear } from './dom.js';

const $ = (id) => document.getElementById(id);

// All DOM presentation. Sanity misinformation shows up here (presentation
// layer) — the simulation state underneath is never altered (§23.1).

export class HUD {
  constructor(game) {
    this.game = game;
    this.screens = ['inv-screen', 'log-screen', 'catalog-card', 'machine-screen', 'pause-screen', 'death-screen', 'fail-screen', 'menu-screen'];
    this.activeScreen = 'menu-screen';
    this.machineOpen = null;
    this.buildHelp();
    this.bindTabs();
  }

  buildHelp() {
    const fill = (node) => {
      clear(node);
      line(node, [['WASD', true], [' move · ', false], ['Mouse', true], [' look · ', false], ['Space', true], [' jump · ', false], ['Shift', true], [' sprint', false]]);
      line(node, [['LMB', true], [' mine / attack · ', false], ['RMB', true], [' place block', false]]);
      line(node, [['1–6', true], [' hotbar · ', false], ['E', true], [' field kit & crafting', false]]);
      line(node, [['F', true], [' interact (doors, machines, archives, beds)', false]]);
      line(node, [['J', true], [' story log · ', false], ['Esc', true], [' pause', false]]);
      node.appendChild(el('div', null, ' '));
      line(node, [['Fires, lights, and machines keep you alive — and make you visible.', false]]);
      line(node, [['The infection is blind. It is not deaf.', false]]);
    };
    fill($('menu-help'));
    fill($('controls-help'));
  }

  bindTabs() {
    document.querySelectorAll('#log-tabs .tab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#log-tabs .tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        $('log-entries').classList.toggle('hidden', btn.dataset.tab !== 'entries');
        $('log-bestiary').classList.toggle('hidden', btn.dataset.tab !== 'bestiary');
      });
    });
  }

  // ---------- screens ----------
  show(id) {
    for (const s of this.screens) $(s).classList.toggle('hidden', s !== id);
    this.activeScreen = id;
    if (id) document.exitPointerLock?.();
  }
  closeAll() {
    for (const s of this.screens) $(s).classList.add('hidden');
    this.activeScreen = null;
    this.machineOpen = null;
  }
  isScreenOpen() { return this.activeScreen != null; }

  setHudVisible(v) { $('hud').classList.toggle('hidden', !v); }

  // ---------- toasts / prompt ----------
  toast(msg, cls = '') {
    const t = el('div', 'toast ' + cls, msg);
    $('toasts').appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.6s'; }, 3600);
    setTimeout(() => t.remove(), 4300);
    while ($('toasts').children.length > 5) $('toasts').firstChild.remove();
  }

  prompt(text) {
    if (!text) { $('prompt').classList.add('hidden'); return; }
    $('prompt').textContent = text;
    $('prompt').classList.remove('hidden');
  }

  // ---------- bars / clock ----------
  updateBars() {
    const g = this.game;
    $('bar-health').style.width = `${Math.max(0, g.player.health)}%`;
    $('bar-sanity').style.width = `${g.sanity.value}%`;
    $('bar-hunger').style.width = `${g.player.hunger}%`;
    $('vignette').style.opacity = g.player.health < 35 ? String(0.4 + (35 - g.player.health) / 60) : (g.player.hurtCooldown > 0.2 ? '0.5' : '0');
  }

  updateClock() {
    const g = this.game;
    $('day-label').textContent = `Day ${g.day}`;
    const frac = g.dayFrac;
    const mins = Math.floor(frac * 24 * 60);
    const hh = String(Math.floor(mins / 60)).padStart(2, '0');
    const mm = String(mins % 60).padStart(2, '0');
    $('time-label').textContent = `${hh}:${mm}`;
    const phase = $('phase-label');
    if (frac >= TIME.NIGHT || frac < TIME.DAWN) { phase.textContent = 'NIGHT'; phase.className = 'phase-night'; }
    else if (frac >= TIME.DUSK) { phase.textContent = 'DUSK — PREPARE'; phase.className = 'phase-dusk'; }
    else { phase.textContent = 'DAYLIGHT'; phase.className = 'phase-day'; }
  }

  // ---------- threat panel ----------
  updateThreat() {
    const g = this.game;
    const f = g.director.forecast;
    if (!f) {
      $('threat-level').textContent = g.day === 1 ? 'unknown' : 'building…';
      $('assault-eta').textContent = '—';
      $('forecast-conf').textContent = '—';
      $('dom-sig').textContent = '—';
      $('strain-ind').textContent = '—';
      return;
    }
    $('threat-level').textContent = g.director.levelName();
    const etaFrac = f.assaultFrac - g.dayFrac;
    const etaSec = etaFrac > 0 ? etaFrac * TIME.DAY_LENGTH : 0;
    // ETA display degraded by low sanity (presentation only, §20.4)
    const jitter = (1 - f.confidence) * 60;
    const shown = Math.max(0, etaSec + (g.sanity.value < SANITY.thresholds.unstable ? (Math.random() * 2 - 1) * jitter : 0));
    $('assault-eta').textContent = g.director.assaultActive ? 'NOW' : etaFrac > 0 ? `~${Math.ceil(shown / 10) * 10}s` : 'passed';
    $('forecast-conf').textContent = `${Math.round(f.confidence * 100)}%`;
    $('dom-sig').textContent = f.dominant || 'none';
    $('strain-ind').textContent = f.strains.map(s => STRAINS[s].name).join(', ');
  }

  flashIncursion() {
    $('incursion-alert').classList.remove('hidden');
    clearTimeout(this._incT);
    this._incT = setTimeout(() => $('incursion-alert').classList.add('hidden'), 8000);
  }

  showAssaultBanner(v) { $('assault-banner').classList.toggle('hidden', !v); }
  updateAssaultRemaining(n) { $('assault-remaining').textContent = `Hostiles remaining: ${n}`; }

  // ---------- signature panel (unlocked by archives, §20.3) ----------
  updateSigPanel() {
    const g = this.game;
    if (!g.unlocks.sigPanel) { $('sig-panel').classList.add('hidden'); return; }
    $('sig-panel').classList.remove('hidden');
    if (g.unlocks.sigAll) document.querySelectorAll('.sig-adv').forEach(e2 => e2.classList.remove('hidden'));
    const t = g.sig.sampleTotals(g.player.pos.x, g.player.pos.y + 1, g.player.pos.z, true);
    const set = (ch) => { const e2 = $('sig-' + ch); if (e2) e2.style.width = `${Math.min(100, t[ch] * 55)}%`; };
    ['heat', 'light', 'vibration', 'co2', 'blood', 'electrical'].forEach(set);
  }

  // ---------- score ----------
  updateScore() {
    $('score').textContent = String(this.game.score);
    $('valley-recovery').textContent = `${this.game.valleyRecovery}%`;
  }

  updateRecovery() {
    const s = this.game.recovery.statusLine();
    const e2 = $('recovery-status');
    e2.textContent = s.text;
    e2.className = s.cls;
  }

  powerWarning(text) {
    const e2 = $('power-warning');
    if (!text) { e2.classList.add('hidden'); return; }
    e2.textContent = text;
    e2.classList.remove('hidden');
  }

  // ---------- sanity fx ----------
  updateSanityFx() {
    const g = this.game;
    const v = g.sanity.value;
    const fx = $('sanity-fx');
    let op = 0;
    if (v < SANITY.thresholds.stable) op = 0.12;        // unstable band
    if (v < SANITY.thresholds.unstable) op = 0.38;      // hallucinating band
    if (v < SANITY.thresholds.hallucinating) op = 0.6;  // collapse
    fx.style.opacity = String(op);
    fx.classList.toggle('jitter', v < SANITY.thresholds.unstable);
  }

  // ---------- hotbar / inventory ----------
  iconFor(id) {
    const def = itemDef(id);
    const c = document.createElement('canvas');
    c.width = c.height = 26;
    c.className = 'icon';
    const ctx = c.getContext('2d');
    const col = '#' + (def?.color ?? 0x888888).toString(16).padStart(6, '0');
    ctx.fillStyle = col;
    if (def?.tool === 'pick') { ctx.fillRect(4, 4, 18, 5); ctx.fillRect(11, 4, 4, 18); }
    else if (def?.tool === 'axe') { ctx.fillRect(4, 4, 12, 10); ctx.fillRect(11, 6, 4, 16); }
    else if (def?.tool === 'shovel') { ctx.fillRect(9, 3, 8, 9); ctx.fillRect(11, 3, 4, 19); }
    else if (def?.tool === 'sword') { ctx.fillRect(11, 2, 4, 16); ctx.fillRect(7, 16, 12, 4); }
    else if (def?.block != null) { ctx.fillRect(3, 3, 20, 20); ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(3, 3, 20, 6); }
    else { ctx.beginPath(); ctx.arc(13, 13, 8, 0, Math.PI * 2); ctx.fill(); }
    return c;
  }

  slotEl(s, selected) {
    const slot = el('div', 'slot' + (selected ? ' selected' : ''));
    if (s) {
      const def = itemDef(s.id);
      slot.appendChild(this.iconFor(s.id));
      if (s.n > 1) slot.appendChild(el('span', 'count', String(s.n)));
      slot.title = (def?.name || '') + (def?.desc ? ` — ${def.desc}` : '');
    }
    return slot;
  }

  updateHotbar() {
    const inv = this.game.inv;
    const bar = $('hotbar');
    clear(bar);
    for (let i = 0; i < inv.hotbarCount; i++) {
      const slot = this.slotEl(inv.slots[i], i === inv.selected);
      slot.insertBefore(el('span', 'key', String(i + 1)), slot.firstChild);
      if (i === inv.selected && inv.slots[i]) {
        slot.appendChild(el('span', 'iname', itemDef(inv.slots[i].id)?.name || ''));
      }
      bar.appendChild(slot);
    }
  }

  renderInventory() {
    const g = this.game;
    const inv = g.inv;
    const grid = $('inv-grid');
    clear(grid);
    for (let i = 0; i < inv.size; i++) {
      const slot = this.slotEl(inv.slots[i], i === inv.selected);
      const idx = i;
      slot.addEventListener('click', () => {
        const tmp = inv.slots[inv.selected];
        inv.slots[inv.selected] = inv.slots[idx];
        inv.slots[idx] = tmp;
        this.renderInventory(); this.updateHotbar();
      });
      grid.appendChild(slot);
    }
    this.renderCrafting();
  }

  costText(cost) {
    return Object.entries(cost).map(([id, n]) => `${n}× ${itemDef(id)?.name || id}`).join(', ');
  }

  renderCrafting() {
    const g = this.game;
    const list = $('craft-list');
    clear(list);
    const nearBench = g.nearStation('bench');
    for (const r of RECIPES) {
      if (r.station === 'furnace') continue; // smelting happens at the furnace panel
      const needsBench = r.station === 'bench';
      const tierLocked = r.tierUnlock && !g.tiers.has(r.tierUnlock);
      if (tierLocked) continue; // hidden until the tier is reached
      const can = g.inv.has(r.cost) && (!needsBench || nearBench);
      const box = el('div', 'recipe' + (can ? '' : ' locked'));
      const left = el('div');
      const outKey = Object.keys(r.out)[0];
      const outDef = itemDef(outKey);
      const outN = Object.values(r.out)[0];
      left.appendChild(el('div', 'r-name', (r.label || outDef?.name || r.id) + (outN > 1 ? ` ×${outN}` : '')));
      left.appendChild(el('div', 'r-cost', this.costText(r.cost)));
      if (needsBench && !nearBench) left.appendChild(el('div', 'r-note', 'needs crafting bench nearby'));
      if (r.spec) left.appendChild(el('div', 'r-note', r.spec));
      box.appendChild(left);
      const btn = el('button', 'btn', 'Make');
      btn.disabled = !can;
      btn.addEventListener('click', () => {
        if (g.inv.craft(r)) {
          g.audio.craft();
          g.onCrafted(r);
          this.renderInventory(); this.updateHotbar();
        }
      });
      box.appendChild(btn);
      list.appendChild(box);
    }
  }

  // ---------- story log ----------
  renderLog() {
    const g = this.game;
    const wrap = $('log-entries');
    clear(wrap);
    if (g.story.entries.length === 0) {
      wrap.appendChild(el('div', 'dim', 'No documents cataloged. Laboratories hold what the valley forgot.'));
    }
    for (const e of [...g.story.entries].reverse()) {
      const box = el('div', 'log-entry' + (e.synth ? ' synth' : ''));
      box.appendChild(el('h4', null, e.title));
      box.appendChild(el('div', 'le-tag', e.tag));
      box.appendChild(el('p', null, e.body));
      wrap.appendChild(box);
    }
    // bestiary
    const bs = $('log-bestiary');
    clear(bs);
    for (const [k, info] of Object.entries(BESTIARY)) {
      const seen = g.beastSeen.has(k);
      const box = el('div', 'beast');
      if (!seen) {
        box.appendChild(el('h4', null, '???'));
        box.appendChild(el('div', 'b-desc dim', 'Not yet encountered.'));
        bs.appendChild(box);
        continue;
      }
      box.appendChild(el('h4', null, info.name));
      box.appendChild(el('div', 'b-desc', info.known));
      const s = STRAINS[k];
      if (g.story.beastKnown.has(k)) {
        const senses = el('div', 'b-senses');
        for (const [ch, v] of Object.entries(s.senses).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])) {
          senses.appendChild(el('span', null, `${ch} ${'▮'.repeat(Math.round(v * 5))}`));
        }
        box.appendChild(senses);
      } else {
        box.appendChild(el('div', 'b-unknown', 'Sensory profile unknown — recover laboratory records.'));
      }
      bs.appendChild(box);
    }
  }

  // ---------- machine panel ----------
  openMachine(m) {
    this.machineOpen = m;
    this.show('machine-screen');
    this.renderMachine();
  }

  renderMachine() {
    const g = this.game;
    const m = this.machineOpen;
    if (!m) return;
    const titles = { generator: 'FUEL GENERATOR', lamp: 'POWERED LAMP', drill: 'MINING DRILL', turret: 'WARM-BODY TURRET', beacon: 'FIELD RECOVERY BEACON', furnace: 'FURNACE', cradle: 'LAZARUS CRADLE' };
    $('machine-title').textContent = titles[m.type] || 'MACHINE';
    const body = $('machine-body');
    const btns = $('machine-buttons');
    clear(body); clear(btns);
    const note = (t) => { const d = el('div', 'dim', t); d.style.marginTop = '8px'; body.appendChild(d); };

    if (m.type === 'generator') {
      body.appendChild(row('Status', m.running ? 'RUNNING' : m.enabled ? (m.fuel > 0 ? 'STARTING' : 'OUT OF FUEL') : 'SWITCHED OFF'));
      body.appendChild(row('Fuel', gauge(m.fuel / 40, `${m.fuel.toFixed(0)}/40`)));
      body.appendChild(row('Output', m.running ? '12 kW' : '0 kW'));
      note('Running generators emit heat, vibration, and an electrical field. Everything that emits is a beacon.');
      this.mkBtn(btns, m.enabled ? 'Switch off' : 'Switch on', () => { m.enabled = !m.enabled; this.renderMachine(); });
      this.mkBtn(btns, 'Load coal', () => { g.machines.loadFuel(m, g.inv); this.renderMachine(); });
    } else if (m.type === 'drill') {
      const buf = Object.entries(m.buffer || {}).filter(([, n]) => n > 0).map(([id, n]) => `${n}× ${itemDef(id)?.name}`).join(', ') || 'empty';
      body.appendChild(row('Status', m.running ? (m.oreTarget || g.machines.findOre(m) ? 'DRILLING' : 'NO ORE BODY') : 'UNPOWERED'));
      body.appendChild(row('Progress', gauge(m.progress || 0)));
      body.appendChild(row('Buffer', buf));
      note('Requires placement against ore. Produces steady vibration — vibration-sensitive strains follow it.');
      this.mkBtn(btns, 'Collect output', () => { g.machines.collect(m, g.inv); this.renderMachine(); this.updateHotbar(); });
    } else if (m.type === 'turret') {
      body.appendChild(row('Status', m.overheat ? 'OVERHEATED' : m.running ? (m.ammo > 0 ? 'TRACKING' : 'NO AMMUNITION') : 'UNPOWERED'));
      body.appendChild(row('Ammunition', `${m.ammo}/40`));
      body.appendChild(row('Heat', gauge(m.heat)));
      note('Targets warm bodies with line of sight. Blind behind walls; heat builds per shot.');
      this.mkBtn(btns, 'Load slugs', () => { g.machines.loadAmmo(m, g.inv); this.renderMachine(); });
    } else if (m.type === 'beacon') {
      body.appendChild(row('Status', m.running ? 'POWERED' : 'UNPOWERED'));
      body.appendChild(row('Registered', m.registered ? 'YES' : 'NO'));
      body.appendChild(row('Charges', String(m.charges)));
      note('A registered, powered, charged beacon recovers you at the moment of death. Charges are consumed. Power loss at the wrong moment is your problem, not the machine\'s.');
      this.mkBtn(btns, m.registered ? 'Unregister' : 'Register recovery', () => { m.registered = !m.registered; g.hud.updateRecovery(); this.renderMachine(); });
      this.mkBtn(btns, 'Load ampoule', () => { g.machines.loadCharge(m, g.inv); g.hud.updateRecovery(); this.renderMachine(); });
    } else if (m.type === 'furnace') {
      body.appendChild(row('Fuel', gauge(m.fuel / 20, m.fuel.toFixed(0))));
      body.appendChild(row('Smelting', m.queue.length > 0 ? `${m.queue.length} item(s)` : 'idle'));
      body.appendChild(row('Output', Object.entries(m.out || {}).filter(([, n]) => n > 0).map(([id, n]) => `${n}× ${itemDef(id)?.name}`).join(', ') || '—'));
      note('Burns coal or logs. Smelts raw iron into ingots; cooks meat. A furnace is warm — warmth is a signature.');
      this.mkBtn(btns, 'Add fuel', () => { g.furnaceAddFuel(m); this.renderMachine(); });
      this.mkBtn(btns, 'Smelt iron ore', () => { g.furnaceAddJob(m, 'iron_ore_raw', 'iron_ingot'); this.renderMachine(); });
      this.mkBtn(btns, 'Cook raw meat', () => { g.furnaceAddJob(m, 'raw_meat', 'cooked_meat'); this.renderMachine(); });
      this.mkBtn(btns, 'Take output', () => { g.furnaceTake(m); this.renderMachine(); this.updateHotbar(); });
    }
    this.mkBtn(btns, 'Close', () => { this.closeAll(); g.requestLock(); });
  }

  mkBtn(wrap, label, fn) {
    const b = el('button', 'btn', label);
    b.addEventListener('click', fn);
    wrap.appendChild(b);
    return b;
  }
}
