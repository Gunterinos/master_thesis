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


def load_portfolio_data() -> list[dict[str, str]]:
    with CSV_PATH.open(mode="r", newline="", encoding="utf-8") as csv_file:
        reader = csv.DictReader(csv_file)
        return list(reader)


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/portfolio-data")
def portfolio_data():
    return jsonify(load_portfolio_data())


if __name__ == "__main__":
    app.run(debug=True)
