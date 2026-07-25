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
    data.started = this.started;
    data.history = this.history.slice(-SAVED_HISTORY);
    return data;
  };

  Game.fromJSON = function (data) {
    var game = Object.create(Game.prototype);
    game.drawCount = data.drawCount === 3 ? 3 : 1;
    game.started = data.started || Date.now();
    game.history = Array.isArray(data.history) ? data.history : [];
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
