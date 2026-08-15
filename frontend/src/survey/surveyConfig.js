export function getSurveyContext() {
    const params = new URLSearchParams(window.location.search);
    const setup = params.get('setup');
    const file  = params.get('file');
    if (setup && file) return { setup, file };
    if (setup)         return { setup, file: null };
    return null;
}

function _surveyQueryString() {
    const ctx = getSurveyContext();
    if (!ctx) return '';
    const p = new URLSearchParams();
    if (ctx.setup) p.set('setup', ctx.setup);
    if (ctx.file)  p.set('file',  ctx.file);
    return '?' + p.toString();
}

export async function loadIntroConfig() {
    const res = await fetch('/api/intro-config' + _surveyQueryString());
    if (!res.ok) throw new Error('Failed to load intro config');
    return res.json();
}

export async function loadTutorialConfig() {
    const res = await fetch('/api/tutorial-config' + _surveyQueryString());
    if (!res.ok) throw new Error('Failed to load tutorial config');
    const config = await res.json();
    return { steps: config.tutorial, dataset: config.dataset ?? null };
}

export async function loadQuestionsConfig() {
    const res = await fetch('/api/questions-config' + _surveyQueryString());
    if (!res.ok) throw new Error('Failed to load questions config');
    return res.json();
}
