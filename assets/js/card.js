/* Lecture card reader. Loads cards/<slug>.md, renders Markdown + TeX (MathJax SVG) + code + widgets,
   and exports the card as .md (source) or .html (self-contained, math and figures baked in). */
"use strict";
const Reader = (() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const LEVEL = { 1: "Foundations", 2: "Core", 3: "Advanced", 4: "Research" };
  let H = null, current = null, lastFocus = null;
  const cache = new Map();

  async function fetchText(url) {
    if (cache.has(url)) return cache.get(url);
    try { const r = await fetch(url, { cache: "no-cache" }); if (!r.ok) throw new Error(r.status); const t = await r.text(); cache.set(url, t); return t; }
    catch (e) { return null; }
  }

  function splitFront(text) {
    const m = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
    const meta = {};
    if (!m) return { meta, body: text };
    m[1].split("\n").forEach(line => {
      const i = line.indexOf(":"); if (i < 0 || line.trim().startsWith("#")) return;
      let v = line.slice(i + 1).trim();
      if (v.startsWith("[") && v.endsWith("]")) v = v.slice(1, -1).split(",").map(x => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      else v = v.replace(/^["']|["']$/g, "");
      meta[line.slice(0, i).trim()] = v;
    });
    return { meta, body: text.slice(m[0].length) };
  }

  /* Pull TeX out before Markdown sees it (so _ and * inside formulas survive), outside code spans and fences. */
  function protectMath(src) {
    const math = [];
    const ph = (t, display) => { math.push({ t: t.trim(), display }); const i = math.length - 1;
      return display ? `\n\n<div class="mx-d" data-i="${i}"></div>\n\n` : `<span class="mx" data-i="${i}"></span>`; };
    const parts = src.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
    for (let i = 0; i < parts.length; i += 2) {
      parts[i] = parts[i]
        .replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => ph(t, true))
        .replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => ph(t, true))
        .replace(/\\\(([\s\S]+?)\\\)/g, (_, t) => ph(t, false))
        .replace(/(^|[^\\$\w])\$(?=\S)([^$\n]*?\S)\$(?!\d)/gm, (_, pre, t) => pre + ph(t, false));
    }
    return { src: parts.join(""), math };
  }

  let markedReady = false;
  function setupMarked() {
    if (markedReady || !window.marked) return;
    marked.use({
      gfm: true,
      renderer: {
        code(code, lang) {
          if (lang === "plot" || lang === "widget") return `<figure class="widget" data-kind="${lang}" data-spec="${encodeURIComponent(code)}"></figure>\n`;
          return false;
        },
        table(header, body) { return `<div class="tbl"><table><thead>${header}</thead><tbody>${body}</tbody></table></div>\n`; },
        link(href, title, text) {
          const ext = /^https?:/i.test(href || "");
          return `<a href="${esc(href || "")}"${title ? ` title="${esc(title)}"` : ""}${ext ? ' target="_blank" rel="noopener"' : ""}>${text}</a>`;
        }
      }
    });
    markedReady = true;
  }

  const mathJaxReady = () => new Promise(res => {
    const t0 = Date.now();
    (function check() {
      const M = window.MathJax;
      if (M && M.tex2svgPromise && M.startup && M.startup.promise) M.startup.promise.then(() => res(true), () => res(false));
      else if (Date.now() - t0 > 10000) res(false);
      else setTimeout(check, 120);
    })();
  });
  let mjSheet = false;
  async function typeset(root, math) {
    const nodes = [...root.querySelectorAll(".mx,.mx-d")];
    if (!nodes.length) return;
    const ok = await mathJaxReady();
    if (ok && !mjSheet) { try { document.head.appendChild(MathJax.svgStylesheet()); } catch (e) {} mjSheet = true; }
    for (const n of nodes) {
      const m = math[+n.dataset.i];
      if (!m) continue;
      if (!ok) { n.innerHTML = `<code class="mx-raw">${esc(m.t)}</code>`; continue; }
      try { n.replaceChildren(await MathJax.tex2svgPromise(m.t, { display: m.display })); }
      catch (e) { n.innerHTML = `<code class="mx-raw">${esc(m.t)}</code>`; }
    }
  }

  function headerHtml(node, meta, written) {
    const slug = node.slug;
    const st = written ? ((H.cardStatus && H.cardStatus(node)) || "draft") : "stub";
    const lec = meta.lecture && H.lecture(meta.lecture);
    const pills = [
      `<span class="pill st-${esc(st)}">${st === "stub" ? "not written yet" : esc(st)}</span>`,
      meta.level ? `<span class="pill">Level ${esc(meta.level)}${LEVEL[meta.level] ? ", " + LEVEL[meta.level] : ""}</span>` : "",
      lec ? `<span class="pill" title="${esc(lec.chapter)}: ${esc(lec.title)}">Lectures ${esc(lec.id)}</span>` : "",
      meta.date ? `<span class="pill">${esc(meta.date)}</span>` : "",
      meta.short ? `<a class="pill" href="${esc(meta.short)}" target="_blank" rel="noopener">Watch the Short</a>` : "",
      meta.long ? `<a class="pill" href="${esc(meta.long)}" target="_blank" rel="noopener">Watch the long video</a>` : "",
      ...(H.videos ? H.videos(node).filter(v => v.url).map(v => `<a class="pill" href="${esc(v.url)}" target="_blank" rel="noopener">${v.format === "short" ? "Watch the Short" : "Watch the video"}</a>`) : [])
    ].join("");
    const pre = (meta.prereqs || []).map(s => H.bySlug(s)).filter(Boolean);
    return `<div class="kicker">${esc(H.path(node))}</div><h1>${esc(node.name)}</h1><div class="meta">${pills}</div>` +
      (pre.length ? `<div class="prereq"><span>Read first</span><span class="chips">${pre.map(chip).join("")}</span></div>` : "") +
      `<span hidden data-slug="${esc(slug)}"></span>`;
  }
  const chip = n => `<button data-card="${esc(n.slug)}" class="${H.hasCard(n) ? "has" : ""}" title="${esc(H.path(n))}">${esc(n.name)}</button>`;

  function footerHtml(node, meta) {
    const lecs = H.lectures(node, meta);
    const rel = H.related(node);
    let out = "";
    if (lecs.length) out += `<h2>Where this sits in the Faugeron Lectures</h2><ul class="lect">${lecs.map(l =>
      `<li><span class="id">${esc(l.id)}</span><span>${esc(l.title)} <span class="muted">(Volume ${esc(l.vol)}, Chapter ${l.ch}: ${esc(l.chapter)})</span></span></li>`).join("")}</ul>`;
    if (rel.length) out += `<h2>${H.isGroup(node) ? "Inside " + esc(node.name) : "Related in the atlas"}</h2><div class="chips">${rel.map(chip).join("")}</div>`;
    return out;
  }

  function stubMarkdown(node, meta, template) {
    const today = new Date().toISOString().slice(0, 10);
    const tpl = template || "---\ntitle: {{TITLE}}\nlevel: 2\nlecture: {{LECTURE}}\ndate: {{DATE}}\nshort:\ntags: []\nprereqs: []\n---\n\n## In one sentence\n\n## Intuition\n\n## Definition\n\n## Picture\n\n## Worked example\n\n## Common mistakes\n\n## References\n";
    return tpl.replace("{{TITLE}}", node.name).replace("{{LECTURE}}", meta.lecture || "").replace("{{DATE}}", today);
  }

  async function open(node) {
    setupMarked();
    lastFocus = lastFocus || document.activeElement;
    $("reader").hidden = false; $("scrim").hidden = false;
    $("rWhere").textContent = H.path(node);
    $("rPrint").hidden = !!window.claude || typeof window.print !== "function";
    const doc = $("doc"), scroll = $("rScroll");
    scroll.scrollTop = 0;
    doc.innerHTML = `<div class="kicker">${esc(H.path(node))}</div><h1>${esc(node.name)}</h1><p class="muted">Opening the card</p>`;
    const token = current = { node, source: "", written: false };
    const written = H.hasCard(node);
    const md = written ? await fetchText(`cards/${node.slug}.md`) : null;
    if (current !== token) return;
    let meta = {}, html = "";
    if (md) {
      const fm = splitFront(md); meta = fm.meta;
      const { src, math } = protectMath(fm.body);
      html = window.marked ? marked.parse(src) : `<pre>${esc(fm.body)}</pre>`;
      doc.innerHTML = headerHtml(node, meta, true) + html + footerHtml(node, meta);
      token.source = md; token.written = true;
      doc.querySelectorAll("pre code").forEach(c => { if (window.hljs) { c.dataset.highlighted && delete c.dataset.highlighted; hljs.highlightElement(c); } });
      doc.querySelectorAll("figure.widget").forEach(f => Widgets.mount(f));
      await typeset(doc, math);
    } else {
      meta = { lecture: (H.lectures(node, {})[0] || {}).id || "" };
      doc.innerHTML = headerHtml(node, meta, false) +
        `<div class="stub"><p><strong>This lecture card is not written yet.</strong> The idea is on the map and its lesson is coming.</p>` +
        (H.isPublic ? "" : `<p class="muted">Download the .md for a ready-to-fill card.</p>`) + `</div>` +
        footerHtml(node, meta);
      token.source = stubMarkdown(node, meta, null);
    }
    if (current !== token) return;
    $("rMd").hidden = $("rHtml").hidden = !!H.isPublic && !token.written;
    scroll.focus({ preventScroll: true });
  }

  function close() {
    if ($("reader").hidden) return;
    current = null;
    $("reader").hidden = true; $("scrim").hidden = true;
    H.onClose();
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    lastFocus = null;
  }

  /* ---------- export ---------- */
  const abs = u => { if (!u || /^(data:|blob:|mailto:|https?:)/i.test(u)) return u; try { return new URL(u, location.href).href; } catch (e) { return u; } };
  function sheetCss() {
    let css = "";
    for (const s of document.styleSheets) {
      if (!s.href || !/atlas\.css/.test(s.href)) continue;
      try { css += [...s.cssRules].map(r => r.cssText).join("\n"); } catch (e) {}
    }
    return css;
  }
  function exportHtml() {
    const src = $("doc"), clone = src.cloneNode(true);
    const cs = src.querySelectorAll("canvas");
    clone.querySelectorAll("canvas").forEach((c, i) => { const img = document.createElement("img"); img.alt = "Figure snapshot";
      try { img.src = cs[i].toDataURL("image/png"); } catch (e) {} c.replaceWith(img); });
    clone.querySelectorAll(".w-controls").forEach(x => x.remove());
    clone.querySelectorAll("button[data-card]").forEach(b => { const a = document.createElement("a"); a.href = abs("#" + b.dataset.card); a.textContent = b.textContent; b.replaceWith(a); });
    clone.querySelectorAll("[src]").forEach(e => e.setAttribute("src", abs(e.getAttribute("src"))));
    clone.querySelectorAll("a[href]").forEach(e => e.setAttribute("href", abs(e.getAttribute("href"))));
    const extra = `html,body{height:auto;overflow:auto}body{padding:40px 20px 60px}
      mjx-container{display:inline-block}mjx-container[display="true"]{display:block;text-align:center}
      mjx-assistive-mml{position:absolute!important;clip:rect(1px,1px,1px,1px);width:1px;height:1px;overflow:hidden}
      .src{max-width:68ch;margin:40px auto 0;font:12px var(--mono);color:var(--muted);border-top:1px solid var(--line);padding-top:12px}`;
    const fallback = `body{font-family:Georgia,serif;max-width:68ch;margin:auto;line-height:1.6}svg{max-width:100%}`;
    const css = sheetCss() || fallback;
    return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(current.node.name)} | PERFECT Atlas</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=EB+Garamond:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>${css}\n${extra}</style></head><body>
<article class="doc">${clone.innerHTML}</article>
<p class="src">PERFECT Atlas lecture card, exported ${new Date().toISOString().slice(0, 10)}. Source: ${esc(abs("#" + current.node.slug))}</p>
</body></html>`;
  }

  function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("on"), 2400); }

  async function save(filename, data, mime) {
    if (window.claude && typeof window.claude.use === "function") {
      try {
        const dl = await window.claude.use("downloads");
        if (dl) { await dl.save({ filename, data }); toast(`Saved ${filename}`); return; }
      } catch (e) {
        if (e && e.code === "declined") return;
        if (e && e.code === "rate_limited") { toast("A save is already waiting for your answer"); return; }
      }
    }
    const url = URL.createObjectURL(new Blob([data], { type: mime }));
    const a = Object.assign(document.createElement("a"), { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(`Downloading ${filename}`);
  }

  function init(helpers) {
    H = helpers;
    $("rClose").onclick = close;
    $("scrim").onclick = close;
    $("rMd").onclick = () => current && save(`${current.node.slug}.md`, current.source, "text/markdown");
    $("rHtml").onclick = () => current && save(`${current.node.slug}.html`, exportHtml(), "text/html");
    $("rPrint").onclick = () => window.print();
    $("rLink").onclick = async () => {
      if (!current) return;
      const url = location.href.split("#")[0] + "#" + current.node.slug;
      try { await navigator.clipboard.writeText(url); toast("Link copied"); }
      catch (e) { toast(url); }
    };
    $("doc").addEventListener("click", e => {
      const b = e.target.closest("[data-card]");
      if (b) { const n = H.bySlug(b.dataset.card); if (n) H.onGo(n); }
    });
    $("rScroll").tabIndex = -1;
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("reader").hidden) { e.stopImmediatePropagation(); close(); } }, true);
    if (window.hljs) hljs.configure({ ignoreUnescapedHTML: true });
  }

  return { init, open, close, isOpen: () => !$("reader").hidden, current: () => current && current.node };
})();
