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
    const clearCanvasButton = document.getElementById('clear-canvas');
    const savePlanButton = document.getElementById('save-plan');
    const loadPlanButton = document.getElementById('load-plan');

    // --- Application State ---
    let allGuests = [];
    let placedGuests = [];
    let shapes = [];
    let seatedGuestsMap = new Map();
    let partyColors = {};

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
            } catch (error) {
                console.error("CSV Parse Error:", error);
                alert(`Failed to parse CSV file: ${error.message}`);
            }
        };
        reader.readAsText(file);
    }
    
    function handleMergeCsvLoad(file) {
        if (!file) return;
        if (allGuests.length === 0) {
            alert("Please load a project JSON or a base CSV before merging.");
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const newGuestList = parseRobustCSV(e.target.result);
                reconcileGuestLists(newGuestList);
            } catch (error) {
                console.error("CSV Merge Error:", error);
                alert(`Failed to merge CSV file: ${error.message}`);
            }
        };
        reader.readAsText(file);
    }

    function reconcileGuestLists(newGuestList) {
        const getNameKey = g => g ? `${g.firstName}_${g.lastName}` : null;
        const oldGuestStates = new Map();
        allGuests.forEach(g => {
            if (g) oldGuestStates.set(getNameKey(g), { seated: g.seated, x: g.x, y: g.y });
        });
        
        newGuestList.forEach(newGuest => {
            if (newGuest) {
                const nameKey = getNameKey(newGuest);
                if (oldGuestStates.has(nameKey)) {
                    const oldState = oldGuestStates.get(nameKey);
                    newGuest.seated = oldState.seated;
                    newGuest.x = oldState.x;
                    newGuest.y = oldState.y;
                }
            }
        });

        allGuests = newGuestList.filter(Boolean);
        placedGuests = allGuests.filter(g => g && g.seated);
        
        partyColors = {};
        updateSeatedGuestsMap();
        renderGuestList();
        alert('Guest list successfully merged! Existing placements have been preserved.');
    }

    function parseRobustCSV(text) {
        const lines = text.trim().split("\n");
        if (lines.length < 2) throw new Error("CSV file must have a header row and at least one data row.");
        const delimiter = lines[0].includes('	') ? '	' : ',';
        const header = lines[0].split(delimiter).map(h => h.trim().replace(/^"|"$/g, ''));
        const findIndex = names => names.reduce((acc, name) => acc !== -1 ? acc : header.findIndex(h => h.toLowerCase().replace(/\s/g, '') === name), -1);
        const colIndices = {
            firstName: findIndex(['firstname']), lastName: findIndex(['lastname']),
            additionalGuests: findIndex(['additionalguests', 'additional guest']), partyId: findIndex(['partyid'])
        };
        if (colIndices.firstName === -1 || colIndices.lastName === -1) throw new Error("'FirstName' and 'LastName' columns not found.");
        const parseCsvLine = line => {
            const fields = [];
            let currentField = '';
            let inQuotes = false;
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                if (char === '"') {
                    if (inQuotes && line[i + 1] === '"') { currentField += '"'; i++; } 
                    else { inQuotes = !inQuotes; }
                } else if (char === delimiter && !inQuotes) {
                    fields.push(currentField);
                    currentField = '';
                } else {
                    currentField += char;
                }
            }
            fields.push(currentField);
            return fields.map(f => f.trim());
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
    
    function getColorForPartyId(partyId, forStroke = false) {
        if (!partyId) return '#A0AEC0';
        if (!partyColors[partyId]) {
            const GOLDEN_ANGLE = 137.5;
            let hash = 0;
            for (let i = 0; i < partyId.length; i++) {
                hash = (hash << 5) - hash + partyId.charCodeAt(i);
                hash |= 0;
            }
            const hue = Math.abs(hash * GOLDEN_ANGLE) % 360;
            partyColors[partyId] = { fill: `hsl(${hue}, 90%, 70%)`, stroke: `hsl(${hue}, 80%, 55%)` };
        }
        return forStroke ? partyColors[partyId].stroke : partyColors[partyId].fill;
    }

    function renderGuestList() {
        guestListContainer.innerHTML = '';
        allGuests.sort((a,b) => a.lastName.localeCompare(b.lastName)).forEach(guest => {
            if (guest && !guest.seated) {
                const li = document.createElement('li');
                li.textContent = `${guest.firstName} ${guest.lastName}`;
                li.draggable = true;
                li.dataset.guestId = guest.id;
                guestListContainer.appendChild(li);
            }
        });
    }

    function setMode(mode) {
        currentMode = mode;
        canvas.style.cursor = mode.startsWith('draw') ? 'crosshair' : 'default';
        selectedShapeIndex = null; selectedGuestIndex = null;
        updateDeleteButton(); redrawCanvas();
    }
    drawTableButton.addEventListener('click', () => setMode('draw-table'));
    drawBarrierButton.addEventListener('click', () => setMode('draw-barrier'));
    selectToolButton.addEventListener('click', () => setMode('select'));
    
    canvas.addEventListener('mousedown', (e) => {
        startX = e.offsetX; startY = e.offsetY;
        if (currentMode.startsWith('draw')) isDrawing = true;
        else if (currentMode === 'select') {
            selectedGuestIndex = getGuestAt(startX, startY);
            selectedShapeIndex = selectedGuestIndex === null ? getShapeAt(startX, startY) : null;
            if (selectedGuestIndex !== null) {
                isDraggingGuest = true;
                const guest = placedGuests[selectedGuestIndex];
                selectionOffsetX = startX - guest.x; selectionOffsetY = startY - guest.y;
            } else if (selectedShapeIndex !== null) {
                isDraggingShape = true;
                const shape = shapes[selectedShapeIndex];
                selectionOffsetX = startX - shape.x; selectionOffsetY = startY - shape.y;
            }
            updateDeleteButton(); redrawCanvas();
        }
    });
    
    canvas.addEventListener('mousemove', (e) => {
        const { offsetX, offsetY } = e;
        if (isDrawing) {
            redrawCanvas();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.rect(startX, startY, offsetX - startX, offsetY - startY);
            ctx.stroke();
            ctx.setLineDash([]);
        } else if (isDraggingGuest && selectedGuestIndex !== null) {
            placedGuests[selectedGuestIndex].x = offsetX - selectionOffsetX;
            placedGuests[selectedGuestIndex].y = offsetY - selectionOffsetY;
            updateSeatedGuestsMap();
        } else if (isDraggingShape && selectedShapeIndex !== null) {
            shapes[selectedShapeIndex].x = offsetX - selectionOffsetX;
            shapes[selectedShapeIndex].y = offsetY - selectionOffsetY;
            redrawCanvas();
        } else if (currentMode === 'select') {
            hoveredGuest = getGuestAt(offsetX, offsetY) !== null ? placedGuests[getGuestAt(offsetX, offsetY)] : null;
            canvas.style.cursor = (hoveredGuest || getShapeAt(offsetX, offsetY) !== null) ? 'move' : 'default';
            redrawCanvas();
        }
    });

    canvas.addEventListener('mouseup', (e) => {
        if (isDrawing) addShape(e.offsetX, e.offsetY);
        isDrawing = false; isDraggingShape = false; isDraggingGuest = false;
        updateSeatedGuestsMap();
    });

    canvas.addEventListener('dblclick', (e) => {
        if (currentMode === 'select') {
            const shapeIndex = getShapeAt(e.offsetX, e.offsetY);
            if (shapeIndex !== null && shapes[shapeIndex].type === 'table') promptForTableDetails(shapeIndex);
        }
    });

    function addShape(endX, endY) {
        const rect = { x: Math.min(startX, endX), y: Math.min(startY, endY), width: Math.abs(startX - endX), height: Math.abs(startY - endY) };
        if (rect.width > 10 && rect.height > 10) {
            const type = currentMode === 'draw-table' ? 'table' : 'barrier';
            const newShape = { type, ...rect, label: `Table ${shapes.filter(s=>s.type==='table').length+1}`, capacity: 8 };
            shapes.push(newShape);
            if (type === 'table') promptForTableDetails(shapes.length - 1);
        }
        setMode('select');
    }

    function promptForTableDetails(shapeIndex) {
        const shape = shapes[shapeIndex];
        const newLabel = prompt("Enter table label:", shape.label);
        if (newLabel) shape.label = newLabel;
        const newCapacity = prompt("Enter max capacity:", shape.capacity);
        const capacityNum = parseInt(newCapacity);
        if (!isNaN(capacityNum) && capacityNum >= 0) shape.capacity = capacityNum;
        redrawCanvas();
    }

    deleteSelectedButton.addEventListener('click', () => {
        if (selectedShapeIndex === null) return;
        const guestsOnTable = seatedGuestsMap.get(selectedShapeIndex) || [];
        guestsOnTable.forEach(guest => {
            if(guest) guest.seated = false;
            const idx = placedGuests.findIndex(p => p && p.id === guest.id);
            if(idx > -1) placedGuests.splice(idx, 1);
        });
        shapes.splice(selectedShapeIndex, 1);
        selectedShapeIndex = null;
        updateDeleteButton();
        updateSeatedGuestsMap();
        renderGuestList();
    });

    function getShapeAt(x, y) {
        for (let i = shapes.length - 1; i >= 0; i--) {
            const s = shapes[i];
            if (s && x >= s.x && x <= s.x + s.width && y >= s.y && y <= s.y + s.height) return i;
        }
        return null;
    }
    function getGuestAt(x, y) {
        for (let i = placedGuests.length - 1; i >= 0; i--) {
            const g = placedGuests[i];
            if (g && Math.hypot(x - g.x, y - g.y) < GUEST_RADIUS) return i;
        }
        return null;
    }
    function updateDeleteButton() { deleteSelectedButton.disabled = selectedShapeIndex === null; }

    function redrawCanvas() {
        ctx.fillStyle = '#1A202C';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = '#2D3748';
        ctx.lineWidth = 1;
        for (let x = 20; x < canvas.width; x += 20) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
        for (let y = 20; y < canvas.height; y += 20) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }
        shapes.forEach((shape, index) => {
            if (!shape) return;
            const isSelected = selectedShapeIndex === index;
            ctx.lineWidth = isSelected ? 3 : 2;
            ctx.strokeStyle = isSelected ? '#38B2AC' : '#4A5568';
            if (shape.type === 'table') {
                const seatedCount = seatedGuestsMap.get(index)?.length || 0;
                ctx.fillStyle = seatedCount > (shape.capacity || 8) ? 'rgba(197, 48, 48, 0.5)' : '#2D3748';
                ctx.fillRect(shape.x, shape.y, shape.width, shape.height);
                ctx.strokeRect(shape.x, shape.y, shape.width, shape.height);
                ctx.fillStyle = '#E2E8F0';
                ctx.font = 'bold 13px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(shape.label || 'Table', shape.x + shape.width / 2, shape.y + 20);
                ctx.font = '11px Inter, sans-serif';
                ctx.fillStyle = '#A0AEC0';
                ctx.fillText(`${seatedCount} / ${shape.capacity || 8}`, shape.x + shape.width / 2, shape.y + shape.height - 15);
            } else {
                ctx.fillStyle = '#171923';
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
                ctx.fillStyle = '#1A202C';
            } else {
                ctx.fillStyle = getColorForPartyId(guest.partyId, false);
                ctx.strokeStyle = strokeColor;
            }
            ctx.beginPath();
            ctx.arc(guest.x, guest.y, GUEST_RADIUS, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = '#1A202C';
            ctx.font = 'bold 11px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const initials = guest.isPlusOne ? `+${guest.plusOneIndex}` : `${guest.firstName[0] || ''}${guest.lastName[0] || ''}`;
            ctx.fillText(initials, guest.x, guest.y);
        });
        if (hoveredGuest) {
            const text = `${hoveredGuest.firstName} ${hoveredGuest.lastName}`;
            const textWidth = ctx.measureText(text).width;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.fillRect(hoveredGuest.x + 15, hoveredGuest.y - 35, textWidth + 12, 24);
            ctx.fillStyle = '#fff';
            ctx.font = '12px Inter, sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(text, hoveredGuest.x + 21, hoveredGuest.y - 23);
        }
    }

    function getTableForGuest(guest) {
        for (let i = shapes.length - 1; i >= 0; i--) {
            const shape = shapes[i];
            if (shape && shape.type === 'table') {
                const circle = { x: guest.x, y: guest.y, radius: GUEST_RADIUS };
                const rect = { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
                const closestX = Math.max(rect.x, Math.min(circle.x, rect.x + rect.width));
                const closestY = Math.max(rect.y, Math.min(circle.y, rect.y + rect.height));
                const distanceSquared = Math.pow(circle.x - closestX, 2) + Math.pow(circle.y - closestY, 2);
                if (distanceSquared < (circle.radius * circle.radius)) {
                    return i;
                }
            }
        }
        return null;
    }

    function updateSeatedGuestsMap() {
        seatedGuestsMap.clear();
        for (const guest of placedGuests) {
            if (!guest) continue;
            const tableIndex = getTableForGuest(guest);
            if (tableIndex !== null) {
                if (!seatedGuestsMap.has(tableIndex)) seatedGuestsMap.set(tableIndex, []);
                seatedGuestsMap.get(tableIndex).push(guest);
            }
        }
        redrawCanvas();
    }
    guestListContainer.addEventListener('dragstart', (e) => { if (e.target.tagName === 'LI') e.dataTransfer.setData('text/plain', e.target.dataset.guestId); });
    canvas.addEventListener('dragover', (e) => e.preventDefault());
    canvas.addEventListener('drop', (e) => {
        e.preventDefault();
        const guestId = e.dataTransfer.getData('text/plain');
        const guest = allGuests.find(g => g && g.id === guestId);
        if (guest && !guest.seated) {
            guest.seated = true; guest.x = e.offsetX; guest.y = e.offsetY;
            placedGuests.push(guest);
            updateSeatedGuestsMap(); renderGuestList();
        }
    });
    guestListContainer.addEventListener('dragover', e => e.preventDefault());
    guestListContainer.addEventListener('drop', e => {
        if (isDraggingGuest && selectedGuestIndex !== null) {
            const guest = placedGuests[selectedGuestIndex];
            if(guest) guest.seated = false;
            placedGuests.splice(selectedGuestIndex, 1);
            isDraggingGuest = false; selectedGuestIndex = null;
            updateSeatedGuestsMap(); renderGuestList();
        }
    });

    clearCanvasButton.addEventListener('click', () => {
        shapes = []; placedGuests = []; allGuests = []; partyColors = {};
        updateSeatedGuestsMap(); renderGuestList();
    });
    savePlanButton.addEventListener('click', () => {
        const dataStr = JSON.stringify({ allGuests, shapes, placedGuests, partyColors }, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'seating-plan.json';
        a.click();
        URL.revokeObjectURL(a.href);
    });
    loadPlanButton.addEventListener('click', () => loadFileInput.click());
    loadFileInput.addEventListener('change', (event) => {
        const file = event.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                allGuests = (data.allGuests || []).filter(Boolean);
                partyColors = data.partyColors || {};
                shapes = (data.shapes || []).map(s => ({ label: 'Table', capacity: 8, ...s })).filter(Boolean);
                placedGuests = (data.placedGuests || []).filter(Boolean);
                if (allGuests.length === 0 && placedGuests.length > 0) {
                    allGuests = [...placedGuests];
                }
                updateSeatedGuestsMap(); renderGuestList();
            } catch (error) {
                console.error("Load failed:", error);
                alert(`Could not load plan: ${error.message}`);
            }
        };
        reader.readAsText(file);
    });
    
    setMode('select');
    renderGuestList();
});
