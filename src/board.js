// Pure, DOM-free board model. Every operation returns a new board so that
// undo/redo can keep references to previous states.
export const BOARD_VERSION = 1;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
export const CARD_TYPES = Object.freeze({
  suspect: { label: "Suspect", color: "#f4d35e" },
  clue: { label: "Clue", color: "#f7f3e8" },
  location: { label: "Location", color: "#a8dadc" },
  evidence: { label: "Evidence", color: "#f4a6a6" },
  note: { label: "Note", color: "#c7e9b0" },
});
export const CARD_SIZE = { width: 224, height: 160 };

export function createId(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
export function createBoard(title = "Untitled case") {
  return { version: BOARD_VERSION, title, cards: [], links: [] };
}
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;
const normalizeType = (type) => Object.hasOwn(CARD_TYPES, type) ? type : "note";
export const getCard = (board, id) => board.cards.find((card) => card.id === id);

export function addCard(board, partial = {}) {
  const card = {
    id: partial.id ?? createId("card"),
    type: normalizeType(partial.type),
    title: String(partial.title ?? "New lead"),
    body: String(partial.body ?? ""),
    x: finiteOr(partial.x, 0),
    y: finiteOr(partial.y, 0),
  };
  if (getCard(board, card.id)) throw new Error(`Card id already exists: ${card.id}`);
  return { board: { ...board, cards: [...board.cards, card] }, card };
}
export function updateCard(board, id, changes) {
  let found = false;
  const cards = board.cards.map((card) => {
    if (card.id !== id) return card;
    found = true;
    const next = { ...card, ...changes, id: card.id };
    return {
      ...next,
      type: normalizeType(next.type),
      title: String(next.title), body: String(next.body),
      x: finiteOr(next.x, card.x), y: finiteOr(next.y, card.y),
    };
  });
  return found ? { ...board, cards } : board;
}
export function moveCards(board, ids, dx, dy) {
  const selected = new Set(ids);
  if (selected.size === 0 || (dx === 0 && dy === 0)) return board;
  return { ...board, cards: board.cards.map((card) =>
    selected.has(card.id) ? { ...card, x: card.x + dx, y: card.y + dy } : card,
  ) };
}
export function bringToFront(board, id) {
  const card = getCard(board, id);
  if (!card || board.cards.at(-1) === card) return board;
  return { ...board, cards: [...board.cards.filter((c) => c.id !== id), card] };
}
export function removeCards(board, ids) {
  const removed = new Set(ids);
  if (removed.size === 0) return board;
  return {
    ...board,
    cards: board.cards.filter((card) => !removed.has(card.id)),
    links: board.links.filter((link) => !removed.has(link.from) && !removed.has(link.to)),
  };
}
export const findLink = (board, a, b) => board.links.find((link) =>
  (link.from === a && link.to === b) || (link.from === b && link.to === a),
);
export function connect(board, from, to, label = "") {
  if (from === to || !getCard(board, from) || !getCard(board, to) || findLink(board, from, to)) {
    return { board, link: null };
  }
  const link = { id: createId("link"), from, to, label: String(label) };
  return { board: { ...board, links: [...board.links, link] }, link };
}
export function updateLink(board, id, label) {
  if (!board.links.some((link) => link.id === id)) return board;
  return { ...board, links: board.links.map((link) =>
    link.id === id ? { ...link, label: String(label) } : link,
  ) };
}
export function removeLinks(board, ids) {
  const removed = new Set(ids);
  if (removed.size === 0) return board;
  return { ...board, links: board.links.filter((link) => !removed.has(link.id)) };
}
export function searchCards(board, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return new Set();
  return new Set(board.cards.filter((card) =>
    [card.title, card.body, CARD_TYPES[card.type].label].some((text) =>
      text.toLowerCase().includes(needle),
    ),
  ).map((card) => card.id));
}

// screen = world * zoom + offset. Keep the world point beneath the cursor
// stationary while zooming, even when the zoom is clamped.
export const createViewport = () => ({ x: 0, y: 0, zoom: 1 });
export const screenToWorld = (view, x, y) => ({ x: (x - view.x) / view.zoom, y: (y - view.y) / view.zoom });
export const worldToScreen = (view, x, y) => ({ x: x * view.zoom + view.x, y: y * view.zoom + view.y });
export const panViewport = (view, dx, dy) => ({ ...view, x: view.x + dx, y: view.y + dy });
export function zoomAt(view, factor, x, y) {
  const zoom = clamp(view.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  const anchor = screenToWorld(view, x, y);
  return { x: x - anchor.x * zoom, y: y - anchor.y * zoom, zoom };
}
export function getBounds(cards, sizeOf = () => CARD_SIZE) {
  if (!cards.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const card of cards) {
    const { width, height } = sizeOf(card);
    minX = Math.min(minX, card.x); minY = Math.min(minY, card.y);
    maxX = Math.max(maxX, card.x + width); maxY = Math.max(maxY, card.y + height);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}
export function fitViewport(cards, width, height, { padding = 80, maxZoom = 1.25, sizeOf } = {}) {
  const bounds = getBounds(cards, sizeOf);
  if (!bounds) return { x: width / 2, y: height / 2, zoom: 1 };
  const zoom = clamp(Math.min(
    Math.max(1, width - padding * 2) / bounds.width,
    Math.max(1, height - padding * 2) / bounds.height,
    maxZoom,
  ), MIN_ZOOM, MAX_ZOOM);
  return {
    x: width / 2 - (bounds.minX + bounds.width / 2) * zoom,
    y: height / 2 - (bounds.minY + bounds.height / 2) * zoom,
    zoom,
  };
}

export const serializeBoard = (board) => JSON.stringify(board, null, 2);
/** Parse untrusted/imported JSON, discarding invalid and dangling entries. */
export function parseBoard(input) {
  const raw = typeof input === "string" ? JSON.parse(input) : input;
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.cards)) {
    throw new Error("Not a detective board: missing cards array");
  }
  const cards = [], ids = new Set();
  for (const item of raw.cards) {
    if (!item || typeof item.id !== "string" || ids.has(item.id)) continue;
    ids.add(item.id);
    cards.push({
      id: item.id, type: normalizeType(item.type),
      title: String(item.title ?? ""), body: String(item.body ?? ""),
      x: finiteOr(item.x, 0), y: finiteOr(item.y, 0),
    });
  }
  const links = [], pairs = new Set(), linkIds = new Set();
  for (const item of Array.isArray(raw.links) ? raw.links : []) {
    if (!item || !ids.has(item.from) || !ids.has(item.to) || item.from === item.to) continue;
    const pair = [item.from, item.to].sort().join("\u0000");
    if (pairs.has(pair)) continue;
    pairs.add(pair);
    const id = typeof item.id === "string" && !linkIds.has(item.id) ? item.id : createId("link");
    linkIds.add(id);
    links.push({ id, from: item.from, to: item.to, label: String(item.label ?? "") });
  }
  return { version: BOARD_VERSION, title: String(raw.title ?? "Untitled case"), cards, links };
}

export const createHistory = (present, limit = 200) => ({ past: [], present, future: [], limit });
export function commitFrom(history, base, next = history.present) {
  if (base === next) return { ...history, present: next };
  return { ...history, past: [...history.past, base].slice(-history.limit), present: next, future: [] };
}
export const pushHistory = (history, next) => next === history.present ? history : commitFrom(history, history.present, next);
export const replacePresent = (history, next) => ({ ...history, present: next });
export function undo(history) {
  if (!history.past.length) return history;
  return { ...history, past: history.past.slice(0, -1), present: history.past.at(-1), future: [history.present, ...history.future] };
}
export function redo(history) {
  if (!history.future.length) return history;
  return { ...history, past: [...history.past, history.present], present: history.future[0], future: history.future.slice(1) };
}
