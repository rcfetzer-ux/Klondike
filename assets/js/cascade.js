/* The Windows Solitaire win cascade: cards launch off the foundations,
   bounce along the bottom of the screen and stream off the sides, painting
   over everything as they go.

   The trails are the whole point, so the canvas is never cleared — each
   frame stamps every card at its new position on top of what came before. */
var Cascade = (function () {
  'use strict';

  var GRAVITY = 0.42;
  var BOUNCE = 0.84;            // how much speed survives hitting the floor
  var LAUNCH_EVERY = 5;         // frames between cards leaving the foundations
  var MAX_FRAMES = 60 * 25;     // a hard stop, in case a card never leaves

  var canvas = null;
  var ctx = null;
  var frame = 0;
  var raf = null;
  var queue = [];
  var flying = [];
  var done = null;

  function start(options) {
    stop();
    var cards = (options && options.cards) || [];
    if (!cards.length) return false;
    done = options.onDone || null;

    canvas = document.createElement('canvas');
    canvas.className = 'cascade';
    var ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * ratio);
    canvas.height = Math.floor(window.innerHeight * ratio);
    document.body.appendChild(canvas);

    ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);

    /* Interleave the foundations so all four piles empty together, the way
       the original does. */
    queue = cards.slice();
    flying = [];
    frame = 0;
    raf = window.requestAnimationFrame(tick);
    return true;
  }

  function launch(card) {
    var direction = Math.random() < 0.5 ? -1 : 1;
    flying.push({
      card: card,
      x: card.x,
      y: card.y,
      vx: direction * (1.6 + Math.random() * 4.2),
      vy: -(1 + Math.random() * 3)
    });
  }

  function tick() {
    frame += 1;

    if (queue.length && frame % LAUNCH_EVERY === 0) launch(queue.shift());

    var floor = window.innerHeight;
    for (var i = flying.length - 1; i >= 0; i--) {
      var f = flying[i];
      f.vy += GRAVITY;
      f.x += f.vx;
      f.y += f.vy;

      if (f.y + f.card.h > floor) {
        f.y = floor - f.card.h;
        f.vy = -Math.abs(f.vy) * BOUNCE;
        if (Math.abs(f.vy) < 2) f.vy = -2;     // never settle: keep it moving
      }

      draw(f);

      if (f.x + f.card.w < -20 || f.x > window.innerWidth + 20) flying.splice(i, 1);
    }

    if ((!queue.length && !flying.length) || frame > MAX_FRAMES) {
      raf = null;
      if (done) done();
      return;
    }
    raf = window.requestAnimationFrame(tick);
  }

  /* A simplified card face: the rank and suit in the corner, as the
     original's bitmaps read at speed. */
  function draw(f) {
    var c = f.card;
    var r = Math.max(3, c.w * 0.12);

    ctx.save();
    ctx.beginPath();
    roundRect(ctx, f.x, f.y, c.w, c.h, r);
    ctx.fillStyle = '#fdfdfb';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.stroke();

    ctx.fillStyle = c.red ? '#cf2a2a' : '#1c2321';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '700 ' + Math.round(c.w * 0.34) + 'px -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(c.label, f.x + c.w * 0.1, f.y + c.h * 0.05);
    ctx.font = Math.round(c.w * 0.3) + 'px -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(c.symbol, f.x + c.w * 0.1, f.y + c.h * 0.3);

    ctx.textAlign = 'center';
    ctx.font = Math.round(c.w * 0.5) + 'px -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(c.symbol, f.x + c.w * 0.55, f.y + c.h * 0.52);
    ctx.restore();
  }

  function roundRect(context, x, y, w, h, r) {
    context.moveTo(x + r, y);
    context.arcTo(x + w, y, x + w, y + h, r);
    context.arcTo(x + w, y + h, x, y + h, r);
    context.arcTo(x, y + h, x, y, r);
    context.arcTo(x, y, x + w, y, r);
    context.closePath();
  }

  function stop() {
    if (raf) window.cancelAnimationFrame(raf);
    raf = null;
    queue = [];
    flying = [];
    frame = 0;
    done = null;
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    canvas = null;
    ctx = null;
  }

  function isRunning() { return raf !== null; }

  return { start: start, stop: stop, isRunning: isRunning };
})();
