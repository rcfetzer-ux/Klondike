/* Board rendering and touch input.
   Every card is one absolutely positioned element; a layout pass computes
   where each one belongs and CSS transitions do the animating. */
var UI = (function () {
  'use strict';

  var PILE_ORDER = ['stock', 'waste', 'f0', 'f1', 'f2', 'f3', 't0', 't1', 't2', 't3', 't4', 't5', 't6'];
  var DRAG_THRESHOLD = 7;

  var board = null;
  var game = null;
  var settings = null;
  var hooks = {};
  var cardEls = {};
  var slotEls = {};
  var layout = null;
  var selection = null;
  var pending = null;   // pointer down, not yet a drag
  var drag = null;      // active drag
  var locked = false;   // true during auto-finish / pause
  var hint = null;      // { cards: [id], target: ref } or { stock: true }
  var hintTimer = null;

  /* ---- setup ----------------------------------------------------------- */

  function init(options) {
    board = options.board;
    settings = options.settings;
    hooks = options.hooks || {};
    buildSlots();
    board.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('resize', render);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', render);
  }

  function buildSlots() {
    PILE_ORDER.forEach(function (key) {
      var el = document.createElement('div');
      var ref = refFromKey(key);
      el.className = 'slot slot-' + ref.type;
      el.dataset.type = ref.type;
      el.dataset.i = ref.i;
      if (ref.type === 'stock') el.innerHTML = '<span class="slot-mark">&#8635;</span>';
      if (ref.type === 'foundation') el.innerHTML = '<span class="slot-mark">' + Cards.SUITS[ref.i].symbol + '</span>';
      board.appendChild(el);
      slotEls[key] = el;
    });
  }

  function refFromKey(key) {
    if (key === 'stock') return { type: 'stock', i: 0 };
    if (key === 'waste') return { type: 'waste', i: 0 };
    if (key[0] === 'f') return { type: 'foundation', i: +key[1] };
    return { type: 'tableau', i: +key[1] };
  }

  function setSettings(next) {
    settings = next;
    applyCardBack();
  }

  /* Points one card at the right artwork for the current theme. The classic
     theme has no illustrations, so the references are cleared and CSS falls
     back to the plain pip and the woven pattern. */
  function applyArt(el, card) {
    var theme = settings.theme || 'classic';
    var art = el.querySelector('.art use');
    var scene = el.querySelector('.scene use');
    if (theme === 'classic') {
      art.removeAttribute('href');
      scene.removeAttribute('href');
      return;
    }
    art.setAttribute('href', '#art-' + theme + '-' + card.s);
    scene.setAttribute('href', '#back-' + theme);
  }

  function applyCardBack() {
    board.className = board.className.replace(/\bpat-\S+/g, '').trim();
    board.classList.add('pat-' + settings.backPattern);
    board.dataset.backColor = settings.backColor;
    board.dataset.theme = settings.theme || 'classic';
    document.documentElement.dataset.theme = settings.theme || 'classic';
    if (game) {
      eachCard(function (card) {
        var el = cardEls[card.id];
        if (el) applyArt(el, card);
      });
    }
  }

  function setGame(next) {
    game = next;
    selection = null;
    clearHint();
    pending = null;
    drag = null;
    Object.keys(cardEls).forEach(function (id) { cardEls[id].remove(); });
    cardEls = {};
    allCards().forEach(function (card) {
      var el = createCardEl(card);
      cardEls[card.id] = el;
      board.appendChild(el);
    });
    applyCardBack();
    render();
  }

  function allCards() {
    return game.stock
      .concat(game.waste)
      .concat(game.foundations[0], game.foundations[1], game.foundations[2], game.foundations[3])
      .concat(game.tableau[0], game.tableau[1], game.tableau[2], game.tableau[3],
              game.tableau[4], game.tableau[5], game.tableau[6]);
  }

  function createCardEl(card) {
    var el = document.createElement('div');
    var suit = Cards.suit(card);
    el.className = 'card ' + (suit.red ? 'is-red' : 'is-black');
    el.dataset.id = card.id;
    var corner = '<b>' + Cards.label(card) + '</b><i>' + suit.symbol + '</i>';
    el.innerHTML =
      '<div class="card-inner">' +
        '<div class="card-face card-front">' +
          '<span class="corner corner-tl">' + corner + '</span>' +
          '<span class="pip">' + suit.symbol + '</span>' +
          '<svg class="art" viewBox="0 0 100 100" aria-hidden="true"><use href=""></use></svg>' +
          '<span class="corner corner-br">' + corner + '</span>' +
        '</div>' +
        '<div class="card-face card-back">' +
          '<svg class="scene" viewBox="0 0 100 140" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><use href=""></use></svg>' +
          '<span class="back-art"></span>' +
        '</div>' +
      '</div>';
    applyArt(el, card);
    return el;
  }

  /* ---- layout ---------------------------------------------------------- */

  function computeLayout() {
    var W = board.clientWidth;
    var H = board.clientHeight;
    var gap = Math.max(4, Math.min(10, Math.round(W * 0.016)));

    /* Width sets the ceiling, but on a short screen (landscape phones) the
       height has to as well, or the tableau runs off the bottom. */
    var widthLimit = Math.floor((W - gap * 8) / 7);
    var heightLimit = Math.max(28, Math.floor((H * 0.32) / 1.45));
    var cardW = Math.max(24, Math.min(widthLimit, heightLimit));
    var cardH = Math.round(cardW * 1.45);
    var pad = Math.max(gap, Math.round((W - (cardW * 7 + gap * 6)) / 2));
    var topGap = Math.max(8, Math.round(cardH * 0.16));
    var tabY = cardH + topGap;
    var tabSpace = Math.max(cardH, H - tabY);

    var colX = function (i) { return pad + i * (cardW + gap); };
    var pos = {};
    var targets = [];
    var slots = {};
    var z = 0;

    function place(key, ref, x, y) {
      slots[key] = { x: x, y: y };
      targets.push({ ref: ref, x: x, y: y, w: cardW, h: cardH });
    }

    place('stock', { type: 'stock', i: 0 }, colX(0), 0);
    place('waste', { type: 'waste', i: 0 }, colX(1), 0);
    for (var f = 0; f < 4; f++) place('f' + f, { type: 'foundation', i: f }, colX(3 + f), 0);

    /* stock: a tidy squared-off deck */
    game.stock.forEach(function (card, n) {
      var lift = Math.min(3, Math.floor((game.stock.length - n) / 8));
      pos[card.id] = { x: colX(0) - lift, y: -lift, z: z++ };
    });

    /* waste: the last few cards fan to the right */
    var fanCount = game.drawCount === 3 ? 3 : 1;
    var wasteFan = Math.round(cardW * 0.32);
    game.waste.forEach(function (card, n) {
      var fromTop = game.waste.length - 1 - n;
      var slotIndex = Math.max(0, Math.min(fanCount - 1, fanCount - 1 - fromTop));
      pos[card.id] = { x: colX(1) + slotIndex * wasteFan, y: 0, z: z++ };
    });

    game.foundations.forEach(function (pile, i) {
      pile.forEach(function (card) {
        pos[card.id] = { x: colX(3 + i), y: 0, z: z++ };
      });
    });

    /* tableau: fan offsets shrink so a long column still fits on screen */
    var baseDown = Math.max(6, Math.round(cardH * 0.10));
    var baseUp = Math.max(10, Math.round(cardH * 0.235));

    game.tableau.forEach(function (pile, i) {
      var downs = 0, ups = 0;
      pile.forEach(function (c) { if (c.up) ups++; else downs++; });
      var needed = downs * baseDown + Math.max(0, ups - 1) * baseUp;
      var room = tabSpace - cardH;
      var scale = needed > room && needed > 0 ? Math.max(0.3, room / needed) : 1;
      var down = Math.max(3, Math.round(baseDown * scale));
      var up = Math.max(8, Math.round(baseUp * scale));

      var y = tabY;
      var extent = cardH;
      pile.forEach(function (card, n) {
        pos[card.id] = { x: colX(i), y: y, z: z++ };
        extent = y - tabY + cardH;
        if (n < pile.length - 1) y += card.up ? up : down;
      });
      slots['t' + i] = { x: colX(i), y: tabY };
      targets.push({
        ref: { type: 'tableau', i: i },
        x: colX(i), y: tabY, w: cardW,
        h: Math.max(cardH, extent)
      });
    });

    return {
      cardW: cardW, cardH: cardH, gap: gap, tabY: tabY,
      pos: pos, targets: targets, slots: slots
    };
  }

  /* ---- render ---------------------------------------------------------- */

  function render() {
    if (!game || !board.clientWidth) return;
    layout = computeLayout();

    board.style.setProperty('--card-w', layout.cardW + 'px');
    board.style.setProperty('--card-h', layout.cardH + 'px');

    var hinted = hintCardIds();
    var hintTargetEl = hintTargetElement();

    PILE_ORDER.forEach(function (key) {
      var s = layout.slots[key];
      var el = slotEls[key];
      if (!s || !el) return;
      el.style.transform = 'translate3d(' + s.x + 'px,' + s.y + 'px,0)';
      el.classList.toggle('is-hint-target', el === hintTargetEl);
    });
    slotEls.stock.classList.toggle('is-recycle', game.stock.length === 0 && game.waste.length > 0);
    slotEls.stock.classList.toggle('is-empty', game.stock.length === 0);

    var selected = selectedIds();

    eachCard(function (card, ref) {
      var el = cardEls[card.id];
      if (!el) return;
      var p = layout.pos[card.id];
      el.classList.toggle('is-down', !card.up);
      el.classList.toggle('is-selected', selected[card.id] === true);
      el.classList.toggle('is-hint', hinted[card.id] === true);
      el.classList.toggle('is-hint-target', el === hintTargetEl);
      el.dataset.type = ref.type;
      el.dataset.i = ref.i;
      el.dataset.ci = ref.ci;
      if (drag && drag.ids.indexOf(card.id) >= 0) return;   // the hand owns it
      el.style.zIndex = p.z;
      el.style.transform = 'translate3d(' + p.x + 'px,' + p.y + 'px,0)';
    });

    if (hooks.onRender) hooks.onRender();
  }

  function eachCard(fn) {
    game.stock.forEach(function (c, n) { fn(c, { type: 'stock', i: 0, ci: n }); });
    game.waste.forEach(function (c, n) { fn(c, { type: 'waste', i: 0, ci: n }); });
    game.foundations.forEach(function (pile, i) {
      pile.forEach(function (c, n) { fn(c, { type: 'foundation', i: i, ci: n }); });
    });
    game.tableau.forEach(function (pile, i) {
      pile.forEach(function (c, n) { fn(c, { type: 'tableau', i: i, ci: n }); });
    });
  }

  function selectedIds() {
    var map = {};
    if (selection) {
      var cards = game.grab(selection) || [];
      cards.forEach(function (c) { map[c.id] = true; });
    }
    return map;
  }

  /* ---- hints ----------------------------------------------------------- */

  function hintCardIds() {
    var map = {};
    if (hint && hint.cards) hint.cards.forEach(function (id) { map[id] = true; });
    return map;
  }

  /* The pile a hint points at: its top card, or the empty slot beneath it. */
  function hintTargetElement() {
    if (!hint) return null;
    if (hint.stock) {
      return game.stock.length
        ? cardEls[game.stock[game.stock.length - 1].id]
        : slotEls.stock;
    }
    if (!hint.target) return null;
    var pile = game.pile(hint.target);
    if (pile && pile.length) return cardEls[pile[pile.length - 1].id];
    return slotEls[(hint.target.type === 'foundation' ? 'f' : 't') + hint.target.i] || null;
  }

  /* move is a { source, target } from findMoves(), or { kind: 'draw' }. */
  function showHint(move) {
    clearHint();
    if (!move) return;
    if (move.kind === 'draw') {
      hint = { stock: true };
    } else {
      var cards = game.grab(move.source) || [];
      hint = { cards: cards.map(function (c) { return c.id; }), target: move.target };
    }
    selection = null;
    render();
    hintTimer = setTimeout(function () { clearHint(); render(); }, 2600);
  }

  function clearHint() {
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = null;
    hint = null;
  }

  /* ---- input ----------------------------------------------------------- */

  function setLocked(value) { locked = !!value; }

  function refFromEvent(e) {
    var el = e.target.closest ? e.target.closest('.card, .slot') : null;
    if (!el || !board.contains(el)) return null;
    var ref = {
      type: el.dataset.type,
      i: +el.dataset.i,
      ci: el.dataset.ci === undefined ? undefined : +el.dataset.ci,
      el: el
    };
    // Only the top card of the waste or a foundation is ever in play.
    if (ref.type === 'waste') ref.ci = Math.max(0, game.waste.length - 1);
    if (ref.type === 'foundation') ref.ci = Math.max(0, game.foundations[ref.i].length - 1);
    return ref;
  }

  function onPointerDown(e) {
    if (locked || !game || e.button > 0) return;
    var ref = refFromEvent(e);
    if (!ref) return;
    clearHint();
    pending = { ref: ref, x: e.clientX, y: e.clientY, moved: false, pointerId: e.pointerId };

    if (ref.type === 'stock') return;
    var cards = game.grab(ref);
    if (!cards) return;
    pending.cards = cards;
  }

  function onPointerMove(e) {
    if (!pending || e.pointerId !== pending.pointerId) return;
    var dx = e.clientX - pending.x;
    var dy = e.clientY - pending.y;

    if (!drag) {
      if (!pending.cards) return;
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      startDrag();
    }
    e.preventDefault();
    drag.ids.forEach(function (id, n) {
      var base = drag.base[n];
      cardEls[id].style.transform =
        'translate3d(' + (base.x + dx) + 'px,' + (base.y + dy) + 'px,0)';
    });
    drag.dx = dx;
    drag.dy = dy;
  }

  function startDrag() {
    var cards = pending.cards;
    drag = { ids: [], base: [], source: pending.ref, dx: 0, dy: 0 };
    selection = null;
    cards.forEach(function (card, n) {
      var p = layout.pos[card.id];
      drag.ids.push(card.id);
      drag.base.push({ x: p.x, y: p.y });
      var el = cardEls[card.id];
      el.classList.add('is-dragging');
      el.classList.remove('is-selected');
      el.style.zIndex = 900 + n;
    });
  }

  function onPointerUp(e) {
    if (!pending || e.pointerId !== pending.pointerId) return;
    var wasDrag = !!drag;
    if (wasDrag) finishDrag();
    else handleTap(pending.ref);
    pending = null;
  }

  function onPointerCancel() {
    if (drag) {
      drag.ids.forEach(function (id) { cardEls[id].classList.remove('is-dragging'); });
      drag = null;
      render();
    }
    pending = null;
  }

  function finishDrag() {
    var source = drag.source;
    var first = drag.base[0];
    var rect = { x: first.x + drag.dx, y: first.y + drag.dy, w: layout.cardW, h: layout.cardH };
    drag.ids.forEach(function (id) { cardEls[id].classList.remove('is-dragging'); });
    drag = null;

    var target = bestTarget(rect, source);
    if (target && game.move(source, target)) {
      afterMove();
    } else {
      render();
    }
  }

  /* Pick the drop pile the dragged card overlaps most. */
  function bestTarget(rect, source) {
    var best = null, bestArea = 0;
    layout.targets.forEach(function (t) {
      if (t.ref.type === 'stock' || t.ref.type === 'waste') return;
      if (t.ref.type === source.type && t.ref.i === source.i) return;
      var ox = Math.max(0, Math.min(rect.x + rect.w, t.x + t.w) - Math.max(rect.x, t.x));
      var oy = Math.max(0, Math.min(rect.y + rect.h, t.y + t.h) - Math.max(rect.y, t.y));
      var area = ox * oy;
      if (area > bestArea) { bestArea = area; best = t.ref; }
    });
    return bestArea > (layout.cardW * layout.cardH) * 0.12 ? best : null;
  }

  function handleTap(ref) {
    if (ref.type === 'stock') {
      if (game.draw()) afterMove(); else render();
      return;
    }

    if (selection) {
      var sameCard = selection.type === ref.type && selection.i === ref.i && selection.ci === ref.ci;
      var previous = selection;
      selection = null;

      if (sameCard) {
        if (settings.quickFoundation && game.sendToFoundation(previous)) { afterMove(); return; }
        render();
        return;
      }
      if (game.move(previous, { type: ref.type, i: ref.i })) { afterMove(); return; }
      reject(ref.el);
    }

    if (game.grab(ref)) {
      selection = { type: ref.type, i: ref.i, ci: ref.ci };
    }
    render();
  }

  function reject(el) {
    if (el) {
      el.classList.remove('shake');
      void el.offsetWidth;
      el.classList.add('shake');
      setTimeout(function () { el.classList.remove('shake'); }, 350);
    }
    if (settings.haptics && navigator.vibrate) navigator.vibrate(18);
  }

  function afterMove() {
    selection = null;
    clearHint();
    render();
    if (hooks.onMove) hooks.onMove();
  }

  /* ---- helpers used by the app ---------------------------------------- */

  function flash(el) { reject(el); }

  function clearSelection() { selection = null; }

  return {
    init: init,
    setGame: setGame,
    setSettings: setSettings,
    setLocked: setLocked,
    clearSelection: clearSelection,
    showHint: showHint,
    clearHint: clearHint,
    applyCardBack: applyCardBack,
    render: render,
    flash: flash
  };
})();
