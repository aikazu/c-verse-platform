import { useEffect, useRef } from "react";

// Hono node server for local dev without wrangler — re-export api app as node handler
// Also used to init three viewer imperatively

// Simple card 3D viewer using Three.js (code-split friendly)
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

      // Card geometry: rounded-ish box
      const cardW = 0.63,
        cardH = 0.88,
        thick = 0.03;
      const geom = new THREE.BoxGeometry(cardW, cardH, thick);
      const loader = new THREE.TextureLoader();

      const texUrl = artworkUrl || "";
      let matFront: any, matBack: any;
      if (texUrl) {
        try {
          const tex = await new Promise<any>((resolve, reject) => {
            loader.load(texUrl, resolve, undefined, reject);
          });
          tex.colorSpace = (THREE as any).SRGBColorSpace ?? undefined;
          matFront = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, metalness: 0.05 });
          matBack = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, metalness: 0.05 });
        } catch {
          matFront = new THREE.MeshStandardMaterial({ color: 0x1e1e32, roughness: 0.5 });
          matBack = matFront;
        }
      } else {
        matFront = new THREE.MeshStandardMaterial({ color: 0x1e1e32, roughness: 0.5 });
        matBack = matFront;
      }
      const matSide = new THREE.MeshStandardMaterial({ color: 0x2a2a40, roughness: 0.6 });
      const matTop = new THREE.MeshStandardMaterial({ color: 0x2a2a40, roughness: 0.6 });
      // BoxGeometry materials order: +x, -x, +y, -y, +z, -z
      const materials = [matSide, matSide, matTop, matTop, matFront, matBack];
      mesh = new THREE.Mesh(geom, materials);
      scene.add(mesh);

      // Subtle bloom-like glow via an extra larger plane behind
      const glowGeom = new THREE.PlaneGeometry(cardW * 1.3, cardH * 1.35);
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
