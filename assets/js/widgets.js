/* Card widgets. A card embeds one with a fenced block:
     ```plot     {"x":[a,b], "y":[a,b]?, "fns":[{"f":"expr in x","label":"..."}], "vlines":[{"x":..,"label":".."}], "hline":0, "xlabel":"", "ylabel":""}
     ```widget   {"type":"sliders"|"brownian"|"clt", ...}
   Expressions are plain JavaScript over x with Math names in scope (exp, log, sqrt, PI, max...) plus
   N (normal cdf), phi (normal pdf), bsCall(S,K,r,sigma,T), bsPut(S,K,r,sigma,T). */
"use strict";
const Widgets = (() => {
  const tok = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const SERIES = ["--accent", "--hl", "--b2", "--b3", "--b4"];

  const erf = x => { const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x);
    return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); };
  const N = x => 0.5 * (1 + erf(x / Math.SQRT2));
  const phi = x => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
  const bsD = (S, K, r, s, T) => { const d1 = (Math.log(S / K) + (r + s * s / 2) * T) / (s * Math.sqrt(T)); return [d1, d1 - s * Math.sqrt(T)]; };
  const bsCall = (S, K, r, s, T) => { const [d1, d2] = bsD(S, K, r, s, T); return S * N(d1) - K * Math.exp(-r * T) * N(d2); };
  const bsPut = (S, K, r, s, T) => bsCall(S, K, r, s, T) - S + K * Math.exp(-r * T);
  const SCOPE = Object.assign(Object.create(null), ...Object.getOwnPropertyNames(Math).map(k => ({ [k]: Math[k] })), { N, phi, bsCall, bsPut });

  // Compiled in sloppy mode on purpose so `with` can expose the scope.
  const compile = (expr, params = []) => new Function("H", ...params, "x", `with(H){return (${expr});}`).bind(null, SCOPE);

  const randn = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

  /* ---------- SVG function plot (static and slider) ---------- */
  function makePlot(fig, spec) {
    const W = 640, H = 340, m = { l: 58, r: 18, t: 18, b: 46 };
    const NS = "http://www.w3.org/2000/svg";
    const svg = d3.select(fig).append("svg").attr("viewBox", [0, 0, W, H]).attr("role", "img")
      .attr("aria-label", spec.title || spec.ylabel || "plot");
    const x = d3.scaleLinear().domain(spec.x).range([m.l, W - m.r]);
    const y = d3.scaleLinear().range([H - m.b, m.t]);
    const gGrid = svg.append("g").attr("class", "w-grid");
    const gx = svg.append("g").attr("class", "w-axis").attr("transform", `translate(0,${H - m.b})`);
    const gy = svg.append("g").attr("class", "w-axis").attr("transform", `translate(${m.l},0)`);
    const gRef = svg.append("g"), gLines = svg.append("g");
    if (spec.xlabel) svg.append("text").attr("class", "w-lab").attr("x", (m.l + W - m.r) / 2).attr("y", H - 8).attr("text-anchor", "middle").text(spec.xlabel);
    if (spec.ylabel) svg.append("text").attr("class", "w-lab").attr("transform", `translate(14,${(m.t + H - m.b) / 2}) rotate(-90)`).attr("text-anchor", "middle").text(spec.ylabel);
    const xs = d3.range(0, 401).map(i => spec.x[0] + (spec.x[1] - spec.x[0]) * i / 400);

    function draw(series) { // series: [{pts,label,color,dash}]
      const all = series.flatMap(s => s.pts.map(p => p[1])).filter(Number.isFinite);
      let dom = spec.y || d3.extent(all);
      if (!spec.y) { const pad = (dom[1] - dom[0]) * 0.06 || 1; dom = [Math.min(dom[0], 0) === 0 && dom[0] >= 0 ? 0 : dom[0] - pad, dom[1] + pad]; }
      y.domain(dom).nice();
      gx.call(d3.axisBottom(x).ticks(7).tickSizeOuter(0));
      gy.call(d3.axisLeft(y).ticks(6).tickSizeOuter(0));
      gGrid.selectAll("line").data(y.ticks(6)).join("line").attr("x1", m.l).attr("x2", W - m.r).attr("y1", d => y(d)).attr("y2", d => y(d));
      gRef.selectAll("*").remove();
      if (spec.hline != null) gRef.append("line").attr("class", "w-vl").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(spec.hline)).attr("y2", y(spec.hline));
      (spec.vlines || []).forEach((v, i) => {
        gRef.append("line").attr("class", "w-vl").attr("x1", x(v.x)).attr("x2", x(v.x)).attr("y1", m.t).attr("y2", H - m.b);
        const right = x(v.x) < W - 120;
        gRef.append("text").attr("class", "w-vl-t").attr("x", x(v.x) + (right ? 5 : -5)).attr("y", m.t + 12 + i * 14)
          .attr("text-anchor", right ? "start" : "end").text(v.label || "");
      });
      const line = d3.line().defined(p => Number.isFinite(p[1]) && p[1] >= y.domain()[0] - 1e9).x(p => x(p[0])).y(p => y(Math.max(y.domain()[0], Math.min(y.domain()[1], p[1]))));
      gLines.selectAll("path").data(series).join("path").attr("fill", "none").attr("stroke-width", 2.4)
        .attr("stroke", s => s.color).attr("stroke-dasharray", s => s.dash ? "6 5" : null).attr("d", s => line(s.pts));
    }
    const sample = (f, args = []) => xs.map(v => { let r; try { r = f(...args, v); } catch (e) { r = NaN; } return [v, r]; });
    return { draw, sample, svg };
  }

  function legend(fig, items) {
    const lg = el("div", "w-legend");
    items.forEach(it => { const s = el("span"); const i = el("i", it.dash ? "dash" : ""); i.style.borderTopColor = it.color; s.append(i, document.createTextNode(it.label)); lg.append(s); });
    fig.append(lg);
  }

  function plot(fig, spec) {
    const P = makePlot(fig, spec);
    const series = (spec.fns || []).map((f, i) => ({ pts: P.sample(compile(f.f)), label: f.label || f.f, color: `var(${SERIES[i % SERIES.length]})`, dash: f.dash }));
    P.draw(series);
    if (series.length > 1 || (series[0] && series[0].label)) legend(fig, series);
  }

  function sliders(fig, spec) {
    const names = Object.keys(spec.params || {});
    const P = makePlot(fig, spec);
    const f = compile(spec.f, names);
    const stat = (spec.static || []).map(s => ({ pts: P.sample(compile(s.f)), label: s.label || s.f, color: "var(--muted)", dash: true }));
    const vals = Object.fromEntries(names.map(n => [n, spec.params[n].value]));
    const ctr = el("div", "w-controls");
    const outs = {};
    names.forEach(n => {
      const p = spec.params[n], id = `w-${Math.random().toString(36).slice(2, 8)}`;
      const lab = el("label"); lab.htmlFor = id;
      const inp = Object.assign(el("input"), { type: "range", id, min: p.min, max: p.max, step: p.step || (p.max - p.min) / 100, value: p.value });
      const out = el("output"); outs[n] = out;
      lab.append(document.createTextNode(p.label || n), inp, out);
      inp.addEventListener("input", () => { vals[n] = +inp.value; redraw(); });
      ctr.append(lab);
    });
    function redraw() {
      names.forEach(n => outs[n].textContent = (+vals[n]).toFixed(2));
      P.draw([...stat, { pts: P.sample(f, names.map(n => vals[n])), label: (spec.label || spec.ylabel || "value"), color: "var(--accent)" }]);
    }
    redraw();
    legend(fig, [{ label: (spec.label || spec.ylabel || "value"), color: "var(--accent)" }, ...stat]);
    fig.append(ctr);
  }

  /* ---------- canvas animations ---------- */
  function canvasBox(fig, h = 560) {
    const c = el("canvas"); c.width = 1280; c.height = h; fig.append(c);
    const ctr = el("div", "w-controls"); const btn = el("button", "btn", "Replay"); const note = el("span", "muted");
    ctr.append(btn, note); fig.append(ctr);
    return { c, ctx: c.getContext("2d"), btn, note };
  }
  function axesFrame(ctx, W, H, m, x0, x1, y0, y1, fmtX, fmtY) {
    ctx.strokeStyle = tok("--line"); ctx.fillStyle = tok("--muted"); ctx.lineWidth = 1.5; ctx.font = `22px ${tok("--mono") || "monospace"}`;
    d3.scaleLinear().domain([y0, y1]).nice().ticks(5).forEach(v => {
      const yy = H - m.b - (v - y0) / (y1 - y0) * (H - m.t - m.b); if (yy < m.t - 1 || yy > H - m.b + 1) return;
      ctx.globalAlpha = .6; ctx.beginPath(); ctx.moveTo(m.l, yy); ctx.lineTo(W - m.r, yy); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillText(fmtY(v), m.l - 10, yy);
    });
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    d3.scaleLinear().domain([x0, x1]).ticks(6).forEach(v => ctx.fillText(fmtX(v), m.l + (v - x0) / (x1 - x0) * (W - m.l - m.r), H - m.b + 10));
  }

  function brownian(fig, spec) {
    const { c, ctx, btn, note } = canvasBox(fig);
    const W = c.width, H = c.height, m = { l: 90, r: 24, t: 20, b: 50 };
    const n = spec.steps || 252, T = spec.T || 1, P = spec.paths || 12, dt = T / n;
    const gbm = spec.model !== "abm", s0 = spec.s0 ?? (gbm ? 100 : 0), mu = spec.mu ?? 0, sg = spec.sigma ?? 0.2;
    let raf = 0;
    function run() {
      cancelAnimationFrame(raf);
      const paths = d3.range(P).map(() => { let s = s0; const out = [s]; for (let i = 0; i < n; i++) { const z = randn();
        s = gbm ? s * Math.exp((mu - sg * sg / 2) * dt + sg * Math.sqrt(dt) * z) : s + mu * dt + sg * Math.sqrt(dt) * z; out.push(s); } return out; });
      const [lo, hi] = d3.extent(paths.flat()); const pad = (hi - lo) * 0.08, y0 = lo - pad, y1 = hi + pad;
      const X = i => m.l + i / n * (W - m.l - m.r), Y = v => H - m.b - (v - y0) / (y1 - y0) * (H - m.t - m.b);
      const cols = ["--b0", "--b1", "--b2", "--b3", "--b4", "--b5"].map(tok);
      const t0 = performance.now(), dur = reduced() ? 0 : 2600;
      note.textContent = `${P} simulated ${gbm ? "geometric" : "arithmetic"} Brownian paths, ${n} steps`;
      const frame = now => {
        const k = dur ? Math.min(n, Math.floor((now - t0) / dur * n)) : n;
        ctx.clearRect(0, 0, W, H);
        axesFrame(ctx, W, H, m, 0, T, y0, y1, v => (+v.toFixed(2)).toString(), v => (+v.toFixed(1)).toString());
        ctx.setLineDash([8, 8]); ctx.strokeStyle = tok("--muted"); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(m.l, Y(s0)); ctx.lineTo(W - m.r, Y(s0)); ctx.stroke(); ctx.setLineDash([]);
        paths.forEach((p, j) => { ctx.strokeStyle = cols[j % cols.length]; ctx.globalAlpha = .85; ctx.lineWidth = 2.2; ctx.beginPath();
          for (let i = 0; i <= k; i++) i ? ctx.lineTo(X(i), Y(p[i])) : ctx.moveTo(X(i), Y(p[i])); ctx.stroke(); });
        ctx.globalAlpha = 1;
        if (k < n) raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    }
    btn.onclick = run; run();
  }

  function clt(fig, spec) {
    const { c, ctx, btn, note } = canvasBox(fig);
    const W = c.width, H = c.height, m = { l: 70, r: 24, t: 20, b: 50 };
    const n = spec.n || 30, draws = spec.draws || 3000, bins = 40, lo = -4, hi = 4, bw = (hi - lo) / bins;
    const dist = { exponential: [() => -Math.log(1 - Math.random()), 1, 1], uniform: [() => Math.random(), 0.5, Math.sqrt(1 / 12)],
                   bernoulli: [() => +(Math.random() < 0.2), 0.2, 0.4] }[spec.dist || "exponential"];
    const yMax = draws * bw * phi(0) * 1.35;
    let raf = 0;
    function run() {
      cancelAnimationFrame(raf);
      const counts = new Array(bins).fill(0); let done = 0;
      const per = reduced() ? draws : Math.ceil(draws / 150);
      const X = v => m.l + (v - lo) / (hi - lo) * (W - m.l - m.r), Y = v => H - m.b - v / yMax * (H - m.t - m.b);
      const frame = () => {
        for (let k = 0; k < per && done < draws; k++, done++) { let s = 0; for (let i = 0; i < n; i++) s += dist[0]();
          const z = (s / n - dist[1]) / (dist[2] / Math.sqrt(n)); const b = Math.floor((z - lo) / bw); if (b >= 0 && b < bins) counts[b]++; }
        ctx.clearRect(0, 0, W, H);
        axesFrame(ctx, W, H, m, lo, hi, 0, yMax, v => v.toString(), v => Math.round(v).toString());
        ctx.fillStyle = tok("--accent"); ctx.globalAlpha = .55;
        counts.forEach((ct, b) => { const x0 = X(lo + b * bw) + 1, x1 = X(lo + (b + 1) * bw) - 1; ctx.fillRect(x0, Y(ct), x1 - x0, Y(0) - Y(ct)); });
        ctx.globalAlpha = 1; ctx.strokeStyle = tok("--hl"); ctx.lineWidth = 3.5; ctx.beginPath();
        for (let i = 0; i <= 200; i++) { const z = lo + (hi - lo) * i / 200, yy = Y(draws * bw * phi(z)); i ? ctx.lineTo(X(z), yy) : ctx.moveTo(X(z), yy); }
        ctx.stroke();
        note.textContent = `${done.toLocaleString("en-US")} of ${draws.toLocaleString("en-US")} sample means, each of n = ${n} ${spec.dist || "exponential"} draws`;
        if (done < draws) raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    }
    btn.onclick = run; run();
  }

  const KINDS = { plot, sliders, brownian, clt };
  function mount(fig) {
    let spec;
    try { spec = JSON.parse(decodeURIComponent(fig.dataset.spec)); } catch (e) { fig.append(el("div", "w-err", "This figure's settings are not valid JSON.")); return; }
    const kind = fig.dataset.kind === "plot" ? "plot" : spec.type;
    if (!KINDS[kind] || !window.d3) { fig.append(el("div", "w-err", `Unknown figure type "${kind}".`)); return; }
    try { KINDS[kind](fig, spec); } catch (e) { fig.append(el("div", "w-err", `Figure failed to draw: ${e.message}`)); }
  }
  return { mount };
})();
