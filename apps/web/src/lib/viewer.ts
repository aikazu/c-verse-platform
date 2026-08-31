import { useEffect, useRef } from "react";
import type * as THREE_TYPES from "three";

// Imperative Three.js card viewer — mounted by Card3D page.
// Three.js dipakai via dynamic import (kode di-pisah jadi chunk terpisah oleh
// Vite) — type module-nya di-ambil sebagai namespace statis via `typeof`,
// runtime dimuat asinkron supaya tidak masuk bundle utama.

// Card proportions shared by every mesh path.
const CARD_W = 0.63;
const CARD_H = 0.88;
const CARD_THICK = 0.03;

// Public assets — placeholder mesh + artwork for cards without their own.
const PLACEHOLDER_OBJ_URL = "/placeholder.obj";
const PLACEHOLDER_TEXTURE_URL = "/textures/karina.jpg";

// Alias namespace Three untuk mempersingkat deklarasi tipe di bawah.
type Three = typeof THREE_TYPES;

// Load an image as a texture; rejects when it cannot be loaded or decoded.
async function loadTexture(THREE: Three, url: string): Promise<THREE_TYPES.Texture> {
  const tex = await new Promise<THREE_TYPES.Texture>((resolve, reject) => {
    new THREE.TextureLoader().load(url, resolve, undefined, reject);
  });
  // SRGBColorSpace ditambahkan di three r152 (ganti encoding) — fallback kalau belum ada.
  const colorSpace = (THREE as unknown as { SRGBColorSpace?: THREE_TYPES.ColorSpace }).SRGBColorSpace;
  if (colorSpace) tex.colorSpace = colorSpace;
  return tex;
}

// Flat card meshes exported without UVs get a planar projection from their
// XY bounds so face artwork still maps across the whole card.
function ensurePlanarUvs(THREE: Three, geometry: THREE_TYPES.BufferGeometry): void {
  if (geometry.attributes.uv) return;
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  if (!bb) return;
  const pos = geometry.attributes.position;
  const spanX = Math.max(bb.max.x - bb.min.x, 1e-6);
  const spanY = Math.max(bb.max.y - bb.min.y, 1e-6);
  const uvs = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uvs[i * 2] = (pos.getX(i) - bb.min.x) / spanX;
    uvs[i * 2 + 1] = (pos.getY(i) - bb.min.y) / spanY;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
}

// Load a card OBJ, apply faceUrl as its material map (placeholder artwork
// when the face fails to load), and normalize it: centered, fitted to the
// standard card height — export units vary per modeling tool.
async function loadCardObj(THREE: Three, objUrl: string, faceUrl: string): Promise<THREE_TYPES.Group> {
  const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
  const obj = await new OBJLoader().loadAsync(objUrl);
  let map: THREE_TYPES.Texture | null = null;
  try {
    map = await loadTexture(THREE, faceUrl);
  } catch {
    try {
      map = await loadTexture(THREE, PLACEHOLDER_TEXTURE_URL);
    } catch {
      map = null;
    }
  }
  obj.traverse((child: THREE_TYPES.Object3D) => {
    const mesh = child as THREE_TYPES.Mesh;
    if (!mesh.isMesh) return;
    ensurePlanarUvs(THREE, mesh.geometry as THREE_TYPES.BufferGeometry);
    // Artwork is printed media, not metal — any metalness darkens the map
    // without an environment map to reflect, hiding the texture at
    // unfavorable rotation angles.
    mesh.material = new THREE.MeshStandardMaterial({
      ...(map ? { map } : { color: 0x232338 }),
      roughness: 0.45,
      metalness: 0,
    });
  });
  const bounds = new THREE.Box3().setFromObject(obj);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const fit = CARD_H / (size.y || 1);
  obj.scale.setScalar(fit);
  obj.position.set(-center.x * fit, -center.y * fit, -center.z * fit);
  return obj;
}

// Paint a procedural radial gradient into a CanvasTexture — powers the scene
// background and the halo sprite with zero binary assets. SRGB color space is
// applied when available so colors match the CSS theme tokens on screen.
function createRadialTexture(THREE: Three, size: number, stops: Array<{ offset: number; color: string }>): THREE_TYPES.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (const stop of stops) gradient.addColorStop(stop.offset, stop.color);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  const colorSpace = (THREE as unknown as { SRGBColorSpace?: THREE_TYPES.ColorSpace }).SRGBColorSpace;
  if (colorSpace) texture.colorSpace = colorSpace;
  return texture;
}

// Scatter `count` stars in the backdrop slab behind the card. Points stay in a
// separate object per color so each gets its own (twinkle-able) material.
function createStarPoints(
  THREE: Three,
  count: number,
  color: number,
  size: number,
  opacity: number,
): { points: THREE_TYPES.Points; geometry: THREE_TYPES.BufferGeometry; material: THREE_TYPES.PointsMaterial } {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = Math.random() * 8 - 4; // x [-4..4]
    positions[i * 3 + 1] = Math.random() * 5.5 - 2.5; // y [-2.5..3]
    positions[i * 3 + 2] = Math.random() * 4.5 - 6; // z [-6..-1.5]
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color,
    size,
    transparent: true,
    opacity,
    sizeAttenuation: true,
    depthWrite: false,
  });
  return { points: new THREE.Points(geometry, material), geometry, material };
}

// Thin tilted orbit ring floating behind the card. Its plane crosses z≈0 only
// outside the card footprint (|x| ≳ 0.71); clearance to the bbox corner is
// < 0.001 unit at worst — a sub-pixel graze on rare phase conjunctions,
// treated as safe.
function createOrbitRing(
  THREE: Three,
  radius: number,
  color: number,
  opacity: number,
): { ring: THREE_TYPES.Mesh; geometry: THREE_TYPES.TorusGeometry; material: THREE_TYPES.MeshBasicMaterial } {
  const geometry = new THREE.TorusGeometry(radius, 0.004, 8, 128);
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  const ring = new THREE.Mesh(geometry, material);
  ring.rotation.x = 1.25;
  ring.position.z = -0.3;
  return { ring, geometry, material };
}

// Recursively free GPU resources of a loaded mesh subtree. OBJ meshes carry
// per-child geometries and MeshStandardMaterials (each holding a texture map);
// the emergency box carries one geometry + material. None of these are
// garbage-collected while the WebGL context still references their buffers.
function disposeObject3D(root: THREE_TYPES.Object3D): void {
  root.traverse((child: THREE_TYPES.Object3D) => {
    const mesh = child as THREE_TYPES.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const standard = material as THREE_TYPES.MeshStandardMaterial;
      standard.map?.dispose();
      standard.dispose();
    }
  });
}

export function useCardViewer(
  containerRef: React.RefObject<HTMLDivElement | null>,
  meshUrl: string | null,
  textureUrl: string | null,
  // Payload-ready gate: host div baru ada setelah halaman selesai loading.
  // Tanpa ini, drop tanpa artwork3dUrl DAN artworkUrl membuat deps tetap
  // [null, null] sehingga effect tidak pernah jalan ulang (host kosong —
  // jalur placeholder.obj tidak pernah dieksekusi).
  isReady = true,
) {
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    // Every GPU resource this effect creates — disposed in cleanup so
    // unmount / HMR re-runs never leak WebGL textures, geometries, materials.
    const disposables: Array<{ dispose: () => void }> = [];
    let scene: THREE_TYPES.Scene | null = null;
    let camera: THREE_TYPES.PerspectiveCamera | null = null;
    let renderer: THREE_TYPES.WebGLRenderer | null = null;
    let mesh: THREE_TYPES.Object3D | null = null;
    let detachWindowListeners: (() => void) | null = null;

    (async () => {
      const THREE = await import("three");
      if (disposed || !containerRef.current) return;
      const el = containerRef.current;
      const w = el.clientWidth;
      const h = el.clientHeight;

      scene = new THREE.Scene();
      // Deep-space radial backdrop (soft ink-blue core → near-black edge,
      // edge color matches --viewer-bg) replaces the flat scene color.
      const backgroundTexture = createRadialTexture(THREE, 512, [
        { offset: 0, color: "#141d3d" },
        { offset: 0.55, color: "#0d1530" },
        { offset: 1, color: "#030510" },
      ]);
      disposables.push(backgroundTexture);
      scene.background = backgroundTexture;

      camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 100);
      camera.position.set(0, 0.55, 2.2);
      camera.lookAt(0, 0, 0);

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(w, h);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      el.innerHTML = "";
      el.appendChild(renderer.domElement);

      // Lights — ambient lowered so the two new colored fills keep the card's
      // front-face total close to the old value (metalness 0 ⇒ diffuse-only
      // response; the card must stay the brightest element on screen).
      const amb = new THREE.AmbientLight(0xffffff, 0.75);
      const dir = new THREE.DirectionalLight(0xffffff, 0.8);
      dir.position.set(2, 3, 2);
      const rim = new THREE.DirectionalLight(0xd4a843, 0.25);
      rim.position.set(-2, 1, -1);
      const fillCyan = new THREE.DirectionalLight(0x5be6ff, 0.3);
      fillCyan.position.set(-3, 1.2, 1.5);
      const fillMagenta = new THREE.DirectionalLight(0xff4d9e, 0.22);
      fillMagenta.position.set(3, 0.4, -1);
      scene.add(amb, dir, rim, fillCyan, fillMagenta);

      // The 3D card is always an OBJ mesh — the drop's own when it has one,
      // the bundled placeholder otherwise. The face artwork is the drop
      // image, falling back to the placeholder texture. The plain box stays
      // only as an emergency when mesh loading fails outright.
      const wantsCustomObj = !!meshUrl && meshUrl.toLowerCase().endsWith(".obj");
      const objUrl = wantsCustomObj ? meshUrl : PLACEHOLDER_OBJ_URL;
      const faceUrl = wantsCustomObj ? textureUrl || PLACEHOLDER_TEXTURE_URL : textureUrl || meshUrl || PLACEHOLDER_TEXTURE_URL;
      try {
        mesh = await loadCardObj(THREE, objUrl, faceUrl);
      } catch {
        mesh = new THREE.Mesh(
          new THREE.BoxGeometry(CARD_W, CARD_H, CARD_THICK),
          new THREE.MeshStandardMaterial({ color: 0x1e1e32, roughness: 0.5 }),
        );
      }
      // Unmount raced the async OBJ load — cleanup already ran and will never
      // run again, so nothing downstream would dispose. Free the mesh subtree
      // and bail before halo/starfield/ring construction, listeners, or rAF.
      if (disposed) {
        disposeObject3D(mesh);
        return;
      }
      scene.add(mesh);

      // Backdrop effects (Space Arcade) — soft gold/violet halo behind the
      // card, a two-layer starfield, and two thin counter-rotating orbit
      // rings. All additive-subtle: the card stays the visual anchor.
      const haloTexture = createRadialTexture(THREE, 256, [
        { offset: 0, color: "rgba(255, 201, 77, 0.30)" },
        { offset: 0.45, color: "rgba(143, 123, 255, 0.12)" },
        { offset: 1, color: "rgba(143, 123, 255, 0)" },
      ]);
      const haloMaterial = new THREE.SpriteMaterial({ map: haloTexture, transparent: true, depthWrite: false });
      const halo = new THREE.Sprite(haloMaterial);
      halo.scale.setScalar(CARD_H * 1.7);
      halo.position.z = -0.15;
      disposables.push(haloTexture, haloMaterial);
      scene.add(halo);

      const starfield = new THREE.Group();
      const dimWhite = createStarPoints(THREE, 260, 0xffffff, 0.02, 0.7);
      const accentCyan = createStarPoints(THREE, 45, 0x5be6ff, 0.03, 0.5);
      const accentGold = createStarPoints(THREE, 45, 0xffc94d, 0.03, 0.5);
      starfield.add(dimWhite.points, accentCyan.points, accentGold.points);
      disposables.push(
        dimWhite.geometry,
        dimWhite.material,
        accentCyan.geometry,
        accentCyan.material,
        accentGold.geometry,
        accentGold.material,
      );
      scene.add(starfield);
      // Gentle per-material twinkle (opacity ±0.15 around each base value).
      const twinkles = [
        { material: dimWhite.material, base: 0.7, phase: 0, speed: 0.9 },
        { material: accentCyan.material, base: 0.5, phase: 2.1, speed: 1.4 },
        { material: accentGold.material, base: 0.5, phase: 4.2, speed: 1.1 },
      ];

      const ringGold = createOrbitRing(THREE, 0.78, 0xffc94d, 0.22);
      const ringCyan = createOrbitRing(THREE, 1.02, 0x5be6ff, 0.18);
      disposables.push(ringGold.geometry, ringGold.material, ringCyan.geometry, ringCyan.material);
      scene.add(ringGold.ring, ringCyan.ring);

      let t = 0;
      let dragging = false;
      let lastX = 0;
      let rotY = 0;
      const autoRot = 0.003;
      const onPointerDown = (e: PointerEvent) => {
        dragging = true;
        lastX = e.clientX;
        (e.target as Element).setPointerCapture?.(e.pointerId);
      };
      const onPointerMove = (e: PointerEvent) => {
        if (!dragging) return;
        const dx = e.clientX - lastX;
        rotY += dx * 0.008;
        lastX = e.clientX;
      };
      const onPointerUp = () => {
        dragging = false;
      };
      renderer.domElement.addEventListener("pointerdown", onPointerDown);
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      // Simpan handler window supaya cleanup bisa removeEventListener (bukan hanya GC passively).
      detachWindowListeners = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("resize", onResize);
      };

      const onResize = () => {
        if (!el || !camera || !renderer) return;
        const nw = el.clientWidth;
        const nh = el.clientHeight;
        camera.aspect = nw / nh;
        camera.updateProjectionMatrix();
        renderer.setSize(nw, nh);
      };
      window.addEventListener("resize", onResize);

      const animate = () => {
        rafRef.current = requestAnimationFrame(animate);
        t += 0.016;
        if (!dragging) rotY += autoRot;
        // Scene life — imperceptibly slow drift/twinkle so the card dominates.
        starfield.rotation.y += 0.0004;
        for (const twinkle of twinkles) twinkle.material.opacity = twinkle.base + Math.sin(t * twinkle.speed + twinkle.phase) * 0.15;
        ringGold.ring.rotation.y += 0.0012;
        ringCyan.ring.rotation.y -= 0.0009;
        if (mesh && camera && scene && renderer) {
          mesh.rotation.y = rotY;
          mesh.rotation.x = Math.sin(t * 0.3) * 0.06;
          mesh.position.y = Math.sin(t * 0.6) * 0.02;
          renderer.render(scene, camera);
        }
      };
      animate();
    })();

    return () => {
      disposed = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      detachWindowListeners?.();
      // Unmount normal: subtree mesh yang sudah termuat (geometri OBJ,
      // MeshStandardMaterial + texture map) tidak tercatat di `disposables`
      // — bebaskan eksplisit di sini. Kalau unmount balapan dengan load
      // asinkron, mesh masih null dan race path di atas yang dispose.
      // Dispose ganda (kedua path melihat mesh yang sama) adalah no-op di
      // three.js.
      if (mesh) disposeObject3D(mesh);
      try {
        renderer?.dispose();
      } catch {
        // ignore — renderer disposal occasionally throws when WebGL context lost
      }
      if (containerRef.current) containerRef.current.innerHTML = "";
      for (const resource of disposables) resource.dispose();
      disposables.length = 0;
    };
  }, [meshUrl, textureUrl, isReady]);
}
