<script>
(() => {
  const chat = document.getElementById("chat");
  const grid = document.getElementById("resultsGrid");
  const matchCount = document.getElementById("matchCount");
  const moreBtn = document.getElementById("moreBtn");
  const resultsHead = document.getElementById("resultsHead");

  console.log("[SM TEST] start", {
    chat: !!chat,
    grid: !!grid,
    matchCount: !!matchCount,
    moreBtn: !!moreBtn,
    resultsHead: !!resultsHead
  });

  if (!chat || !grid || !matchCount || !moreBtn || !resultsHead) {
    console.warn("[SM TEST] missing dom");
    return;
  }

  chat.innerHTML = `
    <div class="msg msg--bot">
      <div class="avatar"></div>
      <div class="bubble">
        <span class="text">Test message. Library UI is alive.</span>
      </div>
    </div>
    <div class="options">
      <button class="opt" type="button">Open area</button>
      <button class="opt" type="button">City / Urban</button>
      <button class="opt" type="button">Forest</button>
    </div>
  `;

  matchCount.textContent = "2";
  resultsHead.style.display = "none";
  moreBtn.style.display = "none";

  grid.innerHTML = `
    <div class="card">
      <div class="thumb">
        <img src="https://skymotion-cdn.b-cdn.net/thumb.jpg" alt="thumb">
      </div>
      <div class="meta">
        <div class="title">Test move</div>
        <span class="badge">0:12</span>
      </div>
    </div>

    <div class="cardPlan">
      <div class="planMedia">
        <img class="planImg" src="https://skymotion-cdn.b-cdn.net/thumb.jpg" alt="plan">
        <div class="planPills">
          <span class="pill pill--plan"><span class="pillDot"></span>Plan</span>
          <span class="pill">0:24</span>
          <span class="pill">4 shots</span>
        </div>
      </div>
      <div class="planCaption">Cinematic Plan</div>
      <div class="planBubble">
        <h3 class="planName">Test plan</h3>
        <div class="planDesc">If you can see this, HTML/CSS are fine.</div>
      </div>
    </div>
  `;

  console.log("[SM TEST] rendered");
})();
</script>
