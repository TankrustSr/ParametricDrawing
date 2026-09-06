import { UIController } from './ui.js';
import { DrawingController } from './drawing.js';
import { ExportController } from './export.js';

document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('main-canvas');
    const ctx = canvas.getContext('2d');

    // Instantiate controllers
    const drawingController = new DrawingController(ctx);
    const exportController = new ExportController(drawingController);
    
    // UI controller orchestrates the interactions
    const ui = new UIController(drawingController, exportController);
    
    // Initialize default slider settings into the drawing logic
    ui.updateDrawingSettings();
});
