/* Card Benefits Calculator — frontend logic */

const CATEGORIES = window.CATEGORIES || [];

// ── Helpers ───────────────────────────────────────────────────

function fmt(n) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function showToast(msg, ms = 2500) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), ms);
}

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.description || err.error || "Request failed");
  }
  return res.json();
}

// ── Calculate ─────────────────────────────────────────────────

document.getElementById("calc-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const amount = parseFloat(document.getElementById("amount").value);
  const category = document.getElementById("category").value;
  const merchant = document.getElementById("merchant").value.trim();

  const resultsEl = document.getElementById("results");
  resultsEl.classList.add("hidden");
  resultsEl.innerHTML = "";

  try {
    const data = await apiFetch("/api/calculate", {
      method: "POST",
      body: JSON.stringify({ amount, category, merchant }),
    });

    if (!data.results.length) {
      resultsEl.innerHTML = `<p class="empty-state">No cards found. Add some cards below first.</p>`;
      resultsEl.classList.remove("hidden");
      return;
    }

    const merchantStr = merchant ? ` at <em>${merchant}</em>` : "";
    let html = `<h3>Results for $${fmt(amount)} in <strong>${category}</strong>${merchantStr}</h3><div class="result-list">`;

    data.results.forEach((r, i) => {
      const isBest = i === 0;
      const lastFour = r.last_four ? ` •••• ${r.last_four}` : "";
      const extra = r.extra_vs_worst > 0 ? ` (+$${fmt(r.extra_vs_worst)} vs worst)` : "";
      html += `
        <div class="result-item ${isBest ? "best" : ""}">
          <div class="result-rank">${i + 1}</div>
          <div class="result-info">
            <div class="result-name">
              ${r.nickname}${isBest ? '<span class="badge-best">BEST</span>' : ""}
            </div>
            <div class="result-sub">${r.card_name}${lastFour}${extra}</div>
          </div>
          <div class="result-cashback">
            <div class="cashback-amount">$${fmt(r.cashback)}</div>
            <div class="cashback-rate">${r.rate.toFixed(2)}% back</div>
          </div>
        </div>`;
    });

    html += "</div>";
    resultsEl.innerHTML = html;
    resultsEl.classList.remove("hidden");
  } catch (err) {
    showToast("Error: " + err.message);
  }
});

// ── My Cards ──────────────────────────────────────────────────

async function loadCards() {
  const cards = await apiFetch("/api/cards");
  renderCards(cards);
}

function renderCards(cards) {
  const list = document.getElementById("cards-list");
  if (!cards.length) {
    list.innerHTML = `<p class="empty-state">No cards yet. Add one above or import from the library.</p>`;
    return;
  }
  list.innerHTML = cards.map(card => {
    const lastFour = card.last_four ? ` •••• ${card.last_four}` : "";
    const fee = card.annual_fee > 0 ? ` · $${card.annual_fee}/yr` : " · No annual fee";
    const topRates = Object.entries(card.rewards)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, v]) => `${k} ${v}%`)
      .join(", ");
    return `
      <div class="my-card" data-id="${card.id}">
        <div class="my-card-info">
          <div class="my-card-name">${card.nickname}${lastFour}</div>
          <div class="my-card-sub">${card.card_name || "Custom card"}${fee} · Top: ${topRates}</div>
        </div>
        <div class="my-card-actions">
          <button class="btn btn-secondary btn-sm edit-card-btn" data-id="${card.id}">Edit</button>
          <button class="btn btn-danger btn-sm delete-card-btn" data-id="${card.id}">Delete</button>
        </div>
      </div>`;
  }).join("");

  list.querySelectorAll(".edit-card-btn").forEach(btn => {
    btn.addEventListener("click", () => openEditModal(btn.dataset.id, cards));
  });
  list.querySelectorAll(".delete-card-btn").forEach(btn => {
    btn.addEventListener("click", () => deleteCard(btn.dataset.id));
  });
}

async function deleteCard(id) {
  if (!confirm("Remove this card from your wallet?")) return;
  try {
    await apiFetch(`/api/cards/${id}`, { method: "DELETE" });
    showToast("Card removed.");
    loadCards();
  } catch (err) {
    showToast("Error: " + err.message);
  }
}

// ── Card Library ──────────────────────────────────────────────

async function loadLibrary() {
  const library = await apiFetch("/api/card-library");
  const grid = document.getElementById("library-list");
  grid.innerHTML = library.map(c => {
    const fee = c.annual_fee > 0 ? `$${c.annual_fee}/yr` : "No annual fee";
    return `
      <div class="library-card">
        <div class="library-card-name">${c.name}</div>
        <div class="library-card-fee">${fee}</div>
        <div class="library-card-notes">${c.notes || ""}</div>
        <div class="library-card-actions">
          <button class="btn btn-secondary btn-sm import-btn" data-id="${c.id}">+ Add to Wallet</button>
        </div>
      </div>`;
  }).join("");

  grid.querySelectorAll(".import-btn").forEach(btn => {
    btn.addEventListener("click", () => importCard(btn.dataset.id, library));
  });
}

async function importCard(libraryId, library) {
  const template = library.find(c => c.id === libraryId);
  if (!template) return;

  const nickname = prompt(`Nickname for "${template.name}" (leave blank to use card name):`);
  if (nickname === null) return; // user cancelled

  const lastFour = prompt("Last 4 digits (optional, for your reference only — press Enter to skip):");
  if (lastFour === null) return;

  try {
    await apiFetch(`/api/card-library/import/${libraryId}`, {
      method: "POST",
      body: JSON.stringify({
        nickname: nickname.trim() || template.name,
        last_four: lastFour.trim(),
      }),
    });
    showToast(`"${nickname.trim() || template.name}" added to your wallet!`);
    loadCards();
  } catch (err) {
    showToast("Error: " + err.message);
  }
}

// ── Modal ─────────────────────────────────────────────────────

function buildRewardsGrid(rewards = {}) {
  const grid = document.getElementById("rewards-grid");
  grid.innerHTML = CATEGORIES.map(cat => {
    const val = rewards[cat] ?? 1.0;
    return `
      <div class="reward-field form-row">
        <label for="r-${cat}">${cat.charAt(0).toUpperCase() + cat.slice(1)}</label>
        <input type="number" id="r-${cat}" name="${cat}" min="0" max="100" step="0.01" value="${val}" />
      </div>`;
  }).join("");
}

function getRewardsFromForm() {
  const rewards = {};
  CATEGORIES.forEach(cat => {
    const el = document.getElementById(`r-${cat}`);
    rewards[cat] = el ? parseFloat(el.value) || 1.0 : 1.0;
  });
  return rewards;
}

function openAddModal() {
  document.getElementById("modal-title").textContent = "Add Card";
  document.getElementById("edit-id").value = "";
  document.getElementById("card-nickname").value = "";
  document.getElementById("card-name").value = "";
  document.getElementById("card-last-four").value = "";
  document.getElementById("card-annual-fee").value = "0";
  document.getElementById("card-notes").value = "";
  buildRewardsGrid();
  document.getElementById("card-modal").classList.remove("hidden");
}

function openEditModal(id, cards) {
  const card = cards.find(c => c.id === id);
  if (!card) return;
  document.getElementById("modal-title").textContent = "Edit Card";
  document.getElementById("edit-id").value = card.id;
  document.getElementById("card-nickname").value = card.nickname;
  document.getElementById("card-name").value = card.card_name || "";
  document.getElementById("card-last-four").value = card.last_four || "";
  document.getElementById("card-annual-fee").value = card.annual_fee || 0;
  document.getElementById("card-notes").value = card.notes || "";
  buildRewardsGrid(card.rewards);
  document.getElementById("card-modal").classList.remove("hidden");
}

function closeModal() {
  document.getElementById("card-modal").classList.add("hidden");
}

document.getElementById("add-card-btn").addEventListener("click", openAddModal);
document.getElementById("modal-cancel").addEventListener("click", closeModal);
document.getElementById("modal-overlay").addEventListener("click", closeModal);

document.getElementById("card-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("edit-id").value;
  const payload = {
    nickname: document.getElementById("card-nickname").value.trim(),
    card_name: document.getElementById("card-name").value.trim(),
    last_four: document.getElementById("card-last-four").value.trim(),
    annual_fee: parseFloat(document.getElementById("card-annual-fee").value) || 0,
    notes: document.getElementById("card-notes").value.trim(),
    rewards: getRewardsFromForm(),
  };

  try {
    if (id) {
      await apiFetch(`/api/cards/${id}`, { method: "PUT", body: JSON.stringify(payload) });
      showToast("Card updated.");
    } else {
      await apiFetch("/api/cards", { method: "POST", body: JSON.stringify(payload) });
      showToast("Card added.");
    }
    closeModal();
    loadCards();
  } catch (err) {
    showToast("Error: " + err.message);
  }
});

// ── Init ──────────────────────────────────────────────────────
loadCards();
loadLibrary();
