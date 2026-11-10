/* Web Sales Honda — cari harga & angsuran, brosur, data konsumen
   Data konsumen hanya disimpan di localStorage HP (tidak dikirim ke mana pun). */
(function () {
  "use strict";

  const CFG = window.APP_CONFIG || {};
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  const ROMAN = ["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII"];
  const BULAN = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
  const DEFAULT_FILES = ["brosur-1.jpg", "brosur-2.jpg"];

  const digits = v => String(v == null ? "" : v).replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  const fmt = v => { const d = digits(v); return d ? d.replace(/\B(?=(\d{3})+(?!\d))/g, ".") : ""; };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const K = n => n * 1000; // data harga dalam ribuan
  const jt = rb => rb >= 1000 ? (rb / 1000).toLocaleString("id-ID", { maximumFractionDigits: 2 }) + " jt" : rb + " rb";

  let toastTimer;
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  const state = {
    brosur: { periode: "", updated: "", files: DEFAULT_FILES.slice() },
    overrides: [],
    harga: { periode: "", items: [] },
    editingId: null,
    auto: { otr: false, scp: false, angsuran: false },
    pick: {} // pilihan sel tabel di tab Harga: { [idx]: {r,t} }
  };

  /* ================= Tabs ================= */
  function showTab(name) {
    $$(".tab").forEach(t => { t.hidden = t.id !== "tab-" + name; });
    $$(".nav button").forEach(b => b.classList.toggle("on", b.dataset.tab === name));
    if (name !== "admin") LS.set("tab", name);
    window.scrollTo(0, 0);
    if (name === "riwayat") renderHistory();
    if (name === "admin") openAdmin();
  }
  $$(".nav button").forEach(b => b.addEventListener("click", () => showTab(b.dataset.tab)));
  $$("[data-goto]").forEach(b => b.addEventListener("click", () => showTab(b.dataset.goto)));
  $("#btnAdmin").addEventListener("click", () => showTab("admin"));

  $("#dealerName").textContent = CFG.dealer || "Honda";
  if (CFG.salesPhone) {
    const wa = "62" + digits(CFG.salesPhone).replace(/^62/, "").replace(/^0/, "");
    $("#contactCard").href = "https://wa.me/" + wa;
    $("#contactText").textContent = (CFG.salesName || "Sales") + " · " + CFG.salesPhone;
  } else $("#contactCard").hidden = true;

  /* ================= Harga: tampilan Cari / Foto ================= */
  function setView(v) {
    $$(".seg button").forEach(b => b.classList.toggle("on", b.dataset.view === v));
    $("#viewDaftar").hidden = v !== "daftar";
    $("#viewBrosur").hidden = v !== "brosur";
    LS.set("view", v);
  }
  $$(".seg button").forEach(b => b.addEventListener("click", () => setView(b.dataset.view)));

  /* ----- data harga ----- */
  function validHarga(d) {
    if (!d || !Array.isArray(d.items) || !d.items.length) return "Tidak ada daftar tipe (items).";
    for (const it of d.items) {
      if (!it.tipe || !Array.isArray(it.tenor) || !Array.isArray(it.rows) || !it.rows.length) return `Data "${it.tipe || "?"}" tidak lengkap.`;
      for (const r of it.rows) if (!r.dp || !Array.isArray(r.ang) || r.ang.length !== it.tenor.length) return `"${it.tipe}" DP ${r.dp}: jumlah angsuran tidak sama dengan jumlah tenor.`;
    }
    return "";
  }
  async function loadHarga() {
    let d = null;
    try { const r = await fetch("harga.json?t=" + Date.now(), { cache: "no-store" }); if (r.ok) d = await r.json(); } catch (e) {}
    if (!d || validHarga(d)) d = LS.get("hargaData", null);
    if (d && !validHarga(d)) { state.harga = d; LS.set("hargaData", d); }
    $("#dlTipe").innerHTML = state.harga.items.map(it => `<option value="${esc(it.tipe)}">OTR ${fmt(it.otr)}</option>`).join("");
    renderGrup(); renderHarga(); checkStale(); recalc();
  }
  function checkStale() {
    const a = (state.harga.periode || "").trim(), b = (state.brosur.periode || "").trim();
    const n = $("#staleNote");
    if (a && b && a.toLowerCase() !== b.toLowerCase()) {
      n.hidden = false;
      n.innerHTML = `⚠ Data angsuran masih periode <b>${esc(a)}</b>, brosur sudah <b>${esc(b)}</b>. Perbarui harga.json lewat ⚙ — sementara cek <b>Foto brosur</b>.`;
    } else n.hidden = true;
  }

  const norm = s => String(s || "").toLowerCase().replace(/\bnew\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  function lev1(a, b) { // jarak edit <= 1 ?
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, diff = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++diff > 1) return false;
      if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    }
    return diff + (a.length - i) + (b.length - j) <= 1;
  }
  function matches(it, q) {
    if (!q) return true;
    const hay = norm(it.tipe + " " + (it.grup || "")), hayC = hay.replace(/ /g, ""), words = hay.split(" ");
    return norm(q).split(" ").filter(Boolean).every(t =>
      hay.includes(t) || hayC.includes(t) || (t.length >= 4 && /^[a-z]+$/.test(t) && words.some(w => lev1(t, w) || (w.length > t.length && lev1(t, w.slice(0, t.length))))));
  }
  function renderGrup() {
    const g = []; state.harga.items.forEach(it => { if (it.grup && !g.includes(it.grup)) g.push(it.grup); });
    $("#grupChips").innerHTML = g.map(x => `<button type="button">${esc(x)}</button>`).join("");
  }
  $("#grupChips").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    const inp = $("#cari"); inp.value = inp.value === b.textContent ? "" : b.textContent; renderHarga();
  });
  $("#cari").addEventListener("input", renderHarga);

  function minInfo(it) {
    const first = it.rows[0], last = it.rows[it.rows.length - 1];
    const dpMin = Math.min(...it.rows.map(r => r.promo || r.dp));
    const angMin = Math.min(...last.ang);
    return { dpMin, angMin, first };
  }
  function renderHarga() {
    const q = $("#cari").value.trim();
    $$("#grupChips button").forEach(b => b.classList.toggle("on", b.textContent === q));
    const items = state.harga.items.map((it, i) => ({ it, i })).filter(x => matches(x.it, q));
    const autoOpen = q && items.length <= 3;
    $("#hargaList").innerHTML = items.length ? items.map(({ it, i }) => {
      const m = minInfo(it);
      return `<div class="hcard${autoOpen ? " open" : ""}" data-i="${i}">
        <button type="button" class="hhead"><div><b>${esc(it.tipe)}</b><small>OTR ${fmt(it.otr)}</small></div>
          <div class="hmeta">DP mulai <b>${jt(m.dpMin)}</b><br>angsuran mulai <b>${jt(m.angMin)}</b></div></button>
        <div class="hbody"${autoOpen ? "" : " hidden"}>${autoOpen ? cardBody(it, i) : ""}</div></div>`;
    }).join("") : `<div class="empty">${state.harga.items.length ? "Tipe tidak ditemukan." : "Data harga belum ada — upload harga.json lewat ⚙"}</div>`;
  }
  function tenorHead(it, t) {
    const b = it.bayar && it.bayar[t] !== it.tenor[t] ? `<small>bayar ${it.bayar[t]}x</small>` : "";
    const k = it.ketTenor && it.ketTenor[t] ? `<small>${esc(it.ketTenor[t])}</small>` : "";
    return `<th>${it.tenor[t]}${b}${k}</th>`;
  }
  function cardBody(it, i) {
    const hasPromo = it.rows.some(r => r.promo);
    const sel = state.pick[i] || {};
    const tags = [];
    if (it.diskon) tags.push(`<span class="tag red">${esc(it.diskonLabel || "Diskon")} ${fmt(K(it.diskon))}${it.diskonKet ? " · " + esc(it.diskonKet) : ""}</span>`);
    if (it.bonus) tags.push(`<span class="tag">${esc(it.bonus)}</span>`);
    if (it.bayar && it.bayar.some((b, t) => b !== it.tenor[t])) tags.push(`<span class="tag">Tenor promo: bayar lebih sedikit</span>`);
    const head = `<tr><th class="dpc">DP</th>${hasPromo ? "<th>Bayar</th>" : ""}${it.tenor.map((_, t) => tenorHead(it, t)).join("")}</tr>`;
    const body = it.rows.map((r, ri) => `<tr><td class="dpc">${fmt(r.dp)}</td>${hasPromo ? `<td class="pc">${r.promo ? fmt(r.promo) : "-"}</td>` : ""}${
      r.ang.map((a, t) => `<td class="ac"><button type="button" data-r="${ri}" data-t="${t}" class="${sel.r === ri && sel.t === t ? "sel" : ""}">${fmt(a)}</button></td>`).join("")}</tr>`).join("");
    return `${tags.length ? `<div class="tags">${tags.join("")}</div>` : ""}
      <div class="tbl-wrap"><table class="htbl"><thead>${head}</thead><tbody>${body}</tbody></table></div>
      ${sel.r != null ? selBar(it, sel) : ""}`;
  }
  function selBar(it, sel) {
    const r = it.rows[sel.r], t = sel.t;
    const bayar = it.bayar && it.bayar[t] !== it.tenor[t] ? ` (bayar ${it.bayar[t]}x)` : "";
    return `<div class="selbar"><div>DP ${fmt(K(r.dp))}${r.promo ? ` → bayar <b>${fmt(K(r.promo))}</b>` : ""}<br>
      ${it.tenor[t]} bln${bayar} · <b>${fmt(K(r.ang[t]))}</b>/bln</div>
      <button type="button" class="btn" data-use="1">Pakai di form →</button></div>`;
  }
  $("#hargaList").addEventListener("click", e => {
    const card = e.target.closest(".hcard"); if (!card) return;
    const i = +card.dataset.i, it = state.harga.items[i], body = $(".hbody", card);
    if (e.target.closest(".hhead")) {
      const open = !card.classList.contains("open");
      card.classList.toggle("open", open); body.hidden = !open;
      if (open) body.innerHTML = cardBody(it, i);
      return;
    }
    const cell = e.target.closest("button[data-r]");
    if (cell) { state.pick[i] = { r: +cell.dataset.r, t: +cell.dataset.t }; body.innerHTML = cardBody(it, i); return; }
    if (e.target.closest("[data-use]")) {
      const s = state.pick[i];
      applyPaket(it, s.r, s.t, true);
      showTab("konsumen");
      setTimeout(() => F.elements.tipe.scrollIntoView({ block: "start", behavior: "smooth" }), 50);
      toast("Unit & angsuran terisi ✓");
    }
  });

  /* ================= Brosur foto ================= */
  function brosurSrc(i) {
    if (state.overrides[i]) return state.overrides[i];
    return state.brosur.files[i] + "?v=" + encodeURIComponent(state.brosur.updated || "1");
  }
  function renderBrosur() {
    const p = state.brosur.periode || "—";
    $("#periodeText").textContent = p; $("#periodeTop").textContent = p;
    $("#brosurList").innerHTML = state.brosur.files.map((f, i) =>
      `<figure data-i="${i}"><img src="${esc(brosurSrc(i))}" alt="Brosur ${i + 1}" ${i ? 'loading="lazy"' : ""}><figcaption>Brosur ${i + 1}</figcaption></figure>`).join("");
    $$("#brosurList img").forEach(img => img.addEventListener("error", () => {
      img.replaceWith(Object.assign(document.createElement("div"), { className: "empty", textContent: "Foto brosur belum ada — upload lewat ⚙" }));
    }));
  }
  $("#brosurList").addEventListener("click", e => { const f = e.target.closest("figure"); if (f) openLightbox(+f.dataset.i); });
  async function loadBrosur() {
    let info = null;
    try { const r = await fetch("brosur.json?t=" + Date.now(), { cache: "no-store" }); if (r.ok) info = await r.json(); } catch (e) {}
    if (!info) info = LS.get("brosurInfo", null);
    if (info && Array.isArray(info.files) && info.files.length) { state.brosur = info; LS.set("brosurInfo", info); }
    renderBrosur(); checkStale();
  }
  async function shareBrosur() {
    const periode = state.brosur.periode || "";
    const text = `Daftar harga & angsuran Honda ${periode}\n${CFG.dealer || ""}\nInfo & pemesanan: ${CFG.salesName || ""} ${CFG.salesPhone || ""}`.trim();
    try {
      toast("Menyiapkan brosur…");
      const files = await Promise.all(state.brosur.files.map(async (f, i) => {
        const b = await (await fetch(brosurSrc(i))).blob();
        return new File([b], `Brosur-${i + 1}-${periode.replace(/\s+/g, "-") || "Honda"}.jpg`, { type: b.type || "image/jpeg" });
      }));
      if (navigator.canShare && navigator.canShare({ files })) await navigator.share({ files, text });
      else { files.forEach(f => downloadBlob(f, f.name)); toast("Brosur diunduh ke HP"); }
    } catch (e) { if (e && e.name !== "AbortError") toast("Gagal membagikan brosur"); }
  }
  $("#btnShare").addEventListener("click", shareBrosur);

  /* ----- lightbox ----- */
  const lb = $("#lb"), lbImg = $("#lbImg"), lbScroll = $("#lbScroll");
  const ZOOMS = [1, 1.5, 2, 2.5, 3, 4];
  let zoom = 1;
  function setZoom(z, px, py) {
    const r = lbScroll.getBoundingClientRect();
    px = px == null ? r.width / 2 : px; py = py == null ? r.height / 2 : py;
    const fx = (lbScroll.scrollLeft + px) / (lbScroll.scrollWidth || 1), fy = (lbScroll.scrollTop + py) / (lbScroll.scrollHeight || 1);
    zoom = z; lbImg.style.width = (z * 100) + "%"; $("#lbZoom").textContent = Math.round(z * 100) + "%";
    requestAnimationFrame(() => { lbScroll.scrollLeft = fx * lbScroll.scrollWidth - px; lbScroll.scrollTop = fy * lbScroll.scrollHeight - py; });
  }
  function openLightbox(i) {
    lbImg.src = brosurSrc(i); lb.hidden = false; document.body.style.overflow = "hidden";
    lbScroll.scrollTo(0, 0); setZoom(1); history.pushState({ lb: 1 }, "");
  }
  function closeLightbox(fromPop) {
    if (lb.hidden) return;
    lb.hidden = true; document.body.style.overflow = "";
    if (!fromPop && history.state && history.state.lb) history.back();
  }
  window.addEventListener("popstate", () => closeLightbox(true));
  $("#lbClose").addEventListener("click", () => closeLightbox());
  $$(".lb-bar [data-z]").forEach(b => b.addEventListener("click", () => {
    let idx = ZOOMS.findIndex(z => z >= zoom - 0.01);
    idx = Math.max(0, Math.min(ZOOMS.length - 1, idx + +b.dataset.z)); setZoom(ZOOMS[idx]);
  }));
  let lastTap = 0;
  lbImg.addEventListener("click", e => {
    const now = Date.now();
    if (now - lastTap < 320) { const r = lbScroll.getBoundingClientRect(); setZoom(zoom > 1 ? 1 : 2.5, e.clientX - r.left, e.clientY - r.top); lastTap = 0; }
    else lastTap = now;
  });

  /* ================= Form konsumen ================= */
  const F = $("#form");
  const FIELDS = ["reg","sales","pemohon","alamat","statusRumah","pekerjaan","hp","stnk","tipe","warna","rakitan","otr","dp","tenor","bayar","angsuran","nego","scp","extra"];
  const NUMS = ["otr","dp","angsuran","scp","extra"];
  const findItem = name => { const n = norm(name); return n ? state.harga.items.find(it => norm(it.tipe) === n) : null; };

  function regSuffix(d = new Date()) { return `${CFG.regKode || "CDN-TPI"}/${ROMAN[d.getMonth()]}/${d.getFullYear()}`; }
  function nextReg() {
    const sfx = regSuffix(); let max = LS.get("regLast:" + sfx, 0);
    getHistory().forEach(r => { if (r.reg && r.reg.endsWith("/" + sfx)) { const n = parseInt(r.reg, 10); if (n > max) max = n; } });
    return String(max + 1).padStart(3, "0") + "/" + sfx;
  }
  function bumpReg(reg) {
    const sfx = regSuffix();
    if (reg && reg.endsWith("/" + sfx)) { const n = parseInt(reg, 10); if (n > LS.get("regLast:" + sfx, 0)) LS.set("regLast:" + sfx, n); }
  }

  function readForm() {
    const d = {};
    FIELDS.forEach(k => { let v = (F.elements[k].value || "").trim(); if (NUMS.includes(k)) v = digits(v); d[k] = v; });
    d.stnkSama = F.elements.stnkSama.checked;
    if (d.stnkSama) d.stnk = d.pemohon;
    return d;
  }
  function setTenor(v) {
    const sel = F.elements.tenor; v = v == null ? "" : String(v);
    if (v && !Array.from(sel.options).some(o => o.value === v)) sel.add(new Option(v, v));
    sel.value = v;
  }
  function writeForm(d) {
    FIELDS.forEach(k => { if (k === "tenor") return; let v = d[k] == null ? "" : d[k]; if (NUMS.includes(k)) v = fmt(v); F.elements[k].value = v; });
    setTenor(d.tenor);
    F.elements.stnkSama.checked = d.stnkSama !== false;
    state.auto = { otr: false, scp: false, angsuran: false };
    syncStnk(); syncChips(); recalc(); render();
  }

  function dpBayar(d) {
    const dp = +digits(d.dp), cut = (+digits(d.scp) || 0) + (+digits(d.extra) || 0);
    return dp && cut ? Math.max(0, dp - cut) : 0;
  }
  function buildText(d) {
    const v = x => (x != null && String(x).trim()) ? String(x).trim() : "-";
    const rp = x => (digits(x) ? fmt(x) : "-");
    let ang = rp(d.angsuran);
    if (d.nego) ang += ` (nego ${d.nego})`;
    let tenor = d.tenor ? d.tenor + " bulan" : "-";
    if (d.tenor && d.bayar && String(d.bayar) !== String(d.tenor)) tenor += ` (bayar ${d.bayar}x)`;
    const lines = [
      `Reg : ${v(d.reg)}`, "",
      `SALES: ${v(d.sales)}`, "",
      `Pemohon : ${v(d.pemohon)}`,
      `Alamat : ${v(d.alamat)}`,
      `Status Rumah : ${v(d.statusRumah)}`,
      `Pekerjaan : ${v(d.pekerjaan)}`,
      `No. Hp : ${v(d.hp)}`,
      `Nama STNK : ${v(d.stnkSama ? d.pemohon : d.stnk)}`, "",
      `Type : ${v(d.tipe)}`,
      `Warna : ${v(d.warna)}`,
      `Rakitan : ${v(d.rakitan)}`,
      `Otr : ${rp(d.otr)}`,
      `Dp Unit: ${rp(d.dp)}`,
      `Tenor : ${tenor}`,
      `Angsuran : ${ang}`, "",
      `Scp : ${rp(d.scp)}`,
      `Extra Discount : ${rp(d.extra)}`
    ];
    const bayar = dpBayar(d);
    if (bayar) lines.push(`Dp Bayar : ${fmt(bayar)}`);
    return lines.join("\n");
  }

  function syncStnk() {
    const same = F.elements.stnkSama.checked, inp = F.elements.stnk;
    inp.disabled = same; if (same) inp.value = F.elements.pemohon.value;
  }
  function syncChips() {
    const val = F.elements.statusRumah.value.trim().toLowerCase();
    $$('.chips[data-for="statusRumah"] button').forEach(b => b.classList.toggle("on", b.textContent.toLowerCase() === val));
  }
  $$('.chips[data-for="statusRumah"] button').forEach(b => b.addEventListener("click", () => {
    F.elements.statusRumah.value = b.textContent; syncChips(); onChange();
  }));

  /* ----- isi otomatis dari data harga ----- */
  function setNum(name, val, flag) {
    if (flag && !(state.auto[flag] || !digits(F.elements[name].value))) return;
    F.elements[name].value = val ? fmt(val) : "";
    if (flag) state.auto[flag] = true;
  }
  function applyPaket(it, r, t, fromHarga) {
    if (fromHarga) F.elements.tipe.value = it.tipe;
    state.auto = { otr: true, scp: true, angsuran: true };
    setNum("otr", it.otr, "otr");
    setNum("scp", it.diskon ? K(it.diskon) : "", "scp");
    if (r != null) F.elements.dp.value = fmt(K(it.rows[r].dp));
    if (t != null) setTenor(it.tenor[t]);
    recalc(); onChange();
  }
  function estimate(it, dp, t) {
    const rows = it.rows.slice().sort((a, b) => a.dp - b.dp).map(r => ({ x: K(r.dp), y: K(r.ang[t]) }));
    if (rows.length < 2) return 0;
    let a = rows[0], b = rows[1];
    for (let i = 0; i < rows.length - 1; i++) { a = rows[i]; b = rows[i + 1]; if (dp <= b.x) break; }
    const y = a.y + (b.y - a.y) * (dp - a.x) / (b.x - a.x);
    return y > 0 ? Math.round(y / 1000) * 1000 : 0;
  }
  // dipanggil tiap kali tipe / DP / tenor berubah
  function recalc() {
    const it = findItem(F.elements.tipe.value);
    const box = $("#paket"), est = $("#estimasi");
    if (!it) { box.hidden = true; F.elements.bayar.value = ""; return; }
    box.hidden = false;
    const dp = +digits(F.elements.dp.value), tenor = +F.elements.tenor.value;
    const rIdx = it.rows.findIndex(r => K(r.dp) === dp);
    const tIdx = it.tenor.indexOf(tenor);
    F.elements.bayar.value = tIdx >= 0 && it.bayar ? it.bayar[tIdx] : "";

    $("#paketInfo").innerHTML = `OTR <b>${fmt(it.otr)}</b>` +
      (it.diskon ? ` · ${esc(it.diskonLabel || "Diskon")} <b>${fmt(K(it.diskon))}</b>${it.diskonKet ? " (" + esc(it.diskonKet) + ")" : ""}` : " · tanpa diskon") +
      (it.bonus ? `<br>${esc(it.bonus)}` : "");
    $("#dpChips").innerHTML = it.rows.map((r, i) =>
      `<button type="button" data-r="${i}" class="${i === rIdx ? "on" : ""}">${fmt(r.dp)}${r.promo ? `<small>→ ${fmt(r.promo)}</small>` : ""}</button>`).join("");
    $("#tenorChips").innerHTML = it.tenor.map((tn, i) => {
      const b = it.bayar && it.bayar[i] !== tn ? `/${it.bayar[i]}x` : "";
      const a = rIdx >= 0 ? `<small>${fmt(it.rows[rIdx].ang[i])}</small>` : "";
      return `<button type="button" data-t="${i}" class="${i === tIdx ? "on" : ""}">${tn}${b}${a}</button>`;
    }).join("");

    est.hidden = true;
    if (tIdx >= 0 && rIdx >= 0) {
      setNum("angsuran", K(it.rows[rIdx].ang[tIdx]), "angsuran");
    } else if (tIdx >= 0 && dp > 0) {
      if (state.auto.angsuran) F.elements.angsuran.value = "";
      const dps = it.rows.map(r => K(r.dp)), lo = Math.min(...dps), hi = Math.max(...dps);
      const e = dp >= lo * 0.8 && dp <= hi * 1.25 ? estimate(it, dp, tIdx) : 0;
      if (e) {
        est.hidden = false;
        est.innerHTML = `<span>DP ${fmt(dp)} tidak ada di tabel. Estimasi angsuran ≈ <b>${fmt(e)}</b></span><button type="button" class="link" data-est="${e}">Pakai</button>`;
      }
    }
  }
  $("#dpChips").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    const it = findItem(F.elements.tipe.value); if (!it) return;
    state.auto.angsuran = true;
    F.elements.dp.value = fmt(K(it.rows[+b.dataset.r].dp));
    recalc(); onChange();
  });
  $("#tenorChips").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    const it = findItem(F.elements.tipe.value); if (!it) return;
    state.auto.angsuran = true;
    setTenor(it.tenor[+b.dataset.t]);
    recalc(); onChange();
  });
  $("#estimasi").addEventListener("click", e => {
    const b = e.target.closest("[data-est]"); if (!b) return;
    F.elements.angsuran.value = fmt(b.dataset.est); state.auto.angsuran = false; onChange();
  });

  function savedRecord() { return state.editingId ? getHistory().find(r => r.id === state.editingId) : null; }
  function render() {
    const d = readForm(), text = buildText(d);
    $("#preview").textContent = text;
    const rec = savedRecord(), saved = rec && buildText(rec) === text;
    $("#saveState").textContent = saved ? "✓ tersimpan" : (rec ? "ada perubahan — tekan Simpan" : "belum disimpan");
    $("#editFlag").hidden = !state.editingId;
  }
  function saveDraft() { LS.set("draft", { data: readForm(), editingId: state.editingId }); }
  function onChange() { syncStnk(); render(); saveDraft(); }

  F.addEventListener("input", e => {
    const el = e.target;
    if (el.classList.contains("num")) {
      el.value = fmt(el.value);
      if (el.name in state.auto) state.auto[el.name] = false;
    }
    if (el.name === "rakitan") el.value = digits(el.value).slice(0, 4);
    if (el.name === "statusRumah") syncChips();
    if (el.name === "tipe") {
      const it = findItem(el.value);
      if (it) { setNum("otr", it.otr, "otr"); setNum("scp", it.diskon ? K(it.diskon) : "", "scp"); }
    }
    if (["tipe", "dp"].includes(el.name)) recalc();
    onChange();
  });
  F.addEventListener("change", e => {
    if (e.target.name === "tenor") { state.auto.angsuran = state.auto.angsuran || !digits(F.elements.angsuran.value); recalc(); }
    onChange();
  });
  F.addEventListener("submit", e => e.preventDefault());

  function newForm() {
    state.editingId = null;
    writeForm({ reg: nextReg(), sales: CFG.salesName || "", rakitan: String(new Date().getFullYear()), stnkSama: true });
    saveDraft();
  }
  $("#btnNew").addEventListener("click", () => {
    const rec = savedRecord(), d = readForm();
    const dirty = rec ? buildText(rec) !== buildText(d) : !!(d.pemohon || d.hp);
    if (dirty && !confirm("Data ini belum disimpan. Kosongkan form?")) return;
    newForm(); window.scrollTo(0, 0); F.elements.pemohon.focus();
  });
  $("#btnCancelEdit").addEventListener("click", () => newForm());

  /* ================= Riwayat ================= */
  const getHistory = () => LS.get("konsumen", []);
  const setHistory = l => LS.set("konsumen", l);

  function saveRecord() {
    const d = readForm();
    if (!d.pemohon) { toast("Isi nama pemohon dulu"); F.elements.pemohon.focus(); return null; }
    const list = getHistory(), now = Date.now();
    const i = state.editingId ? list.findIndex(r => r.id === state.editingId) : -1;
    if (i >= 0) list[i] = Object.assign({}, list[i], d, { updatedAt: now });
    else { state.editingId = "k" + now.toString(36); list.unshift(Object.assign({ id: state.editingId, createdAt: now }, d)); }
    setHistory(list); bumpReg(d.reg); saveDraft(); render();
    return d;
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      const ta = Object.assign(document.createElement("textarea"), { value: text });
      ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
    }
    toast("Teks disalin ✓");
  }
  function waLink(text) {
    const to = digits(CFG.waTujuan || "");
    return "https://wa.me/" + (to ? "62" + to.replace(/^62/, "").replace(/^0/, "") : "") + "?text=" + encodeURIComponent(text);
  }
  $("#btnCopy").addEventListener("click", () => copyText(buildText(readForm())));
  $("#btnSave").addEventListener("click", () => { if (saveRecord()) toast("Tersimpan di Riwayat ✓"); });
  $("#btnWa").addEventListener("click", () => { const d = saveRecord(); if (d) window.open(waLink(buildText(d)), "_blank"); });

  function fmtDate(ts) {
    const d = new Date(ts);
    return `${d.getDate()} ${BULAN[d.getMonth()].slice(0, 3)} ${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  function renderHistory() {
    const q = $("#histSearch").value.trim().toLowerCase(), all = getHistory();
    const list = q ? all.filter(r => [r.pemohon, r.tipe, r.hp, r.reg, r.alamat, r.warna].join(" ").toLowerCase().includes(q)) : all;
    $("#histCount").textContent = `${list.length} data` + (q ? ` dari ${all.length}` : "");
    $("#histList").innerHTML = list.length ? list.map(r => `
      <div class="item" data-id="${esc(r.id)}">
        <div class="item-top"><b>${esc(r.pemohon || "-")}</b><span class="reg">${esc(r.reg || "")}</span></div>
        <div class="sub">${esc(r.tipe || "-")}${r.warna ? " · " + esc(r.warna) : ""}${r.tenor ? " · " + esc(r.tenor) + " bln" : ""}${r.angsuran ? " · " + fmt(r.angsuran) : ""}</div>
        <div class="sub">${esc(r.hp || "")}${r.hp ? " · " : ""}${fmtDate(r.updatedAt || r.createdAt)}</div>
        <div class="item-actions">
          <button class="link" data-act="copy">Salin</button><button class="link" data-act="wa">WA</button>
          <button class="link" data-act="edit">Edit</button><button class="link" data-act="del" style="color:var(--mute)">Hapus</button>
        </div></div>`).join("")
      : `<div class="empty">${q ? "Tidak ditemukan." : "Belum ada data konsumen.<br>Isi di tab Konsumen lalu tekan Simpan."}</div>`;
  }
  $("#histSearch").addEventListener("input", renderHistory);
  $("#histList").addEventListener("click", e => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const id = b.closest(".item").dataset.id, list = getHistory(), r = list.find(x => x.id === id); if (!r) return;
    const act = b.dataset.act;
    if (act === "copy") copyText(buildText(r));
    if (act === "wa") window.open(waLink(buildText(r)), "_blank");
    if (act === "edit") { state.editingId = id; writeForm(r); saveDraft(); showTab("konsumen"); }
    if (act === "del" && confirm(`Hapus data ${r.pemohon}?`)) {
      setHistory(list.filter(x => x.id !== id)); if (state.editingId === id) state.editingId = null;
      renderHistory(); render(); toast("Dihapus");
    }
  });
  function downloadBlob(blob, name) {
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const stamp = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  $("#btnCsv").addEventListener("click", () => {
    const list = getHistory(); if (!list.length) return toast("Belum ada data");
    const head = ["Tanggal","Reg","Sales","Pemohon","Alamat","Status Rumah","Pekerjaan","No HP","Nama STNK","Type","Warna","Rakitan","OTR","DP","Tenor","Bayar (x)","Angsuran","Nego","SCP","Extra Discount","DP Bayar"];
    const q = v => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const rows = list.map(r => [fmtDate(r.createdAt), r.reg, r.sales, r.pemohon, r.alamat, r.statusRumah, r.pekerjaan,
      r.hp ? `="${r.hp}"` : "", r.stnkSama ? r.pemohon : r.stnk, r.tipe, r.warna, r.rakitan, r.otr, r.dp, r.tenor, r.bayar, r.angsuran, r.nego, r.scp, r.extra, dpBayar(r) || ""].map(q).join(";"));
    downloadBlob(new Blob(["﻿" + [head.map(q).join(";")].concat(rows).join("\r\n")], { type: "text/csv;charset=utf-8" }), `konsumen-${stamp()}.csv`);
  });
  $("#btnBackup").addEventListener("click", () => downloadBlob(new Blob([JSON.stringify(getHistory(), null, 1)], { type: "application/json" }), `backup-konsumen-${stamp()}.json`));
  $("#fileRestore").addEventListener("change", async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try {
      const data = JSON.parse(await f.text()); if (!Array.isArray(data)) throw new Error("format");
      const list = getHistory(), ids = new Set(list.map(r => r.id)); let added = 0;
      data.forEach(r => { if (r && r.id && !ids.has(r.id)) { list.push(r); added++; } });
      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); setHistory(list); renderHistory(); toast(`${added} data dipulihkan`);
    } catch (err) { toast("File backup tidak valid"); }
  });

  /* ================= Admin: GitHub ================= */
  function autoRepo() {
    const h = location.hostname; if (!h.endsWith(".github.io")) return {};
    const seg = location.pathname.split("/").filter(Boolean)[0];
    return { owner: h.split(".")[0], repo: seg && !seg.includes(".") ? seg : h };
  }
  function ghCfg() {
    const s = LS.get("gh", {}), a = autoRepo();
    return { owner: s.owner || CFG.githubOwner || a.owner || "", repo: s.repo || CFG.githubRepo || a.repo || "", token: s.token || "", branch: s.branch || "" };
  }
  const admLog = $("#admLog");
  function log(msg, reset) { admLog.hidden = false; admLog.textContent = (reset ? "" : admLog.textContent + "\n") + msg; admLog.scrollTop = admLog.scrollHeight; }
  async function gh(path, opts = {}) {
    const g = ghCfg();
    const headers = { Authorization: "Bearer " + g.token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    if (opts.body) headers["Content-Type"] = "application/json";
    const res = await fetch("https://api.github.com" + path, Object.assign({}, opts, { headers, cache: "no-store" }));
    if (!res.ok) { let m = ""; try { m = (await res.json()).message || ""; } catch (e) {} const err = new Error(m || res.statusText); err.status = res.status; throw err; }
    return res.status === 204 ? null : res.json();
  }
  function explain(e) {
    switch (e.status) {
      case 401: return "Token salah atau sudah kedaluwarsa. Buat token baru.";
      case 403: return "Token tidak punya izin menulis. Pastikan izin Contents = Read and write.";
      case 404: return "Repo tidak ditemukan. Cek username & nama repo, dan pastikan token diberi akses ke repo ini.";
      case 409: case 422: return "Bentrok dengan perubahan lain. Coba tekan sekali lagi.";
      default: return (e.status ? e.status + " " : "") + (e.message || "Koneksi gagal — cek internet.");
    }
  }
  const repoPath = () => { const g = ghCfg(); return `/repos/${encodeURIComponent(g.owner)}/${encodeURIComponent(g.repo)}`; };
  async function ensureBranch() {
    const g = ghCfg(); if (!g.owner || !g.repo) throw new Error("Isi username & nama repo dulu.");
    if (g.branch) return g.branch;
    const info = await gh(repoPath()); const s = LS.get("gh", {}); s.branch = info.default_branch; LS.set("gh", s);
    return info.default_branch;
  }
  async function getSha(path, branch) {
    try { return (await gh(`${repoPath()}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`)).sha; }
    catch (e) { if (e.status === 404) return null; throw e; }
  }
  async function putFile(path, b64, message) {
    const branch = await ensureBranch();
    for (let attempt = 0; ; attempt++) {
      const sha = await getSha(path, branch), body = { message, content: b64, branch };
      if (sha) body.sha = sha;
      try { return await gh(`${repoPath()}/contents/${encodeURIComponent(path)}`, { method: "PUT", body: JSON.stringify(body) }); }
      catch (e) { if ((e.status === 409 || e.status === 422) && attempt < 3) { await sleep(1500); continue; } throw e; }
    }
  }
  const blobToB64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); });
  const strToB64 = s => { const bytes = new TextEncoder().encode(s); let bin = ""; bytes.forEach(b => { bin += String.fromCharCode(b); }); return btoa(bin); };
  const kb = n => n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.round(n / 1024) + " KB";
  async function prepImage(file) {
    const MAXW = 2400, url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Foto tidak bisa dibaca — pilih file JPG/PNG.")); i.src = url; });
      if (file.type === "image/jpeg" && img.naturalWidth <= MAXW && file.size <= 1.8e6) return file;
      const scale = Math.min(1, MAXW / img.naturalWidth), c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
      const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
      return await new Promise(res => c.toBlob(res, "image/jpeg", 0.88));
    } finally { URL.revokeObjectURL(url); }
  }

  const picks = [null, null];
  let hargaBaru = null;
  function refreshGhBadge() {
    const g = ghCfg(), b = $("#ghBadge"), ok = !!(g.token && g.owner && g.repo);
    b.textContent = ok ? "tersambung" : "belum"; b.classList.toggle("ok", ok);
  }
  function openAdmin() {
    const g = ghCfg();
    $("#ghOwner").value = g.owner; $("#ghRepo").value = g.repo; $("#ghToken").value = g.token;
    refreshGhBadge();
    if (!$("#admPeriode").value) { const d = new Date(); $("#admPeriode").value = `${BULAN[d.getMonth()]} ${d.getFullYear()}`; }
    $$(".slot").forEach((slot, i) => {
      if (picks[i]) return;
      const img = $("img", slot);
      img.onload = () => slot.classList.add("has"); img.onerror = () => slot.classList.remove("has");
      if (state.brosur.files[i]) img.src = brosurSrc(i);
    });
    $("#hargaBadge").textContent = state.harga.items.length ? `${state.harga.items.length} tipe · ${state.harga.periode || "?"}` : "belum ada";
  }
  $$(".slot").forEach((slot, i) => {
    $("input", slot).addEventListener("change", e => {
      const f = e.target.files[0]; if (!f) return;
      picks[i] = f; $("img", slot).src = URL.createObjectURL(f);
      slot.classList.add("has", "new"); $("small", slot).textContent = "foto baru ✓";
    });
  });
  $("#btnGhSave").addEventListener("click", async () => {
    const s = { owner: $("#ghOwner").value.trim(), repo: $("#ghRepo").value.trim(), token: $("#ghToken").value.trim(), branch: "" };
    LS.set("gh", s); refreshGhBadge();
    if (!s.owner || !s.repo || !s.token) return toast("Lengkapi username, repo & token");
    log("Mengetes koneksi ke GitHub…", true);
    try { const branch = await ensureBranch(); log(`✓ Tersambung ke ${s.owner}/${s.repo} (branch ${branch}).`); toast("GitHub tersambung ✓"); }
    catch (e) { log("✗ " + explain(e)); }
  });
  $("#btnGhForget").addEventListener("click", () => {
    const s = LS.get("gh", {}); delete s.token; LS.set("gh", s); $("#ghToken").value = ""; refreshGhBadge(); toast("Token dihapus dari HP ini");
  });
  $("#btnUpload").addEventListener("click", async () => {
    const g = ghCfg();
    if (!g.token || !g.owner || !g.repo) { toast("Sambungkan GitHub dulu (langkah 1)"); return; }
    const periode = $("#admPeriode").value.trim() || state.brosur.periode;
    if (!picks[0] && !picks[1] && periode === state.brosur.periode) { toast("Pilih foto brosur baru dulu"); return; }
    const btn = $("#btnUpload"); btn.disabled = true; log("Mulai upload…", true);
    try {
      const files = state.brosur.files.length >= 2 ? state.brosur.files.slice(0, 2) : DEFAULT_FILES.slice(), newBlobs = [];
      for (let i = 0; i < 2; i++) {
        if (!picks[i]) continue;
        log(`Menyiapkan brosur ${i + 1}…`); const blob = await prepImage(picks[i]);
        log(`Upload brosur ${i + 1} (${kb(blob.size)})…`); await putFile(files[i], await blobToB64(blob), `Brosur ${i + 1} - ${periode}`);
        newBlobs[i] = blob;
      }
      const info = { periode, updated: new Date().toISOString(), files };
      log("Menyimpan periode…"); await putFile("brosur.json", strToB64(JSON.stringify(info, null, 2) + "\n"), `Periode brosur: ${periode}`);
      newBlobs.forEach((b, i) => { if (b) state.overrides[i] = URL.createObjectURL(b); });
      state.brosur = info; LS.set("brosurInfo", info); renderBrosur(); checkStale();
      picks[0] = picks[1] = null;
      $$(".slot").forEach(s => { s.classList.remove("new"); $("small", s).textContent = "ketuk untuk ganti"; });
      log("✓ Berhasil! Web online akan menampilkan brosur baru dalam ±1–2 menit.");
      if (state.harga.periode && state.harga.periode.toLowerCase() !== periode.toLowerCase())
        log(`ℹ Jangan lupa perbarui Data harga & angsuran (masih ${state.harga.periode}) di langkah 3.`);
      toast("Brosur terbit ✓");
    } catch (e) { log("✗ Gagal: " + explain(e)); }
    finally { btn.disabled = false; }
  });

  $("#fileHarga").addEventListener("change", async e => {
    const f = e.target.files[0]; e.target.value = ""; hargaBaru = null; $("#btnHarga").disabled = true;
    if (!f) return;
    let d;
    try { d = JSON.parse(await f.text()); } catch (err) { $("#hargaCek").textContent = "✗ File bukan JSON yang valid."; return; }
    const bad = validHarga(d);
    if (bad) { $("#hargaCek").textContent = "✗ " + bad; return; }
    hargaBaru = d; $("#btnHarga").disabled = false;
    $("#hargaCek").textContent = `✓ ${d.items.length} tipe · periode ${d.periode || "(tanpa periode)"} — siap diterbitkan.`;
  });
  $("#btnHarga").addEventListener("click", async () => {
    if (!hargaBaru) return;
    const g = ghCfg();
    if (!g.token) { toast("Sambungkan GitHub dulu (langkah 1)"); return; }
    const btn = $("#btnHarga"); btn.disabled = true; log(`Menerbitkan data harga (${hargaBaru.items.length} tipe)…`, true);
    try {
      await putFile("harga.json", strToB64(JSON.stringify(hargaBaru) + "\n"), `Data harga ${hargaBaru.periode || ""}`.trim());
      state.harga = hargaBaru; LS.set("hargaData", hargaBaru);
      $("#dlTipe").innerHTML = state.harga.items.map(it => `<option value="${esc(it.tipe)}">OTR ${fmt(it.otr)}</option>`).join("");
      renderGrup(); renderHarga(); checkStale(); openAdmin();
      log("✓ Data harga terbit. Web online diperbarui dalam ±1–2 menit."); toast("Data harga terbit ✓");
      hargaBaru = null; $("#hargaCek").textContent = "";
    } catch (e) { log("✗ Gagal: " + explain(e)); btn.disabled = false; }
  });

  /* ================= Start ================= */
  const draft = LS.get("draft", null);
  if (draft && draft.data) { state.editingId = draft.editingId || null; writeForm(draft.data); }
  else newForm();
  (function refreshRegIfEmpty() {
    const d = readForm();
    if (!state.editingId && !d.pemohon && !d.reg.endsWith("/" + regSuffix())) { F.elements.reg.value = nextReg(); render(); saveDraft(); }
  })();
  setView(LS.get("view", "daftar"));
  showTab(LS.get("tab", "harga"));
  loadBrosur();
  loadHarga();
})();
