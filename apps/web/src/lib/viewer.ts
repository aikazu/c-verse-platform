import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type * as THREE_TYPES from "three";

// Three stays in a lazy chunk. Rendering and pointer movement are imperative so
// no React state update occurs for each animation frame.
type Three = typeof THREE_TYPES;
type ViewerStatus = "loading" | "ready" | "unavailable" | "error";
type ViewerView = "front" | "back" | "free";

export type CardViewerControls = {
  status: ViewerStatus;
  autoRotate: boolean;
  view: ViewerView;
  zoom: number;
  setView: (view: "front" | "back") => void;
  setZoom: (value: number) => void;
  toggleRotation: () => void;
  reset: () => void;
  rotateBy: (x: number, y: number) => void;
};

type ViewerUiState = Pick<CardViewerControls, "status" | "autoRotate" | "view" | "zoom">;
type ViewerSession = Omit<CardViewerControls, "status" | "autoRotate" | "view" | "zoom">;

const CARD_HEIGHT = 0.88;
const CARD_WIDTH = 0.63;
const CARD_DEPTH = 0.025;
const PLACEHOLDER_OBJ_URL = "/placeholder.obj";
const MIN_ZOOM = 0.8;
const MAX_ZOOM = 1.4;
// Fits the 0.88-unit card at roughly 60% of a 42deg vertical FOV.
const DEFAULT_CAMERA_DISTANCE = 1.95;
const CAMERA_HALF_FOV_TANGENT = Math.tan((42 * Math.PI) / 360);

const INITIAL_UI: ViewerUiState = { status: "loading", autoRotate: false, view: "front", zoom: 1 };

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function cameraDistanceFor(aspect: number, zoom: number): number {
  // Preserve the preferred portrait framing, then pull back on unusually narrow
  // hosts so the default view never crops the card horizontally.
  const horizontalFitDistance = CARD_WIDTH / Math.max(2 * CAMERA_HALF_FOV_TANGENT * aspect * 0.8, 0.000001);
  return Math.max(DEFAULT_CAMERA_DISTANCE, horizontalFitDistance) / zoom;
}

function isObjUrl(url: string | null): boolean {
  if (!url) return false;
  try {
    return new URL(url, window.location.href).pathname.toLowerCase().endsWith(".obj");
  } catch {
    return url.toLowerCase().split("?")[0]?.endsWith(".obj") ?? false;
  }
}

function textureUrlForLoader(url: string): string {
  const parsed = new URL(url, window.location.href);
  // Scope the CDN CORS-cache workaround to our public asset origin only.
  if (parsed.origin === "https://assets.c-verse.co") parsed.searchParams.set("cverse_texture", "1");
  return parsed.href;
}

async function loadTexture(THREE: Three, url: string): Promise<THREE_TYPES.Texture> {
  const texture = await new Promise<THREE_TYPES.Texture>((resolve, reject) => {
    new THREE.TextureLoader().load(textureUrlForLoader(url), resolve, undefined, reject);
  });
  const srgb = (THREE as unknown as { SRGBColorSpace?: THREE_TYPES.ColorSpace }).SRGBColorSpace;
  if (srgb) texture.colorSpace = srgb;
  texture.anisotropy = 4;
  return texture;
}

// Authored UVs (including a texture atlas) win. The fallback is only for OBJ
// exports which omit UVs, and maps the requested drop artwork over its XY face.
function ensureArtworkUvs(THREE: Three, geometry: THREE_TYPES.BufferGeometry): void {
  if (geometry.getAttribute("uv")) return;
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  const position = geometry.getAttribute("position");
  if (!bounds || !position) return;
  const width = Math.max(bounds.max.x - bounds.min.x, 0.000001);
  const height = Math.max(bounds.max.y - bounds.min.y, 0.000001);
  const uvs = new Float32Array(position.count * 2);
  for (let index = 0; index < position.count; index += 1) {
    uvs[index * 2] = (position.getX(index) - bounds.min.x) / width;
    uvs[index * 2 + 1] = (position.getY(index) - bounds.min.y) / height;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
}

function disposeMaterial(material: THREE_TYPES.Material): void {
  const mapped = material as THREE_TYPES.MeshStandardMaterial;
  mapped.map?.dispose();
  mapped.alphaMap?.dispose();
  mapped.normalMap?.dispose();
  mapped.roughnessMap?.dispose();
  mapped.metalnessMap?.dispose();
  material.dispose();
}

function disposeObject(root: THREE_TYPES.Object3D): void {
  const geometries = new Set<THREE_TYPES.BufferGeometry>();
  const materials = new Set<THREE_TYPES.Material>();
  root.traverse((child) => {
    const mesh = child as THREE_TYPES.Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
  });
  geometries.forEach((geometry) => {
    geometry.dispose();
  });
  materials.forEach(disposeMaterial);
}

function createCardMaterial(THREE: Three, map: THREE_TYPES.Texture | null): THREE_TYPES.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: map ? 0xffffff : 0x33435b,
    ...(map ? { map } : {}),
    roughness: 0.34,
    metalness: 0.03,
    clearcoat: 0.18,
    clearcoatRoughness: 0.28,
  });
}

async function loadCard(
  THREE: Three,
  objUrl: string,
  artworkUrl: string | null,
): Promise<{ card: THREE_TYPES.Object3D; artworkAvailable: boolean }> {
  const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
  const card = await new OBJLoader().loadAsync(objUrl);
  let artwork: THREE_TYPES.Texture | null = null;
  if (artworkUrl) {
    try {
      artwork = await loadTexture(THREE, artworkUrl);
    } catch {
      artwork = null;
    }
  }
  card.traverse((child) => {
    const mesh = child as THREE_TYPES.Mesh;
    if (!mesh.isMesh) return;
    ensureArtworkUvs(THREE, mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) disposeMaterial(material);
    mesh.material = createCardMaterial(THREE, artwork);
  });
  const bounds = new THREE.Box3().setFromObject(card);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const scale = CARD_HEIGHT / Math.max(size.y, 0.000001);
  card.scale.setScalar(scale);
  card.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
  return { card, artworkAvailable: artwork !== null };
}

function createStars(THREE: Three): { points: THREE_TYPES.Points; dispose: () => void } {
  const count = 150;
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = Math.random() * 6 - 3;
    positions[index * 3 + 1] = Math.random() * 3.7 - 1.55;
    positions[index * 3 + 2] = -2 - Math.random() * 3;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0x8cecff,
    size: 0.016,
    transparent: true,
    opacity: 0.54,
    depthWrite: false,
    sizeAttenuation: true,
  });
  return {
    points: new THREE.Points(geometry, material),
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

function createArcadeFloor(THREE: Three): { floor: THREE_TYPES.Group; dispose: () => void } {
  const floor = new THREE.Group();
  const material = new THREE.LineBasicMaterial({ color: 0x22cce5, transparent: true, opacity: 0.19, depthWrite: false });
  const vertices: number[] = [];
  for (let x = -2.2; x <= 2.2; x += 0.22) vertices.push(x, -0.64, -0.25, x, -0.64, -2.2);
  for (let z = -0.25; z >= -2.2; z -= 0.24) vertices.push(-2.2, -0.64, z, 2.2, -0.64, z);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  floor.add(new THREE.LineSegments(geometry, material));
  // Plinth stays below the card, so no ring intersects its printed face.
  const plinthGeometry = new THREE.TorusGeometry(0.53, 0.012, 8, 72);
  const plinthMaterial = new THREE.MeshBasicMaterial({ color: 0x42eaff, transparent: true, opacity: 0.66, depthWrite: false });
  const plinth = new THREE.Mesh(plinthGeometry, plinthMaterial);
  plinth.rotation.x = Math.PI / 2;
  plinth.position.set(0, -0.52, -0.14);
  floor.add(plinth);
  return {
    floor,
    dispose: () => {
      geometry.dispose();
      material.dispose();
      plinthGeometry.dispose();
      plinthMaterial.dispose();
    },
  };
}

function createFallbackCard(THREE: Three): THREE_TYPES.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(CARD_WIDTH, CARD_HEIGHT, CARD_DEPTH), createCardMaterial(THREE, null));
}

export function useCardViewer(
  containerRef: RefObject<HTMLDivElement | null>,
  meshUrl: string | null,
  textureUrl: string | null,
  isReady = true,
): CardViewerControls {
  const sessionRef = useRef<ViewerSession | null>(null);
  const [ui, setUi] = useState<ViewerUiState>(INITIAL_UI);

  useEffect(() => {
    sessionRef.current = null;
    if (!isReady || !containerRef.current) {
      setUi(INITIAL_UI);
      return;
    }
    const host = containerRef.current;
    let disposed = false;
    let animationFrame: number | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let renderer: THREE_TYPES.WebGLRenderer | null = null;
    let card: THREE_TYPES.Object3D | null = null;
    let contextLost = false;
    let disposeScene = () => {};
    let stopAnimation = () => {};
    const reducedMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setUi({ ...INITIAL_UI, autoRotate: !reducedMotion });
    const fail = () => {
      if (!disposed) setUi((current) => ({ ...current, status: "error", autoRotate: false }));
    };
    const onContextLost = (event: Event) => {
      event.preventDefault();
      contextLost = true;
      stopAnimation();
      sessionRef.current = null;
      fail();
    };

    const initialize = async () => {
      try {
        const THREE = await import("three");
        if (disposed) return;
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x030711);
        const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
        camera.position.set(0, 0.02, DEFAULT_CAMERA_DISTANCE);
        camera.lookAt(0, -0.04, 0);
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.domElement.dataset.viewer = "card";
        renderer.domElement.dataset.view = "front";
        // Keep vertical page scrolling available on touch screens; horizontal
        // drags remain available for inspection.
        renderer.domElement.style.touchAction = "pan-y";
        // Listen before awaiting assets: context loss can happen during loading.
        renderer.domElement.addEventListener("webglcontextlost", onContextLost);
        host.replaceChildren(renderer.domElement);
        scene.add(new THREE.HemisphereLight(0xbcefff, 0x071321, 1.35));
        const key = new THREE.DirectionalLight(0xffffff, 1.7);
        key.position.set(1.6, 2.3, 2.7);
        const cyanRim = new THREE.DirectionalLight(0x43e7ff, 0.72);
        cyanRim.position.set(-2.4, 0.7, 1.2);
        const amberRim = new THREE.DirectionalLight(0xffb94c, 0.38);
        amberRim.position.set(1.7, -0.2, -1.8);
        scene.add(key, cyanRim, amberRim);
        const stars = createStars(THREE);
        const arcadeFloor = createArcadeFloor(THREE);
        scene.add(stars.points, arcadeFloor.floor);
        let sceneResourcesDisposed = false;
        const disposeSceneResources = () => {
          if (sceneResourcesDisposed) return;
          sceneResourcesDisposed = true;
          if (card) disposeObject(card);
          stars.dispose();
          arcadeFloor.dispose();
        };
        // Register resource cleanup before the async OBJ request. An unmount or
        // initialization exception during that request must not strand buffers.
        disposeScene = disposeSceneResources;
        const customObj = isObjUrl(meshUrl);
        const objUrl = customObj ? meshUrl! : PLACEHOLDER_OBJ_URL;
        const artworkUrl = textureUrl ?? (customObj ? null : meshUrl);
        let artworkAvailable = false;
        try {
          const loaded = await loadCard(THREE, objUrl, artworkUrl);
          card = loaded.card;
          artworkAvailable = loaded.artworkAvailable;
        } catch {
          card = createFallbackCard(THREE);
        }
        if (disposed || contextLost) {
          // The effect may have disposed the backdrop while OBJ loading was in
          // flight; this newly resolved subtree is not part of it yet.
          if (sceneResourcesDisposed) {
            if (card) disposeObject(card);
          } else {
            disposeSceneResources();
          }
          return;
        }
        scene.add(card);
        let yaw = 0;
        let pitch = 0;
        let zoom = 1;
        let autoRotate = !reducedMotion;
        let view: ViewerView = "front";
        let elapsed = 0;
        let lastTimestamp = 0;
        let pointerId: number | null = null;
        let lastPointerX = 0;
        let lastPointerY = 0;
        const updateUi = (status: ViewerStatus = artworkAvailable ? "ready" : "unavailable") => {
          if (!disposed && !contextLost) setUi({ status, autoRotate, view, zoom });
        };
        const render = () => {
          if (!renderer || !card || disposed || contextLost) return;
          card.rotation.set(pitch, yaw, 0);
          camera.position.z = cameraDistanceFor(camera.aspect, zoom);
          camera.updateProjectionMatrix();
          renderer.render(scene, camera);
          renderer.domElement.dataset.rendered = "true";
          renderer.domElement.dataset.view = view;
        };
        const canAnimate = () => autoRotate && !document.hidden && !disposed && !contextLost;
        const schedule = () => {
          if (animationFrame === null && canAnimate()) animationFrame = requestAnimationFrame(animate);
        };
        stopAnimation = () => {
          if (animationFrame !== null) cancelAnimationFrame(animationFrame);
          animationFrame = null;
        };
        const animate = (timestamp: number) => {
          animationFrame = null;
          if (!canAnimate()) return;
          const delta = Math.min((timestamp - lastTimestamp || 16) / 1000, 0.05);
          lastTimestamp = timestamp;
          elapsed += delta;
          yaw += delta * 0.34;
          stars.points.rotation.y = elapsed * 0.018;
          arcadeFloor.floor.rotation.y = Math.sin(elapsed * 0.22) * 0.015;
          render();
          schedule();
        };
        const resize = () => {
          if (!renderer || disposed || contextLost) return;
          const width = host.clientWidth;
          const height = host.clientHeight;
          if (width <= 0 || height <= 0) return;
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          renderer.setSize(width, height, false);
          render();
        };
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(host);
        const setView = (nextView: "front" | "back") => {
          yaw = nextView === "front" ? 0 : Math.PI;
          pitch = 0;
          view = nextView;
          autoRotate = false;
          stopAnimation();
          updateUi();
          render();
        };
        const setZoom = (nextZoom: number) => {
          zoom = clampZoom(nextZoom);
          updateUi();
          render();
        };
        const toggleRotation = () => {
          autoRotate = !autoRotate;
          updateUi();
          render();
          schedule();
        };
        const reset = () => {
          if (contextLost) return;
          yaw = 0;
          pitch = 0;
          zoom = 1;
          view = "front";
          autoRotate = !reducedMotion;
          updateUi();
          render();
          schedule();
        };
        const rotateBy = (x: number, y: number) => {
          // Public API: x is horizontal yaw; y is vertical pitch, both radians.
          yaw += x;
          pitch = Math.max(-0.62, Math.min(0.62, pitch + y));
          view = "free";
          autoRotate = false;
          stopAnimation();
          updateUi();
          render();
        };
        sessionRef.current = { setView, setZoom, toggleRotation, reset, rotateBy };
        const onPointerDown = (event: PointerEvent) => {
          if (contextLost || !event.isPrimary || event.button !== 0) return;
          pointerId = event.pointerId;
          lastPointerX = event.clientX;
          lastPointerY = event.clientY;
          renderer?.domElement.setPointerCapture(event.pointerId);
        };
        const onPointerMove = (event: PointerEvent) => {
          if (contextLost || pointerId !== event.pointerId) return;
          const movementX = event.clientX - lastPointerX;
          const movementY = event.clientY - lastPointerY;
          lastPointerX = event.clientX;
          lastPointerY = event.clientY;
          rotateBy(movementX * 0.012, movementY * 0.009);
        };
        const onPointerEnd = (event: PointerEvent) => {
          if (pointerId !== event.pointerId) return;
          pointerId = null;
          if (renderer?.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
        };
        const onVisibilityChange = () => {
          if (document.hidden) stopAnimation();
          else schedule();
        };
        renderer.domElement.addEventListener("pointerdown", onPointerDown);
        renderer.domElement.addEventListener("pointermove", onPointerMove);
        renderer.domElement.addEventListener("pointerup", onPointerEnd);
        renderer.domElement.addEventListener("pointercancel", onPointerEnd);
        document.addEventListener("visibilitychange", onVisibilityChange);
        disposeScene = () => {
          renderer?.domElement.removeEventListener("pointerdown", onPointerDown);
          renderer?.domElement.removeEventListener("pointermove", onPointerMove);
          renderer?.domElement.removeEventListener("pointerup", onPointerEnd);
          renderer?.domElement.removeEventListener("pointercancel", onPointerEnd);
          renderer?.domElement.removeEventListener("webglcontextlost", onContextLost);
          document.removeEventListener("visibilitychange", onVisibilityChange);
          resizeObserver?.disconnect();
          disposeSceneResources();
        };
        resize();
        updateUi();
        schedule();
      } catch {
        sessionRef.current = null;
        stopAnimation();
        disposeScene();
        renderer?.domElement.removeEventListener("webglcontextlost", onContextLost);
        try {
          renderer?.dispose();
        } catch {
          // The error state is still usable even if a failed renderer resists disposal.
        }
        if (host.contains(renderer?.domElement ?? null)) host.replaceChildren();
        fail();
      }
    };
    void initialize();
    return () => {
      disposed = true;
      sessionRef.current = null;
      stopAnimation();
      disposeScene();
      renderer?.domElement.removeEventListener("webglcontextlost", onContextLost);
      resizeObserver?.disconnect();
      try {
        renderer?.dispose();
        renderer?.forceContextLoss();
      } catch {
        // A lost context may reject disposal; it is already unusable.
      }
      if (host.contains(renderer?.domElement ?? null)) host.replaceChildren();
    };
  }, [containerRef, isReady, meshUrl, textureUrl]);

  const setView = useCallback((view: "front" | "back") => sessionRef.current?.setView(view), []);
  const setZoom = useCallback((value: number) => sessionRef.current?.setZoom(value), []);
  const toggleRotation = useCallback(() => sessionRef.current?.toggleRotation(), []);
  const reset = useCallback(() => sessionRef.current?.reset(), []);
  const rotateBy = useCallback((x: number, y: number) => sessionRef.current?.rotateBy(x, y), []);
  return { ...ui, setView, setZoom, toggleRotation, reset, rotateBy };
}
