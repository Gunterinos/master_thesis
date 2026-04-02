from pathlib import Path
import csv

from flask import Flask, abort, jsonify, render_template
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


if __name__ == "__main__":
    app.run(debug=True)
