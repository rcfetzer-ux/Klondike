# Plate images

Drop public-domain natural-history illustrations in this folder and the game
will use them on the card faces instead of the drawn ones.

Turn it on under **Menu → Card backs → Plate images**. With the setting off,
nothing in here is loaded and the game makes no requests at all.

## File names

One image per theme and suit — twelve in total. `.jpg` is tried first, then
`.png`.

| File | Species drawn in the fallback |
| --- | --- |
| `jungle-S.jpg` | Tiger — *Panthera tigris* |
| `jungle-H.jpg` | Toco toucan — *Ramphastos toco* |
| `jungle-D.jpg` | Red-eyed tree frog — *Agalychnis callidryas* |
| `jungle-C.jpg` | Capuchin — *Cebus capucinus* |
| `ocean-S.jpg` | Humpback whale — *Megaptera novaeangliae* |
| `ocean-H.jpg` | Clownfish — *Amphiprion ocellaris* |
| `ocean-D.jpg` | Green sea turtle — *Chelonia mydas* |
| `ocean-C.jpg` | Common octopus — *Octopus vulgaris* |
| `desert-S.jpg` | Dromedary — *Camelus dromedarius* |
| `desert-H.jpg` | Fennec fox — *Vulpes zerda* |
| `desert-D.jpg` | Horned lizard — *Phrynosoma cornutum* |
| `desert-C.jpg` | Fat-tailed scorpion — *Androctonus* |

Anything missing simply falls back to the drawn plate for that suit, so you can
add them one at a time.

## Preparing the images

No preparation is required. Any size works — the browser crops to the card with
`object-fit: cover`, which centres the image and trims the overflow.

Two things are worth doing by hand:

- **Crop to roughly 10:14.5** (the card's proportions) before dropping the file
  in, so `cover` does not cut off the head. Portrait crops centred on the animal
  work best.
- **Keep the files small.** Around 400–600px wide is plenty; a card is about
  47px wide on a phone. Twelve files at ~60KB each is a reasonable target.

Bear in mind the rank and suit sit in the **top-left and bottom-right corners**
over a soft white wash. A crop with the animal's head in one of those corners
will fight with the index.

## Where to find plates

All of these are long out of copyright, but check the licence on the individual
file before committing it:

- **Brehms Tierleben** (1880s) — mammals, birds, reptiles; the classic engraved
  German natural history. Wikimedia Commons has the plates scanned.
- **Ernst Haeckel, *Kunstformen der Natur*** (1904) — outstanding for the marine
  set: *Chelonia* for turtles, *Gamochonia* for cephalopods.
- **Audubon, *Birds of America*** (1827–38) — for the toucan.
- **Bloch, *Allgemeine Naturgeschichte der Fische*** (1780s) — hand-coloured
  fish plates.
- **Biodiversity Heritage Library** (biodiversitylibrary.org) — scans of the
  above and much more, with clear rights statements.

Public domain is not automatic: a photograph of a 3D object can carry a fresh
copyright even when the object is old. Flat reproductions of flat 2D artwork
generally do not, but read the file's licence page rather than assuming.
