/* =========================================================
  SKYMOTION — LIBRARY v1 (STANDALONE) + PLANS (v1)
  - Plans + Moves mixed by default (no plan filtering yet)
  - Uses existing #modal overlay for BOTH video + plan
========================================================= */

(() => {
  "use strict";
  if (window.__SM_LIBRARY_V1_STANDALONE_PLANS_V1__) return;
  window.__SM_LIBRARY_V1_STANDALONE_PLANS_V1__ = true;

  const CDN_INDEX_URL =
  "https://skymotion-cdn.b-cdn.net/videos_index.json?v=" + Date.now();
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

  const modal = $("modal");
  const modalBackdrop = $("modalBackdrop");
  const modalContent = $("modalContent");

  if (!assistant || !chat || !grid || !matchCount || !resetBtn || !modal || !modalBackdrop || !modalContent) {
    console.warn("[SM] Missing required elements. Stop.");
    return;
  }

  // ---------------- Helpers ----------------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
  function safeText(el, t) { if (el) el.textContent = String(t ?? ""); }
  function isPlan(x){ return String(x?.kind || "").toLowerCase() === "plan"; }

  // ---------------- Memberstack (cached) ----------------
  let _memberCache = null;
  let _memberCacheAt = 0;

  async function getMember(timeout = 12000) {
    const now = Date.now();
    if (_memberCache && (now - _memberCacheAt) < 15000) return _memberCache;

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
        } catch (e) {}
      }
      await sleep(250);
    }
    return null;
  }

  // ---------------- API helper ----------------
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

  // ---------------- Saved moves (API only) ----------------
  let savedCache = [];
  function getVideoId(v) {
    return v?.id || v?.slug || v?.videoUrl || v?.video_url || ((v?.title || "") + "|" + (v?.duration || ""));
  }

  async function hydrateSavedCache() {
    try {
      const data = await api(`/v1/saved-moves?limit=200&offset=0`, { method: "GET" });
      const list =
        Array.isArray(data) ? data :
        Array.isArray(data?.items) ? data.items :
        Array.isArray(data?.saved_moves) ? data.saved_moves :
        Array.isArray(data?.moves) ? data.moves : [];
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
      thumb: video?.thumb || "",
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

  // ---------------- UI locks ----------------
  const locks = { drawer: false, modal: false };
  function applyOverflow() {
    const lock = locks.drawer || locks.modal;
    document.documentElement.style.overflow = lock ? "hidden" : "";
    document.body.style.overflow = lock ? "hidden" : "";
  }

  // ---------------- Drawer open/close ----------------
  function isDrawerMode() { return window.matchMedia("(max-width: 900px)").matches; }
  function openAssistant() {
    assistant.classList.add("active");
    if (assistantBackdropEl) assistantBackdropEl.style.display = "block";
    scope.classList.add("smFiltersOpen");
    locks.drawer = true;
    applyOverflow();
  }
  function closeAssistant() {
    assistant.classList.remove("active");
    if (assistantBackdropEl) assistantBackdropEl.style.display = "none";
    scope.classList.remove("smFiltersOpen");
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
      scope.classList.remove("smFiltersOpen");
      assistant.classList.remove("active");
      applyOverflow();
    }
  });

  // ---------------- Modal helpers ----------------
  function setModal(open) {
    modal.setAttribute("aria-hidden", open ? "false" : "true");
    locks.modal = !!open;
    applyOverflow();
  }

  function closeModal() {
    try { modal._cleanup && modal._cleanup(); } catch (e) {}
    setModal(false);
    modalContent.innerHTML = "";
    modal.classList.remove("isPlan");
  }

  // ESC priority
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (modal && modal.getAttribute("aria-hidden") === "false") { closeModal(); return; }
    if (assistant && assistant.classList.contains("active")) { closeAssistant(); return; }
  });

  // ---------------- Chat / filters (keep UI, no real filtering yet) ----------------
  let isBusy = false;
  const history = [];

  function setBusy(v) {
    isBusy = v;
    if (resetBtn) resetBtn.disabled = v;
    if (backBtn) backBtn.disabled = v || history.length === 0;
    chat.querySelectorAll(".opt").forEach((b) => (b.disabled = v));
  }
  function scrollChatBottom() { chat.scrollTop = chat.scrollHeight; }

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
      await sleep(10 + Math.random() * 16);
    }
    await sleep(120);
    if (caretEl) caretEl.remove();
    setBusy(false);
  }

  function clearOptions() { chat.querySelectorAll(".options").forEach((el) => el.remove()); }

  // (UI only)
  const steps = [
    { key:"env",     text:"Where are you flying?",            options:["Open area","City / Urban","Forest","Near objects","Tight space"] },
    { key:"risk",    text:"How safe does it feel here?",      options:["Safe & calm","Some risks","No aggressive moves"] },
    { key:"subject", text:"What are you filming?",            options:["Person","Car / Bike","Building","Landscape","Atmosphere"] },
    { key:"pilot",   text:"How confident are you right now?", options:["Playing safe","Normal","Ready to experiment"] },
    { key:"mood",    text:"What vibe do you want?",           options:["Smooth","Epic","Dynamic","Tense","Wow"] },
  ];

  const state = {};
  let stepIndex = 0;

  function applyFilters() {
    // NOW: no real filtering, just show everything
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
          await addBotTyped("Done. Browse moves and plans in the results.");
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

  if (backBtn) backBtn.addEventListener("click", () => {
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

  // ---------------- Results: render mixed plans + moves ----------------
  let allItems = [];
  let filtered = [];
  let visibleCount = 12;

  function bookmarkSvg() {
    return `<svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.5 3.5h11c.83 0 1.5.67 1.5 1.5v16.1c0 .78-.86 1.26-1.53.86L12 19.35 6.53 21.96C5.86 22.26 5 21.78 5 21.1V5c0-.83.67-1.5 1.5-1.5z"></path>
    </svg>`;
  }

  function renderMoveCard(v, i) {
    const id = getVideoId(v);
    const saved = isSaved(id);

    const card = document.createElement("div");
    card.className = "card";
    card.dataset.index = String(i);
    card.dataset.kind = "move";
    card.dataset.itemId = String(id);

    card.innerHTML = `
      <button class="sm-save ${saved ? "isSaved" : ""}" type="button"
        aria-label="${saved ? "Unsave" : "Save"}" data-save-id="${escapeHtml(id)}">
        ${bookmarkSvg()}
      </button>
      <div class="thumb"><img src="${v.thumb || ""}" alt="${escapeHtml(v.title || "thumb")}" loading="lazy"></div>
      <div class="meta">
        <div class="title">${escapeHtml(v.title || "")}</div>
        <span class="badge">${escapeHtml(v.duration || "")}</span>
      </div>
    `;
    return card;
  }

  function renderPlanCard(p, i) {
    const card = document.createElement("div");
    card.className = "cardPlan";
    card.dataset.index = String(i);
    card.dataset.kind = "plan";
    card.dataset.itemId = String(p?.id || "");

    const steps = Array.isArray(p?.steps) ? p.steps : [];
    const shots = steps.length ? `${steps.length} shots` : "Plan";
    const total = p?.total_duration || "";
    const desc = p?.description || "";
    const placeholder = "https://skymotion-cdn.b-cdn.net/thumb.jpg";

    const a = p?.thumb_a || steps?.[0]?.thumb || placeholder;
    const b = p?.thumb_b || steps?.[1]?.thumb || placeholder;
    const title = p?.title || "Cinematic plan";

    card.innerHTML = `
      <div class="planThumbs">
        <div class="planShot planShot--a">
          <img src="${a}" alt="${escapeHtml(title)} shot A" loading="lazy">
          <span class="shotTag">Shot 1</span>
        </div>
        <div class="planShot planShot--b">
          <img src="${b}" alt="${escapeHtml(title)} shot B" loading="lazy">
          <span class="shotTag">Shot 2</span>
        </div>
      </div>

      <div class="planTop">
        <div class="planPills">
          <span class="pill pill--plan"><span class="pillDot"></span>Plan</span>
          ${total ? `<span class="pill">${escapeHtml(total)}</span>` : ``}
          <span class="pill">${escapeHtml(shots)}</span>
        </div>
      </div>

      <div class="planMeta">
        <h3 class="planName">${escapeHtml(title)}</h3>
        <div class="planStats">
          ${desc ? `<span>${escapeHtml(desc)}</span>` : ``}
    `;
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

    // show head only if at least one plan is present (optional)
    const hasAnyPlan = slice.some(isPlan);
    if (resultsHead) resultsHead.style.display = hasAnyPlan ? "flex" : "none";

    slice.forEach((item, i) => {
      const card = isPlan(item) ? renderPlanCard(item, i) : renderMoveCard(item, i);
      grid.appendChild(card);
    });

    if (moreBtn) moreBtn.style.display = filtered.length > visibleCount ? "block" : "none";
    safeText(matchCount, String(filtered.length));
  }

  if (moreBtn) moreBtn.addEventListener("click", () => {
    visibleCount += 12;
    renderResults();
  });

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

  // ---------------- Video Player modal ----------------
  let currentIndex = -1;

  function buildVideoPlayer(video) {
    const id = getVideoId(video);
    const saved = isSaved(id);

    modalContent.innerHTML = `
      <div class="player">
        <video id="playerVideo" controls playsinline preload="metadata">
          <source src="${video.videoUrl}" type="video/mp4">
        </video>

        <div class="player__top">
          <div class="player__title">${escapeHtml(video.title || "")}</div>
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

    // Skip if user clicked a plan item
    const item = filtered[index];
    if (!item || isPlan(item)) return;

    if (modal._cleanup) modal._cleanup();
    currentIndex = index;

    const video = filtered[currentIndex];
    if (!video || !video.videoUrl) return;

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
      // find previous MOVE
      for (let i = currentIndex - 1; i >= 0; i--) {
        if (!isPlan(filtered[i])) return openPlayer(i);
      }
    };
    const goNext = () => {
      for (let i = currentIndex + 1; i < filtered.length; i++) {
        if (!isPlan(filtered[i])) return openPlayer(i);
      }
    };
    const onEsc = (e) => { if (e.key === "Escape") closeModal(); };

    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    if (prevBtn) prevBtn.addEventListener("click", goPrev);
    if (nextBtn) nextBtn.addEventListener("click", goNext);

    if (back10) back10.addEventListener("click", () => {
      player.currentTime = Math.max(0, (player.currentTime || 0) - 10);
    });
    if (fwd10) fwd10.addEventListener("click", () => {
      player.currentTime = Math.min(player.duration || 999999, (player.currentTime || 0) + 10);
    });

    if (saveMoveBtn) {
      saveMoveBtn.addEventListener("click", async () => {
        const nowSaved = await toggleSaved(video);
        saveMoveBtn.textContent = nowSaved ? "Saved" : "Save";
        syncCardSaveUI(video);
      });
    }

    if (fsBtn) {
      fsBtn.addEventListener("click", async () => {
        try {
          if (!document.fullscreenElement) await modal.requestFullscreen();
          else await document.exitFullscreen();
        } catch (e) {}
      });
    }

    window.addEventListener("keydown", onEsc);
    modalBackdrop.addEventListener("click", closeModal, { once: true });

    player && player.play().catch(() => {});
    modal._cleanup = () => {
      window.removeEventListener("keydown", onEsc);
      try { player && player.pause(); } catch (e) {}
    };
  }

  // ---------------- Plan modal (uses same overlay) ----------------
  function buildPlanModal(plan) {
    const steps = Array.isArray(plan?.steps) ? plan.steps : [];
    const title = plan?.title || "Cinematic plan";
    const total = plan?.total_duration || "";
    const desc  = plan?.description || "";
    const tags  = [
      ...(plan?.env || []).map((x) => `env:${x}`),
      ...(plan?.subject || []).map((x) => `sub:${x}`),
      ...(plan?.mood || []).map((x) => `mood:${x}`),
      ...(plan?.pilot || []).map((x) => `pilot:${x}`),
      ...(plan?.risk || []).map((x) => `risk:${x}`),
    ].slice(0, 8);

    // Minimal plan UI inside existing modal (no extra CSS required, but looks decent)
    modalContent.innerHTML = `
      <div class="smPlan">
        <div class="smPlan__top">
          <div class="smPlan__titleWrap">
            <div class="smPlan__kicker">Cinematic plan</div>
            <div class="smPlan__title">${escapeHtml(title)}</div>
            <div class="smPlan__meta">
              ${total ? `<span class="smPlan__chip">${escapeHtml(total)}</span>` : ``}
              <span class="smPlan__chip">${steps.length} shots</span>
              ${desc ? `<span class="smPlan__desc">${escapeHtml(desc)}</span>` : ``}
            </div>
            ${tags.length ? `<div class="smPlan__tags">${tags.map(t=>`<span class="smPlan__tag">${escapeHtml(t)}</span>`).join("")}</div>` : ``}
          </div>

          <button class="smPlan__close" id="planClose" type="button" aria-label="Close">×</button>
        </div>

        <div class="smPlan__body">
          ${steps.length ? steps.map((s, idx) => `
            <div class="smPlan__step" data-step="${idx}">
              <div class="smPlan__thumb">
                <img src="${s?.thumb || plan?.thumb_a || ""}" alt="${escapeHtml(s?.title || ("Step " + (idx+1)))}" loading="lazy">
                <div class="smPlan__num">${idx + 1}</div>
              </div>
              <div class="smPlan__info">
                <div class="smPlan__stepTitle">${escapeHtml(s?.title || ("Shot " + (idx+1)))}</div>
                <div class="smPlan__stepRow">
                  ${s?.duration ? `<span class="smPlan__chip">${escapeHtml(s.duration)}</span>` : ``}
                  ${s?.note ? `<span class="smPlan__note">${escapeHtml(s.note)}</span>` : ``}
                </div>
              </div>
            </div>
          `).join("") : `
            <div style="padding:18px; color: rgba(255,255,255,.75); font-weight:800;">
              This plan has no steps yet.
            </div>
          `}
        </div>

        <div class="smPlan__footer">
          <button class="btn" id="planFsBtn" type="button">Fullscreen</button>
          <button class="btn" id="planCloseBtn" type="button">Close</button>
        </div>
      </div>
    `;

    // Inject minimal scoped styles for plan modal (kept inside modal to avoid touching your main CSS)
    const style = document.createElement("style");
    style.textContent = `
      #sm-library-scope #modal .smPlan{
        position:absolute; inset:0;
        display:flex;
        flex-direction:column;
        padding:18px;
        gap:14px;
        color: rgba(255,255,255,.92);
      }
      #sm-library-scope #modal .smPlan__top{
        display:flex; align-items:flex-start; justify-content:space-between;
        gap:12px;
      }
      #sm-library-scope #modal .smPlan__kicker{
        font-size:12px; font-weight:950;
        color: rgba(255,255,255,.60);
        letter-spacing:.2px;
        margin-bottom:6px;
      }
      #sm-library-scope #modal .smPlan__title{
        font-size:18px; font-weight:950;
        text-shadow:0 10px 30px rgba(0,0,0,.55);
        margin-bottom:8px;
      }
      #sm-library-scope #modal .smPlan__meta{
        display:flex; flex-wrap:wrap; gap:8px;
        align-items:center;
        margin-bottom:10px;
      }
      #sm-library-scope #modal .smPlan__chip{
        font-size:12px; font-weight:900;
        padding:6px 10px;
        border-radius:999px;
        background: rgba(0,0,0,.45);
        border:1px solid rgba(255,255,255,.16);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
      }
      #sm-library-scope #modal .smPlan__desc{
        font-size:12px; font-weight:850;
        color: rgba(255,255,255,.70);
      }
      #sm-library-scope #modal .smPlan__tags{
        display:flex; flex-wrap:wrap; gap:8px;
      }
      #sm-library-scope #modal .smPlan__tag{
        font-size:11px; font-weight:900;
        padding:5px 9px;
        border-radius:999px;
        background: rgba(120,59,226,.14);
        border:1px solid rgba(120,59,226,.30);
        color: rgba(255,255,255,.85);
      }
      #sm-library-scope #modal .smPlan__close{
        width:44px; height:44px;
        border-radius:14px;
        border:1px solid rgba(255,255,255,0.14);
        background: rgba(0,0,0,0.35);
        color:#fff;
        cursor:pointer;
        display:grid;
        place-items:center;
        font-size:20px;
        transition: transform .12s ease, border-color .12s ease, background .12s ease;
        flex:0 0 auto;
      }
      #sm-library-scope #modal .smPlan__close:hover{
        transform: translateY(-1px);
        border-color: rgba(120,59,226,.40);
        background: rgba(120,59,226,.12);
      }
      #sm-library-scope #modal .smPlan__body{
        flex:1;
        overflow:auto;
        padding-right:4px;
        display:flex;
        flex-direction:column;
        gap:12px;
      }
      #sm-library-scope #modal .smPlan__step{
        display:grid;
        grid-template-columns: 110px 1fr;
        gap:12px;
        padding:10px;
        border-radius:16px;
        border:1px solid rgba(255,255,255,.10);
        background: rgba(0,0,0,.25);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
      }
      #sm-library-scope #modal .smPlan__thumb{
        position:relative;
        border-radius:14px;
        overflow:hidden;
        background:#000;
        border:1px solid rgba(255,255,255,.10);
        height:78px;
      }
      #sm-library-scope #modal .smPlan__thumb img{
        width:100%; height:100%; object-fit:cover; display:block;
      }
      #sm-library-scope #modal .smPlan__num{
        position:absolute; left:8px; top:8px;
        width:26px; height:26px;
        border-radius:999px;
        display:grid; place-items:center;
        font-weight:950;
        font-size:12px;
        background: rgba(0,0,0,.55);
        border:1px solid rgba(255,255,255,.18);
      }
      #sm-library-scope #modal .smPlan__stepTitle{
        font-size:14px; font-weight:950;
        margin:2px 0 6px;
      }
      #sm-library-scope #modal .smPlan__stepRow{
        display:flex; flex-wrap:wrap; gap:8px;
        align-items:center;
      }
      #sm-library-scope #modal .smPlan__note{
        font-size:12px; font-weight:850;
        color: rgba(255,255,255,.72);
      }
      #sm-library-scope #modal .smPlan__footer{
        display:flex;
        gap:10px;
        justify-content:flex-end;
        flex-wrap:wrap;
      }
      @media (max-width: 900px){
        #sm-library-scope #modal .smPlan{ padding:14px; }
        #sm-library-scope #modal .smPlan__step{ grid-template-columns: 1fr; }
        #sm-library-scope #modal .smPlan__thumb{ height:140px; }
      }
    `;
    modalContent.appendChild(style);
  }

  function openPlan(plan) {
    if (!plan) return;

    if (modal._cleanup) modal._cleanup();
    modal.classList.add("isPlan");

    buildPlanModal(plan);
    setModal(true);

    const closeA = $("planClose");
    const closeB = $("planCloseBtn");
    const fsBtn  = $("planFsBtn");

    const onEsc = (e) => { if (e.key === "Escape") closeModal(); };

    if (closeA) closeA.addEventListener("click", closeModal);
    if (closeB) closeB.addEventListener("click", closeModal);

    if (fsBtn) {
      fsBtn.addEventListener("click", async () => {
        try {
          if (!document.fullscreenElement) await modal.requestFullscreen();
          else await document.exitFullscreen();
        } catch (e) {}
      });
    }

    window.addEventListener("keydown", onEsc);
    modalBackdrop.addEventListener("click", closeModal, { once: true });

    modal._cleanup = () => {
      window.removeEventListener("keydown", onEsc);
    };
  }

  // ---------------- Grid click handler ----------------
  grid.addEventListener("click", async (e) => {
    const card = e.target.closest(".card, .cardPlan");
    if (!card) return;

    const idx = Number(card.dataset.index || "-1");
    if (!Number.isFinite(idx) || idx < 0) return;

    const item = filtered[idx];
    if (!item) return;

    // Save click only for MOVE cards
    const saveBtn = e.target.closest(".sm-save");
    if (saveBtn) {
      e.preventDefault();
      e.stopPropagation();

      if (isPlan(item)) return; // no save for plans

      const nowSaved = await toggleSaved(item);
      saveBtn.classList.toggle("isSaved", nowSaved);
      saveBtn.setAttribute("aria-label", nowSaved ? "Unsave" : "Save");
      return;
    }

    // Open plan or video
    if (isPlan(item)) {
      openPlan(item);
      return;
    }
    openPlayer(idx);
  });

  // ---------------- Load JSON ----------------
  async function loadItems() {
    try {
      safeText(matchCount, "Loading…");
      const res = await fetch(CDN_INDEX_URL, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const json = await res.json();
      const items = Array.isArray(json) ? json : [];

      const plans = items.filter(isPlan);
      const moves = items.filter(x => !isPlan(x));

      allItems = [...plans, ...moves];

      // Default: mixed items
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

  // ---------------- INIT ----------------
  (async () => {
    if (backBtn) backBtn.disabled = true;

    // Member optional: to show saved states
    await getMember(12000).catch(() => null);
    await hydrateSavedCache();

    await addBotTyped("Hi. Let’s browse moves and cinematic plans.");
    await addBotTyped(steps[0].text);
    renderOptions();

    await loadItems();
  })();
})();
