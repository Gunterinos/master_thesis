from pathlib import Path
import base64
import csv
import json
import os
import re
import smtplib
import threading
import urllib.error
import urllib.request
import uuid
from datetime import datetime
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from sklearn.decomposition import PCA
from flask import Flask, jsonify, render_template, request
from jinja2 import TemplateNotFound

_BASE = Path(__file__).resolve().parent
_DIST = _BASE / "frontend" / "dist"
_has_dist = _DIST.is_dir()

app = Flask(
    __name__,
    template_folder="frontend/dist" if _has_dist else "frontend",
    static_folder="frontend/dist" if _has_dist else "frontend",
    static_url_path="" if _has_dist else "/frontend",
)
DATA_DIR = Path(__file__).resolve().parent / "data"
BENCHMARK_PATH = DATA_DIR / "benchmark.csv"
SURVEY_DATA_DIR = Path(__file__).resolve().parent / "survey_data"

_SAFE_NAME_RE = re.compile(r'^[\w\-]+$')
_SAFE_FILE_RE = re.compile(r'^[\w\-.]+$')


def _safe_name(value: str) -> str | None:
    v = (value or "").strip()
    return v if v and _SAFE_NAME_RE.match(v) else None


def _safe_filename(value: str) -> str | None:
    v = (value or "").strip()
    return v if v and _SAFE_FILE_RE.match(v) else None


def _resolve_setup_dir(setup: str | None = None) -> Path:
    s = setup or os.environ.get("SURVEY_SETUP", "").strip()
    if s:
        return SURVEY_DATA_DIR / "setups" / s
    return SURVEY_DATA_DIR / "current_setup"


def _resolve_questions_path(setup: str | None = None, filename: str | None = None) -> Path:
    d = _resolve_setup_dir(setup)
    fn = filename or os.environ.get("SURVEY_QUESTIONS_FILE", "questions_config.json").strip()
    return d / fn


def _send_response_email(session_id: str, payload: dict, setup_name: str = "") -> None:
    host = os.environ.get("SMTP_HOST", "")
    port_str = os.environ.get("SMTP_PORT", "587")
    user = os.environ.get("SMTP_USER", "")
    password = os.environ.get("SMTP_PASSWORD", "")
    notify = os.environ.get("NOTIFY_EMAIL", "")

    if not all([host, user, password, notify]):
        return

    try:
        port = int(port_str)
        setup_name = setup_name or os.environ.get("SURVEY_SETUP", "default")

        msg = MIMEMultipart()
        msg["From"] = user
        msg["To"] = notify
        msg["Subject"] = f"[Survey] New response – {setup_name} – {session_id}"

        body = (
            f"A new survey response has been submitted.\n\n"
            f"Setup:      {setup_name}\n"
            f"Session ID: {session_id}\n"
            f"Time:       {datetime.utcnow().isoformat()} UTC\n"
        )
        msg.attach(MIMEText(body, "plain"))

        attachment = MIMEApplication(json.dumps(payload, indent=2).encode("utf-8"), Name=f"responses_{session_id}.json")
        attachment["Content-Disposition"] = f'attachment; filename="responses_{session_id}.json"'
        msg.attach(attachment)

        with smtplib.SMTP(host, port, timeout=15) as smtp:
            smtp.starttls()
            smtp.login(user, password)
            smtp.sendmail(user, notify, msg.as_string())
    except Exception:  # never let email failure break the response save
        pass


def _is_numeric(val):
    try:
        float(val)
        return True
    except (ValueError, TypeError):
        return False


def _is_constraint_val(val):
    return bool(re.match(r'^[<>]=?\d', val.strip())) if val else False


def _spearman(x, y):
    n = len(x)
    if n == 0:
        return 0.0

    def _rank(vals):
        order = sorted(range(n), key=lambda i: vals[i])
        ranks = [0.0] * n
        i = 0
        while i < n:
            j = i
            while j < n and vals[order[j]] == vals[order[i]]:
                j += 1
            avg = (i + j + 1) / 2.0
            for k in range(i, j):
                ranks[order[k]] = avg
            i = j
        return ranks

    rx, ry = _rank(x), _rank(y)
    mx, my = sum(rx) / n, sum(ry) / n
    cov = sum((rx[i] - mx) * (ry[i] - my) for i in range(n)) / n
    sx = (sum((v - mx) ** 2 for v in rx) / n) ** 0.5
    sy = (sum((v - my) ** 2 for v in ry) / n) ** 0.5
    if sx == 0 or sy == 0:
        return 0.0
    return cov / (sx * sy)


def load_csv(path):
    with path.open(mode="r", newline="", encoding="utf-8") as csv_file:
        reader = csv.DictReader(csv_file)
        rows = list(reader)

    if not rows:
        return [], {}, {}, {}

    # Inspect up to 4 metadata rows and identify each by content.
    # Stops as soon as a numeric data row is encountered.
    # Row roles (any order, any subset may be absent):
    #   constraints : has at least one </>= value
    #   directions  : all non-empty values are '1' or '-1'
    #   groups      : non-numeric strings in dec_ columns
    #   measures    : non-numeric strings in obj_ columns (units/scale labels)
    constraints = {}
    directions = {}
    groups = {}
    measures = {}
    data_start = 0

    for i, row in enumerate(rows[:4]):
        non_empty = {k: v for k, v in row.items() if v}
        vals = list(non_empty.values())

        if not vals:
            data_start = i + 1
        elif any(_is_constraint_val(v) for v in vals):
            constraints = non_empty
            data_start = i + 1
        elif all(v in ('1', '-1') for v in vals):
            for col, val in row.items():
                if val == '1':
                    directions[col] = 'max'
                elif val == '-1':
                    directions[col] = 'min'
            data_start = i + 1
        elif any(not _is_numeric(v) and not _is_constraint_val(v) for v in vals):
            obj_keys = {k for k in non_empty if k.startswith('obj_')}
            dec_keys = {k for k in non_empty if k.startswith('dec_')}
            if obj_keys and not dec_keys:
                measures = non_empty
            else:
                groups = non_empty
            data_start = i + 1
        else:
            break  # reached a numeric data row

    return rows[data_start:], directions, groups, constraints, measures


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/data-files")
def data_files():
    # Only return files whose obj_/dec_ columns match the benchmark
    bm_rows, _, _, _, _ = load_csv(BENCHMARK_PATH)
    bm_cols = frozenset(
        k for k in (bm_rows[0] if bm_rows else {})
        if k.startswith("obj_") or k.startswith("dec_")
    )

    compatible = []
    file_constraints = {}
    for p in sorted(DATA_DIR.glob("*.csv")):
        if p.name.lower() == "benchmark.csv":
            continue
        rows, _, _, constraints, _ = load_csv(p)
        if rows:
            file_cols = frozenset(
                k for k in rows[0]
                if k.startswith("obj_") or k.startswith("dec_")
            )
            if file_cols == bm_cols:
                compatible.append(p.name)
                if constraints:
                    file_constraints[p.name] = constraints

    return jsonify({"files": compatible, "fileConstraints": file_constraints})


@app.post("/api/load-data")
def load_data():
    body = request.get_json(force=True)
    filenames = body.get("files", [])
    benchmark_file = body.get("benchmark")

    bm_path = _resolve_data_file(benchmark_file) if benchmark_file else BENCHMARK_PATH
    bm_rows, _, _, _, _ = load_csv(bm_path)
    benchmark_row = bm_rows[0]

    all_frontier_rows = []
    directions = {}
    groups = {}
    measures = {}
    file_constraints_map = {}

    for fname in filenames:
        path = _resolve_data_file(fname)

        rows, file_directions, file_groups, file_constraints, file_measures = load_csv(path)

        if not all_frontier_rows:
            directions = file_directions
            groups = file_groups
            measures = file_measures

        if file_constraints:
            file_constraints_map[fname] = file_constraints

        frontier_name = _frontier_display_name(fname)
        all_frontier_rows.extend({**r, "__frontier": frontier_name} for r in rows)

    benchmark_row = {**benchmark_row, "__frontier": "Benchmark"}
    merged = [benchmark_row] + all_frontier_rows
    return jsonify({"rows": merged, "directions": directions, "groups": groups, "measures": measures, "fileConstraints": file_constraints_map})


@app.post("/api/pca")
def pca():
    body = request.get_json(force=True)
    rows = body["rows"]
    columns = body["columns"]

    X = [[float(row[col]) for col in columns] for row in rows]

    pca = PCA(n_components=2)
    scores = pca.fit_transform(X)
    v1, v2 = pca.components_[0], pca.components_[1]

    projected_rows = [
        {**row, "__pc1": float(scores[i, 0]), "__pc2": float(scores[i, 1])}
        for i, row in enumerate(rows)
    ]

    def label(prefix, v):
        import re
        def fmt_col(col):
            return re.sub(r'^(obj|dec)_', '', col, flags=re.IGNORECASE).replace('_', ' ')
        terms = " + ".join(f"{c:.2f}·{fmt_col(col)}" for c, col in zip(v, columns))
        terms = terms.replace("+ -", "− ")
        return f"{prefix}: {terms}"

    return jsonify({
        "rows": projected_rows,
        "pc1Label": label("PC1", v1),
        "pc2Label": label("PC2", v2),
    })


@app.get("/api/intro-config")
def intro_config():
    setup = _safe_name(request.args.get("setup", ""))
    with (_resolve_setup_dir(setup) / "intro_config.json").open(encoding="utf-8-sig") as f:
        config = json.load(f)
    return jsonify(config)


@app.get("/api/tutorial-config")
def tutorial_config():
    setup = _safe_name(request.args.get("setup", ""))
    with (_resolve_setup_dir(setup) / "tutorial_config.json").open(encoding="utf-8-sig") as f:
        config = json.load(f)
    return jsonify(config)


@app.get("/api/questions-config")
def questions_config():
    setup = _safe_name(request.args.get("setup", ""))
    file_param = _safe_filename(request.args.get("file", ""))
    with _resolve_questions_path(setup, file_param).open(encoding="utf-8-sig") as f:
        config = json.load(f)
    return jsonify(config)


def _frontier_display_name(fname):
    return Path(fname).stem.replace("_", " ")


def _resolve_data_file(fname):
    """Resolve a frontier filename to an absolute path.
    Bare filenames (no directory component) resolve to DATA_DIR.
    Relative paths resolve to the project root (directory of app.py).
    """
    p = Path(fname)
    if p.parent == Path("."):
        return (DATA_DIR / p).resolve()
    return (Path(__file__).resolve().parent / p).resolve()


def _group_members(groups, dec_cols):
    """Build {group_name: [col, ...]} preserving column order."""
    result = {}
    for col in dec_cols:
        grp = groups.get(col)
        if grp:
            result.setdefault(grp, []).append(col)
    return result


def _col_value(row, col_or_group, group_members_map):
    """Return float value for a column or a group (sum of members)."""
    if col_or_group in group_members_map:
        return sum(float(row[c]) for c in group_members_map[col_or_group])
    return float(row[col_or_group])


def _load_frontier_rows(frontiers, benchmark=None):
    """Load rows for the given frontier filenames.
    Returns (all_rows, directions, groups) where all_rows excludes the benchmark
    and each row has a '__frontier' key set to the display name of its source file.
    Row order matches /api/load-data: benchmark at index 0, then frontier rows
    in the order given, so the correct __rowIndex for a frontier row at position
    i in all_rows is i + 1.
    """
    all_rows = []
    directions = {}
    groups = {}
    for fname in frontiers:
        path = _resolve_data_file(fname)
        rows, file_directions, file_groups, *_ = load_csv(path)
        if not directions:
            directions = file_directions
        if not groups:
            groups = file_groups
        display = _frontier_display_name(fname)
        for row in rows:
            all_rows.append({**row, "__frontier": display})
    return all_rows, directions, groups


@app.post("/api/compute-answer")
def compute_answer():
    body = request.get_json(force=True)
    spec = body["answerSpec"]
    frontiers = body["frontiers"]
    user_answer = body.get("userAnswer")
    benchmark_file = body.get("benchmark")

    rows, directions, groups = _load_frontier_rows(frontiers, benchmark_file)
    if not rows:
        return jsonify({"error": "No data found"}), 400

    dec_cols = [c for c in rows[0] if c.startswith("dec_")]
    group_members_map = _group_members(groups, dec_cols)

    spec_type = spec["type"]

    # ── Row-selection answers ──────────────────────────────────────────────
    if spec_type == "highest_value":
        col = spec["column"]
        idx = max(range(len(rows)), key=lambda i: _col_value(rows[i], col, group_members_map))
        correct = [idx + 1]
        score = 1.0 if user_answer and any(i in correct for i in user_answer) else 0.0
        return jsonify({"rowIndices": correct, "score": score})

    if spec_type == "lowest_value":
        col = spec["column"]
        idx = min(range(len(rows)), key=lambda i: _col_value(rows[i], col, group_members_map))
        correct = [idx + 1]
        score = 1.0 if user_answer and any(i in correct for i in user_answer) else 0.0
        return jsonify({"rowIndices": correct, "score": score})

    if spec_type == "range":
        col = spec["column"]
        lo = spec.get("min")
        hi = spec.get("max")
        correct = [
            i + 1
            for i, row in enumerate(rows)
            if (lo is None or _col_value(row, col, group_members_map) >= lo)
            and (hi is None or _col_value(row, col, group_members_map) <= hi)
        ]
        correct_set = set(correct)
        if user_answer:
            user_set = set(user_answer)
            intersection = len(correct_set & user_set)
            union = len(correct_set | user_set)
            score = intersection / union if union > 0 else 0.0
        else:
            score = 0.0
        return jsonify({"rowIndices": correct, "score": round(score, 4)})

    if spec_type == "knee_point":
        obj_cols = [c for c in rows[0] if c.startswith("obj_")]
        col_mins = {c: min(float(r[c]) for r in rows) for c in obj_cols}
        col_maxs = {c: max(float(r[c]) for r in rows) for c in obj_cols}

        def norm(row, col):
            lo, hi = col_mins[col], col_maxs[col]
            v = (float(row[col]) - lo) / (hi - lo) if hi != lo else 0.5
            return 1 - v if directions.get(col) == "min" else v

        def dist(row):
            return sum((1 - norm(row, c)) ** 2 for c in obj_cols) ** 0.5

        n = len(rows)
        distances = [dist(rows[i]) for i in range(n)]
        sorted_indices = sorted(range(n), key=lambda i: distances[i])
        # 0-indexed rank: rank 0 = closest = best
        rank_of = {sorted_indices[r]: r for r in range(n)}

        correct = [sorted_indices[0] + 1]

        if user_answer and len(user_answer) > 0:
            user_0 = [i - 1 for i in user_answer if 0 <= i - 1 < n]
            if user_0:
                point_scores = [1.0 - rank_of[i] / (n - 1) if n > 1 else 1.0 for i in user_0]
                score = sum(point_scores) / len(point_scores)
            else:
                score = 0.0
        else:
            score = 0.0
        return jsonify({"rowIndices": correct, "score": round(score, 4)})

    # ── Option answers ─────────────────────────────────────────────────────
    if spec_type == "multiple_choice":
        correct = spec["correctOption"]
        score = 1.0 if user_answer == correct else 0.0
        return jsonify({"option": correct, "score": score})

    if spec_type == "strongest_correlation":
        target_col = spec["targetColumn"]
        candidates = spec["candidateColumns"]
        direction = spec.get("direction", "any")
        target_vals = [_col_value(r, target_col, group_members_map) for r in rows]

        raw_map = {}
        for col in candidates:
            vals = [_col_value(r, col, group_members_map) for r in rows]
            raw_map[col] = _spearman(target_vals, vals)

        if direction == "positive":
            sorted_candidates = sorted(candidates, key=lambda c: raw_map[c], reverse=True)
        elif direction == "negative":
            sorted_candidates = sorted(candidates, key=lambda c: raw_map[c])
        else:
            sorted_candidates = sorted(candidates, key=lambda c: abs(raw_map[c]), reverse=True)

        best_col = sorted_candidates[0]
        n = len(candidates)

        if user_answer and user_answer in raw_map:
            rank = sorted_candidates.index(user_answer)
            score = 1.0 - rank / (n - 1) if n > 1 else 1.0
        else:
            score = 0.0
        return jsonify({"option": best_col, "score": round(score, 4)})

    if spec_type in ("higher_average", "lower_average"):
        col = spec["column"]
        sums, counts = {}, {}
        for row in rows:
            f = row["__frontier"]
            sums[f] = sums.get(f, 0.0) + _col_value(row, col, group_members_map)
            counts[f] = counts.get(f, 0) + 1
        avgs = {f: sums[f] / counts[f] for f in sums}
        winner = max(avgs, key=avgs.get) if spec_type == "higher_average" else min(avgs, key=avgs.get)
        score = 1.0 if user_answer == winner else 0.0
        return jsonify({"option": winner, "score": score})

    if spec_type == "most_distinct_objective":
        frontier_names = list(dict.fromkeys(r["__frontier"] for r in rows))
        if len(frontier_names) < 2:
            return jsonify({"error": "Need at least 2 frontiers"}), 400
        f1, f2 = frontier_names[0], frontier_names[1]
        candidate_cols = spec.get("candidateColumns") or [c for c in rows[0] if c.startswith("obj_")]
        col_mins = {c: min(_col_value(r, c, group_members_map) for r in rows) for c in candidate_cols}
        col_maxs = {c: max(_col_value(r, c, group_members_map) for r in rows) for c in candidate_cols}

        def norm_val(v, col):
            lo, hi = col_mins[col], col_maxs[col]
            return (v - lo) / (hi - lo) if hi != lo else 0.5

        f1_rows = [r for r in rows if r["__frontier"] == f1]
        f2_rows = [r for r in rows if r["__frontier"] == f2]
        distinction = {
            col: abs(
                sum(norm_val(_col_value(r, col, group_members_map), col) for r in f1_rows) / len(f1_rows)
                - sum(norm_val(_col_value(r, col, group_members_map), col) for r in f2_rows) / len(f2_rows)
            )
            for col in candidate_cols
        }
        sorted_cols = sorted(candidate_cols, key=lambda c: distinction[c], reverse=True)
        best_col = sorted_cols[0]
        n_cols = len(candidate_cols)

        if user_answer and user_answer in distinction:
            rank = sorted_cols.index(user_answer)
            score = 1.0 - rank / (n_cols - 1) if n_cols > 1 else 1.0
        else:
            score = 0.0
        return jsonify({"option": best_col, "score": round(score, 4)})

    if spec_type == "best_average":
        frontier_names = list(dict.fromkeys(r["__frontier"] for r in rows))
        if len(frontier_names) < 2:
            return jsonify({"error": "Need at least 2 frontiers"}), 400
        obj_cols = [c for c in rows[0] if c.startswith("obj_")]
        col_mins = {c: min(float(r[c]) for r in rows) for c in obj_cols}
        col_maxs = {c: max(float(r[c]) for r in rows) for c in obj_cols}

        def norm_obj(val, col):
            lo, hi = col_mins[col], col_maxs[col]
            v = (float(val) - lo) / (hi - lo) if hi != lo else 0.5
            return 1 - v if directions.get(col) == "min" else v

        frontier_scores = {}
        for fname in frontier_names:
            f_rows = [r for r in rows if r["__frontier"] == fname]
            frontier_scores[fname] = sum(
                sum(norm_obj(r[c], c) for c in obj_cols) / len(obj_cols)
                for r in f_rows
            ) / len(f_rows)

        winner = max(frontier_scores, key=frontier_scores.get)
        score = 1.0 if user_answer == winner else 0.0
        return jsonify({"option": winner, "score": score})

    return jsonify({"error": f"Unknown answerSpec type: {spec_type}"}), 400


@app.post("/api/save-responses")
def save_responses():
    body = request.get_json(force=True)
    session_id = body.get("sessionId", "unknown")
    raw_setup = body.get("surveySetup") or os.environ.get("SURVEY_SETUP", "default")
    setup_name = _safe_name(str(raw_setup)) or "default"
    responses_dir = SURVEY_DATA_DIR / "responses" / setup_name
    responses_dir.mkdir(parents=True, exist_ok=True)
    out_path = responses_dir / f"responses_{session_id}.json"
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(body, f, indent=2)
    print(f"SURVEY_RESPONSE setup={setup_name} session={session_id} data={json.dumps(body)}", flush=True)
    threading.Thread(target=_send_response_email, args=(session_id, body, setup_name), daemon=True).start()
    return jsonify({"ok": True})


@app.get("/api/responses")
def list_responses():
    result = {}
    responses_root = SURVEY_DATA_DIR / "responses"
    if responses_root.exists():
        for setup_dir in sorted(responses_root.iterdir()):
            if setup_dir.is_dir():
                files = []
                for f in sorted(setup_dir.glob("responses_*.json")):
                    with f.open(encoding="utf-8") as fh:
                        files.append(json.load(fh))
                result[setup_dir.name] = files
    return jsonify(result)


@app.get("/api/test-email")
def test_email():
    host = os.environ.get("SMTP_HOST", "")
    port = os.environ.get("SMTP_PORT", "587")
    user = os.environ.get("SMTP_USER", "")
    password = os.environ.get("SMTP_PASSWORD", "")
    notify = os.environ.get("NOTIFY_EMAIL", "")
    missing = [k for k, v in {"SMTP_HOST": host, "SMTP_PORT": port, "SMTP_USER": user, "SMTP_PASSWORD": password, "NOTIFY_EMAIL": notify}.items() if not v]
    if missing:
        return jsonify({"ok": False, "error": f"Missing env vars: {', '.join(missing)}"}), 500
    try:
        with smtplib.SMTP(host, int(port), timeout=15) as smtp:
            smtp.starttls()
            smtp.login(user, password)
            msg = MIMEMultipart()
            msg["From"] = user
            msg["To"] = notify
            msg["Subject"] = "[Survey] Test email"
            msg.attach(MIMEText("Email config is working correctly.", "plain"))
            smtp.sendmail(user, notify, msg.as_string())
        return jsonify({"ok": True, "message": f"Test email sent to {notify}"})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.get("/<path:path>")
def spa_catchall(path):
    try:
        return render_template("index.html")
    except TemplateNotFound:
        return "Frontend not built. Run: cd frontend && npm run build", 404


if __name__ == "__main__":
    app.run(debug=True)
