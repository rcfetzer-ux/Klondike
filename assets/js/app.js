/* Wires the engine, the board and the chrome together: timer, autosave,
   scoreboard, menu and the card-back picker. */
(function () {
  'use strict';

  var BACK_PATTERNS = [
    { id: 'lattice', name: 'Lattice' },
    { id: 'dots',    name: 'Dots' },
    { id: 'chevron', name: 'Chevron' },
    { id: 'grid',    name: 'Grid' },
    { id: 'stripes', name: 'Stripes' },
    { id: 'classic', name: 'Classic' }
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
   'deadOverlay', 'deadSummary', 'deadText', 'btnDeadNew', 'btnDeadUndo',
   'pauseSummary', 'btnResume', 'btnPauseNew', 'winOverlay', 'winSummary', 'btnWinNew',
   'btnWinClose', 'menuOverlay', 'btnMenuClose', 'backPatterns', 'backColors',
   'drawMode', 'optQuickFoundation', 'optHaptics', 'statsSummary', 'scoreList',
   'btnResetStats'].forEach(function (id) { el[id] = document.getElementById(id); });

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

  function startGame(options) {
    game = new Klondike({ drawCount: settings.drawCount });
    recorded = false;
    dead = false;
    hintIndex = 0;
    paused = false;
    autoRunning = false;
    UI.setLocked(false);
    UI.setGame(game);
    updateScoreboard();
    startTimer();
    save();
    if (options && options.closeOverlays) closeOverlays();
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
    updateScoreboard();
    if (game.won) { handleWin(); return; }
    save();
    if (!autoRunning) checkDeadEnd();
  }

  /* ---- hints ----------------------------------------------------------- */

  /* Every useful move, plus turning the stock over as a last suggestion. */
  function hintList() {
    var list = game.findMoves();
    if (game.canDraw()) list.push({ kind: 'draw' });
    return list;
  }

  function showHint() {
    if (dead || game.won || autoRunning || paused) return;
    var list = hintList();
    if (!list.length) { endDeadGame(); return; }
    if (hintIndex >= list.length) hintIndex = 0;
    UI.showHint(list[hintIndex]);
    hintIndex = (hintIndex + 1) % list.length;
  }

  /* ---- running out of moves -------------------------------------------- */

  function checkDeadEnd() {
    if (dead || paused || game.won || autoRunning) return;
    if (game.isDeadEnd()) endDeadGame();
  }

  function endDeadGame() {
    dead = true;
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
    el.btnDeadUndo.hidden = !game.canUndo();
    show(el.deadOverlay);
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
    setTimeout(function () { show(el.winOverlay); }, 550);
  }

  /* ---- auto finish ----------------------------------------------------- */

  function autoFinish() {
    if (autoRunning || game.won) return;
    autoRunning = true;
    UI.setLocked(true);
    UI.clearSelection();
    updateScoreboard();
    var idleDraws = 0;

    function step() {
      if (!autoRunning) return;
      var move = game.nextFoundationMove();
      if (move) {
        idleDraws = 0;
        game.move(move.source, move.target);
        UI.render();
        updateScoreboard();
        if (game.won) { stopAuto(); onMove(); return; }
        setTimeout(step, 90);
        return;
      }
      // No card is ready: cycle the stock, but only while nothing is hidden.
      if (game.canAutoFinish() && (game.stock.length || game.waste.length) && idleDraws < 60) {
        idleDraws += 1;
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
      if (game.undo()) { hintIndex = 0; UI.render(); updateScoreboard(); save(); }
    });
    el.btnHint.addEventListener('click', showHint);
    el.btnAuto.addEventListener('click', autoFinish);
    el.btnPause.addEventListener('click', pauseGame);
    el.btnNew.addEventListener('click', newGame);
    el.btnMenu.addEventListener('click', function () {
      renderStats();
      syncMenu();
      show(el.menuOverlay);
    });
    el.btnMenuClose.addEventListener('click', function () { hide(el.menuOverlay); });
    el.menuOverlay.addEventListener('click', function (e) {
      if (e.target === el.menuOverlay) hide(el.menuOverlay);
    });

    el.btnResume.addEventListener('click', resume);
    el.btnPauseNew.addEventListener('click', newGame);
    el.btnDeadNew.addEventListener('click', newGame);
    el.btnDeadUndo.addEventListener('click', reviveFromDeadEnd);
    el.btnWinNew.addEventListener('click', function () { hide(el.winOverlay); startGame(); });
    el.btnWinClose.addEventListener('click', function () { hide(el.winOverlay); });

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
    checkDeadEnd: checkDeadEnd,
    ui: UI,
    save: save,
    refresh: function () { UI.render(); updateScoreboard(); },
    newGame: newGame
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
