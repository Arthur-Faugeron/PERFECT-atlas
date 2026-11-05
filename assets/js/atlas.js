/* PERFECT Atlas: the map of what the channel teaches, read from data/atlas.json.
   Each view shows one node at the center and its children as medallions in the style of the logo, on one or more
   rings. The layout is computed from the size of the screen and recomputed on every resize, then fitted to the
   view; zoom and pan are available for large groups. Names are always shown in full.
   The public build holds only what published videos revealed; the private build holds everything. */
"use strict";
(async function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const cmp = (a, b) => a.localeCompare(b, "en", { sensitivity: "base" });
  const nf = v => v.toLocaleString("en-US");
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const day = s => s ? new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";

  const DATA = await fetch("data/atlas.json").then(r => r.ok ? r.json() : null).catch(() => null);
  if (!DATA) {
    $("stage").innerHTML = '<p style="padding:24px;max-width:46ch">The atlas data could not be loaded. If you opened the file directly, serve the folder with a local web server instead.</p>';
    return;
  }
  const PRIVATE = DATA.mode === "private";
  if (PRIVATE) { $("mode").hidden = false; document.title = "PERFECT Atlas (private)"; }
  const COLOR = Object.fromEntries(DATA.pillars.map(p => [p.key, p.color]));
  const colorOf = n => (n && n.pillar && COLOR[n.pillar]) || "#C8AE82";

  /* ---------- model ---------- */
  const GROUP = new Set(["root", "pillar", "domain", "topic"]);
  const KIND = { root: "The atlas", pillar: "Pillar", domain: "Domain", topic: "Topic", concept: "Concept", company: "Company",
    paper: "Paper", person: "Person", institution: "Institution", event: "Event", tool: "Tool", skill: "Skill", news: "News" };
  const CHILD = { root: "pillars", pillar: "domains", domain: "topics", topic: "ideas" };
  const BY = new Map(), BYKEY = new Map();
  for (const r of DATA.nodes) {
    const n = { id: r.i, key: r.k, slug: r.k, name: r.t, kind: r.kind, pillar: r.p, pid: r.u, status: r.s, pub: r.pub || null,
      card: r.card || null, meta: r.m || {}, children: [], links: [], videos: [], lect: [], count: 0, cards: 0 };
    BY.set(n.id, n); BYKEY.set(n.key, n);
  }
  for (const n of BY.values()) { n.parent = n.pid != null ? BY.get(n.pid) || null : null; if (n.parent) n.parent.children.push(n); }
  const ROOT = [...BY.values()].find(n => n.kind === "root");
  if (!ROOT) {
    ["stage", "panel"].forEach(id => $(id).hidden = true);
    document.querySelector(".search").hidden = true; document.querySelector(".tabs").hidden = true;
    $("empty").hidden = false; $("main").style.gridTemplateColumns = "1fr"; $("main").style.gridTemplateRows = "1fr";
    return;
  }
  const isGroup = n => GROUP.has(n.kind) || n.children.length > 0;
  (function cnt(n) {
    let c = GROUP.has(n.kind) ? 0 : 1, k = n.card ? 1 : 0;
    for (const ch of n.children) { cnt(ch); c += ch.count; k += ch.cards; }
    n.count = c; n.cards = k;
  })(ROOT);
  for (const [s, d, type] of DATA.links) {
    const a = BY.get(s), b = BY.get(d); if (!a || !b) continue;
    a.links.push({ n: b, type, dir: "out" }); b.links.push({ n: a, type, dir: "in" });
  }
  const NOW = Date.now();
  const VIDEOS = DATA.videos.map(v => ({ ...v, nodes: v.nodes.map(i => BY.get(i)).filter(Boolean) }));
  VIDEOS.forEach(v => v.nodes.forEach(n => n.videos.push(v)));
  const aired = VIDEOS.filter(v => (v.status === "published" || v.status === "scheduled") && v.at && Date.parse(v.at) <= NOW);
  const LATEST = aired[aired.length - 1];
  const NEW = new Set(LATEST ? LATEST.nodes : []);
  const LECT = DATA.lectures.map(l => ({ id: l.id, vol: l.volume, ch: l.chapter, chapter: l.chapter_title, title: l.title }));
  const LBYID = new Map(LECT.map(l => [l.id, l]));
  for (const [lid, nid] of DATA.lecture_nodes) { const n = BY.get(nid), l = LBYID.get(lid); if (n && l) n.lect.push(l); }
  const ALL = [...BY.values()].filter(n => n !== ROOT);
  const LEAVES = ALL.filter(n => !isGroup(n));
  const anc = n => { const a = []; while (n) { a.unshift(n); n = n.parent; } return a; };
  const pathOf = n => anc(n).slice(1, -1).map(x => x.name).join(" / ");
  const planned = n => PRIVATE && n.status !== "published";
  const letterOf = n => (n.name.replace(/^(the|a|an)\s+/i, "").match(/[A-Za-z0-9]/) || ["·"])[0].toUpperCase();

  /* ---------- related ideas and lecture matching ---------- */
  const STOP = new Set("the of and in to for a an on with by from at as vs versus model models theory ratio rate rates index test method methods approach effect analysis function value market markets financial finance based new two one three four type types its their".split(" "));
  const words = s => s.toLowerCase().replace(/\([^)]*\)/g, " ").split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w));
  const stem = w => w.replace(/(ies|es|s)$/, "");
  function related(n) {
    if (isGroup(n)) return n.children.slice(0, 24);
    const linked = n.links.map(l => l.n);
    const ws = new Set(words(n.name).map(stem));
    const near = !ws.size ? [] : LEAVES.filter(x => x !== n && x.parent !== n.parent && !linked.includes(x))
      .map(x => ({ x, s: words(x.name).map(stem).filter(w => ws.has(w)).length + (x.card ? 0.5 : 0) }))
      .filter(o => o.s >= 1).sort((a, b) => b.s - a.s || a.x.name.length - b.x.name.length).slice(0, 12).map(o => o.x);
    return linked.concat(near).slice(0, 16);
  }
  function lectures(n, meta) {
    const out = n.lect.slice();
    if (meta && meta.lecture && LBYID.has(meta.lecture) && !out.includes(LBYID.get(meta.lecture))) out.unshift(LBYID.get(meta.lecture));
    if (isGroup(n) || !LECT.length) return out.slice(0, 6);
    const ws = new Set(words(n.name).map(stem)), ctx = new Set(words(anc(n).slice(1, -1).map(x => x.name).join(" ")).map(stem));
    if (!ws.size) return out;
    LECT.map(l => { const lw = words(l.title).map(stem), cw = words(l.chapter).map(stem);
      return { l, s: lw.filter(w => ws.has(w)).length * 2 + cw.filter(w => ws.has(w)).length + 0.3 * lw.concat(cw).filter(w => ctx.has(w)).length }; })
      .filter(o => o.s >= 2).sort((a, b) => b.s - a.s)
      .forEach(o => { if (out.length < 4 && !out.includes(o.l)) out.push(o.l); });
    return out;
  }

  /* ---------- text measurement ---------- */
  try { await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 2500))]); } catch (e) {}
  const mctx = document.createElement("canvas").getContext("2d");
  const tw = (t, px, weight = 500) => { mctx.font = `${weight} ${px}px "EB Garamond", Georgia, serif`; return mctx.measureText(t).width; };
  function wrapPx(text, px, maxW, maxLines = 4) {
    const out = []; let cur = "";
    for (const w of text.split(/\s+/)) {
      const t = cur ? cur + " " + w : w;
      if (cur && tw(t, px) > maxW) { out.push(cur); cur = w; } else cur = t;
    }
    if (cur) out.push(cur);
    if (out.length > maxLines) { const rest = out.splice(maxLines - 1); out.push(rest.join(" ")); }
    return out;
  }

  /* ---------- map ---------- */
  const stage = $("stage");
  const svg = d3.select("#svg"), view = svg.append("g");
  const zoom = d3.zoom().scaleExtent([0.6, 5]).on("zoom", e => view.attr("transform", e.transform));
  svg.call(zoom).on("dblclick.zoom", null);
  let focus = ROOT, sel = null;

  // All sizes are in screen pixels for the current stage, so the map is re-laid out (not just scaled) on resize.
  function layout(W, H) {
    const m = Math.min(W, H), small = W < 600, major = focus === ROOT, kids = focus.children;
    // phones: smaller medallions, narrower labels and a tall ring shape, so text stays readable when fitted
    const r = major ? clamp(m * 0.055, 24, 40) : small ? 13 : clamp(m * 0.034, 15, 23);
    const fs = major ? clamp(m * 0.03, 15, 21) : small ? 13.5 : clamp(m * 0.024, 12.5, 15.5);
    const lw = major ? clamp(W * 0.2, 96, 190) : small ? 104 : clamp(W * 0.14, 92, 160);
    const items = kids.map(n => {
      const lines = wrapPx(n.name, fs, lw);
      const w = Math.max(2 * r, ...lines.map(l => tw(l, fs)));
      const hasCt = isGroup(n) && n.count > 0;
      return { n, lines, w, r, fs, h: 2 * r + 10 + lines.length * fs * 1.12 + (hasCt ? 14 : 0), hasCt };
    });
    const hubR = major ? clamp(m * 0.11, 44, 74) : small ? 40 : clamp(m * 0.1, 46, 76);
    const maxW = Math.max(0, ...items.map(i => i.w)), maxH = Math.max(0, ...items.map(i => i.h));
    const avgW = items.length ? items.reduce((a, i) => a + i.w, 0) / items.length : 0;
    const e = clamp(H / W, 0.7, 1.45);                       // ring shape follows the screen: wide, square or tall
    const gapX = small ? 8 : 18, gapY = small ? 10 : 16;
    // first ring far enough that labels of the top node clear the hub; next rings one node height further out
    let rx = Math.max(hubR + r + 26, (hubR + maxH + 18) / e), stepX = Math.max(maxW * 0.62, (maxH + gapY + 10) / e);
    const rings = [];
    let left = items.length;
    while (left > 0) {
      const ry = rx * e, per = 2 * Math.PI * Math.sqrt((rx * rx + ry * ry) / 2);
      const cap = Math.max(1, Math.floor(per / ((items.length > 24 || small ? avgW * 1.08 : maxW) + gapX)));
      rings.push({ rx, ry, cap }); left -= cap; rx += stepX;
    }
    // share the nodes between rings in proportion to their capacity, inner rings first
    const totCap = rings.reduce((s, q) => s + q.cap, 0);
    let rest = items.length;
    rings.forEach((q, i) => { q.n = i === rings.length - 1 ? rest : Math.min(q.cap, Math.round(items.length * q.cap / totCap)); rest -= q.n; });
    let k = 0;
    rings.forEach((q, ri) => { for (let j = 0; j < q.n; j++, k++) {
      const a = -Math.PI / 2 + (j + (ri % 2 ? 0.5 : 0)) * 2 * Math.PI / q.n;
      items[k].x = Math.cos(a) * q.rx; items[k].y = Math.sin(a) * q.ry;
    } });
    return { items, hubR, major };
  }

  function drawHub(g, hubR, major) {
    const h = g.append("g").attr("class", "hub" + (focus.parent ? " up" : ""))
      .on("click", e => { e.stopPropagation(); if (focus.parent) go(focus.parent); });
    if (major) {
      h.append("circle").attr("class", "halo").attr("r", hubR + 7);
      h.append("image").attr("href", "assets/logo.png").attr("x", -hubR).attr("y", -hubR).attr("width", 2 * hubR).attr("height", 2 * hubR);
      h.append("title").text("PERFECT");
      return;
    }
    h.append("circle").attr("class", "ring-o").attr("r", hubR);
    h.append("circle").attr("class", "ring-i").attr("r", hubR - 7).style("stroke", colorOf(focus));
    let px = clamp(hubR * 0.36, 16, 28), lines = wrapPx(focus.name, px, hubR * 1.55, 3);
    while (lines.length > 3 || Math.max(...lines.map(l => tw(l, px, 600))) > hubR * 1.7) { px -= 1; lines = wrapPx(focus.name, px, hubR * 1.55, 3); if (px < 11) break; }
    const showCt = hubR >= 46, ctH = showCt ? 14 : 0, total = lines.length * px * 1.05 + ctH, y0 = -total / 2 + px * 0.8;
    const t = h.append("text").attr("class", "nm").style("font-size", px + "px");
    lines.forEach((l, i) => t.append("tspan").attr("x", 0).attr("y", y0 + i * px * 1.05).text(l));
    if (showCt) h.append("text").attr("class", "ct").attr("y", y0 + lines.length * px * 1.05 + 4).style("font-size", "9.5px")
      .text(`${nf(focus.count)} ${focus.count === 1 ? "IDEA" : "IDEAS"}`);
    h.append("title").text(`Back to ${focus.parent.name}`);
  }

  function render() {
    const W = stage.clientWidth, H = stage.clientHeight; if (!W || !H) return;
    view.selectAll("*").remove();
    const { items, hubR, major } = layout(W, H);
    const links = view.append("g");
    items.forEach(p => {
      const d = Math.hypot(p.x, p.y) || 1, ux = p.x / d, uy = p.y / d;
      p.link = links.append("line").attr("class", "link").attr("x1", ux * (hubR + 6)).attr("y1", uy * (hubR + 6))
        .attr("x2", p.x - ux * (p.r + 4)).attr("y2", p.y - uy * (p.r + 4));
    });
    drawHub(view, hubR, major);
    const nodes = view.append("g");
    items.forEach(p => {
      const n = p.n;
      const g = nodes.append("g").attr("class", `md${n.card ? " card" : ""}${planned(n) ? " planned" : ""}${!PRIVATE && NEW.has(n) ? " new" : ""}${n === sel ? " sel" : ""}`)
        .attr("transform", `translate(${p.x},${p.y})`)
        .on("click", e => { e.stopPropagation(); isGroup(n) ? go(n) : openNode(n); })
        .on("mouseenter", () => p.link.classed("hot", true)).on("mouseleave", () => p.link.classed("hot", false));
      if (!PRIVATE && NEW.has(n)) g.append("circle").attr("class", "halo").attr("r", p.r + 5);
      g.append("circle").attr("class", "ring-o").attr("r", p.r);
      g.append("circle").attr("class", "ring-i").attr("r", p.r - 4.5).style("stroke", major ? colorOf(n) : "#C8AE82").style("stroke-opacity", major ? 1 : .85);
      g.append("text").attr("class", "let").attr("y", p.r * 0.34).style("font-size", (p.r * 0.95) + "px").text(letterOf(n));
      const t = g.append("text").attr("class", "lab").style("font-size", p.fs + "px");
      p.lines.forEach((l, i) => t.append("tspan").attr("x", 0).attr("y", p.r + p.fs + 4 + i * p.fs * 1.12).text(l));
      if (p.hasCt) g.append("text").attr("class", "ct").attr("y", p.r + p.fs + 6 + p.lines.length * p.fs * 1.12).style("font-size", "9.5px").text(nf(n.count));
      g.append("title").text(`${n.name}${isGroup(n) ? `, ${nf(n.count)} ${n.count === 1 ? "idea" : "ideas"}` : ""}${n.card ? ". Lecture card" : ""}${planned(n) ? ". Planned" : ""}`);
    });
    // fit: the whole view on screen, never enlarged beyond its natural size; leave room for the crumbs and buttons
    let x0 = -hubR - 8, x1 = hubR + 8, y0 = -hubR - 8, y1 = hubR + 8;
    items.forEach(p => { x0 = Math.min(x0, p.x - p.w / 2); x1 = Math.max(x1, p.x + p.w / 2); y0 = Math.min(y0, p.y - p.r - 8); y1 = Math.max(y1, p.y + p.h - p.r); });
    const padX = 20, padTop = W < 600 ? 44 : 54, padBot = 22;
    const s = Math.min(1, (W - 2 * padX) / (x1 - x0), (H - padTop - padBot) / (y1 - y0));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, sy = padTop + (H - padTop - padBot) / 2;
    svg.attr("viewBox", [cx - W / 2 / s, cy - sy / s, W / s, H / s]).attr("preserveAspectRatio", "xMidYMid meet");
    svg.call(zoom.transform, d3.zoomIdentity);
    $("ctrl").hidden = false;
  }

  /* ---------- navigation ---------- */
  function go(n) { if (!isGroup(n)) { openNode(n); return; } focus = n; if (sel && !anc(sel).includes(n)) sel = null; render(); renderSide(); }
  function show(n) {
    showMap();
    if (isGroup(n)) { focus = n; sel = null; } else { sel = n; focus = n.parent || ROOT; }
    render(); renderSide();
    if (!isGroup(n) || n.card) Reader.open(n); else if (Reader.isOpen()) Reader.close();
  }
  function openNode(n) { if (location.hash.slice(1) === n.key) show(n); else location.hash = n.key; }
  function route() {
    const n = BYKEY.get(decodeURIComponent(location.hash.slice(1)));
    if (n) show(n); else if (Reader.isOpen()) Reader.close();
  }
  window.addEventListener("hashchange", route);

  Reader.init({
    bySlug: k => BYKEY.get(k), path: pathOf, hasCard: n => !!(n && n.card), cardStatus: n => n && n.card,
    related, lectures, lecture: id => LBYID.get(id), isGroup, isPublic: !PRIVATE, videos: n => n.videos,
    onGo: openNode,
    onClose: () => { if (location.hash) { try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { location.hash = ""; } } }
  });

  /* ---------- side panel ---------- */
  const rowBtn = n => `<button data-go="${n.id}" class="${planned(n) ? "planned" : ""}"><span class="nm">${esc(n.name)}</span>` +
    `${n.card ? '<span class="card-mk" title="Lecture card"></span>' : ""}<span class="ct">${isGroup(n) && n.count ? nf(n.count) : ""}</span></button>`;
  const vidHtml = v => `<div class="vid"><span class="when">${esc(day(v.at))}${v.format === "long" ? " · long video" : ""}</span>` +
    `<span class="ttl">${v.url ? `<a href="${esc(v.url)}" target="_blank" rel="noopener">${esc(v.title || v.code)}</a>` : esc(v.title || v.code)}</span>` +
    (PRIVATE ? `<span class="st">${esc(v.status)}</span>` : "") + `</div>`;

  function renderSide() {
    const path = anc(focus);
    $("crumbs").innerHTML = path.map((n, i) => i < path.length - 1 ? `<button data-go="${n.id}">${esc(n.name)}</button><span class="sep">/</span>` : `<span class="cur">${esc(n.name)}</span>`).join("");
    const n = sel || focus;
    const pillar = n.pillar && BYKEY.get(n.pillar);
    const kick = n === ROOT ? "The atlas" : `${KIND[n.kind] || n.kind}${pillar && n.kind !== "pillar" ? " · " + pillar.name : n.kind === "pillar" ? " · " + letterOf(n) : ""}`;
    let h = `<div><div class="caps">${esc(kick)}</div><h2>${esc(n === ROOT ? "PERFECT" : n.name)}</h2></div>`;
    const blurb = n === ROOT ? "The map of what PERFECT teaches across the macrofinancial world. It grows with every video." : n.meta.blurb;
    if (blurb) h += `<p>${esc(blurb)}</p>`;
    const facts = [];
    if (isGroup(n)) facts.push(`<span><b>${nf(n.count)}</b>${n.count === 1 ? "idea" : "ideas"}</span>`);
    if (isGroup(n) && n.children.length && n.kind !== "topic") facts.push(`<span><b>${n.children.length}</b>${CHILD[n.kind] || "items"}</span>`);
    if (n.cards) facts.push(`<span><b>${n.cards}</b>${n.cards === 1 ? "card" : "cards"}</span>`);
    if (facts.length) h += `<div class="rule"></div><div class="facts">${facts.join("")}</div>`;
    const meta = [PRIVATE ? n.status : "", n.pub ? "On the map since " + day(n.pub) : ""].filter(Boolean);
    if (meta.length) h += `<div class="caps" style="color:var(--faint)">${esc(meta.join(" · "))}</div>`;
    const btns = [];
    if (n.card) btns.push(`<button class="btn" data-open="${n.id}">Open the lecture card</button>`);
    else if (!isGroup(n)) btns.push(`<button class="btn" data-open="${n.id}">Card outline</button>`);
    if (sel) btns.push(`<button class="btn quiet" data-clear="1">Back to ${esc(focus.name)}</button>`);
    if (btns.length) h += `<div class="row">${btns.join("")}</div>`;
    if (n.videos.length) h += `<div><h3>In the videos</h3>${n.videos.map(vidHtml).join("")}</div>`;
    const lec = lectures(n, {});
    if (lec.length) h += `<div><h3>In the Faugeron Lectures</h3><div class="list">${lec.map(l => `<a><span class="id">${esc(l.id)}</span><span class="nm">${esc(l.title)}</span></a>`).join("")}</div></div>`;
    const also = n.links.filter(l => l.type === "also_in").map(l => l.n), rel = n.links.filter(l => l.type !== "also_in").map(l => l.n);
    if (also.length) h += `<div><h3>Also in</h3><div class="list">${also.map(rowBtn).join("")}</div></div>`;
    if (rel.length) h += `<div><h3>Connected ideas</h3><div class="list">${rel.map(rowBtn).join("")}</div></div>`;
    if (n === ROOT) {
      const vids = (PRIVATE ? VIDEOS : aired).slice().reverse().slice(0, 10);
      if (vids.length) h += `<div><h3>${PRIVATE ? "Videos in the studio" : "Latest videos"}</h3>${vids.map(vidHtml).join("")}</div>`;
    }
    if (isGroup(focus) && !sel) h += `<div class="rule"></div><div class="list">${focus.children.map(rowBtn).join("")}</div>`;
    $("panel").innerHTML = h;
  }

  function legend() {
    const ring = (dashed, fill, halo) => `<svg viewBox="-8 -8 16 16">${halo ? '<circle r="7.5" fill="none" stroke="#D4956A" stroke-width="1"/>' : ""}<circle r="6" fill="${fill ? "rgba(200,174,130,.3)" : "#172A3A"}" stroke="#C8AE82" stroke-width="1.2"${dashed ? ' stroke-opacity=".45"' : ""}/></svg>`;
    $("legend").innerHTML = (LEAVES.some(n => n.card) ? `<span>${ring(false, true)}lecture card</span>` : "") +
      (!PRIVATE && LATEST ? `<span>${ring(false, false, true)}new in the latest video</span>` : "") + (PRIVATE ? `<span>${ring(true)}planned</span>` : "");
  }

  document.addEventListener("click", e => {
    if (e.target.closest("#doc")) return;
    const o = e.target.closest("[data-open]"); if (o) { openNode(BY.get(+o.dataset.open)); return; }
    const b = e.target.closest("[data-go]"); if (b) { const n = BY.get(+b.dataset.go); showMap(); isGroup(n) ? go(n) : (sel = n, focus = n.parent, render(), renderSide()); return; }
    if (e.target.closest("[data-clear]")) { sel = null; render(); renderSide(); }
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && document.activeElement !== q && !Reader.isOpen() && focus.parent) go(focus.parent); });
  $("zIn").onclick = () => svg.transition().duration(250).call(zoom.scaleBy, 1.4);
  $("zOut").onclick = () => svg.transition().duration(250).call(zoom.scaleBy, 1 / 1.4);
  $("zFit").onclick = () => svg.transition().duration(250).call(zoom.transform, d3.zoomIdentity);
  let rT = 0; new ResizeObserver(() => { clearTimeout(rT); rT = setTimeout(render, 60); }).observe(stage);

  /* ---------- search ---------- */
  const q = $("q"), res = $("results"); let hits = [];
  const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  q.addEventListener("input", () => {
    const v = q.value.trim(); if (v.length < 2) { res.hidden = true; return; }
    const re = new RegExp(reEsc(v), "i");
    hits = ALL.filter(n => re.test(n.name)).sort((a, b) => (isGroup(b) - isGroup(a)) || (!!b.card - !!a.card) || a.name.length - b.name.length).slice(0, 70);
    res.hidden = false;
    res.innerHTML = hits.length ? hits.map((h, i) => `<button data-hit="${i}" class="${i ? "" : "act"}">${esc(h.name).replace(new RegExp(reEsc(esc(v)), "ig"), m => `<mark>${m}</mark>`)}${h.card ? '<span class="has">card</span>' : ""}<small>${esc(KIND[h.kind] || h.kind)}${pathOf(h) ? " · " + esc(pathOf(h)) : ""}</small></button>`).join("")
      : `<button disabled><small>Nothing on the map matches "${esc(v)}"${PRIVATE ? "" : " yet"}</small></button>`;
  });
  res.addEventListener("click", e => { const b = e.target.closest("[data-hit]"); if (b) pick(hits[+b.dataset.hit]); });
  q.addEventListener("keydown", e => { if (e.key === "Enter" && hits[0] && !res.hidden) pick(hits[0]); if (e.key === "Escape") { res.hidden = true; q.blur(); } });
  document.addEventListener("click", e => { if (!e.target.closest(".search")) res.hidden = true; });
  function pick(n) { res.hidden = true; q.blur(); showMap(); isGroup(n) ? go(n) : openNode(n); }

  /* ---------- A to Z ---------- */
  const az = $("az"); let azBuilt = false;
  az.addEventListener("click", e => { const l = e.target.closest("[data-l]"); if (l) $("L-" + (l.dataset.l === "#" ? "num" : l.dataset.l)).scrollIntoView({ behavior: "smooth" }); });
  function buildAz() {
    if (azBuilt) return; azBuilt = true;
    const norm = s => s.normalize("NFKD").toLowerCase().replace(/^[0-9'\/ %+.()-]+/, "");
    const G = new Map();
    LEAVES.slice().sort((a, b) => cmp(norm(a.name) || a.name, norm(b.name) || b.name)).forEach(t => {
      let L = (norm(t.name)[0] || "#").toUpperCase(); if (!/[A-Z]/.test(L)) L = "#"; if (!G.has(L)) G.set(L, []); G.get(L).push(t); });
    const keys = [...G.keys()].sort((a, b) => a === "#" ? -1 : b === "#" ? 1 : a.localeCompare(b));
    az.innerHTML = `<div class="letters">${keys.map(k => `<button data-l="${k}">${k}</button>`).join("")}</div>` +
      keys.map(k => `<div class="letter"><h3 id="L-${k === "#" ? "num" : k}">${k}</h3><div class="cols">${G.get(k).map(t => `<button data-open="${t.id}" class="${t.card ? "has" : ""}${planned(t) ? " planned" : ""}" title="${esc(pathOf(t))}">${esc(t.name)}</button>`).join("")}</div></div>`).join("");
  }
  const tMap = $("tMap"), tAz = $("tAz");
  function showMap() { az.hidden = true; tMap.setAttribute("aria-pressed", "true"); tAz.setAttribute("aria-pressed", "false"); }
  tMap.onclick = showMap;
  tAz.onclick = () => { buildAz(); az.hidden = false; tAz.setAttribute("aria-pressed", "true"); tMap.setAttribute("aria-pressed", "false"); };

  legend(); render(); renderSide(); route();
})();
