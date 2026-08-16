import { useEffect, useRef } from "react";

// Imperative Three.js card viewer — mounted by Card3D page.

// Card proportions shared by every mesh path.
const CARD_W = 0.63;
const CARD_H = 0.88;
const CARD_THICK = 0.03;

// Public assets — placeholder mesh + artwork for cards without their own.
const PLACEHOLDER_OBJ_URL = "/placeholder.obj";
const PLACEHOLDER_TEXTURE_URL = "/texture/karina.jpg";

// Load an image as a texture; rejects when it cannot be loaded or decoded.
async function loadTexture(THREE: any, url: string): Promise<any> {
  const tex = await new Promise<any>((resolve, reject) => {
    new THREE.TextureLoader().load(url, resolve, undefined, reject);
  });
  tex.colorSpace = (THREE as any).SRGBColorSpace ?? undefined;
  return tex;
}

// Flat card meshes exported without UVs get a planar projection from their
// XY bounds so face artwork still maps across the whole card.
function ensurePlanarUvs(THREE: any, geometry: any): void {
  if (geometry.attributes.uv) return;
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
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
async function loadCardObj(THREE: any, objUrl: string, faceUrl: string): Promise<any> {
  const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
  const obj = await new OBJLoader().loadAsync(objUrl);
  let map: any = null;
  try {
    map = await loadTexture(THREE, faceUrl);
  } catch {
    try {
      map = await loadTexture(THREE, PLACEHOLDER_TEXTURE_URL);
    } catch {
      map = null;
    }
  }
  obj.traverse((child: any) => {
    if (!child.isMesh) return;
    ensurePlanarUvs(THREE, child.geometry);
    // Artwork is printed media, not metal — any metalness darkens the map
    // without an environment map to reflect, hiding the texture at
    // unfavorable rotation angles.
    child.material = new THREE.MeshStandardMaterial({
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

export function useCardViewer(containerRef: React.RefObject<HTMLDivElement | null>, meshUrl: string | null, textureUrl: string | null) {
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    let scene: any, camera: any, renderer: any, mesh: any;
    let detachWindowListeners: (() => void) | null = null;

    (async () => {
      const THREE = await import("three");
      if (disposed || !containerRef.current) return;
      const el = containerRef.current!;
      const w = el.clientWidth,
        h = el.clientHeight;

      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x08080c);

      camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 100);
      camera.position.set(0, 0.55, 2.2);
      camera.lookAt(0, 0, 0);

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(w, h);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      el.innerHTML = "";
      el.appendChild(renderer.domElement);

      // Lights
      const amb = new THREE.AmbientLight(0xffffff, 0.9);
      const dir = new THREE.DirectionalLight(0xffffff, 0.8);
      dir.position.set(2, 3, 2);
      const rim = new THREE.DirectionalLight(0xd4a843, 0.25);
      rim.position.set(-2, 1, -1);
      scene.add(amb, dir, rim);

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
      scene.add(mesh);

      // Subtle bloom-like glow via an extra larger plane behind
      const glowGeom = new THREE.PlaneGeometry(CARD_W * 1.3, CARD_H * 1.35);
      const glowMat = new THREE.MeshBasicMaterial({ color: 0xd4a843, transparent: true, opacity: 0.06, side: THREE.DoubleSide });
      const glow = new THREE.Mesh(glowGeom, glowMat);
      glow.position.z = -0.08;
      scene.add(glow);

      let t = 0;
      let dragging = false,
        lastX = 0,
        rotY = 0,
        autoRot = 0.003;
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
      };

      const onResize = () => {
        if (!el) return;
        const nw = el.clientWidth,
          nh = el.clientHeight;
        camera.aspect = nw / nh;
        camera.updateProjectionMatrix();
        renderer.setSize(nw, nh);
      };
      window.addEventListener("resize", onResize);

      const animate = () => {
        rafRef.current = requestAnimationFrame(animate);
        t += 0.016;
        if (!dragging) rotY += autoRot;
        if (mesh) {
          mesh.rotation.y = rotY;
          mesh.rotation.x = Math.sin(t * 0.3) * 0.06;
          mesh.position.y = Math.sin(t * 0.6) * 0.02;
        }
        renderer.render(scene, camera);
      };
      animate();
    })();

    return () => {
      disposed = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      detachWindowListeners?.();
      try {
        renderer?.dispose?.();
      } catch {}
      if (containerRef.current) containerRef.current.innerHTML = "";
    };
  }, [meshUrl, textureUrl]);
}
