document.addEventListener('DOMContentLoaded', () => {
    // --- Canvas and UI element setup ---
    const canvas = document.getElementById('floor-plan');
    const ctx = canvas.getContext('2d');
    const guestListContainer = document.getElementById('guest-list');
    const csvFileInput = document.getElementById('csv-file');
    const loadFileInput = document.getElementById('load-file-input');

    // --- Buttons ---
    const drawTableButton = document.getElementById('draw-table');
    const drawBarrierButton = document.getElementById('draw-barrier');
    const selectToolButton = document.getElementById('select-tool');
    const deleteSelectedButton = document.getElementById('delete-selected');
    const clearCanvasButton = document.getElementById('clear-canvas');
    const savePlanButton = document.getElementById('save-plan');
    const loadPlanButton = document.getElementById('load-plan');

    // --- Application State ---
    let allGuests = [];
    let placedGuests = []; 

    let currentMode = 'select';
    let isDrawing = false;
    let isDraggingShape = false;
    let isDraggingGuest = false;

    let startX, startY;
    let selectedShapeIndex = null;
    let selectedGuestIndex = null;
    let selectionOffsetX, selectionOffsetY;
    let hoveredGuest = null;

    const GUEST_RADIUS = 15;

    // --- CSV Handling ---
    csvFileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                allGuests = parseRobustCSV(e.target.result);
                clearCanvasButton.click();
                renderGuestList();
            } catch (error) {
                console.error("Critical error during CSV parsing:", error);
                alert(`A critical error occurred: ${error.message}. Check the console for more details.`);
            }
        };
        reader.readAsText(file);
    });

    // **NEW, ROBUST CSV PARSER**
    function parseRobustCSV(text) {
        console.clear();
        console.log("--- Starting Robust CSV Parse ---");

        const lines = text.trim().split("\n");
        if (lines.length < 2) return [];

        const delimiter = lines[0].includes('	') ? '	' : ',';
        console.log(`Delimiter: "${delimiter}"`);

        // This function correctly splits a single line, respecting quotes.
        const parseCsvLine = (line) => {
            const fields = [];
            let currentField = '';
            let inQuotes = false;
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                if (char === '"') {
                    if (inQuotes && line[i + 1] === '"') { // Handle escaped quote ""
                        currentField += '"';
                        i++;
                    } else {
                        inQuotes = !inQuotes;
                    }
                } else if (char === delimiter && !inQuotes) {
                    fields.push(currentField.trim());
                    currentField = '';
                } else {
                    currentField += char;
                }
            }
            fields.push(currentField.trim());
            return fields;
        };
        
        const headerRaw = parseCsvLine(lines[0]);
        const header = headerRaw.map(h => h.trim().replace(/^"|"$/g, '')); // Clean quotes from header
        console.log("Header row parsed:", header);

        const findIndex = (possibleNames) => {
            for (const name of possibleNames) {
                const formattedName = name.toLowerCase().replace(/\s/g, '');
                const index = header.findIndex(h => h.toLowerCase().replace(/\s/g, '') === formattedName);
                if (index !== -1) return index;
            }
            return -1;
        };
        
        const colIndices = {
            firstName: findIndex(['firstname']),
            lastName: findIndex(['lastname']),
            additionalGuests: findIndex(['additionalguests', 'additional guest']),
            partyId: findIndex(['partyid'])
        };

        console.log("Column indices identified:", colIndices);
        if (colIndices.firstName === -1 || colIndices.lastName === -1) throw new Error("Crucial 'FirstName' and/or 'LastName' columns not found.");
        if (colIndices.additionalGuests === -1) console.warn("'AdditionalGuests' column not found.");

        let guestIdCounter = 0;
        let plusOneCount = 0;
        const processedGuests = [];

        lines.slice(1).forEach((line, index) => {
            if (!line.trim()) return; // Skip empty lines
            
            const values = parseCsvLine(line);
            console.log(`Processing line ${index + 1}:`, values);
            const firstName = values[colIndices.firstName];
            
            if (!firstName) return;

            const primaryGuest = { 
                id: guestIdCounter++,
                firstName: firstName.trim(), 
                lastName: (values[colIndices.lastName] || '').trim(), 
                seated: false, x: 0, y: 0, isPlusOne: false
            };
            processedGuests.push(primaryGuest);
            
            if (colIndices.additionalGuests !== -1) {
                const additionalGuestsValue = values[colIndices.additionalGuests];
                const additionalGuestCount = parseInt(additionalGuestsValue) || 0;
                 console.log(`  - AdditionalGuests raw value: "${additionalGuestsValue}". Parsed as: ${additionalGuestCount}`);
                for (let i = 1; i <= additionalGuestCount; i++) {
                    plusOneCount++;
                    processedGuests.push({
                        id: guestIdCounter++,
                        firstName: `${primaryGuest.firstName} ${primaryGuest.lastName}'s`,
                        lastName: `Guest ${i}`,
                        seated: false, x: 0, y: 0,
                        isPlusOne: true,
                        plusOneIndex: i
                    });
                }
            }
        });
        
        console.log(`
--- CSV Parse Complete ---`);
        console.log(`Created ${processedGuests.length - plusOneCount} primary guests and ${plusOneCount} additional guests.`);
        return processedGuests;
    }


    function renderGuestList() {
        guestListContainer.innerHTML = '';
        allGuests.forEach((guest) => {
            if (!guest.seated) {
                const li = document.createElement('li');
                li.textContent = `${guest.firstName} ${guest.lastName}`;
                li.draggable = true;
                li.dataset.guestId = guest.id;
                if (guest.isPlusOne) {
                    li.style.color = '#555';
                    li.style.paddingLeft = '20px';
                }
                guestListContainer.appendChild(li);
            }
        });
    }

    // --- Mode and Tool Selection ---
    function setMode(mode) {
        currentMode = mode;
        canvas.style.cursor = 'default';
        if (mode === 'draw-table' || mode === 'draw-barrier') canvas.style.cursor = 'crosshair';
        selectedShapeIndex = null;
        selectedGuestIndex = null;
        updateDeleteButton();
        redrawCanvas();
    }

    drawTableButton.addEventListener('click', () => setMode('draw-table'));
    drawBarrierButton.addEventListener('click', () => setMode('draw-barrier'));
    selectToolButton.addEventListener('click', () => setMode('select'));

    // --- Main Canvas Interaction Logic ---
    canvas.addEventListener('mousedown', (e) => {
        startX = e.offsetX;
        startY = e.offsetY;

        if (currentMode === 'draw-table' || currentMode === 'draw-barrier') {
            isDrawing = true;
        } else if (currentMode === 'select') {
            selectedGuestIndex = getGuestAt(startX, startY);
            selectedShapeIndex = selectedGuestIndex === null ? getShapeAt(startX, startY) : null;
            
            if (selectedGuestIndex !== null) {
                isDraggingGuest = true;
                const guest = placedGuests[selectedGuestIndex];
                selectionOffsetX = startX - guest.x;
                selectionOffsetY = startY - guest.y;
            } else if (selectedShapeIndex !== null) {
                isDraggingShape = true;
                const shape = shapes[selectedShapeIndex];
                selectionOffsetX = startX - shape.x;
                selectionOffsetY = startY - shape.y;
            }
            updateDeleteButton();
            redrawCanvas();
        }
    });

    canvas.addEventListener('mousemove', (e) => {
        const { offsetX, offsetY } = e;
        if (isDrawing) {
            redrawCanvas();
            drawPreview(offsetX, offsetY);
        } else if (isDraggingGuest && selectedGuestIndex !== null) {
            placedGuests[selectedGuestIndex].x = offsetX - selectionOffsetX;
            placedGuests[selectedGuestIndex].y = offsetY - selectionOffsetY;
            redrawCanvas();
        } else if (isDraggingShape && selectedShapeIndex !== null) {
            shapes[selectedShapeIndex].x = offsetX - selectionOffsetX;
            shapes[selectedShapeIndex].y = offsetY - selectionOffsetY;
            redrawCanvas();
        } else if (currentMode === 'select') {
            const guestIndex = getGuestAt(offsetX, offsetY);
            hoveredGuest = guestIndex !== null ? placedGuests[guestIndex] : null;
            canvas.style.cursor = (hoveredGuest || getShapeAt(offsetX, offsetY) !== null) ? 'move' : 'default';
            redrawCanvas();
        }
    });

    canvas.addEventListener('mouseup', (e) => {
        if (isDrawing) {
            addShape(e.offsetX, e.offsetY);
            setMode('select');
        }
        isDrawing = false;
        isDraggingShape = false;
        isDraggingGuest = false;
    });

    function addShape(endX, endY) {
        const rect = { x: Math.min(startX, endX), y: Math.min(startY, endY), width: Math.abs(startX - endX), height: Math.abs(startY - endY) };
        if (rect.width > 5 && rect.height > 5) {
            shapes.push({ type: currentMode === 'draw-table' ? 'table' : 'barrier', ...rect });
        }
    }

    function drawPreview(endX, endY) {
        ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.rect(startX, startY, endX - startX, endY - startY);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // --- Shape and Guest Management ---
    deleteSelectedButton.addEventListener('click', () => {
        if (selectedShapeIndex !== null) {
            shapes.splice(selectedShapeIndex, 1);
            selectedShapeIndex = null;
        }
        updateDeleteButton();
        redrawCanvas();
    });

    function getShapeAt(x, y) {
        for (let i = shapes.length - 1; i >= 0; i--) {
            const s = shapes[i];
            if (x >= s.x && x <= s.x + s.width && y >= s.y && y <= s.y + s.height) return i;
        }
        return null;
    }
    
    function getGuestAt(x, y) {
        for (let i = placedGuests.length - 1; i >= 0; i--) {
            if (Math.hypot(x - placedGuests[i].x, y - placedGuests[i].y) < GUEST_RADIUS) return i;
        }
        return null;
    }

    function updateDeleteButton() {
        deleteSelectedButton.disabled = selectedShapeIndex === null;
    }

    // --- Rendering ---
    function redrawCanvas() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        shapes.forEach((shape, index) => {
            ctx.fillStyle = shape.type === 'table' ? 'lightblue' : 'gray';
            ctx.strokeStyle = (selectedShapeIndex === index) ? '#ff4136' : '#000';
            ctx.lineWidth = (selectedShapeIndex === index) ? 3 : 2;
            ctx.fillRect(shape.x, shape.y, shape.width, shape.height);
            ctx.strokeRect(shape.x, shape.y, shape.width, shape.height);
        });

        placedGuests.forEach(guest => {
            ctx.fillStyle = guest.isPlusOne ? '#87CEEB' : '#ffb347';
            ctx.beginPath();
            ctx.arc(guest.x, guest.y, GUEST_RADIUS, 0, 2 * Math.PI);
            ctx.fill();
            ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
            ctx.fillStyle = '#000'; ctx.font = 'bold 12px Arial';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            const initials = guest.isPlusOne ? `+${guest.plusOneIndex}` : `${guest.firstName[0] || ''}${guest.lastName[0] || ''}`;
            ctx.fillText(initials, guest.x, guest.y);
        });

        if (hoveredGuest) {
            const text = `${hoveredGuest.firstName} ${hoveredGuest.lastName}`;
            const textWidth = ctx.measureText(text).width;
            ctx.fillStyle = 'rgba(0,0,0,0.75)';
            ctx.fillRect(hoveredGuest.x + 15, hoveredGuest.y - 30, textWidth + 10, 20);
            ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
            ctx.fillText(text, hoveredGuest.x + 20, hoveredGuest.y - 20);
        }
    }

    // --- Drag and Drop Guests from List ---
    guestListContainer.addEventListener('dragstart', (e) => {
        if (e.target.tagName === 'LI') e.dataTransfer.setData('text/plain', e.target.dataset.guestId);
    });
    canvas.addEventListener('dragover', (e) => e.preventDefault());
    canvas.addEventListener('drop', (e) => {
        e.preventDefault();
        const guestId = parseInt(e.dataTransfer.getData('text/plain'));
        const guest = allGuests.find(g => g.id === guestId);
        if (guest && !guest.seated) {
            guest.seated = true;
            guest.x = e.offsetX;
            guest.y = e.offsetY;
            placedGuests.push(guest);
            renderGuestList();
            redrawCanvas();
        }
    });
    
    // --- Drag Guests back to the list ---
    guestListContainer.addEventListener('dragover', e => e.preventDefault());
    guestListContainer.addEventListener('drop', e => {
        e.preventDefault();
        if (isDraggingGuest && selectedGuestIndex !== null) {
            placedGuests[selectedGuestIndex].seated = false;
            placedGuests.splice(selectedGuestIndex, 1);
            isDraggingGuest = false;
            selectedGuestIndex = null;
            renderGuestList();
            redrawCanvas();
        }
    });

    // --- System Actions ---
    clearCanvasButton.addEventListener('click', () => {
        shapes = []; placedGuests = [];
        allGuests.forEach(g => g.seated = false);
        selectedShapeIndex = null;
        updateDeleteButton();
        redrawCanvas();
        renderGuestList();
    });

    savePlanButton.addEventListener('click', () => {
        const dataStr = JSON.stringify({ shapes, placedGuests }, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'seating-plan.json';
        a.click();
        URL.revokeObjectURL(a.href);
    });

    loadPlanButton.addEventListener('click', () => loadFileInput.click());
    loadFileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                shapes = data.shapes || [];
                placedGuests = data.placedGuests || [];
                const seatedGuestIds = new Set(placedGuests.map(g => g.id));
                allGuests.forEach(g => g.seated = seatedGuestIds.has(g.id));
                renderGuestList();
                redrawCanvas();
            } catch (error) {
                console.error("Load failed:", error);
                alert("Could not load the plan.");
            }
        };
        reader.readAsText(file);
    });
    
    setMode('select');
    renderGuestList();
});
