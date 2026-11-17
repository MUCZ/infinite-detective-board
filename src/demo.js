import { createBoard, addCard, connect } from "./board.js";

export function makeDemoBoard() {
  let board = createBoard("The Vanishing at Blackwell");
  const cards = [
    { id: "case", type: "clue", title: "The Blackwell file", body: "A missing person. A locked gallery. One night that doesn't add up.", x: 455, y: 300 },
    { id: "victim", type: "suspect", title: "Evelyn Hart", body: "Gallery curator  ·  Last seen 11:42 PM", x: 120, y: 80 },
    { id: "witness", type: "suspect", title: "Marcus Vale", body: "Security guard  ·  Changed his statement", x: 850, y: 50 },
    { id: "key", type: "evidence", title: "The brass key", body: "Found beneath the east stairwell. No matching lock on record.", x: 70, y: 435 },
    { id: "gallery", type: "location", title: "Blackwell Gallery", body: "East wing  ·  Camera 04 went dark", x: 835, y: 435 },
    { id: "timeline", type: "note", title: "A missing 17 minutes", body: "The security log jumps from 11:42 to 11:59. Who had access to the control room?", x: 350, y: 650 },
    { id: "receipt", type: "evidence", title: "Unmarked receipt", body: "A cash payment at 12:06 AM, two blocks away. Initials: M.V.", x: 1110, y: 250 },
    { id: "question", type: "note", title: "Working theory", body: "The blackout wasn't a failure. It was a window.", x: 820, y: 735 },
  ];
  for (const card of cards) board = addCard(board, card).board;
  for (const [from, to, label] of [
    ["victim", "case", "last seen"], ["witness", "case", "on duty"],
    ["key", "case", "found near"], ["gallery", "case", "scene"],
    ["case", "timeline", "time gap"], ["witness", "receipt", "initials match"],
    ["gallery", "receipt", "two blocks"], ["timeline", "question", "suggests"],
  ]) board = connect(board, from, to, label).board;
  return board;
}
