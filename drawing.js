export class DrawingController {
    constructor(canvasContext) {
        this.ctx = canvasContext;
        this.lines = [];
        this.currentLine = null;
        this.selectedLine = null;
        this.currentTool = 'draw';
        this.settings = {};
        
        this.camera = { x: 0, y: 0, zoom: 1, angle: 0 };

        this.activeHandle = null; 
        this.previewPoint = null;
        this.lastClick = { time: 0, x: 0, y: 0 };
        this.lastDragPos = null;

        this.dragStartPos = null;
        this.dragThreshold = 8; 

        this.gridEnabled = false;
        this.gridSize = 20;

        this.history = [];
        this.maxHistory = 15;
        this.isDragging = false;
    }

    screenToWorld(sx, sy) {
        let x = sx - this.camera.x;
        let y = sy - this.camera.y;
        x /= this.camera.zoom;
        y /= this.camera.zoom;
        const cos = Math.cos(-this.camera.angle);
        const sin = Math.sin(-this.camera.angle);
        return {
            x: x * cos - y * sin,
            y: x * sin + y * cos
        };
    }

    worldToScreen(wx, wy) {
        const cos = Math.cos(this.camera.angle);
        const sin = Math.sin(this.camera.angle);
        let x = wx * cos - wy * sin;
        let y = wx * sin + wy * cos;
        x *= this.camera.zoom;
        y *= this.camera.zoom;
        return {
            x: x + this.camera.x,
            y: y + this.camera.y
        };
    }

    getDefaultDupSettings() {
        return { count: 1, dx: 0, dy: 0, dr: 0, w: { m: 1, e: 1 }, p: { m: 0, e: 0 }, a: { m: 1, e: 1 }, f: { m: 1, e: 1 }, s: { m: 1, e: 1 } };
    }

    toggleGrid() {
        this.gridEnabled = !this.gridEnabled;
        this.redraw();
        return this.gridEnabled;
    }

    snap(x, y) {
        if (!this.gridEnabled) return { x, y };
        return {
            x: Math.round(x / this.gridSize) * this.gridSize,
            y: Math.round(y / this.gridSize) * this.gridSize
        };
    }

    saveState() {
        if (this.history.length >= this.maxHistory) this.history.shift();
        const state = {
            lines: JSON.parse(JSON.stringify(this.lines)),
            currentLine: this.currentLine ? JSON.parse(JSON.stringify(this.currentLine)) : null
        };
        this.history.push(state);
    }

    undo() {
        if (this.history.length > 0) {
            const state = this.history.pop();
            this.lines = state.lines;
            this.currentLine = state.currentLine;
            this.selectedLine = null;
            this.activeHandle = null;
            window.dispatchEvent(new Event('lineDeselected'));
            this.redraw();
        }
    }

    addPoint(x, y, pressure) {
        if (this.currentTool === 'select') {
            this.handleSelectDown(x, y);
            return;
        }

        const snapped = this.snap(x, y);
        this.saveState();

        if (!this.currentLine || this.currentLine.isFinished) {
            const freshSettings = JSON.parse(JSON.stringify(this.settings || {}));
            freshSettings.duplication = this.getDefaultDupSettings();
            this.settings.duplication = this.getDefaultDupSettings();

            this.currentLine = {
                id: Date.now(),
                settings: freshSettings,
                points: [{ x: snapped.x, y: snapped.y, pressure }],
                endPoints: null, 
                midPoints: null,
                curves: [],
                endCurves: [],
                midCurves: null,
                origin: null,
                isFinished: false
            };
            this.selectedLine = null;
            window.dispatchEvent(new Event('lineDeselected'));
        } else {
            this.currentLine.points.push({ x: snapped.x, y: snapped.y, pressure });
            this.currentLine.curves = this.generateCurvesFromPoints(this.currentLine.points);
            if (this.currentLine.endPoints) {
                this.currentLine.endPoints.push({ x: snapped.x + 50, y: snapped.y, pressure });
                this.currentLine.endCurves = this.generateCurvesFromPoints(this.currentLine.endPoints);
            }
            if (this.currentLine.midPoints) {
                this.currentLine.midPoints.push({ x: snapped.x + 25, y: snapped.y, pressure });
                this.currentLine.midCurves = this.generateCurvesFromPoints(this.currentLine.midPoints);
            }
        }
        this.redraw();
    }

    updatePreview(x, y) {
        const snapped = this.snap(x, y);
        this.previewPoint = { x: snapped.x, y: snapped.y };
        this.redraw();
    }

    dragActiveHandle(x, y) {
        if (this.currentTool === 'select' && this.activeHandle) {
            const snapped = this.snap(x, y);

            if (this.activeHandle.type === 'line') {
                if (this.dragStartPos) {
                    const movedDist = Math.hypot(snapped.x - this.dragStartPos.x, snapped.y - this.dragStartPos.y);
                    if (movedDist < (this.dragThreshold / this.camera.zoom)) return; 
                }
            }

            if (!this.isDragging) {
                this.saveState();
                this.isDragging = true;
            }
            this.dragHandle(snapped.x, snapped.y);
        }
    }

    releaseHandle() {
        this.isDragging = false; 
        this.dragStartPos = null;
    }

    endCurrentLine() {
        if (this.currentLine && this.currentLine.points.length > 1) {
            this.currentLine.isFinished = true;
            if (!this.currentLine.origin) {
                const midCurve = this.currentLine.curves[Math.floor(this.currentLine.curves.length / 2)];
                this.currentLine.origin = this.getBezierPoint(0.5, midCurve.p0, midCurve.cp1, midCurve.cp2, midCurve.p3);
            }
            this.lines.push(this.currentLine);
        }
        this.currentLine = null;
        this.redraw();
    }

    handleSqueeze() {
        if (this.selectedLine) {
            this.selectedLine = null;
            this.activeHandle = null;
            window.dispatchEvent(new Event('lineDeselected'));
        }
        this.endCurrentLine();
        this.redraw();
    }

    generateCurvesFromPoints(pts) {
        let curves = [];
        if (pts.length < 2) return curves;

        for (let i = 0; i < pts.length - 1; i++) {
            const p0 = i === 0 ? pts[0] : pts[i - 1];
            const p1 = pts[i];
            const p2 = pts[i + 1];
            const p3 = i + 2 < pts.length ? pts[i + 2] : p2;

            const tension = 0.5;
            curves.push({
                p0: { x: p1.x, y: p1.y },
                cp1: { x: p1.x + (p2.x - p0.x) / 6 * tension, y: p1.y + (p2.y - p0.y) / 6 * tension },
                cp2: { x: p2.x - (p3.x - p1.x) / 6 * tension, y: p2.y - (p3.y - p1.y) / 6 * tension },
                p3: { x: p2.x, y: p2.y }
            });
        }
        return curves;
    }

    syncEndShapeToDuplication(line, oldDup = null, newDup = null) {
        if (!newDup) newDup = line.settings.duplication || this.getDefaultDupSettings();
        const dupCount = newDup.count;
        if (dupCount <= 0) return;

        if (!line.endCurves || line.endCurves.length !== line.curves.length) {
            const targetDx = newDup.dx || 0;
            const targetDy = newDup.dy || 0;
            const targetDr = (newDup.dr || 0) * (Math.PI / 180);
            const origin = line.origin || { x: 0, y: 0 };
            const cos = Math.cos(targetDr);
            const sin = Math.sin(targetDr);

            const transformPoint = (pt) => {
                let px = pt.x + targetDx;
                let py = pt.y + targetDy;
                if (targetDr !== 0) {
                    px -= origin.x;
                    py -= origin.y;
                    let rx = px * cos - py * sin;
                    let ry = px * sin + py * cos;
                    px = rx + origin.x;
                    py = ry + origin.y;
                }
                return { x: px, y: py };
            };

            line.endPoints = line.points.map(p => ({ ...transformPoint(p), pressure: p.pressure }));
            line.endCurves = line.curves.map(c => ({
                p0: transformPoint(c.p0),
                cp1: transformPoint(c.cp1),
                cp2: transformPoint(c.cp2),
                p3: transformPoint(c.p3)
            }));
            return;
        }

        if (oldDup) {
            const dxDelta = (newDup.dx || 0) - (oldDup.dx || 0);
            const dyDelta = (newDup.dy || 0) - (oldDup.dy || 0);
            const drDelta = ((newDup.dr || 0) - (oldDup.dr || 0)) * (Math.PI / 180);

            if (dxDelta === 0 && dyDelta === 0 && drDelta === 0) return;

            const origin = line.origin || { x: 0, y: 0 };
            
            const applyDelta = (pt, factor = 1.0) => {
                const fDr = drDelta * factor;
                const fDx = dxDelta * factor;
                const fDy = dyDelta * factor;

                let px = pt.x + fDx;
                let py = pt.y + fDy;

                if (fDr !== 0) {
                    px -= origin.x;
                    py -= origin.y;
                    const cos = Math.cos(fDr);
                    const sin = Math.sin(fDr);
                    let rx = px * cos - py * sin;
                    let ry = px * sin + py * cos;
                    px = rx + origin.x;
                    py = ry + origin.y;
                }
                pt.x = px;
                pt.y = py;
            };

            if (line.endPoints) line.endPoints.forEach(p => applyDelta(p, 1.0));
            if (line.endCurves) {
                line.endCurves.forEach(curve => {
                    applyDelta(curve.p0, 1.0); applyDelta(curve.cp1, 1.0); applyDelta(curve.cp2, 1.0); applyDelta(curve.p3, 1.0);
                });
            }

            if (line.midPoints) line.midPoints.forEach(p => applyDelta(p, 0.5));
            if (line.midCurves) {
                line.midCurves.forEach(curve => {
                    applyDelta(curve.p0, 0.5); applyDelta(curve.cp1, 0.5); applyDelta(curve.cp2, 0.5); applyDelta(curve.p3, 0.5);
                });
            }
        }
    }

    updateEndShapeForOriginChange(line, oldOrigin, newOrigin) {
        const dup = line.settings.duplication || { count: 0, dr: 0 };
        const targetDr = (dup.dr || 0) * (Math.PI / 180);
        if (targetDr === 0) return;

        const adjustPoint = (pt, factor = 1.0) => {
            const rot = targetDr * factor;
            const cosOld = Math.cos(-rot);
            const sinOld = Math.sin(-rot);
            const cosNew = Math.cos(rot);
            const sinNew = Math.sin(rot);

            let px = pt.x - oldOrigin.x;
            let py = pt.y - oldOrigin.y;
            let rx = px * cosOld - py * sinOld;
            let ry = px * sinOld + py * cosOld;
            px = rx + oldOrigin.x;
            py = ry + oldOrigin.y;

            px -= newOrigin.x;
            py -= newOrigin.y;
            rx = px * cosNew - py * sinNew;
            ry = px * sinNew + py * cosNew;
            px = rx + newOrigin.x;
            py = ry + newOrigin.y;

            pt.x = px;
            pt.y = py;
        };

        if (line.endPoints) line.endPoints.forEach(p => adjustPoint(p, 1.0));
        if (line.endCurves) {
            line.endCurves.forEach(curve => {
                adjustPoint(curve.p0, 1.0); adjustPoint(curve.cp1, 1.0); adjustPoint(curve.cp2, 1.0); adjustPoint(curve.p3, 1.0);
            });
        }

        if (line.midPoints) line.midPoints.forEach(p => adjustPoint(p, 0.5));
        if (line.midCurves) {
            line.midCurves.forEach(curve => {
                adjustPoint(curve.p0, 0.5); adjustPoint(curve.cp1, 0.5); adjustPoint(curve.cp2, 0.5); adjustPoint(curve.p3, 0.5);
            });
        }
    }

    getLerp3(s, m, e, t) {
        if (t <= 0.5) return s + (m - s) * (t * 2);
        return m + (e - m) * ((t - 0.5) * 2);
    }

    getWidthAtT(globalT, settings, dupParams = null) {
        let baseWidth = 0;
        if (globalT <= 0.5) {
            baseWidth = settings.widthStart + (settings.widthMid - settings.widthStart) * (globalT * 2);
        } else {
            baseWidth = settings.widthMid + (settings.widthEnd - settings.widthMid) * ((globalT - 0.5) * 2);
        }

        const wMult = dupParams ? dupParams.wMult : 1;
        baseWidth *= wMult;

        const ampStart = settings.modAmpStart ?? settings.modAmp ?? 0;
        const ampMid = settings.modAmpMid ?? settings.modAmp ?? 0;
        const ampEnd = settings.modAmpEnd ?? settings.modAmp ?? 0;

        let currentModAmp = 0;
        if (globalT <= 0.5) {
            currentModAmp = ampStart + (ampMid - ampStart) * (globalT * 2);
        } else {
            currentModAmp = ampMid + (ampEnd - ampMid) * ((globalT - 0.5) * 2);
        }

        let modValue = 0;
        if (settings.waveform !== 'none' && currentModAmp > 0) {
            const fMult = dupParams ? dupParams.fMult : 1;
            const aMult = dupParams ? dupParams.aMult : 1;
            const pOffset = dupParams ? dupParams.pOffset : 0;
            
            const freq = (settings.modFreq || 10) * fMult;
            const phase = (globalT * Math.PI * 2 * freq) + pOffset;
            
            let rawWave = 0;
            switch (settings.waveform) {
                case 'sine': rawWave = (Math.sin(phase) + 1) / 2; break;
                case 'sawtooth': rawWave = ((phase / (Math.PI * 2)) % 1); if(rawWave < 0) rawWave += 1; break;
                case 'square': rawWave = Math.sin(phase) >= 0 ? 1 : 0; break;
            }
            modValue = Math.pow(rawWave, settings.modExp) * (currentModAmp * aMult);
        }
        return Math.max(0.1, baseWidth + modValue);
    }

    drawGrid() {
        if (!this.gridEnabled) return;

        const w = this.ctx.canvas.width / (window.devicePixelRatio || 1);
        const h = this.ctx.canvas.height / (window.devicePixelRatio || 1);
        const corners = [
            this.screenToWorld(0, 0),
            this.screenToWorld(w, 0),
            this.screenToWorld(0, h),
            this.screenToWorld(w, h)
        ];
        
        let minX = Math.floor(Math.min(...corners.map(c => c.x)) / this.gridSize) * this.gridSize;
        let maxX = Math.max(...corners.map(c => c.x));
        let minY = Math.floor(Math.min(...corners.map(c => c.y)) / this.gridSize) * this.gridSize;
        let maxY = Math.max(...corners.map(c => c.y));

        this.ctx.save();

        this.ctx.strokeStyle = '#e0e0e0';
        this.ctx.lineWidth = 0.5 / this.camera.zoom;

        for (let x = minX; x <= maxX; x += this.gridSize) {
            if (Math.abs(x) < 0.1) continue;
            this.ctx.beginPath(); this.ctx.moveTo(x, minY); this.ctx.lineTo(x, maxY); this.ctx.stroke();
        }
        for (let y = minY; y <= maxY; y += this.gridSize) {
            if (Math.abs(y) < 0.1) continue;
            this.ctx.beginPath(); this.ctx.moveTo(minX, y); this.ctx.lineTo(maxX, y); this.ctx.stroke();
        }

        this.ctx.strokeStyle = '#b0b0b0';
        this.ctx.lineWidth = 1.5 / this.camera.zoom;
        this.ctx.beginPath(); this.ctx.moveTo(0, minY); this.ctx.lineTo(0, maxY); this.ctx.stroke();
        this.ctx.beginPath(); this.ctx.moveTo(minX, 0); this.ctx.lineTo(maxX, 0); this.ctx.stroke();
        
        this.ctx.restore();
    }

    redraw() {
        const width = this.ctx.canvas.width;
        const height = this.ctx.canvas.height;
        const dpr = window.devicePixelRatio || 1;

        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, width, height);

        this.ctx.scale(dpr, dpr);
        this.ctx.translate(this.camera.x, this.camera.y);
        this.ctx.scale(this.camera.zoom, this.camera.zoom);
        this.ctx.rotate(this.camera.angle);

        this.drawGrid();

        let tempPointAdded = false;
        if (this.currentTool === 'draw' && this.currentLine && this.previewPoint) {
            const lastPt = this.currentLine.points[this.currentLine.points.length - 1];
            if (Math.hypot(this.previewPoint.x - lastPt.x, this.previewPoint.y - lastPt.y) > (5 / this.camera.zoom)) {
                this.currentLine.points.push({ ...this.previewPoint, pressure: 0.5 });
                this.currentLine.curves = this.generateCurvesFromPoints(this.currentLine.points);
                tempPointAdded = true;
            }
        }

        this.lines.forEach(line => this.drawLine(line));
        if (this.currentLine) this.drawLine(this.currentLine);

        if (tempPointAdded) {
            this.currentLine.points.pop();
            this.currentLine.curves = this.generateCurvesFromPoints(this.currentLine.points);
        }

        if (this.currentTool === 'select' && this.selectedLine) {
            this.drawControlHandles(this.selectedLine);
        }
    }

    getInterpolatedCurves(line, dupT) {
        const startCurves = line.curves;
        const endCurves = line.endCurves;
        const midCurves = (line.midCurves && line.midCurves.length === startCurves.length) ? line.midCurves : null;

        if (!endCurves || endCurves.length !== startCurves.length) {
            return startCurves;
        }

        const origin = line.origin || { x: 0, y: 0 };
        const dup = line.settings.duplication || {};
        const hasRot = dup.dr !== undefined && dup.dr !== 0;
        const totalRotRad = (dup.dr || 0) * (Math.PI / 180);

        const getQuad = (s, m, e, t) => {
            const u = 1 - t;
            return u * u * s + 2 * u * t * m + t * t * e;
        };

        const interpolateAnchor = (sp, ep, mp) => {
            if (hasRot) {
                const startAngle = Math.atan2(sp.y - origin.y, sp.x - origin.x);
                const endAngle = Math.atan2(ep.y - origin.y, ep.x - origin.x);
                let angleDiff = endAngle - startAngle;

                if (totalRotRad > 0) {
                    while (angleDiff < 0) angleDiff += Math.PI * 2;
                    while (angleDiff > Math.PI * 2) angleDiff -= Math.PI * 2;
                    const turns = Math.floor(totalRotRad / (Math.PI * 2));
                    angleDiff += turns * Math.PI * 2;
                } else if (totalRotRad < 0) {
                    while (angleDiff > 0) angleDiff -= Math.PI * 2;
                    while (angleDiff < -Math.PI * 2) angleDiff += Math.PI * 2;
                    const turns = Math.ceil(totalRotRad / (Math.PI * 2));
                    angleDiff += turns * Math.PI * 2;
                }

                const contEndAngle = startAngle + angleDiff;
                const startRadius = Math.hypot(sp.x - origin.x, sp.y - origin.y);
                const endRadius = Math.hypot(ep.x - origin.x, ep.y - origin.y);

                let currentAngle, currentRadius;

                if (mp) {
                    const midAngleRaw = Math.atan2(mp.y - origin.y, mp.x - origin.x);
                    let midAngleDiff = midAngleRaw - startAngle;
                    const expectedMidDiff = angleDiff * 0.5;
                    let turnsToAdd = Math.round((expectedMidDiff - midAngleDiff) / (Math.PI * 2));
                    midAngleDiff += turnsToAdd * Math.PI * 2;
                    
                    const contMidAngle = startAngle + midAngleDiff;
                    const midRadius = Math.hypot(mp.x - origin.x, mp.y - origin.y);

                    currentAngle = getQuad(startAngle, contMidAngle, contEndAngle, dupT);
                    currentRadius = getQuad(startRadius, midRadius, endRadius, dupT);
                } else {
                    currentAngle = startAngle + angleDiff * dupT;
                    currentRadius = startRadius + (endRadius - startRadius) * dupT;
                }

                return {
                    x: origin.x + Math.cos(currentAngle) * currentRadius,
                    y: origin.y + Math.sin(currentAngle) * currentRadius
                };
            } else {
                if (mp) {
                    return { x: getQuad(sp.x, mp.x, ep.x, dupT), y: getQuad(sp.y, mp.y, ep.y, dupT) };
                } else {
                    return { x: sp.x + (ep.x - sp.x) * dupT, y: sp.y + (ep.y - sp.y) * dupT };
                }
            }
        };

        const numCurves = startCurves.length;
        const anchors = [];
        for (let i = 0; i <= numCurves; i++) {
            const sp = (i === numCurves) ? startCurves[i - 1].p3 : startCurves[i].p0;
            const ep = (i === numCurves) ? endCurves[i - 1].p3 : endCurves[i].p0;
            const mp = midCurves ? ((i === numCurves) ? midCurves[i - 1].p3 : midCurves[i].p0) : null;
            anchors.push(interpolateAnchor(sp, ep, mp));
        }

        const outgoingHandles = [];
        const incomingHandles = [];

        const interpolateHandleVector = (vStart, vEnd, vMid) => {
            const lenStart = Math.hypot(vStart.x, vStart.y);
            const lenEnd = Math.hypot(vEnd.x, vEnd.y);
            const angStart = Math.atan2(vStart.y, vStart.x);
            const angEnd = Math.atan2(vEnd.y, vEnd.x);
            
            let diffEnd = angEnd - angStart;

            if (totalRotRad > 0) {
                while (diffEnd < 0) diffEnd += Math.PI * 2;
                while (diffEnd > Math.PI * 2) diffEnd -= Math.PI * 2;
                const turns = Math.floor(totalRotRad / (Math.PI * 2));
                diffEnd += turns * Math.PI * 2;
            } else if (totalRotRad < 0) {
                while (diffEnd > 0) diffEnd -= Math.PI * 2;
                while (diffEnd < -Math.PI * 2) diffEnd += Math.PI * 2;
                const turns = Math.ceil(totalRotRad / (Math.PI * 2));
                diffEnd += turns * Math.PI * 2;
            }

            const contEndAng = angStart + diffEnd;
            let curAng, curLen;

            if (vMid) {
                const lenMid = Math.hypot(vMid.x, vMid.y);
                const angMid = Math.atan2(vMid.y, vMid.x);
                let diffMid = angMid - angStart;
                const expectedMidDiff = diffEnd * 0.5;
                let turnsToAdd = Math.round((expectedMidDiff - diffMid) / (Math.PI * 2));
                diffMid += turnsToAdd * Math.PI * 2;
                
                const contMidAng = angStart + diffMid;

                curAng = getQuad(angStart, contMidAng, contEndAng, dupT);
                curLen = getQuad(lenStart, lenMid, lenEnd, dupT);
            } else {
                curAng = angStart + diffEnd * dupT;
                curLen = lenStart + (lenEnd - lenStart) * dupT;
            }

            if (curLen === 0) return { x: 0, y: 0 };
            return {
                x: Math.cos(curAng) * curLen,
                y: Math.sin(curAng) * curLen
            };
        };

        const v0_s = { x: startCurves[0].cp1.x - startCurves[0].p0.x, y: startCurves[0].cp1.y - startCurves[0].p0.y };
        const v0_e = { x: endCurves[0].cp1.x - endCurves[0].p0.x, y: endCurves[0].cp1.y - endCurves[0].p0.y };
        const v0_m = midCurves ? { x: midCurves[0].cp1.x - midCurves[0].p0.x, y: midCurves[0].cp1.y - midCurves[0].p0.y } : null;
        const h0 = interpolateHandleVector(v0_s, v0_e, v0_m);
        outgoingHandles[0] = { x: anchors[0].x + h0.x, y: anchors[0].y + h0.y };

        const vN_s = { x: startCurves[numCurves - 1].cp2.x - startCurves[numCurves - 1].p3.x, y: startCurves[numCurves - 1].cp2.y - startCurves[numCurves - 1].p3.y };
        const vN_e = { x: endCurves[numCurves - 1].cp2.x - endCurves[numCurves - 1].p3.x, y: endCurves[numCurves - 1].cp2.y - endCurves[numCurves - 1].p3.y };
        const vN_m = midCurves ? { x: midCurves[numCurves - 1].cp2.x - midCurves[numCurves - 1].p3.x, y: midCurves[numCurves - 1].cp2.y - midCurves[numCurves - 1].p3.y } : null;
        const hN = interpolateHandleVector(vN_s, vN_e, vN_m);
        incomingHandles[numCurves - 1] = { x: anchors[numCurves].x + hN.x, y: anchors[numCurves].y + hN.y };

        for (let i = 1; i < numCurves; i++) {
            const anchor = anchors[i];

            const vIn_s = { x: startCurves[i - 1].cp2.x - startCurves[i - 1].p3.x, y: startCurves[i - 1].cp2.y - startCurves[i - 1].p3.y };
            const vOut_s = { x: startCurves[i].cp1.x - startCurves[i].p0.x, y: startCurves[i].cp1.y - startCurves[i].p0.y };

            const vIn_e = { x: endCurves[i - 1].cp2.x - endCurves[i - 1].p3.x, y: endCurves[i - 1].cp2.y - endCurves[i - 1].p3.y };
            const vOut_e = { x: endCurves[i].cp1.x - endCurves[i].p0.x, y: endCurves[i].cp1.y - endCurves[i].p0.y };

            const vIn_m = midCurves ? { x: midCurves[i - 1].cp2.x - midCurves[i - 1].p3.x, y: midCurves[i - 1].cp2.y - midCurves[i - 1].p3.y } : null;
            const vOut_m = midCurves ? { x: midCurves[i].cp1.x - midCurves[i].p0.x, y: midCurves[i].cp1.y - midCurves[i].p0.y } : null;

            const lenIn_s = Math.hypot(vIn_s.x, vIn_s.y);
            const lenOut_s = Math.hypot(vOut_s.x, vOut_s.y);
            const lenIn_e = Math.hypot(vIn_e.x, vIn_e.y);
            const lenOut_e = Math.hypot(vOut_e.x, vOut_e.y);

            const angOut_s = (lenOut_s > 0.001) ? Math.atan2(vOut_s.y, vOut_s.x) : Math.atan2(-vIn_s.y, -vIn_s.x);
            const angOut_e = (lenOut_e > 0.001) ? Math.atan2(vOut_e.y, vOut_e.x) : Math.atan2(-vIn_e.y, -vIn_e.x);

            let dAng = angOut_e - angOut_s;
            if (totalRotRad > 0) {
                while (dAng < 0) dAng += Math.PI * 2;
                while (dAng > Math.PI * 2) dAng -= Math.PI * 2;
                const turns = Math.floor(totalRotRad / (Math.PI * 2));
                dAng += turns * Math.PI * 2;
            } else if (totalRotRad < 0) {
                while (dAng > 0) dAng -= Math.PI * 2;
                while (dAng < -Math.PI * 2) dAng += Math.PI * 2;
                const turns = Math.ceil(totalRotRad / (Math.PI * 2));
                dAng += turns * Math.PI * 2;
            }

            const contEndAng = angOut_s + dAng;
            let curTanAngle, curLenIn, curLenOut;

            if (midCurves) {
                const lenIn_m = Math.hypot(vIn_m.x, vIn_m.y);
                const lenOut_m = Math.hypot(vOut_m.x, vOut_m.y);
                const angOut_m = (lenOut_m > 0.001) ? Math.atan2(vOut_m.y, vOut_m.x) : Math.atan2(-vIn_m.y, -vIn_m.x);

                let dAngMid = angOut_m - angOut_s;
                const expectedMidDiff = dAng * 0.5;
                let turnsToAdd = Math.round((expectedMidDiff - dAngMid) / (Math.PI * 2));
                dAngMid += turnsToAdd * Math.PI * 2;
                const contMidAng = angOut_s + dAngMid;

                curTanAngle = getQuad(angOut_s, contMidAng, contEndAng, dupT);
                curLenIn = getQuad(lenIn_s, lenIn_m, lenIn_e, dupT);
                curLenOut = getQuad(lenOut_s, lenOut_m, lenOut_e, dupT);
            } else {
                curTanAngle = angOut_s + dAng * dupT;
                curLenIn = lenIn_s + (lenIn_e - lenIn_s) * dupT;
                curLenOut = lenOut_s + (lenOut_e - lenOut_s) * dupT;
            }

            const cosT = Math.cos(curTanAngle);
            const sinT = Math.sin(curTanAngle);

            outgoingHandles[i] = {
                x: anchor.x + cosT * curLenOut,
                y: anchor.y + sinT * curLenOut
            };

            incomingHandles[i - 1] = {
                x: anchor.x - cosT * curLenIn,
                y: anchor.y - sinT * curLenIn
            };
        }

        const interpolatedCurves = [];
        for (let i = 0; i < numCurves; i++) {
            interpolatedCurves.push({
                p0: anchors[i],
                cp1: outgoingHandles[i],
                cp2: incomingHandles[i],
                p3: anchors[i + 1]
            });
        }

        return interpolatedCurves;
    }

    drawLine(line) {
        if (line.points.length === 1) {
            this.ctx.beginPath();
            this.ctx.arc(line.points[0].x, line.points[0].y, line.settings.widthStart / 2, 0, Math.PI * 2);
            this.ctx.fillStyle = line.settings.color;
            this.ctx.fill();
            return;
        }

        const dup = line.settings.duplication || { count: 1 };
        const totalShapes = Math.max(1, parseInt(dup.count) || 1);

        if (totalShapes > 1 && (!line.endCurves || line.endCurves.length !== line.curves.length)) {
            this.syncEndShapeToDuplication(line);
        }

        for (let j = 0; j < totalShapes; j++) {
            const dupT = totalShapes > 1 ? (j / (totalShapes - 1)) : 0;
            
            const dupParams = {
                wMult: dup.w ? this.getLerp3(1, dup.w.m, dup.w.e, dupT) : 1,
                pOffset: dup.p ? this.getLerp3(0, dup.p.m, dup.p.e, dupT) : 0,
                aMult: dup.a ? this.getLerp3(1, dup.a.m, dup.a.e, dupT) : 1,
                fMult: dup.f ? this.getLerp3(1, dup.f.m, dup.f.e, dupT) : 1,
                sMult: dup.s ? this.getLerp3(1, dup.s.m, dup.s.e, dupT) : 1,
            };

            const currentCurves = (totalShapes > 1 && line.endCurves && line.endCurves.length === line.curves.length) 
                ? this.getInterpolatedCurves(line, dupT) 
                : line.curves;

            if (!currentCurves || currentCurves.length === 0) continue;

            this.ctx.save();
            
            if (dupParams.sMult !== 1) {
                const origin = line.origin || { x: 0, y: 0 };
                this.ctx.translate(origin.x, origin.y);
                this.ctx.scale(dupParams.sMult, dupParams.sMult);
                this.ctx.translate(-origin.x, -origin.y);
            }

            const totalCurves = currentCurves.length;
            currentCurves.forEach((curve, index) => {
                const steps = 150; 
                for (let i = 0; i < steps; i++) {
                    const localT = i / steps;
                    const pt = this.getBezierPoint(localT, curve.p0, curve.cp1, curve.cp2, curve.p3);
                    const nextPt = this.getBezierPoint((i + 1) / steps, curve.p0, curve.cp1, curve.cp2, curve.p3);
                    const width = this.getWidthAtT((index + localT) / totalCurves, line.settings, dupParams);
                    
                    this.ctx.beginPath();
                    this.ctx.lineWidth = width;
                    this.ctx.lineCap = line.settings.lineCap || 'round';
                    this.ctx.lineJoin = 'round';
                    this.ctx.strokeStyle = line.settings.color;
                    this.ctx.moveTo(pt.x, pt.y);
                    this.ctx.lineTo(nextPt.x, nextPt.y);
                    this.ctx.stroke();
                }
            });

            this.ctx.restore();
        }
    }

    getBezierPoint(t, p0, p1, p2, p3) {
        const u = 1 - t, tt = t * t, uu = u * u, uuu = uu * u, ttt = tt * t;
        let x = uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x;
        let y = uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y;
        return { x, y };
    }

    splitCurve(line, curveIndex, t) {
        const c = line.curves[curveIndex];
        const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        const q0 = lerp(c.p0, c.cp1, t), q1 = lerp(c.cp1, c.cp2, t), q2 = lerp(c.cp2, c.p3, t);
        const r0 = lerp(q0, q1, t), r1 = lerp(q1, q2, t), s0 = lerp(r0, r1, t);
        
        const curve1 = { p0: c.p0, cp1: q0, cp2: r0, p3: s0 };
        const curve2 = { p0: s0, cp1: r1, cp2: q2, p3: c.p3 };

        line.points.splice(curveIndex + 1, 0, s0);
        line.curves.splice(curveIndex, 1, curve1, curve2);

        if (line.endPoints && line.endCurves && line.endCurves[curveIndex]) {
            const ec = line.endCurves[curveIndex];
            const eq0 = lerp(ec.p0, ec.cp1, t), eq1 = lerp(ec.cp1, ec.cp2, t), eq2 = lerp(ec.cp2, ec.p3, t);
            const er0 = lerp(eq0, eq1, t), er1 = lerp(eq1, eq2, t), es0 = lerp(er0, er1, t);
            
            const eCurve1 = { p0: ec.p0, cp1: eq0, cp2: er0, p3: es0 };
            const eCurve2 = { p0: es0, cp1: er1, cp2: eq2, p3: ec.p3 };

            line.endPoints.splice(curveIndex + 1, 0, es0);
            line.endCurves.splice(curveIndex, 1, eCurve1, eCurve2);
        }

        if (line.midPoints && line.midCurves && line.midCurves[curveIndex]) {
            const mc = line.midCurves[curveIndex];
            const mq0 = lerp(mc.p0, mc.cp1, t), mq1 = lerp(mc.cp1, mc.cp2, t), mq2 = lerp(mc.cp2, mc.p3, t);
            const mr0 = lerp(mq0, mq1, t), mr1 = lerp(mq1, mq2, t), ms0 = lerp(mr0, mr1, t);
            
            const mCurve1 = { p0: mc.p0, cp1: mq0, cp2: mr0, p3: ms0 };
            const mCurve2 = { p0: ms0, cp1: mr1, cp2: mq2, p3: mc.p3 };

            line.midPoints.splice(curveIndex + 1, 0, ms0);
            line.midCurves.splice(curveIndex, 1, mCurve1, mCurve2);
        }
    }

    deleteActivePoint() {
        const line = this.selectedLine;
        const handle = this.activeHandle;
        if (!line || !handle || handle.type === 'origin' || handle.type === 'line' || line.points.length <= 2) return;

        this.saveState(); 
        const pIdx = handle.pointIndex !== undefined ? handle.pointIndex : handle.curveIndex;
        
        line.points.splice(pIdx, 1);
        
        if (pIdx === 0) {
            line.curves.shift();
        } else if (pIdx === line.points.length) {
            line.curves.pop();
        } else {
            const prev = line.curves[pIdx - 1];
            const next = line.curves[pIdx];
            const mergedCurve = { p0: prev.p0, cp1: prev.cp1, cp2: next.cp2, p3: next.p3 };
            line.curves.splice(pIdx - 1, 2, mergedCurve);
        }

        if (line.endPoints && line.endPoints.length > pIdx) {
            line.endPoints.splice(pIdx, 1);
            if (pIdx === 0) {
                line.endCurves.shift();
            } else if (pIdx === line.endPoints.length) {
                line.endCurves.pop();
            } else {
                const prevE = line.endCurves[pIdx - 1];
                const nextE = line.endCurves[pIdx];
                const mergedECurve = { p0: prevE.p0, cp1: prevE.cp1, cp2: nextE.cp2, p3: nextE.p3 };
                line.endCurves.splice(pIdx - 1, 2, mergedECurve);
            }
        }

        if (line.midPoints && line.midPoints.length > pIdx) {
            line.midPoints.splice(pIdx, 1);
            if (pIdx === 0) {
                line.midCurves.shift();
            } else if (pIdx === line.midPoints.length) {
                line.midCurves.pop();
            } else {
                const prevM = line.midCurves[pIdx - 1];
                const nextM = line.midCurves[pIdx];
                const mergedMCurve = { p0: prevM.p0, cp1: prevM.cp1, cp2: nextM.cp2, p3: nextM.p3 };
                line.midCurves.splice(pIdx - 1, 2, mergedMCurve);
            }
        }

        this.activeHandle = null;
        this.redraw();
    }

    handleSelectDown(x, y) {
        const snapped = this.snap(x, y);
        const now = Date.now();
        const isDoubleClick = (now - this.lastClick.time < 400) && (Math.hypot(snapped.x - this.lastClick.x, snapped.y - this.lastClick.y) < (20 / this.camera.zoom));
        this.lastClick = { time: now, x: snapped.x, y: snapped.y };

        if (this.selectedLine) {
            this.activeHandle = this.getHandleAtPosition(snapped.x, snapped.y);
            if (this.activeHandle) { 
                this.lastDragPos = { x: snapped.x, y: snapped.y }; 
                this.dragStartPos = { x: snapped.x, y: snapped.y };
                this.redraw(); 
                return; 
            }
        }

        const HIT_TOLERANCE = 15 / this.camera.zoom;
        let hitLine = null;
        let hitCurveIndex = -1;
        let hitT = -1;
        let hitShapeIndex = -1;

        for (let i = this.lines.length - 1; i >= 0; i--) {
            const line = this.lines[i];
            
            if (line.origin && Math.hypot(snapped.x - line.origin.x, snapped.y - line.origin.y) < HIT_TOLERANCE) {
                this.selectedLine = line;
                this.activeHandle = { type: 'origin' };
                this.lastDragPos = { x: snapped.x, y: snapped.y }; 
                this.dragStartPos = { x: snapped.x, y: snapped.y };
                window.dispatchEvent(new CustomEvent('lineSelected', { detail: line }));
                this.redraw();
                return;
            }

            const dup = line.settings.duplication || { count: 1 };
            const totalShapes = Math.max(1, parseInt(dup.count) || 1);

            for (let j = 0; j < totalShapes; j++) {
                const dupT = totalShapes > 1 ? (j / (totalShapes - 1)) : 0;
                const currentCurves = (totalShapes > 1 && line.endCurves && line.endCurves.length === line.curves.length) 
                    ? this.getInterpolatedCurves(line, dupT) 
                    : line.curves;

                for (let cIdx = 0; cIdx < currentCurves.length; cIdx++) {
                    const curve = currentCurves[cIdx];
                    for (let t = 0; t <= 1; t += 0.02) { 
                        const pt = this.getBezierPoint(t, curve.p0, curve.cp1, curve.cp2, curve.p3);
                        if (Math.hypot(snapped.x - pt.x, snapped.y - pt.y) < HIT_TOLERANCE) {
                            hitLine = line; hitCurveIndex = cIdx; hitT = t; hitShapeIndex = j; break;
                        }
                    }
                    if (hitLine) break;
                }
                if (hitLine) break;
            }
            if (hitLine) break;
        }

        if (hitLine) {
            if (hitLine === this.selectedLine && isDoubleClick) {
                const dup = hitLine.settings.duplication || { count: 1 };
                const tShapes = Math.max(1, parseInt(dup.count) || 1);

                if (!hitLine.midCurves && hitShapeIndex > 0 && hitShapeIndex < (tShapes - 1)) {
                    this.saveState();
                    hitLine.midCurves = JSON.parse(JSON.stringify(this.getInterpolatedCurves(hitLine, 0.5)));
                    
                    hitLine.midPoints = [];
                    hitLine.midCurves.forEach((c, idx) => {
                        hitLine.midPoints.push({ x: c.p0.x, y: c.p0.y, pressure: hitLine.points[idx].pressure || 0.5 });
                        if (idx === hitLine.midCurves.length - 1) {
                            hitLine.midPoints.push({ x: c.p3.x, y: c.p3.y, pressure: hitLine.points[idx + 1] ? hitLine.points[idx + 1].pressure : 0.5 });
                        }
                    });

                    this.redraw();
                    return;
                } else if (hitCurveIndex !== -1 && hitT !== -1) {
                    this.saveState(); 
                    this.splitCurve(hitLine, hitCurveIndex, hitT);
                    this.redraw();
                    return;
                }
            }
            
            this.selectedLine = hitLine;
            this.activeHandle = { type: 'line' };
            this.lastDragPos = { x: snapped.x, y: snapped.y };
            this.dragStartPos = { x: snapped.x, y: snapped.y };

            window.dispatchEvent(new CustomEvent('lineSelected', { detail: hitLine }));
            this.redraw();
            return;
        }

        this.selectedLine = null;
        this.activeHandle = null;
        window.dispatchEvent(new Event('lineDeselected'));
        this.redraw();
    }

    getHandleAtPosition(x, y) {
        const RADIUS = 15 / this.camera.zoom;
        const line = this.selectedLine;
        if (!line) return null;

        if (line.origin && Math.hypot(x - line.origin.x, y - line.origin.y) < RADIUS) return { type: 'origin' };

        for (let i = 0; i < line.curves.length; i++) {
            const curve = line.curves[i];
            if (Math.hypot(x - curve.p0.x, y - curve.p0.y) < RADIUS) return { curveIndex: i, type: 'p0', target: 'start', pointIndex: i };
            if (Math.hypot(x - curve.cp1.x, y - curve.cp1.y) < RADIUS) return { curveIndex: i, type: 'cp1', target: 'start' };
            if (Math.hypot(x - curve.cp2.x, y - curve.cp2.y) < RADIUS) return { curveIndex: i, type: 'cp2', target: 'start' };
            if (i === line.curves.length - 1 && Math.hypot(x - curve.p3.x, y - curve.p3.y) < RADIUS) {
                return { curveIndex: i, type: 'p3', target: 'start', pointIndex: i + 1 };
            }
        }

        const dupCount = line.settings.duplication?.count || 1;
        const totalShapes = Math.max(1, parseInt(dupCount) || 1);

        if (totalShapes > 1 && line.endCurves) {
            for (let i = 0; i < line.endCurves.length; i++) {
                const curve = line.endCurves[i];
                if (Math.hypot(x - curve.p0.x, y - curve.p0.y) < RADIUS) return { curveIndex: i, type: 'p0', target: 'end', pointIndex: i };
                if (Math.hypot(x - curve.cp1.x, y - curve.cp1.y) < RADIUS) return { curveIndex: i, type: 'cp1', target: 'end' };
                if (Math.hypot(x - curve.cp2.x, y - curve.cp2.y) < RADIUS) return { curveIndex: i, type: 'cp2', target: 'end' };
                if (i === line.endCurves.length - 1 && Math.hypot(x - curve.p3.x, y - curve.p3.y) < RADIUS) {
                    return { curveIndex: i, type: 'p3', target: 'end', pointIndex: i + 1 };
                }
            }
        }

        if (totalShapes > 2 && line.midCurves) {
            for (let i = 0; i < line.midCurves.length; i++) {
                const curve = line.midCurves[i];
                if (Math.hypot(x - curve.p0.x, y - curve.p0.y) < RADIUS) return { curveIndex: i, type: 'p0', target: 'mid', pointIndex: i };
                if (Math.hypot(x - curve.cp1.x, y - curve.cp1.y) < RADIUS) return { curveIndex: i, type: 'cp1', target: 'mid' };
                if (Math.hypot(x - curve.cp2.x, y - curve.cp2.y) < RADIUS) return { curveIndex: i, type: 'cp2', target: 'mid' };
                if (i === line.midCurves.length - 1 && Math.hypot(x - curve.p3.x, y - curve.p3.y) < RADIUS) {
                    return { curveIndex: i, type: 'p3', target: 'mid', pointIndex: i + 1 };
                }
            }
        }

        return null;
    }

    dragHandle(x, y) {
        if (!this.selectedLine || !this.activeHandle) return;
        const snapped = this.snap(x, y);
        
        if (this.activeHandle.type === 'line') {
            if (!this.lastDragPos) this.lastDragPos = { x: snapped.x, y: snapped.y };
            const dx = snapped.x - this.lastDragPos.x;
            const dy = snapped.y - this.lastDragPos.y;
            if (dx === 0 && dy === 0) return;

            if (this.selectedLine.origin) {
                this.selectedLine.origin.x += dx; this.selectedLine.origin.y += dy;
            }
            this.selectedLine.points.forEach(pt => { pt.x += dx; pt.y += dy; });
            this.selectedLine.curves.forEach(curve => {
                curve.p0.x += dx; curve.p0.y += dy;
                curve.cp1.x += dx; curve.cp1.y += dy;
                curve.cp2.x += dx; curve.cp2.y += dy;
                curve.p3.x += dx; curve.p3.y += dy;
            });

            if (this.selectedLine.endPoints && this.selectedLine.endCurves) {
                this.selectedLine.endPoints.forEach(pt => { pt.x += dx; pt.y += dy; });
                this.selectedLine.endCurves.forEach(curve => {
                    curve.p0.x += dx; curve.p0.y += dy;
                    curve.cp1.x += dx; curve.cp1.y += dy;
                    curve.cp2.x += dx; curve.cp2.y += dy;
                    curve.p3.x += dx; curve.p3.y += dy;
                });
            }

            if (this.selectedLine.midPoints && this.selectedLine.midCurves) {
                this.selectedLine.midPoints.forEach(pt => { pt.x += dx; pt.y += dy; });
                this.selectedLine.midCurves.forEach(curve => {
                    curve.p0.x += dx; curve.p0.y += dy;
                    curve.cp1.x += dx; curve.cp1.y += dy;
                    curve.cp2.x += dx; curve.cp2.y += dy;
                    curve.p3.x += dx; curve.p3.y += dy;
                });
            }

            this.lastDragPos = { x: snapped.x, y: snapped.y };
            this.redraw();
            return;
        }

        if (this.activeHandle.type === 'origin') {
            const oldOrigin = this.selectedLine.origin ? { ...this.selectedLine.origin } : { x: snapped.x, y: snapped.y };
            const newOrigin = { x: snapped.x, y: snapped.y };
            this.selectedLine.origin = newOrigin;
            
            this.updateEndShapeForOriginChange(this.selectedLine, oldOrigin, newOrigin);
            this.redraw();
            return;
        }

        const isEnd = (this.activeHandle.target === 'end');
        const isMid = (this.activeHandle.target === 'mid');
        const curvesArray = isEnd ? this.selectedLine.endCurves : (isMid ? this.selectedLine.midCurves : this.selectedLine.curves);
        const pointsArray = isEnd ? this.selectedLine.endPoints : (isMid ? this.selectedLine.midPoints : this.selectedLine.points);
        
        const cIdx = this.activeHandle.curveIndex;
        const curve = curvesArray[cIdx];
        const type = this.activeHandle.type;

        if (!curve) return;

        if (type === 'cp1') {
            curve.cp1 = { x: snapped.x, y: snapped.y };
            if (cIdx > 0) {
                const prev = curvesArray[cIdx - 1];
                const anchor = curve.p0;
                const angle = Math.atan2(curve.cp1.y - anchor.y, curve.cp1.x - anchor.x) + Math.PI;
                const dist = Math.hypot(prev.cp2.x - anchor.x, prev.cp2.y - anchor.y);
                prev.cp2 = { x: anchor.x + Math.cos(angle) * dist, y: anchor.y + Math.sin(angle) * dist };
            }
        } else if (type === 'cp2') {
            curve.cp2 = { x: snapped.x, y: snapped.y };
            if (cIdx < curvesArray.length - 1) {
                const next = curvesArray[cIdx + 1];
                const anchor = curve.p3;
                const angle = Math.atan2(curve.cp2.y - anchor.y, curve.cp2.x - anchor.x) + Math.PI;
                const dist = Math.hypot(next.cp1.x - anchor.x, next.cp1.y - anchor.y);
                next.cp1 = { x: anchor.x + Math.cos(angle) * dist, y: anchor.y + Math.sin(angle) * dist };
            }
        } else if (type === 'p0' || type === 'p3') {
            const pIdx = this.activeHandle.pointIndex;
            const dx = snapped.x - curve[type].x;
            const dy = snapped.y - curve[type].y;

            if (pointsArray && pointsArray[pIdx]) {
                pointsArray[pIdx].x = snapped.x;
                pointsArray[pIdx].y = snapped.y;
            }

            if (type === 'p0') {
                curve.p0.x = snapped.x;
                curve.p0.y = snapped.y;
                curve.cp1.x += dx;
                curve.cp1.y += dy;
                if (cIdx > 0) {
                    const prev = curvesArray[cIdx - 1];
                    prev.p3.x = snapped.x;
                    prev.p3.y = snapped.y;
                    prev.cp2.x += dx;
                    prev.cp2.y += dy;
                }
            } else if (type === 'p3') {
                curve.p3.x = snapped.x;
                curve.p3.y = snapped.y;
                curve.cp2.x += dx;
                curve.cp2.y += dy;
                if (cIdx < curvesArray.length - 1) {
                    const next = curvesArray[cIdx + 1];
                    next.p0.x = snapped.x;
                    next.p0.y = snapped.y;
                    next.cp1.x += dx;
                    next.cp1.y += dy;
                }
            }
        }

        this.redraw();
    }

    drawControlHandles(line) {
        this.ctx.lineWidth = 1 / this.camera.zoom;
        
        this.ctx.strokeStyle = '#0a84ff';
        line.curves.forEach((curve, index) => {
            this.ctx.beginPath(); this.ctx.moveTo(curve.p0.x, curve.p0.y); this.ctx.lineTo(curve.cp1.x, curve.cp1.y); this.ctx.stroke();
            this.ctx.beginPath(); this.ctx.moveTo(curve.p3.x, curve.p3.y); this.ctx.lineTo(curve.cp2.x, curve.cp2.y); this.ctx.stroke();
            this.drawDot(curve.cp1.x, curve.cp1.y, '#0a84ff', false);
            this.drawDot(curve.cp2.x, curve.cp2.y, '#0a84ff', false);
            this.drawDot(curve.p0.x, curve.p0.y, '#ffffff', true);
            if (index === line.curves.length - 1) this.drawDot(curve.p3.x, curve.p3.y, '#ffffff', true);
        });

        const dupCount = line.settings.duplication?.count || 1;
        const totalShapes = Math.max(1, parseInt(dupCount) || 1);

        if (totalShapes > 1 && line.endCurves) {
            this.ctx.strokeStyle = '#ff9f0a';
            line.endCurves.forEach((curve, index) => {
                this.ctx.beginPath(); this.ctx.moveTo(curve.p0.x, curve.p0.y); this.ctx.lineTo(curve.cp1.x, curve.cp1.y); this.ctx.stroke();
                this.ctx.beginPath(); this.ctx.moveTo(curve.p3.x, curve.p3.y); this.ctx.lineTo(curve.cp2.x, curve.cp2.y); this.ctx.stroke();
                this.drawDot(curve.cp1.x, curve.cp1.y, '#ff9f0a', false);
                this.drawDot(curve.cp2.x, curve.cp2.y, '#ff9f0a', false);
                this.drawDot(curve.p0.x, curve.p0.y, '#ff9f0a', true);
                if (index === line.endCurves.length - 1) this.drawDot(curve.p3.x, curve.p3.y, '#ff9f0a', true);
            });
        }

        if (totalShapes > 2 && line.midCurves) {
            this.ctx.strokeStyle = '#bf5af2';
            line.midCurves.forEach((curve, index) => {
                this.ctx.beginPath(); this.ctx.moveTo(curve.p0.x, curve.p0.y); this.ctx.lineTo(curve.cp1.x, curve.cp1.y); this.ctx.stroke();
                this.ctx.beginPath(); this.ctx.moveTo(curve.p3.x, curve.p3.y); this.ctx.lineTo(curve.cp2.x, curve.cp2.y); this.ctx.stroke();
                this.drawDot(curve.cp1.x, curve.cp1.y, '#bf5af2', false);
                this.drawDot(curve.cp2.x, curve.cp2.y, '#bf5af2', false);
                this.drawDot(curve.p0.x, curve.p0.y, '#bf5af2', true);
                if (index === line.midCurves.length - 1) this.drawDot(curve.p3.x, curve.p3.y, '#bf5af2', true);
            });
        }

        if (line.origin) this.drawDot(line.origin.x, line.origin.y, '#32d74b', true);

        if (this.activeHandle && this.activeHandle.type !== 'origin' && this.activeHandle.type !== 'line') {
            const isEnd = (this.activeHandle.target === 'end');
            const isMid = (this.activeHandle.target === 'mid');
            const targetArray = isEnd ? line.endCurves : (isMid ? line.midCurves : line.curves);
            
            const cIdx = this.activeHandle.curveIndex;
            const type = this.activeHandle.type;
            if (targetArray[cIdx] && targetArray[cIdx][type]) {
                const pt = targetArray[cIdx][type];
                this.drawDot(pt.x, pt.y, '#ff453a', true); 
            }
        }
    }

    drawDot(x, y, color, isAnchor) {
        this.ctx.beginPath();
        this.ctx.arc(x, y, (isAnchor ? 5 : 4) / this.camera.zoom, 0, Math.PI * 2);
        this.ctx.fillStyle = color;
        this.ctx.fill();
        this.ctx.stroke();
    }
}
