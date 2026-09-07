export class ExportController {
    constructor(drawingController) {
        this.drawing = drawingController;
    }

    getSVGString() {
        let svgBody = '';
        const lineCap = this.drawing.settings?.lineCap || 'round';
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        const trackPt = (x, y) => {
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
        };

        // 1. Group all drawn lines by their assigned color
        const colorGroups = {};
        for (let lIdx = 0; lIdx < this.drawing.lines.length; lIdx++) {
            const line = this.drawing.lines[lIdx];
            if (!line || !line.points || line.points.length === 0) continue;
            
            const color = (line.settings && line.settings.color) ? line.settings.color : '#000000';
            if (!colorGroups[color]) {
                colorGroups[color] = [];
            }
            colorGroups[color].push(line);
        }

        // 2. Export each color group as a single SVG <g> layer
        let layerIndex = 1;
        for (const color in colorGroups) {
            const linesInGroup = colorGroups[color];
            
            // Create a valid ID by stripping the hash from the hex color
            const safeLayerName = `Layer_${layerIndex}_Color_${color.replace('#', '')}`;
            svgBody += `  <g id="${safeLayerName}">\n`;

            for (let i = 0; i < linesInGroup.length; i++) {
                const line = linesInGroup[i];
                const cap = line.settings.lineCap || lineCap;

                if (line.points.length === 1) {
                    const pt = line.points[0];
                    const radius = (line.settings.widthStart || 5) / 2;
                    trackPt(pt.x - radius, pt.y - radius);
                    trackPt(pt.x + radius, pt.y + radius);
                    svgBody += `    <circle cx="${pt.x.toFixed(2)}" cy="${pt.y.toFixed(2)}" r="${radius.toFixed(2)}" fill="${color}" />\n`;
                    continue;
                }

                const dup = line.settings.duplication || { count: 1 };
                const totalShapes = Math.max(1, parseInt(dup.count) || 1);

                if (totalShapes > 1 && (!line.endCurves || line.endCurves.length !== line.curves.length)) {
                    this.drawing.syncEndShapeToDuplication(line);
                }

                for (let j = 0; j < totalShapes; j++) {
                    const dupT = totalShapes > 1 ? (j / (totalShapes - 1)) : 0;

                    const dupParams = {
                        wMult: dup.w ? this.drawing.getLerp3(1, dup.w.m, dup.w.e, dupT) : 1,
                        pOffset: dup.p ? this.drawing.getLerp3(0, dup.p.m, dup.p.e, dupT) : 0,
                        aMult: dup.a ? this.drawing.getLerp3(1, dup.a.m, dup.a.e, dupT) : 1,
                        fMult: dup.f ? this.drawing.getLerp3(1, dup.f.m, dup.f.e, dupT) : 1,
                        sMult: dup.s ? this.drawing.getLerp3(1, dup.s.m, dup.s.e, dupT) : 1,
                    };

                    const currentCurves = (totalShapes > 1 && line.endCurves && line.endCurves.length === line.curves.length)
                        ? this.drawing.getInterpolatedCurves(line, dupT)
                        : line.curves;

                    if (!currentCurves || currentCurves.length === 0) continue;

                    let groupOpen = '';
                    let groupClose = '';
                    if (dupParams.sMult !== 1) {
                        const origin = line.origin || { x: 0, y: 0 };
                        groupOpen = `    <g transform="translate(${origin.x}, ${origin.y}) scale(${dupParams.sMult}) translate(${-origin.x}, ${-origin.y})">\n`;
                        groupClose = `    </g>\n`;
                    }

                    if (groupOpen) svgBody += groupOpen;

                    const totalCurves = currentCurves.length;
                    const sampleSteps = 600; 
                    let rawLeft = [];
                    let rawRight = [];

                    currentCurves.forEach((curve, cIdx) => {
                        for (let i = 0; i <= sampleSteps; i++) {
                            if (cIdx > 0 && i === 0) continue;
                            const localT = i / sampleSteps;
                            const globalT = (cIdx + localT) / totalCurves;

                            const pt = this.drawing.getBezierPoint(localT, curve.p0, curve.cp1, curve.cp2, curve.p3);
                            
                            const eps = 0.0005;
                            const tPrev = Math.max(0, localT - eps);
                            const tNext = Math.min(1, localT + eps);
                            const ptPrev = this.drawing.getBezierPoint(tPrev, curve.p0, curve.cp1, curve.cp2, curve.p3);
                            const ptNext = this.drawing.getBezierPoint(tNext, curve.p0, curve.cp1, curve.cp2, curve.p3);

                            const dx = ptNext.x - ptPrev.x;
                            const dy = ptNext.y - ptPrev.y;
                            const len = Math.hypot(dx, dy) || 1;
                            
                            const nx = -dy / len;
                            const ny = dx / len;

                            const width = this.drawing.getWidthAtT(globalT, line.settings, dupParams);
                            const halfW = width / 2;

                            rawLeft.push({ x: pt.x + nx * halfW, y: pt.y + ny * halfW });
                            rawRight.push({ x: pt.x - nx * halfW, y: pt.y - ny * halfW });
                        }
                    });

                    const smoothPoints = (pts, passes = 2) => {
                        let current = [...pts];
                        for (let p = 0; p < passes; p++) {
                            const smoothed = [current[0]];
                            for (let i = 1; i < current.length - 1; i++) {
                                const prev = current[i - 1];
                                const curr = current[i];
                                const next = current[i + 1];
                                smoothed.push({ x: (prev.x + curr.x * 2 + next.x) / 4, y: (prev.y + curr.y * 2 + next.y) / 4 });
                            }
                            smoothed.push(current[current.length - 1]);
                            current = smoothed;
                        }
                        return current;
                    };

                    const leftPoints = smoothPoints(rawLeft, 2);
                    const rightPoints = smoothPoints(rawRight, 2);

                    const firstCurve = currentCurves[0];
                    const lastCurve = currentCurves[currentCurves.length - 1];
                    
                    const startTan = { x: firstCurve.cp1.x - firstCurve.p0.x, y: firstCurve.cp1.y - firstCurve.p0.y };
                    const startTanLen = Math.hypot(startTan.x, startTan.y) || 1;
                    const stx = startTan.x / startTanLen;
                    const sty = startTan.y / startTanLen;

                    const endTan = { x: lastCurve.p3.x - lastCurve.cp2.x, y: lastCurve.p3.y - lastCurve.cp2.y };
                    const endTanLen = Math.hypot(endTan.x, endTan.y) || 1;
                    const etx = endTan.x / endTanLen;
                    const ety = endTan.y / endTanLen;

                    const startCenter = firstCurve.p0;
                    const endCenter = lastCurve.p3;
                    const startW = this.drawing.getWidthAtT(0, line.settings, dupParams) / 2;
                    const endW = this.drawing.getWidthAtT(1, line.settings, dupParams) / 2;

                    const snx = -sty, sny = stx;
                    const enx = -ety, eny = etx;

                    const realStartLeft = { x: startCenter.x + snx * startW, y: startCenter.y + sny * startW };
                    const realStartRight = { x: startCenter.x - snx * startW, y: startCenter.y - sny * startW };
                    const realEndLeft = { x: endCenter.x + enx * endW, y: endCenter.y + eny * endW };
                    const realEndRight = { x: endCenter.x - enx * endW, y: endCenter.y - eny * endW };

                    leftPoints[0] = realStartLeft;
                    rightPoints[0] = realStartRight;
                    leftPoints[leftPoints.length - 1] = realEndLeft;
                    rightPoints[rightPoints.length - 1] = realEndRight;

                    let pathD = `M ${realStartLeft.x.toFixed(2)} ${realStartLeft.y.toFixed(2)}`;
                    trackPt(realStartLeft.x, realStartLeft.y);
                    
                    for (let k = 1; k < leftPoints.length; k++) {
                        pathD += ` L ${leftPoints[k].x.toFixed(2)} ${leftPoints[k].y.toFixed(2)}`;
                        trackPt(leftPoints[k].x, leftPoints[k].y);
                    }

                    if (cap === 'round') {
                        pathD += ` A ${endW.toFixed(2)} ${endW.toFixed(2)} 0 0 0 ${realEndRight.x.toFixed(2)} ${realEndRight.y.toFixed(2)}`;
                    } else {
                        pathD += ` L ${realEndRight.x.toFixed(2)} ${realEndRight.y.toFixed(2)}`;
                    }
                    trackPt(realEndRight.x, realEndRight.y);

                    for (let k = rightPoints.length - 2; k >= 0; k--) {
                        pathD += ` L ${rightPoints[k].x.toFixed(2)} ${rightPoints[k].y.toFixed(2)}`;
                        trackPt(rightPoints[k].x, rightPoints[k].y);
                    }

                    if (cap === 'round') {
                        pathD += ` A ${startW.toFixed(2)} ${startW.toFixed(2)} 0 0 0 ${realStartLeft.x.toFixed(2)} ${realStartLeft.y.toFixed(2)}`;
                    } else {
                        pathD += ` L ${realStartLeft.x.toFixed(2)} ${realStartLeft.y.toFixed(2)}`;
                    }
                    pathD += ` Z`;

                    svgBody += `    <path d="${pathD}" fill="none" stroke="${color}" stroke-width="1" stroke-linejoin="round" />\n`;
                    if (groupClose) svgBody += groupClose;
                }
            }
            svgBody += `  </g>\n`;
            layerIndex++;
        }

        if (minX === Infinity) { minX = 0; minY = 0; maxX = 100; maxY = 100; }
        
        const pad = 10;
        const vbX = (minX - pad).toFixed(2);
        const vbY = (minY - pad).toFixed(2);
        const vbW = (maxX - minX + pad * 2).toFixed(2);
        const vbH = (maxY - minY + pad * 2).toFixed(2);

        let svgContent = `<?xml version="1.0" encoding="UTF-8"?>\n`;
        svgContent += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="${vbW}mm" height="${vbH}mm">\n`;
        svgContent += svgBody;
        svgContent += `</svg>`;

        return svgContent;
    }

    generateSVG() {
        this.downloadSVG(this.getSVGString());
    }

    downloadSVG(svgContent) {
        const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `laser-layers-${Date.now()}.svg`;
        document.body.appendChild(link);
        link.click();
        
        setTimeout(() => {
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }, 100);
    }
}
