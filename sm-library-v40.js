(() => {
  "use strict";
  if (window.__SM_LIBRARY_V1_STANDALONE_V1__) return;
  window.__SM_LIBRARY_V1_STANDALONE_V1__ = true;

  const CDN_INDEX_URL = "https://skymotion-cdn.b-cdn.net/videos_index.json";
  const API_BASE = String(window.SM_API_BASE || "https://skymotion.onrender.com").replace(/\/$/, "");

  const $ = (id) => document.getElementById(id);
  const scope = $("sm-library-scope");
  if (!scope) return;

  // ---------------- DOM ----------------
  const assistant = scope.querySelector(".assistant");
  const openAssistantBtn = $("openAssistantBtn");
  const closeAssistantBtn = $("closeAssistantBtn");
  const assistantBackdropEl = $("assistantBackdrop");

  const chat = $("chat");
  const grid = $("resultsGrid");
  const resultsHead = $("resultsHead"); // optional
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
  function getItemId(v) {
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

  async function toggleSaved(item) {
    const id = getItemId(item);

    if (isSaved(id)) {
      try { await api(`/v1/saved-moves/${encodeURIComponent(id)}`, { method: "DELETE" }); }
      catch (e) { console.warn("[SM] unsave failed", e?.status, e?.payload || e); }

      await hydrateSavedCache();
      return false;
    }

    const payload = {
      id,
      title: item?.title || item?.name || "",
      thumb: item?.thumb || item?.cover || item?.thumb_a || "",
      video_url: item?.videoUrl || item?.video_url || "",
      duration: item?.duration || item?.total_duration || "",
      // tags (moves keep these; plans can ignore)
      env: item?.env || [],
      risk: item?.risk || [],
      subject: item?.subject || [],
      pilot: item?.pilot || [],
      mood: item?.mood || [],
      kind: item?.kind || item?.type || (isPlanItem(item) ? "plan" : "move"),
    };

    try { await api(`/v1/saved-moves`, { method: "POST", body: JSON.stringify(payload) }); }
    catch (e) { console.warn("[SM] save failed", e?.status, e?.payload || e); }

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

  // ESC priority
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (modal && modal.getAttribute("aria-hidden") === "false") { closeModal(); return; }
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

  let allItems = [];
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

  function isPlanItem(v) {
    const k = String(v?.kind || v?.type || "").toLowerCase();
    return v?.is_plan === true || k === "plan" || k === "sequence" || k === "cinematic_plan";
  }

  const state = {};
  let stepIndex = 0;

  function filterItems(items) {
    const picked = {
      env: mapTags.env[state.env],
      subject: mapTags.subject[state.subject],
      risk: mapTags.risk[state.risk],
      pilot: mapTags.pilot[state.pilot],
      mood: mapTags.mood[state.mood],
    };

    // rule: BEFORE any filtering => show only moves.
    // AFTER user has answered at least 1 step => allow plans in results too.
    const allowPlans = stepIndex > 0;

    return items.filter((v) => {
      const plan = isPlanItem(v);
      if (plan && !allowPlans) return false;

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
    filtered = filterItems(allItems);
    safeText(matchCount, String(filtered.length));
    visibleCount = 12;
    renderResults();
  }

  function bookmarkSvg() {
    return `<svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.5 3.5h11c.83 0 1.5.67 1.5 1.5v16.1c0 .78-.86 1.26-1.53.86L12 19.35 6.53 21.96C5.86 22.26 5 21.78 5 21.1V5c0-.83.67-1.5 1.5-1.5z"></path>
    </svg>`;
  }

  function renderMoveCard(v, i) {
    const id = getItemId(v);
    const saved = isSaved(id);

    const card = document.createElement("div");
    card.className = "card";
    card.dataset.index = String(i);
    card.dataset.itemKind = "move";
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

  function pickPlanThumbs(plan) {
    // accepted shapes:
    // plan.thumbs: [a,b]
    // plan.shots: [{thumb},{thumb}]
    // plan.thumb_a/thumb_b
    const t = Array.isArray(plan?.thumbs) ? plan.thumbs : null;
    if (t && t[0] && t[1]) return [t[0], t[1]];

    const shots = Array.isArray(plan?.shots) ? plan.shots : [];
    if (shots[0]?.thumb && shots[1]?.thumb) return [shots[0].thumb, shots[1].thumb];

    const a = plan?.thumb_a || plan?.thumbA || plan?.thumb || plan?.cover || "";
    const b = plan?.thumb_b || plan?.thumbB || plan?.thumb2 || a || "";
    return [a, b];
  }

  function renderPlanCard(plan, i) {
    const id = getItemId(plan);
    const saved = isSaved(id);
    const [a, b] = pickPlanThumbs(plan);

    const shotsCount =
      Number(plan?.shots_count) ||
      (Array.isArray(plan?.shots) ? plan.shots.length : 0) ||
      Number(plan?.steps_count) || 0;

    const totalDur = plan?.total_duration || plan?.duration_total || plan?.duration || "";
    const level = plan?.level || plan?.difficulty || plan?.skill || "";

    const card = document.createElement("div");
    card.className = "cardPlan";
    card.dataset.index = String(i);
    card.dataset.itemKind = "plan";
    card.dataset.itemId = String(id);

    card.innerHTML = `
      <button class="sm-save ${saved ? "isSaved" : ""}" type="button"
        aria-label="${saved ? "Unsave" : "Save"}" data-save-id="${escapeHtml(id)}" style="z-index:4;">
        ${bookmarkSvg()}
      </button>

      <div class="planThumbs" aria-hidden="true">
        <div class="planShot planShot--a">
          ${a ? `<img src="${a}" alt="" loading="lazy">` : ``}
          <div class="shotTag">Shot 1</div>
        </div>
        <div class="planShot planShot--b">
          ${b ? `<img src="${b}" alt="" loading="lazy">` : ``}
          <div class="shotTag">Shot 2</div>
        </div>
      </div>

      <div class="planTop">
        <div class="planPills">
          <div class="pill pill--plan"><span class="pillDot"></span>Plan</div>
          ${shotsCount ? `<div class="pill">${escapeHtml(String(shotsCount))} shots</div>` : ``}
        </div>
      </div>

      <div class="planMeta">
        <h3 class="planName">${escapeHtml(plan?.title || plan?.name || "Cinematic plan")}</h3>
        <div class="planStats">
          ${totalDur ? `<div class="stat">⏱ ${escapeHtml(totalDur)}</div>` : ``}
          ${level ? `<div class="stat">⚡ ${escapeHtml(level)}</div>` : ``}
        </div>
        <button class="planCta" type="button" aria-label="Open plan">
          Open plan <span class="planArrow" aria-hidden="true"></span>
        </button>
      </div>
    `;
    return card;
  }

  function renderResults() {
    grid.innerHTML = "";

    const slice = filtered.slice(0, visibleCount);
    if (slice.length === 0) {
      grid.innerHTML = `<div class="card" style="padding:14px">No results match these answers. Try Reset.</div>`;
      if (moreBtn) moreBtn.style.display = "none";
      if (resultsHead) resultsHead.style.display = "none";
      return;
    }

    const hasPlans = slice.some(isPlanItem);
    if (resultsHead) resultsHead.style.display = hasPlans ? "flex" : "none";

    slice.forEach((v, i) => {
      const card = isPlanItem(v) ? renderPlanCard(v, i) : renderMoveCard(v, i);
      grid.appendChild(card);
    });

    if (moreBtn) moreBtn.style.display = filtered.length > visibleCount ? "block" : "none";
  }

  if (moreBtn) moreBtn.addEventListener("click", () => { visibleCount += 12; renderResults(); });

  function syncCardSaveUI(item) {
    const id = getItemId(item);
    const saved = isSaved(id);
    const sel = `.sm-save[data-save-id="${CSS.escape(String(id))}"]`;
    const btn = grid.querySelector(sel);
    if (btn) {
      btn.classList.toggle("isSaved", saved);
      btn.setAttribute("aria-label", saved ? "Unsave" : "Save");
    }
  }

  // ---------------- Modal ----------------
  function setModal(open) {
    modal.setAttribute("aria-hidden", open ? "false" : "true");
    locks.modal = !!open;
    applyOverflow();
  }

  function closeModal() {
    try { modal._cleanup && modal._cleanup(); } catch (e) {}
    setModal(false);
    modalContent.innerHTML = "";
  }

  function buildMovePlayer(video) {
    const id = getItemId(video);
    const saved = isSaved(id);

    modalContent.innerHTML = `
      <div class="player">
        <video id="playerVideo" controls playsinline preload="metadata">
          <source src="${video.videoUrl || video.video_url || ""}" type="video/mp4">
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

  function buildPlanModal(plan) {
    const id = getItemId(plan);
    const saved = isSaved(id);

    const shots = Array.isArray(plan?.shots) ? plan.shots : [];
    const steps = Array.isArray(plan?.steps) ? plan.steps : shots; // alias

    const rows = steps.slice(0, 20).map((s, idx) => {
      const t = s?.title || s?.name || `Shot ${idx + 1}`;
      const d = s?.duration || s?.time || "";
      const th = s?.thumb || s?.cover || "";
      const note = s?.note || s?.desc || s?.description || "";
      return `
        <div style="
          display:flex; gap:12px; align-items:flex-start;
          padding:12px; border-radius:16px;
          border:1px solid rgba(255,255,255,.10);
          background: rgba(255,255,255,.03);
        ">
          <div style="width:64px;height:64px;border-radius:14px;overflow:hidden;flex:0 0 auto;background:#000;">
            ${th ? `<img src="${th}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block;">` : ""}
          </div>
          <div style="min-width:0;flex:1;">
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline;">
              <div style="font-weight:950;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                ${escapeHtml(t)}
              </div>
              <div style="font-size:12px;font-weight:900;color:rgba(255,255,255,.65);white-space:nowrap;">
                ${escapeHtml(d)}
              </div>
            </div>
            ${note ? `<div style="margin-top:6px;font-size:13px;line-height:1.35;color:rgba(255,255,255,.70)">${escapeHtml(note)}</div>` : ``}
          </div>
        </div>
      `;
    }).join("");

    modalContent.innerHTML = `
      <div style="position:absolute;inset:0;overflow:auto;padding:18px 18px 120px;">
        <div style="
          max-width: 980px;
          margin: 0 auto;
          border-radius: 22px;
          border:1px solid rgba(255,255,255,.12);
          background:
            radial-gradient(700px 280px at 15% 0%, rgba(201,154,110,.10), transparent 55%),
            radial-gradient(700px 280px at 95% 0%, rgba(120,59,226,.14), transparent 55%),
            rgba(18,18,18,.92);
          box-shadow: 0 30px 120px rgba(0,0,0,.70);
          overflow:hidden;
        ">
          <div style="padding:16px 16px 10px;border-bottom:1px solid rgba(255,255,255,.08);display:flex;justify-content:space-between;gap:12px;align-items:center;">
            <div style="min-width:0;">
              <div style="font-weight:950;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                ${escapeHtml(plan?.title || plan?.name || "Cinematic plan")}
              </div>
              <div style="margin-top:4px;font-size:12px;font-weight:900;color:rgba(255,255,255,.60);">
                ${escapeHtml(plan?.total_duration || plan?.duration_total || plan?.duration || "")}
                ${plan?.level || plan?.difficulty ? ` • ${escapeHtml(plan?.level || plan?.difficulty)}` : ``}
                ${Array.isArray(steps) && steps.length ? ` • ${escapeHtml(String(steps.length))} shots` : ``}
              </div>
            </div>

            <button class="player__close" id="planClose" type="button" aria-label="Close">×</button>
          </div>

          <div style="padding:14px 16px;">
            ${plan?.description ? `<div style="margin:0 0 12px;font-size:13px;line-height:1.45;color:rgba(255,255,255,.72)">${escapeHtml(plan.description)}</div>` : ``}
            <div style="display:grid;gap:10px;">
              ${rows || `<div style="padding:12px;border-radius:16px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.03);color:rgba(255,255,255,.70)">No plan steps found in index JSON.</div>`}
            </div>
          </div>
        </div>
      </div>

      <div class="player__bar" style="position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:5;">
        <button class="btn" id="savePlanBtn" type="button">${saved ? "Saved" : "Save"}</button>
        <button class="btn" id="closePlanBtn" type="button">Close</button>
      </div>
    `;
  }

  let currentIndex = -1;

  function openMove(index) {
    if (!filtered.length) return;
    currentIndex = index;

    const v = filtered[currentIndex];
    if (!v || !(v.videoUrl || v.video_url)) return;

    if (modal._cleanup) modal._cleanup();

    buildMovePlayer(v);
    setModal(true);

    const player = $("playerVideo");
    const closeBtn = $("playerClose");
    const prevBtn = $("prevVideoBtn");
    const nextBtn = $("nextVideoBtn");
    const back10 = $("skipBackBtn");
    const fwd10 = $("skipFwdBtn");
    const fsBtn = $("fsBtn");
    const saveMoveBtn = $("saveMoveBtn");

    const goPrev = () => { if (currentIndex > 0) openAny(currentIndex - 1, { prefer: "move" }); };
    const goNext = () => { if (currentIndex + 1 < filtered.length) openAny(currentIndex + 1, { prefer: "move" }); };
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
        const nowSaved = await toggleSaved(v);
        saveMoveBtn.textContent = nowSaved ? "Saved" : "Save";
        syncCardSaveUI(v);
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

  function openPlan(index) {
    currentIndex = index;
    const plan = filtered[currentIndex];
    if (!plan) return;

    if (modal._cleanup) modal._cleanup();
    buildPlanModal(plan);
    setModal(true);

    const closeA = $("planClose");
    const closeB = $("closePlanBtn");
    const saveBtn = $("savePlanBtn");

    const onEsc = (e) => { if (e.key === "Escape") closeModal(); };
    if (closeA) closeA.addEventListener("click", closeModal);
    if (closeB) closeB.addEventListener("click", closeModal);
    if (saveBtn) {
      saveBtn.addEventListener("click", async () => {
        const nowSaved = await toggleSaved(plan);
        saveBtn.textContent = nowSaved ? "Saved" : "Save";
        syncCardSaveUI(plan);
      });
    }

    window.addEventListener("keydown", onEsc);
    modalBackdrop.addEventListener("click", closeModal, { once: true });
    modal._cleanup = () => window.removeEventListener("keydown", onEsc);
  }

  function openAny(index, { prefer = "any" } = {}) {
    // prefer can skip plans when navigating Prev/Next inside video player
    const item = filtered[index];
    if (!item) return;

    if (prefer === "move" && isPlanItem(item)) {
      // find nearest move in the same direction
      const dir = index > currentIndex ? 1 : -1;
      let j = index;
      while (j >= 0 && j < filtered.length) {
        if (!isPlanItem(filtered[j]) && (filtered[j].videoUrl || filtered[j].video_url)) {
          return openMove(j);
        }
        j += dir;
      }
      return; // no move found
    }

    if (isPlanItem(item)) return openPlan(index);
    return openMove(index);
  }

  // Grid click handler
  grid.addEventListener("click", async (e) => {
    const saveBtn = e.target.closest(".sm-save");
    if (saveBtn) {
      e.preventDefault();
      e.stopPropagation();

      const card = e.target.closest(".card, .cardPlan");
      if (!card) return;

      const idx = Number(card.dataset.index || "-1");
      if (!Number.isFinite(idx) || idx < 0) return;

      const item = filtered[idx];
      if (!item) return;

      const nowSaved = await toggleSaved(item);
      saveBtn.classList.toggle("isSaved", nowSaved);
      saveBtn.setAttribute("aria-label", nowSaved ? "Unsave" : "Save");
      return;
    }

    const card = e.target.closest(".card, .cardPlan");
    if (!card) return;

    const idx = Number(card.dataset.index || "-1");
    if (!Number.isFinite(idx) || idx < 0) return;

    openAny(idx);
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
          await addBotTyped("Nice. Now you’ll see both single moves and cinematic plans in the results.");
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

    if (allItems.length) applyFilters();
    renderOptions();
  });

  // ---------------- Load index ----------------
  async function loadIndex() {
    try {
      safeText(matchCount, "Loading…");
      const res = await fetch(CDN_INDEX_URL, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const json = await res.json();

      // supports either array or {items:[...]}
      const items = Array.isArray(json) ? json : (Array.isArray(json?.items) ? json.items : []);
      allItems = items || [];

      applyFilters();
    } catch (e) {
      console.error("[SM] loadIndex error:", e);
      safeText(matchCount, "—");
      grid.innerHTML = `<div class="card" style="padding:14px">Failed to load library index.</div>`;
      if (moreBtn) moreBtn.style.display = "none";
      if (resultsHead) resultsHead.style.display = "none";
    }
  }

  // ---------------- INIT ----------------
  (async () => {
    if (backBtn) backBtn.disabled = true;

    // try auth (but don’t block library if not logged in)
    await getMember(4000).catch(() => null);

    // saved moves are optional; if not logged in it will just stay empty
    await hydrateSavedCache().catch(() => null);

    await addBotTyped("Hi. Let’s pick the best moves for your scene.");
    await addBotTyped(steps[0].text);
    renderOptions();

    await loadIndex();
    renderResults();
  })();
})();
