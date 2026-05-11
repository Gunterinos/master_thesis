export async function loadTutorialConfig() {
    const res = await fetch('/api/tutorial-config');
    if (!res.ok) throw new Error('Failed to load tutorial config');
    const { tutorial } = await res.json();
    return tutorial;
}

export async function loadQuestionsConfig() {
    const res = await fetch('/api/questions-config');
    if (!res.ok) throw new Error('Failed to load questions config');
    return res.json();
}
