"""
Coupon Card Benefits App
Calculates which credit card gives you the best rewards for a purchase.

PRIVACY NOTE: This app never stores card numbers, CVV codes, or expiration dates.
Only card nicknames, optional last-4 digits (for identification), and reward rates
are stored. data/cards.json is gitignored by default.
"""

import json
import uuid
from pathlib import Path
from flask import Flask, jsonify, request, render_template, abort

app = Flask(__name__)

DATA_DIR = Path(__file__).parent / "data"
CARDS_FILE = DATA_DIR / "cards.json"
LIBRARY_FILE = Path(__file__).parent / "card_library.json"

CATEGORIES = [
    "dining",
    "grocery",
    "gas",
    "travel",
    "online",
    "entertainment",
    "pharmacy",
    "streaming",
    "transit",
    "wholesale",
    "other",
]


def load_cards() -> list[dict]:
    if not CARDS_FILE.exists():
        return []
    with open(CARDS_FILE) as f:
        return json.load(f)


def save_cards(cards: list[dict]) -> None:
    DATA_DIR.mkdir(exist_ok=True)
    with open(CARDS_FILE, "w") as f:
        json.dump(cards, f, indent=2)


def load_library() -> list[dict]:
    if not LIBRARY_FILE.exists():
        return []
    with open(LIBRARY_FILE) as f:
        return json.load(f)


# ── Frontend ──────────────────────────────────────────────────────────────────


@app.route("/")
def index():
    return render_template("index.html", categories=CATEGORIES)


# ── Cards API ─────────────────────────────────────────────────────────────────


@app.route("/api/cards", methods=["GET"])
def get_cards():
    return jsonify(load_cards())


@app.route("/api/cards", methods=["POST"])
def add_card():
    data = request.get_json(silent=True)
    if not data or not data.get("nickname"):
        abort(400, "nickname is required")

    # Reject any attempt to store sensitive data
    forbidden = {"card_number", "cvv", "expiration", "expiry", "full_number"}
    for field in forbidden:
        if field in data:
            abort(400, f"Field '{field}' must not be stored. This app never stores sensitive card data.")

    card = {
        "id": str(uuid.uuid4()),
        "nickname": data["nickname"].strip(),
        "card_name": data.get("card_name", "").strip(),
        "last_four": str(data.get("last_four", "")).strip()[-4:] if data.get("last_four") else "",
        "rewards": _build_rewards(data.get("rewards", {})),
        "annual_fee": float(data.get("annual_fee", 0)),
        "notes": data.get("notes", "").strip(),
    }
    cards = load_cards()
    cards.append(card)
    save_cards(cards)
    return jsonify(card), 201


@app.route("/api/cards/<card_id>", methods=["PUT"])
def update_card(card_id: str):
    data = request.get_json(silent=True)
    if not data:
        abort(400, "Request body required")

    forbidden = {"card_number", "cvv", "expiration", "expiry", "full_number"}
    for field in forbidden:
        if field in data:
            abort(400, f"Field '{field}' must not be stored.")

    cards = load_cards()
    for i, card in enumerate(cards):
        if card["id"] == card_id:
            cards[i] = {
                **card,
                "nickname": data.get("nickname", card["nickname"]).strip(),
                "card_name": data.get("card_name", card.get("card_name", "")).strip(),
                "last_four": str(data.get("last_four", card.get("last_four", ""))).strip()[-4:]
                if data.get("last_four")
                else card.get("last_four", ""),
                "rewards": _build_rewards(data.get("rewards", card["rewards"])),
                "annual_fee": float(data.get("annual_fee", card.get("annual_fee", 0))),
                "notes": data.get("notes", card.get("notes", "")).strip(),
            }
            save_cards(cards)
            return jsonify(cards[i])
    abort(404, "Card not found")


@app.route("/api/cards/<card_id>", methods=["DELETE"])
def delete_card(card_id: str):
    cards = load_cards()
    new_cards = [c for c in cards if c["id"] != card_id]
    if len(new_cards) == len(cards):
        abort(404, "Card not found")
    save_cards(new_cards)
    return jsonify({"deleted": card_id})


# ── Card Library API ──────────────────────────────────────────────────────────


@app.route("/api/card-library", methods=["GET"])
def get_card_library():
    return jsonify(load_library())


@app.route("/api/card-library/import/<library_id>", methods=["POST"])
def import_from_library(library_id: str):
    """Add a card from the built-in library to the user's wallet."""
    library = load_library()
    template = next((c for c in library if c["id"] == library_id), None)
    if not template:
        abort(404, "Card not found in library")

    body = request.get_json(silent=True) or {}
    card = {
        "id": str(uuid.uuid4()),
        "nickname": body.get("nickname", template["name"]).strip(),
        "card_name": template["name"],
        "last_four": str(body.get("last_four", "")).strip()[-4:] if body.get("last_four") else "",
        "rewards": template["rewards"],
        "annual_fee": template.get("annual_fee", 0),
        "notes": template.get("notes", ""),
    }
    cards = load_cards()
    cards.append(card)
    save_cards(cards)
    return jsonify(card), 201


# ── Calculate Best Card ───────────────────────────────────────────────────────


@app.route("/api/calculate", methods=["POST"])
def calculate():
    """Return ranked cards for a given purchase."""
    data = request.get_json(silent=True)
    if not data:
        abort(400, "Request body required")

    try:
        amount = float(data["amount"])
    except (KeyError, ValueError, TypeError):
        abort(400, "amount must be a number")
    if amount <= 0:
        abort(400, "amount must be positive")

    category = data.get("category", "other").lower()
    if category not in CATEGORIES:
        category = "other"

    cards = load_cards()
    if not cards:
        return jsonify({"results": [], "category": category, "amount": amount})

    results = []
    for card in cards:
        rewards = card.get("rewards", {})
        rate = rewards.get(category) or rewards.get("other", 1.0)
        cashback = round(amount * rate / 100, 4)
        results.append({
            "id": card["id"],
            "nickname": card["nickname"],
            "card_name": card.get("card_name", ""),
            "last_four": card.get("last_four", ""),
            "category": category,
            "rate": rate,
            "cashback": cashback,
            "annual_fee": card.get("annual_fee", 0),
            "notes": card.get("notes", ""),
        })

    results.sort(key=lambda x: x["cashback"], reverse=True)

    # Show how much more each option earns vs the worst card
    worst = results[-1]["cashback"] if results else 0
    for r in results:
        r["extra_vs_worst"] = round(r["cashback"] - worst, 4)

    return jsonify({"results": results, "category": category, "amount": amount})


# ── Helpers ───────────────────────────────────────────────────────────────────


def _build_rewards(raw: dict) -> dict:
    """Ensure all category keys exist with float values, default 1.0%."""
    rewards = {}
    for cat in CATEGORIES:
        try:
            rewards[cat] = float(raw.get(cat, raw.get("other", 1.0)))
        except (TypeError, ValueError):
            rewards[cat] = 1.0
    return rewards


if __name__ == "__main__":
    DATA_DIR.mkdir(exist_ok=True)
    app.run(debug=True, port=5000)
