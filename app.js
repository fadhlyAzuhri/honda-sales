/* Web Sales Honda — harga brosur + data konsumen
   Semua data konsumen disimpan di localStorage HP (tidak dikirim ke mana pun). */
(function () {
  "use strict";

  const CFG = window.APP_CONFIG || {};
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  const ROMAN = ["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII"];
  const BULAN = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
  const DEFAULT_FILES = ["brosur-1.jpg", "brosur-2.jpg"];

  const digits = v => String(v == null ? "" : v).replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  const fmt = v => { const d = digits(v); return d ? d.replace(/\B(?=(\d{3})+(?!\d))/g, ".") : ""; };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  let toastTimer;
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  const state = {
    brosur: { periode: "", updated: "", files: DEFAULT_FILES.slice() },
    overrides: [],      // gambar yang baru diupload (tampil langsung sebelum GitHub selesai)
    motor: [],
    editingId: null,
    otrAuto: false
  };

  /* ---------------- Tabs ---------------- */
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

  /* ---------------- Header & kontak ---------------- */
  $("#dealerName").textContent = CFG.dealer || "Honda";
  if (CFG.salesPhone) {
    const wa = "62" + digits(CFG.salesPhone).replace(/^62/, "").replace(/^0/, "");
    $("#contactCard").href = "https://wa.me/" + wa;
    $("#contactText").textContent = (CFG.salesName || "Sales") + " · " + CFG.salesPhone;
  } else {
    $("#contactCard").hidden = true;
  }

  /* ---------------- Brosur / Harga ---------------- */
  function brosurSrc(i) {
    if (state.overrides[i]) return state.overrides[i];
    return state.brosur.files[i] + "?v=" + encodeURIComponent(state.brosur.updated || "1");
  }
  function renderBrosur() {
    const p = state.brosur.periode || "—";
    $("#periodeText").textContent = p;
    $("#periodeTop").textContent = p;
    $("#brosurList").innerHTML = state.brosur.files.map((f, i) =>
      `<figure data-i="${i}"><img src="${esc(brosurSrc(i))}" alt="Brosur ${i + 1}" ${i ? 'loading="lazy"' : ""}><figcaption>Brosur ${i + 1}</figcaption></figure>`
    ).join("");
    $$("#brosurList img").forEach(img => img.addEventListener("error", () => {
      img.replaceWith(Object.assign(document.createElement("div"), { className: "empty", textContent: "Foto brosur belum ada — upload lewat ⚙" }));
    }));
  }
  $("#brosurList").addEventListener("click", e => {
    const fig = e.target.closest("figure"); if (fig) openLightbox(+fig.dataset.i);
  });

  async function loadBrosur() {
    let info = null;
    try {
      const r = await fetch("brosur.json?t=" + Date.now(), { cache: "no-store" });
      if (r.ok) info = await r.json();
    } catch (e) {}
    if (!info) info = LS.get("brosurInfo", null);
    if (info && Array.isArray(info.files) && info.files.length) {
      state.brosur = info; LS.set("brosurInfo", info);
    }
    renderBrosur();
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
      if (navigator.canShare && navigator.canShare({ files })) {
        await navigator.share({ files, text });
      } else {
        files.forEach(f => downloadBlob(f, f.name));
        toast("Brosur diunduh ke HP");
      }
    } catch (e) {
      if (e && e.name !== "AbortError") toast("Gagal membagikan brosur");
    }
  }
  $("#btnShare").addEventListener("click", shareBrosur);

  /* ---------------- Lightbox (zoom) ---------------- */
  const lb = $("#lb"), lbImg = $("#lbImg"), lbScroll = $("#lbScroll");
  const ZOOMS = [1, 1.5, 2, 2.5, 3, 4];
  let zoom = 1;
  function setZoom(z, px, py) {
    const r = lbScroll.getBoundingClientRect();
    px = px == null ? r.width / 2 : px; py = py == null ? r.height / 2 : py;
    const fx = (lbScroll.scrollLeft + px) / (lbScroll.scrollWidth || 1);
    const fy = (lbScroll.scrollTop + py) / (lbScroll.scrollHeight || 1);
    zoom = z;
    lbImg.style.width = (z * 100) + "%";
    $("#lbZoom").textContent = Math.round(z * 100) + "%";
    requestAnimationFrame(() => {
      lbScroll.scrollLeft = fx * lbScroll.scrollWidth - px;
      lbScroll.scrollTop = fy * lbScroll.scrollHeight - py;
    });
  }
  function openLightbox(i) {
    lbImg.src = brosurSrc(i); lb.hidden = false; document.body.style.overflow = "hidden";
    lbScroll.scrollTo(0, 0); setZoom(1);
    history.pushState({ lb: 1 }, "");
  }
  function closeLightbox(fromPop) {
    if (lb.hidden) return;
    lb.hidden = true; document.body.style.overflow = "";
    if (!fromPop && history.state && history.state.lb) history.back();
  }
  window.addEventListener("popstate", () => closeLightbox(true));
  $("#lbClose").addEventListener("click", () => closeLightbox());
  $$(".lb-bar [data-z]").forEach(b => b.addEventListener("click", () => {
    const dir = +b.dataset.z; let idx = ZOOMS.findIndex(z => z >= zoom - 0.01);
    idx = Math.max(0, Math.min(ZOOMS.length - 1, idx + dir)); setZoom(ZOOMS[idx]);
  }));
  let lastTap = 0;
  lbImg.addEventListener("click", e => {
    const now = Date.now();
    if (now - lastTap < 320) {
      const r = lbScroll.getBoundingClientRect();
      setZoom(zoom > 1 ? 1 : 2.5, e.clientX - r.left, e.clientY - r.top);
      lastTap = 0;
    } else lastTap = now;
  });

  /* ---------------- Daftar tipe motor ---------------- */
  async function loadMotor() {
    let list = null;
    try {
      const r = await fetch("motor.json?t=" + Date.now(), { cache: "no-store" });
      if (r.ok) list = await r.json();
    } catch (e) {}
    if (!Array.isArray(list)) list = LS.get("motorList", []);
    state.motor = list; LS.set("motorList", list);
    $("#dlTipe").innerHTML = list.map(m => `<option value="${esc(m.tipe)}">OTR ${fmt(m.otr)}</option>`).join("");
  }
  const findMotor = name => {
    const n = String(name || "").trim().toLowerCase();
    return n ? state.motor.find(m => m.tipe.toLowerCase() === n) : null;
  };

  /* ---------------- Form konsumen ---------------- */
  const F = $("#form");
  const FIELDS = ["reg","sales","pemohon","alamat","statusRumah","pekerjaan","hp","stnk","tipe","warna","rakitan","otr","dp","tenor","angsuran","nego","scp","extra"];
  const NUMS = ["otr","dp","angsuran","scp","extra"];

  function regSuffix(d = new Date()) { return `${CFG.regKode || "CDN-TPI"}/${ROMAN[d.getMonth()]}/${d.getFullYear()}`; }
  function nextReg() {
    const sfx = regSuffix();
    let max = LS.get("regLast:" + sfx, 0);
    getHistory().forEach(r => {
      if (r.reg && r.reg.endsWith("/" + sfx)) { const n = parseInt(r.reg, 10); if (n > max) max = n; }
    });
    return String(max + 1).padStart(3, "0") + "/" + sfx;
  }
  function bumpReg(reg) {
    const sfx = regSuffix();
    if (reg && reg.endsWith("/" + sfx)) {
      const n = parseInt(reg, 10);
      if (n > LS.get("regLast:" + sfx, 0)) LS.set("regLast:" + sfx, n);
    }
  }

  function readForm() {
    const d = {};
    FIELDS.forEach(k => { let v = (F.elements[k].value || "").trim(); if (NUMS.includes(k)) v = digits(v); d[k] = v; });
    d.stnkSama = F.elements.stnkSama.checked;
    if (d.stnkSama) d.stnk = d.pemohon;
    return d;
  }
  function writeForm(d) {
    const sel = F.elements.tenor;
    if (d.tenor && !Array.from(sel.options).some(o => o.value === String(d.tenor))) sel.add(new Option(d.tenor, d.tenor));
    FIELDS.forEach(k => { let v = d[k] == null ? "" : d[k]; if (NUMS.includes(k)) v = fmt(v); F.elements[k].value = v; });
    F.elements.stnkSama.checked = d.stnkSama !== false;
    state.otrAuto = false;
    syncStnk(); syncChips(); render();
  }

  function buildText(d) {
    const v = x => (x != null && String(x).trim()) ? String(x).trim() : "-";
    const rp = x => (digits(x) ? fmt(x) : "-");
    let ang = rp(d.angsuran);
    if (d.nego) ang += ` (nego ${d.nego})`;
    return [
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
      `Tenor : ${d.tenor ? d.tenor + " bulan" : "-"}`,
      `Angsuran : ${ang}`, "",
      `Scp : ${rp(d.scp)}`,
      `Extra Discount : ${rp(d.extra)}`
    ].join("\n");
  }

  function syncStnk() {
    const same = F.elements.stnkSama.checked, inp = F.elements.stnk;
    inp.disabled = same;
    if (same) inp.value = F.elements.pemohon.value;
  }
  function syncChips() {
    const val = F.elements.statusRumah.value.trim().toLowerCase();
    $$('.chips[data-for="statusRumah"] button').forEach(b => b.classList.toggle("on", b.textContent.toLowerCase() === val));
  }
  $$('.chips[data-for="statusRumah"] button').forEach(b => b.addEventListener("click", () => {
    F.elements.statusRumah.value = b.textContent; syncChips(); onChange();
  }));

  function savedRecord() { return state.editingId ? getHistory().find(r => r.id === state.editingId) : null; }
  function render() {
    const d = readForm();
    const text = buildText(d);
    $("#preview").textContent = text;
    const rec = savedRecord();
    const saved = rec && buildText(rec) === text;
    $("#saveState").textContent = saved ? "✓ tersimpan" : (rec ? "ada perubahan — tekan Simpan" : "belum disimpan");
    $("#editFlag").hidden = !state.editingId;
  }
  function saveDraft() { LS.set("draft", { data: readForm(), editingId: state.editingId }); }
  function onChange() { syncStnk(); render(); saveDraft(); }

  F.addEventListener("input", e => {
    const el = e.target;
    if (el.classList.contains("num")) {
      el.value = fmt(el.value);
      if (el.name === "otr") state.otrAuto = false;
    }
    if (el.name === "rakitan") el.value = digits(el.value).slice(0, 4);
    if (el.name === "statusRumah") syncChips();
    if (el.name === "tipe") {
      const m = findMotor(el.value);
      if (m && (!digits(F.elements.otr.value) || state.otrAuto)) {
        F.elements.otr.value = fmt(m.otr); state.otrAuto = true;
      }
    }
    onChange();
  });
  F.addEventListener("change", onChange);
  F.addEventListener("submit", e => e.preventDefault());

  function newForm() {
    state.editingId = null;
    writeForm({ reg: nextReg(), sales: CFG.salesName || "", rakitan: String(new Date().getFullYear()), stnkSama: true });
    saveDraft();
  }
  $("#btnNew").addEventListener("click", () => {
    const rec = savedRecord(), d = readForm();
    const dirty = rec ? buildText(rec) !== buildText(d) : !!(d.pemohon || d.hp || d.tipe);
    if (dirty && !confirm("Data ini belum disimpan. Kosongkan form?")) return;
    newForm(); window.scrollTo(0, 0); F.elements.pemohon.focus();
  });
  $("#btnCancelEdit").addEventListener("click", () => newForm());

  /* ---------------- Riwayat (localStorage) ---------------- */
  const getHistory = () => LS.get("konsumen", []);
  const setHistory = l => LS.set("konsumen", l);

  function saveRecord() {
    const d = readForm();
    if (!d.pemohon) { toast("Isi nama pemohon dulu"); F.elements.pemohon.focus(); return null; }
    const list = getHistory(), now = Date.now();
    const i = state.editingId ? list.findIndex(r => r.id === state.editingId) : -1;
    if (i >= 0) list[i] = Object.assign({}, list[i], d, { updatedAt: now });
    else {
      state.editingId = "k" + now.toString(36);
      list.unshift(Object.assign({ id: state.editingId, createdAt: now }, d));
    }
    setHistory(list); bumpReg(d.reg); saveDraft(); render();
    return d;
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      const ta = Object.assign(document.createElement("textarea"), { value: text });
      ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta);
      ta.select(); document.execCommand("copy"); ta.remove();
    }
    toast("Teks disalin ✓");
  }
  function waLink(text) {
    const to = digits(CFG.waTujuan || "");
    const num = to ? "62" + to.replace(/^62/, "").replace(/^0/, "") : "";
    return "https://wa.me/" + num + "?text=" + encodeURIComponent(text);
  }

  $("#btnCopy").addEventListener("click", () => copyText(buildText(readForm())));
  $("#btnSave").addEventListener("click", () => { if (saveRecord()) toast("Tersimpan di Riwayat ✓"); });
  $("#btnWa").addEventListener("click", () => {
    const d = saveRecord(); if (!d) return;
    window.open(waLink(buildText(d)), "_blank");
  });

  function fmtDate(ts) {
    const d = new Date(ts);
    return `${d.getDate()} ${BULAN[d.getMonth()].slice(0, 3)} ${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  function renderHistory() {
    const q = $("#histSearch").value.trim().toLowerCase();
    const all = getHistory();
    const list = q ? all.filter(r => [r.pemohon, r.tipe, r.hp, r.reg, r.alamat, r.warna].join(" ").toLowerCase().includes(q)) : all;
    $("#histCount").textContent = `${list.length} data` + (q ? ` dari ${all.length}` : "");
    $("#histList").innerHTML = list.length ? list.map(r => `
      <div class="item" data-id="${esc(r.id)}">
        <div class="item-top"><b>${esc(r.pemohon || "-")}</b><span class="reg">${esc(r.reg || "")}</span></div>
        <div class="sub">${esc(r.tipe || "-")}${r.warna ? " · " + esc(r.warna) : ""}${r.tenor ? " · " + esc(r.tenor) + " bln" : ""}${r.angsuran ? " · " + fmt(r.angsuran) : ""}</div>
        <div class="sub">${esc(r.hp || "")}${r.hp ? " · " : ""}${fmtDate(r.updatedAt || r.createdAt)}</div>
        <div class="item-actions">
          <button class="link" data-act="copy">Salin</button>
          <button class="link" data-act="wa">WA</button>
          <button class="link" data-act="edit">Edit</button>
          <button class="link" data-act="del" style="color:var(--mute)">Hapus</button>
        </div>
      </div>`).join("") : `<div class="empty">${q ? "Tidak ditemukan." : "Belum ada data konsumen.<br>Isi di tab Konsumen lalu tekan Simpan."}</div>`;
  }
  $("#histSearch").addEventListener("input", renderHistory);
  $("#histList").addEventListener("click", e => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const id = b.closest(".item").dataset.id;
    const list = getHistory(), r = list.find(x => x.id === id); if (!r) return;
    const act = b.dataset.act;
    if (act === "copy") copyText(buildText(r));
    if (act === "wa") window.open(waLink(buildText(r)), "_blank");
    if (act === "edit") { state.editingId = id; writeForm(r); saveDraft(); showTab("konsumen"); }
    if (act === "del" && confirm(`Hapus data ${r.pemohon}?`)) {
      setHistory(list.filter(x => x.id !== id));
      if (state.editingId === id) state.editingId = null;
      renderHistory(); render(); toast("Dihapus");
    }
  });

  function downloadBlob(blob, name) {
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const stamp = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

  $("#btnCsv").addEventListener("click", () => {
    const list = getHistory();
    if (!list.length) return toast("Belum ada data");
    const head = ["Tanggal","Reg","Sales","Pemohon","Alamat","Status Rumah","Pekerjaan","No HP","Nama STNK","Type","Warna","Rakitan","OTR","DP","Tenor","Angsuran","Nego","SCP","Extra Discount"];
    const q = v => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const rows = list.map(r => [fmtDate(r.createdAt), r.reg, r.sales, r.pemohon, r.alamat, r.statusRumah, r.pekerjaan,
      r.hp ? `="${r.hp}"` : "", r.stnkSama ? r.pemohon : r.stnk, r.tipe, r.warna, r.rakitan, r.otr, r.dp, r.tenor, r.angsuran, r.nego, r.scp, r.extra]
      .map((v, i) => i === 7 && v ? `"${v.replace(/"/g, '""')}"` : q(v)).join(";"));
    downloadBlob(new Blob(["﻿" + [head.map(q).join(";")].concat(rows).join("\r\n")], { type: "text/csv;charset=utf-8" }), `konsumen-${stamp()}.csv`);
  });
  $("#btnBackup").addEventListener("click", () => {
    downloadBlob(new Blob([JSON.stringify(getHistory(), null, 1)], { type: "application/json" }), `backup-konsumen-${stamp()}.json`);
  });
  $("#fileRestore").addEventListener("change", async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!Array.isArray(data)) throw new Error("format");
      const list = getHistory(), ids = new Set(list.map(r => r.id));
      let added = 0;
      data.forEach(r => { if (r && r.id && !ids.has(r.id)) { list.push(r); added++; } });
      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setHistory(list); renderHistory(); toast(`${added} data dipulihkan`);
    } catch (err) { toast("File backup tidak valid"); }
  });

  /* ---------------- Admin: update brosur via GitHub ---------------- */
  function autoRepo() {
    const h = location.hostname;
    if (!h.endsWith(".github.io")) return {};
    const seg = location.pathname.split("/").filter(Boolean)[0];
    return { owner: h.split(".")[0], repo: seg && !seg.includes(".") ? seg : h };
  }
  function ghCfg() {
    const s = LS.get("gh", {}), a = autoRepo();
    return {
      owner: s.owner || CFG.githubOwner || a.owner || "",
      repo: s.repo || CFG.githubRepo || a.repo || "",
      token: s.token || "", branch: s.branch || ""
    };
  }
  const admLog = $("#admLog");
  function log(msg, reset) {
    admLog.hidden = false;
    admLog.textContent = (reset ? "" : admLog.textContent + "\n") + msg;
    admLog.scrollTop = admLog.scrollHeight;
  }

  async function gh(path, opts = {}) {
    const g = ghCfg();
    const headers = { Authorization: "Bearer " + g.token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    if (opts.body) headers["Content-Type"] = "application/json";
    const res = await fetch("https://api.github.com" + path, Object.assign({}, opts, { headers, cache: "no-store" }));
    if (!res.ok) {
      let m = ""; try { m = (await res.json()).message || ""; } catch (e) {}
      const err = new Error(m || res.statusText); err.status = res.status; throw err;
    }
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
    const g = ghCfg();
    if (!g.owner || !g.repo) throw Object.assign(new Error("Isi username & nama repo dulu."), {});
    if (g.branch) return g.branch;
    const info = await gh(repoPath());
    const s = LS.get("gh", {}); s.branch = info.default_branch; LS.set("gh", s);
    return info.default_branch;
  }
  async function getSha(path, branch) {
    try { return (await gh(`${repoPath()}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`)).sha; }
    catch (e) { if (e.status === 404) return null; throw e; }
  }
  async function putFile(path, b64, message) {
    const branch = await ensureBranch();
    for (let attempt = 0; ; attempt++) {
      const sha = await getSha(path, branch);
      const body = { message, content: b64, branch };
      if (sha) body.sha = sha;
      try { return await gh(`${repoPath()}/contents/${encodeURIComponent(path)}`, { method: "PUT", body: JSON.stringify(body) }); }
      catch (e) {
        if ((e.status === 409 || e.status === 422) && attempt < 3) { await sleep(1500); continue; }
        throw e;
      }
    }
  }
  const blobToB64 = blob => new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob);
  });
  const strToB64 = s => { const bytes = new TextEncoder().encode(s); let bin = ""; bytes.forEach(b => { bin += String.fromCharCode(b); }); return btoa(bin); };
  const kb = n => n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.round(n / 1024) + " KB";

  async function prepImage(file) {
    const MAXW = 2400;
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Foto tidak bisa dibaca — pilih file JPG/PNG.")); i.src = url; });
      if (file.type === "image/jpeg" && img.naturalWidth <= MAXW && file.size <= 1.8e6) return file;
      const scale = Math.min(1, MAXW / img.naturalWidth);
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
      const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      return await new Promise(res => c.toBlob(res, "image/jpeg", 0.88));
    } finally { URL.revokeObjectURL(url); }
  }

  const picks = [null, null];
  function refreshGhBadge() {
    const g = ghCfg(), b = $("#ghBadge");
    const ok = !!(g.token && g.owner && g.repo);
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
      img.onload = () => slot.classList.add("has");
      img.onerror = () => slot.classList.remove("has");
      if (state.brosur.files[i]) img.src = brosurSrc(i);
    });
    if (!$("#admMotor").value) $("#admMotor").value = state.motor.map(m => `${m.tipe} | ${fmt(m.otr)}`).join("\n");
  }
  $$(".slot").forEach((slot, i) => {
    $("input", slot).addEventListener("change", e => {
      const f = e.target.files[0]; if (!f) return;
      picks[i] = f;
      $("img", slot).src = URL.createObjectURL(f);
      slot.classList.add("has", "new");
      $("small", slot).textContent = "foto baru ✓";
    });
  });

  $("#btnGhSave").addEventListener("click", async () => {
    const s = { owner: $("#ghOwner").value.trim(), repo: $("#ghRepo").value.trim(), token: $("#ghToken").value.trim(), branch: "" };
    LS.set("gh", s); refreshGhBadge();
    if (!s.owner || !s.repo || !s.token) return toast("Lengkapi username, repo & token");
    log("Mengetes koneksi ke GitHub…", true);
    try {
      const branch = await ensureBranch();
      log(`✓ Tersambung ke ${s.owner}/${s.repo} (branch ${branch}).`);
      toast("GitHub tersambung ✓");
    } catch (e) { log("✗ " + explain(e)); }
  });
  $("#btnGhForget").addEventListener("click", () => {
    const s = LS.get("gh", {}); delete s.token; LS.set("gh", s);
    $("#ghToken").value = ""; refreshGhBadge(); toast("Token dihapus dari HP ini");
  });

  $("#btnUpload").addEventListener("click", async () => {
    const g = ghCfg();
    if (!g.token || !g.owner || !g.repo) { toast("Sambungkan GitHub dulu (langkah 1)"); return; }
    const periode = $("#admPeriode").value.trim() || state.brosur.periode;
    if (!picks[0] && !picks[1] && periode === state.brosur.periode) { toast("Pilih foto brosur baru dulu"); return; }
    const btn = $("#btnUpload"); btn.disabled = true;
    log("Mulai upload…", true);
    try {
      const files = state.brosur.files.length >= 2 ? state.brosur.files.slice(0, 2) : DEFAULT_FILES.slice();
      const newBlobs = [];
      for (let i = 0; i < 2; i++) {
        if (!picks[i]) continue;
        log(`Menyiapkan brosur ${i + 1}…`);
        const blob = await prepImage(picks[i]);
        log(`Upload brosur ${i + 1} (${kb(blob.size)})…`);
        await putFile(files[i], await blobToB64(blob), `Brosur ${i + 1} - ${periode}`);
        newBlobs[i] = blob;
      }
      const info = { periode, updated: new Date().toISOString(), files };
      log("Menyimpan periode…");
      await putFile("brosur.json", strToB64(JSON.stringify(info, null, 2) + "\n"), `Periode brosur: ${periode}`);
      newBlobs.forEach((b, i) => { if (b) state.overrides[i] = URL.createObjectURL(b); });
      state.brosur = info; LS.set("brosurInfo", info); renderBrosur();
      picks[0] = picks[1] = null;
      $$(".slot").forEach(s => { s.classList.remove("new"); $("small", s).textContent = "ketuk untuk ganti"; });
      log("✓ Berhasil! Web online akan menampilkan brosur baru dalam ±1–2 menit.");
      toast("Brosur terbit ✓");
    } catch (e) { log("✗ Gagal: " + explain(e)); }
    finally { btn.disabled = false; }
  });

  $("#btnMotor").addEventListener("click", async () => {
    const lines = $("#admMotor").value.split("\n").map(l => l.trim()).filter(Boolean);
    const list = [], bad = [];
    lines.forEach(l => {
      const m = l.split("|");
      const tipe = (m[0] || "").trim(), otr = Number(digits(m[1] || ""));
      if (tipe && otr) list.push({ tipe, otr }); else bad.push(l);
    });
    if (bad.length) { log("✗ Baris tidak valid (pakai format  Nama tipe | 25.537.000):\n" + bad.join("\n"), true); return; }
    const g = ghCfg();
    state.motor = list; LS.set("motorList", list);
    $("#dlTipe").innerHTML = list.map(m => `<option value="${esc(m.tipe)}">OTR ${fmt(m.otr)}</option>`).join("");
    if (!g.token) { toast("Tersimpan di HP ini saja (GitHub belum tersambung)"); return; }
    const btn = $("#btnMotor"); btn.disabled = true;
    log(`Menyimpan ${list.length} tipe ke GitHub…`, true);
    try {
      await putFile("motor.json", strToB64(JSON.stringify(list, null, 2) + "\n"), "Update daftar tipe & OTR");
      log("✓ Daftar tipe tersimpan."); toast("Daftar tipe tersimpan ✓");
    } catch (e) { log("✗ Gagal: " + explain(e)); }
    finally { btn.disabled = false; }
  });

  /* ---------------- Start ---------------- */
  const draft = LS.get("draft", null);
  if (draft && draft.data) { state.editingId = draft.editingId || null; writeForm(draft.data); }
  else newForm();

  // Jika bulan berganti & form masih kosong, nomor reg ikut bulan baru
  (function refreshRegIfEmpty() {
    const d = readForm();
    if (!state.editingId && !d.pemohon && !d.reg.endsWith("/" + regSuffix())) { F.elements.reg.value = nextReg(); render(); saveDraft(); }
  })();

  showTab(LS.get("tab", "harga"));
  loadBrosur();
  loadMotor();
})();
