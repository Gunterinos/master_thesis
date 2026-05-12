let _backdrop = null;
let _onContinue = null;

function buildBackdrop(intro) {
    const backdrop = document.createElement('div');
    backdrop.id = 'survey-intro-backdrop';

    const modal = document.createElement('div');
    modal.id = 'survey-intro-modal';

    if (intro.title) {
        const title = document.createElement('h2');
        title.id = 'survey-intro-title';
        title.textContent = intro.title;
        modal.appendChild(title);
    }

    const body = document.createElement('div');
    body.id = 'survey-intro-body';
    intro.body.split('\n').filter(l => l.trim()).forEach(line => {
        const p = document.createElement('p');
        p.innerHTML = line;
        body.appendChild(p);
    });
    modal.appendChild(body);

    const footer = document.createElement('div');
    footer.id = 'survey-intro-footer';

    const continueBtn = document.createElement('button');
    continueBtn.id = 'survey-intro-continue-btn';
    continueBtn.type = 'button';
    continueBtn.textContent = intro.continueLabel ?? 'Continue →';
    continueBtn.addEventListener('click', () => close());
    footer.appendChild(continueBtn);

    modal.appendChild(footer);
    backdrop.appendChild(modal);
    return backdrop;
}

function close() {
    _backdrop?.remove();
    _backdrop = null;
    const cb = _onContinue;
    _onContinue = null;
    cb?.();
}

export function showSurveyIntro(intro, onContinue) {
    _onContinue = onContinue;
    _backdrop = buildBackdrop(intro);
    document.body.appendChild(_backdrop);

    document.addEventListener('keydown', function handler(e) {
        if (e.key === 'Escape' && _backdrop) {
            document.removeEventListener('keydown', handler);
            close();
        }
    });
}
