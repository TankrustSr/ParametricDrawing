import { Visualizer } from './visualizer.js';

export class UIController {
    constructor(drawingController, exportController) {
        this.drawing = drawingController;
        this.export = exportController;
        this.visualizer = null; 
        this.canvas = document.getElementById('main-canvas');
        
        this.STORAGE_KEY = 'bezier_parametric_presets';
        this.sessionPresets = {};
        this._isSavingPreset = false;

        this.modifierPrefixes = ['w', 'p', 'a', 'f', 's'];
        this.modifierColumns = ['m', 'e'];

        this.pointers = new Map();
        this.gestureStart = null;

        this.createHiddenFileInput();
        this.cacheElements();
        this.cleanupStartElementsFromDOM();
        this.ensureLoadButton();
        this.bindEvents();
        this.bindScrubbers();
        this.initPresets();
        this.updateLayerDropdown();
        this.resizeCanvas();
        
        window.addEventListener('resize', () => this.resizeCanvas());
        
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.cacheElements();
                this.cleanupStartElementsFromDOM();
                this.ensureLoadButton();
                this.initPresets();
                this.updateLayerDropdown();
            });
        }
    }

    cleanupStartElementsFromDOM() {
        this.modifierPrefixes.forEach(p => {
            const startInput = document.getElementById(`dup-${p}-s`);
            if (startInput) {
                const parent = startInput.parentElement;
                startInput.style.display = 'none';
                if (parent && parent.children.length === 1) parent.style.display = 'none';
            }
        });

        const headers = Array.from(document.querySelectorAll('#menu-duplicate span, #menu-duplicate th, #menu-duplicate div'));
        const startLabel = headers.find(h => h.textContent.trim().toLowerCase() === 'start');
        if (startLabel) startLabel.style.display = 'none';
    }

    findEl(idList, textList = [], tag = 'button') {
        for (const id of idList) {
            const el = document.getElementById(id);
            if (el) return el;
        }
        if (textList.length > 0) {
            const candidates = Array.from(document.querySelectorAll(`${tag}, input[type="button"], [role="button"], .btn`));
            for (const text of textList) {
                const el = candidates.find(c => (c.textContent || c.value || '').trim().toLowerCase() === text.toLowerCase());
                if (el) return el;
            }
        }
        return null;
    }

    createHiddenFileInput() {
        let input = document.getElementById('preset-json-file-input');
        if (!input) {
            input = document.createElement('input');
            input.type = 'file';
            input.id = 'preset-json-file-input';
            input.accept = '.json,application/json,text/plain';
            input.style.cssText = 'position:fixed;top:-1000px;left:-1000px;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:-1;';
            document.body.appendChild(input);
        }
        this.fileInput = input;
        
        this.fileInput.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            this.importPresetJSON(file);
            this.fileInput.value = '';
        });
    }

    getPresetSelect() {
        if (this.presetSelect && document.body.contains(this.presetSelect)) return this.presetSelect;

        let el = document.querySelector(
            'select#preset-select, select#presets-select, select#preset-dropdown, select#presets-dropdown, select#presets, select#preset, ' +
            'select[id*="preset" i], select[name*="preset" i], select[class*="preset" i], ' +
            '#presets select, #preset select, .presets select, .preset select'
        );
        if (el) return (this.presetSelect = el);

        const container = document.querySelector('#preset-controls, #presets, #preset-tools, [id*="preset" i], [class*="preset" i]');
        if (container) {
            const select = container.querySelector('select');
            if (select) return (this.presetSelect = select);
        }

        const allSelects = Array.from(document.querySelectorAll('select'));
        for (const s of allSelects) {
            const idName = (s.id + ' ' + s.name + ' ' + s.className).toLowerCase();
            if (idName.includes('layer') || idName.includes('wave') || idName.includes('cap') || idName.includes('end')) continue;
            return (this.presetSelect = s);
        }
        return null;
    }

    getLayerSelect() {
        if (this.layerSelect && document.body.contains(this.layerSelect)) return this.layerSelect;

        let el = document.querySelector(
            'select#layer-select, select#layers-select, select#select-layer, select#layer-dropdown, select#layers, select#layer, ' +
            'select[id*="layer" i], select[name*="layer" i], select[class*="layer" i], ' +
            '#layers select, #layer select, .layers select, .layer select'
        );
        const presetEl = this.getPresetSelect();
        if (el && el !== presetEl) return (this.layerSelect = el);
        return null;
    }

    ensureLoadButton() {
        let loadBtn = document.getElementById('btn-load-preset-file');
        if (loadBtn) {
            this.btnLoadPreset = loadBtn;
            return loadBtn;
        }

        const saveBtn = this.btnSavePreset;
        const pSelect = this.getPresetSelect();

        loadBtn = document.createElement('button');
        loadBtn.id = 'btn-load-preset-file';
        loadBtn.type = 'button';
        loadBtn.textContent = 'Load JSON';

        if (saveBtn) {
            loadBtn.className = saveBtn.className;
            if (saveBtn.parentElement) {
                saveBtn.parentElement.insertBefore(loadBtn, saveBtn.nextSibling);
                this.btnLoadPreset = loadBtn;
                return loadBtn;
            }
        }
        if (pSelect && pSelect.parentElement) {
            pSelect.parentElement.appendChild(loadBtn);
            this.btnLoadPreset = loadBtn;
            return loadBtn;
        }
        return null;
    }

    cacheElements() {
        this.sliders = ['width-start', 'width-mid', 'width-end', 'mod-freq', 'mod-amp-start', 'mod-amp-mid', 'mod-amp-end', 'mod-exp'];
        this.sliderEls = {};
        this.valEls = {};
        
        this.sliders.forEach(id => {
            this.sliderEls[id] = document.getElementById(id);
            this.valEls[id] = document.getElementById(`val-${id}`);
        });

        this.dupFields = ['dup-count', 'dup-x', 'dup-y', 'dup-rot'];
        
        this.meFields = [];
        this.modifierPrefixes.forEach(p => {
            this.meFields.push(`dup-${p}-m`, `dup-${p}-e`);
        });

        this.selects = ['mod-waveform', 'line-cap'];
        this.colorEl = document.getElementById('line-color');

        this.btnNew = document.querySelector('#btn-new, #new-btn, #btn-layer-new, #new-layer')
            || this.findEl(['btn-new', 'new-btn'], ['New', 'New Layer', '+ New']);
        this.btnDuplicateLine = document.querySelector('#btn-duplicate, #duplicate-btn, #btn-layer-duplicate, #duplicate-layer')
            || this.findEl(['btn-duplicate', 'duplicate-btn'], ['Duplicate', 'Duplicate Layer']);

        this.topToolbar = this.btnNew?.parentElement || this.btnDuplicateLine?.parentElement;

        this.btnDeleteLineTop = (this.topToolbar ? Array.from(this.topToolbar.querySelectorAll('button')).find(b => {
            const t = (b.textContent || '').trim().toLowerCase();
            return b !== this.btnNew && b !== this.btnDuplicateLine && (t.includes('del') || t.includes('delete'));
        }) : null)
        || document.querySelector('#btn-delete, #delete-btn, #btn-layer-delete, #delete-layer')
        || this.findEl(['btn-delete', 'delete-btn', 'btn-layer-delete', 'delete-layer'], ['Delete', 'Delete Layer']);

        this.presetSelect = this.getPresetSelect();
        this.layerSelect = this.getLayerSelect();

        this.presetInput = document.querySelector('input#preset-name, input#name-preset, input#preset-input, input[name*="preset" i], input[id*="preset" i]');

        this.btnSavePreset = document.querySelector('#btn-save-preset, #save-preset, #btn-preset-save, #preset-save, button[id*="preset" i][id*="save" i]') 
            || this.findEl(['btn-save-preset', 'save-preset'], ['Save Preset', 'Save']);

        this.btnDeletePreset = document.querySelector('#btn-delete-preset, #delete-preset, #btn-del-preset, #del-preset, #btn-preset-delete, #preset-delete, button[id*="preset" i][id*="del" i]') 
            || this.findEl(['btn-delete-preset', 'delete-preset', 'btn-del-preset', 'del-preset'], ['Delete Preset', 'Del Preset']);

        this.btnLoadPreset = document.getElementById('btn-load-preset-file');

        this.btnDraw = this.findEl(['btn-tool-draw', 'tool-draw', 'draw-btn'], ['Draw']);
        this.btnSelect = this.findEl(['btn-tool-select', 'tool-select', 'select-btn'], ['Select/Modify', 'Select']);
        this.btnUndo = this.findEl(['btn-undo', 'undo-btn', 'undo'], ['Undo']);
        this.btnGrid = this.findEl(['btn-grid', 'grid-btn', 'grid'], ['Grid: Off', 'Grid: On', 'Grid']);
        this.btnDelLine = this.findEl(['btn-del-line', 'del-line', 'delete-line'], ['Del Line', 'Delete Line']);
        this.btnDelPoint = this.findEl(['btn-del-point', 'del-point', 'delete-point'], ['Del Point', 'Delete Point']);
        this.btnExport = this.findEl(['btn-export-svg', 'export-svg', 'btn-export'], ['Export SVG', 'Export']);
        
        this.btnPreview3D = document.getElementById('btn-preview-3d') || this.findEl(['btn-preview-3d'], ['Preview 3D']);
        this.btnResetDup = this.findEl(['btn-reset-dup', 'reset-dup', 'reset-defaults'], ['Reset Defaults', 'Reset']);

        this.menuDuplicate = document.getElementById('menu-duplicate');
    }

    bindScrubbers() {
        const numInputs = document.querySelectorAll('#menu-duplicate input[type="number"]');
        numInputs.forEach(input => {
            input.style.touchAction = 'none';
            let isDragging = false, startX = 0, startVal = 0;
            let step = parseFloat(input.getAttribute('step')) || 1;

            input.addEventListener('pointerdown', (e) => {
                isDragging = true;
                startX = e.clientX;
                startVal = parseFloat(input.value) || 0;
                input.setPointerCapture(e.pointerId);
            });

            input.addEventListener('pointermove', (e) => {
                if (!isDragging) return;
                const deltaX = e.clientX - startX; 
                if (Math.abs(deltaX) > 5) {
                    input.blur();
                    const stepsToMove = Math.round(deltaX / 5); 
                    let newVal = startVal + (stepsToMove * step);
                    if (input.hasAttribute('min')) newVal = Math.max(parseFloat(input.getAttribute('min')), newVal);
                    if (input.hasAttribute('max')) newVal = Math.min(parseFloat(input.getAttribute('max')), newVal);
                    const decimals = step.toString().includes('.') ? step.toString().split('.')[1].length : 0;
                    input.value = newVal.toFixed(decimals);
                    input.dispatchEvent(new Event('input'));
                }
            });

            const endDrag = (e) => {
                isDragging = false;
                if (input.hasPointerCapture(e.pointerId)) input.releasePointerCapture(e.pointerId);
            };

            input.addEventListener('pointerup', endDrag);
            input.addEventListener('pointercancel', endDrag);
        });
    }
    bindEvents() {
        this.sliders.forEach(id => {
            if (this.sliderEls[id]) {
                this.sliderEls[id].addEventListener('input', (e) => {
                    if (this.valEls[id]) this.valEls[id].textContent = e.target.value;
                    this.updateDrawingSettings();
                });
            }
        });

        this.dupFields.forEach(id => {
            const slider = document.getElementById(id);
            const input = document.getElementById(`${id}-val`);
            if (slider && input) {
                slider.addEventListener('input', (e) => { input.value = e.target.value; this.updateDuplicationSettings(); });
                input.addEventListener('input', (e) => { slider.value = e.target.value; this.updateDuplicationSettings(); });
            }
        });

        this.meFields.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', () => this.updateDuplicationSettings());
        });

        const createNewLayer = (e) => {
            if (e) { e.preventDefault(); e.stopPropagation(); }
            this.drawing.saveState();
            if (this.drawing.currentLine) this.drawing.endCurrentLine();
            this.drawing.selectedLine = null;
            this.drawing.activeHandle = null;
            this.setTool('draw');
            window.dispatchEvent(new Event('lineDeselected'));
            this.updateLayerDropdown();
            this.drawing.redraw();
        };

        const duplicateActiveLayer = (e) => {
            if (e) { e.preventDefault(); e.stopPropagation(); }
            const target = this.drawing.selectedLine || (this.drawing.lines.length > 0 ? this.drawing.lines[this.drawing.lines.length - 1] : null);
            if (!target) return;

            this.drawing.saveState();
            const clone = JSON.parse(JSON.stringify(target));
            clone.id = Date.now();
            clone.name = `${target.name || 'Layer'} (Copy)`;

            this.drawing.lines.push(clone);
            this.drawing.selectedLine = clone;
            this.setTool('select');
            this.updateLayerDropdown();
            window.dispatchEvent(new CustomEvent('lineSelected', { detail: clone }));
            this.drawing.redraw();
        };

        const deleteActiveLayer = (e) => {
            if (e) { e.preventDefault(); e.stopPropagation(); }
            this.drawing.saveState();
            if (this.drawing.currentLine) this.drawing.currentLine = null;

            let target = this.drawing.selectedLine;
            const lSelect = this.getLayerSelect();
            if (!target && lSelect && lSelect.value !== "") {
                const idx = parseInt(lSelect.value);
                if (!isNaN(idx) && this.drawing.lines[idx]) target = this.drawing.lines[idx];
            }
            if (!target && this.drawing.lines.length > 0) {
                target = this.drawing.lines[this.drawing.lines.length - 1];
            }

            if (target) this.drawing.lines = this.drawing.lines.filter(l => l !== target && l.id !== target.id);
            this.drawing.selectedLine = null;
            this.drawing.activeHandle = null;
            this.updateLayerDropdown();
            window.dispatchEvent(new Event('lineDeselected'));
            this.drawing.redraw();
        };

        if (this.btnNew) this.btnNew.addEventListener('click', createNewLayer);
        if (this.btnDuplicateLine) this.btnDuplicateLine.addEventListener('click', duplicateActiveLayer);
        if (this.btnDeleteLineTop) this.btnDeleteLineTop.addEventListener('click', deleteActiveLayer);
        if (this.btnDelLine) this.btnDelLine.addEventListener('click', deleteActiveLayer);

        if (this.btnSavePreset) this.btnSavePreset.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.savePresetToJSON(); });
        if (this.btnDeletePreset) this.btnDeletePreset.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.deletePreset(); });
        if (this.btnLoadPreset) this.btnLoadPreset.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.triggerFilePicker(); });

        document.addEventListener('change', (e) => {
            const pSelect = this.getPresetSelect();
            if (e.target === pSelect) {
                const val = e.target.value;
                if (val === '__LOAD_FILE__') { pSelect.value = ''; this.triggerFilePicker(); }
                else if (val) this.loadPreset(val);
            }

            const lSelect = this.getLayerSelect();
            if (e.target === lSelect) {
                if (e.target.value === "") { createNewLayer(e); return; }
                const idx = parseInt(e.target.value);
                if (!isNaN(idx) && this.drawing.lines[idx]) {
                    this.drawing.selectedLine = this.drawing.lines[idx];
                    this.drawing.activeHandle = null;
                    this.setTool('select');
                    window.dispatchEvent(new CustomEvent('lineSelected', { detail: this.drawing.lines[idx] }));
                    this.drawing.redraw();
                }
            }
        });

        document.addEventListener('click', (e) => {
            const btn = e.target.closest('button, [role="button"], input[type="button"], a, .btn');
            if (!btn) return;
            if (btn === this.btnSavePreset || btn === this.btnDeletePreset || btn === this.btnLoadPreset) return;

            const text = (btn.textContent || btn.value || btn.title || '').trim().toLowerCase();
            const id = (btn.id || '').toLowerCase();
            const className = (btn.className || '').toLowerCase();

            const pSel = this.getPresetSelect();
            const presetContainer = pSel ? (pSel.closest('div, section, fieldset, li') || pSel.parentElement) : null;
            const inPresetContext = Boolean((presetContainer && presetContainer.contains(btn)) || id.includes('preset') || className.includes('preset') || text.includes('preset'));

            if (inPresetContext) {
                if (id.includes('del') || id.includes('delete') || text.includes('del') || text.includes('delete') || text.includes('remove')) { e.preventDefault(); e.stopPropagation(); this.deletePreset(); return; }
                if (id.includes('save') || text.includes('save')) { e.preventDefault(); e.stopPropagation(); this.savePresetToJSON(); return; }
                if (id.includes('load') || text.includes('load') || id.includes('import') || text.includes('import')) { e.preventDefault(); e.stopPropagation(); this.triggerFilePicker(); return; }
                return;
            }

            const isLayerDelete = (btn === this.btnDeleteLineTop || btn === this.btnDelLine || id === 'btn-delete' || id === 'delete-btn' || id === 'btn-del-line' || id === 'del-line' || id === 'delete-layer' || id === 'btn-layer-delete' || text === 'delete layer' || text === 'del line' || text === 'delete line' || (this.topToolbar && this.topToolbar.contains(btn) && (text === 'delete' || id.includes('del'))));
            if (isLayerDelete) { deleteActiveLayer(e); return; }

            const isLayerNew = (btn === this.btnNew || id === 'btn-new' || id === 'new-btn' || id.includes('new-layer') || text === 'new layer' || (this.topToolbar && this.topToolbar.contains(btn) && (text === 'new' || text === '+ new')));
            if (isLayerNew) { createNewLayer(e); return; }

            const isLayerDuplicate = (btn === this.btnDuplicateLine || id === 'btn-duplicate' || id === 'duplicate-btn' || id.includes('duplicate-layer') || text === 'duplicate layer' || (this.topToolbar && this.topToolbar.contains(btn) && text === 'duplicate'));
            if (isLayerDuplicate) { duplicateActiveLayer(e); return; }
        });

        if (this.btnDelPoint) this.btnDelPoint.addEventListener('click', () => { if (this.drawing.selectedLine && this.drawing.activeHandle) this.drawing.deleteActivePoint(); });

        if (this.btnResetDup) {
            this.btnResetDup.addEventListener('click', () => {
                if (this.drawing && this.drawing.selectedLine) {
                    this.drawing.saveState();
                    const oldDup = { ...this.drawing.selectedLine.settings.duplication };
                    const newDup = this.getDefaultDupSettings();
                    this.drawing.syncEndShapeToDuplication(this.drawing.selectedLine, oldDup, newDup);
                    this.drawing.selectedLine.settings.duplication = newDup;
                    this.syncDuplicateUI(newDup);
                    this.drawing.redraw();
                }
            });
        }

        if (this.btnDraw) this.btnDraw.addEventListener('click', () => this.setTool('draw'));
        if (this.btnSelect) this.btnSelect.addEventListener('click', () => this.setTool('select'));
        if (this.btnUndo) this.btnUndo.addEventListener('click', () => { this.drawing.undo(); this.updateLayerDropdown(); });
        
        if (this.btnGrid) {
            this.btnGrid.addEventListener('click', () => {
                const active = this.drawing.toggleGrid();
                this.btnGrid.textContent = `Grid: ${active ? 'On' : 'Off'}`;
                this.btnGrid.style.backgroundColor = active ? '#0a84ff' : '#444';
            });
        }

        if (this.btnExport) this.btnExport.addEventListener('click', () => this.export.generateSVG());
        
        if (this.btnPreview3D) {
            this.btnPreview3D.addEventListener('click', async () => {
                try {
                    const { Visualizer } = await import('./visualizer.js');
                    if (!this.visualizer) {
                        this.visualizer = new Visualizer();
                    }
                    const svgString = this.export.getSVGString();
                    this.visualizer.open3DPreview(svgString);
                } catch (err) {
                    console.error("Failed to load 3D visualizer.", err);
                    alert("3D Visualizer failed to load.");
                }
            });
        }

        this.selects.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', () => this.updateDrawingSettings());
        });
        if (this.colorEl) this.colorEl.addEventListener('input', () => this.updateDrawingSettings());

        window.addEventListener('lineSelected', (e) => {
            const line = e.detail;
            if (this.menuDuplicate) this.menuDuplicate.style.display = 'block';
            this.applySettingsToUI(line.settings);
            const selectEl = this.getLayerSelect();
            if (selectEl) {
                const idx = this.drawing.lines.indexOf(line);
                if (idx !== -1) selectEl.value = idx;
            }
        });

        window.addEventListener('lineDeselected', () => {
            if (this.menuDuplicate) this.menuDuplicate.style.display = 'none';
            this.syncDuplicateUI(this.getDefaultDupSettings());
            if (this.drawing) {
                this.drawing.settings.duplication = this.getDefaultDupSettings();
            }
        });

        this.canvas.addEventListener('pointerdown', (e) => this.handlePointerDown(e));
        this.canvas.addEventListener('pointermove', (e) => this.handlePointerMove(e));
        this.canvas.addEventListener('pointerup', (e) => this.handlePointerUp(e));
        this.canvas.addEventListener('pointercancel', (e) => this.handlePointerUp(e));
        this.canvas.addEventListener('contextmenu', e => e.preventDefault());
    }

    getEventPoint(e) {
        const rect = this.canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    triggerFilePicker() {
        if (!this.fileInput) return;
        try { this.fileInput.click(); } catch (err) {}
        this.showTapToUploadBanner();
    }

    showTapToUploadBanner() {
        const existing = document.getElementById('preset-file-tap-banner');
        if (existing) existing.remove();

        const banner = document.createElement('button');
        banner.id = 'preset-file-tap-banner';
        banner.type = 'button';
        banner.innerHTML = '📁 Tap to choose .json file';
        banner.style.cssText = `display: block; width: 100%; margin-top: 6px; padding: 9px 12px; background: #0a84ff; color: #ffffff; font-weight: 600; font-size: 13px; border: none; border-radius: 6px; cursor: pointer; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.25); z-index: 9999;`;

        banner.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation(); banner.remove();
            if (this.fileInput) this.fileInput.click();
        });

        const pSelect = this.getPresetSelect();
        if (pSelect && pSelect.parentElement) {
            pSelect.parentElement.appendChild(banner);
        } else {
            document.body.appendChild(banner);
        }
        setTimeout(() => { if (document.body.contains(banner)) banner.remove(); }, 8000);
    }

    updateLayerDropdown() {
        const select = this.getLayerSelect();
        const presetSelect = this.getPresetSelect();
        if (!select || select === presetSelect) return;
        
        select.innerHTML = '';
        if (!this.drawing.lines || this.drawing.lines.length === 0) {
            const opt = document.createElement('option');
            opt.value = "";
            opt.textContent = "No Layers";
            select.appendChild(opt);
            return;
        }

        this.drawing.lines.forEach((line, index) => {
            const opt = document.createElement('option');
            opt.value = index;
            opt.textContent = line.name || `Layer ${index + 1}`;
            if (line === this.drawing.selectedLine) opt.selected = true;
            select.appendChild(opt);
        });

        if (!this.drawing.selectedLine) {
            const opt = document.createElement('option');
            opt.value = "";
            opt.textContent = "+ New Layer (Drawing)";
            opt.selected = true;
            select.insertBefore(opt, select.firstChild);
        }
    }

    initPresets() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') this.sessionPresets = parsed;
            }
        } catch (e) {}
        this.updatePresetDropdown();
        this.updateDrawingSettings();
    }

    savePresetToJSON() {
        if (this._isSavingPreset) return;
        this._isSavingPreset = true;

        try {
            const input = document.querySelector('input#preset-name, input#name-preset, input#preset-input, input[name*="preset" i], input[id*="preset" i]') || this.presetInput;
            let presetName = input ? input.value.trim() : '';
            if (!presetName) presetName = prompt("Enter preset name:", `Drawing-${Date.now().toString().slice(-4)}`);
            if (!presetName || !presetName.trim()) return;
            presetName = presetName.trim().replace(/[/\\?%*:|"<>]/g, '-');

            const currentSettings = this.getCurrentSettings();
            const targetLine = this.drawing.selectedLine || (this.drawing.lines.length > 0 ? this.drawing.lines[0] : null);

            const exportPayload = {
                format: 'bezier-parametric-drawing',
                version: 2,
                name: presetName,
                createdAt: new Date().toISOString(),
                lines: JSON.parse(JSON.stringify(this.drawing.lines)),
                activeLine: targetLine ? JSON.parse(JSON.stringify(targetLine)) : null,
                settings: targetLine ? JSON.parse(JSON.stringify(targetLine.settings)) : currentSettings
            };

            const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${presetName}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);

            this.sessionPresets[presetName] = exportPayload;
            try { localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.sessionPresets)); } catch (e) {}

            this.updatePresetDropdown();
            const select = this.getPresetSelect();
            if (select) select.value = presetName;
            if (input) input.value = '';
        } finally {
            setTimeout(() => { this._isSavingPreset = false; }, 300);
        }
    }

    importPresetJSON(file) {
        const banner = document.getElementById('preset-file-tap-banner');
        if (banner) banner.remove();

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                let name = data.name || file.name.replace(/\.json$/i, '');
                this.sessionPresets[name] = data;
                try { localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.sessionPresets)); } catch (e) {}
                this.updatePresetDropdown();
                const select = this.getPresetSelect();
                if (select) select.value = name;
                this.loadPreset(name);
            } catch (err) {
                alert("Failed to parse preset file. Please ensure it is valid JSON.");
            }
        };
        reader.readAsText(file);
    }

    loadPreset(name) {
        const payload = this.sessionPresets[name];
        if (!payload) return;

        this.drawing.saveState();

        if (payload.lines && Array.isArray(payload.lines) && payload.lines.length > 0) {
            this.drawing.lines = JSON.parse(JSON.stringify(payload.lines));
            this.drawing.selectedLine = this.drawing.lines[0];
        } else if (payload.activeLine && payload.activeLine.points) {
            const restoredLine = JSON.parse(JSON.stringify(payload.activeLine));
            restoredLine.id = Date.now();
            this.drawing.lines = [restoredLine];
            this.drawing.selectedLine = restoredLine;
        } else if (payload.points && payload.curves) {
            const restoredLine = JSON.parse(JSON.stringify(payload));
            restoredLine.id = Date.now();
            this.drawing.lines = [restoredLine];
            this.drawing.selectedLine = restoredLine;
        } else {
            const settings = payload.settings || (payload.duplication ? payload : null);
            if (settings) {
                const cleanSettings = JSON.parse(JSON.stringify(settings));
                if (this.drawing.selectedLine) {
                    this.drawing.selectedLine.settings = cleanSettings;
                    if (cleanSettings.duplication && cleanSettings.duplication.count > 0) {
                        this.drawing.syncEndShapeToDuplication(this.drawing.selectedLine);
                    }
                } else if (this.drawing.lines.length === 0) {
                    const dpr = window.devicePixelRatio || 1;
                    const cx = (this.canvas.width / dpr) * 0.5;
                    const cy = (this.canvas.height / dpr) * 0.5;
                    const newLine = {
                        id: Date.now(),
                        name: name || 'Layer 1',
                        settings: cleanSettings,
                        points: [{ x: cx - 60, y: cy, pressure: 0.5 }, { x: cx + 60, y: cy, pressure: 0.5 }],
                        endPoints: null, curves: [], endCurves: [], origin: { x: cx, y: cy }, isFinished: true
                    };
                    newLine.curves = this.drawing.generateCurvesFromPoints(newLine.points);
                    this.drawing.lines.push(newLine);
                    this.drawing.selectedLine = newLine;
                }
            }
        }

        if (this.drawing.selectedLine) {
            this.applySettingsToUI(this.drawing.selectedLine.settings);
            this.drawing.settings = JSON.parse(JSON.stringify(this.drawing.selectedLine.settings));
            window.dispatchEvent(new CustomEvent('lineSelected', { detail: this.drawing.selectedLine }));
        }

        this.setTool('select');
        this.updateLayerDropdown();
        this.drawing.redraw();
    }

    deletePreset() {
        const select = this.getPresetSelect();
        let presetName = select ? select.value : '';
        if (!presetName || presetName === '__LOAD_FILE__') {
            alert("Please select a preset from the dropdown to remove.");
            return;
        }
        if (!confirm(`Remove preset "${presetName}" from the list?`)) return;

        if (this.sessionPresets[presetName]) {
            delete this.sessionPresets[presetName];
            try { localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.sessionPresets)); } catch (e) {}
            this.updatePresetDropdown();
            if (select) select.value = '';
        }
    }

    updatePresetDropdown() {
        const select = this.getPresetSelect();
        if (!select) return;

        const currentVal = select.value;
        select.innerHTML = '';
        const defaultOpt = document.createElement('option');
        defaultOpt.value = ''; defaultOpt.textContent = '-- Select Preset --'; select.appendChild(defaultOpt);
        const loadOpt = document.createElement('option');
        loadOpt.value = '__LOAD_FILE__'; loadOpt.textContent = '📁 Load from .json file...'; select.appendChild(loadOpt);

        Object.keys(this.sessionPresets).forEach(name => {
            const opt = document.createElement('option');
            opt.value = name; opt.textContent = name;
            if (name === currentVal) opt.selected = true;
            select.appendChild(opt);
        });
    }

    applySettingsToUI(s) {
        if (!s) return;
        const setVal = (id, val) => {
            if (val === undefined || val === null || isNaN(val)) return;
            const el = document.getElementById(id);
            if (el) el.value = val;
            const display = document.getElementById(`val-${id}`) || document.getElementById(`${id}-val`);
            if (display) {
                if (display.tagName === 'INPUT') display.value = val;
                else display.textContent = val;
            }
        };

        setVal('width-start', s.widthStart); setVal('width-mid', s.widthMid); setVal('width-end', s.widthEnd);
        setVal('mod-freq', s.modFreq); setVal('mod-amp-start', s.modAmpStart ?? s.modAmp);
        setVal('mod-amp-mid', s.modAmpMid ?? s.modAmp); setVal('mod-amp-end', s.modAmpEnd ?? s.modAmp);
        setVal('mod-exp', s.modExp);

        const waveformEl = document.getElementById('mod-waveform'); if (waveformEl && s.waveform) waveformEl.value = s.waveform;
        const lineCapEl = document.getElementById('line-cap'); if (lineCapEl && s.lineCap) lineCapEl.value = s.lineCap;
        if (this.colorEl && s.color) this.colorEl.value = s.color;
        if (s.duplication) this.syncDuplicateUI(s.duplication);
    }

    getCurrentSettings() {
        const num = (id, fallback) => {
            const el = document.getElementById(id);
            if (!el) return fallback;
            const v = parseFloat(el.value);
            return isNaN(v) ? fallback : v;
        };

        const dup = {
            count: parseInt(document.getElementById('dup-count')?.value) || 0,
            dx: num('dup-x', 0), dy: num('dup-y', 0), dr: num('dup-rot', 0)
        };
        this.modifierPrefixes.forEach(p => {
            dup[p] = { m: num(`dup-${p}-m`, p === 'p' ? 0 : 1), e: num(`dup-${p}-e`, p === 'p' ? 0 : 1) };
        });

        return {
            widthStart: num('width-start', 1), widthMid: num('width-mid', 1), widthEnd: num('width-end', 1),
            color: this.colorEl?.value || '#000000', waveform: document.getElementById('mod-waveform')?.value || 'none',
            modFreq: num('mod-freq', 10), modAmpStart: num('mod-amp-start', 0), modAmpMid: num('mod-amp-mid', 0),
            modAmpEnd: num('mod-amp-end', 0), modExp: num('mod-exp', 1), lineCap: document.getElementById('line-cap')?.value || 'round',
            duplication: dup
        };
    }

    resizeCanvas() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        const scale = window.devicePixelRatio || 1;
        this.canvas.width = rect.width * scale;
        this.canvas.height = rect.height * scale;
        this.canvas.style.width = `${rect.width}px`;
        this.canvas.style.height = `${rect.height}px`;
        if (this.drawing) this.drawing.redraw();
    }

    setTool(toolName) {
        if (toolName === 'select' && this.drawing.currentLine) this.drawing.endCurrentLine();
        if (this.btnDraw) this.btnDraw.classList.toggle('active', toolName === 'draw');
        if (this.btnSelect) this.btnSelect.classList.toggle('active', toolName === 'select');
        this.drawing.currentTool = toolName;
        
        if (toolName === 'draw') {
            this.drawing.selectedLine = null;
            this.drawing.activeHandle = null;
            this.syncDuplicateUI(this.getDefaultDupSettings());
            if (this.drawing) this.drawing.settings.duplication = this.getDefaultDupSettings();
            window.dispatchEvent(new Event('lineDeselected'));
            this.drawing.redraw();
        }
    }

    getDefaultDupSettings() {
        return { count: 1, dx: 0, dy: 0, dr: 0, w: { m: 1, e: 1 }, p: { m: 0, e: 0 }, a: { m: 1, e: 1 }, f: { m: 1, e: 1 }, s: { m: 1, e: 1 } };
    }

    updateDrawingSettings() {
        if (!this.drawing) return;
        const newSettings = this.getCurrentSettings();
        this.drawing.settings = newSettings;
        if (this.drawing.selectedLine) {
            this.drawing.selectedLine.settings = { ...newSettings };
            this.drawing.redraw();
        }
    }

    syncDuplicateUI(dupSettings) {
        const dup = dupSettings || this.getDefaultDupSettings();
        const updates = { 'dup-count': dup.count, 'dup-x': dup.dx, 'dup-y': dup.dy, 'dup-rot': dup.dr };
        for (const [id, val] of Object.entries(updates)) {
            const sEl = document.getElementById(id);
            const iEl = document.getElementById(`${id}-val`);
            if (sEl) sEl.value = val;
            if (iEl) iEl.value = val;
        }
        this.modifierPrefixes.forEach(p => {
            if (dup[p]) {
                const mField = document.getElementById(`dup-${p}-m`);
                const eField = document.getElementById(`dup-${p}-e`);
                if (mField && dup[p].m !== undefined) mField.value = dup[p].m;
                if (eField && dup[p].e !== undefined) eField.value = dup[p].e;
            }
        });
    }

    updateDuplicationSettings() {
        if (!this.drawing || !this.drawing.selectedLine) return;
        const oldDup = { ...(this.drawing.selectedLine.settings.duplication || this.getDefaultDupSettings()) };
        const newDup = {
            count: parseInt(document.getElementById('dup-count')?.value) || 0,
            dx: parseFloat(document.getElementById('dup-x')?.value) || 0,
            dy: parseFloat(document.getElementById('dup-y')?.value) || 0,
            dr: parseFloat(document.getElementById('dup-rot')?.value) || 0
        };
        this.modifierPrefixes.forEach(p => {
            newDup[p] = {
                m: parseFloat(document.getElementById(`dup-${p}-m`)?.value) || (p === 'p' ? 0 : 1),
                e: parseFloat(document.getElementById(`dup-${p}-e`)?.value) || (p === 'p' ? 0 : 1)
            };
        });
        this.drawing.syncEndShapeToDuplication(this.drawing.selectedLine, oldDup, newDup);
        this.drawing.selectedLine.settings.duplication = newDup;
        this.drawing.redraw();
    }

    handlePointerDown(e) {
        if (e.pointerType !== 'pen' && e.pointerType !== 'mouse' && e.pointerType !== 'touch') return;
        if (e.button === 5 || e.buttons === 32 || e.button === 2) { this.drawing.handleSqueeze(); return; }

        this.pointers.set(e.pointerId, e);

        if (this.pointers.size === 1) {
            this.canvas.setPointerCapture(e.pointerId);
            
            // PALM REJECTION: Ignore single-touch inputs if we are in drawing mode
            if (this.drawing.currentTool === 'draw' && e.pointerType === 'touch') {
                return;
            }

            const raw = this.getEventPoint(e);
            const pt = this.drawing.screenToWorld(raw.x, raw.y);
            this.drawing.addPoint(pt.x, pt.y, e.pressure);
        } else if (this.pointers.size === 2) {
            if (this.drawing.currentLine && this.drawing.currentLine.points.length <= 2 && this.drawing.currentTool === 'draw') {
                 this.drawing.undo(); 
                 window.dispatchEvent(new Event('lineDeselected'));
            }
            this.gestureStart = null;
        }
    }

    handlePointerMove(e) {
        if (!this.pointers.has(e.pointerId) && this.pointers.size > 0) return;
        if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, e);

        if (this.pointers.size === 2) {
            const pts = Array.from(this.pointers.values());
            const p1 = this.getEventPoint(pts[0]);
            const p2 = this.getEventPoint(pts[1]);
            
            const cx = (p1.x + p2.x) / 2; const cy = (p1.y + p2.y) / 2;
            const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
            const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);

            if (this.gestureStart) {
                let newZoom = this.gestureStart.cameraZoom * (dist / this.gestureStart.dist);
                newZoom = Math.max(0.05, Math.min(100, newZoom)); 
                this.drawing.camera.zoom = newZoom;
                
                this.drawing.camera.angle = this.gestureStart.cameraAngle + (angle - this.gestureStart.angle);
                
                const cos = Math.cos(this.drawing.camera.angle);
                const sin = Math.sin(this.drawing.camera.angle);
                let unshiftedX = this.gestureStart.worldCenter.x * cos - this.gestureStart.worldCenter.y * sin;
                let unshiftedY = this.gestureStart.worldCenter.x * sin + this.gestureStart.worldCenter.y * cos;
                unshiftedX *= this.drawing.camera.zoom;
                unshiftedY *= this.drawing.camera.zoom;

                this.drawing.camera.x = cx - unshiftedX;
                this.drawing.camera.y = cy - unshiftedY;
                this.drawing.redraw();
            } else {
                this.gestureStart = {
                    dist, angle, cameraZoom: this.drawing.camera.zoom, cameraAngle: this.drawing.camera.angle,
                    worldCenter: this.drawing.screenToWorld(cx, cy)
                };
            }
            return;
        }

        if (this.pointers.size === 1) {
            // PALM REJECTION: Ignore single-touch moves if we are in drawing mode
            if (this.drawing.currentTool === 'draw' && e.pointerType === 'touch') return;

            const raw = this.getEventPoint(e);
            const pt = this.drawing.screenToWorld(raw.x, raw.y);
            this.drawing.updatePreview(pt.x, pt.y);
            if (this.canvas.hasPointerCapture(e.pointerId)) this.drawing.dragActiveHandle(pt.x, pt.y);
        }
    }

    handlePointerUp(e) {
        this.pointers.delete(e.pointerId);
        this.gestureStart = null;
        if (this.pointers.size === 0) {
            try { this.canvas.releasePointerCapture(e.pointerId); } catch(e){}
            this.drawing.releaseHandle();
            this.updateLayerDropdown();
        } else if (this.pointers.size === 1) {
            this.drawing.releaseHandle();
        }
    }
}
