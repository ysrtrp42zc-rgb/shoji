/* vcfix.js —— 加固补丁
   用法：和 index.html 放在同一个文件夹；index.html 里把 <head> 换成下面这一行（只需要改这一处）：
       <head><script src="vcfix.js" defer></script>
   它不改页面里任何内容 / 名字 / 样式，只在“出问题”的时候帮忙补救：
   ① 视频通话：两个视频一打开网页就在后台下好（失败自动重试），点接听马上能播；
      网慢时耐心多等一会儿，不再 6 秒就误报“大视频没加载出来”；误报了，只要视频动起来也会自己消掉
   ② 图片偶尔加载失败（出现小问号）：自动重试（文件本来就不存在的不会反复请求）
   ③ 抖音视频第二次出错后：再自动重试
   网址后面加 ?dbg=1 ，屏幕左上角会显示诊断信息（出问题时截图发给我就行）。 */
(function () {
  'use strict';
  var VER = '1';
  var DBG = /[?&]dbg=1(?:&|$)/.test(location.search);
  var HTTP = /^https?:$/.test(location.protocol);
  var BASE = (typeof A === 'string') ? A : 'assets/';
  var LOG = [], PIN = {}, GONE = [], dbgEl = null, stLine = '';
  var CNT = { imgErr: 0, imgTry: 0, imgOk: 0, imgGone: 0, dyTry: 0 };
  var bigSlot = null, smallSlot = null;

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function paint() {
    if (!DBG) return;
    try {
      if (!dbgEl) {
        dbgEl = document.createElement('pre');
        dbgEl.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;margin:0;padding:3px 5px;max-width:100vw;box-sizing:border-box;font:10px/1.35 Menlo,monospace;color:#7CFC00;background:rgba(0,0,0,.74);pointer-events:none;white-space:pre-wrap;word-break:break-all';
        (document.body || document.documentElement).appendChild(dbgEl);
      }
      var top = Object.keys(PIN).map(function (k) { return PIN[k]; }).join('\n');
      dbgEl.textContent = top + '\n──\n' + LOG.slice(-9).join('\n') + (stLine ? '\n──\n' + stLine : '');
    } catch (e) {}
  }
  function pin(k, v) { if (!DBG) return; PIN[k] = v; paint(); }
  function log() {
    if (!DBG) return;
    var a = [];
    for (var i = 0; i < arguments.length; i++) a.push(String(arguments[i]));
    LOG.push((performance.now() / 1000).toFixed(1) + 's ' + a.join(' '));
    if (LOG.length > 20) LOG.shift();
    paint();
  }

  /* ============ ① 视频通话 ============ */
  /* 页面原来的写法：大视频的 play() 只要被拒绝（不管什么原因）就静音再播。
     但“被拒绝”也可能只是因为地址还没读到 / 补丁正好在换地址（旧的读取被打断），这时静音会白白丢掉声音。
     所以这里只在浏览器真的不让带声音自动播放（NotAllowedError）时才让页面去静音；
     其它原因不静音，由补丁换好地址后重新播放（见下面的 replay）。 */
  function guardPlay(el) {
    try {
      var orig = el.play;
      if (typeof orig !== 'function' || el.__vcg) return;
      el.__vcg = true;
      el.play = function () {
        var p = orig.apply(this, arguments);
        if (!p || typeof p.then !== 'function') return p;
        return p.then(undefined, function (e) {
          if (e && e.name === 'NotAllowedError') throw e;
          log('大视频 play 被拒(' + (e && e.name) + ')：不静音，等补丁换地址重试');
          return undefined;
        });
      };
    } catch (e) {}
  }

  /* 一个视频（大的或小的）的读取过程：
     后台下载 → 下好了就用下好的文件（点接听时不再依赖网速）
     → 没下好就直接读取（和原来一样，按 assets/ 和同文件夹依次试，全部失败还会整轮再试 2 次）
     → 都不行才算“真的失败” */
  function makeSlot(el, names, label, onDead) {
    var S = { el: el, mode: 'none', goodUrl: '', acs: [], cancelled: false, list: [], i: 0, round: 0, meta: false, resume: 0, info: '', gone: {} };
    function show() { pin(label, label + ' [' + S.mode + '] ' + (S.info || '')); }

    function cands() {
      var l = [];
      names.forEach(function (n) { l.push(BASE + n); l.push(n); });
      return l;
    }
    S.cancel = function () {
      S.cancelled = true;
      S.acs.forEach(function (a) { try { a.abort(); } catch (e) {} });
      S.acs = [];
    };
    el.addEventListener('loadedmetadata', function () { S.meta = true; });

    /* 通话中换了地址：重新开始播放，保持有声（只有浏览器真的不让带声音自动播放时才静音） */
    function replay() {
      try {
        if (typeof vc === 'undefined' || vc.st !== 2) return;
        var p = el.play();
        if (p && p.catch) p.catch(function (e) {
          if (e && e.name && e.name !== 'NotAllowedError') return;
          try { el.muted = true; var q = el.play(); if (q && q.catch) q.catch(function () {}); } catch (e2) {}
        });
      } catch (e) {}
    }
    function nextStream() {
      if (S.mode !== 'stream') return;
      if (S.i < S.list.length) { S.meta = false; el.src = S.list[S.i++]; try { el.load(); } catch (e) {} replay(); return; }
      if (S.round < 2) { S.round++; S.i = 0; setTimeout(nextStream, 1500 * S.round); return; }
      S.mode = 'dead'; S.info = '所有地址都读不了'; show();
      log(label, '✗ 所有地址都读不了');
      try { onDead(); } catch (e) {}
    }
    function useStream(why) {
      S.cancel();
      S.mode = 'stream'; S.round = 0; S.i = 0; S.meta = false; S.resume = 0; S.info = why; show();
      var l = cands();
      if (S.goodUrl) l = [S.goodUrl].concat(l.filter(function (u) { return u !== S.goodUrl; }));
      var l2 = l.filter(function (u) { return !S.gone[u]; });
      S.list = l2.length ? l2 : l;
      log(label, '→ 直接读取（' + why + '）');
      nextStream();
    }
    S.onError = function () {
      var code = el.error ? el.error.code : '?';
      S.info = (S.info ? S.info + ' | ' : '') + 'error' + code; show();
      log(label, 'error code=' + code, 'mode=' + S.mode);
      if (S.mode === 'blob') { useStream('下好的文件放不了'); return; }
      if (S.mode !== 'stream') return;
      if (S.meta && S.resume < 2) {
        /* 已经读到过文件头，说明地址是对的，是中途断了：原地再来一次，接着上次的位置 */
        S.resume++;
        var t = el.currentTime || 0, u = S.list[S.i - 1];
        S.meta = false;
        setTimeout(function () {
          if (S.mode !== 'stream') return;
          var f = function () {
            el.removeEventListener('loadedmetadata', f);
            try { if (t > 0) el.currentTime = t; } catch (e) {}
            replay();
          };
          el.addEventListener('loadedmetadata', f);
          el.src = u;
          try { el.load(); } catch (e) {}
        }, 600);
        return;
      }
      nextStream();
    };

    /* 返回 {r,ac}：这个地址能读；'gone'：这个地址确实没有（404 / 被当成网页）；'net'：连续 3 次网络错误；'cancel'：已经不需要了 */
    async function head(url) {
      for (var k = 0; k < 3; k++) {
        if (S.cancelled) return 'cancel';
        var ac = window.AbortController ? new AbortController() : null;
        if (ac) S.acs.push(ac);
        var tm = ac ? setTimeout(function (c) { try { c.abort(); } catch (e) {} }, 25000, ac) : 0;
        try {
          var r = await fetch(url, ac ? { signal: ac.signal, priority: 'high' } : { priority: 'high' });
          clearTimeout(tm);
          if (r.ok) {
            var ct = (r.headers.get('content-type') || '').toLowerCase();
            if (ct.indexOf('text/html') !== 0) return { r: r, ac: ac };
          }
          if (ac) { try { ac.abort(); } catch (e) {} }
          if (r.ok || (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429)) { S.gone[url] = true; return 'gone'; }
        } catch (e) {
          clearTimeout(tm);
          if (S.cancelled) return 'cancel';
        }
        await sleep(600 * (k + 1));
      }
      return 'net';
    }
    async function find(name) {
      var urls = [BASE + name, name];
      var rs = await Promise.all(urls.map(head));
      for (var i = 0; i < rs.length; i++) {
        if (rs[i] && rs[i].r) {
          for (var j = 0; j < rs.length; j++) {
            if (j !== i && rs[j] && rs[j].ac) { try { rs[j].ac.abort(); } catch (e) {} }
          }
          return { url: urls[i], r: rs[i].r };
        }
      }
      if (rs.indexOf('cancel') >= 0) return 'cancel';
      if (rs.indexOf('net') >= 0) return 'net';
      return 'gone';
    }
    async function prefetch() {
      var t0 = performance.now(), sawNet = false;
      for (var ni = 0; ni < names.length; ni++) {
        for (var at = 0; at < 3; at++) {
          if (S.cancelled) return 'cancel';
          var f = await find(names[ni]);
          if (S.cancelled || f === 'cancel') return 'cancel';
          if (f === 'gone') break;
          if (f === 'net') { sawNet = true; break; }
          S.goodUrl = f.url;
          try {
            var b = await f.r.blob();
            var blob = new Blob([b], { type: 'video/mp4' });
            var ms = Math.max(1, performance.now() - t0);
            S.info = f.url + ' ' + (blob.size / 1024 | 0) + 'KB 用时' + (ms | 0) + 'ms (' + ((blob.size / 1024) / (ms / 1000) | 0) + 'KB/s)';
            log(label, '已下载', S.info);
            return blob;
          } catch (e) {
            sawNet = true;
            if (S.cancelled) return 'cancel';
            log(label, '下载中断，重试', at + 1);
            await sleep(800 * (at + 1));
          }
        }
      }
      return sawNet ? 'net' : 'gone';
    }
    S.begin = function () {
      if (!HTTP || typeof fetch !== 'function' || typeof Promise === 'undefined') { useStream('本地打开 / 不支持后台下载'); return; }
      S.mode = 'fetching'; show();
      prefetch().then(function (blob) {
        if (S.cancelled || blob === 'cancel') return;
        if (blob === 'gone') {   /* assets/ 和同文件夹里都确实没有这个文件：不用再试了 */
          S.mode = 'dead'; S.info = '文件不存在（assets/ 和同文件夹都没有）'; show(); log(label, '✗ 文件不存在（assets/ 和同文件夹都没有）');
          try { onDead(); } catch (e) {}
          return;
        }
        if (typeof blob === 'string') { useStream('后台没下到（网络）'); return; }
        S.mode = 'blob'; show();
        el.src = URL.createObjectURL(blob);
        log(label, '→ 用已下载的文件');
      }).catch(function (e) {
        log(label, 'prefetch 异常', e);
        if (!S.cancelled) useStream('异常');
      });
    };
    /* 点“接听”的那一下：还没下好的话，立刻改成直接读取（播放必须在点击里开始，声音才不会被浏览器拦住） */
    S.beforeAnswer = function () {
      if (S.mode === 'fetching' || S.mode === 'none') useStream('接听时还没下完');
    };
    /* 保险：下好的文件接听后一直不起播（个别手机上对这种地址不买账），改成直接读取并重新播放 */
    S.rescue = function (why) {
      if (S.mode !== 'blob') return;
      useStream(why);      /* 里面换完地址会自动重新播放（replay） */
    };
    return S;
  }

  function callFix() {
    if (typeof vc === 'undefined' || typeof VC === 'undefined' || typeof vcSync !== 'function' || typeof vcAnswer !== 'function' ||
        typeof vcBigFail !== 'function' || typeof vcEndAt !== 'function') { log('没找到视频通话代码，跳过'); return; }
    var big = document.getElementById('vcbig'), small = document.getElementById('vcsm');
    if (!big || !small) { log('没找到视频元素，跳过'); return; }

    var _bigFail = window.vcBigFail, _sync = window.vcSync, _answer = window.vcAnswer;
    var hard = false;                       /* true = 所有地址、所有重试都用完了，真的读不到 */
    guardPlay(big);

    /* 先把页面原来的读取停掉（它们的出错处理在下面被拦截，不会再改 vc.fail） */
    [big, small].forEach(function (v) { try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {} });
    vc.fail = false; vc.sfail = false;

    bigSlot = makeSlot(big, VC.big, '大视频', function () { hard = true; try { _bigFail(); } catch (e) {} });
    smallSlot = makeSlot(small, [VC.small], '小视频', function () { try { vc.sfail = true; } catch (e) {} });

    /* 旧代码“接听后 6 秒大视频还没动就判失败”：网慢时太急了。改成 30 秒；真的读不到（hard）则马上提示 */
    window.vcBigFail = function () {
      if (!hard && !(vc.st === 2 && performance.now() - vc.t0 > 30000)) return;
      return _bigFail.apply(this, arguments);
    };
    /* 每 50 毫秒的对时前先看一眼：如果之前被误判为失败，但大视频其实在正常播放，就恢复并把提示去掉 */
    window.vcSync = function () {
      try {
        if (vc.st === 2 && !hard && bigSlot.mode === 'blob' && !bigSlot.guard && performance.now() - vc.t0 > 3500) {
          var bb = document.getElementById('vcbig');
          if (bb && bb.currentTime < 0.001 && bb.readyState < 3) { bigSlot.guard = true; bigSlot.rescue('下好的文件接听 3.5 秒没起播'); }
        }
        if (vc.st === 2 && vc.fail && !hard) {
          var b = document.getElementById('vcbig');
          if (b && !b.paused && !b.ended && b.readyState >= 3 && b.currentTime > 0.001) {
            vc.fail = false;
            var e = document.getElementById('vcer'); if (e) e.classList.remove('on');
            log('大视频其实在播放，已恢复');
          }
        }
      } catch (e) {}
      return _sync.apply(this, arguments);
    };
    window.vcAnswer = function () {
      try { bigSlot.beforeAnswer(); smallSlot.beforeAnswer(); } catch (e) { log('beforeAnswer 出错', e); }
      log('接听');
      return _answer.apply(this, arguments);
    };
    /* 原来“大视频放完就挂断”的监听，保持一样 */
    big.addEventListener('ended', function () { var d = big.duration; vcEndAt(Math.min(VC.endAt, isFinite(d) && d > 0 ? d : VC.endAt)); });

    window.__vcfix.big = bigSlot; window.__vcfix.small = smallSlot;   /* 方便排查问题 */
    bigSlot.begin(); smallSlot.begin();

    if (DBG) {
      setInterval(function () {
        try {
          var b = document.getElementById('vcbig'), s = document.getElementById('vcsm');
          stLine = '通话 st=' + vc.st + ' fail=' + (+vc.fail) + ' 大[' + bigSlot.mode + '] rs=' + b.readyState + ' t=' + b.currentTime.toFixed(1) + ' p=' + (+b.paused) +
                   ' 小[' + smallSlot.mode + '] rs=' + s.readyState + ' t=' + s.currentTime.toFixed(1) +
                   '\n图片 出错' + CNT.imgErr + ' 重试' + CNT.imgTry + ' 救回' + CNT.imgOk + ' 文件不存在' + CNT.imgGone + '  抖音视频重试' + CNT.dyTry +
                   (GONE.length ? '\n服务器上找不到的图片(' + GONE.length + '): ' + GONE.slice(0, 14).join(' ') + (GONE.length > 14 ? ' …' : '') : '');
          paint();
        } catch (e) {}
      }, 1000);
    }
  }

  /* ============ ② 图片出错重试 ============ */
  /* 先用 HEAD 问一下服务器：文件确实不存在（404）就不再重试，只有“网络错误 / 服务器忙”才重试；
     同一个地址只问一次，不管页面里有几张图用它 */
  function headOf(url) {   /* → 状态码；0 = 网络错误；-1 = 被网站当成网页返回（等于没有这个文件） */
    return fetch(url, { method: 'HEAD' }).then(function (r) {
      var ct = (r.headers.get('content-type') || '').toLowerCase();
      if (r.ok && ct.indexOf('text/html') === 0) return -1;
      return r.status;
    }, function () { return 0; });
  }
  function isGone(s) { return s === 404 || s === -1 || (s >= 400 && s < 500 && s !== 405 && s !== 408 && s !== 429); }
  var IMGS = {};
  function primaryOf(u, img) {
    /* 页面原有的兜底会把 assets/xxx 改成同文件夹的 xxx；这里还原成最初的 assets/xxx */
    if (u.indexOf(BASE) < 0 && img.dataset && img.dataset.fb2) return u.replace(/([^\/?#]+)(\?.*)?$/, BASE + '$1$2');
    return u;
  }
  function imgError(t) {
    if (typeof fetch !== 'function') return;
    var u = t.getAttribute('src') || '';
    if (!u || /^(data|blob):/i.test(u)) return;
    var first = primaryOf(u, t);
    var rec = IMGS[first] || (IMGS[first] = { tries: 0, gone: false, busy: false, els: [] });
    CNT.imgErr++;
    if (rec.gone) return;
    if (rec.els.indexOf(t) < 0) rec.els.push(t);
    if (rec.busy || rec.tries >= 3) return;
    rec.busy = true;
    setTimeout(function () { checkImg(rec, first); }, (rec.tries === 0 ? 1200 : 2500 * rec.tries) + Math.random() * 1200);
  }
  function checkImg(rec, first) {
    rec.tries++;
    headOf(first).then(function (s) {
      var short = first.split('/').slice(-1)[0];
      if (isGone(s)) { rec.gone = true; rec.busy = false; rec.els = []; CNT.imgGone++; if (GONE.indexOf(short) < 0) GONE.push(short); return; }
      if ((s >= 200 && s < 300) || s === 405 || s === 501) {   /* 405/501：服务器不支持 HEAD，当作文件在，直接重新读 */
        rec.busy = false;
        var els = rec.els; rec.els = [];
        els.forEach(function (el) {
          if (el.complete && el.naturalWidth > 0) return;                              /* 已经好了 */
          if (primaryOf(el.getAttribute('src') || '', el) !== first) return;           /* 页面自己换过图片了：不去干扰 */
          CNT.imgTry++; el.src = first;
        });
        log('图片重试', rec.tries, short);
        return;
      }
      /* 网络错误 / 服务器忙：稍后再来 */
      if (rec.tries < 3) setTimeout(function () { checkImg(rec, first); }, 2500 * rec.tries + Math.random() * 1200);
      else { rec.busy = false; log('图片放弃', short); }
    });
  }
  function scanBroken() {
    var imgs = document.getElementsByTagName('img');
    for (var i = 0; i < imgs.length; i++) {
      var t = imgs[i];
      if (t.getAttribute('src') && t.complete && t.naturalWidth === 0) imgError(t);
    }
  }

  /* ============ ③ 抖音视频出错重试 ============ */
  function dyError(v) {
    if (typeof fetch !== 'function') return;
    if (!v.dataset || !v.dataset.t) return;                /* 第一次出错：页面自己会换成同文件夹的地址再试，不插手 */
    var n = v.dataset.n || ''; if (!n) return;
    var st = v.__vr || (v.__vr = { tries: 0, busy: false, gone: false });
    if (st.busy || st.gone || st.tries >= 4) return;
    st.busy = true;
    setTimeout(function () { dyCheck(v, n, st); }, 1200 * (st.tries + 1) + Math.random() * 500);
  }
  function dyCheck(v, n, st) {
    st.tries++;
    var urls = [BASE + n, n];
    Promise.all(urls.map(headOf)).then(function (rs) {
      var k = -1;
      for (var i = 0; i < rs.length; i++) if ((rs[i] >= 200 && rs[i] < 300) || rs[i] === 405 || rs[i] === 501) { k = i; break; }
      if (k >= 0) {
        st.busy = false;
        var it = v.closest ? v.closest('.dyi') : null, m = it && it.querySelector('.dyerr');
        if (m && m.parentNode) m.parentNode.removeChild(m);
        CNT.dyTry++; log('抖音视频重试', st.tries, urls[k]);
        v.src = urls[k];
        return;
      }
      if (rs.every(isGone)) { st.gone = true; st.busy = false; log('抖音视频文件确实不存在', n); return; }
      if (st.tries < 4) setTimeout(function () { dyCheck(v, n, st); }, 1500 * (st.tries + 1));
      else { st.busy = false; log('抖音视频放弃', n); }
    });
  }

  /* 一个总的 error 监听（捕获阶段，在页面自己的处理之前执行） */
  window.addEventListener('error', function (e) {
    var t = e.target;
    if (!t || !t.tagName) return;
    try {
      if (t.tagName === 'VIDEO') {
        if (bigSlot && t === bigSlot.el) { e.stopImmediatePropagation(); bigSlot.onError(); return; }
        if (smallSlot && t === smallSlot.el) { e.stopImmediatePropagation(); smallSlot.onError(); return; }
        if (HTTP && t.closest && t.closest('.dyi')) dyError(t);
      } else if (t.tagName === 'IMG' && HTTP) {
        imgError(t);
      }
    } catch (x) {}
  }, true);
  window.addEventListener('load', function (e) {
    var t = e.target;
    if (t && t.tagName === 'IMG' && t.__vf && t.__vf.n > 0 && t.naturalWidth > 0) { CNT.imgOk++; log('图片救回来了', (t.getAttribute('src') || '').split('/').slice(-2).join('/')); }
  }, true);

  function boot() {
    pin('env', 'vcfix v' + VER + ' ' + (HTTP ? 'http' : 'file') + ' fetch=' + (typeof fetch) + ' ' + (navigator.userAgent || '').replace('Mozilla/5.0 ', '').slice(0, 60));
    try { callFix(); } catch (e) { log('callFix 出错', e && e.message); }
    try { if (HTTP) { scanBroken(); setTimeout(scanBroken, 4000); } } catch (e) {}
  }
  window.__vcfix = { ver: VER };
  if (typeof vc === 'undefined' && document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
