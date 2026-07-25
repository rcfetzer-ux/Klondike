/* Klondike game engine: piles, legal moves, scoring, undo and save/restore.
   Pure state — it knows nothing about the DOM. */
var Klondike = (function () {
  'use strict';

  var SCORE = {
    wasteToTableau: 5,
    toFoundation: 10,
    turnOver: 5,
    foundationToTableau: -15,
    recycle: -100        // draw-1 games only
  };

  var MAX_HISTORY = 200;
  var SAVED_HISTORY = 30;   // how much undo depth survives a reload

  function Game(options) {
    options = options || {};
    this.drawCount = options.drawCount === 3 ? 3 : 1;
    this.history = [];
    this.deal();
  }

  Game.prototype.deal = function () {
    var deck = Cards.shuffle(Cards.makeDeck());
    this.tableau = [[], [], [], [], [], [], []];
    this.foundations = [[], [], [], []];
    this.waste = [];
    this.stock = [];

    for (var col = 0; col < 7; col++) {
      for (var n = 0; n <= col; n++) {
        var card = deck.pop();
        card.up = (n === col);
        this.tableau[col].push(card);
      }
    }
    this.stock = deck;
    this.stock.forEach(function (c) { c.up = false; });

    this.score = 0;
    this.moves = 0;
    this.elapsed = 0;
    this.passes = 0;
    this.won = false;
    this.started = Date.now();
    this.history = [];
  };

  /* ---- pile access ---------------------------------------------------- */

  Game.prototype.pile = function (ref) {
    switch (ref.type) {
      case 'tableau': return this.tableau[ref.i];
      case 'foundation': return this.foundations[ref.i];
      case 'waste': return this.waste;
      case 'stock': return this.stock;
    }
    return null;
  };

  /* The face-up run starting at ref, if it can legally be picked up. */
  Game.prototype.grab = function (ref) {
    var pile = this.pile(ref);
    if (!pile || !pile.length) return null;

    if (ref.type === 'waste' || ref.type === 'foundation') {
      var top = pile[pile.length - 1];
      return top.up ? [top] : null;
    }
    if (ref.type !== 'tableau') return null;

    var index = ref.ci === undefined ? pile.length - 1 : ref.ci;
    if (index < 0 || index >= pile.length) return null;
    var run = pile.slice(index);
    return Cards.isValidRun(run) ? run : null;
  };

  Game.prototype.canDrop = function (cards, target) {
    if (!cards || !cards.length) return false;
    if (target.type === 'foundation') {
      if (cards.length !== 1) return false;
      return Cards.canStackFoundation(cards[0], this.foundations[target.i]);
    }
    if (target.type === 'tableau') {
      var pile = this.tableau[target.i];
      return Cards.canStackTableau(cards[0], pile.length ? pile[pile.length - 1] : null);
    }
    return false;
  };

  /* ---- moves ---------------------------------------------------------- */

  Game.prototype.pushHistory = function () {
    this.history.push(this.snapshot());
    if (this.history.length > MAX_HISTORY) this.history.shift();
  };

  Game.prototype.move = function (source, target) {
    if (source.type === target.type && source.i === target.i) return false;
    var cards = this.grab(source);
    if (!cards || !this.canDrop(cards, target)) return false;

    this.pushHistory();

    var from = this.pile(source);
    from.splice(from.length - cards.length, cards.length);
    var to = this.pile(target);
    cards.forEach(function (c) { to.push(c); });

    var gain = 0;
    if (target.type === 'foundation') gain += SCORE.toFoundation;
    else if (source.type === 'waste') gain += SCORE.wasteToTableau;
    if (source.type === 'foundation' && target.type === 'tableau') gain += SCORE.foundationToTableau;

    if (source.type === 'tableau') {
      var top = from[from.length - 1];
      if (top && !top.up) { top.up = true; gain += SCORE.turnOver; }
    }

    this.addScore(gain);
    this.moves += 1;
    this.checkWin();
    return true;
  };

  Game.prototype.draw = function () {
    if (!this.stock.length) return this.recycle();
    this.pushHistory();
    var count = Math.min(this.drawCount, this.stock.length);
    for (var i = 0; i < count; i++) {
      var card = this.stock.pop();
      card.up = true;
      this.waste.push(card);
    }
    this.moves += 1;
    return true;
  };

  Game.prototype.recycle = function () {
    if (!this.waste.length) return false;
    this.pushHistory();
    while (this.waste.length) {
      var card = this.waste.pop();
      card.up = false;
      this.stock.push(card);
    }
    this.passes += 1;
    if (this.drawCount === 1) this.addScore(SCORE.recycle);
    this.moves += 1;
    return true;
  };

  Game.prototype.addScore = function (delta) {
    this.score = Math.max(0, this.score + delta);
  };

  /* Where would this card go on its own? Foundation first, then a tableau. */
  Game.prototype.findAutoTarget = function (source) {
    var cards = this.grab(source);
    if (!cards) return null;
    var i;
    if (cards.length === 1 && source.type !== 'foundation') {
      for (i = 0; i < 4; i++) {
        if (this.canDrop(cards, { type: 'foundation', i: i })) return { type: 'foundation', i: i };
      }
    }
    for (i = 0; i < 7; i++) {
      if (source.type === 'tableau' && source.i === i) continue;
      // Moving a whole column onto an empty one gains nothing.
      if (!this.tableau[i].length && source.type === 'tableau' && source.ci === 0) continue;
      if (this.canDrop(cards, { type: 'tableau', i: i })) return { type: 'tableau', i: i };
    }
    return null;
  };

  /* ---- hints and dead ends --------------------------------------------- */

  /* How interesting each kind of move is, best first. */
  var RANK = { foundation: 0, reveal: 1, unlock: 2, empty: 3, wasteToTableau: 4 };

  /* Every move that actually gets the player somewhere, best first.
     Shuffling a run between two equivalent parents is deliberately left out:
     it changes the board without advancing it. */
  Game.prototype.findMoves = function () {
    var self = this;
    var moves = [];

    function foundationTarget(cards) {
      if (!cards || cards.length !== 1) return null;
      for (var f = 0; f < 4; f++) {
        if (self.canDrop(cards, { type: 'foundation', i: f })) return { type: 'foundation', i: f };
      }
      return null;
    }

    function tableauTarget(cards, skipColumn, allowEmpty) {
      if (!cards) return null;
      for (var d = 0; d < 7; d++) {
        if (d === skipColumn) continue;
        if (!allowEmpty && !self.tableau[d].length) continue;
        if (self.canDrop(cards, { type: 'tableau', i: d })) return { type: 'tableau', i: d };
      }
      return null;
    }

    function add(source, target, kind) {
      if (target) moves.push({ source: source, target: target, kind: kind, rank: RANK[kind] });
    }

    if (this.waste.length) {
      var wasteRef = { type: 'waste', i: 0 };
      var wasteCards = this.grab(wasteRef);
      add(wasteRef, foundationTarget(wasteCards), 'foundation');
      add(wasteRef, tableauTarget(wasteCards, -1, true), 'wasteToTableau');
    }

    for (var c = 0; c < 7; c++) {
      var pile = this.tableau[c];
      if (!pile.length) continue;

      var topRef = { type: 'tableau', i: c, ci: pile.length - 1 };
      add(topRef, foundationTarget(this.grab(topRef)), 'foundation');

      var firstUp = 0;
      while (firstUp < pile.length && !pile[firstUp].up) firstUp++;
      if (firstUp >= pile.length) continue;

      /* The whole face-up run: worth moving when it turns a card over, or
         when it clears the column outright. */
      var runRef = { type: 'tableau', i: c, ci: firstUp };
      var run = this.grab(runRef);
      var empties = firstUp === 0;
      add(runRef, tableauTarget(run, c, !empties), empties ? 'empty' : 'reveal');

      /* Splitting a run only earns its keep when it frees the card beneath
         for a foundation. */
      for (var n = firstUp + 1; n < pile.length; n++) {
        if (!foundationTarget([pile[n - 1]])) continue;
        var subRef = { type: 'tableau', i: c, ci: n };
        add(subRef, tableauTarget(this.grab(subRef), c, true), 'unlock');
      }
    }

    moves.sort(function (a, b) { return a.rank - b.rank; });
    return moves;
  };

  Game.prototype.canDraw = function () {
    return this.stock.length > 0 || this.waste.length > 0;
  };

  /* What does the player get for turning the deck over? Returns the first
     move that drawing would open up, and how much drawing it takes to get
     there, so a hint can promise something concrete instead of just
     pointing at the stock. Null means drawing leads nowhere. */
  Game.prototype.drawPreview = function () {
    var snapshot = this.snapshot();
    var historyLength = this.history.length;
    var limit = 2 * (this.stock.length + this.waste.length + 2);
    var draws = 0;
    var recycled = false;
    var result = null;

    while (draws < limit) {
      var moves = this.findMoves();
      if (moves.length && draws > 0) {
        // Describe it now: once the board is restored these refs mean
        // something else entirely.
        var cards = this.grab(moves[0].source) || [];
        var targetPile = moves[0].target.type === 'foundation'
          ? null
          : this.tableau[moves[0].target.i];
        result = {
          draws: draws,
          recycled: recycled,
          card: cards[0] || null,
          targetType: moves[0].target.type,
          onto: targetPile && targetPile.length ? targetPile[targetPile.length - 1] : null
        };
        break;
      }
      if (!this.canDraw()) break;
      if (!this.stock.length) recycled = true;
      this.draw();
      draws += 1;
    }

    this.restore(snapshot);
    this.history.length = historyLength;
    return result;
  };

  /* Which cards can actually reach the top of the waste by drawing alone?
     In draw-1 that is every one of them; in draw-3 only every third card
     surfaces, and recycling restores the same order, so the rest never come
     up at all. Since this is only consulted when no other move exists, no
     card can leave the waste to shift the grouping — which makes the answer
     exact rather than a guess. */
  Game.prototype.reachableWasteCards = function () {
    var stock = this.stock.slice();
    var waste = this.waste.slice();
    var limit = 4 * (stock.length + waste.length + 2);   // several full cycles
    var seen = {};
    var tops = [];

    for (var step = 0; step < limit; step++) {
      if (waste.length) {
        var top = waste[waste.length - 1];
        if (!seen[top.id]) { seen[top.id] = true; tops.push(top); }
      }
      if (!stock.length && !waste.length) break;
      if (!stock.length) {
        while (waste.length) stock.push(waste.pop());     // recycle, exactly as draw() does
      } else {
        var count = Math.min(this.drawCount, stock.length);
        for (var i = 0; i < count; i++) waste.push(stock.pop());
      }
    }
    return tops;
  };

  /* Could any card the player can still turn up be placed anywhere? */
  Game.prototype.stockHasPlayable = function () {
    var pool = this.reachableWasteCards();
    for (var i = 0; i < pool.length; i++) {
      var card = pool[i];
      for (var f = 0; f < 4; f++) {
        if (Cards.canStackFoundation(card, this.foundations[f])) return true;
      }
      for (var t = 0; t < 7; t++) {
        var pile = this.tableau[t];
        if (Cards.canStackTableau(card, pile.length ? pile[pile.length - 1] : null)) return true;
      }
    }
    return false;
  };

  /* How many turns of the deck until the waste top can go to a foundation?
     -1 when no card that can actually surface will ever fit — which is what
     stops auto-finish from cycling the deck for nothing. */
  Game.prototype.drawsToFoundationPlay = function () {
    var stock = this.stock.slice();
    var waste = this.waste.slice();
    var limit = 2 * (stock.length + waste.length + 2);

    for (var draws = 0; draws <= limit; draws++) {
      if (waste.length) {
        var top = waste[waste.length - 1];
        for (var f = 0; f < 4; f++) {
          if (Cards.canStackFoundation(top, this.foundations[f])) return draws;
        }
      }
      if (!stock.length && !waste.length) break;
      if (!stock.length) {
        while (waste.length) stock.push(waste.pop());
      } else {
        var count = Math.min(this.drawCount, stock.length);
        for (var i = 0; i < count; i++) waste.push(stock.pop());
      }
    }
    return -1;
  };

  /* Nothing on the board advances, and nothing left to turn up can help. */
  Game.prototype.isDeadEnd = function () {
    if (this.won) return false;
    if (this.findMoves().length) return false;
    return !this.stockHasPlayable();
  };

  Game.prototype.sendToFoundation = function (source) {
    var cards = this.grab(source);
    if (!cards || cards.length !== 1) return false;
    for (var i = 0; i < 4; i++) {
      if (this.canDrop(cards, { type: 'foundation', i: i })) {
        return this.move(source, { type: 'foundation', i: i });
      }
    }
    return false;
  };

  /* One step of auto-finish: the next card that can go home, if any. */
  Game.prototype.nextFoundationMove = function () {
    var candidates = [];
    if (this.waste.length) candidates.push({ type: 'waste', i: 0 });
    for (var c = 0; c < 7; c++) {
      if (this.tableau[c].length) {
        candidates.push({ type: 'tableau', i: c, ci: this.tableau[c].length - 1 });
      }
    }
    for (var k = 0; k < candidates.length; k++) {
      var cards = this.grab(candidates[k]);
      if (!cards || cards.length !== 1) continue;
      for (var f = 0; f < 4; f++) {
        if (this.canDrop(cards, { type: 'foundation', i: f })) {
          return { source: candidates[k], target: { type: 'foundation', i: f } };
        }
      }
    }
    return null;
  };

  /* True once nothing is hidden — from here the game always finishes. */
  Game.prototype.canAutoFinish = function () {
    if (this.won) return false;
    for (var c = 0; c < 7; c++) {
      for (var n = 0; n < this.tableau[c].length; n++) {
        if (!this.tableau[c][n].up) return false;
      }
    }
    return this.foundationCount() < 52;
  };

  Game.prototype.foundationCount = function () {
    return this.foundations.reduce(function (sum, p) { return sum + p.length; }, 0);
  };

  Game.prototype.checkWin = function () {
    if (this.foundationCount() === 52) this.won = true;
    return this.won;
  };

  Game.prototype.undo = function () {
    if (!this.history.length) return false;
    this.restore(this.history.pop());
    return true;
  };

  Game.prototype.canUndo = function () { return this.history.length > 0; };

  /* ---- serialisation --------------------------------------------------- */

  Game.prototype.snapshot = function () {
    return JSON.parse(JSON.stringify({
      tableau: this.tableau,
      foundations: this.foundations,
      waste: this.waste,
      stock: this.stock,
      score: this.score,
      moves: this.moves,
      elapsed: this.elapsed,
      passes: this.passes,
      won: this.won
    }));
  };

  Game.prototype.restore = function (snap) {
    this.tableau = snap.tableau;
    this.foundations = snap.foundations;
    this.waste = snap.waste;
    this.stock = snap.stock;
    this.score = snap.score;
    this.moves = snap.moves;
    if (snap.elapsed !== undefined) this.elapsed = snap.elapsed;
    this.passes = snap.passes;
    this.won = snap.won;
  };

  Game.prototype.toJSON = function () {
    var data = this.snapshot();
    data.drawCount = this.drawCount;
    data.winnable = !!this.winnable;
    data.started = this.started;
    data.history = this.history.slice(-SAVED_HISTORY);
    return data;
  };

  Game.fromJSON = function (data) {
    var game = Object.create(Game.prototype);
    game.drawCount = data.drawCount === 3 ? 3 : 1;
    game.started = data.started || Date.now();
    game.history = Array.isArray(data.history) ? data.history : [];
    game.winnable = !!data.winnable;
    game.restore(data);
    return game;
  };

  /* Sanity check so a corrupt or half-written save is never loaded. */
  Game.isValidSave = function (data) {
    if (!data || !Array.isArray(data.tableau) || data.tableau.length !== 7) return false;
    if (!Array.isArray(data.foundations) || data.foundations.length !== 4) return false;
    if (!Array.isArray(data.waste) || !Array.isArray(data.stock)) return false;
    var seen = {}, total = 0;
    var piles = data.tableau.concat(data.foundations, [data.waste, data.stock]);
    for (var p = 0; p < piles.length; p++) {
      if (!Array.isArray(piles[p])) return false;
      for (var c = 0; c < piles[p].length; c++) {
        var card = piles[p][c];
        if (!card || !card.id || !card.s || !card.r) return false;
        if (seen[card.id]) return false;
        seen[card.id] = true;
        total += 1;
      }
    }
    return total === 52;
  };

  Game.SCORE = SCORE;
  return Game;
})();
