document.addEventListener('DOMContentLoaded', () => {
    // --- Canvas and UI element setup ---
    const canvas = document.getElementById('floor-plan');
    const ctx = canvas.getContext('2d');
    const guestListContainer = document.getElementById('guest-list');
    const csvFileInput = document.getElementById('csv-file');
    const loadFileInput = document.getElementById('load-file-input');
    const mergeCsvButton = document.getElementById('merge-csv-button');
    const mergeCsvInput = document.getElementById('merge-csv-input');

    // --- Buttons ---
    const drawTableButton = document.getElementById('draw-table');
    const drawBarrierButton = document.getElementById('draw-barrier');
    const selectToolButton = document.getElementById('select-tool');
    const deleteSelectedButton = document.getElementById('delete-selected');
    const activeToolIndicator = document.getElementById('active-tool-indicator');
    const clearCanvasButton = document.getElementById('clear-canvas');
    const savePlanButton = document.getElementById('save-plan');
    const loadPlanButton = document.getElementById('load-plan');
    const toolButtons = [drawTableButton, drawBarrierButton, selectToolButton];

    // --- Application State ---
    let allGuests = []; let placedGuests = []; let shapes = [];
    let seatedGuestsMap = new Map(); let partyColors = {};
    let currentMode = 'select';
    let isDrawing = false, isDraggingShape = false, isDraggingGuest = false;
    let startX, startY;
    let selectedShapeIndex = null, selectedGuestIndex = null;
    let selectionOffsetX, selectionOffsetY;
    let hoveredGuest = null;
    const GUEST_RADIUS = 15;

    // --- CSV Handling ---
    csvFileInput.addEventListener('change', (event) => handleNewCsvLoad(event.target.files[0]));
    mergeCsvButton.addEventListener('click', () => mergeCsvInput.click());
    mergeCsvInput.addEventListener('change', (event) => handleMergeCsvLoad(event.target.files[0]));
    function handleNewCsvLoad(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                allGuests = parseRobustCSV(e.target.result);
                clearCanvasButton.click();
            } catch (error) { alert(`Failed to parse CSV file: ${error.message}`); }
        };
        reader.readAsText(file);
    }
    function handleMergeCsvLoad(file) {
        if (!file) return;
        if (allGuests.length === 0) { alert("Please load a project before merging."); return; }
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const newGuestList = parseRobustCSV(e.target.result);
                reconcileGuestLists(newGuestList);
            } catch (error) { alert(`Failed to merge CSV file: ${error.message}`); }
        };
        reader.readAsText(file);
    }
    function reconcileGuestLists(newGuestList) {
        const getNameKey = g => g ? `${g.firstName}_${g.lastName}`.toLowerCase() : null;
        const oldGuestStates = new Map(allGuests.map(g => [getNameKey(g), { seated: g.seated, x: g.x, y: g.y }]));
        newGuestList.forEach(newGuest => {
            const nameKey = getNameKey(newGuest);
            if (oldGuestStates.has(nameKey)) {
                const oldState = oldGuestStates.get(nameKey);
                Object.assign(newGuest, oldState);
            }
        });
        allGuests = newGuestList.filter(Boolean);
        placedGuests = allGuests.filter(g => g && g.seated);
        partyColors = {};
        updateSeatedGuestsMap();
        renderGuestList();
        redrawCanvas();
        alert('Guest list successfully merged!');
    }
    function parseRobustCSV(text) {
        const lines = text.trim().split("\n");
        if (lines.length < 2) throw new Error("CSV must have a header row and data.");
        const delimiter = lines[0].includes('	') ? '	' : ',';
        const header = lines[0].split(delimiter).map(h => h.trim().replace(/^"|"$/g, ''));
        const findIndex = names => names.reduce((acc, name) => acc !== -1 ? acc : header.findIndex(h => h.toLowerCase().replace(/\s/g, '') === name), -1);
        const colIndices = {
            firstName: findIndex(['firstname']), lastName: findIndex(['lastname']),
            additionalGuests: findIndex(['additionalguests', 'additional guest']), partyId: findIndex(['partyid'])
        };
        if (colIndices.firstName === -1 || colIndices.lastName === -1) throw new Error("'FirstName' and 'LastName' columns not found.");
        const parseCsvLine = line => {
            const fields = []; let currentField = ''; let inQuotes = false;
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                if (char === '"' && (i === 0 || line[i-1] !== '"')) { inQuotes = !inQuotes; continue; }
                if (char === delimiter && !inQuotes) { fields.push(currentField); currentField = ''; }
                else { currentField += char; }
            }
            fields.push(currentField);
            return fields.map(f => f.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));
        };
        const processedGuests = [];
        lines.slice(1).forEach(line => {
            if (!line.trim()) return;
            const values = parseCsvLine(line);
            const firstName = values[colIndices.firstName];
            const lastName = (values[colIndices.lastName] || '').trim();
            const partyId = colIndices.partyId !== -1 ? values[colIndices.partyId] : `${firstName}_${lastName}`;
            if (!firstName) return;
            const guestId = `${partyId}_${firstName.trim()}_${lastName}`;
            const primaryGuest = { id: guestId, partyId, firstName: firstName.trim(), lastName, seated: false, x: 0, y: 0, isPlusOne: false };
            processedGuests.push(primaryGuest);
            if (colIndices.additionalGuests !== -1) {
                const additionalGuestCount = parseInt(values[colIndices.additionalGuests]) || 0;
                for (let i = 1; i <= additionalGuestCount; i++) {
                    processedGuests.push({ id: `${guestId}_plus${i}`, partyId, firstName: `${primaryGuest.firstName} ${primaryGuest.lastName}'s`, lastName: `Guest ${i}`, seated: false, x: 0, y: 0, isPlusOne: true, plusOneIndex: i });
                }
            }
        });
        return processedGuests;
    }
    
    // --- Color Generation ---
    function getColorForPartyId(partyId, forStroke = false) {
        if (!partyId) return '#D1D5DB';
        if (!partyColors[partyId]) {
            const GOLDEN_ANGLE = 137.5;
            let hash = 0;
            for (let i = 0; i < partyId.length; i++) {
                hash = (hash << 5) - hash + partyId.charCodeAt(i);
                hash |= 0;
            }
            const hue = Math.abs(hash * GOLDEN_ANGLE) % 360;
            partyColors[partyId] = {
                fill: `hsl(${hue}, 70%, 80%)`,
                stroke: `hsl(${hue}, 60%, 65%)`
            };
        }
        return forStroke ? partyColors[partyId].stroke : partyColors[partyId].fill;
    }

    // --- Guest List Rendering ---
    function renderGuestList() {
        guestListContainer.innerHTML = '';
        const unseatedGuests = allGuests.filter(g => !g.seated);
        unseatedGuests.forEach(guest => {
            const li = document.createElement('li');
            li.textContent = `${guest.firstName} ${guest.lastName}`;
            li.dataset.guestId = guest.id;
            li.draggable = true;
            const partyColor = getColorForPartyId(guest.partyId, true);
            li.style.borderLeft = `5px solid ${partyColor}`;
            guestListContainer.appendChild(li);
        });
    }

    // --- Mode and Tool Management ---
    function setMode(mode) {
        currentMode = mode;
        canvas.style.cursor = mode.startsWith('draw') ? 'crosshair' : 'default';
        let activeButton = null;
        toolButtons.forEach(btn => {
            const isActive = btn.id.includes(mode);
            btn.classList.toggle('active', isActive);
            if (isActive) {
                activeButton = btn;
            }
        });
        updateActiveToolIndicator(activeButton);
        selectedShapeIndex = null; selectedGuestIndex = null;
        updateDeleteButton(); redrawCanvas();
    }

    function updateActiveToolIndicator(activeButton) {
        if (activeButton) {
            const buttonRect = activeButton.getBoundingClientRect();
            const toolbarRect = activeButton.parentElement.getBoundingClientRect();
            const indicatorSize = 6;
            const leftPosition = buttonRect.left - toolbarRect.left + (buttonRect.width / 2) - (indicatorSize / 2);
            activeToolIndicator.style.left = `${leftPosition}px`;
        }
    }

    drawTableButton.addEventListener('click', () => setMode('draw-table'));
    drawBarrierButton.addEventListener('click', () => setMode('draw-barrier'));
    selectToolButton.addEventListener('click', () => setMode('select'));
    
    // --- Canvas Event Handlers ---
    canvas.addEventListener('mousedown', (e) => {
        const rect = canvas.getBoundingClientRect();
        startX = e.clientX - rect.left;
        startY = e.clientY - rect.top;
        if (currentMode === 'select') {
            selectedGuestIndex = getGuestAt(startX, startY);
            if (selectedGuestIndex !== null) {
                isDraggingGuest = true;
                const guest = placedGuests[selectedGuestIndex];
                selectionOffsetX = startX - guest.x;
                selectionOffsetY = startY - guest.y;
            } else {
                selectedShapeIndex = getShapeAt(startX, startY);
                if (selectedShapeIndex !== null) {
                    isDraggingShape = true;
                    const shape = shapes[selectedShapeIndex];
                    selectionOffsetX = startX - shape.x;
                    selectionOffsetY = startY - shape.y;
                }
            }
        } else {
            isDrawing = true;
        }
        updateDeleteButton();
        redrawCanvas();
    });

    canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        if (isDrawing) {
            redrawCanvas();
            ctx.strokeStyle = 'rgba(0, 122, 255, 0.8)';
            ctx.lineWidth = 2;
            ctx.strokeRect(startX, startY, mouseX - startX, mouseY - startY);
        } else if (isDraggingShape) {
            const shape = shapes[selectedShapeIndex];
            shape.x = mouseX - selectionOffsetX;
            shape.y = mouseY - selectionOffsetY;
            redrawCanvas();
        } else if (isDraggingGuest) {
            const guest = placedGuests[selectedGuestIndex];
            guest.x = mouseX - selectionOffsetX;
            guest.y = mouseY - selectionOffsetY;
            redrawCanvas();
        } else {
            const guestIndex = getGuestAt(mouseX, mouseY);
            hoveredGuest = guestIndex !== null ? placedGuests[guestIndex] : null;
            redrawCanvas();
        }
    });

    canvas.addEventListener('mouseup', (e) => {
        const rect = canvas.getBoundingClientRect();
        const endX = e.clientX - rect.left;
        const endY = e.clientY - rect.top;

        if (isDrawing) {
            isDrawing = false;
            addShape(endX, endY);
        }
        if (isDraggingShape) isDraggingShape = false;
        if (isDraggingGuest) {
            isDraggingGuest = false;
            const guest = placedGuests[selectedGuestIndex];
            const tableIndex = getTableForGuest(guest);
            updateSeatedGuestsMap();
        }
        redrawCanvas();
    });

    canvas.addEventListener('dblclick', (e) => {
        const rect = canvas.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;
        const shapeIndex = getShapeAt(clickX, clickY);
        if (shapeIndex !== null && shapes[shapeIndex].type === 'table') {
            promptForTableDetails(shapeIndex);
        }
    });

    function addShape(endX, endY) {
        const shape = {
            type: currentMode === 'draw-table' ? 'table' : 'barrier',
            x: Math.min(startX, endX), y: Math.min(startY, endY),
            width: Math.abs(endX - startX), height: Math.abs(endY - startY)
        };
        if (shape.type === 'table') {
            shape.label = `Table ${shapes.filter(s => s.type === 'table').length + 1}`;
            shape.capacity = 8;
        }
        shapes.push(shape);
        setMode('select');
    }

    function promptForTableDetails(shapeIndex) {
        const table = shapes[shapeIndex];
        const newLabel = prompt("Enter table name/label:", table.label || "");
        if (newLabel) table.label = newLabel;
        const newCapacity = prompt("Enter table capacity:", table.capacity || 8);
        if (newCapacity && !isNaN(parseInt(newCapacity))) {
            table.capacity = parseInt(newCapacity);
        }
        redrawCanvas();
    }

    // --- Deletion and Selection ---
    deleteSelectedButton.addEventListener('click', () => {
        if (selectedGuestIndex !== null) {
            const guest = placedGuests[selectedGuestIndex];
            guest.seated = false;
            placedGuests.splice(selectedGuestIndex, 1);
            selectedGuestIndex = null;
            updateSeatedGuestsMap();
            renderGuestList();
            updateDeleteButton();
            redrawCanvas();
        } else if (selectedShapeIndex !== null) {
            const deletedShape = shapes.splice(selectedShapeIndex, 1)[0];
            if (deletedShape.type === 'table') {
                const guestsToUnseat = seatedGuestsMap.get(selectedShapeIndex) || [];
                guestsToUnseat.forEach(guestId => {
                    const guest = allGuests.find(g => g.id === guestId);
                    if(guest) {
                        guest.seated = false;
                        const placedIndex = placedGuests.findIndex(g => g.id === guestId);
                        if(placedIndex > -1) placedGuests.splice(placedIndex, 1);
                    }
                });
            }
            selectedShapeIndex = null;
            updateSeatedGuestsMap();
            renderGuestList();
            updateDeleteButton();
            redrawCanvas();
        }
    });
    
    function getShapeAt(x, y) {
        for (let i = shapes.length - 1; i >= 0; i--) {
            const shape = shapes[i];
            if (x >= shape.x && x <= shape.x + shape.width && y >= shape.y && y <= shape.y + shape.height) {
                return i;
            }
        }
        return null;
    }

    function getGuestAt(x, y) {
        for (let i = placedGuests.length - 1; i >= 0; i--) {
            const guest = placedGuests[i];
            const distance = Math.sqrt((x - guest.x)**2 + (y - guest.y)**2);
            if (distance <= GUEST_RADIUS) return i;
        }
        return null;
    }

    function updateDeleteButton() {
        deleteSelectedButton.disabled = selectedShapeIndex === null && selectedGuestIndex === null;
    }

    // --- Canvas Drawing ---
    function redrawCanvas() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const panelBg = getComputedStyle(document.documentElement).getPropertyValue('--panel-bg').trim();
        ctx.fillStyle = panelBg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-color').trim();
        const textMuted = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim();
        const primaryColor = getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim();

        shapes.forEach((shape, index) => {
            if (!shape) return;
            const isSelected = selectedShapeIndex === index;
            ctx.lineWidth = isSelected ? 3 : 2;
            ctx.strokeStyle = isSelected ? primaryColor : '#D1D5DB';
            
            if (shape.type === 'table') {
                const seatedCount = seatedGuestsMap.get(index)?.length || 0;
                ctx.fillStyle = seatedCount > (shape.capacity || 8) ? '#FEF2F2' : panelBg;
                ctx.fillRect(shape.x, shape.y, shape.width, shape.height);
                ctx.strokeRect(shape.x, shape.y, shape.width, shape.height);
                
                ctx.fillStyle = textColor;
                ctx.font = 'bold 14px "Playfair Display", serif';
                ctx.textAlign = 'center';
                ctx.fillText(shape.label || 'Table', shape.x + shape.width / 2, shape.y + 22);
                
                ctx.font = '12px "Playfair Display", serif';
                ctx.fillStyle = textMuted;
                ctx.fillText(`${seatedCount} / ${shape.capacity || 8}`, shape.x + shape.width / 2, shape.y + shape.height - 18);
            } else {
                ctx.fillStyle = '#374151';
                ctx.strokeStyle = '#4B5563';
                ctx.fillRect(shape.x, shape.y, shape.width, shape.height);
                ctx.strokeRect(shape.x, shape.y, shape.width, shape.height);
            }
        });
        
        placedGuests.forEach(guest => {
            if (!guest) return;
            ctx.lineWidth = 2;
            const strokeColor = getColorForPartyId(guest.partyId, true);
            if (guest.isPlusOne) {
                ctx.strokeStyle = strokeColor;
                ctx.fillStyle = '#ffffff';
            } else {
                ctx.fillStyle = getColorForPartyId(guest.partyId, false);
                ctx.strokeStyle = strokeColor;
            }
            ctx.beginPath();
            ctx.arc(guest.x, guest.y, GUEST_RADIUS, 0, 2 * Math.PI);
            ctx.shadowColor = 'rgba(0,0,0,0.1)';
            ctx.shadowBlur = 4;
            ctx.shadowOffsetY = 2;
            ctx.fill();
            ctx.shadowColor = 'transparent';
            ctx.stroke();

            ctx.fillStyle = '#111827';
            ctx.font = 'bold 11px "Playfair Display", serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const initials = guest.isPlusOne ? `+${guest.plusOneIndex}` : `${guest.firstName[0] || ''}${guest.lastName[0] || ''}`;
            ctx.fillText(initials, guest.x, guest.y);
        });

        if (hoveredGuest) {
            const text = `${hoveredGuest.firstName} ${hoveredGuest.lastName}`;
            ctx.font = '12px "Playfair Display", serif';
            const textWidth = ctx.measureText(text).width;
            ctx.fillStyle = 'rgba(17, 24, 39, 0.9)';
            ctx.fillRect(hoveredGuest.x + 15, hoveredGuest.y - 35, textWidth + 16, 26);
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'left';
            ctx.fillText(text, hoveredGuest.x + 23, hoveredGuest.y - 22);
        }
    }

    // --- Drag and Drop Logic ---
    function getTableForGuest(guest) {
        for (let i = shapes.length - 1; i >= 0; i--) {
            const shape = shapes[i];
            if (shape.type === 'table') {
                const closestX = Math.max(shape.x, Math.min(guest.x, shape.x + shape.width));
                const closestY = Math.max(shape.y, Math.min(guest.y, shape.y + shape.height));
                const distance = Math.sqrt((guest.x - closestX)**2 + (guest.y - closestY)**2);
                if (distance <= GUEST_RADIUS) {
                    return i;
                }
            }
        }
        return -1;
    }

    function updateSeatedGuestsMap() {
        seatedGuestsMap.clear();
        shapes.forEach((shape, index) => {
            if (shape.type === 'table') seatedGuestsMap.set(index, []);
        });
        placedGuests.forEach(guest => {
            const tableIndex = getTableForGuest(guest);
            if (tableIndex !== -1) {
                seatedGuestsMap.get(tableIndex).push(guest.id);
            }
        });
    }

    guestListContainer.addEventListener('dragstart', (e) => {
        if (e.target.dataset.guestId) {
            e.dataTransfer.setData('text/plain', e.target.dataset.guestId);
        }
    });

    canvas.addEventListener('dragover', (e) => e.preventDefault());

    canvas.addEventListener('drop', (e) => {
        e.preventDefault();
        const guestId = e.dataTransfer.getData('text/plain');
        const guest = allGuests.find(g => g.id === guestId);
        if (guest) {
            const rect = canvas.getBoundingClientRect();
            guest.x = e.clientX - rect.left;
            guest.y = e.clientY - rect.top;
            guest.seated = true;
            if (!placedGuests.find(p => p.id === guest.id)) {
                placedGuests.push(guest);
            }
            updateSeatedGuestsMap();
            renderGuestList();
            redrawCanvas();
        }
    });

    guestListContainer.addEventListener('dragover', e => e.preventDefault());
    
    guestListContainer.addEventListener('drop', e => {
        if(selectedGuestIndex !== null) {
            const guest = placedGuests[selectedGuestIndex];
            guest.seated = false;
            placedGuests.splice(selectedGuestIndex, 1);
            selectedGuestIndex = null;
            updateSeatedGuestsMap();
            renderGuestList();
            redrawCanvas();
        }
    });

    // --- Save/Load and Clear ---
    clearCanvasButton.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear everything? This cannot be undone.')) {
            shapes = [];
            placedGuests = [];
            partyColors = {};
            allGuests.forEach(g => g.seated = false);
            updateSeatedGuestsMap();
            renderGuestList();
            redrawCanvas();
        }
    });

    savePlanButton.addEventListener('click', () => {
        const placedGuestIds = new Set(placedGuests.map(g => g.id));
        allGuests.forEach(guest => {
            guest.seated = placedGuestIds.has(guest.id);
        });

        const state = {
            version: 2,
            allGuests,
            shapes,
        };
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", "seating_plan.json");
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    });

    loadPlanButton.addEventListener('click', () => loadFileInput.click());
    
    loadFileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const state = JSON.parse(e.target.result);
                allGuests = state.allGuests || state.guests || [];
                shapes = state.shapes || [];
                placedGuests = allGuests.filter(g => g && g.seated);
                partyColors = {};
                updateSeatedGuestsMap();
                renderGuestList();
                redrawCanvas();
                alert('Plan loaded successfully!');
            } catch (error) {
                alert('Failed to load or parse the plan file. ' + error.message);
            }
        };
        reader.readAsText(file);
        loadFileInput.value = '';
    });
    
    // --- UI Animations & Initial Setup ---
    const toolbarButtons = document.querySelectorAll('#toolbar button');
    let closeTimeout = null;

    toolbarButtons.forEach(button => {
        button.addEventListener('mouseenter', () => {
            if (closeTimeout) {
                clearTimeout(closeTimeout);
                closeTimeout = null;
            }
            toolbarButtons.forEach(btn => {
                if (btn !== button) btn.classList.remove('expanded');
            });
            button.classList.add('expanded');
            updateActiveToolIndicator(document.querySelector('#toolbar button.active'));
        });

        button.addEventListener('mouseleave', () => {
            closeTimeout = setTimeout(() => {
                button.classList.remove('expanded');
                updateActiveToolIndicator(document.querySelector('#toolbar button.active'));
            }, 300);
        });
    });

    setMode('select');
    renderGuestList();
    redrawCanvas();

    const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    darkModeMediaQuery.addEventListener('change', () => {
        redrawCanvas();
    });
});
