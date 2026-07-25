/* Card model and the stacking rules of Klondike. */
var Cards = (function () {
  'use strict';

  var SUITS = [
    { id: 'S', name: 'Spades',   symbol: '♠', red: false },
    { id: 'H', name: 'Hearts',   symbol: '♥', red: true  },
    { id: 'D', name: 'Diamonds', symbol: '♦', red: true  },
    { id: 'C', name: 'Clubs',    symbol: '♣', red: false }
  ];

  var RANK_LABELS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

  var SUIT_BY_ID = {};
  SUITS.forEach(function (s) { SUIT_BY_ID[s.id] = s; });

  function suit(card) { return SUIT_BY_ID[card.s]; }
  function isRed(card) { return SUIT_BY_ID[card.s].red; }
  function label(card) { return RANK_LABELS[card.r]; }

  /* Fisher-Yates using Math.random. */
  function shuffle(list) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = list[i]; list[i] = list[j]; list[j] = t;
    }
    return list;
  }

  function makeDeck() {
    var deck = [];
    for (var s = 0; s < SUITS.length; s++) {
      for (var r = 1; r <= 13; r++) {
        deck.push({ id: SUITS[s].id + r, s: SUITS[s].id, r: r, up: false });
      }
    }
    return deck;
  }

  /* A card may sit on a tableau card if it is one lower and the opposite colour. */
  function canStackTableau(card, onto) {
    if (!onto) return card.r === 13;          // empty column takes a King
    if (!onto.up) return false;
    return onto.r === card.r + 1 && isRed(card) !== isRed(onto);
  }

  /* A card may sit on a foundation pile if it continues the same suit upward. */
  function canStackFoundation(card, pile) {
    if (!pile.length) return card.r === 1;    // empty foundation takes an Ace
    var top = pile[pile.length - 1];
    return top.s === card.s && top.r === card.r - 1;
  }

  /* A run of face-up cards is movable when it descends in alternating colours. */
  function isValidRun(cards) {
    for (var i = 0; i < cards.length; i++) {
      if (!cards[i].up) return false;
      if (i > 0 && !canStackTableau(cards[i], cards[i - 1])) return false;
    }
    return cards.length > 0;
  }

  return {
    SUITS: SUITS,
    RANK_LABELS: RANK_LABELS,
    suit: suit,
    isRed: isRed,
    label: label,
    shuffle: shuffle,
    makeDeck: makeDeck,
    canStackTableau: canStackTableau,
    canStackFoundation: canStackFoundation,
    isValidRun: isValidRun
  };
})();
