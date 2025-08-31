# Wedding Seating Simulator

This is a web-based application for creating and managing wedding seating charts. It allows you to import a guest list from a CSV file, design a floor plan on a canvas, and assign guests to tables by dragging and dropping them.

## Features

- **Import Guest List**: Load your guest list from a CSV file. The application automatically groups guests by party and assigns unique colors for easy identification.
- **Visual Floor Plan**: 
    - Draw and arrange tables and barriers on a canvas to replicate your venue's layout.
    - Right-click on elements to access a context menu for quick actions like editing details or deleting items.
    - Support for both rectangular and circular tables.
- **Drag & Drop Seating**: 
    - Easily assign guests to tables by dragging them from the unseated list onto a table on the floor plan.
    - A trash can icon appears when dragging guests or tables, allowing for easy removal.
- **Table Management**: Set custom names and capacities for each table. The UI will indicate if a table is over-capacity.
- **Save & Load**: Save your entire seating plan, including the guest list, floor plan, and assignments, to a JSON file. You can load this file later to continue your work.
- **PDF Export**: Export your floor plan and a detailed seating legend to a PDF document, perfect for sharing or printing.
- **Update Guest List**: Merge an updated CSV file with an existing plan. The application intelligently preserves the seating arrangements of existing guests.
- **Add "+1s"**: Add additional guests (plus-ones) directly from the guest list interface.

## How to Use

1.  **Prepare Your Guest List**: Create a CSV file with your guest information. The file should contain the following columns:
    - `FirstName`
    - `LastName`
    - `PartyID` (A unique identifier to group guests who should be seated together)
    - `AdditionalGuests` (The number of "+1" guests associated with a primary guest)

    *Example `guests.csv`:*
    ```csv
    FirstName,LastName,PartyID,AdditionalGuests
    John,Smith,1,1
    Jane,Doe,2,0
    Peter,Jones,2,0
    Michael,Davis,3,0
    Emily,Wilson,3,1
    ```

2.  **Load the Guest List**: Open `index.html` in your web browser. Click the "Choose CSV File" button and select your prepared `guests.csv` file. The unseated guests will appear in the "Guest List" panel.

3.  **Design Your Floor Plan**:
    - Use the **Draw Table** and **Draw Barrier** tools to create the layout of your venue on the canvas.
    - To draw a circular table, hold down the **Shift** key while drawing.
    - Right-click a table to set its name and capacity or to delete it.

4.  **Seat Your Guests**:
    - Drag a guest's name from the list and drop them onto a table. A colored circle representing the guest will appear on the canvas.
    - You can move seated guests around the canvas or drag them back to the guest list to unseat them.

5.  **Save Your Progress**: Click the **Save** button to download a `seating_plan.json` file containing all your work.

6.  **Load a Plan**: Use the **Load** button to upload a previously saved `.json` file and restore your session. An `example.json` is included in this repository to demonstrate the functionality.

## File Formats

### JSON State File (`seating_plan.json`)

The application saves its state in a structured JSON file. This file contains two main parts:

- `shapes`: An array of objects representing the tables and barriers on the canvas. Each object includes its type, position, and dimensions. Tables also have a `label` and `capacity`.
- `allGuests`: An array of all guest objects, including their name, party ID, and seating status (`seated`, `x`, `y` coordinates).
