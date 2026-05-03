// fpv-scene.js - Three.js UGV camera viewport driven by backend telemetry

(function () {
  const mount = document.getElementById("fpv-scene");
  if (!mount || typeof THREE === "undefined") return;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0d10);
  scene.fog = new THREE.Fog(0x0a0d10, 28, 150);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  mount.appendChild(renderer.domElement);
  document.body.classList.add("webgl-ready");

  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 260);
  camera.position.set(0, 5.6, 10);

  const clock = new THREE.Clock();
  const startLat = -6.589190898640269;
  const startLng = 106.8060121530933;
  const vehicleTarget = new THREE.Vector3();
  const vehiclePosition = new THREE.Vector3();
  let targetHeading = 0;
  let currentHeading = 0;
  let latestState = null;

  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x1d241d, 1.9);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2d0, 2.2);
  sun.position.set(-28, 40, 24);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 110;
  sun.shadow.camera.left = -55;
  sun.shadow.camera.right = 55;
  sun.shadow.camera.top = 55;
  sun.shadow.camera.bottom = -55;
  scene.add(sun);

  const roadGroup = new THREE.Group();
  const propGroup = new THREE.Group();
  const vehicle = makeUGV();
  scene.add(roadGroup, propGroup, vehicle);

  buildEnvironment();
  buildProps();

  function makeMat(color, roughness = 0.75, metalness = 0.05) {
    return new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness,
    });
  }

  function makeUGV() {
    const group = new THREE.Group();

    const chassisMat = makeMat(0x27323c, 0.62, 0.2);
    const panelMat = makeMat(0x111820, 0.7, 0.12);
    const accentMat = makeMat(0x46b9d8, 0.4, 0.2);
    const tireMat = makeMat(0x111111, 0.85, 0.05);
    const lensMat = makeMat(0x0b151c, 0.25, 0.1);

    const base = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.42, 3.1), chassisMat);
    base.position.y = 0.58;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);

    const upper = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 1.55), panelMat);
    upper.position.set(0, 1.02, -0.12);
    upper.castShadow = true;
    group.add(upper);

    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.24, 0.86), accentMat);
    hood.position.set(0, 1.08, -1.36);
    hood.castShadow = true;
    group.add(hood);

    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 1.2, 14), panelMat);
    mast.position.set(0, 1.78, 0.35);
    mast.castShadow = true;
    group.add(mast);

    const sensor = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.28, 0.34), lensMat);
    sensor.position.set(0, 2.45, -0.06);
    sensor.castShadow = true;
    group.add(sensor);

    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 24), accentMat);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, 2.45, -0.26);
    group.add(lens);

    const wheels = [];
    for (const x of [-1.28, 1.28]) {
      for (const z of [-1.1, 1.1]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.34, 28), tireMat);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, 0.43, z);
        wheel.castShadow = true;
        wheel.receiveShadow = true;
        wheel.userData.spin = true;
        wheels.push(wheel);
        group.add(wheel);

        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.36, 20), accentMat);
        hub.rotation.z = Math.PI / 2;
        hub.position.copy(wheel.position);
        hub.castShadow = true;
        group.add(hub);
      }
    }

    const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.18, 0.16), accentMat);
    bumper.position.set(0, 0.72, -1.68);
    bumper.castShadow = true;
    group.add(bumper);

    group.userData.wheels = wheels;
    group.position.copy(vehiclePosition);
    return group;
  }

  function buildEnvironment() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(220, 220, 48, 48),
      makeMat(0x253525, 0.95, 0.02)
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const roadMat = makeMat(0x3f4242, 0.88, 0.02);
    for (let i = -8; i <= 8; i++) {
      const road = new THREE.Mesh(new THREE.PlaneGeometry(7.8, 22), roadMat);
      road.rotation.x = -Math.PI / 2;
      road.position.set(0, 0.012, i * 22);
      road.receiveShadow = true;
      roadGroup.add(road);
    }

    const edgeMat = makeMat(0xd7c47f, 0.7, 0.02);
    for (const x of [-4.1, 4.1]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 360), edgeMat);
      line.position.set(x, 0.035, 0);
      roadGroup.add(line);
    }

    const centerMat = makeMat(0xe7dfaa, 0.65, 0.02);
    for (let i = -18; i <= 18; i++) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.035, 4.2), centerMat);
      dash.position.set(0, 0.04, i * 10);
      roadGroup.add(dash);
    }

    const gridMat = new THREE.LineBasicMaterial({ color: 0x345047, transparent: true, opacity: 0.25 });
    const grid = new THREE.GridHelper(180, 36, 0x345047, 0x345047);
    grid.material = gridMat;
    grid.position.y = 0.025;
    scene.add(grid);
  }

  function buildProps() {
    const trunkMat = makeMat(0x493522, 0.9, 0.02);
    const leafMat = makeMat(0x2f7d43, 0.82, 0.02);
    const coneMat = makeMat(0xd78d35, 0.68, 0.04);

    for (let i = 0; i < 70; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const z = -90 + i * 2.9;
      const x = side * (8 + (i * 19 % 23));
      const scale = 0.7 + ((i * 7) % 9) * 0.06;
      const tree = new THREE.Group();

      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.13 * scale, 0.18 * scale, 1.45 * scale, 10), trunkMat);
      trunk.position.y = 0.72 * scale;
      trunk.castShadow = true;
      tree.add(trunk);

      const leaves = new THREE.Mesh(new THREE.ConeGeometry(0.78 * scale, 2.1 * scale, 9), leafMat);
      leaves.position.y = 2.05 * scale;
      leaves.castShadow = true;
      tree.add(leaves);

      tree.position.set(x, 0, z);
      propGroup.add(tree);
    }

    for (let i = 0; i < 10; i++) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.72, 16), coneMat);
      cone.position.set(i % 2 === 0 ? -3.15 : 3.15, 0.36, -36 + i * 8);
      cone.castShadow = true;
      propGroup.add(cone);
    }
  }

  function latLngToMeters(lat, lng) {
    const metersPerDegLat = 111320;
    const metersPerDegLng = 111320 * Math.cos(startLat * Math.PI / 180);
    return {
      x: (lng - startLng) * metersPerDegLng,
      z: -(lat - startLat) * metersPerDegLat,
    };
  }

  function shortestAngle(a, b) {
    let diff = (b - a + Math.PI) % (Math.PI * 2) - Math.PI;
    if (diff < -Math.PI) diff += Math.PI * 2;
    return diff;
  }

  function syncFromTelemetry(state) {
    latestState = state;
    const pos = latLngToMeters(state.lat, state.lng);
    vehicleTarget.set(pos.x, 0, pos.z);
    targetHeading = state.heading * Math.PI / 180;
  }

  window.updateFpvScene = syncFromTelemetry;

  function resize() {
    const rect = mount.getBoundingClientRect();
    const width = Math.max(2, rect.width);
    const height = Math.max(2, rect.height);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);

    vehiclePosition.lerp(vehicleTarget, 1 - Math.pow(0.00001, dt));
    currentHeading += shortestAngle(currentHeading, targetHeading) * (1 - Math.pow(0.00002, dt));

    vehicle.position.copy(vehiclePosition);
    vehicle.rotation.y = currentHeading;

    const speed = latestState ? Math.abs(latestState.speed || 0) : 0;
    for (const wheel of vehicle.userData.wheels) {
      wheel.rotation.x += speed * dt * 4.8;
    }

    const forward = new THREE.Vector3(Math.sin(currentHeading), 0, -Math.cos(currentHeading));
    const chaseOffset = forward.clone().multiplyScalar(-8.5).add(new THREE.Vector3(0, 4.2, 0));
    const desiredCam = vehiclePosition.clone().add(chaseOffset);
    camera.position.lerp(desiredCam, 1 - Math.pow(0.00004, dt));
    const lookAhead = vehiclePosition.clone().add(forward.clone().multiplyScalar(4.5));
    camera.lookAt(lookAhead.x, vehiclePosition.y + 1.05, lookAhead.z);

    roadGroup.position.z = Math.round(vehiclePosition.z / 22) * 22;
    propGroup.position.z = Math.round(vehiclePosition.z / 80) * 80;

    renderer.render(scene, camera);
  }

  resize();
  window.addEventListener("resize", resize);
  animate();
})();
