from pathlib import Path
import csv

from sklearn.decomposition import PCA
from flask import Flask, abort, jsonify, render_template, request
from jinja2 import TemplateNotFound

app = Flask(
    __name__,
    template_folder="frontend",
    static_folder="frontend",
    static_url_path="/frontend",
)
CSV_PATH = Path(__file__).resolve().parent / "portfolio_data.csv"


def load_portfolio_data():
    with CSV_PATH.open(mode="r", newline="", encoding="utf-8") as csv_file:
        reader = csv.DictReader(csv_file)
        rows = list(reader)

    if not rows:
        return [], {}

    # First row is the direction metadata (1 = max, -1 = min)
    meta_row = rows[0]
    data_rows = rows[1:]

    directions = {}
    for col, val in meta_row.items():
        if val == "1":
            directions[col] = "max"
        elif val == "-1":
            directions[col] = "min"

    return data_rows, directions


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/portfolio-data")
def portfolio_data():
    rows, directions = load_portfolio_data()
    return jsonify({"rows": rows, "directions": directions})


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
