/* PERFECT Atlas: the map of what the channel teaches, read from data/atlas.json.
   Each view shows one node and its children as full-text pills: on a ring when they fit, as a grid of pills
   otherwise, so no label is ever cut. The public build holds only what published videos revealed; the private
   build holds everything, with planned nodes faded. */
"use strict";
(async function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const cmp = (a, b) => a.localeCompare(b, "en", { sensitivity: "base" });
  const nf = v => v.toLocaleString("en-US");
  const day = s => s ? new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";

  const DATA = await fetch("data/atlas.json").then(r => r.ok ? r.json() : null).catch(() => null);
  if (!DATA) {
    $("stage").innerHTML = '<p style="padding:24px;max-width:46ch">The atlas data could not be loaded. If you opened the file directly, serve the folder with a local web server instead.</p>';
    return;
  }
  const PRIVATE = DATA.mode === "private";
  if (PRIVATE) { $("mode").hidden = false; document.title = "PERFECT Atlas (private)"; }
  const COLOR = Object.fromEntries(DATA.pillars.map(p => [p.key, p.color]));
  const colorOf = n => (n && n.pillar && COLOR[n.pillar]) || "var(--accent)";

  /* ---------- model ---------- */
  const GROUP = new Set(["root", "pillar", "domain", "topic"]);
  const KIND = { root: "Atlas", pillar: "Pillar", domain: "Domain", topic: "Topic", concept: "Concept", company: "Company",
    paper: "Paper", person: "Person", institution: "Institution", event: "Event", tool: "Tool", skill: "Skill", news: "News" };
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
    $("empty").hidden = false; $("main").style.gridTemplateColumns = "1fr";
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
  const aired = VIDEOS.filter(v => v.status === "published" && v.at && Date.parse(v.at) <= NOW);
  const LATEST = aired[aired.length - 1];
  const NEW = new Set(LATEST ? LATEST.nodes : []);
  const LECT = DATA.lectures.map(l => ({ id: l.id, vol: l.volume, ch: l.chapter, chapter: l.chapter_title, title: l.title, generated: l.generated }));
  const LBYID = new Map(LECT.map(l => [l.id, l]));
  for (const [lid, nid] of DATA.lecture_nodes) { const n = BY.get(nid), l = LBYID.get(lid); if (n && l) n.lect.push(l); }
  const ALL = [...BY.values()].filter(n => n !== ROOT);
  const LEAVES = ALL.filter(n => !isGroup(n));
  const anc = n => { const a = []; while (n) { a.unshift(n); n = n.parent; } return a; };
  const pathOf = n => anc(n).slice(1, -1).map(x => x.name).join(" / ");
  const planned = n => PRIVATE && n.status !== "published";
  const marks = n => `${planned(n) ? " planned" : ""}${!PRIVATE && NEW.has(n) ? " new" : ""}${n === sel ? " sel" : ""}`;

  /* ---------- text helpers (related ideas and lecture matching) ---------- */
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
    if (isGroup(n)) return out.slice(0, 6);
    const ws = new Set(words(n.name).map(stem)), ctx = new Set(words(anc(n).slice(1, -1).map(x => x.name).join(" ")).map(stem));
    if (!ws.size) return out;
    LECT.map(l => { const lw = words(l.title).map(stem), cw = words(l.chapter).map(stem);
      return { l, s: lw.filter(w => ws.has(w)).length * 2 + cw.filter(w => ws.has(w)).length + 0.3 * lw.concat(cw).filter(w => ctx.has(w)).length }; })
      .filter(o => o.s >= 2).sort((a, b) => b.s - a.s)
      .forEach(o => { if (out.length < 4 && !out.includes(o.l)) out.push(o.l); });
    return out;
  }

  /* ---------- pill geometry ---------- */
  try { await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 2500))]); } catch (e) {}
  const mctx = document.createElement("canvas").getContext("2d");
  const tw = (t, font) => { mctx.font = font; return mctx.measureText(t).width; };
  const F = { body: '500 13px "IBM Plex Sans", Arial, sans-serif', major: '600 18px "EB Garamond", Georgia, serif', mono: '400 12px "IBM Plex Mono", Consolas, monospace' };
  function size(n, major) {
    const h = major ? 40 : 30, ct = isGroup(n) && n.count ? tw(nf(n.count), F.mono) + 8 : 0, mk = !isGroup(n) && n.card ? 13 : 0;
    return { w: Math.ceil(16 + 8 + 8 + tw(n.name, major ? F.major : F.body) + ct + mk + 14), h, ct, mk, major };
  }

  /* ---------- map ---------- */
  const stage = $("stage"), grid = $("grid");
  const svg = d3.select("#svg"), layer = svg.append("g");
  const zoom = d3.zoom().scaleExtent([0.35, 4]).on("zoom", e => layer.attr("transform", e.transform));
  svg.call(zoom).on("dblclick.zoom", null);
  let focus = ROOT, sel = null;

  function ring(kids, W, H, c) {
    const major = focus === ROOT, sz = kids.map(k => size(k, major));
    const maxW = Math.max(...sz.map(s => s.w)), ph = sz[0].h, pad = 18;
    for (const rings of [1, 2]) {
      const rx = W / 2 - pad - maxW / 2, ry = H / 2 - pad - ph / 2 - 30;
      if (rx < c.w / 2 + 30 || ry < c.h / 2 + 30) return null;
      const pos = kids.map((k, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / kids.length, f = rings === 2 && i % 2 ? 0.6 : 1;
        return { n: k, x: Math.cos(a) * rx * f, y: Math.sin(a) * ry * f, ...sz[i] }; });
      const box = p => ({ l: p.x - p.w / 2 - 5, r: p.x + p.w / 2 + 5, t: p.y - p.h / 2 - 5, b: p.y + p.h / 2 + 5 });
      const boxes = pos.map(box).concat([{ l: -c.w / 2 - 14, r: c.w / 2 + 14, t: -c.h / 2 - 14, b: c.h / 2 + 14 }]);
      let ok = true;
      for (let i = 0; i < boxes.length && ok; i++) for (let j = i + 1; j < boxes.length; j++) {
        const A = boxes[i], B = boxes[j];
        if (A.l < B.r && B.l < A.r && A.t < B.b && B.t < A.b) { ok = false; break; }
      }
      if (ok) return pos;
    }
    return null;
  }

  function pillSvg(g, n, s, cls) {
    g.attr("class", `np${s.major ? " major" : ""}${cls || ""}${marks(n)}`);
    const col = colorOf(n);
    g.append("rect").attr("x", -s.w / 2).attr("y", -s.h / 2).attr("width", s.w).attr("height", s.h).attr("rx", s.h / 2).attr("stroke", col);
    g.append("circle").attr("cx", -s.w / 2 + 16).attr("cy", 0).attr("r", s.major ? 5 : 4).attr("fill", col);
    const t = g.append("text").attr("x", -s.w / 2 + 28).attr("dy", "0.35em").style("font-size", s.major ? "18px" : "13px").text(n.name);
    if (s.ct) t.append("tspan").attr("class", "ct").attr("dx", 8).style("font-size", "12px").text(nf(n.count));
    if (s.mk) g.append("rect").attr("class", "mk").attr("x", s.w / 2 - 20).attr("y", -3.5).attr("width", 7).attr("height", 7).attr("rx", 1.5);
    g.append("title").text(`${n.name}${isGroup(n) ? `, ${nf(n.count)} ${n.count === 1 ? "idea" : "ideas"}` : ""}${n.card ? ". Has a lecture card" : ""}${planned(n) ? ". Planned" : ""}`);
  }

  function render() {
    const W = stage.clientWidth, H = stage.clientHeight; if (!W || !H) return;
    layer.selectAll("*").remove();
    const kids = focus.children;
    const cs = focus === ROOT ? { w: 120, h: 120, logo: true } : { ...size(focus, true), w: size(focus, true).w + 8 };
    const pos = kids.length ? ring(kids, W, H, cs) : [];
    grid.hidden = !!pos; $("svg").style.display = pos ? "" : "none"; $("ctrl").hidden = !pos;
    if (!pos) return renderGrid(kids);
    svg.attr("viewBox", [-W / 2, -H / 2, W, H]);
    const links = layer.append("g").selectAll("line").data(pos).join("line").attr("class", p => "link" + marks(p.n))
      .attr("x1", 0).attr("y1", 0).attr("x2", p => p.x).attr("y2", p => p.y).attr("stroke", p => colorOf(p.n));
    const c = layer.append("g").attr("class", "np center major" + (focus.parent ? " up" : " top"))
      .on("click", () => { if (focus.parent) go(focus.parent); });
    if (cs.logo) {
      c.append("image").attr("class", "center-logo").attr("href", "assets/logo.png").attr("x", -60).attr("y", -60).attr("width", 120).attr("height", 120);
      c.append("title").text("PERFECT");
    } else {
      pillSvg(c, focus, { ...size(focus, true), w: cs.w }, " center" + (focus.parent ? " up" : " top"));
      c.select("rect").attr("fill", `color-mix(in srgb, ${colorOf(focus)} 22%, #26425A)`);
      c.select("title").text(`${focus.name}. Click to go back to ${focus.parent ? focus.parent.name : "the start"}`);
    }
    layer.append("g").selectAll("g").data(pos).join("g").attr("transform", p => `translate(${p.x},${p.y})`)
      .each(function (p) { pillSvg(d3.select(this), p.n, p); })
      .on("click", (e, p) => { e.stopPropagation(); isGroup(p.n) ? go(p.n) : openNode(p.n); })
      .on("mouseenter", (e, p) => links.classed("hot", l => l === p))
      .on("mouseleave", () => links.classed("hot", false));
    svg.call(zoom.transform, d3.zoomIdentity);
  }

  function pillHtml(n, center) {
    const act = center ? (focus.parent ? `data-go="${focus.parent.id}"` : "") : (isGroup(n) ? `data-go="${n.id}"` : `data-open="${n.id}"`);
    return `<button class="gp${center ? " center" : ""}${marks(n)}" ${act} style="border-color:${colorOf(n)}" title="${esc(pathOf(n) || n.name)}">` +
      `<i style="background:${colorOf(n)}"></i><span>${esc(n.name)}</span>${isGroup(n) && n.count ? `<span class="ct">${nf(n.count)}</span>` : ""}` +
      `${!isGroup(n) && n.card ? '<span class="mk" title="Has a lecture card"></span>' : ""}</button>`;
  }
  function renderGrid(kids) {
    grid.innerHTML = `<div class="gridhead">${pillHtml(focus, true)}</div><div class="gpcols">${kids.map(k => pillHtml(k)).join("")}</div>`;
    grid.scrollTop = 0;
  }

  /* ---------- navigation ---------- */
  function go(n) { if (!isGroup(n)) { openNode(n); return; } focus = n; if (sel && !anc(sel).includes(n)) sel = null; render(); renderSide(); }
  function show(n) {
    showMap();
    if (isGroup(n)) { focus = n; sel = null; } else { sel = n; focus = n.parent || ROOT; }
    render(); renderSide();
    if (!isGroup(n) || n.card) Reader.open(n);
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
  const chip = n => `<button data-go="${n.id}" class="${n.card ? "has" : ""}" title="${esc(pathOf(n) || n.name)}">${esc(n.name)}</button>`;
  const vidHtml = v => `<div class="vid"><span class="when">${esc(day(v.at))}${v.format === "long" ? " · long video" : ""}</span>` +
    `<span class="ttl">${v.url ? `<a href="${esc(v.url)}" target="_blank" rel="noopener">${esc(v.title || v.code)}</a>` : esc(v.title || v.code)}</span>` +
    (PRIVATE ? `<span class="st">${esc(v.status)}</span>` : "") + `</div>`;

  function renderSide() {
    const path = anc(focus);
    $("crumbs").innerHTML = path.map((n, i) => i < path.length - 1 ? `<button data-go="${n.id}">${esc(n.name)}</button><span>/</span>` : `<span class="cur">${esc(n.name)}</span>`).join("");
    const n = sel || focus;
    let h = `<div><div class="kicker">${KIND[n.kind] || n.kind}${n.pillar && n.kind !== "pillar" ? " · " + esc(BYKEY.get(n.pillar) ? BYKEY.get(n.pillar).name : n.pillar) : ""}</div><h2>${esc(n === ROOT ? "PERFECT Atlas" : n.name)}</h2></div>`;
    const blurb = n === ROOT ? "The map of what PERFECT teaches across the macrofinancial world. It grows with every video." : n.meta.blurb;
    if (blurb) h += `<p>${esc(blurb)}</p>`;
    const st = [isGroup(n) ? `<span><b>${nf(n.count)}</b> ${n.count === 1 ? "idea" : "ideas"}</span>` : "", n.cards ? `<span><b>${n.cards}</b> ${n.cards === 1 ? "card" : "cards"}</span>` : "",
      PRIVATE ? `<span>${esc(n.status)}</span>` : "", n.pub ? `<span>on the map since ${esc(day(n.pub))}</span>` : ""].filter(Boolean);
    if (st.length) h += `<div class="stat">${st.join("")}</div>`;
    const btns = [];
    if (n.card) btns.push(`<button class="btn primary" data-open="${n.id}">Open the lecture card</button>`);
    else if (!isGroup(n)) btns.push(`<button class="btn" data-open="${n.id}">Card outline</button>`);
    if (sel) btns.push(`<button class="btn" data-clear="1">Back to ${esc(focus.name)}</button>`);
    if (btns.length) h += `<div class="row">${btns.join("")}</div>`;
    if (n.videos.length) h += `<div><h3>In the videos</h3>${n.videos.map(vidHtml).join("")}</div>`;
    const lec = lectures(n, {});
    if (lec.length) h += `<div><h3>In the Faugeron Lectures</h3><div class="list">${lec.map(l => `<a><span class="ct">${esc(l.id)}</span><span class="nm">${esc(l.title)}</span></a>`).join("")}</div></div>`;
    const also = n.links.filter(l => l.type === "also_in").map(l => l.n), rel = n.links.filter(l => l.type !== "also_in").map(l => l.n);
    if (also.length) h += `<div><h3>Also in</h3><div class="chips">${also.map(chip).join("")}</div></div>`;
    if (rel.length) h += `<div><h3>Connected ideas</h3><div class="chips">${rel.map(chip).join("")}</div></div>`;
    if (n === ROOT) {
      const vids = (PRIVATE ? VIDEOS : aired).slice().reverse().slice(0, 10);
      if (vids.length) h += `<div><h3>${PRIVATE ? "Videos in the studio" : "Latest videos"}</h3>${vids.map(vidHtml).join("")}</div>`;
    }
    if (isGroup(focus) && !sel) {
      h += `<div><h3>${focus === ROOT ? "Pillars" : "Inside"}</h3><div class="list">${focus.children.map(c =>
        `<button data-go="${c.id}" class="${planned(c) ? "planned" : ""}"><span class="sw" style="background:${colorOf(c)}"></span><span class="nm">${esc(c.name)}</span>${c.cards ? `<span class="cd">${c.cards}</span>` : ""}<span class="ct">${isGroup(c) ? nf(c.count) : ""}</span></button>`).join("")}</div></div>`;
    }
    $("panel").innerHTML = h;
  }

  function legend() {
    const ps = ROOT.children.map(p => `<span><i style="background:${colorOf(p)}"></i>${esc(p.name)}</span>`).join("");
    $("legend").innerHTML = ps + (LEAVES.some(n => n.card) ? `<span><i class="card"></i>lecture card</span>` : "") +
      (!PRIVATE && LATEST ? `<span><i class="new"></i>new in the latest video</span>` : "") + (PRIVATE ? `<span><i class="planned"></i>planned</span>` : "");
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
  let rT = 0; new ResizeObserver(() => { clearTimeout(rT); rT = setTimeout(render, 80); }).observe(stage);

  /* ---------- search ---------- */
  const q = $("q"), res = $("results"); let hits = [];
  const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  q.addEventListener("input", () => {
    const v = q.value.trim(); if (v.length < 2) { res.hidden = true; return; }
    const re = new RegExp(reEsc(v), "i");
    hits = ALL.filter(n => re.test(n.name)).sort((a, b) => (isGroup(b) - isGroup(a)) || (!!b.card - !!a.card) || a.name.length - b.name.length).slice(0, 70);
    res.hidden = false;
    res.innerHTML = hits.length ? hits.map((h, i) => `<button data-hit="${i}" class="${i ? "" : "act"}">${esc(h.name).replace(new RegExp(reEsc(esc(v)), "ig"), m => `<mark>${m}</mark>`)}${h.card ? '<span class="has">card</span>' : ""}<small>${esc(KIND[h.kind] || h.kind)}${pathOf(h) ? " · " + esc(pathOf(h)) : ""}</small></button>`).join("")
      : `<button disabled><small>Nothing on the map matches "${esc(v)}"${PRIVATE ? "" : " yet. It may arrive in a future video"}.</small></button>`;
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
