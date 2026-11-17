import {
  CARD_SIZE, CARD_TYPES, addCard, bringToFront, commitFrom, connect, createHistory,
  fitViewport, getBounds, getCard, moveCards, panViewport, parseBoard, pushHistory,
  redo, removeCards, removeLinks, replacePresent, screenToWorld, searchCards,
  serializeBoard, undo, updateCard, updateLink, worldToScreen, zoomAt,
} from "./board.js";
import { makeDemoBoard } from "./demo.js";

const STORAGE_KEY = "infinite-detective-board:v1";
const $ = (selector) => document.querySelector(selector);
const canvas = $("#canvas");
const world = $("#world");
const cardsLayer = $("#cards-layer");
const linksLayer = $("#links-layer");
const inspector = $("#inspector");
const searchInput = $("#search-input");
const importInput = $("#import-input");

let board;
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  board = saved ? parseBoard(saved) : makeDemoBoard();
} catch (error) {
  console.warn("Unable to restore board; loading demo", error);
  board = makeDemoBoard();
}
let history = createHistory(board);
let viewport = fitViewport(board.cards, canvas.clientWidth, canvas.clientHeight, { padding: 70 });
let selected = new Set();
let selectedLink = null;
let mode = "select";
let connectingFrom = null;
let spaceDown = false;
let gesture = null;
let query = "";
let saveTimer;

const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

function persist() {
  clearTimeout(saveTimer);
  $("#save-status").textContent = "Saving…";
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, serializeBoard(history.present));
      $("#save-status").textContent = "All changes saved";
    } catch (error) {
      $("#save-status").textContent = "Storage unavailable — export your board";
      console.warn("Unable to save board", error);
    }
  }, 250);
}
function commit(next) {
  if (next === history.present) return;
  history = pushHistory(history, next);
  persist(); render();
}
function changeHistory(next) {
  if (next === history) return;
  history = next;
  selected = new Set([...selected].filter((id) => getCard(history.present, id)));
  if (selectedLink && !history.present.links.some((link) => link.id === selectedLink)) selectedLink = null;
  connectingFrom = null;
  persist(); render();
}
function setMode(next) {
  mode = next;
  connectingFrom = null;
  render();
}
function render() {
  renderMeta(); renderLinks(); renderCards(); renderInspector(); renderViewport();
}
function renderMeta() {
  const board = history.present;
  $("#case-title").textContent = board.title;
  $("#case-count").textContent = `${board.cards.length} leads · ${board.links.length} connections`;
  $("#card-count").textContent = board.cards.length;
  $("#link-count").textContent = board.links.length;
  $("#undo-button").disabled = history.past.length === 0;
  $("#redo-button").disabled = history.future.length === 0;
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
    button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
  });
  canvas.classList.toggle("pan-mode", mode === "pan" || spaceDown);
  canvas.classList.toggle("connect-mode", mode === "connect");
  $("#mode-hint").textContent = connectingFrom
    ? "Select another card to make a connection · Esc to cancel"
    : mode === "connect" ? "Select two cards to connect them"
      : mode === "pan" ? "Drag to move around the board"
        : "Drag cards to arrange · Scroll to zoom · Space to pan";
  const matches = searchCards(board, query);
  $("#search-count").textContent = query ? `${matches.size} found` : "⌘ K";
}
function cardMarkup(card, index, matches) {
  const isDimmed = query && !matches.has(card.id);
  const isActive = selected.has(card.id);
  const isOrigin = connectingFrom === card.id;
  const badge = { suspect: "PERSON OF INTEREST", clue: "CASE FILE", location: "LOCATION", evidence: "PHYSICAL EVIDENCE", note: "FIELD NOTE" }[card.type];
  const glyph = { suspect: "◈", clue: "✳", location: "⌖", evidence: "◇", note: "✎" }[card.type];
  return `<article class="card card--${card.type}${isActive ? " selected" : ""}${isDimmed ? " dimmed" : ""}${isOrigin ? " connecting-origin" : ""}" data-id="${escapeHTML(card.id)}" style="left:${card.x}px;top:${card.y}px" tabindex="0" aria-label="${escapeHTML(CARD_TYPES[card.type].label)}: ${escapeHTML(card.title)}">
    <div class="card-top"><span class="card-type"><span class="card-type-icon">${glyph}</span>${badge}</span><span class="card-number">${String(index + 1).padStart(2, "0")}</span></div>
    <div class="card-content"><h3>${escapeHTML(card.title || "Untitled lead")}</h3><p>${escapeHTML(card.body || "Add a detail to this lead…")}</p></div>
    <div class="card-bottom"><span>${card.type === "suspect" ? "SUBJECT" : card.type === "location" ? "SITE" : card.type === "note" ? "HYPOTHESIS" : "EVIDENCE"} / ${String(index + 1).padStart(3, "0")}</span><span class="card-bottom-mark">↗</span></div>
  </article>`;
}
function renderCards() {
  const matches = searchCards(history.present, query);
  cardsLayer.innerHTML = history.present.cards.map((card, i) => cardMarkup(card, i, matches)).join("");
}
function edgePoint(card, toward) {
  const cx = card.x + CARD_SIZE.width / 2, cy = card.y + CARD_SIZE.height / 2;
  const tx = toward.x + CARD_SIZE.width / 2, ty = toward.y + CARD_SIZE.height / 2;
  const dx = tx - cx, dy = ty - cy;
  const factor = Math.min(dx ? (CARD_SIZE.width / 2 + 2) / Math.abs(dx) : Infinity,
    dy ? (CARD_SIZE.height / 2 + 2) / Math.abs(dy) : Infinity);
  return { x: cx + dx * factor, y: cy + dy * factor };
}
function renderLinks() {
  const board = history.present;
  linksLayer.innerHTML = board.links.map((link) => {
    const from = getCard(board, link.from), to = getCard(board, link.to);
    if (!from || !to) return "";
    const a = edgePoint(from, to), b = edgePoint(to, from);
    const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y;
    const bend = Math.min(18, Math.hypot(dx, dy) * 0.06);
    const cx = midX - (dy / Math.max(1, Math.hypot(dx, dy))) * bend;
    const cy = midY + (dx / Math.max(1, Math.hypot(dx, dy))) * bend;
    const path = `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;
    return `<g class="link${selectedLink === link.id ? " selected" : ""}" data-link-id="${escapeHTML(link.id)}">
      <path class="link-hit" d="${path}"/><path class="link-line" d="${path}"/>
      <circle class="link-pin" cx="${a.x}" cy="${a.y}" r="4"/><circle class="link-pin" cx="${b.x}" cy="${b.y}" r="4"/>
      ${link.label ? `<g class="link-label" transform="translate(${cx},${cy})"><rect x="-${Math.max(28, link.label.length * 3.7 + 12)}" y="-12" width="${Math.max(56, link.label.length * 7.4 + 24)}" height="24" rx="4"/><text text-anchor="middle" dominant-baseline="middle">${escapeHTML(link.label)}</text></g>` : ""}
    </g>`;
  }).join("");
}
function renderInspector() {
  const board = history.present;
  const card = selected.size === 1 ? getCard(board, [...selected][0]) : null;
  const link = board.links.find((item) => item.id === selectedLink);
  if (card) {
    const connections = board.links.filter((item) => item.from === card.id || item.to === card.id);
    inspector.innerHTML = `<div class="inspector-head"><div><span class="eyebrow">THE CASE FILE</span><h2>Lead details</h2></div><button class="icon-button close-inspector" aria-label="Close details">×</button></div>
      <div class="inspector-scroll"><div class="inspector-preview preview--${card.type}"><span class="preview-symbol">${{ suspect: "◈", clue: "✳", location: "⌖", evidence: "◇", note: "✎" }[card.type]}</span><span class="preview-caption">${CARD_TYPES[card.type].label.toUpperCase()} / ${String(board.cards.indexOf(card) + 1).padStart(3, "0")}</span></div>
      <div class="field"><label for="card-type">CATEGORY</label><select id="card-type">${Object.entries(CARD_TYPES).map(([key, value]) => `<option value="${key}"${card.type === key ? " selected" : ""}>${value.label}</option>`).join("")}</select></div>
      <div class="field"><label for="card-title">TITLE</label><input id="card-title" type="text" maxlength="100" value="${escapeHTML(card.title)}" placeholder="Name this lead"/></div>
      <div class="field"><label for="card-body">NOTES</label><textarea id="card-body" rows="6" placeholder="What do you know so far?">${escapeHTML(card.body)}</textarea></div>
      <div class="inspector-section"><div class="section-heading">CONNECTIONS <span>${connections.length}</span></div>${connections.length ? connections.map((item) => {
        const other = getCard(board, item.from === card.id ? item.to : item.from);
        return `<button class="related-lead" data-related="${escapeHTML(other.id)}"><span class="related-dot" style="background:${CARD_TYPES[other.type].color}"></span><span>${escapeHTML(other.title)}</span><span>↗</span></button>`;
      }).join("") : `<p class="empty-related">No connections yet. Use the Connect tool to link this lead.</p>`}</div>
      <button id="delete-card" class="danger-button">Delete this lead <span>⌫</span></button></div>`;
    return;
  }
  if (link) {
    const from = getCard(board, link.from), to = getCard(board, link.to);
    inspector.innerHTML = `<div class="inspector-head"><div><span class="eyebrow">THE CASE FILE</span><h2>Connection</h2></div><button class="icon-button close-inspector" aria-label="Close details">×</button></div>
      <div class="inspector-scroll"><div class="connection-preview"><span>${escapeHTML(from.title)}</span><span class="connection-arrow">⟶</span><span>${escapeHTML(to.title)}</span></div>
      <div class="field"><label for="link-label">RELATIONSHIP</label><input id="link-label" type="text" maxlength="60" value="${escapeHTML(link.label)}" placeholder="How are they connected?"/></div>
      <p class="inspector-tip">Give this connection a name to make the story easier to follow.</p>
      <button id="delete-link" class="danger-button">Delete connection <span>⌫</span></button></div>`;
    return;
  }
  inspector.innerHTML = `<div class="inspector-head"><div><span class="eyebrow">THE CASE FILE</span><h2>Overview</h2></div></div>
    <div class="inspector-scroll"><div class="overview-graphic"><div class="overview-orbit orbit-one"></div><div class="overview-orbit orbit-two"></div><span class="overview-icon">✳</span></div>
    <span class="eyebrow">ACTIVE INVESTIGATION</span><h3 class="overview-title">Every detail tells a story.</h3>
    <p class="overview-copy">Follow the threads. Connect the clues. See the whole picture.</p>
    <div class="overview-stats"><div><strong>${board.cards.length}</strong><span>Leads gathered</span></div><div><strong>${board.links.length}</strong><span>Connections</span></div></div>
    <div class="inspector-section"><div class="section-heading">QUICK START</div><p class="inspector-tip">Select a card to inspect it, or add a new lead from the left panel.</p></div></div>`;
}
function renderViewport() {
  world.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`;
  canvas.style.setProperty("--grid-x", `${viewport.x}px`);
  canvas.style.setProperty("--grid-y", `${viewport.y}px`);
  canvas.style.setProperty("--grid-size", `${32 * viewport.zoom}px`);
  $("#zoom-value").textContent = `${Math.round(viewport.zoom * 100)}%`;
  renderMinimap();
}
function renderMinimap() {
  const board = history.present;
  const rect = canvas.getBoundingClientRect();
  const corners = [screenToWorld(viewport, 0, 0), screenToWorld(viewport, rect.width, rect.height)];
  const cardBounds = getBounds(board.cards);
  const left = Math.min(cardBounds?.minX ?? 0, corners[0].x), top = Math.min(cardBounds?.minY ?? 0, corners[0].y);
  const right = Math.max(cardBounds?.maxX ?? 1, corners[1].x), bottom = Math.max(cardBounds?.maxY ?? 1, corners[1].y);
  const margin = 80, scale = Math.min(180 / (right - left + margin * 2), 105 / (bottom - top + margin * 2));
  const x = (v) => 10 + (v - left + margin) * scale;
  const y = (v) => 8 + (v - top + margin) * scale;
  const svg = $("#minimap-svg");
  svg.innerHTML = `${board.links.map((link) => {
    const a = getCard(board, link.from), b = getCard(board, link.to);
    return `<line x1="${x(a.x + 112)}" y1="${y(a.y + 80)}" x2="${x(b.x + 112)}" y2="${y(b.y + 80)}" stroke="#c97667" stroke-width="1" opacity=".75"/>`;
  }).join("")}${board.cards.map((card) => `<rect x="${x(card.x)}" y="${y(card.y)}" width="${Math.max(3, 224 * scale)}" height="${Math.max(2, 160 * scale)}" rx="1.5" fill="${CARD_TYPES[card.type].color}" stroke="#74675b" stroke-width=".6"/>`).join("")}
    <rect x="${x(corners[0].x)}" y="${y(corners[0].y)}" width="${(corners[1].x - corners[0].x) * scale}" height="${(corners[1].y - corners[0].y) * scale}" fill="rgba(193,92,74,.09)" stroke="#c45e4e" stroke-width="1.5" rx="2"/>`;
  svg.dataset.left = String(left - margin); svg.dataset.top = String(top - margin); svg.dataset.scale = String(scale);
}
function centerOnCard(card) {
  const rect = canvas.getBoundingClientRect();
  viewport = { ...viewport, x: rect.width / 2 - (card.x + 112) * viewport.zoom, y: rect.height / 2 - (card.y + 80) * viewport.zoom };
  renderViewport();
}
function fitBoard() {
  viewport = fitViewport(history.present.cards, canvas.clientWidth, canvas.clientHeight, { padding: 72 });
  renderViewport();
}
function addLead(type) {
  const point = screenToWorld(viewport, canvas.clientWidth / 2, canvas.clientHeight / 2);
  const offset = (history.present.cards.length % 5) * 18;
  const { board, card } = addCard(history.present, {
    type, title: `New ${CARD_TYPES[type].label.toLowerCase()}`,
    x: Math.round(point.x - 112 + offset), y: Math.round(point.y - 80 + offset),
  });
  selected = new Set([card.id]); selectedLink = null;
  setMode("select"); commit(board);
  $("#card-title")?.focus(); $("#card-title")?.select();
}
function selectCard(id, additive = false) {
  selectedLink = null;
  if (additive) {
    selected = new Set(selected);
    if (selected.has(id)) selected.delete(id); else selected.add(id);
  } else selected = new Set([id]);
  render();
}

// Canvas interactions: dragging uses one history entry, not one per pointer event.
canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 && event.button !== 1) return;
  const cardElement = event.target.closest(".card");
  const linkElement = event.target.closest(".link");
  if (linkElement && !cardElement && mode === "select" && !spaceDown) {
    selected = new Set(); selectedLink = linkElement.dataset.linkId; render(); return;
  }
  if (cardElement && mode !== "pan" && !spaceDown && event.button === 0) {
    const id = cardElement.dataset.id;
    if (mode === "connect") {
      if (!connectingFrom) connectingFrom = id;
      else if (connectingFrom !== id) {
        const result = connect(history.present, connectingFrom, id);
        connectingFrom = null;
        if (result.link) { selected = new Set(); selectedLink = result.link.id; commit(result.board); }
        else render();
      } else { connectingFrom = null; render(); }
      renderMeta(); renderCards(); return;
    }
    if (!selected.has(id) || event.shiftKey) selectCard(id, event.shiftKey);
    if (!selected.has(id)) return;
    // Raise the clicked card without creating a separate undo step.
    const base = history.present;
    const front = bringToFront(base, id);
    history = replacePresent(history, front);
    gesture = { type: "card", startX: event.clientX, startY: event.clientY, base,
      ids: [...selected], moved: false, front };
    event.preventDefault(); return;
  }
  if (!cardElement && !linkElement && mode === "select" && !spaceDown && event.button === 0) {
    selected = new Set(); selectedLink = null; render();
  }
  if (!cardElement || mode === "pan" || spaceDown || event.button === 1) {
    gesture = { type: "pan", startX: event.clientX, startY: event.clientY, base: viewport };
    canvas.classList.add("is-panning"); event.preventDefault();
  }
});
window.addEventListener("pointermove", (event) => {
  if (!gesture) return;
  const dx = event.clientX - gesture.startX, dy = event.clientY - gesture.startY;
  if (gesture.type === "pan") {
    viewport = panViewport(gesture.base, dx, dy);
    renderViewport();
  } else {
    if (Math.abs(dx) + Math.abs(dy) > 2) gesture.moved = true;
    history = replacePresent(history, moveCards(gesture.front, gesture.ids, dx / viewport.zoom, dy / viewport.zoom));
    renderLinks(); renderCards(); renderMinimap();
  }
});
window.addEventListener("pointerup", () => {
  if (!gesture) return;
  if (gesture.type === "card") {
    history = commitFrom(history, gesture.base, history.present);
    if (history.present !== gesture.base) persist();
    render();
  }
  gesture = null; canvas.classList.remove("is-panning");
});
window.addEventListener("blur", () => { if (gesture) { gesture = null; canvas.classList.remove("is-panning"); render(); } });
canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  viewport = zoomAt(viewport, Math.exp(-event.deltaY * 0.0015), event.clientX - rect.left, event.clientY - rect.top);
  renderViewport();
}, { passive: false });

// Controls and keyboard shortcuts.
document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
document.querySelectorAll("[data-add]").forEach((button) => button.addEventListener("click", () => addLead(button.dataset.add)));
$("#undo-button").addEventListener("click", () => changeHistory(undo(history)));
$("#redo-button").addEventListener("click", () => changeHistory(redo(history)));
$("#zoom-in").addEventListener("click", () => { viewport = zoomAt(viewport, 1.2, canvas.clientWidth / 2, canvas.clientHeight / 2); renderViewport(); });
$("#zoom-out").addEventListener("click", () => { viewport = zoomAt(viewport, 1 / 1.2, canvas.clientWidth / 2, canvas.clientHeight / 2); renderViewport(); });
$("#zoom-fit").addEventListener("click", fitBoard);
$("#export-button").addEventListener("click", () => {
  const blob = new Blob([serializeBoard(history.present)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${history.present.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "detective-board"}.json`;
  link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});
$("#import-button").addEventListener("click", () => importInput.click());
importInput.addEventListener("change", async () => {
  const file = importInput.files?.[0];
  if (!file) return;
  try {
    const next = parseBoard(await file.text());
    selected = new Set(); selectedLink = null;
    commit(next); fitBoard();
  } catch (error) { alert(`Could not import this board: ${error.message}`); }
  importInput.value = "";
});
$("#reset-button").addEventListener("click", () => {
  if (!confirm("Replace this board with the sample investigation? You can undo this action.")) return;
  selected = new Set(); selectedLink = null;
  commit(makeDemoBoard()); fitBoard();
});
$("#case-title").addEventListener("click", () => {
  const title = prompt("Case name", history.present.title);
  if (title?.trim()) commit({ ...history.present, title: title.trim() });
});
searchInput.addEventListener("input", () => { query = searchInput.value; renderMeta(); renderCards(); });
searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    const id = searchCards(history.present, query).values().next().value;
    if (id) { selectCard(id); centerOnCard(getCard(history.present, id)); searchInput.blur(); }
  }
  if (event.key === "Escape") { searchInput.value = ""; query = ""; searchInput.blur(); render(); }
});
inspector.addEventListener("click", (event) => {
  if (event.target.closest(".close-inspector")) { selected = new Set(); selectedLink = null; render(); }
  if (event.target.closest("#delete-card")) { commit(removeCards(history.present, selected)); selected = new Set(); render(); }
  if (event.target.closest("#delete-link")) { commit(removeLinks(history.present, [selectedLink])); selectedLink = null; render(); }
  const related = event.target.closest("[data-related]");
  if (related) { selectCard(related.dataset.related); centerOnCard(getCard(history.present, related.dataset.related)); }
});
inspector.addEventListener("change", (event) => {
  const id = [...selected][0];
  if (event.target.id === "card-type" && id) commit(updateCard(history.present, id, { type: event.target.value }));
});
// Text fields update the canvas live; the entire edit becomes one undo step on blur.
let editBase = null;
inspector.addEventListener("focusin", (event) => {
  if (["card-title", "card-body", "link-label"].includes(event.target.id)) editBase = history.present;
});
inspector.addEventListener("input", (event) => {
  const id = [...selected][0];
  if (event.target.id === "card-title" && id) history = replacePresent(history, updateCard(history.present, id, { title: event.target.value }));
  else if (event.target.id === "card-body" && id) history = replacePresent(history, updateCard(history.present, id, { body: event.target.value }));
  else if (event.target.id === "link-label" && selectedLink) history = replacePresent(history, updateLink(history.present, selectedLink, event.target.value));
  else return;
  renderLinks(); renderCards(); renderMeta();
});
inspector.addEventListener("focusout", (event) => {
  if (!["card-title", "card-body", "link-label"].includes(event.target.id) || !editBase) return;
  history = commitFrom(history, editBase, history.present);
  if (editBase !== history.present) persist();
  editBase = null; render();
});
$("#minimap-svg").addEventListener("click", (event) => {
  const svg = event.currentTarget, rect = svg.getBoundingClientRect();
  const worldX = Number(svg.dataset.left) + (event.clientX - rect.left) / Number(svg.dataset.scale);
  const worldY = Number(svg.dataset.top) + (event.clientY - rect.top) / Number(svg.dataset.scale);
  viewport = { ...viewport, x: canvas.clientWidth / 2 - worldX * viewport.zoom, y: canvas.clientHeight / 2 - worldY * viewport.zoom };
  renderViewport();
});
window.addEventListener("keydown", (event) => {
  const editing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
  const mod = event.metaKey || event.ctrlKey;
  if (mod && event.key.toLowerCase() === "k") { event.preventDefault(); searchInput.focus(); searchInput.select(); return; }
  if (mod && event.key.toLowerCase() === "z" && !editing) { event.preventDefault(); changeHistory(event.shiftKey ? redo(history) : undo(history)); return; }
  if (mod && event.key.toLowerCase() === "y" && !editing) { event.preventDefault(); changeHistory(redo(history)); return; }
  if (editing) return;
  if (event.code === "Space") { event.preventDefault(); if (!spaceDown) { spaceDown = true; renderMeta(); } }
  if (event.key === "Escape") { selected = new Set(); selectedLink = null; connectingFrom = null; setMode("select"); }
  if (event.key === "Delete" || event.key === "Backspace") {
    if (selected.size) { const next = removeCards(history.present, selected); selected = new Set(); commit(next); }
    else if (selectedLink) { const next = removeLinks(history.present, [selectedLink]); selectedLink = null; commit(next); }
  }
  if (event.key.toLowerCase() === "v") setMode("select");
  if (event.key.toLowerCase() === "h") setMode("pan");
  if (event.key.toLowerCase() === "c") setMode("connect");
  if (event.key === "0") fitBoard();
});
window.addEventListener("keyup", (event) => { if (event.code === "Space") { spaceDown = false; renderMeta(); } });
window.addEventListener("resize", renderViewport);

render();
