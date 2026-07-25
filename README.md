# Klondike Solitaire

A simple game of Klondike solitaire built for phones. No frameworks, no build
step, no network calls — open `index.html` and play.

## Features

- **Touch-first board.** Drag a card (or a whole run) with your finger, or tap
  a card and then tap where it should go. Tapping a selected card a second time
  sends it straight to its foundation.
- **Scoreboard.** Live score, elapsed time and move count while you play, plus a
  persistent record of games played, games won, win rate, best score, best time,
  current/best streak and your five best games.
- **Stop and continue.** Every move is saved. Hit *Pause*, close the tab, come
  back tomorrow — the game reopens exactly where you left it, clock included.
- **Customisable card backs.** Six patterns × eight colours, remembered between
  sessions.
- **Hints.** Press *Hint* to light up a card and where it should go; press it
  again to cycle through the other options. When nothing on the board moves, the
  hint points at the stock instead.
- **Automatic ending.** When a deal genuinely runs out of plays the game stops
  the clock and says so, offering a new deal or an undo to back out of the move
  that killed it.
- **Undo** (deep history), **Auto** to send everything home once the board is
  open, and a choice of **draw 1** or **draw 3**.

### What counts as "no moves left"

The game ends when no move would *advance* the deal and nothing still in the
stock or waste can be placed anywhere. Moves that advance the deal are: playing
to a foundation, playing a card off the waste, moving a run that turns a
face-down card over or clears a column, and splitting a run to free the card
beneath it for a foundation. Sliding a run between two interchangeable parents
is not counted — it rearranges the board without getting anywhere, and treating
it as a move would mean the game could never end.

"Nothing left to turn up can help" accounts for the draw mode. Drawing one at a
time brings every card to the top of the waste eventually, but drawing three at
a time only ever surfaces every third card, and recycling deals them in the same
order — so the rest stay buried for good. The check simulates the deck cycle to
work out which cards genuinely surface, and ignores the ones that never will.

## Rules and scoring

Standard Klondike: build the four foundations up from Ace to King in suit, and
stack the tableau down in alternating colours. Only a King moves into an empty
column. Scoring follows the familiar Windows convention:

| Action | Score |
| --- | --- |
| Waste → tableau | +5 |
| Waste or tableau → foundation | +10 |
| Turning over a face-down tableau card | +5 |
| Foundation → tableau | −15 |
| Recycling the stock (draw-1 only) | −100 |
| Winning | + time bonus (`70000 / seconds`, over 30s) |

The score never drops below zero.

## Running it

Any static host works, and so does opening the file directly:

```sh
# straight from disk
open index.html

# or over http, which is what browsers need for the saved-game feature
npx http-server -p 8000
```

Browsers block `localStorage` on `file://` URLs, so **serve the folder over HTTP
if you want games and settings to persist** — on a real deployment (GitHub Pages
or any static host) this is automatic.

## Layout

```
index.html            markup and the overlays
manifest.json         installs to a phone home screen
assets/css/style.css  all styling, including the card-back patterns
assets/js/cards.js    deck and the stacking rules
assets/js/game.js     game engine: piles, moves, scoring, undo, save/restore
assets/js/storage.js  localStorage for the save, settings and scoreboard
assets/js/ui.js       board layout, rendering, drag and tap handling
assets/js/app.js      timer, autosave, scoreboard, menu wiring
```

The engine in `game.js` is pure state and has no DOM dependencies, so the rules
can be exercised on their own; `ui.js` positions all 52 card elements from a
single layout pass and lets CSS transitions do the animating.

## Tests

`tests/engine.test.js` exercises the rules, scoring, undo and save/restore paths
with no dependencies:

```sh
node tests/engine.test.js
```
