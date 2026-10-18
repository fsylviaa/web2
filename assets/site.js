/* ============================================================
   F.Sylvia 子页面公共脚本
   1. 手机菜单   2. 内容进场动画   3. 复制邮箱
   4. 毛毡小蛋糕鼠标 + 荧光拖尾（和首页一样）
   ============================================================ */
(function () {
  /* ---------- 1. 手机菜单 ---------- */
  var burger = document.getElementById('burger');
  if (burger) burger.addEventListener('click', function () { document.body.classList.toggle('menu-open'); });
  document.querySelectorAll('#overlay a').forEach(function (a) {
    a.addEventListener('click', function () { document.body.classList.remove('menu-open'); });
  });

  /* ---------- 2. 内容进场动画（滚动到才浮上来） ---------- */
  var rises = document.querySelectorAll('.rise');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px' });
    rises.forEach(function (el, i) { el.style.transitionDelay = Math.min(i % 6, 5) * 60 + 'ms'; io.observe(el); });
  } else {
    rises.forEach(function (el) { el.classList.add('in'); });
  }

  /* ---------- 3. 复制邮箱 ---------- */
  var toast = document.createElement('div'); toast.className = 'toast'; document.body.appendChild(toast);
  function showToast(t) { toast.textContent = t; toast.classList.add('show'); setTimeout(function () { toast.classList.remove('show'); }, 1600); }
  document.querySelectorAll('[data-copy]').forEach(function (b) {
    b.addEventListener('click', function () {
      var v = b.getAttribute('data-copy');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(v).then(function () { showToast('已复制 Copied ✓ ' + v); }, function () { location.href = 'mailto:' + v; });
      } else { location.href = 'mailto:' + v; }
    });
  });

  /* ---------- 4. 毛毡小蛋糕鼠标 + 荧光拖尾 ---------- */
  var cake = document.createElement('div'); cake.className = 'cake-cursor'; cake.setAttribute('aria-hidden', 'true');
  var trail = document.createElement('canvas'); trail.className = 'cake-trail'; trail.setAttribute('aria-hidden', 'true');
  document.body.appendChild(trail); document.body.appendChild(cake);
  var tctx = trail.getContext('2d');
  var HOT = 11, cx = -200, cy = -200, lastX = null, swing = 0, swingV = 0, hover = false, press = false, sc = 1;
  var parts = [], trailLast = null, tdpr = 1;
  var OX = 40, OY = 38, LIFE = 34;

  function sizeTrail() {
    tdpr = Math.min(window.devicePixelRatio || 1, 2);
    trail.width = Math.round(window.innerWidth * tdpr);
    trail.height = Math.round(window.innerHeight * tdpr);
  }
  sizeTrail(); window.addEventListener('resize', sizeTrail);

  function addTrail(x, y) {
    var px = x + OX, py = y + OY;
    if (trailLast) {
      var dx = px - trailLast.x, dy = py - trailLast.y, steps = Math.min(12, Math.floor(Math.sqrt(dx * dx + dy * dy) / 6));
      for (var k = 1; k <= steps; k++) { var t = k / (steps + 1); parts.push({ x: trailLast.x + dx * t, y: trailLast.y + dy * t, r: 9 + Math.random() * 4, life: LIFE, max: LIFE, vx: 0, vy: 0, star: false }); }
    }
    parts.push({ x: px, y: py, r: 10 + Math.random() * 4, life: LIFE, max: LIFE, vx: 0, vy: 0, star: false });
    if (Math.random() < 0.35) parts.push({ x: px + (Math.random() - .5) * 18, y: py + (Math.random() - .5) * 18, r: 2 + Math.random() * 2, life: 50, max: 50, vx: (Math.random() - .5) * .6, vy: .3 + Math.random() * .5, star: true });
    trailLast = { x: px, y: py };
    if (parts.length > 500) parts.splice(0, parts.length - 500);
  }
  function burst(x, y) {
    for (var k = 0; k < 14; k++) {
      var a = Math.PI * 2 * k / 14, sp = 1.6 + Math.random() * 1.6;
      parts.push({ x: x + OX * .5, y: y + OY * .5, r: 2.5 + Math.random() * 2, life: 40, max: 40, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, star: true });
    }
  }
  function col(t, a) { return 'rgba(255,' + Math.round(150 + 70 * t) + ',' + Math.round(200 - 110 * t) + ',' + a + ')'; }

  window.addEventListener('mousemove', function (e) {
    cake.classList.add('on');
    addTrail(e.clientX, e.clientY);
    if (lastX !== null) swingV += (e.clientX - lastX) * 0.6;
    lastX = e.clientX; cx = e.clientX; cy = e.clientY;
    var t = e.target; hover = !!(t && t.closest && t.closest('a, button, [data-copy]'));
  });
  document.addEventListener('mouseleave', function () { cake.classList.remove('on'); lastX = null; trailLast = null; });
  window.addEventListener('mousedown', function (e) { press = true; burst(e.clientX, e.clientY); });
  window.addEventListener('mouseup', function () { press = false; });

  (function loop() {
    // 拖尾
    tctx.setTransform(tdpr, 0, 0, tdpr, 0, 0);
    tctx.clearRect(0, 0, trail.width, trail.height);
    tctx.globalCompositeOperation = 'lighter';
    for (var i = parts.length - 1; i >= 0; i--) {
      var q = parts[i];
      q.life--; if (q.life <= 0) { parts.splice(i, 1); continue; }
      q.x += q.vx; q.y += q.vy; q.vx *= .96; q.vy *= .96;
      var f = q.life / q.max;
      if (q.star) {
        var rs = q.r * (0.6 + 0.4 * f);
        tctx.fillStyle = 'rgba(255,248,220,' + (0.9 * f) + ')';
        tctx.shadowColor = 'rgba(255,230,150,' + f + ')'; tctx.shadowBlur = 8;
        tctx.beginPath();
        tctx.moveTo(q.x, q.y - rs * 2); tctx.quadraticCurveTo(q.x, q.y, q.x + rs * 2, q.y);
        tctx.quadraticCurveTo(q.x, q.y, q.x, q.y + rs * 2); tctx.quadraticCurveTo(q.x, q.y, q.x - rs * 2, q.y);
        tctx.quadraticCurveTo(q.x, q.y, q.x, q.y - rs * 2); tctx.fill();
      } else {
        var r = q.r * (0.35 + 0.65 * f);
        var g = tctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, r * 2.2);
        g.addColorStop(0, col(1 - f, 0.75 * f)); g.addColorStop(0.35, col(1 - f, 0.36 * f)); g.addColorStop(1, col(1 - f, 0));
        tctx.shadowBlur = 0; tctx.fillStyle = g;
        tctx.beginPath(); tctx.arc(q.x, q.y, r * 2.2, 0, Math.PI * 2); tctx.fill();
      }
    }
    tctx.shadowBlur = 0;
    // 蛋糕
    swingV += -swing * 0.12; swingV *= 0.78; swing += swingV;
    swing = Math.max(-25, Math.min(25, swing));
    sc += ((press ? 0.86 : (hover ? 1.22 : 1)) - sc) * 0.25;
    cake.style.transform = 'translate(' + (cx - HOT) + 'px,' + (cy - HOT) + 'px) rotate(' + (swing + (hover ? -10 : 0)).toFixed(2) + 'deg) scale(' + sc.toFixed(3) + ')';
    requestAnimationFrame(loop);
  })();
})();
