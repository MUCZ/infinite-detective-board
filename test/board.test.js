import test from "node:test";
import assert from "node:assert/strict";
import {
  CARD_TYPES, addCard, bringToFront, commitFrom, connect, createBoard, createHistory,
  fitViewport, getBounds, moveCards, panViewport, parseBoard, pushHistory, redo,
  removeCards, removeLinks, replacePresent, screenToWorld, searchCards, serializeBoard,
  undo, updateCard, updateLink, worldToScreen, zoomAt,
} from "../src/board.js";
import { makeDemoBoard } from "../src/demo.js";

function fixture() {
  let board = createBoard("Test case");
  board = addCard(board, { id: "a", type: "clue", title: "Red thread", body: "At 11 PM", x: 10, y: 20 }).board;
  board = addCard(board, { id: "b", type: "suspect", title: "Alex", x: 400, y: 200 }).board;
  board = addCard(board, { id: "c", type: "note", title: "Theory", x: -50, y: -30 }).board;
  return board;
}

test("cards have stable ids, types, and immutable updates", () => {
  const board = fixture();
  assert.equal(board.cards.length, 3);
  assert.deepEqual(Object.keys(CARD_TYPES), ["suspect", "clue", "location", "evidence", "note"]);
  const updated = updateCard(board, "a", { title: "New title", x: 99, type: "invalid" });
  assert.equal(board.cards[0].title, "Red thread");
  assert.equal(updated.cards[0].title, "New title");
  assert.equal(updated.cards[0].type, "note");
  assert.equal(updated.cards[0].x, 99);
  assert.equal(updated.cards[0].id, "a");
  assert.equal(updateCard(board, "missing", { title: "X" }), board);
  assert.throws(() => addCard(board, { id: "a" }), /already exists/);
});

test("multi-card moves, stacking, and deletion do not mutate the original", () => {
  const board = fixture();
  const moved = moveCards(board, ["a", "c"], 12, -7);
  assert.deepEqual(moved.cards.map((card) => [card.x, card.y]), [[22, 13], [400, 200], [-38, -37]]);
  assert.equal(board.cards[0].x, 10);
  assert.equal(moveCards(board, [], 1, 1), board);
  assert.deepEqual(bringToFront(board, "a").cards.map((card) => card.id), ["b", "c", "a"]);
  assert.equal(bringToFront(board, "c"), board);
  assert.deepEqual(removeCards(board, ["b"]).cards.map((card) => card.id), ["a", "c"]);
});

test("connections reject self, duplicates in either direction, and dangling endpoints", () => {
  const board = fixture();
  const { board: linked, link } = connect(board, "a", "b", "last seen");
  assert.equal(link.label, "last seen");
  assert.equal(board.links.length, 0);
  assert.equal(connect(linked, "b", "a").board, linked);
  assert.equal(connect(linked, "a", "a").board, linked);
  assert.equal(connect(linked, "a", "unknown").board, linked);
  assert.equal(updateLink(linked, link.id, "new label").links[0].label, "new label");
  assert.equal(removeLinks(linked, [link.id]).links.length, 0);
  assert.equal(removeCards(linked, ["a"]).links.length, 0);
});

test("search finds title, body and category case-insensitively", () => {
  const board = fixture();
  assert.deepEqual([...searchCards(board, "RED")], ["a"]);
  assert.deepEqual([...searchCards(board, "11 pm")], ["a"]);
  assert.deepEqual([...searchCards(board, "SUSPECT")], ["b"]);
  assert.equal(searchCards(board, "  ").size, 0);
});

test("pan, zoom and inverse transforms preserve the pointer anchor", () => {
  const initial = panViewport({ x: 80, y: -25, zoom: 1.5 }, 20, 10);
  assert.deepEqual(initial, { x: 100, y: -15, zoom: 1.5 });
  const anchor = screenToWorld(initial, 312, 247);
  const zoomed = zoomAt(initial, 2, 312, 247);
  assert.equal(zoomed.zoom, 3);
  assert.deepEqual(worldToScreen(zoomed, anchor.x, anchor.y), { x: 312, y: 247 });
  const clamped = zoomAt(zoomed, 50, 312, 247);
  assert.equal(clamped.zoom, 4);
  assert.deepEqual(worldToScreen(clamped, anchor.x, anchor.y), { x: 312, y: 247 });
  assert.equal(zoomAt(initial, 0.001, 0, 0).zoom, 0.1);
});

test("fit includes card extents and centers an empty canvas", () => {
  const board = fixture();
  assert.deepEqual(getBounds(board.cards), { minX: -50, minY: -30, maxX: 624, maxY: 360, width: 674, height: 390 });
  const fitted = fitViewport(board.cards, 1000, 600, { padding: 50 });
  const bounds = getBounds(board.cards);
  const topLeft = worldToScreen(fitted, bounds.minX, bounds.minY);
  const bottomRight = worldToScreen(fitted, bounds.maxX, bounds.maxY);
  assert.ok(topLeft.x >= 49 && topLeft.y >= 49);
  assert.ok(bottomRight.x <= 951 && bottomRight.y <= 551);
  assert.deepEqual(fitViewport([], 800, 400), { x: 400, y: 200, zoom: 1 });
});

test("JSON round trip and malformed imports are handled safely", () => {
  const board = fixture();
  const { board: linked } = connect(board, "a", "b", "knows");
  assert.deepEqual(parseBoard(serializeBoard(linked)), linked);
  assert.throws(() => parseBoard("not json"), SyntaxError);
  assert.throws(() => parseBoard({ title: "bad" }), /missing cards array/);
  const imported = parseBoard({
    cards: [{ id: "a", type: "bogus", x: Infinity }, { id: "a" }, { id: "b" }],
    links: [
      { id: "1", from: "a", to: "b" }, { id: "2", from: "b", to: "a" },
      { id: "3", from: "a", to: "missing" }, { id: "4", from: "a", to: "a" },
    ],
  });
  assert.equal(imported.cards.length, 2);
  assert.equal(imported.cards[0].type, "note");
  assert.equal(imported.cards[0].x, 0);
  assert.equal(imported.links.length, 1);
});

test("undo and redo group continuous drag/edit into one action", () => {
  const base = fixture();
  let history = createHistory(base);
  history = replacePresent(history, moveCards(base, ["a"], 10, 0));
  history = replacePresent(history, moveCards(base, ["a"], 20, 0));
  history = commitFrom(history, base);
  assert.equal(history.past.length, 1);
  assert.equal(history.present.cards[0].x, 30);
  history = undo(history);
  assert.equal(history.present.cards[0].x, 10);
  history = redo(history);
  assert.equal(history.present.cards[0].x, 30);
  history = pushHistory(history, updateCard(history.present, "a", { title: "Changed" }));
  assert.equal(history.future.length, 0);
  assert.equal(redo(history), history);
});

test("demo board is connected and fits in a regular viewport", () => {
  const board = makeDemoBoard();
  assert.equal(board.cards.length, 8);
  assert.equal(board.links.length, 8);
  assert.equal(new Set(board.cards.map((card) => card.id)).size, 8);
  const view = fitViewport(board.cards, 1050, 750);
  assert.ok(view.zoom > 0.5 && view.zoom <= 1);
});
