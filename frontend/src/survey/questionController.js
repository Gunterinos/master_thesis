import { getSelectedRowIndexSet, clearSelectionState } from '../state/appState.js';

let _questions = [];
let _currentIndex = 0;
let _startTime = 0;
let _responses = [];
let _sessionId = '';
let _onComplete = null;

function generateSessionId() {
    return crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function formatOptionLabel(val) {
    return val.replace(/^(obj_|dec_)/, '').replace(/_/g, ' ');
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

    window.addEventListener('survey:data-ready', function handler() {
        clearSelectionState();
        renderQuestion(index);
    }, { once: true });

    window.dispatchEvent(new CustomEvent('survey:load-data', {
        detail: { files: question.dataset.frontiers },
    }));
}

function renderQuestion(index) {
    const question = _questions[index];
    const zone = document.getElementById('tutorial-zone');
    const total = _questions.length;

    let middleHTML;
    if (question.interactionType === 'select_option') {
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

    zone.innerHTML = `
        <p id="question-prompt">${question.prompt}</p>
        ${middleHTML}
        <div id="question-controls">
            <span id="question-counter">Task ${index + 1} / ${total}</span>
            <button id="question-submit-btn" type="button">Submit →</button>
        </div>
    `;

    _startTime = performance.now();
    document.getElementById('question-submit-btn').addEventListener('click', () => submitAnswer(index));
}

async function submitAnswer(index) {
    const question = _questions[index];
    const timeToAnswerMs = Math.round(performance.now() - _startTime);

    let answer;
    if (question.interactionType === 'select_option') {
        const checked = document.querySelector('input[name="q-option"]:checked');
        answer = checked ? checked.value : null;
    } else {
        const sel = getSelectedRowIndexSet();
        answer = sel ? [...sel] : [];
    }

    let computed;
    try {
        const res = await fetch('/api/compute-answer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                answerSpec: question.answerSpec,
                frontiers: question.dataset.frontiers,
            }),
        });
        computed = await res.json();
    } catch {
        computed = {};
    }

    let isCorrect = false;
    let correctAnswer;

    if (computed.rowIndices !== undefined) {
        correctAnswer = computed.rowIndices;
        const correctSet = new Set(computed.rowIndices);
        if (question.answerSpec.type === 'range') {
            isCorrect = answer.length > 0 && answer.every(idx => correctSet.has(idx));
        } else {
            isCorrect = answer.some(idx => correctSet.has(idx));
        }
    } else {
        correctAnswer = computed.option ?? null;
        isCorrect = answer !== null && answer === computed.option;
    }

    _responses.push({
        questionId: question.id,
        questionType: question.type,
        interactionType: question.interactionType,
        answer,
        correctAnswer,
        isCorrect,
        timeToAnswerMs,
    });

    clearSelectionState();

    if (index < _questions.length - 1) {
        _currentIndex++;
        loadAndRender(_currentIndex);
    } else {
        _onComplete?.(_responses, _sessionId);
    }
}
