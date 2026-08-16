import { useEffect, useRef } from "react";

// Imperative Three.js card viewer — mounted by Card3D page.

// Card proportions shared by every mesh path.
const CARD_W = 0.63;
const CARD_H = 0.88;
const CARD_THICK = 0.03;

// Public asset — placeholder artwork for cards that have no texture yet.
const PLACEHOLDER_TEXTURE_URL = "/texture/karina.png";

// Load a card OBJ and normalize it: unified material, centered, fitted to the
// standard card height — export units vary per modeling tool.
async function loadCardObj(THREE: any, url: string): Promise<any> {
  const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
  const obj = await new OBJLoader().loadAsync(url);
  const material = new THREE.MeshStandardMaterial({ color: 0x232338, roughness: 0.4, metalness: 0.18 });
  obj.traverse((child: any) => {
    if (child.isMesh) child.material = material;
  });
  const bounds = new THREE.Box3().setFromObject(obj);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const fit = CARD_H / (size.y || 1);
  obj.scale.setScalar(fit);
  obj.position.set(-center.x * fit, -center.y * fit, -center.z * fit);
  return obj;
}

// Build a card box mesh with the given image as its face texture.
// Rejects when the image cannot be loaded or decoded.
async function texturedCardBox(THREE: any, url: string): Promise<any> {
  const tex = await new Promise<any>((resolve, reject) => {
    new THREE.TextureLoader().load(url, resolve, undefined, reject);
  });
  tex.colorSpace = (THREE as any).SRGBColorSpace ?? undefined;
  const matFront = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, metalness: 0.05 });
  const matBack = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, metalness: 0.05 });
  const matSide = new THREE.MeshStandardMaterial({ color: 0x2a2a40, roughness: 0.6 });
  const matTop = new THREE.MeshStandardMaterial({ color: 0x2a2a40, roughness: 0.6 });
  // BoxGeometry materials order: +x, -x, +y, -y, +z, -z
  return new THREE.Mesh(new THREE.BoxGeometry(CARD_W, CARD_H, CARD_THICK), [matSide, matSide, matTop, matTop, matFront, matBack]);
}

export function useCardViewer(containerRef: React.RefObject<HTMLDivElement | null>, artworkUrl: string | null) {
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

      // Mesh resolution order: custom OBJ → artwork texture on box →
      // placeholder texture → plain dark box. Seed/dev data may point at
      // artwork files that do not exist; those cards show the placeholder.
      const sourceUrl = artworkUrl || PLACEHOLDER_TEXTURE_URL;
      try {
        if (sourceUrl.toLowerCase().endsWith(".obj")) {
          try {
            mesh = await loadCardObj(THREE, sourceUrl);
          } catch {
            mesh = await texturedCardBox(THREE, PLACEHOLDER_TEXTURE_URL);
          }
        } else {
          try {
            mesh = await texturedCardBox(THREE, sourceUrl);
          } catch {
            mesh = await texturedCardBox(THREE, PLACEHOLDER_TEXTURE_URL);
          }
        }
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
  }, [artworkUrl]);
}
