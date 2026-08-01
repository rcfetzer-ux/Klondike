/* Wires the engine, the board and the chrome together: timer, autosave,
   scoreboard, menu and the card-back picker. */
(function () {
  'use strict';

  var BUILD = '2026.07.25.10';

  var BACK_PATTERNS = [
    { id: 'lattice', name: 'Lattice' },
    { id: 'dots',    name: 'Dots' },
    { id: 'chevron', name: 'Chevron' },
    { id: 'grid',    name: 'Grid' },
    { id: 'stripes', name: 'Stripes' },
    { id: 'classic', name: 'Classic' }
  ];

  var THEMES = [
    { id: 'classic', name: 'Classic', blurb: 'Plain woven backs in the pattern and colour you pick below.' },
    { id: 'jungle',  name: 'Jungle',  blurb: 'Canopy and sunlight on the backs, with a tiger, toucan, tree frog and monkey on the faces.' },
    { id: 'ocean',   name: 'Ocean',   blurb: 'Reef water on the backs, with a whale, clownfish, sea turtle and octopus on the faces.' },
    { id: 'desert',  name: 'Desert',  blurb: 'Dunes at sundown on the backs, with a camel, fennec fox, lizard and scorpion on the faces.' }
  ];

  var BACK_COLORS = [
    { id: 'crimson', name: 'Crimson' },
    { id: 'navy',    name: 'Navy' },
    { id: 'forest',  name: 'Forest' },
    { id: 'plum',    name: 'Plum' },
    { id: 'teal',    name: 'Teal' },
    { id: 'amber',   name: 'Amber' },
    { id: 'slate',   name: 'Slate' },
    { id: 'ink',     name: 'Ink' }
  ];

  var settings = Store.loadSettings();
  var stats = Store.loadStats();
  var game = null;
  var paused = false;
  var autoRunning = false;
  var timer = null;
  var recorded = false;   // this deal has already been added to the scoreboard
  var dead = false;       // the deal ran out of plays
  var hintIndex = 0;      // cycles through the available hints

  var el = {};
  ['statScore', 'statTime', 'statMoves', 'statBest', 'board', 'btnUndo', 'btnAuto',
   'btnHint', 'btnPause', 'btnNew', 'btnMenu', 'pauseOverlay', 'pauseTitle', 'pauseText',
   'deadOverlay', 'deadSummary', 'deadText', 'btnDeadNew', 'btnDeadUndo', 'btnDeadUndoAll',
   'btnUndoAllMenu',
   'pauseSummary', 'btnResume', 'btnPauseNew', 'winOverlay', 'winSummary', 'btnWinNew',
   'btnWinClose', 'menuOverlay', 'btnMenuClose', 'backPatterns', 'backColors',
   'drawMode', 'optQuickFoundation', 'optHaptics', 'statsSummary', 'scoreList',
   'btnResetStats', 'hintToast', 'buildStamp', 'optWinnable', 'searchOverlay',
   'searchText', 'btnSearchCancel', 'themeTiles', 'themeNote', 'classicOnly'].forEach(function (id) { el[id] = document.getElementById(id); });

  /* ---- helpers --------------------------------------------------------- */

  function formatTime(seconds) {
    seconds = Math.max(0, Math.floor(seconds || 0));
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var s = seconds % 60;
    if (h) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    return m + ':' + String(s).padStart(2, '0');
  }

  function fillSummary(node, rows) {
    node.innerHTML = rows.map(function (row) {
      return '<div><dt>' + row[0] + '</dt><dd>' + row[1] + '</dd></div>';
    }).join('');
  }

  /* ---- scoreboard ------------------------------------------------------ */

  function updateScoreboard() {
    el.statScore.textContent = game.score;
    el.statTime.textContent = formatTime(game.elapsed);
    el.statMoves.textContent = game.moves;
    el.statBest.textContent = stats.bestScore ? stats.bestScore : '—';
    el.btnUndo.disabled = !game.canUndo() || autoRunning;
    el.btnAuto.disabled = autoRunning || game.won || !game.nextFoundationMove();
    el.btnHint.disabled = autoRunning || game.won || dead;
    el.btnUndoAllMenu.disabled = autoRunning || !game.canUndoAll();
  }

  /* ---- timer and saving ------------------------------------------------ */

  function startTimer() {
    stopTimer();
    timer = setInterval(function () {
      if (paused || game.won) return;
      game.elapsed += 1;
      el.statTime.textContent = formatTime(game.elapsed);
      if (game.elapsed % 10 === 0) save();
    }, 1000);
  }

  function stopTimer() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function save() {
    if (game && !game.won) Store.saveGame(game.toJSON());
  }

  /* ---- game lifecycle -------------------------------------------------- */

  function installGame(fresh, options) {
    if (window.Cascade) Cascade.stop();
    game = fresh;
    recorded = false;
    dead = false;
    hintIndex = 0;
    paused = false;
    autoRunning = false;
    toast(null);
    UI.setLocked(false);
    UI.setGame(game);
    updateScoreboard();
    startTimer();
    save();
    if (options && options.closeOverlays) closeOverlays();
  }

  function startGame(options) {
    if (settings.winnableOnly && window.Solver) {
      findWinnableDeal(options);
      return;
    }
    installGame(new Klondike({ drawCount: settings.drawCount }), options);
  }

  /* Shuffles until the solver can prove a deal is winnable, in slices, so
     the page keeps breathing while it looks. */
  var searching = false;

  function findWinnableDeal(options) {
    if (searching) return;
    searching = true;
    stopTimer();
    UI.setLocked(true);
    closeOverlays();
    el.searchText.textContent = 'Checking shuffles for one with a guaranteed win.';
    show(el.searchOverlay);

    var attempts = 0;
    var started = Date.now();
    var GIVE_UP_MS = 9000;

    function attempt() {
      if (!searching) return;
      var candidate = new Klondike({ drawCount: settings.drawCount });
      attempts += 1;

      var verdict = Solver.solve(candidate, {
        maxNodes: 30000,
        deadline: Date.now() + 500     // no single shuffle may hog the thread
      });

      if (verdict.result === Solver.WIN) {
        candidate.winnable = true;
        finish(candidate);
        return;
      }
      if (Date.now() - started > GIVE_UP_MS) {
        finish(candidate, true);       // rather deal than leave them waiting
        return;
      }
      el.searchText.textContent = 'Checked ' + attempts + ' shuffle' + (attempts === 1 ? '' : 's') + '…';
      setTimeout(attempt, 0);
    }

    function finish(candidate, gaveUp) {
      searching = false;
      hide(el.searchOverlay);
      installGame(candidate, options);
      if (gaveUp) {
        toast('Could not prove a deal winnable in time — this one is unverified.');
      }
    }

    setTimeout(attempt, 30);
  }

  function resumeGame(data) {
    game = Klondike.fromJSON(data);
    recorded = false;
    dead = false;
    hintIndex = 0;
    autoRunning = false;
    UI.setGame(game);
    updateScoreboard();
    startTimer();
  }

  /* An abandoned game still counts as played, and breaks the win streak. */
  function abandonCurrent() {
    if (game && !game.won && !recorded && game.moves > 0) {
      recorded = true;
      stats = Store.recordResult(stats, { won: false });
    }
  }

  function newGame() {
    if (game && !game.won && !dead && game.moves > 0) {
      if (!window.confirm('Start a new game? The current one will be lost.')) return;
    }
    abandonCurrent();
    Store.clearGame();
    startGame({ closeOverlays: true });
  }

  function onMove() {
    hintIndex = 0;
    toast(null);
    updateScoreboard();
    if (game.won) { handleWin(); return; }
    save();
    if (!autoRunning) checkDeadEnd();
  }

  /* ---- hints ----------------------------------------------------------- */

  var toastTimer = null;

  function toast(message) {
    if (toastTimer) clearTimeout(toastTimer);
    if (!message) { el.hintToast.hidden = true; return; }
    el.hintToast.textContent = message;
    el.hintToast.hidden = false;
    toastTimer = setTimeout(function () { el.hintToast.hidden = true; }, 3600);
  }

  function cardName(card) {
    return Cards.label(card) + Cards.suit(card).symbol;
  }

  /* "the 6♦ onto the 7♠" / "the 6♦ to its foundation" */
  function describePlay(card, targetType, onto) {
    if (!card) return '';
    var what = 'the ' + cardName(card);
    if (targetType === 'foundation') return what + ' to its foundation';
    if (!onto) return what + ' to the empty column';
    return what + ' onto the ' + cardName(onto);
  }

  function describeMove(move) {
    var cards = game.grab(move.source) || [];
    var pile = move.target.type === 'tableau' ? game.tableau[move.target.i] : null;
    return describePlay(cards[0], move.target.type,
                        pile && pile.length ? pile[pile.length - 1] : null);
  }

  /* Every useful move, plus turning the stock over as a last suggestion. */
  function hintList() {
    var list = game.findMoves();
    if (game.canDraw()) list.push({ kind: 'draw' });
    return list;
  }

  function showHint() {
    if (dead || game.won || autoRunning || paused) return;

    // Pressing hint always re-checks: if the deal is finished, say so now
    // rather than pointing at a deck that cannot help.
    checkDeadEnd();
    if (dead) return;

    var list = hintList();
    if (!list.length) { endDeadGame(); return; }
    if (hintIndex >= list.length) hintIndex = 0;

    var hint = list[hintIndex];
    UI.showHint(hint);

    if (hint.kind === 'draw') {
      // Promise something concrete, so "turn the deck over" never reads as
      // "this game is stuck and nobody is telling you".
      var preview = game.drawPreview();
      if (!preview) {
        toast('Nothing in the deck can be played.');
      } else {
        var target = describePlay(preview.card, preview.targetType, preview.onto);
        var taps = preview.draws === 1 ? 'One more turn of the deck' : preview.draws + ' turns of the deck';
        toast(taps + (preview.recycled ? ' (past the end and round again)' : '') +
              (target ? ' brings up ' + target + '.' : '.'));
      }
    } else {
      toast('Play ' + describeMove(hint) + '.');
    }

    hintIndex = (hintIndex + 1) % list.length;
  }

  /* ---- running out of moves -------------------------------------------- */

  function checkDeadEnd() {
    if (dead || paused || game.won || autoRunning) return;
    if (game.isDeadEnd()) endDeadGame();
  }

  function endDeadGame() {
    dead = true;
    toast(null);
    stopTimer();
    UI.clearHint();
    UI.clearSelection();
    UI.setLocked(true);
    UI.render();
    save();
    updateScoreboard();
    fillSummary(el.deadSummary, [
      ['Score', game.score],
      ['Time', formatTime(game.elapsed)],
      ['Moves', game.moves],
      ['Cards home', game.foundationCount() + ' of 52']
    ]);
    el.deadText.textContent = game.winnable
      ? 'This deal could be won — a different line of play gets there. Undo and try again, or take a fresh one.'
      : 'This deal is out of plays — nothing on the board moves, and nothing left to turn up can help.';
    el.btnDeadUndo.hidden = !game.canUndo();
    el.btnDeadUndoAll.hidden = !game.canUndoAll();
    show(el.deadOverlay);
  }

  /* Back to the deal as it was handed out, with the same cards. Used from
     the menu mid-game and from the end-of-game screen. */
  function undoAll(options) {
    if (!game.canUndoAll()) return false;
    if (options && options.confirm && !dead &&
        !window.confirm('Put every card back and start this deal again?')) return false;
    if (!game.undoAll()) return false;

    dead = false;
    hintIndex = 0;
    toast(null);
    UI.clearHint();
    UI.clearSelection();
    UI.setLocked(false);
    hide(el.deadOverlay);
    hide(el.menuOverlay);
    UI.render();
    updateScoreboard();
    startTimer();
    save();
    return true;
  }

  /* Backing out of a dead end puts the player back in the game. */
  function reviveFromDeadEnd() {
    if (!game.undo()) return;
    dead = false;
    hintIndex = 0;
    hide(el.deadOverlay);
    UI.setLocked(false);
    UI.render();
    updateScoreboard();
    startTimer();
    save();
  }

  /* Cards for the cascade: taken off the foundations a pile at a time so all
     four empty together, each with the screen position it is falling from. */
  function cascadeCards() {
    var rows = [];
    var deepest = 0;
    game.foundations.forEach(function (pile) { deepest = Math.max(deepest, pile.length); });
    for (var depth = 0; depth < deepest; depth++) {
      for (var f = 0; f < 4; f++) {
        var pile = game.foundations[f];
        var card = pile[pile.length - 1 - depth];
        if (!card) continue;
        var rect = UI.cardRect(card.id);
        if (!rect) continue;
        rows.push({
          label: Cards.label(card),
          symbol: Cards.suit(card).symbol,
          red: Cards.isRed(card),
          x: rect.x, y: rect.y, w: rect.w, h: rect.h
        });
      }
    }
    return rows;
  }

  function startCascade() {
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !window.Cascade) return false;
    return Cascade.start({ cards: cascadeCards() });
  }

  function handleWin() {
    stopTimer();
    autoRunning = false;
    UI.setLocked(false);
    Store.clearGame();
    if (!recorded) {
      recorded = true;
      // A finished game earns a bonus for a quick clear.
      if (game.elapsed > 30) game.addScore(Math.floor(70000 / game.elapsed));
      stats = Store.recordResult(stats, {
        won: true,
        score: game.score,
        time: game.elapsed,
        moves: game.moves,
        draw: game.drawCount
      });
    }
    updateScoreboard();
    fillSummary(el.winSummary, [
      ['Score', game.score],
      ['Time', formatTime(game.elapsed)],
      ['Moves', game.moves],
      ['Best score', stats.bestScore],
      ['Games won', stats.won + ' of ' + stats.played],
      ['Streak', stats.streak]
    ]);
    var cascading = startCascade();

    /* Let the cascade run before the panel covers it, and let a tap cut it
       short for anyone who has seen it a hundred times. */
    var revealed = false;
    function reveal() {
      if (revealed) return;
      revealed = true;
      document.removeEventListener('pointerdown', reveal);
      show(el.winOverlay);
    }
    if (cascading) document.addEventListener('pointerdown', reveal);
    setTimeout(reveal, cascading ? 4200 : 550);
  }

  /* ---- auto finish ----------------------------------------------------- */

  function autoFinish() {
    if (autoRunning || game.won) return;
    autoRunning = true;
    UI.setLocked(true);
    UI.clearSelection();
    updateScoreboard();
    var steps = 0;

    function step() {
      if (!autoRunning || steps++ > 400) { stopAuto(); save(); return; }

      var move = game.nextFoundationMove();
      if (move) {
        game.move(move.source, move.target);
        UI.render();
        updateScoreboard();
        if (game.won) { stopAuto(); onMove(); return; }
        setTimeout(step, 90);
        return;
      }

      /* Nothing is ready on the board. Turning the deck is only worth doing
         if a card that can actually surface will go home — otherwise this
         spins through the deck forever achieving nothing. */
      if (game.canAutoFinish() && game.drawsToFoundationPlay() >= 0) {
        game.draw();
        UI.render();
        updateScoreboard();
        setTimeout(step, 60);
        return;
      }

      stopAuto();
      save();
      checkDeadEnd();
    }
    setTimeout(step, 40);
  }

  function stopAuto() {
    autoRunning = false;
    UI.setLocked(false);
    updateScoreboard();
  }

  /* ---- overlays -------------------------------------------------------- */

  function show(node) { node.hidden = false; }
  function hide(node) { node.hidden = true; }

  function closeOverlays() {
    hide(el.pauseOverlay);
    hide(el.winOverlay);
    hide(el.deadOverlay);
    hide(el.menuOverlay);
  }

  function pauseGame() {
    if (game.won || dead) return;
    stopAuto();
    paused = true;
    UI.setLocked(true);
    save();
    el.pauseTitle.textContent = 'Paused';
    el.pauseText.textContent = 'Your game is saved. Close the tab if you like — it will be here when you come back.';
    fillSummary(el.pauseSummary, [
      ['Score', game.score],
      ['Time', formatTime(game.elapsed)],
      ['Moves', game.moves]
    ]);
    show(el.pauseOverlay);
  }

  function resume() {
    paused = false;
    UI.setLocked(false);
    hide(el.pauseOverlay);
    UI.render();
    checkDeadEnd();
  }

  function offerContinue(data) {
    el.pauseTitle.textContent = 'Welcome back';
    el.pauseText.textContent = 'You have a game in progress.';
    fillSummary(el.pauseSummary, [
      ['Score', data.score],
      ['Time', formatTime(data.elapsed)],
      ['Moves', data.moves],
      ['Draw', data.drawCount === 3 ? '3 cards' : '1 card']
    ]);
    paused = true;
    UI.setLocked(true);
    show(el.pauseOverlay);
  }

  /* ---- menu ------------------------------------------------------------ */

  function buildMenu() {
    el.themeTiles.innerHTML = THEMES.map(function (t) {
      var preview = t.id === 'classic'
        ? '<span class="theme-preview pat-lattice" data-back-color="crimson">' +
            '<span class="card-back mini"><span class="back-art"></span></span></span>'
        : '<span class="theme-preview" data-theme="' + t.id + '">' +
            '<svg class="scene" viewBox="0 0 100 140" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
            '<use href="#back-' + t.id + '"></use></svg></span>';
      return '<button class="theme-tile" data-theme-id="' + t.id + '" type="button" aria-label="' + t.name + '">' +
             preview + '<span>' + t.name + '</span></button>';
    }).join('');

    el.themeTiles.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-theme-id]');
      if (!btn) return;
      settings.theme = btn.dataset.themeId;
      persistSettings();
    });

    el.backPatterns.innerHTML = BACK_PATTERNS.map(function (p) {
      return '<button class="swatch pat-' + p.id + '" data-pattern="' + p.id + '" type="button" ' +
             'aria-label="' + p.name + '"><span class="card-back mini"><span class="back-art"></span></span>' +
             '<span class="swatch-name">' + p.name + '</span></button>';
    }).join('');

    el.backColors.innerHTML = BACK_COLORS.map(function (c) {
      return '<button class="swatch swatch-dot" data-color="' + c.id + '" data-back-color="' + c.id + '" ' +
             'type="button" aria-label="' + c.name + '"><span class="dot"></span>' +
             '<span class="swatch-name">' + c.name + '</span></button>';
    }).join('');

    el.backPatterns.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-pattern]');
      if (!btn) return;
      settings.backPattern = btn.dataset.pattern;
      persistSettings();
    });

    el.backColors.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-color]');
      if (!btn) return;
      settings.backColor = btn.dataset.color;
      persistSettings();
    });

    el.drawMode.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-draw]');
      if (!btn) return;
      var value = +btn.dataset.draw;
      if (value === settings.drawCount) return;
      if (game && !game.won && game.moves > 0 &&
          !window.confirm('Switching draw mode starts a new game. Continue?')) return;
      settings.drawCount = value;
      persistSettings();
      abandonCurrent();
      Store.clearGame();
      startGame();
      syncMenu();
    });

    el.optWinnable.addEventListener('change', function () {
      settings.winnableOnly = el.optWinnable.checked;
      persistSettings();
      if (!settings.winnableOnly) return;
      if (game && !game.won && !dead && game.moves > 0 &&
          !window.confirm('Deal a fresh winnable game now? The current one will be lost.')) return;
      abandonCurrent();
      Store.clearGame();
      hide(el.menuOverlay);
      startGame({ closeOverlays: true });
    });
    el.optQuickFoundation.addEventListener('change', function () {
      settings.quickFoundation = el.optQuickFoundation.checked;
      persistSettings();
    });
    el.optHaptics.addEventListener('change', function () {
      settings.haptics = el.optHaptics.checked;
      persistSettings();
    });

    document.querySelectorAll('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('is-active'); });
        document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('is-active'); });
        tab.classList.add('is-active');
        document.querySelector('[data-panel="' + tab.dataset.tab + '"]').classList.add('is-active');
      });
    });

    el.btnResetStats.addEventListener('click', function () {
      if (!window.confirm('Clear all recorded scores and streaks?')) return;
      stats = Store.resetStats();
      renderStats();
      updateScoreboard();
    });
  }

  function persistSettings() {
    Store.saveSettings(settings);
    UI.setSettings(settings);
    syncMenu();
  }

  function syncMenu() {
    var theme = settings.theme || 'classic';
    document.querySelectorAll('[data-theme-id]').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.themeId === theme);
    });
    var classicPreview = el.themeTiles.querySelector('[data-theme-id="classic"] .theme-preview');
    if (classicPreview) {
      classicPreview.className = 'theme-preview pat-' + settings.backPattern;
      classicPreview.dataset.backColor = settings.backColor;
    }
    var chosen = THEMES.filter(function (t) { return t.id === theme; })[0] || THEMES[0];
    el.themeNote.textContent = chosen.blurb;
    el.classicOnly.hidden = theme !== 'classic';

    document.querySelectorAll('[data-pattern]').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.pattern === settings.backPattern);
      b.dataset.backColor = settings.backColor;
    });
    document.querySelectorAll('[data-color]').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.color === settings.backColor);
    });
    document.querySelectorAll('[data-draw]').forEach(function (b) {
      b.classList.toggle('is-active', +b.dataset.draw === settings.drawCount);
    });
    el.optWinnable.checked = !!settings.winnableOnly;
    el.optQuickFoundation.checked = !!settings.quickFoundation;
    el.optHaptics.checked = !!settings.haptics;
  }

  function renderStats() {
    var rate = stats.played ? Math.round((stats.won / stats.played) * 100) : 0;
    fillSummary(el.statsSummary, [
      ['Played', stats.played],
      ['Won', stats.won],
      ['Win rate', rate + '%'],
      ['Best score', stats.bestScore || '—'],
      ['Best time', stats.bestTime ? formatTime(stats.bestTime) : '—'],
      ['Streak', stats.streak + ' (best ' + stats.bestStreak + ')']
    ]);

    if (!stats.wins.length) {
      el.scoreList.innerHTML = '<li class="empty">No wins yet — your best games will show up here.</li>';
      return;
    }
    el.scoreList.innerHTML = stats.wins.map(function (w) {
      var date = new Date(w.date);
      return '<li><span class="score-value">' + w.score + '</span>' +
             '<span class="score-meta">' + formatTime(w.time) + ' · ' + w.moves + ' moves · draw ' +
             (w.draw === 3 ? '3' : '1') + '</span>' +
             '<span class="score-date">' + date.toLocaleDateString() + '</span></li>';
    }).join('');
  }

  /* ---- boot ------------------------------------------------------------ */

  function bindButtons() {
    el.btnUndo.addEventListener('click', function () {
      if (autoRunning) return;
      UI.clearSelection();
      if (game.undo()) {
        hintIndex = 0;
        toast(null);
        UI.render();
        updateScoreboard();
        save();
        checkDeadEnd();
      }
    });
    el.btnHint.addEventListener('click', showHint);
    el.btnAuto.addEventListener('click', autoFinish);
    el.btnPause.addEventListener('click', pauseGame);
    el.btnNew.addEventListener('click', newGame);
    el.btnMenu.addEventListener('click', function () {
      renderStats();
      syncMenu();
      updateScoreboard();
      show(el.menuOverlay);
    });
    el.btnMenuClose.addEventListener('click', function () { hide(el.menuOverlay); });
    el.menuOverlay.addEventListener('click', function (e) {
      if (e.target === el.menuOverlay) hide(el.menuOverlay);
    });

    el.btnSearchCancel.addEventListener('click', function () {
      if (!searching) return;
      searching = false;
      hide(el.searchOverlay);
      installGame(new Klondike({ drawCount: settings.drawCount }));
    });
    el.btnResume.addEventListener('click', resume);
    el.btnPauseNew.addEventListener('click', newGame);
    el.btnDeadNew.addEventListener('click', newGame);
    el.btnDeadUndoAll.addEventListener('click', function () { undoAll(); });
    el.btnUndoAllMenu.addEventListener('click', function () { undoAll({ confirm: true }); });
    el.btnDeadUndo.addEventListener('click', reviveFromDeadEnd);
    el.btnWinNew.addEventListener('click', function () { hide(el.winOverlay); startGame(); });
    el.btnWinClose.addEventListener('click', function () {
      hide(el.winOverlay);
      if (window.Cascade) Cascade.stop();
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { save(); }
    });
    window.addEventListener('pagehide', save);
  }

  function boot() {
    UI.init({
      board: el.board,
      settings: settings,
      hooks: { onMove: onMove }
    });
    UI.setSettings(settings);
    el.buildStamp.textContent = BUILD;
    bindButtons();
    buildMenu();
    syncMenu();
    renderStats();

    var saved = Store.loadGame();
    if (saved && Klondike.isValidSave(saved) && !saved.won) {
      settings.drawCount = saved.drawCount === 3 ? 3 : 1;
      resumeGame(saved);
      offerContinue(saved);
    } else {
      Store.clearGame();
      startGame();
    }
    updateScoreboard();
  }

  /* Small surface for debugging and automated tests. */
  window.KlondikeApp = {
    get game() { return game; },
    get stats() { return stats; },
    get settings() { return settings; },
    get dead() { return dead; },
    hint: showHint,
    undoAll: undoAll,
    checkDeadEnd: checkDeadEnd,
    ui: UI,
    save: save,
    refresh: function () { UI.render(); updateScoreboard(); },
    newGame: newGame
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
