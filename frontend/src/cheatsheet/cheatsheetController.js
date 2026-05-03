const CHARTS = [
    {
        id: 'table',
        label: 'Table',
        icon: '/icons/Table.svg',
        gif: '/gifs/Table_GIF.gif',
        description: 'Each <strong>row</strong> is one portfolio. <strong>Sort</strong> any column. <strong>Brush</strong> the mini-bars at the top to filter by range.',
    },
    {
        id: 'scatter2d',
        label: '2D Scatterplot',
        icon: '/icons/2D_Scatter.svg',
        gif: '/gifs/2D_Scatter_GIF.gif',
        description: 'Each <strong>dot</strong> is one portfolio. Position shows two objectives. <strong>Shift+click</strong> to select; use the <strong>Lasso Tool</strong> to select an area.',
    },
    {
        id: 'scatter3d',
        label: '3D Scatterplot',
        icon: '/icons/3D_ScatterPlot.svg',
        gif: '/gifs/3D_Scatter_GIF.gif',
        description: 'Each <strong>dot</strong> is one portfolio in three dimensions. <strong>Drag</strong> to rotate. <strong>Brush</strong> along any axis to filter to a range.',
    },
    {
        id: 'pcp',
        label: 'Parallel Coordinates',
        icon: '/icons/PCP.svg',
        gif: '/gifs/PCP_GIF.gif',
        description: 'Each <strong>line</strong> crosses all objective axes. <strong>Brush</strong> (drag) an axis to filter portfolios to a range.',
    },
    {
        id: 'radar',
        label: 'Radar Chart',
        icon: '/icons/radarChart.svg',
        gif: '/gifs/Radar_Chart_GIF.gif',
        description: 'Each <strong>polygon</strong> maps a portfolio across all radial objective axes. <strong>Brush</strong> (drag) an axis to filter.',
    },
    {
        id: 'radviz',
        label: 'RadViz',
        icon: '/icons/RadViz.svg',
        gif: '/gifs/RadViz_GIF.gif',
        description: 'Each <strong>glyph</strong> (mini pie) is pulled toward its strongest objectives. Balanced portfolios land near the centre. <strong>Shift+click</strong> or <strong>Lasso</strong> to select.',
    },
    {
        id: 'heatmap',
        label: 'Correlation Heatmap',
        icon: '/icons/Heatmap.svg',
        description: 'Each <strong>cell</strong> shows the correlation between two variables. <strong>Lighter</strong> = positive, <strong>darker</strong> = negative. No selection or filtering.',
    },
    {
        id: 'barchart',
        label: 'Column Chart',
        icon: '/icons/BarChart.svg',
        description: 'Each <strong>bar group</strong> is one portfolio; bar height = allocation size. <strong>Shift+click</strong> a bar to select.',
    },
];


function buildCard(chart) {
    const card = document.createElement('div');
    card.className = 'cheatsheet-card';

    const icon = document.createElement('img');
    icon.className = 'cheatsheet-card-icon';
    icon.src = chart.icon;
    icon.alt = chart.label;
    card.appendChild(icon);

    if (chart.gif) {
        const wrapper = document.createElement('div');
        wrapper.className = 'cheatsheet-card-gif-wrapper';

        const canvas = document.createElement('canvas');
        canvas.className = 'cheatsheet-card-gif-static';

        const gifImg = document.createElement('img');
        gifImg.className = 'cheatsheet-card-gif';
        gifImg.alt = `${chart.label} animation`;

        // Capture first frame of the GIF into the canvas
        const loader = new Image();
        loader.onload = () => {
            canvas.width = loader.naturalWidth;
            canvas.height = loader.naturalHeight;
            canvas.getContext('2d').drawImage(loader, 0, 0);
        };
        loader.src = chart.gif;

        wrapper.addEventListener('mouseenter', () => {
            gifImg.src = chart.gif;
            gifImg.style.display = 'block';
            canvas.style.display = 'none';
        });
        wrapper.addEventListener('mouseleave', () => {
            gifImg.src = '';
            gifImg.style.display = 'none';
            canvas.style.display = 'block';
        });

        wrapper.appendChild(canvas);
        wrapper.appendChild(gifImg);
        card.appendChild(wrapper);
    }

    const title = document.createElement('p');
    title.className = 'cheatsheet-card-title';
    title.textContent = chart.label;
    card.appendChild(title);

    const desc = document.createElement('p');
    desc.className = 'cheatsheet-card-desc';
    desc.innerHTML = chart.description;
    card.appendChild(desc);

    return card;
}

function buildBackdrop() {
    const backdrop = document.createElement('div');
    backdrop.id = 'cheatsheet-backdrop';

    const modal = document.createElement('div');
    modal.id = 'cheatsheet-modal';

    const header = document.createElement('div');
    header.className = 'cheatsheet-modal-header';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'cheatsheet-modal-title-group';

    const title = document.createElement('h2');
    title.textContent = 'Chart Guide';
    titleGroup.appendChild(title);

    const subtitle = document.createElement('p');
    subtitle.className = 'cheatsheet-modal-subtitle';
    subtitle.textContent = 'A quick reference for each chart type and its interactions. Hover over an image to see it in action.';
    titleGroup.appendChild(subtitle);

    header.appendChild(titleGroup);

    const closeBtn = document.createElement('button');
    closeBtn.id = 'cheatsheet-close-btn';
    closeBtn.type = 'button';
    closeBtn.textContent = '×';
    header.appendChild(closeBtn);

    modal.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'cheatsheet-grid';
    CHARTS.forEach((chart) => grid.appendChild(buildCard(chart)));
    modal.appendChild(grid);

    backdrop.appendChild(modal);
    return backdrop;
}

let backdrop = null;

function openCheatsheet() {
    backdrop.classList.add('open');
    document.body.style.overflow = 'hidden';


}

function closeCheatsheet() {
    backdrop.classList.remove('open');
    document.body.style.overflow = '';
}

export function initCheatsheet() {
    backdrop = buildBackdrop();
    document.body.appendChild(backdrop);

    document.getElementById('chart-guide-btn').addEventListener('click', openCheatsheet);
    document.getElementById('cheatsheet-close-btn').addEventListener('click', closeCheatsheet);

    // Tutorial nav button (injected dynamically when tutorial starts)
    document.addEventListener('click', (event) => {
        if (event.target.id === 'tutorial-chart-guide-btn') openCheatsheet();
    });

    backdrop.addEventListener('click', (event) => {
        if (event.target === backdrop) closeCheatsheet();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && backdrop.classList.contains('open')) closeCheatsheet();
    });
}
