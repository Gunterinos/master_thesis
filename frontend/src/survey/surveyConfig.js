export async function loadTutorialConfig() {
    const res = await fetch('/api/tutorial-config');
    if (!res.ok) throw new Error('Failed to load tutorial config');
    const { tutorial } = await res.json();
    return tutorial;
}
