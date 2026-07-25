/* A Klondike solver, used to guarantee a deal can actually be won.

   It searches for a concrete winning line, so a "winnable" verdict is a
   proof rather than an estimate. Two things keep it tractable on a phone:

   - Turning the deck is never a move on its own. Instead the generator
     works out which cards can reach the top of the waste and offers
     "turn the deck N times, then play that card" as a single step, which
     removes the long chains of pure drawing that swamp a naive search.
   - The frontier is explored best-first, chasing positions with more cards
     home and fewer face-down cards rather than grinding depth-first.

   It never pulls cards back off a foundation, so it is incomplete: a deal
   winnable only by retrieving one is reported unsolvable. That is the safe
   direction — the deal picker only ever accepts a proven win. */
var Solver = (function () {
  'use strict';

  var WIN = 'win';
  var UNSOLVABLE = 'unsolvable';
  var UNKNOWN = 'unknown';          // budget ran out before deciding

  var SUIT_IDS = ['S', 'H', 'D', 'C'];

  function code(card) { return SUIT_IDS.indexOf(card.s) * 13 + (card.r - 1); }
  function suitOf(c) { return (c / 13) | 0; }
  function rankOf(c) { return (c % 13) + 1; }
  function isRed(c) { var s = suitOf(c); return s === 1 || s === 2; }

  /* ---- state ------------------------------------------------------------
     columns[i] = { down: [codes], up: [codes] }
     foundations[suit] = highest rank played, 0 when empty
     stock / waste = arrays of codes; the stock is drawn from the end     */

  function fromGame(game) {
    var foundations = [0, 0, 0, 0];
    game.foundations.forEach(function (pile) {
      pile.forEach(function (card) { foundations[suitOf(code(card))] = card.r; });
    });
    return {
      columns: game.tableau.map(function (pile) {
        var down = [], up = [];
        pile.forEach(function (card) { (card.up ? up : down).push(code(card)); });
        return { down: down, up: up };
      }),
      foundations: foundations,
      stock: game.stock.map(code),
      waste: game.waste.map(code),
      drawCount: game.drawCount === 3 ? 3 : 1
    };
  }

  function copy(state) {
    var columns = [];
    for (var i = 0; i < 7; i++) {
      columns.push({ down: state.columns[i].down.slice(), up: state.columns[i].up.slice() });
    }
    return {
      columns: columns,
      foundations: state.foundations.slice(),
      stock: state.stock.slice(),
      waste: state.waste.slice(),
      drawCount: state.drawCount
    };
  }

  /* Columns are interchangeable, so sorting them folds equivalent
     positions onto one key. */
  function keyOf(state) {
    var parts = [];
    for (var i = 0; i < 7; i++) {
      parts.push(state.columns[i].down.join('.') + '|' + state.columns[i].up.join('.'));
    }
    parts.sort();
    return parts.join(',') + '#' + state.foundations.join('.') +
           '#' + state.stock.join('.') + '/' + state.waste.join('.');
  }

  function foundationTotal(state) {
    var f = state.foundations;
    return f[0] + f[1] + f[2] + f[3];
  }

  function isWon(state) { return foundationTotal(state) === 52; }

  function canPlaceOnFoundation(state, card) {
    return state.foundations[suitOf(card)] === rankOf(card) - 1;
  }

  function canPlaceOnColumn(state, card, columnIndex) {
    var col = state.columns[columnIndex];
    if (!col.up.length) return col.down.length ? false : rankOf(card) === 13;
    var top = col.up[col.up.length - 1];
    return rankOf(top) === rankOf(card) + 1 && isRed(top) !== isRed(card);
  }

  /* Safe to send home when nothing still in play could need it: both
     opposite colours are already up to at least one rank below. */
  function isSafeToAutoPlay(state, card) {
    var rank = rankOf(card);
    if (rank <= 2) return true;
    var f = state.foundations;
    return isRed(card)
      ? (f[0] >= rank - 1 && f[3] >= rank - 1)
      : (f[1] >= rank - 1 && f[2] >= rank - 1);
  }

  function flip(column) {
    if (!column.up.length && column.down.length) column.up.push(column.down.pop());
  }

  /* Plays the moves no sensible line would decline, before branching. */
  function autoPlay(state) {
    var moved = true;
    while (moved) {
      moved = false;
      for (var i = 0; i < 7; i++) {
        var up = state.columns[i].up;
        if (!up.length) continue;
        var card = up[up.length - 1];
        if (canPlaceOnFoundation(state, card) && isSafeToAutoPlay(state, card)) {
          up.pop();
          state.foundations[suitOf(card)] = rankOf(card);
          flip(state.columns[i]);
          moved = true;
        }
      }
      if (state.waste.length) {
        var top = state.waste[state.waste.length - 1];
        if (canPlaceOnFoundation(state, top) && isSafeToAutoPlay(state, top)) {
          state.waste.pop();
          state.foundations[suitOf(top)] = rankOf(top);
          moved = true;
        }
      }
    }
  }

  function advanceDeck(stock, waste, drawCount) {
    if (!stock.length) {
      while (waste.length) stock.push(waste.pop());
    } else {
      var count = Math.min(drawCount, stock.length);
      for (var i = 0; i < count; i++) waste.push(stock.pop());
    }
  }

  /* ---- move generation --------------------------------------------------- */

  function generate(state) {
    var list = [];
    var i, j, n;

    for (i = 0; i < 7; i++) {
      var col = state.columns[i];
      if (!col.up.length) continue;

      var top = col.up[col.up.length - 1];
      if (canPlaceOnFoundation(state, top)) list.push({ kind: 'cf', from: i, score: 95 });

      /* Only two column moves are worth branching on: shifting the whole
         face-up run (which turns a card over or clears a column), and
         splitting a run when that frees the card beneath for a foundation.
         Anything else just rearranges the board. */
      var reveals = col.down.length > 0;
      for (j = 0; j < 7; j++) {
        if (j === i) continue;
        var target = state.columns[j];
        var targetEmpty = !target.up.length && !target.down.length;
        if (!reveals && targetEmpty) continue;          // pointless relocation
        if (!canPlaceOnColumn(state, col.up[0], j)) continue;
        list.push({ kind: 'cc', from: i, at: 0, to: j, score: reveals ? 88 : 40 });
      }

      for (n = 1; n < col.up.length; n++) {
        if (!canPlaceOnFoundation(state, col.up[n - 1])) continue;
        for (j = 0; j < 7; j++) {
          if (j === i) continue;
          if (!canPlaceOnColumn(state, col.up[n], j)) continue;
          list.push({ kind: 'cc', from: i, at: n, to: j, score: 75 });
          break;
        }
      }
    }

    /* Deck plays: how many turns bring a card up, and where it lands. */
    var stock = state.stock.slice();
    var waste = state.waste.slice();
    var total = stock.length + waste.length;
    if (total) {
      var seenTop = {};
      var draws = 0;
      var limit = total + 2;
      for (var step = 0; step <= limit; step++) {
        if (waste.length) {
          var card = waste[waste.length - 1];
          if (!seenTop[card]) {
            seenTop[card] = true;
            if (canPlaceOnFoundation(state, card)) {
              list.push({ kind: 'df', draws: draws, score: 90 - draws * 0.1 });
            }
            for (j = 0; j < 7; j++) {
              if (canPlaceOnColumn(state, card, j)) {
                list.push({ kind: 'dc', draws: draws, to: j, score: 70 - draws * 0.1 });
                break;
              }
            }
          }
        }
        if (!stock.length && !waste.length) break;
        advanceDeck(stock, waste, state.drawCount);
        draws += 1;
      }
    }

    list.sort(function (a, b) { return b.score - a.score; });
    return list;
  }

  function apply(state, move) {
    var card, i;
    switch (move.kind) {
      case 'cf':
        card = state.columns[move.from].up.pop();
        state.foundations[suitOf(card)] = rankOf(card);
        flip(state.columns[move.from]);
        break;
      case 'cc':
        var run = state.columns[move.from].up.splice(move.at);
        for (i = 0; i < run.length; i++) state.columns[move.to].up.push(run[i]);
        flip(state.columns[move.from]);
        break;
      case 'df':
      case 'dc':
        for (i = 0; i < move.draws; i++) advanceDeck(state.stock, state.waste, state.drawCount);
        card = state.waste.pop();
        if (move.kind === 'df') state.foundations[suitOf(card)] = rankOf(card);
        else state.columns[move.to].up.push(card);
        break;
    }
  }

  /* ---- search ------------------------------------------------------------ */

  /* Depth-first, best move first, with a transposition table. A winning line
     is deep, and the ordering above puts the moves that make real progress
     first, so wins surface early when they exist at all. */
  function solve(game, options) {
    options = options || {};
    var maxNodes = options.maxNodes || 30000;
    var maxDepth = options.maxDepth || 300;
    var deadline = options.deadline || 0;

    var seen = {};
    var nodes = 0;
    var truncated = false;
    var line = [];
    var deepest = 0;
    var branches = 0;

    function search(state, depth) {
      if (isWon(state)) return true;
      if (depth <= 0) { truncated = true; return false; }
      if (nodes >= maxNodes) { truncated = true; return false; }
      if (deadline && (nodes & 127) === 0 && Date.now() > deadline) { truncated = true; return false; }
      nodes += 1;
      if (line.length > deepest) deepest = line.length;

      var key = keyOf(state);
      if (seen[key]) return false;
      seen[key] = true;

      var moves = generate(state);
      branches += moves.length;
      for (var i = 0; i < moves.length; i++) {
        var next = copy(state);
        apply(next, moves[i]);
        autoPlay(next);
        line.push(moves[i]);
        if (search(next, depth - 1)) return true;
        line.pop();
        if (nodes >= maxNodes) { truncated = true; break; }
      }
      return false;
    }

    var start = fromGame(game);
    autoPlay(start);
    var won = search(start, maxDepth);

    return {
      result: won ? WIN : (truncated ? UNKNOWN : UNSOLVABLE),
      nodes: nodes,
      deepest: deepest,
      branching: nodes ? branches / nodes : 0,
      line: won ? line.slice() : null
    };
  }

  return {
    solve: solve,
    WIN: WIN,
    UNSOLVABLE: UNSOLVABLE,
    UNKNOWN: UNKNOWN
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Solver;
