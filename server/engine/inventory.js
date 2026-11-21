// Rucksack als Raster (Tarkov-Art), Start 4×4 (Kernmechanik §6).
// Dazu ein Platz „in der Hand“: Was dort liegt, belegt kein Rasterfeld (Ul, 21.11.).

export function createInventory(w = 4, h = 4) {
  return { w, h, items: [] }; // items: [{uid, itemId, name, x, y, w, h, qty}]
}

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function fits(inv, rect, ignoreUid) {
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > inv.w || rect.y + rect.h > inv.h) return false;
  return !inv.items.some((it) => !it.inHand && it.uid !== ignoreUid && overlaps(it, rect));
}

export function findSpot(inv, w, h) {
  for (let y = 0; y <= inv.h - h; y++)
    for (let x = 0; x <= inv.w - w; x++)
      if (fits(inv, { x, y, w, h })) return { x, y };
  return null;
}

// Stapelbares legt sich auf vorhandenen Stapel
export function addItem(inv, item, uid, at) {
  if (item.stack) {
    const pile = inv.items.find((it) => it.itemId === item.id && !it.inHand);
    if (pile) { pile.qty += item.qty || 1; return { ok: true, uid: pile.uid, stacked: true }; }
  }
  const w = item.w || 1, h = item.h || 1;
  const spot = at && fits(inv, { ...at, w, h }) ? at : findSpot(inv, w, h);
  if (!spot) return { ok: false, error: 'Kein Platz im Rucksack' };
  inv.items.push({ uid, itemId: item.id, name: item.name, x: spot.x, y: spot.y, w, h, qty: item.qty || 1 });
  return { ok: true, uid };
}

export function moveItem(inv, uid, x, y) {
  const it = inv.items.find((i) => i.uid === uid);
  if (!it) return { ok: false, error: 'Gegenstand nicht gefunden' };
  if (!fits(inv, { x, y, w: it.w, h: it.h }, uid)) return { ok: false, error: 'Passt dort nicht hin' };
  it.x = x; it.y = y; it.inHand = false;
  return { ok: true };
}

export const inHand = (inv) => inv.items.find((i) => i.inHand) || null;

// In die Hand nehmen; was vorher in der Hand war, wandert in den Rucksack (wenn Platz ist)
export function equip(inv, uid) {
  const it = inv.items.find((i) => i.uid === uid);
  if (!it) return { ok: false, error: 'Gegenstand nicht gefunden' };
  if (it.inHand) return { ok: true };
  const prev = inHand(inv);
  it.inHand = true;                       // gibt sein Rasterfeld frei
  if (prev) {
    prev.inHand = false;
    const spot = findSpot(inv, prev.w, prev.h);
    if (!spot) { prev.inHand = true; it.inHand = false; return { ok: false, error: `Kein Platz im Rucksack für ${prev.name}` }; }
    prev.x = spot.x; prev.y = spot.y;
  }
  it.x = -1; it.y = -1;
  return { ok: true, swapped: prev?.uid || null };
}

export function unequip(inv, uid) {
  const it = inv.items.find((i) => i.uid === uid && i.inHand);
  if (!it) return { ok: false, error: 'Nicht in der Hand' };
  it.inHand = false;
  const spot = findSpot(inv, it.w, it.h);
  if (!spot) { it.inHand = true; return { ok: false, error: 'Kein Platz im Rucksack' }; }
  it.x = spot.x; it.y = spot.y;
  return { ok: true };
}

export function removeItem(inv, uid, qty = 1) {
  const idx = inv.items.findIndex((i) => i.uid === uid);
  if (idx < 0) return { ok: false, error: 'Gegenstand nicht gefunden' };
  const it = inv.items[idx];
  if (it.qty > qty) { it.qty -= qty; return { ok: true, item: { ...it, qty } }; }
  inv.items.splice(idx, 1);
  return { ok: true, item: it };
}
