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
- **Themes and card backs.** Classic gives you six woven back patterns across
  eight colours. Jungle, Ocean and Desert each dress the table, paint a
  landscape on the card backs, and put a themed animal on the face of every
  card — one per suit. All remembered between sessions.
- **Hints.** Press *Hint* to light up a card and where it should go, with a note
  naming the play; press it again to cycle through the other options. When
  nothing on the board moves, the hint points at the stock and says what turning
  it over will bring up — so "keep drawing" is never mistaken for a dead end.
  Pressing *Hint* also re-checks whether the deal is finished.
- **Automatic ending.** When a deal genuinely runs out of plays the game stops
  the clock and says so, offering a new deal or an undo to back out of the move
  that killed it.
- **Winnable deals only** (optional). Every shuffle is run through a solver
  before you see it, and only a deal with a proven winning line is dealt — so a
  loss is down to the line you took, not the cards.
- **The win cascade.** Clear the board and the cards launch off the foundations,
  bounce along the bottom of the screen and stream off the sides, painting
  trails over everything — the Windows Solitaire send-off. Tap to cut it short.
- **Undo all.** Puts every card back where it was dealt and starts the deal
  again from the top, from *Menu → Game* or from the end-of-game screen. The
  opening deal is kept from the moment the cards are dealt, so this reaches the
  start however long the game has run and survives closing the tab.
- **Undo** (deep history), **Auto** to send everything home once the board is
  open, and a choice of **draw 1** or **draw 3**.

### Winnable deals

`assets/js/solver.js` searches for an actual winning line, so "winnable" is a
proof and not an estimate — `tests/solver.test.js` replays each line it finds
through the real game engine and insists the engine itself reports a win.

Two things make it quick enough to run on a phone between deals: turning the
deck is never a move on its own (the generator works out which cards can reach
the top of the waste and offers "turn the deck N times, then play that card" as
one step), and only column moves that turn a card over, clear a column, or free
a card for a foundation are branched on. Finding a verified deal takes a median
of ~120ms and under a second in the worst case on a laptop, a few times that on
a phone; a spinner covers the wait and can be dismissed to take an unchecked
deal.

The solver never pulls cards back off a foundation, which makes it incomplete:
some winnable deals are reported unsolvable and quietly reshuffled. That is the
safe direction to be wrong in — a deal is only ever accepted on a proven win —
but it does mean this setting skips the very hardest deals rather than serving
every winnable one.

### Themes

| Theme | Card back | ♠ | ♥ | ♦ | ♣ |
| --- | --- | --- | --- | --- | --- |
| Jungle | canopy and sun | tiger | toucan | tree frog | monkey |
| Ocean | reef water and moon | whale | clownfish | sea turtle | octopus |
| Desert | dunes at sundown | camel | fennec fox | lizard | scorpion |

The faces are drawn as natural-history plates: aged paper, sepia contour lines,
shading built from hatch and stipple patterns rather than flat blocks, muted
pigments, and a hairline plate rule. Every animal is shown in lateral view — the
convention of the form, and what makes a silhouette read as a species rather
than a mascot at thumbnail size. The scorpion is dorsal, as arthropods are
conventionally plated. The card backs stay decorative: scenery, a woven or
scaled texture, a vignette and a double border.

The artwork is hand-written SVG inlined into `index.html` as a sprite, so the
game stays a single self-contained folder with no image files and no network
requests. That constraint also sets the ceiling: these are stylised line-and-
wash plates, not engravings.

#### Using real plates instead

For the genuine article, drop public-domain illustrations into
`assets/plates/` — `jungle-S.jpg`, `ocean-D.jpg` and so on, one per theme and
suit — and switch on **Menu → Card backs → Plate images**. Any size works;
the browser crops each to the card. A file that is missing or fails to load
uncovers the drawn plate for that suit, so the twelve can be added one at a
time and the game never ends up with a blank card.

Nothing in that folder is touched while the setting is off, so the default
build still makes no network requests at all. `assets/plates/README.md` lists
the file names, the species, and where the classic plates come from —
Brehms Tierleben, Haeckel, Audubon, Bloch, the Biodiversity Heritage Library —
along with the licence caveat worth reading before committing a scan.

`tools/make-test-plate.js` writes a placeholder image if you want to see the
mechanism work before sourcing the real thing.

The animal never touches the corner index. Rank and suit stay exactly where
they are read from, which matters because a fanned column shows only that top
strip, and three things keep them legible over a full-bleed illustration: the
index is painted above the artwork, a soft white wash lifts just those two
corners, and the type carries a white halo and a drop shadow. Each composition
also keeps its subject clear of those corners — the first pass put the camel's
head and the scorpion's pincers exactly where the index sits.

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
index.html            markup, the overlays and the plate artwork sprite
assets/plates/        optional drop-in illustrations (see the README there)
tools/                a placeholder-image generator for testing plates
manifest.json         installs to a phone home screen
assets/css/style.css  all styling, including the card-back patterns
assets/js/cards.js    deck and the stacking rules
assets/js/game.js     game engine: piles, moves, scoring, undo, save/restore
assets/js/cascade.js  the bouncing-cards win animation
assets/js/solver.js   searches for a winning line, for the winnable-deals setting
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
node tests/solver.test.js
```

Alongside the unit tests it plays 120 deals per draw mode to completion,
asserting that every one ends in a win or a declared dead end rather than
cycling the deck forever.

## Updating

Asset URLs carry a `?v=` marker that changes with each release, so phones pick
up new code instead of a cached copy. The current build is shown under
*Menu → Game → Version*; if the game ever behaves like an older version, check
that number and refresh.
