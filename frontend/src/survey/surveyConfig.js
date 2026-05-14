export async function loadIntroConfig() {
    const res = await fetch('/api/intro-config');
    if (!res.ok) throw new Error('Failed to load intro config');
    return res.json();
}

export async function loadTutorialConfig() {
    const res = await fetch('/api/tutorial-config');
    if (!res.ok) throw new Error('Failed to load tutorial config');
    const config = await res.json();
    return { steps: config.tutorial, dataset: config.dataset ?? null };
}

export async function loadQuestionsConfig() {
    const res = await fetch('/api/questions-config');
    if (!res.ok) throw new Error('Failed to load questions config');
    return res.json();
}
