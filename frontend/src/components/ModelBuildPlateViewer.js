import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader';

const DEFAULT_BED = { x: 220, y: 220, z: 250 };

const parseBedSize = (printer) => {
  const raw = printer?.notes?.bed_size || '';
  const match = String(raw).match(/(\d+(?:\.\d+)?)\s*(?:x|×|by|,|\s)\s*(\d+(?:\.\d+)?)(?:\s*(?:x|×|by|,|\s)\s*(\d+(?:\.\d+)?))?/i);
  if (!match) return DEFAULT_BED;
  return {
    x: Number(match[1]) || DEFAULT_BED.x,
    y: Number(match[2]) || DEFAULT_BED.y,
    z: Number(match[3]) || DEFAULT_BED.z,
  };
};

const disposeTree = (object) => {
  object.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (Array.isArray(child.material)) {
      child.material.forEach((material) => material.dispose());
    } else if (child.material) {
      child.material.dispose();
    }
  });
};

const createBed = (bed) => {
  const group = new THREE.Group();
  const grid = new THREE.GridHelper(Math.max(bed.x, bed.y), 22, 0x334155, 0x1e293b);
  grid.scale.x = bed.x / Math.max(bed.x, bed.y);
  grid.scale.z = bed.y / Math.max(bed.x, bed.y);
  group.add(grid);

  const outlineGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-bed.x / 2, 0.02, -bed.y / 2),
    new THREE.Vector3(bed.x / 2, 0.02, -bed.y / 2),
    new THREE.Vector3(bed.x / 2, 0.02, bed.y / 2),
    new THREE.Vector3(-bed.x / 2, 0.02, bed.y / 2),
    new THREE.Vector3(-bed.x / 2, 0.02, -bed.y / 2),
  ]);
  group.add(new THREE.Line(
    outlineGeometry,
    new THREE.LineBasicMaterial({ color: 0x60a5fa, transparent: true, opacity: 0.65 })
  ));

  const plateGeometry = new THREE.PlaneGeometry(bed.x, bed.y);
  const plate = new THREE.Mesh(
    plateGeometry,
    new THREE.MeshBasicMaterial({ color: 0x0f172a, transparent: true, opacity: 0.38, side: THREE.DoubleSide })
  );
  plate.rotation.x = -Math.PI / 2;
  plate.position.y = -0.01;
  group.add(plate);

  return group;
};

const buildStlObject = (geometry) => {
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color: 0x60a5fa,
    metalness: 0.05,
    roughness: 0.56,
  });
  return new THREE.Mesh(geometry, material);
};

const normaliseObject = (object, bed) => {
  object.rotation.x = -Math.PI / 2;
  object.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= box.min.y;
  object.updateMatrixWorld(true);

  const scaleLimit = Math.min(
    bed.x / Math.max(size.x, 1),
    bed.y / Math.max(size.z, 1),
    1
  );
  if (scaleLimit < 1) {
    object.scale.multiplyScalar(scaleLimit * 0.94);
    object.updateMatrixWorld(true);
  }

  const finalBox = new THREE.Box3().setFromObject(object);
  const finalSize = new THREE.Vector3();
  finalBox.getSize(finalSize);

  return {
    x: finalSize.x,
    y: finalSize.z,
    z: finalSize.y,
    scaled: scaleLimit < 1,
  };
};

const loadModel = (model, url) => new Promise((resolve, reject) => {
  const format = String(model?.source_format || '').toLowerCase();
  if (format === 'stl') {
    new STLLoader().load(url, (geometry) => resolve(buildStlObject(geometry)), undefined, reject);
    return;
  }
  if (format === '3mf') {
    new ThreeMFLoader().load(url, (group) => resolve(group), undefined, reject);
    return;
  }
  reject(new Error('Unsupported model format'));
});

const previewErrorMessage = (err) => {
  const message = String(err?.message || '');
  const lower = message.toLowerCase();
  if (message.includes('404') || lower.includes('not found')) {
    return 'Model file not found in central storage. Upload the STL or 3MF file again, then select the new model.';
  }
  if (lower.includes('unsupported')) {
    return 'This model format cannot be previewed yet. Upload an STL or 3MF file.';
  }
  return 'Model preview failed. Check that the file is still available in central storage.';
};

const ModelBuildPlateViewer = ({ model, printer, viewPreset }) => {
  const mountRef = useRef(null);
  const [error, setError] = useState('');
  const [dimensions, setDimensions] = useState(null);
  const bed = useMemo(() => parseBedSize(printer), [printer]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !model) {
      setDimensions(null);
      setError('');
      return undefined;
    }

    let disposed = false;
    let modelObject = null;
    setError('');
    setDimensions(null);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020617);
    scene.add(createBed(bed));
    scene.add(new THREE.HemisphereLight(0xe2e8f0, 0x0f172a, 1.3));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
    keyLight.position.set(-120, 180, 90);
    scene.add(keyLight);

    const width = mount.clientWidth || 800;
    const height = mount.clientHeight || 520;
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 5000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controls.target.set(0, 24, 0);

    const frameScene = () => {
      const span = Math.max(bed.x, bed.y, bed.z, 120);
      const views = {
        top: [0, span * 1.75, 0.01],
        front: [0, span * 0.55, span * 1.25],
        side: [span * 1.25, span * 0.55, 0],
        iso: [span * 0.92, span * 0.82, span * 1.08],
      };
      camera.position.set(...(views[viewPreset] || views.iso));
      camera.lookAt(controls.target);
      controls.update();
    };

    frameScene();

    const resizeObserver = new ResizeObserver(() => {
      if (!mount.clientWidth || !mount.clientHeight) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    });
    resizeObserver.observe(mount);

    loadModel(model, `/api/slicer/models/${model.id}/download`)
      .then((object) => {
        if (disposed) {
          disposeTree(object);
          return;
        }
        modelObject = object;
        const nextDimensions = normaliseObject(modelObject, bed);
        scene.add(modelObject);
        setDimensions(nextDimensions);
      })
      .catch((err) => {
        if (!disposed) setError(previewErrorMessage(err));
      });

    let animationFrame = 0;
    const animate = () => {
      if (disposed) return;
      controls.update();
      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      controls.dispose();
      scene.traverse((child) => {
        if (child !== modelObject && child.geometry) child.geometry.dispose();
        if (child !== modelObject && child.material) child.material.dispose();
      });
      if (modelObject) disposeTree(modelObject);
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [bed, model, viewPreset]);

  if (!model) {
    return (
      <div className="flex h-full min-h-[520px] items-center justify-center rounded-lg border border-slate-800 bg-slate-950 text-sm font-semibold text-slate-500">
        No model selected
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-[520px] overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
      <div ref={mountRef} className="h-full w-full" />
      <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-2">
        <span className="rounded-md border border-slate-700/80 bg-slate-950/85 px-2 py-1 text-[10px] font-bold uppercase text-slate-300">
          Bed {bed.x} x {bed.y} mm
        </span>
        {dimensions && (
          <span className="rounded-md border border-slate-700/80 bg-slate-950/85 px-2 py-1 text-[10px] font-bold uppercase text-slate-300">
            Model {dimensions.x.toFixed(1)} x {dimensions.y.toFixed(1)} x {dimensions.z.toFixed(1)} mm
          </span>
        )}
        {dimensions?.scaled && (
          <span className="rounded-md border border-amber-500/30 bg-amber-500/15 px-2 py-1 text-[10px] font-bold uppercase text-amber-200">
            Preview scaled
          </span>
        )}
      </div>
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/90 text-sm font-semibold text-red-300">
          {error}
        </div>
      )}
    </div>
  );
};

export default ModelBuildPlateViewer;
