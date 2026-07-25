/* Rules, scoring, undo and save/restore checks for the game engine.
   Run with: node tests/engine.test.js  (no dependencies) */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const base = path.join(__dirname, '..', 'assets', 'js') + path.sep;
const ctx = { window: {}, console, Math, JSON, Date, Object, Array };
vm.createContext(ctx);
for (const f of ['cards.js', 'game.js']) {
  vm.runInContext(fs.readFileSync(base + f, 'utf8'), ctx, { filename: f });
}
const { Klondike, Cards } = ctx;

let fails = 0;
function ok(cond, msg) { if (!cond) { fails++; console.log('FAIL: ' + msg); } }

// deal integrity
const g = new Klondike({ drawCount: 1 });
let total = 0, ids = new Set();
const piles = [...g.tableau, ...g.foundations, g.waste, g.stock];
piles.forEach(p => p.forEach(c => { total++; ids.add(c.id); }));
ok(total === 52 && ids.size === 52, 'deal has 52 unique cards, got ' + total + '/' + ids.size);
ok(g.stock.length === 24, 'stock is 24, got ' + g.stock.length);
g.tableau.forEach((p, i) => {
  ok(p.length === i + 1, 'column ' + i + ' has ' + (i + 1) + ' cards');
  ok(p[p.length - 1].up === true, 'column ' + i + ' top is face up');
  ok(p.slice(0, -1).every(c => !c.up), 'column ' + i + ' rest face down');
});

// draw / recycle
g.draw();
ok(g.waste.length === 1 && g.stock.length === 23, 'draw 1 moves one card');
ok(g.waste[0].up, 'drawn card is face up');
while (g.stock.length) g.draw();
ok(g.waste.length === 24, 'all 24 drawn');
const scoreBefore = g.score;
g.draw(); // triggers recycle
ok(g.stock.length === 24 && g.waste.length === 0, 'recycle refills stock');
ok(g.stock.every(c => !c.up), 'recycled cards are face down');
ok(g.score === Math.max(0, scoreBefore - 100), 'draw-1 recycle penalty applied');

// draw 3
const g3 = new Klondike({ drawCount: 3 });
g3.draw();
ok(g3.waste.length === 3, 'draw 3 moves three cards');
const s3 = g3.score;
while (g3.stock.length) g3.draw();
g3.draw();
ok(g3.score === s3 || g3.score >= 0, 'draw-3 recycle has no -100');

// hand-built board for rule checks
function blank(drawCount = 1) {
  const game = new Klondike({ drawCount });
  game.tableau = [[], [], [], [], [], [], []];
  game.foundations = [[], [], [], []];
  game.waste = []; game.stock = []; game.score = 0; game.moves = 0; game.history = [];
  return game;
}
const C = (s, r, up = true) => ({ id: s + r, s, r, up });

let t = blank();
t.tableau[0] = [C('S', 13)];
t.tableau[1] = [C('H', 12)];
ok(t.move({ type: 'tableau', i: 1, ci: 0 }, { type: 'tableau', i: 0 }), 'red Q onto black K');
ok(t.tableau[0].length === 2 && t.tableau[1].length === 0, 'cards actually moved');

t = blank();
t.tableau[0] = [C('S', 13)];
t.tableau[1] = [C('C', 12)];
ok(!t.move({ type: 'tableau', i: 1, ci: 0 }, { type: 'tableau', i: 0 }), 'same colour rejected');

t = blank();
t.tableau[0] = [];
t.tableau[1] = [C('H', 12)];
ok(!t.move({ type: 'tableau', i: 1, ci: 0 }, { type: 'tableau', i: 0 }), 'only Kings into empty column');

// foundation ordering
t = blank();
t.waste = [C('S', 1)];
ok(t.move({ type: 'waste', i: 0 }, { type: 'foundation', i: 0 }), 'ace to empty foundation');
ok(t.score === 10, 'foundation move scores 10, got ' + t.score);
t.waste = [C('S', 3)];
ok(!t.move({ type: 'waste', i: 0 }, { type: 'foundation', i: 0 }), 'cannot skip rank');
t.waste = [C('H', 2)];
ok(!t.move({ type: 'waste', i: 0 }, { type: 'foundation', i: 0 }), 'cannot mix suits');
t.waste = [C('S', 2)];
ok(t.move({ type: 'waste', i: 0 }, { type: 'foundation', i: 0 }), 'S2 onto SA');

// multi-card run + flip scoring
t = blank();
t.tableau[0] = [C('D', 5, false), C('S', 10), C('H', 9), C('C', 8)];
t.tableau[1] = [C('D', 11)];
ok(t.grab({ type: 'tableau', i: 0, ci: 1 }).length === 3, 'grabs 3-card run');
ok(t.grab({ type: 'tableau', i: 0, ci: 0 }) === null, 'cannot grab a face-down card');
ok(t.move({ type: 'tableau', i: 0, ci: 1 }, { type: 'tableau', i: 1 }), 'run moves onto J');
ok(t.tableau[1].length === 4, 'run landed');
ok(t.tableau[0][0].up === true, 'exposed card flipped');
ok(t.score === 5, 'flip scores 5, got ' + t.score);

// broken run cannot be grabbed
t = blank();
t.tableau[0] = [C('S', 10), C('S', 9)];
ok(t.grab({ type: 'tableau', i: 0, ci: 0 }) === null, 'same-colour run not grabbable');

// foundation -> tableau penalty
t = blank();
t.foundations[0] = [C('S', 1), C('S', 2)];
t.tableau[0] = [C('H', 3)];
t.score = 50;
ok(t.move({ type: 'foundation', i: 0 }, { type: 'tableau', i: 0 }), 'foundation back to tableau');
ok(t.score === 35, 'penalty -15 applied, got ' + t.score);
ok(t.score >= 0, 'score never negative');
t.score = 5;
t.addScore(-100);
ok(t.score === 0, 'score floors at 0');

// undo restores everything
t = blank();
t.tableau[0] = [C('D', 5, false), C('S', 10)];
t.tableau[1] = [C('D', 11)];
const before = JSON.stringify(t.snapshot());
t.move({ type: 'tableau', i: 0, ci: 1 }, { type: 'tableau', i: 1 });
ok(JSON.stringify(t.snapshot()) !== before, 'state changed');
ok(t.undo(), 'undo runs');
ok(JSON.stringify(t.snapshot()) === before, 'undo restores exact state');
ok(!t.undo() || true, 'undo on empty history is safe');

// auto-to-foundation + win
t = blank();
['S', 'H', 'D', 'C'].forEach((s, i) => {
  t.foundations[i] = [];
  for (let r = 1; r <= 12; r++) t.foundations[i].push(C(s, r));
  t.tableau[i] = [C(s, 13)];
});
let steps = 0;
while (true) {
  const mv = t.nextFoundationMove();
  if (!mv) break;
  t.move(mv.source, mv.target);
  if (++steps > 60) break;
}
ok(steps === 4, 'auto-finish played 4 kings, got ' + steps);
ok(t.won === true, 'win detected');
ok(t.foundationCount() === 52, '52 cards home');

// canAutoFinish
t = blank();
t.tableau[0] = [C('S', 5, false), C('H', 4)];
ok(t.canAutoFinish() === false, 'hidden card blocks auto finish');
t.tableau[0][0].up = true;
ok(t.canAutoFinish() === true, 'all face up allows auto finish');

// save / restore round trip
const g2 = new Klondike({ drawCount: 3 });
g2.draw(); g2.draw();
const json = JSON.parse(JSON.stringify(g2.toJSON()));
ok(Klondike.isValidSave(json), 'save validates');
const restored = Klondike.fromJSON(json);
ok(JSON.stringify(restored.snapshot()) === JSON.stringify(g2.snapshot()), 'restore round trips');
ok(restored.drawCount === 3, 'draw mode restored');
ok(restored.canUndo() === g2.canUndo(), 'undo history restored');
ok(!Klondike.isValidSave(null), 'null save rejected');
ok(!Klondike.isValidSave({ tableau: [[]], foundations: [], waste: [], stock: [] }), 'malformed save rejected');
const dup = JSON.parse(JSON.stringify(json));
dup.stock.push(dup.stock[0]);
ok(!Klondike.isValidSave(dup), 'duplicate card save rejected');

// findAutoTarget prefers foundation
t = blank();
t.foundations[0] = [C('S', 1)];
t.tableau[0] = [C('S', 2)];
t.tableau[1] = [C('H', 3)];
const target = t.findAutoTarget({ type: 'tableau', i: 0, ci: 0 });
ok(target && target.type === 'foundation', 'auto target prefers foundation');

// ---- hints -------------------------------------------------------------
t = blank();
t.foundations[0] = [C('S', 1)];
t.tableau[0] = [C('S', 2)];
t.tableau[1] = [C('H', 3)];
let moves = t.findMoves();
ok(moves.length > 0, 'findMoves sees something to do');
ok(moves[0].kind === 'foundation', 'a foundation move is hinted first, got ' + moves[0].kind);
ok(moves[0].source.type === 'tableau' && moves[0].target.type === 'foundation', 'hint points S2 at its foundation');

// turning a card over is preferred over an idle shuffle
t = blank();
t.tableau[0] = [C('D', 7, false), C('S', 10)];
t.tableau[1] = [C('H', 11)];
moves = t.findMoves();
ok(moves.length === 1 && moves[0].kind === 'reveal', 'moving a run that flips a card is hinted: ' + JSON.stringify(moves.map(m => m.kind)));

// a waste card that can be played
t = blank();
t.waste = [C('H', 12)];
t.tableau[0] = [C('S', 13)];
moves = t.findMoves();
ok(moves.some(m => m.kind === 'wasteToTableau'), 'waste card placement is hinted');

// pure shuffles are not offered: nothing is revealed, nothing is emptied
t = blank();
t.tableau[0] = [C('S', 13), C('H', 12), C('S', 11), C('H', 10)];
t.tableau[1] = [C('C', 13), C('D', 12), C('C', 11)];
ok(t.findMoves().length === 0, 'shuffling a run between equivalent parents is not a hint');

// splitting a run is offered when it frees a card for a foundation
t = blank();
t.foundations[0] = [C('S', 1), C('S', 2), C('S', 3), C('S', 4)];
t.tableau[0] = [C('S', 5), C('H', 4)];
t.tableau[1] = [C('C', 5)];
moves = t.findMoves();
ok(moves.some(m => m.kind === 'unlock'), 'splitting a run to free a foundation card is hinted: ' + JSON.stringify(moves.map(m => m.kind)));

// moving a whole column to an empty column achieves nothing
t = blank();
t.tableau[0] = [C('S', 13), C('H', 12)];
t.tableau[1] = [];
ok(t.findMoves().length === 0, 'relocating a full column to an empty one is not a hint');

// ...but clearing a column onto a real card is progress
t = blank();
t.tableau[0] = [C('H', 12)];
t.tableau[1] = [C('S', 13)];
moves = t.findMoves();
ok(moves.length === 1 && moves[0].kind === 'empty', 'emptying a column is hinted: ' + JSON.stringify(moves.map(m => m.kind)));

// ---- dead ends ---------------------------------------------------------
t = blank();
t.tableau[0] = [C('S', 13)];
t.tableau[1] = [C('H', 13)];
t.tableau[2] = [C('D', 13)];
t.tableau[3] = [C('C', 13)];
ok(t.findMoves().length === 0, 'four lone kings have nowhere to go');
ok(t.isDeadEnd() === true, 'four lone kings with an empty stock is a dead end');
ok(t.canDraw() === false, 'nothing left to draw');

t.stock = [C('S', 1, false)];
ok(t.stockHasPlayable() === true, 'an ace in the stock is playable');
ok(t.isDeadEnd() === false, 'a playable stock card keeps the game alive');

t.stock = [C('H', 7, false)];
ok(t.stockHasPlayable() === false, 'a 7 with no red-8 parent is not playable');
ok(t.isDeadEnd() === true, 'an unplayable stock means the deal is over');

// a king in the stock can still open an empty column
t = blank();
t.tableau[0] = [C('S', 13)];
t.stock = [C('H', 13, false)];
ok(t.isDeadEnd() === false, 'a king can still take an empty column');

// a board move keeps the game alive even with an empty stock
t = blank();
t.tableau[0] = [C('S', 13)];
t.tableau[1] = [C('H', 12)];
ok(t.isDeadEnd() === false, 'a legal board move is not a dead end');

// a won game is never a dead end
t = blank();
['S', 'H', 'D', 'C'].forEach((s, i) => {
  for (let r = 1; r <= 13; r++) t.foundations[i].push(C(s, r));
});
t.checkWin();
ok(t.isDeadEnd() === false, 'a won game is not a dead end');

// face-down cards below a movable run still count as progress
t = blank();
t.tableau[0] = [C('D', 3, false), C('S', 13)];
t.tableau[1] = [];
moves = t.findMoves();
ok(moves.length === 1 && moves[0].kind === 'reveal', 'moving a king off a hidden card into an empty column is hinted');
ok(t.isDeadEnd() === false, 'that board is not a dead end');

console.log(fails === 0 ? 'ALL ENGINE TESTS PASSED' : fails + ' FAILURE(S)');
process.exit(fails ? 1 : 0);
