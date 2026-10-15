/**
 * Escenario 3D: renderer, cámara isométrica (ortográfica), controles tipo mapa y luces.
 */
import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

export interface Stage {
  renderer: THREE.WebGLRenderer;
  labels: CSS2DRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  controls: MapControls;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  container: HTMLElement;
  /** Ancho del encuadre en metros (zoom 1). */
  frustum: number;
  render(): void;
  resize(): void;
  /** Mueve la cámara suavemente hacia un punto de interés. */
  focus(target: THREE.Vector3, zoom?: number, duration?: number): void;
  setIsoView(azimuthDeg?: number, elevationDeg?: number): void;
  update(dt: number): void;
}

export function createStage(container: HTMLElement, opts: { shadows?: boolean } = {}): Stage {
  const isMobile = matchMedia('(max-width: 820px)').matches || /Mobi|Android/i.test(navigator.userAgent);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.75 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = opts.shadows ?? true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;
  container.appendChild(renderer.domElement);
  renderer.domElement.classList.add('gl');

  const labels = new CSS2DRenderer();
  labels.domElement.classList.add('labels-layer');
  container.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  // reflejos suaves para metales y vidrios (cielo neutro)
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;
  pmrem.dispose();
  scene.background = new THREE.Color('#cfdbe4');
  scene.fog = new THREE.Fog('#cfdbe4', 260, 520);

  const frustum = 90;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -400, 1200);
  camera.zoom = 1;

  const hemi = new THREE.HemisphereLight('#e8f1ff', '#9a7b58', 1.25);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight('#fff3e0', 2.4);
  sun.position.set(-60, 90, 55);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = renderer.shadowMap.enabled;
  sun.shadow.mapSize.set(isMobile ? 2048 : 4096, isMobile ? 2048 : 4096);
  const sc = sun.shadow.camera;
  sc.left = -75; sc.right = 75; sc.top = 75; sc.bottom = -75; sc.near = 10; sc.far = 300;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  const controls = new MapControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = true;
  controls.minZoom = 0.45;
  controls.maxZoom = 9;
  controls.maxPolarAngle = THREE.MathUtils.degToRad(82);
  controls.minPolarAngle = THREE.MathUtils.degToRad(12);
  controls.zoomToCursor = true;
  controls.target.set(0, 6, 4);

  const stage: Stage = {
    renderer, labels, scene, camera, controls, sun, hemi, container, frustum,
    render() {
      renderer.render(scene, camera);
      labels.render(scene, camera);
    },
    resize() {
      const w = container.clientWidth, h = container.clientHeight;
      const aspect = w / Math.max(h, 1);
      // en vertical el encuadre se define por el ancho: ~70 m para que el edificio llene la pantalla
      const f = aspect < 1 ? 70 : frustum;
      camera.left = (-f * aspect) / 2;
      camera.right = (f * aspect) / 2;
      camera.top = f / 2;
      camera.bottom = -f / 2;
      if (aspect < 1) {
        camera.left = -f / 2; camera.right = f / 2;
        camera.top = f / 2 / aspect; camera.bottom = -f / 2 / aspect;
      }
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      labels.setSize(w, h);
    },
    focus(target, zoom, duration = 1.2) {
      anim = {
        t: 0, d: duration,
        fromT: controls.target.clone(), toT: target.clone(),
        fromP: camera.position.clone(),
        toP: camera.position.clone().add(target.clone().sub(controls.target)),
        fromZ: camera.zoom, toZ: zoom ?? camera.zoom,
      };
    },
    setIsoView(az = 55, el = 33) {
      const r = 220;
      const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el);
      const dir = new THREE.Vector3(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a));
      camera.position.copy(controls.target).addScaledVector(dir, r);
      camera.lookAt(controls.target);
      controls.update();
    },
    update(dt) {
      if (anim) {
        anim.t += dt;
        const k = Math.min(anim.t / anim.d, 1);
        const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        controls.target.lerpVectors(anim.fromT, anim.toT, e);
        camera.position.lerpVectors(anim.fromP, anim.toP, e);
        camera.zoom = THREE.MathUtils.lerp(anim.fromZ, anim.toZ, e);
        camera.updateProjectionMatrix();
        if (k >= 1) anim = null;
      }
      controls.update();
    },
  };
  let anim: null | {
    t: number; d: number; fromT: THREE.Vector3; toT: THREE.Vector3; fromP: THREE.Vector3; toP: THREE.Vector3; fromZ: number; toZ: number;
  } = null;

  // cancelar el foco animado si el usuario toma el control
  renderer.domElement.addEventListener('pointerdown', () => (anim = null));
  renderer.domElement.addEventListener('wheel', () => (anim = null), { passive: true });

  stage.setIsoView();
  stage.resize();
  window.addEventListener('resize', () => stage.resize());
  return stage;
}
