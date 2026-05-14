import { getSelectedRowIndexSet, clearSelectionState } from '../state/appState.js';
import { startTracking, stopTracking, getResult as getTelemetryResult } from './telemetry.js';

let _questions = [];
let _currentIndex = 0;
let _startTime = 0;
let _responses = [];
let _sessionId = '';
let _onComplete = null;
let _availableColumns = { objectives: [], decisions: [], groups: [], groupsMap: {} };
let _dynamicCandidates = null;

function generateSessionId() {
    return crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function formatOptionLabel(val) {
    return val.replace(/^(obj_|dec_)/, '').replace(/_/g, ' ');
}

function buildCandidates(question) {
    const source = question.optionSource;
    const target = question.answerSpec?.targetColumn ?? null;

    let cols = [];
    if (source === 'objectives') {
        cols = _availableColumns.objectives.slice();
    } else if (source === 'decisions') {
        cols = _availableColumns.decisions.slice();
    } else if (source === 'groups') {
        cols = _availableColumns.groups.slice();
    } else if (source.startsWith('group:')) {
        const groupName = source.slice(6);
        cols = _availableColumns.decisions.filter(c => _availableColumns.groupsMap[c] === groupName);
    } else if (source === 'all') {
        cols = [..._availableColumns.objectives, ..._availableColumns.decisions];
    } else {
        return question.options.slice();
    }

    if (target) cols = cols.filter(c => c !== target);
    return cols;
}

export function startQuestions(questions, { onComplete } = {}) {
    _questions = questions;
    _currentIndex = 0;
    _responses = [];
    _sessionId = generateSessionId();
    _onComplete = onComplete ?? null;
    loadAndRender(0);
}

function loadAndRender(index) {
    const question = _questions[index];
    const zone = document.getElementById('tutorial-zone');
    zone.innerHTML = '<p class="question-loading">Loading data…</p>';

    window.addEventListener('survey:data-ready', function handler(event) {
        const detail = event.detail ?? {};
        const rawGroups = detail.groups ?? {};
        const uniqueGroups = [...new Set(Object.values(rawGroups))];
        _availableColumns = {
            objectives: detail.objectiveColumns ?? [],
            decisions: detail.decisionColumns ?? [],
            groups: uniqueGroups,
            groupsMap: rawGroups,
        };
        clearSelectionState();
        renderQuestion(index);
    }, { once: true });

    window.dispatchEvent(new CustomEvent('survey:load-data', {
        detail: {
            files: question.dataset.frontiers,
            benchmark: question.dataset.benchmark ?? null,
            disabledCharts: question.disabledCharts ?? null,
            defaultScreen: question.defaultScreen ?? null,
        },
    }));
}

function needsJustification(question) {
    return question.answerSpec?.type === 'knee_point' || question.type === 'decide_on_frontier';
}

function renderQuestion(index) {
    const question = _questions[index];
    const zone = document.getElementById('tutorial-zone');
    const total = _questions.length;
    _dynamicCandidates = null;

    let middleHTML;
    const useDropdown = (question.type === 'correlation' || question.type === 'most_distinct_objective') && question.optionSource;

    if (useDropdown) {
        const candidates = buildCandidates(question);
        _dynamicCandidates = candidates;
        const opts = candidates.map(c =>
            `<option value="${c}">${formatOptionLabel(c)}</option>`
        ).join('');
        middleHTML = `<select id="question-dropdown" class="question-dropdown">${opts}</select>`;
    } else if (question.interactionType === 'select_option') {
        const radios = question.options.map((opt, i) => `
            <label class="question-option">
                <input type="radio" name="q-option" value="${opt}"${i === 0 ? ' checked' : ''}>
                ${formatOptionLabel(opt)}
            </label>
        `).join('');
        middleHTML = `<div class="question-options">${radios}</div>`;
    } else {
        middleHTML = `<p class="question-instruction">Select points using Shift+click or the lasso tool, then click Submit.</p>`;
    }

    const justificationHTML = needsJustification(question) ? `
        <div class="question-justification">
            <textarea id="question-justification-input" class="question-justification-input" rows="2" placeholder="(Optional) Briefly explain your reasoning…"></textarea>
        </div>` : '';

    zone.innerHTML = `
        <p id="question-prompt">${question.prompt}</p>
        ${middleHTML}
        ${justificationHTML}
        <div id="question-controls-wrapper">
            <div id="question-controls">
                <span id="question-counter">Task ${index + 1} / ${total}</span>
                <button id="question-submit-btn" type="button">Submit →</button>
            </div>
            <button id="tutorial-chart-guide-btn" type="button">Chart Guide</button>
        </div>
    `;

    _startTime = performance.now();
    startTracking();
    document.getElementById('question-submit-btn').addEventListener('click', () => submitAnswer(index));
}

async function submitAnswer(index) {
    const question = _questions[index];
    const timeToAnswerMs = Math.round(performance.now() - _startTime);
    stopTracking();
    const telemetry = getTelemetryResult();

    let answer;
    if (_dynamicCandidates !== null) {
        const sel = document.getElementById('question-dropdown');
        answer = sel ? sel.value : null;
    } else if (question.interactionType === 'select_option') {
        const checked = document.querySelector('input[name="q-option"]:checked');
        answer = checked ? checked.value : null;
    } else {
        const sel = getSelectedRowIndexSet();
        answer = sel ? [...sel] : [];
    }

    let answerSpec = question.answerSpec;
    if (_dynamicCandidates && (answerSpec.type === 'strongest_correlation' || answerSpec.type === 'most_distinct_objective')) {
        answerSpec = { ...answerSpec, candidateColumns: _dynamicCandidates };
    }

    let computed;
    try {
        const res = await fetch('/api/compute-answer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                answerSpec,
                frontiers: question.dataset.frontiers,
                benchmark: question.dataset.benchmark ?? null,
                userAnswer: answer,
            }),
        });
        computed = await res.json();
    } catch {
        computed = {};
    }

    const score = computed.score ?? 0;
    const correctAnswer = computed.rowIndices ?? computed.option ?? null;

    const justificationEl = document.getElementById('question-justification-input');
    const justificationText = justificationEl ? justificationEl.value.trim() : null;
    const recordedAnswer = justificationText !== null
        ? { value: answer, justification: justificationText }
        : answer;

    _responses.push({
        questionId: question.id,
        questionType: question.type,
        interactionType: question.interactionType,
        answer: recordedAnswer,
        correctAnswer,
        score,
        isCorrect: score >= 1.0,
        timeToAnswerMs,
        timePerChart: telemetry.timePerChart,
        actions: telemetry.actions,
    });

    clearSelectionState();

    if (index < _questions.length - 1) {
        _currentIndex++;
        loadAndRender(_currentIndex);
    } else {
        _onComplete?.(_responses, _sessionId);
    }
}
