/* Checks that the solver's verdict means what it claims.

   A "winnable" result comes with a concrete line of play. This replays that
   line through the real game engine, move by move, and insists the engine
   itself reports a win at the end. If the solver's rules ever drift from the
   game's, this fails.

   Run with: node tests/solver.test.js */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const base = path.join(__dirname, '..', 'assets', 'js') + path.sep;

const ctx = { window: {}, console, Math, JSON, Date, Object, Array, String };
vm.createContext(ctx);
for (const f of ['cards.js', 'game.js', 'solver.js']) {
  vm.runInContext(fs.readFileSync(base + f, 'utf8'), ctx, { filename: f });
}
const { Klondike, Cards, Solver } = ctx;

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL: ' + msg); } };

/* ---- replaying a solver line on the real engine ------------------------ */

function foundationFor(game, card) {
  for (let f = 0; f < 4; f++) {
    if (Cards.canStackFoundation(card, game.foundations[f])) return f;
  }
  return -1;
}

/* The solver sends a card home without branching when both opposite colours
   are already one rank below it. The replay has to do the same, because the
   recorded line skips those moves. */
function safeToAutoPlay(game, card) {
  if (card.r <= 2) return true;
  const rank = {};
  game.foundations.forEach(pile => {
    if (pile.length) rank[pile[pile.length - 1].s] = pile[pile.length - 1].r;
  });
  const opposite = Cards.isRed(card) ? ['S', 'C'] : ['H', 'D'];
  return (rank[opposite[0]] || 0) >= rank_needed(card) && (rank[opposite[1]] || 0) >= rank_needed(card);
}

function rank_needed(card) { return card.r - 1; }

function autoPlay(game) {
  let moved = true;
  while (moved) {
    moved = false;
    for (let c = 0; c < 7; c++) {
      const pile = game.tableau[c];
      if (!pile.length) continue;
      const card = pile[pile.length - 1];
      if (!card.up) continue;
      const f = foundationFor(game, card);
      if (f >= 0 && safeToAutoPlay(game, card)) {
        if (!game.move({ type: 'tableau', i: c, ci: pile.length - 1 }, { type: 'foundation', i: f })) {
          throw new Error('engine refused an auto-play from the tableau');
        }
        moved = true;
      }
    }
    if (game.waste.length) {
      const card = game.waste[game.waste.length - 1];
      const f = foundationFor(game, card);
      if (f >= 0 && safeToAutoPlay(game, card)) {
        if (!game.move({ type: 'waste', i: 0 }, { type: 'foundation', i: f })) {
          throw new Error('engine refused an auto-play from the waste');
        }
        moved = true;
      }
    }
  }
}

function firstFaceUp(pile) {
  let i = 0;
  while (i < pile.length && !pile[i].up) i++;
  return i;
}

/* Replays one solver move; throws if the engine rejects it. */
function playMove(game, move) {
  if (move.kind === 'cf') {
    const pile = game.tableau[move.from];
    const card = pile[pile.length - 1];
    const f = foundationFor(game, card);
    if (f < 0) throw new Error('cf: no foundation accepts ' + card.id);
    if (!game.move({ type: 'tableau', i: move.from, ci: pile.length - 1 }, { type: 'foundation', i: f })) {
      throw new Error('cf rejected for ' + card.id);
    }
    return;
  }

  if (move.kind === 'cc') {
    // the solver indexes into the face-up part; the engine indexes the column
    const ci = firstFaceUp(game.tableau[move.from]) + move.at;
    if (!game.move({ type: 'tableau', i: move.from, ci: ci }, { type: 'tableau', i: move.to })) {
      throw new Error('cc rejected: column ' + move.from + ' at ' + move.at + ' -> ' + move.to);
    }
    return;
  }

  if (move.kind === 'df' || move.kind === 'dc') {
    for (let n = 0; n < move.draws; n++) {
      if (!game.draw()) throw new Error('draw rejected after ' + n + ' of ' + move.draws);
    }
    if (!game.waste.length) throw new Error('nothing in the waste to play');
    const card = game.waste[game.waste.length - 1];
    if (move.kind === 'df') {
      const f = foundationFor(game, card);
      if (f < 0) throw new Error('df: no foundation accepts ' + card.id);
      if (!game.move({ type: 'waste', i: 0 }, { type: 'foundation', i: f })) {
        throw new Error('df rejected for ' + card.id);
      }
    } else if (!game.move({ type: 'waste', i: 0 }, { type: 'tableau', i: move.to })) {
      throw new Error('dc rejected: ' + card.id + ' -> column ' + move.to);
    }
    return;
  }

  throw new Error('unknown move kind ' + move.kind);
}

function replay(game, line) {
  autoPlay(game);
  for (let i = 0; i < line.length; i++) {
    playMove(game, line[i]);
    autoPlay(game);
  }
  return game.won;
}

/* ---- the test ---------------------------------------------------------- */

for (const drawCount of [1, 3]) {
  let proven = 0, replayed = 0, rejected = 0, unproven = 0;
  const deals = 40;

  for (let n = 0; n < deals; n++) {
    const game = new Klondike({ drawCount });
    const before = JSON.parse(JSON.stringify(game.toJSON()));
    const result = Solver.solve(game, { maxNodes: 40000 });

    if (result.result !== Solver.WIN) { unproven++; continue; }
    proven++;

    // the solver must not have disturbed the deal it was handed
    ok(JSON.stringify(game.toJSON().tableau) === JSON.stringify(before.tableau),
       'solving left the deal untouched');

    const fresh = Klondike.fromJSON(JSON.parse(JSON.stringify(before)));
    try {
      if (replay(fresh, result.line)) replayed++;
      else { rejected++; console.log('FAIL: line ran out without winning (draw-' + drawCount + ')'); }
    } catch (e) {
      rejected++;
      console.log('FAIL: engine rejected the solver line (draw-' + drawCount + '): ' + e.message);
    }
  }

  ok(rejected === 0, 'draw-' + drawCount + ': every winning line replays on the engine, rejected=' + rejected);
  ok(proven >= deals * 0.4, 'draw-' + drawCount + ': solver proves a useful share of deals, ' + proven + '/' + deals);
  console.log(`draw-${drawCount}: proven ${proven}/${deals}, replayed to a win ${replayed}, rejected ${rejected}, unproven ${unproven}`);
}

/* An unwinnable deal must never be reported as a win. */
const rigged = new Klondike({ drawCount: 1 });
rigged.tableau = [[], [], [], [], [], [], []];
rigged.foundations = [[], [], [], []];
rigged.waste = [];
rigged.stock = [];
const mk = (s, r, up) => ({ id: s + r, s, r, up });
// four kings face up, nothing else anywhere: no legal move at all
['S', 'H', 'D', 'C'].forEach((s, i) => { rigged.tableau[i] = [mk(s, 13, true)]; });
const deadResult = Solver.solve(rigged, { maxNodes: 5000 });
ok(deadResult.result !== Solver.WIN, 'a board with no moves is never called winnable');

console.log(fails === 0 ? '\nALL SOLVER TESTS PASSED' : '\n' + fails + ' FAILURE(S)');
process.exit(fails ? 1 : 0);
