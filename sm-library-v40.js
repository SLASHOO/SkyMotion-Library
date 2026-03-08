/* =========================================================
  SKYMOTION — LIBRARY v1 (STANDALONE) CLEAN JS
  - Plans + Moves mixed by default
  - OLD #modal = fullscreen video player
  - PLAN VIEWER moved to separate embed
  - Scoped. Webflow-safe.
========================================================= */

(() => {
  "use strict";
  if (window.__SM_LIBRARY_V1_CLEAN_V4__) return;
  window.__SM_LIBRARY_V1_CLEAN_V4__ = true;

  const FALLBACK_THUMB = "https://skymotion-cdn.b-cdn.net/thumb.jpg";
  const CDN_INDEX_URL = "https://skymotion-cdn.b-cdn.net/videos_index.json?v=" + Date.now();
  const API_BASE = String(window.SM_API_BASE || "https://skymotion.onrender.com").replace(/\/$/, "");

  const $ = (id) => document.getElementById(id);
  const scope = $("sm-library-scope");
  if (!scope) return;

  // ---------------- DOM ----------------
  const openAssistantBtn = $("openAssistantBtn");
  const closeAssistantBtn = $("closeAssistantBtn");
  const assistantBackdropEl = $("assistantBackdrop");
  const assistant = scope.querySelector(".assistant");

  const chat = $("chat");
  const grid = $("resultsGrid");
  const matchCount = $("matchCount");
  const resetBtn = $("resetBtn");
  const backBtn = $("backBtn");
  const moreBtn = $("moreBtn");
  const resultsHead = $("resultsHead");

  // old fullscreen modal
  const modal = $("modal");
  const modalBackdrop = $("modalBackdrop");
  const modalContent = $("modalContent");

  if (
    !assistant || !chat || !grid || !matchCount || !resetBtn ||
    !modal || !modalBackdrop || !modalContent
  ) {
    console.warn("[SM] Missing required elements.");
    return;
  }

  // ---------------- Helpers ----------------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function safeText(el, t) {
    if (el) el.textContent = String(t ?? "");
  }

  function normalizeUrl(u) {
    const s = String(u ?? "").trim();
    return s ? s : "";
  }

  function pickThumb(...candidates) {
    for (const c of candidates) {
      const u = normalizeUrl(c);
      if (u) return u;
    }
    return FALLBACK_THUMB;
  }

  function formatSeconds(sec) {
    const n = Number(sec || 0);
    if (!Number.isFinite(n) || n <= 0) return "";
    const m = Math.floor(n / 60);
    const s = Math.floor(n % 60);
    return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `0:${String(s).padStart(2, "0")}`;
  }

  function isPlan(x) {
    return String(x?.kind || "").toLowerCase() === "plan";
  }

  function attachImgFallback(root) {
    if (!root) return;
    root.querySelectorAll("img").forEach((img) => {
      const hasSrc = normalizeUrl(img.getAttribute("src"));
      if (!hasSrc) img.src = FALLBACK_THUMB;

      img.addEventListener("error", () => {
        if (img.dataset.smFallbackApplied === "1") return;
        img.dataset.smFallbackApplied = "1";
        img.src = FALLBACK_THUMB;
      }, { once: true });
    });
  }

  function getVideoId(v) {
    return v?.id || v?.slug || v?.videoUrl || v?.video_url || ((v?.title || "") + "|" + (v?.duration || ""));
  }

  // ---------------- Memberstack ----------------
  let _memberCache = null;
  let _memberCacheAt = 0;

  async function getMember(timeout = 12000) {
    const now = Date.now();
    if (_memberCache && now - _memberCacheAt < 15000) return _memberCache;

    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const ms = window.$memberstackDom || window.$memberstack;
      const fn = ms?.getCurrentMember || ms?.getCurrentUser;
      if (typeof fn === "function") {
        try {
          const res = await fn.call(ms);
          const m = res?.data || res;
          if (m?.id) {
            _memberCache = m;
            _memberCacheAt = Date.now();
            return m;
          }
        } catch (_) {}
      }
      await sleep(250);
    }
    return null;
  }

  async function api(path, opts = {}) {
    const member = await getMember(12000);
    if (!member?.id) {
      const err = new Error("LOGIN_REQUIRED");
      err.status = 401;
      throw err;
    }

    const headers = new Headers(opts.headers || {});
    headers.set("x-ms-id", member.id);

    if (opts.body && !(opts.body instanceof FormData) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const r = await fetch(API_BASE + path, { method: opts.method || "GET", ...opts, headers });
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    const isJson = ct.includes("application/json");
    const payload = isJson ? await r.json().catch(() => null) : await r.text().catch(() => null);

    if (!r.ok) {
      const e = new Error("HTTP_" + r.status);
      e.status = r.status;
      e.payload = payload;
      throw e;
    }
    return payload;
  }

  // ---------------- Saved moves ----------------
  let savedCache = [];

  async function hydrateSavedCache() {
    try {
      const data = await api(`/v1/saved-moves?limit=200&offset=0`, { method: "GET" });
      const list = Array.isArray(data)
        ? data
        : Array.isArray(data?.items) ? data.items
        : Array.isArray(data?.saved_moves) ? data.saved_moves
        : Array.isArray(data?.moves) ? data.moves
        : [];

      savedCache = (list || [])
        .map((x) => ({
          ...x,
          id: x?.id || x?.video_id || x?.slug || x?.videoUrl || x?.video_url || "",
          videoUrl: x?.videoUrl || x?.video_url || "",
        }))
        .filter((x) => x.id);
    } catch (e) {
      console.warn("[SM] saved-moves GET failed", e?.status, e?.payload || e);
      savedCache = [];
    }
  }

  function isSaved(id) {
    return Array.isArray(savedCache) && savedCache.some((x) => String(x?.id) === String(id));
  }

  async function toggleSaved(video) {
    const id = getVideoId(video);

    if (isSaved(id)) {
      try {
        await api(`/v1/saved-moves/${encodeURIComponent(id)}`, { method: "DELETE" });
      } catch (e) {
        console.warn("[SM] unsave failed", e?.status, e?.payload || e);
      }
      await hydrateSavedCache();
      return false;
    }

    const payload = {
      id,
      title: video?.title || "",
      thumb: video?.thumb || FALLBACK_THUMB,
      video_url: video?.videoUrl || video?.video_url || "",
      duration: video?.duration || "",
      env: video?.env || [],
      risk: video?.risk || [],
      subject: video?.subject || [],
      pilot: video?.pilot || [],
      mood: video?.mood || [],
    };

    try {
      await api(`/v1/saved-moves`, { method: "POST", body: JSON.stringify(payload) });
    } catch (e) {
      console.warn("[SM] save failed", e?.status, e?.payload || e);
    }

    await hydrateSavedCache();
    return true;
  }

  // ---------------- Locks ----------------
  const locks = { drawer: false, modal: false };

  function applyOverflow() {
    const videoOpen = modal.getAttribute("aria-hidden") === "false";
    const lock = locks.drawer || videoOpen || locks.modal;
    document.documentElement.style.overflow = lock ? "hidden" : "";
    document.body.style.overflow = lock ? "hidden" : "";
  }

  // ---------------- Drawer ----------------
  function isDrawerMode() {
    return window.matchMedia("(max-width: 900px)").matches;
  }

  function openAssistant() {
    assistant.classList.add("active");
    if (assistantBackdropEl) assistantBackdropEl.style.display = "block";
    locks.drawer = true;
    applyOverflow();
  }

  function closeAssistant() {
    assistant.classList.remove("active");
    if (assistantBackdropEl) assistantBackdropEl.style.display = "none";
    locks.drawer = false;
    applyOverflow();
  }

  if (openAssistantBtn) openAssistantBtn.addEventListener("click", openAssistant);
  if (closeAssistantBtn) closeAssistantBtn.addEventListener("click", closeAssistant);
  if (assistantBackdropEl) assistantBackdropEl.addEventListener("click", closeAssistant);

  window.addEventListener("resize", () => {
    if (!isDrawerMode()) {
      locks.drawer = false;
      if (assistantBackdropEl) assistantBackdropEl.style.display = "none";
      assistant.classList.remove("active");
      applyOverflow();
    }
  });

  // ---------------- Old modal helpers ----------------
  function setModal(open) {
    modal.setAttribute("aria-hidden", open ? "false" : "true");
    locks.modal = !!open;
    applyOverflow();
  }

  function closeModal() {
    try { modal._cleanup && modal._cleanup(); } catch (_) {}
    modal._cleanup = null;
    setModal(false);
    modalContent.innerHTML = "";
  }

  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;

    if (modal.getAttribute("aria-hidden") === "false") {
      closeModal();
      return;
    }

    if (assistant.classList.contains("active")) {
      closeAssistant();
    }
  });

  // ---------------- Chat ----------------
  let isBusy = false;
  const history = [];

  function setBusy(v) {
    isBusy = v;
    resetBtn.disabled = v;
    if (backBtn) backBtn.disabled = v || history.length === 0;
    chat.querySelectorAll(".opt").forEach((b) => (b.disabled = v));
  }

  function scrollChatBottom() {
    chat.scrollTop = chat.scrollHeight;
  }

  function addBotRow() {
    const row = document.createElement("div");
    row.className = "msg msg--bot";
    row.innerHTML = `<div class="avatar"></div><div class="bubble"><span class="text"></span><span class="caret"></span></div>`;
    chat.appendChild(row);
    scrollChatBottom();
    return row;
  }

  async function addBotTyped(text) {
    setBusy(true);

    const safe = escapeHtml(text);
    const row = addBotRow();
    const textEl = row.querySelector(".text");
    const caretEl = row.querySelector(".caret");

    for (let i = 0; i < safe.length; i++) {
      textEl.innerHTML += safe[i];
      scrollChatBottom();
      await sleep(10 + Math.random() * 14);
    }

    await sleep(120);
    if (caretEl) caretEl.remove();
    setBusy(false);
  }

  function clearOptions() {
    chat.querySelectorAll(".options").forEach((el) => el.remove());
  }

  const steps = [
    { key: "env", text: "Where are you flying?", options: ["Open area", "City / Urban", "Forest", "Near objects", "Tight space"] },
    { key: "risk", text: "How safe does it feel here?", options: ["Safe & calm", "Some risks", "No aggressive moves"] },
    { key: "subject", text: "What are you filming?", options: ["Person", "Car / Bike", "Building", "Landscape", "Atmosphere"] },
    { key: "pilot", text: "How confident are you right now?", options: ["Playing safe", "Normal", "Ready to experiment"] },
    { key: "mood", text: "What vibe do you want?", options: ["Smooth", "Epic", "Dynamic", "Tense", "Wow"] },
  ];

  const state = {};
  let stepIndex = 0;

  let allItems = [];
  let filtered = [];
  let visibleCount = 12;
  let currentIndex = -1;

  function applyFilters() {
    filtered = allItems.slice();
    safeText(matchCount, String(filtered.length));
    visibleCount = 12;
    renderResults();
  }

  function renderOptions() {
    clearOptions();
    if (stepIndex >= steps.length) return;

    const s = steps[stepIndex];
    const wrap = document.createElement("div");
    wrap.className = "options";

    s.options.forEach((label) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "opt";
      btn.textContent = label;

      btn.addEventListener("click", async () => {
        if (isBusy) return;

        history.push({ stepIndex, key: s.key, prevChatHTML: chat.innerHTML });
        if (backBtn) backBtn.disabled = history.length === 0;

        state[s.key] = label;
        stepIndex++;
        applyFilters();

        if (stepIndex >= steps.length) {
          clearOptions();
          await addBotTyped("Done. Browse moves and cinematic plans in the results.");
          return;
        }

        await addBotTyped(steps[stepIndex].text);
        renderOptions();
      });

      wrap.appendChild(btn);
    });

    chat.appendChild(wrap);
    scrollChatBottom();
  }

  if (backBtn) {
    backBtn.addEventListener("click", () => {
      if (isBusy) return;

      const last = history.pop();
      backBtn.disabled = history.length === 0;
      if (!last) return;

      stepIndex = last.stepIndex;
      delete state[last.key];
      chat.innerHTML = last.prevChatHTML;

      applyFilters();
      renderOptions();
      scrollChatBottom();
    });
  }

  resetBtn.addEventListener("click", async () => {
    if (isBusy) return;

    history.length = 0;
    stepIndex = 0;
    Object.keys(state).forEach((k) => delete state[k]);
    chat.innerHTML = "";
    clearOptions();
    if (backBtn) backBtn.disabled = true;

    await addBotTyped("Hi. Let’s browse moves and cinematic plans.");
    await addBotTyped(steps[0].text);

    if (allItems.length) applyFilters();
    renderOptions();
  });

  // ---------------- Cards ----------------
  function bookmarkSvg() {
    return `<svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.5 3.5h11c.83 0 1.5.67 1.5 1.5v16.1c0 .78-.86 1.26-1.53.86L12 19.35 6.53 21.96C5.86 22.26 5 21.78 5 21.1V5c0-.83.67-1.5 1.5-1.5z"></path>
    </svg>`;
  }

  function renderMoveCard(v, i) {
    const id = getVideoId(v);
    const saved = isSaved(id);
    const thumb = pickThumb(v?.thumb);
    const title = escapeHtml(v?.title || "");

    const card = document.createElement("div");
    card.className = "card";
    card.dataset.index = String(i);
    card.dataset.kind = "move";
    card.dataset.itemId = String(id);

    card.innerHTML = `
      <button class="sm-save ${saved ? "isSaved" : ""}" type="button" aria-label="${saved ? "Unsave" : "Save"}" data-save-id="${escapeHtml(id)}">
        ${bookmarkSvg()}
      </button>

      <div class="thumb">
        <img src="${thumb}" alt="${title || "thumb"}" loading="lazy">
      </div>

      <div class="meta">
        <div class="title">${title}</div>
        <span class="badge">${escapeHtml(v?.duration || formatSeconds(v?.duration_s) || "")}</span>
      </div>
    `;

    attachImgFallback(card);
    return card;
  }

  function renderPlanCard(p, i) {
    const stepsArr = Array.isArray(p?.steps) ? p.steps : [];
    const titleRaw = p?.title || "Cinematic plan";
    const cover = pickThumb(
      p?.thumb?.a,
      p?.thumb_a,
      stepsArr?.[0]?.thumb,
      stepsArr?.[0]?.poster,
      p?.thumb,
      FALLBACK_THUMB
    );

    const shotsCount =
      Number(p?.shots_count) ||
      stepsArr.length ||
      0;

    const total = p?.total_duration || formatSeconds(p?.final?.duration_s);
    const desc = p?.description || "";

    const card = document.createElement("div");
    card.className = "cardPlan";
    card.dataset.index = String(i);
    card.dataset.kind = "plan";
    card.dataset.itemId = String(p?.id || "");

    card.innerHTML = `
      <div class="planMedia">
        <img class="planImg" src="${cover}" alt="${escapeHtml(titleRaw)}" loading="lazy">
        <div class="planPills">
          <span class="pill pill--plan"><span class="pillDot"></span>Plan</span>
          ${total ? `<span class="pill">${escapeHtml(total)}</span>` : ``}
          ${shotsCount ? `<span class="pill">${escapeHtml(shotsCount)} shots</span>` : ``}
        </div>
      </div>

      <div class="planCaption">Cinematic Plan</div>

      <div class="planBubble">
        <h3 class="planName">${escapeHtml(titleRaw)}</h3>
        ${desc ? `<div class="planDesc">${escapeHtml(desc)}</div>` : ``}
      </div>
    `;

    attachImgFallback(card);
    return card;
  }

  function renderResults() {
    grid.innerHTML = "";
    const slice = filtered.slice(0, visibleCount);

    if (!slice.length) {
      grid.innerHTML = `<div class="card" style="padding:14px">No results.</div>`;
      if (moreBtn) moreBtn.style.display = "none";
      safeText(matchCount, "0");
      if (resultsHead) resultsHead.style.display = "none";
      return;
    }

    const hasAnyPlan = slice.some(isPlan);
    if (resultsHead) resultsHead.style.display = hasAnyPlan ? "flex" : "none";

    slice.forEach((item, i) => {
      const card = isPlan(item) ? renderPlanCard(item, i) : renderMoveCard(item, i);
      grid.appendChild(card);
    });

    if (moreBtn) moreBtn.style.display = filtered.length > visibleCount ? "block" : "none";
    safeText(matchCount, String(filtered.length));
  }

  if (moreBtn) {
    moreBtn.addEventListener("click", () => {
      visibleCount += 12;
      renderResults();
    });
  }

  function syncCardSaveUI(video) {
    const id = getVideoId(video);
    const saved = isSaved(id);
    const sel = `.sm-save[data-save-id="${CSS.escape(String(id))}"]`;
    const btn = grid.querySelector(sel);
    if (btn) {
      btn.classList.toggle("isSaved", saved);
      btn.setAttribute("aria-label", saved ? "Unsave" : "Save");
    }
  }

  // ---------------- Fullscreen player ----------------
  function buildVideoPlayer(video) {
    const saved = isSaved(getVideoId(video));
    const src = normalizeUrl(video?.videoUrl || video?.video_url);

    modalContent.innerHTML = `
      <div class="player">
        <video id="playerVideo" controls playsinline preload="metadata">
          <source src="${escapeHtml(src)}" type="video/mp4">
        </video>

        <div class="player__top">
          <div class="player__title">${escapeHtml(video?.title || "")}</div>
          <button class="player__close" id="playerClose" type="button" aria-label="Close">×</button>
        </div>

        <div class="player__bar">
          <button class="btn" id="prevVideoBtn" type="button">Prev</button>
          <button class="btn" id="skipBackBtn" type="button">-10s</button>
          <button class="btn" id="skipFwdBtn" type="button">+10s</button>
          <button class="btn" id="nextVideoBtn" type="button">Next</button>
          <button class="btn" id="saveMoveBtn" type="button">${saved ? "Saved" : "Save"}</button>
          <button class="btn" id="fsBtn" type="button">Fullscreen</button>
        </div>
      </div>
    `;
  }

  async function openPlayer(index) {
    if (!filtered.length) return;

    const item = filtered[index];
    if (!item || isPlan(item)) return;

    try { modal._cleanup && modal._cleanup(); } catch (_) {}
    modal._cleanup = null;

    currentIndex = index;
    const video = filtered[currentIndex];
    const src = normalizeUrl(video?.videoUrl || video?.video_url);
    if (!src) return;

    buildVideoPlayer(video);
    setModal(true);

    const player = $("playerVideo");
    const closeBtn = $("playerClose");
    const prevBtn = $("prevVideoBtn");
    const nextBtn = $("nextVideoBtn");
    const back10 = $("skipBackBtn");
    const fwd10 = $("skipFwdBtn");
    const fsBtn = $("fsBtn");
    const saveMoveBtn = $("saveMoveBtn");

    const goPrev = () => {
      for (let i = currentIndex - 1; i >= 0; i--) {
        if (!isPlan(filtered[i])) return openPlayer(i);
      }
    };

    const goNext = () => {
      for (let i = currentIndex + 1; i < filtered.length; i++) {
        if (!isPlan(filtered[i])) return openPlayer(i);
      }
    };

    const onBackdrop = () => closeModal();

    closeBtn && closeBtn.addEventListener("click", closeModal);
    prevBtn && prevBtn.addEventListener("click", goPrev);
    nextBtn && nextBtn.addEventListener("click", goNext);

    back10 && back10.addEventListener("click", () => {
      if (!player) return;
      player.currentTime = Math.max(0, (player.currentTime || 0) - 10);
    });

    fwd10 && fwd10.addEventListener("click", () => {
      if (!player) return;
      player.currentTime = Math.min(player.duration || 999999, (player.currentTime || 0) + 10);
    });

    if (saveMoveBtn) {
      saveMoveBtn.addEventListener("click", async () => {
        const nowSaved = await toggleSaved(video);
        saveMoveBtn.textContent = nowSaved ? "Saved" : "Save";
        syncCardSaveUI(video);
      });
    }

    fsBtn && fsBtn.addEventListener("click", async () => {
      try {
        if (!document.fullscreenElement) await modal.requestFullscreen();
        else await document.exitFullscreen();
      } catch (_) {}
    });

    modalBackdrop.addEventListener("click", onBackdrop);
    player && player.play().catch(() => {});

    modal._cleanup = () => {
      modalBackdrop.removeEventListener("click", onBackdrop);
      try { player && player.pause(); } catch (_) {}
    };
  }

  // ---------------- Grid click ----------------
  grid.addEventListener("click", async (e) => {
    const card = e.target.closest(".card, .cardPlan");
    if (!card) return;

    const idx = Number(card.dataset.index || "-1");
    if (!Number.isFinite(idx) || idx < 0) return;

    const item = filtered[idx];
    if (!item) return;

    const saveBtn = e.target.closest(".sm-save");
    if (saveBtn) {
      e.preventDefault();
      e.stopPropagation();
      if (isPlan(item)) return;

      const nowSaved = await toggleSaved(item);
      saveBtn.classList.toggle("isSaved", nowSaved);
      saveBtn.setAttribute("aria-label", nowSaved ? "Unsave" : "Save");
      return;
    }

    if (isPlan(item)) {
      window.dispatchEvent(new CustomEvent("sm:open-plan", { detail: item }));
      return;
    }

    openPlayer(idx);
  });

  // ---------------- Load items ----------------
  async function loadItems() {
    try {
      safeText(matchCount, "Loading…");
      const res = await fetch(CDN_INDEX_URL, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);

      const json = await res.json();
      const items = Array.isArray(json) ? json : [];

      const plans = items.filter(isPlan);
      const moves = items.filter((x) => !isPlan(x));

      allItems = [...plans, ...moves];
      applyFilters();
      renderResults();
    } catch (e) {
      console.error("[SM] loadVideos error:", e);
      safeText(matchCount, "—");
      grid.innerHTML = `<div class="card" style="padding:14px">Failed to load videos.</div>`;
      if (moreBtn) moreBtn.style.display = "none";
      if (resultsHead) resultsHead.style.display = "none";
    }
  }

  // ---------------- Init ----------------
  (async () => {
    if (backBtn) backBtn.disabled = true;

    await getMember(12000).catch(() => null);
    await hydrateSavedCache();

    await addBotTyped("Hi. Let’s browse moves and cinematic plans.");
    await addBotTyped(steps[0].text);
    renderOptions();

    await loadItems();
  })();
})();
