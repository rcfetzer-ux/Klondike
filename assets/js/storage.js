/* localStorage wrappers: saved game, settings and the scoreboard.
   Everything is guarded so the game still runs in private-browsing modes
   where localStorage throws. */
var Store = (function () {
  'use strict';

  var KEY_GAME = 'klondike.save.v1';
  var KEY_SETTINGS = 'klondike.settings.v1';
  var KEY_STATS = 'klondike.stats.v1';

  var available = (function () {
    try {
      var k = '__klondike_test__';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  })();

  var memory = {};

  function read(key) {
    try {
      var raw = available ? window.localStorage.getItem(key) : memory[key];
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function write(key, value) {
    var raw = JSON.stringify(value);
    try {
      if (available) window.localStorage.setItem(key, raw);
      else memory[key] = raw;
    } catch (e) {
      memory[key] = raw;
    }
  }

  function remove(key) {
    try {
      if (available) window.localStorage.removeItem(key);
    } catch (e) { /* ignore */ }
    delete memory[key];
  }

  var DEFAULT_SETTINGS = {
    theme: 'classic',
    plateImages: false,
    backPattern: 'lattice',
    backColor: 'crimson',
    drawCount: 1,
    winnableOnly: false,
    quickFoundation: true,
    haptics: true
  };

  var DEFAULT_STATS = {
    played: 0,
    won: 0,
    streak: 0,
    bestStreak: 0,
    bestScore: 0,
    bestTime: 0,
    wins: []
  };

  function loadSettings() {
    var saved = read(KEY_SETTINGS) || {};
    var out = {};
    Object.keys(DEFAULT_SETTINGS).forEach(function (k) {
      out[k] = saved[k] === undefined ? DEFAULT_SETTINGS[k] : saved[k];
    });
    return out;
  }

  function loadStats() {
    var saved = read(KEY_STATS) || {};
    var out = {};
    Object.keys(DEFAULT_STATS).forEach(function (k) {
      out[k] = saved[k] === undefined ? DEFAULT_STATS[k] : saved[k];
    });
    if (!Array.isArray(out.wins)) out.wins = [];
    return out;
  }

  /* Records a finished game and keeps the five best runs. */
  function recordResult(stats, result) {
    stats.played += 1;
    if (result.won) {
      stats.won += 1;
      stats.streak += 1;
      stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
      if (result.score > stats.bestScore) stats.bestScore = result.score;
      if (!stats.bestTime || result.time < stats.bestTime) stats.bestTime = result.time;
      stats.wins.push({
        score: result.score,
        time: result.time,
        moves: result.moves,
        draw: result.draw,
        date: Date.now()
      });
      stats.wins.sort(function (a, b) { return b.score - a.score || a.time - b.time; });
      stats.wins = stats.wins.slice(0, 5);
    } else {
      stats.streak = 0;
    }
    saveStats(stats);
    return stats;
  }

  function saveSettings(s) { write(KEY_SETTINGS, s); }
  function saveStats(s) { write(KEY_STATS, s); }
  function saveGame(g) { write(KEY_GAME, g); }
  function loadGame() { return read(KEY_GAME); }
  function clearGame() { remove(KEY_GAME); }
  function resetStats() { remove(KEY_STATS); return loadStats(); }

  return {
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    loadStats: loadStats,
    saveStats: saveStats,
    resetStats: resetStats,
    recordResult: recordResult,
    saveGame: saveGame,
    loadGame: loadGame,
    clearGame: clearGame,
    persistent: available
  };
})();
