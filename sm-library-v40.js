(() => {
  "use strict";
  if (window.__SM_LIBRARY_V1_CLEAN_V41__) return;
  window.__SM_LIBRARY_V1_CLEAN_V41__ = true;

  const CDN_INDEX_URL = "https://skymotion-cdn.b-cdn.net/videos_index.json";
  const API_BASE = String(window.SM_API_BASE || "https://skymotion.onrender.com").replace(/\/$/, "");

  const $ = (id) => document.getElementById(id);
  const scope = $("sm-library-scope");
  if (!scope) return;

  // ---------------- DOM ----------------
  const pill = $("sm-sessionpill");
  const smBackBtn = $("smBackBtn");
  const smToggleBtn = $("smToggleBtn");
  const smCamReady = $("smCamReady");
  const smISO = $("smISO");
  const smND = $("smND");
  const smPicked = $("smPicked");
  const smSavedCount = $("smSavedCount");

  const assistant = scope.querySelector(".assistant");
  const openAssistantBtn = $("openAssistantBtn");
  const closeAssistantBtn = $("closeAssistantBtn");
  const assistantBackdropEl = $("assistantBackdrop");

  const doneBtn = $("doneBtn");
  const endModal = $("smEndModal");
  const endModalBackdrop = $("smEndModalBackdrop");
  const endCancelBtn = $("smEndCancelBtn");
  const endConfirmBtn = $("smEndConfirmBtn");

  const chat = $("chat");
  const grid = $("resultsGrid");
  const matchCount = $("matchCount");
  const resetBtn = $("resetBtn");
  const backBtn = $("backBtn");
  const moreBtn = $("moreBtn");

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

  // ---------------- Session mode ----------------
  function isSessionMode() {
    const q = new URLSearchParams(location.search);
    if (q.get("mode") === "session") return true;
    return document.documentElement.classList.contains("sm-session");
  }
  const SESSION_MODE = isSessionMode();

  // cleanup ?mode=free
  (() => {
    const u = new URL(location.href);
    if (u.searchParams.get("mode") === "free") {
      u.searchParams.delete("mode");
      history.replaceState(null, "", u.pathname + (u.searchParams.toString() ? "?" + u.searchParams.toString() : ""));
    }
  })();

  scope.setAttribute("data-session", SESSION_MODE ? "1" : "0");

  function getSess() {
    return new URLSearchParams(location.search).get("sess");
  }

  function buildUrl(path) {
    if (!SESSION_MODE) return path;
    const u = new URL(path, location.origin);
    u.searchParams.set("mode", "session");
    const sess = getSess();
    if (sess) u.searchParams.set("sess", sess);
    return u.pathname + "?" + u.searchParams.toString();
  }

  const URLS = {
    map:     () => buildUrl("/map"),
    camera:  () => buildUrl("/assistant"),
    library: () => buildUrl("/library"),
    profile: () => buildUrl("/profile"),
  };
  const go = (url) => { window.location.href = url; };

  // remove session-only UI in free mode
  if (!SESSION_MODE) {
    if (pill) pill.remove();
    if (endModal) endModal.remove();
  }

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

  // ---------------- Session cache ----------------
  const sessionCache = { value: null, at: 0 };
  async function fetchSession({ force = false } = {}) {
    const sess = getSess();
    if (!SESSION_MODE || !sess) return null;

    const now = Date.now();
    if (!force && sessionCache.value && (now - sessionCache.at) < 4000) return sessionCache.value;

    try {
      const data = await api(`/v1/sessions/${encodeURIComponent(sess)}`, { method: "GET" });
      const s = data?.session || data || null;
      sessionCache.value = s;
      sessionCache.at = Date.now();
      return s;
    } catch (e) {
      console.warn("[SM] fetchSession failed", e?.status, e?.payload || e);
      return sessionCache.value || null;
    }
  }

  // ---------------- Patch queue (DEEP merge for JSON fields) ----------------
  let patchTimer = null;
  let patchPending = null;
  let patchInFlight = false;

  function isPlainObject(x) {
    return !!x && typeof x === "object" && !Array.isArray(x);
  }
  function mergeClean(obj) {
    const out = {};
    Object.keys(obj || {}).forEach((k) => {
      if (obj[k] !== undefined) out[k] = obj[k];
    });
    return out;
  }

  function deepMergeJsonFields(prev, next) {
    const out = { ...(prev || {}) };

    Object.keys(next || {}).forEach((k) => {
      const v = next[k];

      // deep merge ONLY for known JSON fields that we patch partially
      if ((k === "library_results_json" || k === "assistant_settings_json") && isPlainObject(v) && isPlainObject(out[k])) {
        out[k] = { ...out[k], ...v };
        return;
      }

      out[k] = v;
    });

    return out;
  }

  function queuePatchSession(patch) {
    if (!SESSION_MODE || !getSess()) return;

    const cleaned = mergeClean(patch || {});
    patchPending = deepMergeJsonFields(patchPending, cleaned);

    if (patchTimer) clearTimeout(patchTimer);
    patchTimer = setTimeout(() => flushPatchNow({ keepalive: false }), 250);
  }

  function queuePatchLibrary(partial) {
    if (!partial || typeof partial !== "object") return;
    queuePatchSession({ library_results_json: partial });
  }

  async function flushPatchNow({ keepalive = false } = {}) {
    if (!SESSION_MODE || !getSess()) return;
    if (patchInFlight) return;
    if (!patchPending) return;

    const sess = getSess();
    const body = patchPending;
    patchPending = null;
    if (patchTimer) { clearTimeout(patchTimer); patchTimer = null; }

    patchInFlight = true;
    try {
      await api(`/v1/sessions/${encodeURIComponent(sess)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
        keepalive: !!keepalive,
      });
      await fetchSession({ force: true });
    } catch (e) {
      // якщо фейл — повертаємо назад, щоб не загубити
      patchPending = deepMergeJsonFields(body, patchPending);
      console.warn("[SM] PATCH session failed", e?.status, e?.payload || e);
    } finally {
      patchInFlight = false;
    }
  }

  // Flush on leave/hidden so filtered_count точно долітає
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushPatchNow({ keepalive: true });
  });
  window.addEventListener("pagehide", () => flushPatchNow({ keepalive: true }));
  window.addEventListener("beforeunload", () => flushPatchNow({ keepalive: true }));

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
  const locks = { drawer: false, modal: false, endmodal: false };
  function applyOverflow() {
    const lock = locks.drawer || locks.modal || locks.endmodal;
    document.documentElement.style.overflow = lock ? "hidden" : "";
    document.body.style.overflow = lock ? "hidden" : "";
  }

  // ---------------- Session pill (API only) ----------------
  async function refreshPill() {
    if (!pill) return;
    if (!SESSION_MODE) { pill.style.display = "none"; return; }

    pill.style.display = "block";
    safeText(smSavedCount, String(savedCache.length));

    const s = await fetchSession();
    if (!s) {
      safeText(smCamReady, "—");
      safeText(smISO, "—");
      safeText(smND, "—");
      safeText(smPicked, "None");
      return;
    }

    const assistantJson = s?.assistant_settings_json || null;
    const lib = s?.library_results_json || null;

    safeText(smCamReady, assistantJson ? "Ready" : "Skipped");

    const photo =
      assistantJson?.recommended_settings?.photo_settings ||
      assistantJson?.photo_settings ||
      assistantJson?.photo || {};

    safeText(smISO, photo?.["ISO"] || photo?.iso || "—");
    safeText(smND,  photo?.["ND Filter"] || photo?.nd_filter || "—");
    safeText(smPicked, lib?.selected_video?.title || "None");
  }

  if (smToggleBtn && pill) smToggleBtn.addEventListener("click", () => pill.classList.toggle("expanded"));
  if (smBackBtn) smBackBtn.addEventListener("click", () => { if (SESSION_MODE) go(URLS.camera()); });

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

  // ---------------- End session modal ----------------
  function setEndModal(open) {
    if (!endModal) return;
    endModal.setAttribute("aria-hidden", open ? "false" : "true");
    locks.endmodal = !!open;
    applyOverflow();
  }

  if (endCancelBtn) endCancelBtn.addEventListener("click", () => setEndModal(false));
  if (endModalBackdrop) endModalBackdrop.addEventListener("click", () => setEndModal(false));

  async function endSessionAndGoProfile(filteredCount) {
    const sess = getSess();
    if (!SESSION_MODE || !sess) { go("/profile"); return; }

    // гарантуємо що filtered_count долетить
    if (Number.isFinite(filteredCount)) queuePatchLibrary({ filtered_count: clamp(filteredCount, 0, 999999) });
    await flushPatchNow({ keepalive: true });

    try { await api(`/v1/sessions/${encodeURIComponent(sess)}/done`, { method: "POST", keepalive: true }); }
    catch (e) { console.warn("[SM] done failed", e?.status, e?.payload || e); }

    go("/profile");
  }

  if (doneBtn) {
    if (!SESSION_MODE) doneBtn.style.display = "none";
    else doneBtn.addEventListener("click", () => setEndModal(true));
  }

  if (endConfirmBtn && SESSION_MODE) {
    endConfirmBtn.addEventListener("click", async () => {
      setEndModal(false);
      await endSessionAndGoProfile(filtered.length);
    });
  }

  // ESC priority
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (endModal && endModal.getAttribute("aria-hidden") === "false") { setEndModal(false); return; }
    if (modal && modal.getAttribute("aria-hidden") === "false") { closePlayer(); return; }
    if (assistant && assistant.classList.contains("active")) { closeAssistant(); return; }
  });

  // ---------------- Chat / filters / grid ----------------
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
      await sleep(12 + Math.random() * 18);
    }
    await sleep(120);
    if (caretEl) caretEl.remove();
    setBusy(false);
  }

  function clearOptions() { chat.querySelectorAll(".options").forEach((el) => el.remove()); }

  let allVideos = [];
  let filtered = [];
  let visibleCount = 12;

  const steps = [
    { key:"env",     text:"Where are you flying?",            options:["Open area","City / Urban","Forest","Near objects","Tight space"] },
    { key:"risk",    text:"How safe does it feel here?",      options:["Safe & calm","Some risks","No aggressive moves"] },
    { key:"subject", text:"What are you filming?",            options:["Person","Car / Bike","Building","Landscape","Atmosphere"] },
    { key:"pilot",   text:"How confident are you right now?", options:["Playing safe","Normal","Ready to experiment"] },
    { key:"mood",    text:"What vibe do you want?",           options:["Smooth","Epic","Dynamic","Tense","Wow"] },
  ];

  const mapTags = {
    env: { "Open area":"open", "City / Urban":"urban", "Forest":"forest", "Near objects":"near_objects", "Tight space":"tight_space" },
    subject: { "Person":"person", "Car / Bike":"car", "Building":"building", "Landscape":"landscape", "Atmosphere":"atmosphere" },
    risk: { "Safe & calm":"calm", "Some risks":"some_risks", "No aggressive moves":"no_aggressive" },
    pilot: { "Playing safe":"safe", "Normal":"normal", "Ready to experiment":"experiment" },
    mood: { "Smooth":"smooth", "Epic":"epic", "Dynamic":"dynamic", "Tense":"tense", "Wow":"wow" }
  };

  function hasTag(arr, tag) {
    if (!tag) return true;
    const a = Array.isArray(arr) ? arr : [];
    return a.includes(tag);
  }

  const state = {};
  let stepIndex = 0;

  function filterVideos(videos) {
    const picked = {
      env: mapTags.env[state.env],
      subject: mapTags.subject[state.subject],
      risk: mapTags.risk[state.risk],
      pilot: mapTags.pilot[state.pilot],
      mood: mapTags.mood[state.mood],
    };

    return videos.filter((v) => {
      if (picked.env && !hasTag(v.env, picked.env)) return false;
      if (picked.subject && !hasTag(v.subject, picked.subject)) return false;
      if (picked.risk && !hasTag(v.risk, picked.risk)) return false;
      if (picked.mood && !hasTag(v.mood, picked.mood)) return false;

      if (picked.pilot) {
        if (!hasTag(v.pilot, picked.pilot)) return false;
        if (picked.pilot === "safe" && hasTag(v.risk, "some_risks")) return false;
      }
      return true;
    });
  }

  function applyFilters() {
    filtered = filterVideos(allVideos);
    safeText(matchCount, String(filtered.length));
    visibleCount = 12;
    renderResults();

    // ВАЖЛИВО: це тепер не затирається іншими патчами
    if (SESSION_MODE) queuePatchLibrary({ filtered_count: filtered.length });
  }

  function bookmarkSvg() {
    return `<svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.5 3.5h11c.83 0 1.5.67 1.5 1.5v16.1c0 .78-.86 1.26-1.53.86L12 19.35 6.53 21.96C5.86 22.26 5 21.78 5 21.1V5c0-.83.67-1.5 1.5-1.5z"></path>
    </svg>`;
  }

  function renderResults() {
    grid.innerHTML = "";

    const slice = filtered.slice(0, visibleCount);
    if (slice.length === 0) {
      grid.innerHTML = `<div class="card" style="padding:14px">No videos match these answers. Try Reset.</div>`;
      if (moreBtn) moreBtn.style.display = "none";
      refreshPill();
      return;
    }

    slice.forEach((v, i) => {
      const id = getVideoId(v);
      const saved = isSaved(id);

      const card = document.createElement("div");
      card.className = "card";
      card.dataset.index = String(i);
      card.dataset.videoId = String(id);

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
      grid.appendChild(card);
    });

    if (moreBtn) moreBtn.style.display = filtered.length > visibleCount ? "block" : "none";
    refreshPill();
  }

  if (moreBtn) moreBtn.addEventListener("click", () => { visibleCount += 12; renderResults(); });

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

  // ---------------- Fullscreen modal + opened_videos tracking ----------------
  let currentIndex = -1;
  const openedSet = new Set(); // in-memory canonical
  let openedSeeded = false;

  function setModal(open) {
    modal.setAttribute("aria-hidden", open ? "false" : "true");
    locks.modal = !!open;
    applyOverflow();
  }

  function closePlayer() {
    try { modal._cleanup && modal._cleanup(); } catch (e) {}
    setModal(false);
    modalContent.innerHTML = "";
  }

  async function seedOpenedFromSession() {
    if (openedSeeded) return;
    openedSeeded = true;
    const s = await fetchSession();
    const arr = s?.library_results_json?.opened_videos;
    if (Array.isArray(arr)) arr.forEach((x) => openedSet.add(String(x)));
  }

  async function trackOpened(video) {
    const sess = getSess();
    if (!SESSION_MODE || !sess) return;

    const id = String(getVideoId(video) || "").trim();
    if (!id) return;

    await seedOpenedFromSession();
    if (openedSet.has(id)) return;

    openedSet.add(id);
    // PATCH list; backend merge збереже
    queuePatchLibrary({ opened_videos: Array.from(openedSet) });
  }

  async function savePickedVideo(video) {
    const sess = getSess();
    if (!SESSION_MODE || !sess) return;

    const selected = {
      title: video?.title || "",
      videoUrl: video?.videoUrl || video?.video_url || "",
      thumb: video?.thumb || "",
      duration: video?.duration || "",
      picked_at: new Date().toISOString(),
    };

    // library_results_json deep-merge → filtered_count НЕ зітреться
    queuePatchSession({
      library_results_json: { selected_video: selected },
      cover_image_url: selected.thumb || null,
    });

    refreshPill();
  }

  function buildPlayer(video) {
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

    if (modal._cleanup) modal._cleanup();
    currentIndex = index;

    const video = filtered[currentIndex];
    if (!video || !video.videoUrl) return;

    // track opened & picked (не блокує UI)
    trackOpened(video);
    savePickedVideo(video);

    buildPlayer(video);
    setModal(true);

    const player = $("playerVideo");
    const closeBtn = $("playerClose");
    const prevBtn = $("prevVideoBtn");
    const nextBtn = $("nextVideoBtn");
    const back10 = $("skipBackBtn");
    const fwd10 = $("skipFwdBtn");
    const fsBtn = $("fsBtn");
    const saveMoveBtn = $("saveMoveBtn");

    const goPrev = () => { if (currentIndex > 0) openPlayer(currentIndex - 1); };
    const goNext = () => { if (currentIndex + 1 < filtered.length) openPlayer(currentIndex + 1); };
    const onEsc = (e) => { if (e.key === "Escape") closePlayer(); };

    if (closeBtn) closeBtn.addEventListener("click", closePlayer);
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
        refreshPill();
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
    modalBackdrop.addEventListener("click", closePlayer, { once: true });

    player && player.play().catch(() => {});
    modal._cleanup = () => {
      window.removeEventListener("keydown", onEsc);
      try { player && player.pause(); } catch (e) {}
    };
  }

  // Grid click handler
  grid.addEventListener("click", async (e) => {
    const saveBtn = e.target.closest(".sm-save");
    if (saveBtn) {
      e.preventDefault();
      e.stopPropagation();

      const card = e.target.closest(".card");
      if (!card) return;

      const idx = Number(card.dataset.index || "-1");
      if (!Number.isFinite(idx) || idx < 0) return;

      const video = filtered[idx];
      if (!video) return;

      const nowSaved = await toggleSaved(video);
      saveBtn.classList.toggle("isSaved", nowSaved);
      saveBtn.setAttribute("aria-label", nowSaved ? "Unsave" : "Save");

      refreshPill();
      return;
    }

    const card = e.target.closest(".card");
    if (!card) return;

    const idx = Number(card.dataset.index || "-1");
    if (!Number.isFinite(idx) || idx < 0) return;

    openPlayer(idx);
  });

  // ---------------- Chat options ----------------
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
          await addBotTyped("Done. Pick a move from the results and watch it fullscreen.");
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

    await addBotTyped("Hi. Let’s pick the best moves for your scene.");
    await addBotTyped(steps[0].text);

    if (allVideos.length) applyFilters();
    renderOptions();
  });

  // ---------------- Load videos ----------------
  async function loadVideos() {
    try {
      safeText(matchCount, "Loading…");
      const res = await fetch(CDN_INDEX_URL, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const json = await res.json();
      allVideos = Array.isArray(json) ? json : [];
      applyFilters();
    } catch (e) {
      console.error("[SM] loadVideos error:", e);
      safeText(matchCount, "—");
      grid.innerHTML = `<div class="card" style="padding:14px">Failed to load videos.</div>`;
      if (moreBtn) moreBtn.style.display = "none";
    }
  }

  // ---------------- INIT ----------------
  (async () => {
    if (backBtn) backBtn.disabled = true;

    await getMember(12000).catch(() => null);

    await hydrateSavedCache();
    await fetchSession({ force: true }); // primes cache
    await seedOpenedFromSession();
    refreshPill();

    await addBotTyped("Hi. Let’s pick the best moves for your scene.");
    await addBotTyped(steps[0].text);
    renderOptions();

    await loadVideos();
    renderResults();
  })();
})();
