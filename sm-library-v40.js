/* =========================================================
  SKYMOTION — LIBRARY v1 (OPTIMIZED)
  - Clean modal flow
  - Plans + Moves mixed by default
  - API saved-moves
  - Old plan open logic removed
========================================================= */

(() => {
  "use strict";
  if (window.__SM_LIBRARY_V1_OPTIMIZED__) return;
  window.__SM_LIBRARY_V1_OPTIMIZED__ = true;

  const FALLBACK_THUMB = "https://skymotion-cdn.b-cdn.net/thumb.jpg";
  const CDN_INDEX_URL = `https://skymotion-cdn.b-cdn.net/videos_index.json?v=${Date.now()}`;
  const API_BASE = String(window.SM_API_BASE || "https://skymotion.onrender.com").replace(/\/$/, "");

  const $ = (id) => document.getElementById(id);
  const scope = $("sm-library-scope");
  if (!scope) return;

  const els = {
    openAssistantBtn: $("openAssistantBtn"),
    closeAssistantBtn: $("closeAssistantBtn"),
    assistantBackdrop: $("assistantBackdrop"),
    assistant: scope.querySelector(".assistant"),
    chat: $("chat"),
    grid: $("resultsGrid"),
    matchCount: $("matchCount"),
    resetBtn: $("resetBtn"),
    backBtn: $("backBtn"),
    moreBtn: $("moreBtn"),
    resultsHead: $("resultsHead"),
    modal: $("modal"),
    modalBackdrop: $("modalBackdrop"),
    modalContent: $("modalContent"),
  };

  if (
    !els.assistant ||
    !els.chat ||
    !els.grid ||
    !els.matchCount ||
    !els.resetBtn ||
    !els.modal ||
    !els.modalBackdrop ||
    !els.modalContent
  ) {
    console.warn("[SM] Missing required elements. Stop.");
    return;
  }

  const state = {
    allItems: [],
    filtered: [],
    visibleCount: 12,
    currentIndex: -1,
    savedCache: [],
    history: [],
    stepIndex: 0,
    filters: {},
    isBusy: false,
    locks: {
      drawer: false,
      modal: false,
    },
    memberCache: null,
    memberCacheAt: 0,
  };

  const steps = [
    { key: "env", text: "Where are you flying?", options: ["Open area", "City / Urban", "Forest", "Near objects", "Tight space"] },
    { key: "risk", text: "How safe does it feel here?", options: ["Safe & calm", "Some risks", "No aggressive moves"] },
    { key: "subject", text: "What are you filming?", options: ["Person", "Car / Bike", "Building", "Landscape", "Atmosphere"] },
    { key: "pilot", text: "How confident are you right now?", options: ["Playing safe", "Normal", "Ready to experiment"] },
    { key: "mood", text: "What vibe do you want?", options: ["Smooth", "Epic", "Dynamic", "Tense", "Wow"] },
  ];

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const escapeHtml = (str) =>
    String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const safeText = (el, text) => {
    if (el) el.textContent = String(text ?? "");
  };

  const normalizeUrl = (value) => {
    const s = String(value ?? "").trim();
    return s || "";
  };

  const isPlan = (item) => String(item?.kind || "").toLowerCase() === "plan";

  const pickThumb = (...candidates) => {
    for (const candidate of candidates) {
      const url = normalizeUrl(candidate);
      if (url) return url;
    }
    return FALLBACK_THUMB;
  };

  const getVideoId = (item) =>
    item?.id || item?.slug || item?.videoUrl || item?.video_url || `${item?.title || ""}|${item?.duration || ""}`;

  function attachImgFallback(root) {
    if (!root) return;
    root.querySelectorAll("img").forEach((img) => {
      if (!normalizeUrl(img.getAttribute("src"))) {
        img.src = FALLBACK_THUMB;
      }

      img.addEventListener(
        "error",
        () => {
          if (img.dataset.smFallbackApplied === "1") return;
          img.dataset.smFallbackApplied = "1";
          img.src = FALLBACK_THUMB;
        },
        { once: true }
      );
    });
  }

  function setBusy(value) {
    state.isBusy = value;
    els.resetBtn.disabled = value;
    if (els.backBtn) els.backBtn.disabled = value || state.history.length === 0;
    els.chat.querySelectorAll(".opt").forEach((btn) => {
      btn.disabled = value;
    });
  }

  function scrollChatBottom() {
    els.chat.scrollTop = els.chat.scrollHeight;
  }

  function applyOverflow() {
    const locked = state.locks.drawer || state.locks.modal;
    document.documentElement.style.overflow = locked ? "hidden" : "";
    document.body.style.overflow = locked ? "hidden" : "";
  }

  function isDrawerMode() {
    return window.matchMedia("(max-width: 900px)").matches;
  }

  function openAssistant() {
    els.assistant.classList.add("active");
    if (els.assistantBackdrop) els.assistantBackdrop.style.display = "block";
    scope.classList.add("smFiltersOpen");
    state.locks.drawer = true;
    applyOverflow();
  }

  function closeAssistant() {
    els.assistant.classList.remove("active");
    if (els.assistantBackdrop) els.assistantBackdrop.style.display = "none";
    scope.classList.remove("smFiltersOpen");
    state.locks.drawer = false;
    applyOverflow();
  }

  function setModal(open) {
    els.modal.setAttribute("aria-hidden", open ? "false" : "true");
    state.locks.modal = !!open;
    applyOverflow();
  }

  function cleanupModal() {
    try {
      els.modal._cleanup && els.modal._cleanup();
    } catch (_) {}
    els.modal._cleanup = null;
  }

  function closeModal() {
    cleanupModal();
    setModal(false);
    els.modal.classList.remove("isPlan");
    els.modalContent.innerHTML = "";
  }

  async function getMember(timeout = 12000) {
    const now = Date.now();
    if (state.memberCache && now - state.memberCacheAt < 15000) {
      return state.memberCache;
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      const ms = window.$memberstackDom || window.$memberstack;
      const fn = ms?.getCurrentMember || ms?.getCurrentUser;

      if (typeof fn === "function") {
        try {
          const result = await fn.call(ms);
          const member = result?.data || result;
          if (member?.id) {
            state.memberCache = member;
            state.memberCacheAt = Date.now();
            return member;
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
      const error = new Error("LOGIN_REQUIRED");
      error.status = 401;
      throw error;
    }

    const headers = new Headers(opts.headers || {});
    headers.set("x-ms-id", member.id);

    if (opts.body && !(opts.body instanceof FormData) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(API_BASE + path, {
      method: opts.method || "GET",
      ...opts,
      headers,
    });

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const isJsonResponse = contentType.includes("application/json");
    const payload = isJsonResponse
      ? await response.json().catch(() => null)
      : await response.text().catch(() => null);

    if (!response.ok) {
      const error = new Error(`HTTP_${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  }

  async function hydrateSavedCache() {
    try {
      const data = await api("/v1/saved-moves?limit=200&offset=0");
      const list = Array.isArray(data)
        ? data
        : Array.isArray(data?.items) ? data.items
        : Array.isArray(data?.saved_moves) ? data.saved_moves
        : Array.isArray(data?.moves) ? data.moves
        : [];

      state.savedCache = list
        .map((item) => ({
          ...item,
          id: item?.id || item?.video_id || item?.slug || item?.videoUrl || item?.video_url || "",
          videoUrl: item?.videoUrl || item?.video_url || "",
        }))
        .filter((item) => item.id);
    } catch (e) {
      console.warn("[SM] saved-moves GET failed", e?.status, e?.payload || e);
      state.savedCache = [];
    }
  }

  function isSaved(id) {
    return state.savedCache.some((item) => String(item?.id) === String(id));
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
      await api("/v1/saved-moves", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    } catch (e) {
      console.warn("[SM] save failed", e?.status, e?.payload || e);
    }

    await hydrateSavedCache();
    return true;
  }

  function addBotRow() {
    const row = document.createElement("div");
    row.className = "msg msg--bot";
    row.innerHTML = `<div class="avatar"></div><div class="bubble"><span class="text"></span><span class="caret"></span></div>`;
    els.chat.appendChild(row);
    scrollChatBottom();
    return row;
  }

  async function addBotTyped(text) {
    setBusy(true);

    const row = addBotRow();
    const textEl = row.querySelector(".text");
    const caretEl = row.querySelector(".caret");
    const safe = escapeHtml(text);

    for (let i = 0; i < safe.length; i++) {
      textEl.innerHTML += safe[i];
      scrollChatBottom();
      await sleep(10 + Math.random() * 16);
    }

    await sleep(120);
    if (caretEl) caretEl.remove();

    setBusy(false);
  }

  function clearOptions() {
    els.chat.querySelectorAll(".options").forEach((node) => node.remove());
  }

  function applyFilters() {
    state.filtered = state.allItems.slice();
    state.visibleCount = 12;
    safeText(els.matchCount, state.filtered.length);
    renderResults();
  }

  function renderOptions() {
    clearOptions();
    if (state.stepIndex >= steps.length) return;

    const step = steps[state.stepIndex];
    const wrap = document.createElement("div");
    wrap.className = "options";

    step.options.forEach((label) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "opt";
      btn.textContent = label;

      btn.addEventListener("click", async () => {
        if (state.isBusy) return;

        state.history.push({
          stepIndex: state.stepIndex,
          key: step.key,
          prevChatHTML: els.chat.innerHTML,
        });

        if (els.backBtn) els.backBtn.disabled = state.history.length === 0;

        state.filters[step.key] = label;
        state.stepIndex += 1;

        applyFilters();

        if (state.stepIndex >= steps.length) {
          clearOptions();
          await addBotTyped("Done. Browse moves and cinematic plans in the results.");
          return;
        }

        await addBotTyped(steps[state.stepIndex].text);
        renderOptions();
      });

      wrap.appendChild(btn);
    });

    els.chat.appendChild(wrap);
    scrollChatBottom();
  }

  function resetChatFlow() {
    state.history.length = 0;
    state.stepIndex = 0;
    state.filters = {};
    els.chat.innerHTML = "";
    clearOptions();
    if (els.backBtn) els.backBtn.disabled = true;
  }

  function bookmarkSvg() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6.5 3.5h11c.83 0 1.5.67 1.5 1.5v16.1c0 .78-.86 1.26-1.53.86L12 19.35 6.53 21.96C5.86 22.26 5 21.78 5 21.1V5c0-.83.67-1.5 1.5-1.5z"></path>
      </svg>
    `;
  }

  function renderMoveCard(item, index) {
    const id = getVideoId(item);
    const saved = isSaved(id);
    const thumb = pickThumb(item?.thumb);
    const title = escapeHtml(item?.title || "");

    const card = document.createElement("div");
    card.className = "card";
    card.dataset.index = String(index);
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
        <span class="badge">${escapeHtml(item?.duration || "")}</span>
      </div>
    `;

    attachImgFallback(card);
    return card;
  }

  function renderPlanCard(item, index) {
    const stepsArr = Array.isArray(item?.steps) ? item.steps : [];
    const titleRaw = item?.title || "Cinematic plan";
    const cover = pickThumb(item?.thumb_a, stepsArr?.[0]?.thumb, item?.thumb);
    const shotsCount = Number(item?.shots_count) || stepsArr.length || 0;
    const total = item?.total_duration || "";
    const desc = item?.description || "";

    const card = document.createElement("div");
    card.className = "cardPlan";
    card.dataset.index = String(index);
    card.dataset.kind = "plan";
    card.dataset.itemId = String(item?.id || "");

    card.innerHTML = `
      <div class="planMedia">
        <img class="planImg" src="${cover}" alt="${escapeHtml(titleRaw)}" loading="lazy">
        <div class="planPills">
          <span class="pill pill--plan"><span class="pillDot"></span>Plan</span>
          ${total ? `<span class="pill">${escapeHtml(total)}</span>` : ""}
          ${shotsCount ? `<span class="pill">${escapeHtml(shotsCount)} shots</span>` : ""}
        </div>
      </div>

      <div class="planCaption">Cinematic Plan</div>

      <div class="planBubble">
        <h3 class="planName">${escapeHtml(titleRaw)}</h3>
        ${desc ? `<div class="planDesc">${escapeHtml(desc)}</div>` : ""}
      </div>
    `;

    attachImgFallback(card);
    return card;
  }

  function renderResults() {
    els.grid.innerHTML = "";

    const visibleItems = state.filtered.slice(0, state.visibleCount);

    if (!visibleItems.length) {
      els.grid.innerHTML = `<div class="card" style="padding:14px">No results.</div>`;
      if (els.moreBtn) els.moreBtn.style.display = "none";
      if (els.resultsHead) els.resultsHead.style.display = "none";
      safeText(els.matchCount, "0");
      return;
    }

    const hasPlan = visibleItems.some(isPlan);
    if (els.resultsHead) els.resultsHead.style.display = hasPlan ? "flex" : "none";

    visibleItems.forEach((item, index) => {
      const card = isPlan(item) ? renderPlanCard(item, index) : renderMoveCard(item, index);
      els.grid.appendChild(card);
    });

    if (els.moreBtn) {
      els.moreBtn.style.display = state.filtered.length > state.visibleCount ? "block" : "none";
    }

    safeText(els.matchCount, state.filtered.length);
  }

  function syncCardSaveUI(video) {
    const id = getVideoId(video);
    const saved = isSaved(id);
    const selector = `.sm-save[data-save-id="${CSS.escape(String(id))}"]`;
    const btn = els.grid.querySelector(selector);

    if (!btn) return;

    btn.classList.toggle("isSaved", saved);
    btn.setAttribute("aria-label", saved ? "Unsave" : "Save");
  }

  function buildVideoModal(item) {
    const src = normalizeUrl(item?.videoUrl || item?.video_url);
    const saved = isSaved(getVideoId(item));

    els.modalContent.innerHTML = `
      <div class="player">
        <video id="playerVideo" controls playsinline preload="metadata">
          <source src="${escapeHtml(src)}" type="video/mp4">
        </video>

        <div class="player__top">
          <div class="player__title">${escapeHtml(item?.title || "")}</div>
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

  function buildPlanModal(item) {
    const stepsArr = Array.isArray(item?.steps) ? item.steps : [];
    const title = item?.title || "Cinematic plan";
    const total = item?.total_duration || "";
    const desc = item?.description || "";

    els.modalContent.innerHTML = `
      <div class="player player--plan">
        <div class="planPlayer">
          <div class="player__top">
            <div class="player__title">${escapeHtml(title)}</div>
            <button class="player__close" id="planClose" type="button" aria-label="Close">×</button>
          </div>

          <div class="planStage">
            <div class="planTrack">
              ${
                stepsArr.length
                  ? stepsArr.map((step, index) => {
                      const thumb = pickThumb(step?.thumb, item?.thumb_a, item?.thumb_b, item?.thumb);
                      return `
                        <div class="planSlide">
                          <div class="planSlide__top">
                            <img src="${thumb}" alt="${escapeHtml(step?.title || `Step ${index + 1}`)}" loading="lazy">
                            <div class="planSlide__label">
                              <div class="planSlide__h">${escapeHtml(step?.title || `Shot ${index + 1}`)}</div>
                              <div class="planSlide__sub">
                                ${step?.duration ? escapeHtml(step.duration) : ""}
                              </div>
                            </div>
                          </div>

                          <div class="planSlide__bottom">
                            <div class="planEdit">
                              <div class="planEdit__tip">${escapeHtml(step?.note || desc || "Cinematic plan step")}</div>
                            </div>
                          </div>
                        </div>
                      `;
                    }).join("")
                  : `
                    <div class="planSlide">
                      <div class="planSlide__top">
                        <img src="${pickThumb(item?.thumb_a, item?.thumb_b, item?.thumb)}" alt="${escapeHtml(title)}" loading="lazy">
                        <div class="planSlide__label">
                          <div class="planSlide__h">${escapeHtml(title)}</div>
                          <div class="planSlide__sub">No steps yet</div>
                        </div>
                      </div>

                      <div class="planSlide__bottom">
                        <div class="planEdit">
                          <div class="planEdit__tip">${escapeHtml(desc || "This plan has no steps yet.")}</div>
                        </div>
                      </div>
                    </div>
                  `
              }
            </div>

            ${
              stepsArr.length > 1
                ? `
                  <div class="planDots">
                    ${stepsArr.map((_, index) => `<button class="planDot ${index === 0 ? "is-active" : ""}" type="button" data-dot="${index}" aria-label="Go to step ${index + 1}"></button>`).join("")}
                  </div>
                `
                : ""
            }
          </div>

          <div class="player__bar">
            ${total ? `<button class="btn" type="button" disabled>${escapeHtml(total)}</button>` : ""}
            <button class="btn" type="button" disabled>${stepsArr.length} shots</button>
            <button class="btn" id="planFsBtn" type="button">Fullscreen</button>
          </div>
        </div>
      </div>
    `;

    attachImgFallback(els.modalContent);
  }

  async function openPlayer(index) {
    const item = state.filtered[index];
    if (!item || isPlan(item)) return;

    const src = normalizeUrl(item?.videoUrl || item?.video_url);
    if (!src) return;

    cleanupModal();
    state.currentIndex = index;

    buildVideoModal(item);
    setModal(true);

    const player = $("playerVideo");
    const closeBtn = $("playerClose");
    const prevBtn = $("prevVideoBtn");
    const nextBtn = $("nextVideoBtn");
    const backBtn = $("skipBackBtn");
    const fwdBtn = $("skipFwdBtn");
    const saveBtn = $("saveMoveBtn");
    const fsBtn = $("fsBtn");

    const findPrevMoveIndex = () => {
      for (let i = state.currentIndex - 1; i >= 0; i--) {
        if (!isPlan(state.filtered[i])) return i;
      }
      return -1;
    };

    const findNextMoveIndex = () => {
      for (let i = state.currentIndex + 1; i < state.filtered.length; i++) {
        if (!isPlan(state.filtered[i])) return i;
      }
      return -1;
    };

    const onBackdrop = () => closeModal();
    const onPrev = () => {
      const prevIndex = findPrevMoveIndex();
      if (prevIndex >= 0) openPlayer(prevIndex);
    };
    const onNext = () => {
      const nextIndex = findNextMoveIndex();
      if (nextIndex >= 0) openPlayer(nextIndex);
    };
    const onBack = () => {
      if (!player) return;
      player.currentTime = Math.max(0, (player.currentTime || 0) - 10);
    };
    const onForward = () => {
      if (!player) return;
      player.currentTime = Math.min(player.duration || 999999, (player.currentTime || 0) + 10);
    };
    const onSave = async () => {
      const nowSaved = await toggleSaved(item);
      saveBtn.textContent = nowSaved ? "Saved" : "Save";
      syncCardSaveUI(item);
    };
    const onFullscreen = async () => {
      try {
        if (!document.fullscreenElement) await els.modal.requestFullscreen();
        else await document.exitFullscreen();
      } catch (_) {}
    };

    closeBtn?.addEventListener("click", closeModal);
    prevBtn?.addEventListener("click", onPrev);
    nextBtn?.addEventListener("click", onNext);
    backBtn?.addEventListener("click", onBack);
    fwdBtn?.addEventListener("click", onForward);
    saveBtn?.addEventListener("click", onSave);
    fsBtn?.addEventListener("click", onFullscreen);
    els.modalBackdrop.addEventListener("click", onBackdrop);

    player?.play().catch(() => {});

    els.modal._cleanup = () => {
      els.modalBackdrop.removeEventListener("click", onBackdrop);
      try {
        player?.pause();
      } catch (_) {}
    };
  }

  function openPlan(item) {
    if (!item) return;

    cleanupModal();
    els.modal.classList.add("isPlan");
    buildPlanModal(item);
    setModal(true);

    const closeBtn = $("planClose");
    const fsBtn = $("planFsBtn");
    const track = els.modalContent.querySelector(".planTrack");
    const dots = Array.from(els.modalContent.querySelectorAll(".planDot"));
    let activeIndex = 0;

    const updateSlider = (index) => {
      if (!track) return;
      activeIndex = Math.max(0, Math.min(index, dots.length || 0));
      track.style.transform = `translateX(-${activeIndex * 100}%)`;
      dots.forEach((dot, i) => dot.classList.toggle("is-active", i === activeIndex));
    };

    const onBackdrop = () => closeModal();
    const onFullscreen = async () => {
      try {
        if (!document.fullscreenElement) await els.modal.requestFullscreen();
        else await document.exitFullscreen();
      } catch (_) {}
    };

    closeBtn?.addEventListener("click", closeModal);
    fsBtn?.addEventListener("click", onFullscreen);
    els.modalBackdrop.addEventListener("click", onBackdrop);

    dots.forEach((dot) => {
      dot.addEventListener("click", () => {
        updateSlider(Number(dot.dataset.dot || 0));
      });
    });

    els.modal._cleanup = () => {
      els.modalBackdrop.removeEventListener("click", onBackdrop);
    };
  }

  async function loadItems() {
    try {
      safeText(els.matchCount, "Loading…");

      const response = await fetch(CDN_INDEX_URL, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const json = await response.json();
      const items = Array.isArray(json) ? json : [];

      const plans = items.filter(isPlan);
      const moves = items.filter((item) => !isPlan(item));

      state.allItems = [...plans, ...moves];
      applyFilters();
    } catch (e) {
      console.error("[SM] loadItems error:", e);
      safeText(els.matchCount, "—");
      els.grid.innerHTML = `<div class="card" style="padding:14px">Failed to load videos.</div>`;
      if (els.moreBtn) els.moreBtn.style.display = "none";
      if (els.resultsHead) els.resultsHead.style.display = "none";
    }
  }

  function bindEvents() {
    els.openAssistantBtn?.addEventListener("click", openAssistant);
    els.closeAssistantBtn?.addEventListener("click", closeAssistant);
    els.assistantBackdrop?.addEventListener("click", closeAssistant);

    window.addEventListener("resize", () => {
      if (!isDrawerMode()) {
        state.locks.drawer = false;
        if (els.assistantBackdrop) els.assistantBackdrop.style.display = "none";
        scope.classList.remove("smFiltersOpen");
        els.assistant.classList.remove("active");
        applyOverflow();
      }
    });

    window.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;

      if (els.modal.getAttribute("aria-hidden") === "false") {
        closeModal();
        return;
      }

      if (els.assistant.classList.contains("active")) {
        closeAssistant();
      }
    });

    els.backBtn?.addEventListener("click", () => {
      if (state.isBusy) return;

      const last = state.history.pop();
      if (els.backBtn) els.backBtn.disabled = state.history.length === 0;
      if (!last) return;

      state.stepIndex = last.stepIndex;
      delete state.filters[last.key];
      els.chat.innerHTML = last.prevChatHTML;

      applyFilters();
      renderOptions();
      scrollChatBottom();
    });

    els.resetBtn.addEventListener("click", async () => {
      if (state.isBusy) return;

      resetChatFlow();
      await addBotTyped("Hi. Let’s browse moves and cinematic plans.");
      await addBotTyped(steps[0].text);

      if (state.allItems.length) applyFilters();
      renderOptions();
    });

    els.moreBtn?.addEventListener("click", () => {
      state.visibleCount += 12;
      renderResults();
    });

    els.grid.addEventListener("click", async (e) => {
      const card = e.target.closest(".card, .cardPlan");
      if (!card) return;

      const index = Number(card.dataset.index || "-1");
      if (!Number.isFinite(index) || index < 0) return;

      const item = state.filtered[index];
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

      if (isPlan(item)) openPlan(item);
      else openPlayer(index);
    });
  }

  async function init() {
    if (els.backBtn) els.backBtn.disabled = true;

    bindEvents();

    await getMember(12000).catch(() => null);
    await hydrateSavedCache();

    await addBotTyped("Hi. Let’s browse moves and cinematic plans.");
    await addBotTyped(steps[0].text);
    renderOptions();

    await loadItems();
  }

  init();
})();
