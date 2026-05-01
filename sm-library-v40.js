/* ========================================================= SKYMOTION — LIBRARY v1 (STANDALONE) CLEAN - Plans + Moves mixed by default - OLD #modal = fullscreen video player only - Plan viewer removed from this embed - Plan cards dispatch event to external plan viewer - Robust image fallback - Scoped. Webflow-safe. - FILTERS RESTORED - FASTER INITIAL LOAD - CLEANED FROM SESSION REMNANTS - ORDERED CHAT FLOW - LIGHT CHAT HISTORY - LOADING SKELETON - ANALYTICS EVENTS ADDED ========================================================= */

(() => {
  "use strict";
  if (window.__SM_LIBRARY_V1_CLEAN_SPLIT__) return;
  window.__SM_LIBRARY_V1_CLEAN_SPLIT__ = true;

  const FALLBACK_THUMB = "https://skymotion-cdn.b-cdn.net/thumb.jpg";
  const CDN_INDEX_URL = "https://skymotion-cdn.b-cdn.net/videos_index_v16.json";
  const API_BASE = String(window.SM_API_BASE || "https://skymotion.onrender.com").replace(/\/$/, "");
  const $ = (id) => document.getElementById(id);

  const scope = $("sm-library-scope");
  if (!scope) return;

  function emit(name, detail = {}) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  let libraryViewedSent = false;

  const openAssistantBtn = $("openAssistantBtn");
  const closeAssistantBtn = $("closeAssistantBtn");
  const assistantBackdropEl = $("assistantBackdrop");
  const assistant = scope.querySelector(".assistant");

  const chat = $("chat");
  const grid = $("resultsGrid");
  const matchCount = $("matchCount");
  const resetBtn = $("resetBtn");
  const backBtn = $("backBtn");
  const filterStep = $("filterStep");
  const showResultsBtn = $("showResultsBtn");
  const backToResultsBtn = $("backToResultsBtn");
  const moreBtn = $("moreBtn");
  const resultsHead = $("resultsHead");

  const modal = $("modal");
  const modalBackdrop = $("modalBackdrop");
  const modalContent = $("modalContent");

  const required = { assistant, chat, grid, matchCount, resetBtn, modal, modalBackdrop, modalContent };

  const missing = Object.entries(required).filter(([, el]) => !el).map(([name]) => name);
  if (missing.length) {
    console.warn("[SM] Missing required elements:", missing);
    return;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function setPlayerViewportHeight() {
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty("--sm-player-vh", `${vh}px`);
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatPlayerTime(sec) {
    const n = Number(sec || 0);
    if (!Number.isFinite(n) || n < 0) return "0:00";
    const m = Math.floor(n / 60);
    const s = Math.floor(n % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function safeText(el, t) {
    if (el) el.textContent = String(t ?? "");
  }

  function isPlan(x) {
    return String(x?.kind || "").toLowerCase() === "plan";
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

  function hasMatch(itemValue, selectedValue) {
    if (!selectedValue) return true;
    const arr = Array.isArray(itemValue) ? itemValue.map((x) => String(x).toLowerCase()) : [];
    return arr.includes(String(selectedValue).toLowerCase());
  }

  function normalizeFilterValue(stepKey, label) {
    if (!label) return "";

    const map = {
      env: {
        "Open area": "open",
        "City / Urban": "urban",
        "Forest": "forest",
        "Near objects": "near_objects",
        "Tight space": "tight_space"
      },
      risk: {
        "Safe & calm": "calm",
        "Some risks": "some_risks",
        "No aggressive moves": "no_aggressive_moves"
      },
      subject: {
        "Person": "person",
        "Car / Bike": "car_bike",
        "Building": "building",
        "Landscape": "landscape",
        "Atmosphere": "atmosphere"
      },
      pilot: {
        "Playing safe": "safe",
        "Normal": "normal",
        "Ready to experiment": "experiment"
      },
      mood: {
        "Smooth": "smooth",
        "Epic": "epic",
        "Dynamic": "dynamic",
        "Tense": "tense",
        "Wow": "wow"
      }
    };

    return map?.[stepKey]?.[label] || String(label).toLowerCase();
  }

  function shakeFiltersButton() {
    if (!openAssistantBtn) return;
    if (!window.matchMedia("(max-width: 900px)").matches) return;

    openAssistantBtn.classList.remove("is-attention");
    void openAssistantBtn.offsetWidth;
    openAssistantBtn.classList.add("is-attention");

    setTimeout(() => {
      openAssistantBtn.classList.remove("is-attention");
    }, 1600);
  }

  window.addEventListener("resize", setPlayerViewportHeight);
  window.addEventListener("orientationchange", setPlayerViewportHeight);
  setPlayerViewportHeight();

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

      savedCache = list.map((x) => ({
        ...x,
        id: x?.id || x?.video_id || x?.slug || x?.videoUrl || x?.video_url || "",
        videoUrl: x?.videoUrl || x?.video_url || "",
      })).filter((x) => x.id);
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

      emit("sm:save_clicked", {
        item_id: id,
        action: "unsave",
        item_type: "move",
        title: video?.title || ""
      });

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
      await api(`/v1/saved-moves`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
    } catch (e) {
      console.warn("[SM] save failed", e?.status, e?.payload || e);
    }

    await hydrateSavedCache();

    emit("sm:save_clicked", {
      item_id: id,
      action: "save",
      item_type: "move",
      title: video?.title || ""
    });

    return true;
  }

  // ---------------- UI locks ----------------
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

  function goToResults() {
    closeAssistant();

    const results = scope.querySelector(".results");
    if (results) {
      setTimeout(() => {
        results.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
    }
  }

  if (openAssistantBtn) openAssistantBtn.addEventListener("click", openAssistant);
  if (closeAssistantBtn) closeAssistantBtn.addEventListener("click", closeAssistant);
  if (assistantBackdropEl) assistantBackdropEl.addEventListener("click", closeAssistant);
  if (showResultsBtn) showResultsBtn.addEventListener("click", goToResults);
  if (backToResultsBtn) backToResultsBtn.addEventListener("click", goToResults);

  window.addEventListener("resize", () => {
    if (!isDrawerMode()) {
      locks.drawer = false;
      if (assistantBackdropEl) assistantBackdropEl.style.display = "none";
      scope.classList.remove("smFiltersOpen");
      assistant.classList.remove("active");
      applyOverflow();
    }
  });

  // ---------------- Video modal ----------------
  let currentIndex = -1;
  let returnToPlanAfterClose = false;

  function setModal(open) {
    modal.setAttribute("aria-hidden", open ? "false" : "true");
    locks.modal = !!open;
    applyOverflow();
  }

  function closeModal() {
    const shouldReturnToPlan = returnToPlanAfterClose === true;

    try { modal._cleanup && modal._cleanup(); } catch (_) {}
    modal._cleanup = null;

    setModal(false);
    modalContent.innerHTML = "";
    modal.classList.remove("isPlan");
    returnToPlanAfterClose = false;

    if (shouldReturnToPlan) {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("sm:reopen-plan-after-player"));
      }, 20);
    }
  }

  function setFsUiHidden(hidden) {
    modal.classList.toggle("is-fs-ui-hidden", !!hidden);
  }

  function isElementFullscreen(el) {
    return document.fullscreenElement === el || document.webkitFullscreenElement === el;
  }

  async function enterPlayerFullscreen(player) {
    if (!player) return;

    setFsUiHidden(true);

    try {
      if (player.webkitEnterFullscreen) {
        player.webkitEnterFullscreen();
        return;
      }

      if (!isElementFullscreen(modal)) {
        if (modal.requestFullscreen) {
          await modal.requestFullscreen({ navigationUI: "hide" }).catch(() => modal.requestFullscreen());
        } else if (modal.webkitRequestFullscreen) {
          modal.webkitRequestFullscreen();
        }
      }

      const so = screen.orientation;
      if (so && so.lock) {
        try { await so.lock("landscape"); } catch (_) {}
      }
    } catch (_) {
      setFsUiHidden(false);
    }
  }

  async function exitPlayerFullscreen() {
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
      } else if (document.webkitFullscreenElement && document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    } catch (_) {}

    try {
      const so = screen.orientation;
      if (so && so.unlock) so.unlock();
    } catch (_) {}

    setFsUiHidden(false);
  }

  function bindFullscreenState(player) {
    const sync = () => {
      const nativeFs = isElementFullscreen(modal);
      if (!nativeFs) setFsUiHidden(false);
    };

    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);

    if (player) {
      player.addEventListener("webkitbeginfullscreen", () => setFsUiHidden(true));
      player.addEventListener("webkitendfullscreen", () => setFsUiHidden(false));
    }

    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }

  function isMobilePlayerUi() {
    return window.matchMedia("(max-width: 900px)").matches;
  }

  function isPortraitViewport() {
    return window.matchMedia("(orientation: portrait)").matches;
  }

  function shouldShowRotateHint() {
    return isMobilePlayerUi() && isPortraitViewport();
  }

  function setRotateHintVisible(visible) {
    const hint = $("rotateHint");
    if (!hint) return;
    hint.classList.toggle("is-visible", !!visible);
  }

  function bindRotateHint() {
    let hideTimer = null;

    const update = () => setRotateHintVisible(shouldShowRotateHint());

    const showTemporarily = () => {
      clearTimeout(hideTimer);
      update();

      if (shouldShowRotateHint()) {
        hideTimer = setTimeout(() => {
          setRotateHintVisible(false);
        }, 2600);
      }
    };

    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);

    showTemporarily();

    return () => {
      clearTimeout(hideTimer);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      setRotateHintVisible(false);
    };
  }

  function togglePlayerPlayback(player, playPauseBtn) {
    if (!player) return;

    if (player.paused) {
      player.play().catch(() => {});
    } else {
      player.pause();
    }

    if (playPauseBtn) {
      playPauseBtn.textContent = player.paused ? "Play" : "Pause";
    }
  }

  window.addEventListener("keydown", (e) => {
    const modalOpen = modal.getAttribute("aria-hidden") === "false";

    if (e.key === "Escape") {
      if (modalOpen) {
        closeModal();
        return;
      }

      if (assistant.classList.contains("active")) {
        closeAssistant();
      }

      return;
    }

    if (!modalOpen) return;

    if (e.code === "Space" || e.key === " ") {
      const player = $("playerVideo");
      const playPauseBtn = $("playPauseBtn");
      if (!player) return;

      const tag = String(document.activeElement?.tagName || "").toLowerCase();
      const isTypingTarget = tag === "input" || tag === "textarea" || document.activeElement?.isContentEditable;
      if (isTypingTarget) return;

      e.preventDefault();
      togglePlayerPlayback(player, playPauseBtn);
    }
  });

  // ---------------- Chat / filters ----------------
  let isBusy = false;
  const history = [];

  const steps = [
    { key: "env", text: "Where are you flying?", options: ["Open area", "City / Urban", "Forest", "Near objects", "Tight space"] },
    { key: "risk", text: "How safe does it feel here?", options: ["Safe & calm", "Some risks", "No aggressive moves"] },
    { key: "subject", text: "What are you filming?", options: ["Person", "Car / Bike", "Building", "Landscape", "Atmosphere"] },
    { key: "pilot", text: "How confident are you right now?", options: ["Playing safe", "Normal", "Ready to experiment"] },
    { key: "mood", text: "What vibe do you want?", options: ["Smooth", "Epic", "Dynamic", "Tense", "Wow"] },
  ];

  const state = {};
  let stepIndex = 0;

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
    row.innerHTML = `
      <div class="avatar"></div>
      <div class="bubble">
        <span class="text"></span>
        <span class="caret"></span>
      </div>
    `;
    chat.appendChild(row);
    scrollChatBottom();
    return row;
  }

  function addUserRow(text) {
    const row = document.createElement("div");
    row.className = "msg msg--user";
    row.innerHTML = `
      <div class="bubble">
        <span class="text">${escapeHtml(text)}</span>
      </div>
    `;
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

  function clearOptions() {
    chat.querySelectorAll(".options").forEach((el) => el.remove());
  }

  function removeFilterHelp() {
    chat.querySelectorAll(".filterHelp").forEach((el) => el.remove());
  }

  function showNoMatch(btn, label) {
    removeFilterHelp();

    if (btn) {
      btn.classList.remove("is-shaking");
      void btn.offsetWidth;
      btn.classList.add("is-shaking");

      setTimeout(() => {
        btn.classList.remove("is-shaking");
      }, 380);
    }

    const help = document.createElement("div");
    help.className = "filterHelp";
    help.innerHTML = `
      <strong>No moves for “${escapeHtml(label)}”</strong>
      Try another option or reset filters.
    `;

    const options = chat.querySelector(".options");
    if (options) {
      options.insertAdjacentElement("afterend", help);
    } else {
      chat.appendChild(help);
    }

    scrollChatBottom();
  }

  function getFilteredItems(nextState = state) {
    const selected = {
      env: normalizeFilterValue("env", nextState.env),
      risk: normalizeFilterValue("risk", nextState.risk),
      subject: normalizeFilterValue("subject", nextState.subject),
      pilot: normalizeFilterValue("pilot", nextState.pilot),
      mood: normalizeFilterValue("mood", nextState.mood),
    };

    return allItems.filter((item) => {
      return (
        hasMatch(item.env, selected.env) &&
        hasMatch(item.risk, selected.risk) &&
        hasMatch(item.subject, selected.subject) &&
        hasMatch(item.pilot, selected.pilot) &&
        hasMatch(item.mood, selected.mood)
      );
    });
  }

  function updateFilterUi() {
    if (filterStep) {
      const current = Math.min(stepIndex + 1, steps.length);
      filterStep.textContent = stepIndex >= steps.length ? "Done" : `Step ${current}/${steps.length}`;
    }

    if (showResultsBtn) {
      const count = filtered.length;

      if (count <= 0) {
        showResultsBtn.textContent = "No moves found";
        showResultsBtn.disabled = true;
      } else {
        showResultsBtn.textContent = `Show ${count} ${count === 1 ? "move" : "moves"}`;
        showResultsBtn.disabled = false;
      }
    }
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

        emit("sm:tag_clicked", {
          step_key: s.key,
          tag_name: label
        });

        const candidateState = {
          ...state,
          [s.key]: label
        };

        if (!isInitialLoading && getFilteredItems(candidateState).length === 0) {
          showNoMatch(btn, label);
          return;
        }

        removeFilterHelp();

        history.push({
          stepIndex,
          prevChatHTML: chat.innerHTML,
          prevState: { ...state }
        });

        if (backBtn) backBtn.disabled = history.length === 0;

        addUserRow(label);

        state[s.key] = label;
        stepIndex += 1;

        applyFilters();

        if (stepIndex >= steps.length) {
          clearOptions();
          await addBotTyped("Done. Your results are ready.");
          updateFilterUi();

          setTimeout(() => {
            if (showResultsBtn && !showResultsBtn.disabled) {
              showResultsBtn.focus();
            }
          }, 200);

          return;
        }

        await addBotTyped(steps[stepIndex].text);
        renderOptions();
        updateFilterUi();
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
      if (backBtn) backBtn.disabled = history.length === 0;
      if (!last) return;

      stepIndex = last.stepIndex;

      Object.keys(state).forEach((k) => delete state[k]);
      Object.assign(state, last.prevState || {});

      chat.innerHTML = last.prevChatHTML;

      applyFilters();
      renderOptions();
      updateFilterUi();
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
    removeFilterHelp();

    if (backBtn) backBtn.disabled = true;

    await addBotTyped("Hi. Let’s browse moves and cinematic plans.");
    await addBotTyped(steps[0].text);

    applyFilters();
    renderOptions();
    updateFilterUi();
  });

  // ---------------- Data ----------------
  let allItems = [];
  let filtered = [];
  let visibleCount = 12;
  let isInitialLoading = true;

  function showSkeletons(count = 8) {
    grid.innerHTML = "";

    for (let i = 0; i < count; i++) {
      const el = document.createElement("div");
      el.className = "card sm-skeleton-card";
      el.style.minHeight = "220px";
      el.innerHTML = `<div class="sm-skeleton-fill" style="position:absolute;inset:0;"></div>`;
      grid.appendChild(el);
    }

    if (moreBtn) moreBtn.style.display = "none";
  }

  function applyFilters() {
    filtered = getFilteredItems(state);

    safeText(matchCount, String(filtered.length));
    visibleCount = 12;

    renderResults();
    updateFilterUi();

    if (!libraryViewedSent && allItems.length) {
      libraryViewedSent = true;
      emit("sm:library_viewed", {
        results_count: filtered.length
      });
    }
  }

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
      <button class="sm-save ${saved ? "isSaved" : ""}" type="button"
        aria-label="${saved ? "Unsave" : "Save"}" data-save-id="${escapeHtml(id)}">
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
      Number(p?.meta?.shots_count) ||
      Number(p?.shots_count) ||
      stepsArr.length ||
      (Array.isArray(p?.edit?.shots) ? p.edit.shots.length : 0) ||
      0;

    const clipSeconds =
      Number(p?.final_clip_duration_s) ||
      Number(p?.final?.duration_s) ||
      0;

    const clipText = clipSeconds ? formatSeconds(clipSeconds) : "";

    const shootTimeMin =
      Number(p?.meta?.shoot_time_min) ||
      Number(p?.shoot_time_min) ||
      0;

    const difficulty =
      p?.meta?.difficulty ||
      p?.difficulty ||
      "Beginner";

    const metaParts = [];
    if (shootTimeMin) metaParts.push(`${shootTimeMin} min shoot`);
    if (difficulty) metaParts.push(difficulty);
    if (shotsCount) metaParts.push(`${shotsCount} shots`);

    const metaText = metaParts.join(" • ");

    const card = document.createElement("div");
    card.className = "cardPlan";
    card.dataset.index = String(i);
    card.dataset.kind = "plan";
    card.dataset.itemId = String(p?.id || "");

    card.innerHTML = `
      <div class="planMedia">
        <img class="planImg" src="${cover}" alt="${escapeHtml(titleRaw)}" loading="lazy">

        <div class="planPills">
          ${clipText ? `<span class="pill">${escapeHtml(clipText)}</span>` : ``}
          ${shotsCount ? `<span class="pill">${escapeHtml(String(shotsCount))} shots</span>` : ``}
          <span class="pill pill--plan">Plan</span>
        </div>

        <div class="planCaption">${escapeHtml(titleRaw)}</div>
      </div>

      <div class="planBubble">
        <div class="planType">Cinematic Plan</div>
        <div class="planMeta">${escapeHtml(metaText)}</div>
      </div>
    `;

    attachImgFallback(card);
    return card;
  }

  function renderResults() {
    if (isInitialLoading) return;

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

    attachImgFallback(grid);

    if (moreBtn) {
      moreBtn.style.display = filtered.length > visibleCount ? "block" : "none";
    }

    safeText(matchCount, String(filtered.length));
  }

  if (moreBtn) {
    moreBtn.addEventListener("click", () => {
      visibleCount += 12;
      renderResults();
    });
  }

  function buildVideoPlayer(video) {
    const src = normalizeUrl(video?.videoUrl || video?.video_url);

    modalContent.innerHTML = `
      <div class="player">
        <div class="player__top">
          <div class="player__title">${escapeHtml(video?.title || "")}</div>
          <button class="player__close" id="playerClose" type="button" aria-label="Close">×</button>
        </div>

        <div class="player__videoWrap">
          <video id="playerVideo" playsinline preload="metadata">
            <source src="${escapeHtml(src)}" type="video/mp4">
          </video>

          <div class="player__rotateHint" id="rotateHint" aria-hidden="true">
            Rotate phone for better view
          </div>

          <div class="player__controls" id="playerControls">
            <div class="player__progressWrap">
              <input id="playerSeek" class="player__seek" type="range" min="0" max="100" step="0.1" value="0" aria-label="Video progress">
            </div>

            <div class="player__bar">
              <div class="player__barLeft">
                <button class="btn" id="playPauseBtn" type="button">Pause</button>
                <div class="player__time" id="playerTime">0:00 / 0:00</div>
              </div>

              <div class="player__barCenter">
                <button class="btn" id="prevVideoBtn" type="button">Prev</button>
                <button class="btn" id="nextVideoBtn" type="button">Next</button>
              </div>

              <div class="player__barRight">
                <button class="btn" id="fsBtn" type="button">Fullscreen</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function bindPlayerUi({
    player,
    playPauseBtn,
    playerSeek,
    playerTime,
    closeBtn,
    prevBtn,
    nextBtn,
    fsBtn,
    videoWrap,
    controls,
    onPrev,
    onNext,
    onClose,
    analyticsId,
    analyticsTitle
  }) {
    let startedTracked = false;
    let watched50Tracked = false;
    let isSeeking = false;

    function updateTimeUi() {
      if (!player || !playerTime || !playerSeek) return;

      const duration = Number(player.duration || 0);
      const current = Number(player.currentTime || 0);

      playerTime.textContent = `${formatPlayerTime(current)} / ${formatPlayerTime(duration)}`;

      if (!isSeeking) {
        const progress = duration > 0 ? (current / duration) * 100 : 0;
        playerSeek.value = String(progress);
      }
    }

    function updatePlayPauseUi() {
      if (!playPauseBtn || !player) return;
      playPauseBtn.textContent = player.paused ? "Play" : "Pause";
    }

    const onPlay = () => {
      updatePlayPauseUi();

      if (startedTracked) return;
      startedTracked = true;

      emit("sm:video_started", {
        item_id: analyticsId,
        item_type: "move",
        title: analyticsTitle
      });
    };

    const onPause = () => updatePlayPauseUi();

    const onTimeUpdate = () => {
      updateTimeUi();

      if (watched50Tracked) return;

      const duration = Number(player.duration || 0);
      const current = Number(player.currentTime || 0);
      if (!duration || duration <= 0) return;

      if (current / duration >= 0.5) {
        watched50Tracked = true;

        emit("sm:video_watched_50", {
          item_id: analyticsId,
          item_type: "move",
          title: analyticsTitle
        });
      }
    };

    const onEnded = () => {
      updatePlayPauseUi();
      updateTimeUi();
    };

    player?.addEventListener("play", onPlay);
    player?.addEventListener("pause", onPause);
    player?.addEventListener("loadedmetadata", updateTimeUi);
    player?.addEventListener("timeupdate", onTimeUpdate);
    player?.addEventListener("ended", onEnded);

    if (closeBtn) closeBtn.addEventListener("click", onClose);
    if (prevBtn && onPrev) prevBtn.addEventListener("click", onPrev);
    if (nextBtn && onNext) nextBtn.addEventListener("click", onNext);

    if (playPauseBtn) {
      playPauseBtn.addEventListener("click", () => {
        togglePlayerPlayback(player, playPauseBtn);
      });
    }

    if (playerSeek && player) {
      playerSeek.addEventListener("pointerdown", () => {
        isSeeking = true;
      });

      playerSeek.addEventListener("pointerup", () => {
        const duration = Number(player.duration || 0);
        const value = Number(playerSeek.value || 0);

        if (duration > 0) {
          player.currentTime = (value / 100) * duration;
        }

        isSeeking = false;
        updateTimeUi();
      });

      playerSeek.addEventListener("input", () => {
        const duration = Number(player.duration || 0);
        const value = Number(playerSeek.value || 0);
        const previewTime = duration > 0 ? (value / 100) * duration : 0;

        if (playerTime) {
          playerTime.textContent = `${formatPlayerTime(previewTime)} / ${formatPlayerTime(duration)}`;
        }
      });

      playerSeek.addEventListener("change", () => {
        const duration = Number(player.duration || 0);
        const value = Number(playerSeek.value || 0);

        if (duration > 0) {
          player.currentTime = (value / 100) * duration;
        }

        isSeeking = false;
        updateTimeUi();
      });
    }

    const onVideoTap = (e) => {
      const target = e.target;
      if (!player) return;

      if (controls && controls.contains(target)) return;
      if (target.closest(".player__top")) return;
      if (target.closest(".player__rotateHint")) return;

      togglePlayerPlayback(player, playPauseBtn);
    };

    if (videoWrap) {
      videoWrap.addEventListener("click", onVideoTap);
    }

    const removeFsBindings = bindFullscreenState(player);
    const removeRotateHintBindings = bindRotateHint();

    if (fsBtn) {
      fsBtn.addEventListener("click", async () => {
        if (isElementFullscreen(modal)) {
          await exitPlayerFullscreen();
        } else {
          await enterPlayerFullscreen(player);
        }
      });
    }

    if (player) {
      player.play().catch(() => {});
      updatePlayPauseUi();
      updateTimeUi();
    }

    return () => {
      try { player?.pause(); } catch (_) {}

      if (videoWrap) {
        videoWrap.removeEventListener("click", onVideoTap);
      }

      player?.removeEventListener("play", onPlay);
      player?.removeEventListener("pause", onPause);
      player?.removeEventListener("loadedmetadata", updateTimeUi);
      player?.removeEventListener("timeupdate", onTimeUpdate);
      player?.removeEventListener("ended", onEnded);

      if (removeFsBindings) removeFsBindings();
      if (removeRotateHintBindings) removeRotateHintBindings();

      setFsUiHidden(false);
    };
  }

  async function openPlayer(index, options = {}) {
    if (!filtered.length) return;

    const preservePlanReturn = options.preservePlanReturn === true;
    returnToPlanAfterClose = preservePlanReturn ? true : false;

    const item = filtered[index];
    if (!item || isPlan(item)) return;

    try { modal._cleanup && modal._cleanup(); } catch (_) {}
    modal._cleanup = null;

    currentIndex = index;
    const video = filtered[currentIndex];
    const src = normalizeUrl(video?.videoUrl || video?.video_url);
    if (!src) return;

    emit("sm:move_opened", {
      item_id: getVideoId(video),
      item_type: "move",
      title: video?.title || ""
    });

    buildVideoPlayer(video);

    window.scrollTo(0, 0);
    setPlayerViewportHeight();
    setModal(true);

    const player = $("playerVideo");
    const closeBtn = $("playerClose");
    const prevBtn = $("prevVideoBtn");
    const nextBtn = $("nextVideoBtn");
    const fsBtn = $("fsBtn");
    const playPauseBtn = $("playPauseBtn");
    const playerSeek = $("playerSeek");
    const playerTime = $("playerTime");
    const videoWrap = player?.closest(".player__videoWrap");
    const controls = $("playerControls");

    const goPrev = () => {
      for (let i = currentIndex - 1; i >= 0; i--) {
        if (!isPlan(filtered[i])) {
          return openPlayer(i, { preservePlanReturn: returnToPlanAfterClose === true });
        }
      }
    };

    const goNext = () => {
      for (let i = currentIndex + 1; i < filtered.length; i++) {
        if (!isPlan(filtered[i])) {
          return openPlayer(i, { preservePlanReturn: returnToPlanAfterClose === true });
        }
      }
    };

    const onBackdrop = () => closeModal();
    modalBackdrop.addEventListener("click", onBackdrop);

    const playerCleanup = bindPlayerUi({
      player,
      playPauseBtn,
      playerSeek,
      playerTime,
      closeBtn,
      prevBtn,
      nextBtn,
      fsBtn,
      videoWrap,
      controls,
      onPrev: goPrev,
      onNext: goNext,
      onClose: closeModal,
      analyticsId: getVideoId(video),
      analyticsTitle: video?.title || ""
    });

    modal._cleanup = () => {
      modalBackdrop.removeEventListener("click", onBackdrop);
      playerCleanup();
    };
  }

  window.addEventListener("sm:open-move-player", (e) => {
    returnToPlanAfterClose = true;

    const move = e.detail?.move;
    if (!move) return;

    const directUrl = normalizeUrl(move?.videoUrl || move?.video_url || "");
    if (!directUrl) return;

    const idx = filtered.findIndex((x) => !isPlan(x) && String(getVideoId(x)) === String(getVideoId(move)));

    if (idx >= 0) {
      openPlayer(idx, { preservePlanReturn: true });
      return;
    }

    try { modal._cleanup && modal._cleanup(); } catch (_) {}
    modal._cleanup = null;

    emit("sm:move_opened", {
      item_id: getVideoId(move),
      item_type: "move",
      title: move?.title || "Move video"
    });

    buildVideoPlayer({
      id: move?.id || directUrl,
      title: move?.title || "Move video",
      videoUrl: directUrl,
      video_url: directUrl,
      thumb: move?.thumb || FALLBACK_THUMB,
      duration: move?.duration || ""
    });

    window.scrollTo(0, 0);
    setPlayerViewportHeight();
    setModal(true);

    const player = $("playerVideo");
    const closeBtn = $("playerClose");
    const prevBtn = $("prevVideoBtn");
    const nextBtn = $("nextVideoBtn");
    const fsBtn = $("fsBtn");
    const playPauseBtn = $("playPauseBtn");
    const playerSeek = $("playerSeek");
    const playerTime = $("playerTime");
    const videoWrap = player?.closest(".player__videoWrap");
    const controls = $("playerControls");

    if (prevBtn) prevBtn.style.display = "none";
    if (nextBtn) nextBtn.style.display = "none";

    const onBackdrop = () => closeModal();
    modalBackdrop.addEventListener("click", onBackdrop);

    const playerCleanup = bindPlayerUi({
      player,
      playPauseBtn,
      playerSeek,
      playerTime,
      closeBtn,
      prevBtn,
      nextBtn,
      fsBtn,
      videoWrap,
      controls,
      onPrev: null,
      onNext: null,
      onClose: closeModal,
      analyticsId: getVideoId(move),
      analyticsTitle: move?.title || "Move video"
    });

    modal._cleanup = () => {
      modalBackdrop.removeEventListener("click", onBackdrop);
      playerCleanup();
    };
  });

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
      emit("sm:plan_opened", {
        item_id: item?.id || "",
        item_type: "plan",
        title: item?.title || ""
      });

      window.dispatchEvent(new CustomEvent("sm:open-plan", {
        detail: {
          plan: item,
          allItems
        }
      }));

      return;
    }

    openPlayer(idx);
  });

  async function loadItems() {
    try {
      safeText(matchCount, "Loading…");
      isInitialLoading = true;
      showSkeletons(8);
      updateFilterUi();

      const res = await fetch(CDN_INDEX_URL, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);

      const json = await res.json();
      const items = Array.isArray(json) ? json : [];

      const plans = items.filter(isPlan);
      const moves = items.filter((x) => !isPlan(x));

      allItems = [...plans, ...moves];
      isInitialLoading = false;

      applyFilters();

      setTimeout(() => {
        shakeFiltersButton();
      }, 700);

    } catch (e) {
      console.error("[SM] loadVideos error:", e);

      isInitialLoading = false;
      safeText(matchCount, "—");

      grid.innerHTML = `<div class="card" style="padding:14px">Failed to load videos.</div>`;

      if (moreBtn) moreBtn.style.display = "none";
      if (resultsHead) resultsHead.style.display = "none";

      updateFilterUi();
    }
  }

  (async () => {
    if (backBtn) backBtn.disabled = true;

    await addBotTyped("Hi. Let’s browse moves and cinematic plans.");
    await addBotTyped(steps[0].text);

    renderOptions();
    updateFilterUi();

    loadItems();

    setTimeout(() => {
      if (!assistant.classList.contains("active")) {
        shakeFiltersButton();
      }
    }, 4000);

    getMember(12000)
      .then((member) => {
        if (!member?.id) return null;
        return hydrateSavedCache();
      })
      .then(() => {
        renderResults();
      })
      .catch(() => null);
  })();
})();
