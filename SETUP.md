# Setup

This is a Pareto frontier portfolio explorer: a Flask backend serves CSV data and
a Vite + D3 frontend renders linked visualizations of objective space (outputs) and
decision space (inputs). It is meant to be run locally from your own machine.

## Prerequisites

- **Python** 3.10 or newer (the code uses `str | None` type hints)
- **Node.js** 18 or newer (Vite 7 requires it) and npm

Check your versions:

```bash
python --version
node --version
npm --version
```

## 1. Clone the repository

```bash
git clone <your-repo-url>
cd framework
```

## 2. Backend (Python)

Create and activate a virtual environment, then install the dependencies.

macOS / Linux:

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Windows (PowerShell):

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Dependencies: Flask, scikit-learn, numpy.

## 3. Frontend (Node)

```bash
cd frontend
npm install
cd ..
```

## Running the app

There are two ways to run it locally.

### Option A: development mode (two processes)

Use this while editing frontend code, since it gives hot reloading.

1. Start the backend (from the project root):

   ```bash
   python app.py
   ```

   Flask runs on http://127.0.0.1:5000.

2. In a second terminal, start the Vite dev server:

   ```bash
   cd frontend
   npm run dev
   ```

   Open the URL Vite prints (typically http://localhost:5173). The dev server
   proxies all `/api` requests to Flask on port 5000, so both must be running.

### Option B: single process (built frontend)

Use this to run everything from just the backend.

1. Build the frontend once:

   ```bash
   cd frontend
   npm run build
   cd ..
   ```

   This produces `frontend/dist`. When that folder exists, Flask serves the
   built frontend directly.

2. Start the backend:

   ```bash
   python app.py
   ```

   Open http://127.0.0.1:5000. Rebuild the frontend whenever you change frontend
   code.

## Data and survey setups

- `data/benchmark.csv` is the benchmark frontier merged into every load.
- `survey_data/setups/<name>/` holds each named survey setup (CSV frontiers,
  `tutorial_config.json`, questions config).
- `survey_data/current_setup/` is the default setup used when no setup is selected.
- `survey_data/responses/<setup>/` is where submitted responses are written as
  `responses_<sessionId>.json`. Responses are saved to local disk only.

### CSV format

- Row 0: direction metadata (`1` = maximise, `-1` = minimise, blank = decision variable)
- Row 1 (optional): group labels (non-numeric strings)
- Row 2+: data rows
- Columns prefixed `dec_` are decision variables; `obj_` are objectives.

### Optional environment variables

- `SURVEY_SETUP` selects a setup under `survey_data/setups/` (defaults to
  `current_setup`).
- `SURVEY_QUESTIONS_FILE` overrides the questions config filename (defaults to
  `questions_config.json`).

Example:

```bash
SURVEY_SETUP=single_front_portfolio python app.py
```

## Notes

- There are no automated tests.
- The app is intended to be launched locally; there is no hosted deployment
  configuration.
