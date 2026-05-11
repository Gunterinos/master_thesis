export async function loadTutorialConfig() {
    const res = await fetch('/api/tutorial-config');
    if (!res.ok) throw new Error('Failed to load tutorial config');
    const config = await res.json();
    return { intro: config.intro ?? null, steps: config.tutorial };
}

export async function loadQuestionsConfig() {
    const res = await fetch('/api/questions-config');
    if (!res.ok) throw new Error('Failed to load questions config');
    return res.json();
}
