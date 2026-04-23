from pathlib import Path
import csv

from sklearn.decomposition import PCA
from flask import Flask, jsonify, render_template, request
from jinja2 import TemplateNotFound

app = Flask(
    __name__,
    template_folder="frontend",
    static_folder="frontend",
    static_url_path="/frontend",
)
DATA_DIR = Path(__file__).resolve().parent / "data"
BENCHMARK_PATH = DATA_DIR / "benchmark.csv"


def _is_numeric(val):
    try:
        float(val)
        return True
    except (ValueError, TypeError):
        return False


def load_csv(path):
    with path.open(mode="r", newline="", encoding="utf-8") as csv_file:
        reader = csv.DictReader(csv_file)
        rows = list(reader)

    if not rows:
        return [], {}, {}

    # Row 0: direction metadata (1=max, -1=min, empty=decision)
    meta_row = rows[0]

    # Row 1: group metadata or first data row (benchmark).
    # Group rows have at least one non-empty, non-numeric value.
    groups = {}
    data_start = 1
    if len(rows) > 1:
        candidate_vals = [v for v in rows[1].values() if v]
        if candidate_vals and any(not _is_numeric(v) for v in candidate_vals):
            groups = {col: val for col, val in rows[1].items() if val}
            data_start = 2

    data_rows = rows[data_start:]

    directions = {}
    for col, val in meta_row.items():
        if val == "1":
            directions[col] = "max"
        elif val == "-1":
            directions[col] = "min"

    return data_rows, directions, groups


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/data-files")
def data_files():
    # Only return files whose obj_/dec_ columns match the benchmark
    bm_rows, _, _ = load_csv(BENCHMARK_PATH)
    bm_cols = frozenset(
        k for k in (bm_rows[0] if bm_rows else {})
        if k.startswith("obj_") or k.startswith("dec_")
    )

    compatible = []
    for p in sorted(DATA_DIR.glob("*.csv")):
        if p.name.lower() == "benchmark.csv":
            continue
        rows, _, _ = load_csv(p)
        if rows:
            file_cols = frozenset(
                k for k in rows[0]
                if k.startswith("obj_") or k.startswith("dec_")
            )
            if file_cols == bm_cols:
                compatible.append(p.name)

    return jsonify({"files": compatible})


@app.post("/api/load-data")
def load_data():
    body = request.get_json(force=True)
    filenames = body.get("files", [])

    bm_rows, _, _ = load_csv(BENCHMARK_PATH)
    benchmark_row = bm_rows[0]

    all_frontier_rows = []
    directions = {}
    groups = {}

    for fname in filenames:
        path = (DATA_DIR / fname).resolve()

        rows, file_directions, file_groups = load_csv(path)

        if not all_frontier_rows:
            directions = file_directions
            groups = file_groups

        all_frontier_rows.extend(rows)

    merged = [benchmark_row] + all_frontier_rows
    return jsonify({"rows": merged, "directions": directions, "groups": groups})


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
        terms = " + ".join(f"{c:.2f}·{col}" for c, col in zip(v, columns))
        terms = terms.replace("+ -", "− ")
        return f"{prefix}: {terms}"

    return jsonify({
        "rows": projected_rows,
        "pc1Label": label("PC1", v1),
        "pc2Label": label("PC2", v2),
    })


if __name__ == "__main__":
    app.run(debug=True)
