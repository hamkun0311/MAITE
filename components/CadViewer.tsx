"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Box, Focus, Grid2X2, Layers, RotateCcw } from "lucide-react";
import type { CadMesh } from "@/lib/cad/schema";

export default function CadViewer({
  mesh,
  dimensions,
  view,
  onViewChange,
}: {
  mesh?: CadMesh;
  dimensions: number[];
  view: "3d" | "top" | "front";
  onViewChange: (view: "3d" | "top" | "front") => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const actions = useRef<{
    reset: () => void;
    setView: (v: string) => void;
  } | null>(null);
  const [grid, setGrid] = useState(true);
  const [wireframe, setWireframe] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!container.current) return;
    const host = container.current;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setError(
        "WebGL을 사용할 수 없습니다. 하드웨어 가속을 켜거나 다른 브라우저를 사용해주세요. STEP 다운로드는 계속 사용할 수 있습니다.",
      );
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x202b2e, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 5000);
    camera.up.set(0, 0, 1);
    const size = Math.max(...dimensions, 60);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = 10;
    controls.maxDistance = 1800;
    const setView = (v: string) => {
      controls.target.set(0, 0, 0);
      if (v === "top") camera.position.set(0, -0.001, size * 2.5);
      else if (v === "front") camera.position.set(0, -size * 2.5, 0.001);
      else camera.position.set(size * 1.55, -size * 1.9, size * 1.7);
      camera.lookAt(controls.target);
      controls.update();
    };
    actions.current = { reset: () => setView("3d"), setView };
    setView(view);
    scene.add(new THREE.HemisphereLight(0xe8ffff, 0x384448, 2.5));
    const key = new THREE.DirectionalLight(0xffffff, 3);
    key.position.set(-80, -60, 150);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x9be9cf, 1.5);
    fill.position.set(80, 40, 30);
    scene.add(fill);
    const gridHelper = new THREE.GridHelper(800, 80, 0x506165, 0x344247);
    gridHelper.rotation.x = Math.PI / 2;
    gridHelper.position.z = -dimensions[2] / 2 - 0.2;
    gridHelper.visible = grid;
    scene.add(gridHelper);
    const axes = new THREE.AxesHelper(size * 0.65);
    axes.position.set(-size * 0.65, -size * 0.5, -dimensions[2] / 2);
    scene.add(axes);
    let geometry: THREE.BufferGeometry | undefined;
    let material: THREE.MeshStandardMaterial | undefined;
    let edges: THREE.EdgesGeometry | undefined;
    let edgeMaterial: THREE.LineBasicMaterial | undefined;
    if (mesh) {
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(mesh.vertices, 3),
      );
      geometry.setAttribute(
        "normal",
        new THREE.Float32BufferAttribute(mesh.normals, 3),
      );
      geometry.setIndex(mesh.triangles);
      material = new THREE.MeshStandardMaterial({
        color: 0x9ed4c0,
        metalness: 0.32,
        roughness: 0.4,
        side: THREE.DoubleSide,
        wireframe,
      });
      scene.add(new THREE.Mesh(geometry, material));
      edges = new THREE.EdgesGeometry(geometry, 25);
      edgeMaterial = new THREE.LineBasicMaterial({
        color: 0x244b40,
        transparent: true,
        opacity: 0.65,
      });
      scene.add(new THREE.LineSegments(edges, edgeMaterial));
    }
    const observer = new ResizeObserver(() => {
      const { width, height } = host.getBoundingClientRect();
      renderer.setSize(width, height);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    });
    observer.observe(host);
    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      geometry?.dispose();
      material?.dispose();
      edges?.dispose();
      edgeMaterial?.dispose();
      gridHelper.geometry.dispose();
      (gridHelper.material as THREE.Material).dispose();
      axes.geometry.dispose();
      (axes.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
      actions.current = null;
    };
    // View changes use the existing controls without recreating WebGL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesh, dimensions[0], dimensions[1], dimensions[2], grid, wireframe]);

  useEffect(() => {
    actions.current?.setView(view);
  }, [view]);

  return (
    <div className="viewport">
      <div
        ref={container}
        className="canvas-host"
        aria-label="3D CAD 미리보기. 마우스로 회전, 휠로 확대, 우클릭으로 이동"
      />
      <div className="viewport-top">
        <span className="viewport-label">
          <span className={mesh ? "status-dot" : "status-dot muted"} />
          {mesh ? "정밀 솔리드 · B-Rep" : "새로운 형태를 기다리는 중"}
        </span>
        <span className="unit-tag">단위: mm</span>
      </div>
      <div className="view-tabs">
        {(
          [
            ["3d", "투시"],
            ["top", "평면"],
            ["front", "정면"],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            className={view === v ? "selected" : ""}
            onClick={() => onViewChange(v)}
          >
            {label}
          </button>
        ))}
      </div>
      {!mesh && !error && (
        <div className="empty-view">
          <Box size={46} strokeWidth={1} />
          <h3>아이디어가 형태가 되는 공간</h3>
          <p>모델을 생성하면 이곳에서 형태를 확인할 수 있습니다.</p>
        </div>
      )}
      {error && (
        <div className="viewer-error" role="alert">
          {error}
        </div>
      )}
      <div className="viewport-tools">
        <button
          title="뷰 초기화"
          aria-label="뷰 초기화"
          onClick={() => {
            actions.current?.reset();
            onViewChange("3d");
          }}
        >
          <RotateCcw size={17} />
        </button>
        <button
          title="모델에 맞추기"
          aria-label="모델에 맞추기"
          onClick={() => actions.current?.setView(view)}
        >
          <Focus size={18} />
        </button>
        <span />
        <button
          title="그리드"
          aria-label="그리드"
          aria-pressed={grid}
          className={grid ? "active" : ""}
          onClick={() => setGrid(!grid)}
        >
          <Grid2X2 size={17} />
        </button>
        <button
          title="와이어프레임"
          aria-label="와이어프레임"
          aria-pressed={wireframe}
          className={wireframe ? "active" : ""}
          onClick={() => setWireframe(!wireframe)}
        >
          <Layers size={17} />
        </button>
      </div>
      <div className="viewport-bottom">
        <span>
          드래그로 회전 <i /> 스크롤로 확대 <i /> 우클릭으로 이동
        </span>
        <span className="axis-legend">
          <b>X</b>
          <b>Y</b>
          <b>Z</b>
        </span>
      </div>
    </div>
  );
}
