// Polyfill for CanvasRenderingContext2D.roundRect
if (CanvasRenderingContext2D.prototype.roundRect === undefined) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, width, height, radius) {
      if (width < 2 * radius) radius = width / 2;
      if (height < 2 * radius) radius = height / 2;
      this.beginPath();
      this.moveTo(x + radius, y);
      this.arcTo(x + width, y, x + width, y + height, radius);
      this.arcTo(x + width, y + height, x, y + height, radius);
      this.arcTo(x, y + height, x, y, radius);
      this.arcTo(x, y, x + width, y, radius);
      this.closePath();
      return this;
    }
}

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
    let animationLoopRunning = false;

    // --- Helper Functions ---
    const lerp = (start, end, amt) => (1 - amt) * start + amt * end;
    const initializeGuestAnimation = (guest) => {
        if (guest && typeof guest.hoverProgress === 'undefined') {
            guest.hoverProgress = 0;
        }
    };

    // --- Animation Loop ---
    function animationLoop() {
        let needsRedraw = false;
        const animationSpeed = 0.3; // Increased speed

        placedGuests.forEach(guest => {
            const targetProgress = (hoveredGuest && guest.id === hoveredGuest.id) ? 1 : 0;
            if (Math.abs(guest.hoverProgress - targetProgress) > 0.001) {
                guest.hoverProgress = lerp(guest.hoverProgress, targetProgress, animationSpeed);
                needsRedraw = true;
            } else if (guest.hoverProgress !== targetProgress) {
                guest.hoverProgress = targetProgress;
                needsRedraw = true;
            }
        });

        if (needsRedraw) {
            redrawCanvas();
            requestAnimationFrame(animationLoop);
        } else {
            animationLoopRunning = false;
        }
    }

    function startAnimation() {
        if (!animationLoopRunning) {
            animationLoopRunning = true;
            requestAnimationFrame(animationLoop);
        }
    }

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
                allGuests.forEach(initializeGuestAnimation);
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
        const oldGuestStates = new Map(allGuests.map(g => [getNameKey(g), { seated: g.seated, x: g.x, y: g.y, hoverProgress: g.hoverProgress || 0 }]));
        newGuestList.forEach(newGuest => {
            const nameKey = getNameKey(newGuest);
            if (oldGuestStates.has(nameKey)) {
                const oldState = oldGuestStates.get(nameKey);
                Object.assign(newGuest, oldState);
            }
            initializeGuestAnimation(newGuest);
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
            const nameSpan = document.createElement('span');
            nameSpan.textContent = `${guest.firstName} ${guest.lastName}`;
            li.appendChild(nameSpan);

            li.dataset.guestId = guest.id;
            li.draggable = true;

            // Don't let plus-ones have their own plus-ones
            if (!guest.isPlusOne) {
                const addPlusOneButton = document.createElement('button');
                addPlusOneButton.textContent = '+1';
                addPlusOneButton.className = 'add-plus-one';
                addPlusOneButton.dataset.parentId = guest.id;
                li.appendChild(addPlusOneButton);
            }

            const partyColor = getColorForPartyId(guest.partyId, true);
            li.style.borderLeft = `5px solid ${partyColor}`;
            guestListContainer.appendChild(li);
        });
    }

    function addPlusOne(parentId) {
        const parentGuest = allGuests.find(g => g.id === parentId);
        if (!parentGuest) {
            console.error("Parent guest not found");
            return;
        }

        const plusOneName = prompt(`Enter the full name for ${parentGuest.firstName} ${parentGuest.lastName}'s guest:`);
        if (!plusOneName || !plusOneName.trim()) {
            return;
        }

        const nameParts = plusOneName.trim().split(' ');
        const firstName = nameParts[0];
        const lastName = nameParts.slice(1).join(' ') || '(Guest)';

        const newGuest = {
            id: `${parentGuest.id}_plus_${Date.now()}`,
            partyId: parentGuest.partyId,
            firstName: firstName,
            lastName: lastName,
            seated: false,
            x: 0,
            y: 0,
            isPlusOne: true,
        };
        initializeGuestAnimation(newGuest);
        allGuests.push(newGuest);
        renderGuestList();
    }

    // --- Mode and Tool Management ---
    function setMode(mode) {
        currentMode = mode;
        canvas.style.cursor = mode.startsWith('draw') ? 'crosshair' : 'default';
        toolButtons.forEach(btn => {
            btn.classList.toggle('active', btn.id.includes(mode));
        });
        selectedShapeIndex = null; selectedGuestIndex = null;
        updateDeleteButton(); redrawCanvas();
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
                hoveredGuest = null;
                startAnimation();
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
            const newHoveredGuest = guestIndex !== null ? placedGuests[guestIndex] : null;
            if (newHoveredGuest !== hoveredGuest) {
                hoveredGuest = newHoveredGuest;
                startAnimation();
            }
        }
    });

    canvas.addEventListener('mouseup', (e) => {
        if (isDrawing) {
            isDrawing = false;
            const rect = canvas.getBoundingClientRect();
            const endX = e.clientX - rect.left;
            const endY = e.clientY - rect.top;
            addShape(endX, endY);
        }
        if (isDraggingShape) isDraggingShape = false;
        if (isDraggingGuest) {
            isDraggingGuest = false;
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
        } else if (selectedShapeIndex !== null) {
            const deletedShape = shapes.splice(selectedShapeIndex, 1)[0];
            if (deletedShape.type === 'table') {
                const guestsToUnseat = seatedGuestsMap.get(selectedShapeIndex) || [];
                guestsToUnseat.forEach(guestId => {
                    const guest = allGuests.find(g => g.id === guestId);
                    if(guest) {
                        guest.seated = false;
                        const placedIndex = placedGuests.findIndex(p => p.id === guestId);
                        if(placedIndex > -1) placedGuests.splice(placedIndex, 1);
                    }
                });
            }
            selectedShapeIndex = null;
            updateSeatedGuestsMap();
            renderGuestList();
        }
        updateDeleteButton();
        redrawCanvas();
    });
    
    function getShapeAt(x, y) {
        for (let i = shapes.length - 1; i >= 0; i--) {
            const shape = shapes[i];
            if (x >= shape.x && x <= shape.x + shape.width && y >= shape.y && y <= shape.y + shape.height) return i;
        }
        return null;
    }

    function getGuestAt(x, y) {
        // Prioritize hovered guest for easier interaction
        const sortedGuests = [...placedGuests].sort((a, b) => {
            if (!hoveredGuest) return 0;
            if (a.id === hoveredGuest.id) return 1;
            if (b.id === hoveredGuest.id) return -1;
            return 0;
        });

        for (let i = sortedGuests.length - 1; i >= 0; i--) {
            const guest = sortedGuests[i];
            const distance = Math.sqrt((x - guest.x)**2 + (y - guest.y)**2);
            if (distance <= GUEST_RADIUS) {
                return placedGuests.findIndex(p => p.id === guest.id);
            }
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
        
        const sortedGuests = [...placedGuests].sort((a, b) => a.hoverProgress - b.hoverProgress);

        sortedGuests.forEach(guest => {
            const progress = guest.hoverProgress;
            
            const largeFont = 'bold 14px "Playfair Display", serif';
            const smallFont = 'bold 11px "Playfair Display", serif';
            const text = `${guest.firstName} ${guest.lastName}`;

            ctx.font = largeFont;
            const textMetrics = ctx.measureText(text);
            const targetWidth = textMetrics.width + 20;
            const startWidth = GUEST_RADIUS * 2;
            const currentWidth = lerp(startWidth, targetWidth, progress);
            const currentHeight = GUEST_RADIUS * 2;
            
            let rectX = guest.x - currentWidth / 2;
            let rectY = guest.y - currentHeight / 2;

            // Boundary checks
            if (rectX < 0) rectX = 0;
            if (rectX + currentWidth > canvas.width) rectX = canvas.width - currentWidth;
            if (rectY < 0) rectY = 0;
            if (rectY + currentHeight > canvas.height) rectY = canvas.height - currentHeight;

            const startRadius = GUEST_RADIUS;
            const endRadius = 8;
            const currentRadius = lerp(startRadius, endRadius, progress);
            
            ctx.lineWidth = 2;
            ctx.strokeStyle = getColorForPartyId(guest.partyId, true);
            ctx.fillStyle = guest.isPlusOne ? '#ffffff' : getColorForPartyId(guest.partyId, false);
            ctx.shadowColor = `rgba(0,0,0,${lerp(0.1, 0.2, progress)})`;
            ctx.shadowBlur = lerp(4, 8, progress);
            ctx.shadowOffsetY = lerp(2, 4, progress);
            
            ctx.beginPath();
            ctx.roundRect(rectX, rectY, currentWidth, currentHeight, currentRadius);
            ctx.fill();
            ctx.stroke();
            
            ctx.shadowColor = 'transparent';
            
            ctx.fillStyle = '#111827';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            const initials = (guest.isPlusOne && guest.plusOneIndex) ? `+${guest.plusOneIndex}` : `${guest.firstName[0] || ''}${guest.lastName[0] || ''}`;
            const textY = rectY + currentHeight / 2;
            
            if (progress < 0.5) {
                ctx.globalAlpha = 1 - (progress * 2);
                ctx.font = smallFont;
                ctx.fillText(initials, guest.x, textY);
            }
            
            if (progress > 0.5) {
                ctx.globalAlpha = (progress - 0.5) * 2;
                ctx.font = largeFont;
                ctx.fillText(text, rectX + currentWidth / 2, textY);
            }
            
            ctx.globalAlpha = 1;
        });
    }

    // --- Drag and Drop Logic ---
    function getTableForGuest(guest) {
        for (let i = shapes.length - 1; i >= 0; i--) {
            const shape = shapes[i];
            if (shape.type === 'table') {
                const closestX = Math.max(shape.x, Math.min(guest.x, shape.x + shape.width));
                const closestY = Math.max(shape.y, Math.min(guest.y, shape.y + shape.height));
                if (Math.sqrt((guest.x - closestX)**2 + (guest.y - closestY)**2) <= GUEST_RADIUS) return i;
            }
        }
        return -1;
    }

    function updateSeatedGuestsMap() {
        seatedGuestsMap.clear();
        shapes.forEach((_, index) => { if (shapes[index].type === 'table') seatedGuestsMap.set(index, []); });
        placedGuests.forEach(guest => {
            const tableIndex = getTableForGuest(guest);
            if (tableIndex !== -1) seatedGuestsMap.get(tableIndex).push(guest.id);
        });
    }

    guestListContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('add-plus-one')) addPlusOne(e.target.dataset.parentId);
    });

    guestListContainer.addEventListener('dragstart', (e) => {
        if (e.target.dataset.guestId) e.dataTransfer.setData('text/plain', e.target.dataset.guestId);
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
            if (!placedGuests.some(p => p.id === guest.id)) {
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
                allGuests.forEach(initializeGuestAnimation);
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
            if (closeTimeout) { clearTimeout(closeTimeout); closeTimeout = null; }
            toolbarButtons.forEach(btn => { if (btn !== button) btn.classList.remove('expanded'); });
            button.classList.add('expanded');
        });
        button.addEventListener('mouseleave', () => {
            closeTimeout = setTimeout(() => button.classList.remove('expanded'), 300);
        });
    });

    setMode('select');
    renderGuestList();
    redrawCanvas();

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redrawCanvas);
});
