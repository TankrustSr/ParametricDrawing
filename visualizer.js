import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';

export class Visualizer {
    constructor() {
        this.isInitialized = false;
        this.animationId = null;
        this.params = { thickness: 2.0, spacing: 2.0, curveSegments: 256 };
        this.parsedLayersData = [];
        this.layersGroup = new THREE.Group();
    }

    init() {
        if (this.isInitialized) return;

        this.container = document.getElementById('visualizer-container');
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = 'visualizer-container';
            this.container.style.cssText = 'display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100dvh; z-index: 1000; overflow: hidden; background-color: #ffffff;';
            
            const panel = document.createElement('div');
            panel.id = 'vis-ui-panel';
            // Increased to 110px to safely clear Chrome's stacked Address + Tab bars
            panel.style.cssText = 'position: absolute; top: 110px; left: 20px; z-index: 10; background: rgba(255, 255, 255, 0.95); padding: 20px; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.3); max-width: 350px;';
            
            panel.innerHTML = `
                <h2 style="margin-top: 0; font-size: 1.2rem; color: #333; font-family: sans-serif;">3D Preview</h2>
                <button id="btn-close-3d" style="margin-bottom:10px; width:100%; padding:8px; background:#d93025; color:white; border:none; border-radius:4px; cursor:pointer;">Close 3D View</button>
                <div id="vis-error-box" style="color: #d93025; font-size: 0.8rem; font-weight: bold; margin-top: 10px; font-family: sans-serif;"></div>
                <div style="font-weight: bold; font-size: 0.85rem; margin-top: 10px; color: #333; font-family: sans-serif;">Detected Layers (Max 10):</div>
                <div id="vis-layerOutput" style="font-size: 0.8rem; max-height: 180px; overflow-y: auto; margin-top: 10px; color: #444; font-family: sans-serif;"></div>
            `;
            this.container.appendChild(panel);
            document.body.appendChild(this.container);
        } else {
            this.container.style.width = '100%';
            this.container.style.height = '100dvh';
            this.container.style.overflow = 'hidden';
            this.container.style.backgroundColor = '#ffffff';
            
            // Failsafe to push panel down if it already existed
            const existingPanel = document.getElementById('vis-ui-panel');
            if (existingPanel) existingPanel.style.top = '110px';
        }

        this.layerOutput = document.getElementById('vis-layerOutput') || document.getElementById('layerOutput');
        this.errorBox = document.getElementById('vis-error-box') || document.getElementById('error-box');
        this.closeBtn = document.getElementById('btn-close-3d');

        if (this.closeBtn) {
            this.closeBtn.addEventListener('click', () => {
                this.container.style.display = 'none';
                if (this.animationId) cancelAnimationFrame(this.animationId);
            });
        }

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xffffff);

        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 10000);
        this.camera.position.set(0, 0, 500);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        
        this.renderer.domElement.style.display = 'block';
        this.renderer.domElement.style.width = '100%';
        this.renderer.domElement.style.height = '100%';
        
        this.container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
        this.scene.add(ambientLight);
        
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
        dirLight.position.set(200, 500, 300);
        this.scene.add(dirLight);

        const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
        dirLight2.position.set(-200, -200, -200);
        this.scene.add(dirLight2);

        this.scene.add(this.layersGroup);

        this.gui = new GUI({ title: 'Extrusion Settings' });
        this.gui.domElement.style.position = 'absolute';
        // Increased to 110px to safely clear the iPad browser address bar
        this.gui.domElement.style.top = '110px';
        this.gui.domElement.style.right = '20px';
        
        this.gui.add(this.params, 'thickness', 0.1, 50).name('Thickness (mm)').onChange(() => this.rebuild3D());
        this.gui.add(this.params, 'spacing', 0, 50).name('Layer Spacing').onChange(() => this.rebuild3D());
        this.gui.add(this.params, 'curveSegments', 12, 1024, 1).name('Curve Smoothness').onChange(() => this.rebuild3D());
        
        this.container.appendChild(this.gui.domElement);

        window.addEventListener('resize', () => {
            if (this.camera && this.renderer && this.container.style.display !== 'none') {
                this.camera.aspect = window.innerWidth / window.innerHeight;
                this.camera.updateProjectionMatrix();
                this.renderer.setSize(window.innerWidth, window.innerHeight);
            }
        });

        this.isInitialized = true;
    }

    open3DPreview(svgText) {
        if (!this.isInitialized) this.init();
        this.container.style.display = 'block';
        
        if (this.errorBox) this.errorBox.innerText = "";
        try {
            this.processSVGLayers(svgText);
            this.animate();
        } catch (err) {
            if (this.errorBox) this.errorBox.innerText = "Parsing Error: " + err.message;
            console.error(err);
        }
    }

    processSVGLayers(svgText) {
        const hiddenContainer = document.createElement('div');
        hiddenContainer.style.position = 'absolute';
        hiddenContainer.style.visibility = 'hidden';
        hiddenContainer.innerHTML = svgText;
        document.body.appendChild(hiddenContainer);

        const svgNode = hiddenContainer.querySelector('svg');
        if (!svgNode) throw new Error("No valid <svg> tag found.");

        const shapes = svgNode.querySelectorAll('path, rect, circle, ellipse, polygon, polyline, line');
        shapes.forEach(shape => {
            const computed = window.getComputedStyle(shape);
            if (computed.fill && computed.fill !== 'none') shape.setAttribute('fill', computed.fill);
            if (computed.stroke && computed.stroke !== 'none') shape.setAttribute('stroke', computed.stroke);
            shape.removeAttribute('class');
        });

        let svgAttrs = '';
        for (let attr of svgNode.attributes) {
            svgAttrs += ` ${attr.name}="${attr.value}"`;
        }
        const svgHeader = `<svg${svgAttrs}>`;
        const defsNode = svgNode.querySelector('defs');
        const defsHTML = defsNode ? defsNode.outerHTML : '';
        const topGroups = Array.from(svgNode.children).filter(child => child.nodeName.toLowerCase() === 'g');

        const loader = new SVGLoader();
        this.parsedLayersData = [];

        topGroups.forEach((g, index) => {
            const name = g.getAttribute('id') || `Layer ${index + 1}`;
            const layerString = `${svgHeader}\n${defsHTML}\n${g.outerHTML}\n</svg>`;
            const parsed = loader.parse(layerString);
            if (parsed.paths && parsed.paths.length > 0) {
                this.parsedLayersData.push({ name: name, paths: parsed.paths });
            }
        });

        document.body.removeChild(hiddenContainer);
        this.parsedLayersData = this.parsedLayersData.slice(0, 10);
        
        if (this.layerOutput) {
            this.layerOutput.innerHTML = this.parsedLayersData.map((layer, i) => 
                `<div style="padding: 5px 0; border-bottom: 1px solid #ddd; display: flex; justify-content: space-between;">
                    <span><b>L${i+1}:</b> ${layer.name}</span> <span>[${layer.paths.length} items]</span>
                </div>`
            ).join('');
        }
        
        this.rebuild3D();
    }

    disposeGroup(group) {
        const children = [...group.children];
        for (let child of children) {
            if (child.isGroup) this.disposeGroup(child);
            else {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
                group.remove(child);
            }
        }
    }

    rebuild3D() {
        this.disposeGroup(this.layersGroup);
        let currentZOffset = 0;

        this.parsedLayersData.forEach((layer) => {
            const layerGroup = new THREE.Group();
            layerGroup.scale.y = -1;

            for (const path of layer.paths) {
                let colorToUse = '#ffffff'; 
                let opacity = 1.0;
                const style = path.userData.style;
                
                if (style.fill !== undefined && style.fill !== 'none') {
                    colorToUse = style.fill;
                } else if (style.stroke !== undefined && style.stroke !== 'none') {
                    colorToUse = style.stroke; 
                }

                let threeColor = new THREE.Color();
                try { threeColor.setStyle(colorToUse); } catch (e) { threeColor.setHex(0xaaaaaa); }

                const faceMaterial = new THREE.MeshStandardMaterial({
                    color: threeColor,
                    side: THREE.DoubleSide,
                    roughness: 0.3,
                    metalness: 0.1,
                    transparent: opacity < 1,
                    opacity: opacity,
                    flatShading: false
                });

                const edgeMaterial = new THREE.MeshStandardMaterial({
                    color: new THREE.Color('#3d2314'),
                    side: THREE.DoubleSide,
                    roughness: 0.9,
                    metalness: 0.0,
                    transparent: opacity < 1,
                    opacity: opacity,
                    flatShading: false
                });

                const shapes = SVGLoader.createShapes(path);
                for (const shape of shapes) {
                    try {
                        const geometry = new THREE.ExtrudeGeometry(shape, {
                            depth: this.params.thickness,
                            bevelEnabled: false,
                            curveSegments: this.params.curveSegments 
                        });
                        layerGroup.add(new THREE.Mesh(geometry, [faceMaterial, edgeMaterial]));
                    } catch (e) {}
                }
            }
            layerGroup.position.z = currentZOffset;
            currentZOffset += (this.params.thickness + this.params.spacing);
            this.layersGroup.add(layerGroup);
        });

        if (this.layersGroup.children.length === 0) return;

        const box = new THREE.Box3().setFromObject(this.layersGroup);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        
        this.layersGroup.position.set(-center.x, -center.y, -center.z);
        const maxDim = Math.max(size.x, size.y, size.z) || 100;
        this.camera.position.set(0, 0, maxDim * 1.5);
        this.controls.target.set(0, 0, 0);
        this.controls.update();
    }

    animate() {
        this.animationId = requestAnimationFrame(() => this.animate());
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }
}
