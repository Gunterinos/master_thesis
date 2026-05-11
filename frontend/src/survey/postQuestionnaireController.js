let _backdrop = null;

export function showPostQuestionnaire(config, { onComplete }) {
    if (!config?.questions?.length) {
        onComplete([]);
        return;
    }
    _backdrop = buildBackdrop(config, onComplete);
    document.body.appendChild(_backdrop);
    _backdrop.classList.add('open');
}

function closeModal() {
    _backdrop?.remove();
    _backdrop = null;
}

function buildBackdrop(config, onComplete) {
    const backdrop = document.createElement('div');
    backdrop.id = 'pq-backdrop';

    const modal = document.createElement('div');
    modal.id = 'pq-modal';

    // Header
    const header = document.createElement('div');
    header.className = 'pq-modal-header';
    const titleGroup = document.createElement('div');
    titleGroup.className = 'pq-modal-title-group';
    titleGroup.innerHTML = `
        <h2>${config.title ?? 'Questionnaire'}</h2>
        ${config.subtitle ? `<p class="pq-modal-subtitle">${config.subtitle}</p>` : ''}
    `;
    header.appendChild(titleGroup);
    modal.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = 'pq-modal-body';
    config.questions.forEach(q => body.appendChild(buildQuestion(q)));
    modal.appendChild(body);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'pq-modal-footer';
    const submitBtn = document.createElement('button');
    submitBtn.id = 'pq-submit-btn';
    submitBtn.type = 'button';
    submitBtn.textContent = 'Submit';
    submitBtn.addEventListener('click', () => {
        const answers = collectAnswers(config.questions);
        closeModal();
        onComplete(answers);
    });
    footer.appendChild(submitBtn);
    modal.appendChild(footer);

    backdrop.appendChild(modal);
    return backdrop;
}

function buildQuestion(q) {
    const wrapper = document.createElement('div');
    wrapper.className = 'pq-question';

    const prompt = document.createElement('p');
    prompt.className = 'pq-question-prompt';
    prompt.textContent = q.prompt;
    wrapper.appendChild(prompt);

    if (q.type === 'multiple_choice') {
        const optionsDiv = document.createElement('div');
        optionsDiv.className = 'pq-options';
        q.options.forEach(opt => {
            const label = document.createElement('label');
            label.className = 'pq-option';
            const input = document.createElement('input');
            input.type = 'radio';
            input.name = `pq-${q.id}`;
            input.value = opt;
            label.appendChild(input);
            label.appendChild(document.createTextNode(` ${opt}`));
            optionsDiv.appendChild(label);
        });
        wrapper.appendChild(optionsDiv);

    } else if (q.type === 'likert') {
        const scale = q.scale ?? 5;
        const minLabel = q.labels?.min ?? '';
        const maxLabel = q.labels?.max ?? '';

        const likertDiv = document.createElement('div');
        likertDiv.className = 'pq-likert';

        if (minLabel) {
            const lbl = document.createElement('span');
            lbl.className = 'pq-likert-label';
            lbl.textContent = minLabel;
            likertDiv.appendChild(lbl);
        }

        const scaleDiv = document.createElement('div');
        scaleDiv.className = 'pq-likert-scale';
        for (let i = 1; i <= scale; i++) {
            const item = document.createElement('label');
            item.className = 'pq-likert-item';
            item.innerHTML = `<input type="radio" name="pq-${q.id}" value="${i}"><span>${i}</span>`;
            scaleDiv.appendChild(item);
        }
        likertDiv.appendChild(scaleDiv);

        if (maxLabel) {
            const lbl = document.createElement('span');
            lbl.className = 'pq-likert-label';
            lbl.textContent = maxLabel;
            likertDiv.appendChild(lbl);
        }

        wrapper.appendChild(likertDiv);

    } else if (q.type === 'open') {
        const ta = document.createElement('textarea');
        ta.id = `pq-${q.id}-answer`;
        ta.className = 'pq-textarea';
        ta.rows = 3;
        ta.placeholder = q.placeholder ?? 'Your answer…';
        wrapper.appendChild(ta);
    }

    return wrapper;
}

function collectAnswers(questions) {
    return questions.map(q => {
        let answer = null;
        if (q.type === 'multiple_choice' || q.type === 'likert') {
            const checked = document.querySelector(`input[name="pq-${q.id}"]:checked`);
            answer = checked ? checked.value : null;
        } else if (q.type === 'open') {
            const ta = document.getElementById(`pq-${q.id}-answer`);
            answer = ta?.value.trim() || null;
        }
        return { questionId: q.id, type: q.type, answer };
    });
}
