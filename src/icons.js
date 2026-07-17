// 2D item icons, painted on canvas (shared by the HUD and the gallery page).
// All drawing happens in a 26×26 logical space; makeIcon scales to any size.

const hex = (c) => '#' + (c ?? 0x888888).toString(16).padStart(6, '0');

function shade(c, f) {
  const r = Math.min(255, ((c >> 16) & 255) * f);
  const g = Math.min(255, ((c >> 8) & 255) * f);
  const b = Math.min(255, (c & 255) * f);
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

const WOOD = '#6b4e2e';

export function makeIcon(def, size = 26) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.className = 'icon';
  const ctx = c.getContext('2d');
  ctx.scale(size / 26, size / 26);
  paintIcon(ctx, def);
  return c;
}

export function paintIcon(ctx, def) {
  if (!def) return;
  const col = def.color ?? 0x888888;
  if (def.block != null) return paintBlockCube(ctx, def);
  if (def.tool) return paintTool(ctx, def.tool, col, def.key);
  const painter = ITEM_GLYPHS[def.key];
  if (painter) return painter(ctx, col);
  // default: round lump
  ctx.fillStyle = hex(col);
  ctx.beginPath(); ctx.arc(13, 13, 8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath(); ctx.arc(10, 10, 3, 0, Math.PI * 2); ctx.fill();
}

// pseudo-isometric mini cube using the block's face colors
function paintBlockCube(ctx, def) {
  const bd = def.def || {};
  const colArr = Array.isArray(bd.col) ? bd.col : [bd.col, bd.col, bd.col];
  const top = colArr[0] ?? 0x888888, side = colArr[1] ?? top;
  const cx = 13, x0 = 3, x1 = 23, topY = 3.5, midY = 10.5, botMid = 17.5, bot = 23;
  // top
  ctx.fillStyle = shade(top, 1.12);
  ctx.beginPath(); ctx.moveTo(cx, topY); ctx.lineTo(x1, midY); ctx.lineTo(cx, botMid); ctx.lineTo(x0, midY); ctx.closePath(); ctx.fill();
  // left
  ctx.fillStyle = shade(side, 0.82);
  ctx.beginPath(); ctx.moveTo(x0, midY); ctx.lineTo(cx, botMid); ctx.lineTo(cx, bot); ctx.lineTo(x0, bot - 7); ctx.closePath(); ctx.fill();
  // right
  ctx.fillStyle = shade(side, 0.6);
  ctx.beginPath(); ctx.moveTo(x1, midY); ctx.lineTo(cx, botMid); ctx.lineTo(cx, bot); ctx.lineTo(x1, bot - 7); ctx.closePath(); ctx.fill();
  if (bd.accent) {
    ctx.fillStyle = hex(bd.accent);
    ctx.fillRect(8, 13, 2.4, 2.4); ctx.fillRect(16, 15, 2.4, 2.4); ctx.fillRect(11.5, 18, 2.4, 2.4);
  }
}

function paintTool(ctx, kind, col, key) {
  const metal = hex(col);
  ctx.strokeStyle = WOOD; ctx.lineWidth = 3; ctx.lineCap = 'round';
  if (kind === 'pick') {
    ctx.beginPath(); ctx.moveTo(7, 21); ctx.lineTo(17, 8); ctx.stroke();     // handle
    ctx.strokeStyle = metal; ctx.lineWidth = 3.6;
    ctx.beginPath(); ctx.moveTo(8, 5); ctx.quadraticCurveTo(16, 2, 23, 10); ctx.stroke(); // head arc
  } else if (kind === 'axe') {
    ctx.beginPath(); ctx.moveTo(8, 22); ctx.lineTo(16, 7); ctx.stroke();
    ctx.fillStyle = metal;
    ctx.beginPath(); ctx.moveTo(11, 4); ctx.quadraticCurveTo(20, 2, 21, 10);
    ctx.lineTo(15, 12); ctx.closePath(); ctx.fill();                          // blade wedge
  } else if (kind === 'shovel') {
    ctx.beginPath(); ctx.moveTo(13, 22); ctx.lineTo(13, 9); ctx.stroke();
    ctx.fillStyle = metal;
    ctx.beginPath(); ctx.moveTo(9, 9); ctx.lineTo(17, 9); ctx.lineTo(16, 3.5);
    ctx.quadraticCurveTo(13, 1.5, 10, 3.5); ctx.closePath(); ctx.fill();      // scoop
  } else if (kind === 'sword') {
    const spear = key === 'stone_spear';
    ctx.beginPath(); ctx.moveTo(11, 23); ctx.lineTo(13.2, 16); ctx.stroke();  // grip
    ctx.strokeStyle = metal; ctx.lineWidth = spear ? 2.4 : 3.2;
    ctx.beginPath(); ctx.moveTo(13.5, 15); ctx.lineTo(19.5, 3.5); ctx.stroke(); // blade
    ctx.lineWidth = 2.4; ctx.strokeStyle = '#3a3a3a';
    if (!spear) { ctx.beginPath(); ctx.moveTo(10, 14); ctx.lineTo(17, 16.4); ctx.stroke(); } // guard
  }
}

const ITEM_GLYPHS = {
  stick(ctx) {
    ctx.strokeStyle = '#8a6a3e'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(6, 21); ctx.lineTo(20, 6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(13, 13.5); ctx.lineTo(17, 13); ctx.stroke();  // branch stub
  },
  stone_shard(ctx, col) {
    ctx.fillStyle = hex(col);
    ctx.beginPath(); ctx.moveTo(13, 4); ctx.lineTo(22, 14); ctx.lineTo(17, 22);
    ctx.lineTo(7, 20); ctx.lineTo(5, 11); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath(); ctx.moveTo(13, 4); ctx.lineTo(17, 10); ctx.lineTo(10, 12); ctx.closePath(); ctx.fill();
  },
  fiber(ctx, col) {
    ctx.strokeStyle = hex(col); ctx.lineWidth = 2; ctx.lineCap = 'round';
    for (const dx of [-4, 0, 4]) {
      ctx.beginPath(); ctx.moveTo(13 + dx, 22);
      ctx.quadraticCurveTo(9 + dx, 12, 14 + dx, 4); ctx.stroke();
    }
  },
  coal(ctx, col) {
    ctx.fillStyle = hex(col);
    ctx.beginPath(); ctx.moveTo(8, 6); ctx.lineTo(19, 5); ctx.lineTo(22, 13);
    ctx.lineTo(17, 21); ctx.lineTo(7, 20); ctx.lineTo(4, 12); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(8, 6); ctx.lineTo(13, 13); ctx.lineTo(22, 13); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(13, 13); ctx.lineTo(17, 21); ctx.stroke();
  },
  iron_ore_raw(ctx) {
    ITEM_GLYPHS.coal(ctx, 0x8a8079);
    ctx.fillStyle = '#c9a58a';
    ctx.fillRect(9, 9, 3, 3); ctx.fillRect(15, 12, 3, 3); ctx.fillRect(11, 16, 3, 3);
  },
  iron_ingot(ctx, col) {
    ctx.fillStyle = shade(col, 0.75);
    ctx.beginPath(); ctx.moveTo(4, 19); ctx.lineTo(8, 11); ctx.lineTo(22, 11);
    ctx.lineTo(18, 19); ctx.closePath(); ctx.fill();                          // front
    ctx.fillStyle = shade(col, 1.1);
    ctx.beginPath(); ctx.moveTo(8, 11); ctx.lineTo(12, 7); ctx.lineTo(24, 7);
    ctx.lineTo(22, 11); ctx.closePath(); ctx.fill();                          // top
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(10, 12.5, 7, 1.6); // sheen
  },
  raw_meat(ctx, col) { paintMeat(ctx, hex(col)); },
  cooked_meat(ctx, col) { paintMeat(ctx, hex(col)); },
  iron_ampoule(ctx, col) {
    ctx.fillStyle = 'rgba(210,230,220,0.35)';
    ctx.fillRect(9.5, 6, 7, 15);                                              // glass
    ctx.fillStyle = hex(col); ctx.fillRect(10.5, 11, 5, 9);                   // fluid
    ctx.fillStyle = '#3a4048'; ctx.fillRect(8.5, 3, 9, 4);                    // cap
    ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillRect(11, 7, 1.4, 12);
  },
  suppressant(ctx, col) {
    ctx.save(); ctx.translate(13, 13); ctx.rotate(-0.7);
    ctx.fillStyle = 'rgba(220,240,238,0.4)'; ctx.fillRect(-3.2, -8, 6.4, 12); // body
    ctx.fillStyle = hex(col); ctx.fillRect(-2.4, -4, 4.8, 7.4);               // fluid
    ctx.fillStyle = '#556'; ctx.fillRect(-4.4, -10.4, 8.8, 2.6);              // plunger cap
    ctx.fillRect(-1, -13, 2, 3);                                              // plunger
    ctx.strokeStyle = '#aab'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(0, 4); ctx.lineTo(0, 11); ctx.stroke();       // needle
    ctx.restore();
  },
  turret_ammo(ctx, col) {
    for (const dx of [-6, 0, 6]) {
      ctx.fillStyle = hex(col);
      ctx.beginPath(); ctx.moveTo(11 + dx, 9); ctx.quadraticCurveTo(13 + dx, 4, 15 + dx, 9);
      ctx.lineTo(15 + dx, 17) ; ctx.lineTo(11 + dx, 17); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#6a5a48'; ctx.fillRect(11 + dx, 17, 4, 4);             // casing
    }
  },
  continuity_core(ctx, col) {
    ctx.strokeStyle = hex(col); ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(13, 13, 9.5, 0, Math.PI * 2); ctx.stroke();      // ring
    ctx.fillStyle = hex(col);
    ctx.beginPath(); ctx.moveTo(13, 5.5); ctx.lineTo(19.5, 13); ctx.lineTo(13, 20.5);
    ctx.lineTo(6.5, 13); ctx.closePath(); ctx.fill();                         // core
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath(); ctx.moveTo(13, 9); ctx.lineTo(16, 13); ctx.lineTo(13, 17);
    ctx.lineTo(10, 13); ctx.closePath(); ctx.fill();
  },
  steel_ingot(ctx, col) {
    ITEM_GLYPHS.iron_ingot(ctx, col);
    ctx.fillStyle = 'rgba(120,150,190,0.3)'; ctx.fillRect(9, 14.6, 9, 1.4);   // blued temper line
  },
  hide(ctx, col) {
    ctx.fillStyle = hex(col);
    ctx.beginPath(); ctx.moveTo(6, 6); ctx.quadraticCurveTo(13, 3, 20, 6);
    ctx.quadraticCurveTo(23, 13, 20, 20); ctx.quadraticCurveTo(13, 23, 6, 20);
    ctx.quadraticCurveTo(3, 13, 6, 6); ctx.closePath(); ctx.fill();           // pelt
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1.2;
    for (const y of [10, 14, 18]) { ctx.beginPath(); ctx.moveTo(8, y); ctx.lineTo(18, y); ctx.stroke(); }
  },
  iron_armor(ctx, col) {
    ctx.fillStyle = hex(col);
    ctx.beginPath(); ctx.moveTo(7, 6); ctx.lineTo(19, 6); ctx.lineTo(21, 10);
    ctx.lineTo(19, 21); ctx.lineTo(7, 21); ctx.lineTo(5, 10); ctx.closePath(); ctx.fill(); // chest plate
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(11, 6, 4, 4);            // collar
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(9, 9); ctx.lineTo(9, 19); ctx.stroke();       // rivet line
    ctx.beginPath(); ctx.moveTo(17, 9); ctx.lineTo(17, 19); ctx.stroke();
  },
  relay_module(ctx, col) {
    ctx.fillStyle = '#2a2e33'; ctx.fillRect(5, 8, 16, 12);                    // board
    ctx.fillStyle = hex(col); ctx.fillRect(7, 10, 5, 5);                      // relay can
    ctx.fillStyle = '#74c7c4'; ctx.fillRect(14, 10, 3, 3);                    // chip
    ctx.fillStyle = '#9aa0a6';
    for (const x of [6, 10, 14, 18]) ctx.fillRect(x, 20, 1.6, 3);             // pins
    ctx.strokeStyle = 'rgba(224,168,62,0.8)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(13, 15); ctx.lineTo(19, 15); ctx.lineTo(19, 11); ctx.stroke(); // trace
  },
  filter_unit(ctx, col) {
    ctx.fillStyle = '#3a4440'; ctx.fillRect(7, 5, 12, 16);                    // canister
    ctx.fillStyle = hex(col);
    for (let i = 0; i < 4; i++) ctx.fillRect(8.5, 7 + i * 3.4, 9, 1.8);       // filter pleats
    ctx.fillStyle = '#24282e'; ctx.fillRect(6, 3, 14, 3); ctx.fillRect(6, 20, 14, 3); // end caps
  },
  sterilizer_charge(ctx, col) {
    ctx.fillStyle = '#4a4438'; ctx.fillRect(9, 10, 8, 12);                    // canister
    ctx.fillStyle = hex(col); ctx.fillRect(10, 12, 6, 6);                     // window
    ctx.fillStyle = '#d94f4f'; ctx.fillRect(11.5, 5, 3, 5);                   // striker cap
    ctx.strokeStyle = hex(col); ctx.lineWidth = 1.4;                          // vapor curls
    ctx.beginPath(); ctx.moveTo(8, 8); ctx.quadraticCurveTo(5, 5, 7, 3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(18, 8); ctx.quadraticCurveTo(21, 5, 19, 3); ctx.stroke();
  },
};

function paintMeat(ctx, color) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.ellipse(11, 14, 7.5, 6, -0.6, 0, Math.PI * 2); ctx.fill(); // meat
  ctx.strokeStyle = '#e8e0d0'; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(16, 10); ctx.lineTo(21, 5.5); ctx.stroke();         // bone
  ctx.fillStyle = '#e8e0d0';
  ctx.beginPath(); ctx.arc(21.5, 4.5, 2.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath(); ctx.ellipse(9, 12, 3, 2, -0.6, 0, Math.PI * 2); ctx.fill();
}
