let activeRowIndex = null;

// this function applies the highlighting by adding/removing CSS classes and adjusting point size through its radius
function applyLinkedHighlight() {
    const hasActive = activeRowIndex !== null;

    d3.selectAll("tr[data-row-index]")
        .classed("is-linked-highlight", function classRowHighlight() {
            return hasActive && Number(this.dataset.rowIndex) === activeRowIndex;
        })
        .classed("is-linked-dim", function classRowDim() {
            return hasActive && Number(this.dataset.rowIndex) !== activeRowIndex;
        });

    d3.selectAll("circle[data-row-index]")
        .classed("is-linked-highlight", function classPointHighlight() {
            return hasActive && Number(this.dataset.rowIndex) === activeRowIndex;
        })
        .classed("is-linked-dim", function classPointDim() {
            return hasActive && Number(this.dataset.rowIndex) !== activeRowIndex;
        })
        .attr("r", function sizePoint() {
            if (!hasActive) {
                return 4;
            }

            return Number(this.dataset.rowIndex) === activeRowIndex ? 7 : 3;
        });
}

// this function calls the one above and also scrolls the linked elements into view
function setActiveRowIndex(rowIndex) {
    activeRowIndex = rowIndex;
    applyLinkedHighlight();

    const linkedRows = document.querySelectorAll(`tr[data-row-index="${rowIndex}"]`);
    linkedRows.forEach((rowElement) => {
        rowElement.scrollIntoView({
            block: "nearest",
            behavior: "smooth",
            inline: "nearest",
        });
    });
}

// this is called to clear the active row
function clearActiveRowIndex() {
    activeRowIndex = null;
    applyLinkedHighlight();
}

// this function renders everything basically after we get the data
d3.json("/api/portfolio-data")
    .then((rawData) => {
        if (!rawData || rawData.length === 0) {
            d3.select("#objectives-container").append("p").text("No data available.");
            d3.select("#decision-container").append("p").text("No data available.");
            return;
        }

        const data = rawData.map((row, index) => ({
            ...row,
            __rowIndex: index,
        }));

        const interactionOptions = {
            onHoverStart: setActiveRowIndex,
            onHoverEnd: clearActiveRowIndex,
        };

        const chartRegistry = createChartRegistry(interactionOptions);

        initializeObjectivesSpacePanel({
            data,
            chartRegistry,
            onAfterRender: applyLinkedHighlight,
        });

        initializeDecisionSpacePanel({
            data,
            chartRegistry,
            onAfterRender: applyLinkedHighlight,
        });
    })
    .catch((error) => {
        d3.select("#objectives-container").append("p").text("Failed to load data.");
        d3.select("#decision-container").append("p").text("Failed to load data.");
        console.error(error);
    });
