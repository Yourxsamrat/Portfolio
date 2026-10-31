/* =========================================================
   Special Project - interactive 3D headphone (Three.js / WebGL)

   - One real 3D object, lit like a studio product render.
   - Hover (mouseenter on the headphone) -> one slow, eased 360° turn
     around the headphone's own vertical (Y) axis.
   - No scroll dependency. Idle = subtle floating.

   SWAPPING IN A REAL MODEL
   Put a .glb / .gltf next to index.html and set it on the stage:
       <div class="anc-stage" data-model="headphones.glb">
   It is auto-centred on its own pivot, scaled to fit, lit and
   reflection-mapped by the same rig. The procedural headphone below
   is only the placeholder / fallback (also used if the file fails).
   ========================================================= */
(() => {
    "use strict";

    const stage = document.querySelector(".anc-stage");
    const canvas = stage && stage.querySelector(".anc-canvas");
    const hotspot = stage && stage.querySelector(".anc-headphone-hotspot");
    if (!stage || !canvas || !hotspot || !window.THREE || !window.gsap) return;

    const THREE = window.THREE;
    const gsap = window.gsap;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const CONFIG = {
        modelUrl: (stage.dataset.model || "").trim(), // optional .glb/.gltf
        modelHeight: 2.5,       // scene units the model is normalised to
        yawBase: 0.42,          // resting 3/4 angle (rad) so it never reads flat
        spinDuration: 3.8,      // seconds for the full 360°
        spinEase: "power2.inOut",
        bobAmplitude: 0.07,
        swayAmplitude: 0.09,
        tiltX: 0.10,
        tiltZ: 0.035,
        tiltYaw: 0.14,
        envBase: 1.35,
        envBoost: 0.22,
        gltfLoaderUrl: "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js",
    };

    /* ---------- Renderer ---------- */
    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({
            canvas, antialias: true, alpha: true, powerPreference: "high-performance",
        });
    } catch (err) {
        return; // no WebGL: leave the plain dark stage
    }
    renderer.setClearColor(0x000000, 0);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 16 / 9, 0.1, 60);
    camera.position.set(0, 0.35, 7.6);
    camera.lookAt(0, -0.05, 0);

    /* ---------- Studio environment (procedural softboxes -> PMREM) ---------- */
    function buildEnvironment() {
        const env = new THREE.Scene();
        env.add(new THREE.Mesh(
            new THREE.BoxGeometry(40, 40, 40),
            new THREE.MeshBasicMaterial({ color: 0x030408, side: THREE.BackSide, toneMapped: false })
        ));
        const panel = (w, h, color, intensity, x, y, z) => {
            const m = new THREE.Mesh(
                new THREE.PlaneGeometry(w, h),
                new THREE.MeshBasicMaterial({
                    color: new THREE.Color(color).multiplyScalar(intensity),
                    side: THREE.DoubleSide, toneMapped: false,
                })
            );
            m.position.set(x, y, z);
            m.lookAt(0, 0, 0);
            env.add(m);
        };
        panel(14, 7, 0xffffff, 5.0, 0, 11, 3);        // overhead softbox
        panel(3, 14, 0xffe3c8, 4.0, -11, 2, 4);       // warm key strip (left)
        panel(3, 14, 0xa2c8ff, 5.0, 11, 2, -3);       // cool rim strip (right)
        panel(9, 7, 0xffffff, 2.2, 0, 4, -13);        // back kicker
        panel(12, 3, 0xdfe8ff, 0.7, 0, -4, 12);       // low front fill
        const pmrem = new THREE.PMREMGenerator(renderer);
        const tex = pmrem.fromScene(env, 0.035).texture;
        pmrem.dispose();
        env.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
        return tex;
    }
    const envTexture = buildEnvironment();

    /* ---------- Lights ---------- */
    const key = new THREE.DirectionalLight(0xfff0e0, 1.5);
    key.position.set(-3.5, 5.5, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -3.2; key.shadow.camera.right = 3.2;
    key.shadow.camera.top = 3.2; key.shadow.camera.bottom = -3.2;
    key.shadow.camera.near = 1; key.shadow.camera.far = 16;
    key.shadow.bias = -0.0006;
    key.shadow.radius = 4;
    const rimCool = new THREE.DirectionalLight(0x84b6ff, 1.2);
    rimCool.position.set(5, 2, -4);
    const rimWarm = new THREE.DirectionalLight(0xffcfa0, 0.9);
    rimWarm.position.set(-5, 1, -4);
    const hemi = new THREE.HemisphereLight(0x3a4560, 0x050608, 0.35);
    scene.add(key, rimCool, rimWarm, hemi);

    /* ---------- Hierarchy: tilt > float > spin > fit > model ---------- */
    const tiltGroup = new THREE.Group();   // subtle mouse-follow tilt
    const floatGroup = new THREE.Group();  // idle / hover float
    const spinGroup = new THREE.Group();   // the 360° turn about its own Y axis
    const modelHolder = new THREE.Group(); // swappable model slot
    scene.add(tiltGroup);
    tiltGroup.add(floatGroup);
    floatGroup.add(spinGroup);
    spinGroup.add(modelHolder);

    // Invisible hit volume that does NOT spin, so hover never flickers
    // through the open middle of the headband.
    const hitMesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 20, 14),
        new THREE.MeshBasicMaterial({ visible: false })
    );
    floatGroup.add(hitMesh);

    // Soft contact shadow under the floating object
    function radialTexture() {
        const c = document.createElement("canvas");
        c.width = c.height = 128;
        const g = c.getContext("2d");
        const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
        grad.addColorStop(0, "rgba(0,0,0,.85)");
        grad.addColorStop(0.45, "rgba(0,0,0,.35)");
        grad.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = grad;
        g.fillRect(0, 0, 128, 128);
        const t = new THREE.CanvasTexture(c);
        t.encoding = THREE.sRGBEncoding;
        return t;
    }
    const shadowBlob = new THREE.Mesh(
        new THREE.PlaneGeometry(4.6, 4.6),
        new THREE.MeshBasicMaterial({
            map: radialTexture(), transparent: true, depthWrite: false, toneMapped: false,
        })
    );
    shadowBlob.rotation.x = -Math.PI / 2;
    shadowBlob.position.set(0, -1.95, 0);
    shadowBlob.scale.set(1.0, 0.7, 1);
    scene.add(shadowBlob);

    /* ---------- Materials (registered so reflections can be driven) ---------- */
    const envMaterials = [];
    function register(mat, intensity = 1) {
        mat.envMap = envTexture;
        mat.envMapIntensity = intensity;
        mat.userData.baseEnv = intensity;
        envMaterials.push(mat);
        return mat;
    }
    const mats = {
        shell: register(new THREE.MeshPhysicalMaterial({
            color: 0x1a1c22, metalness: 0.85, roughness: 0.3,
            clearcoat: 1, clearcoatRoughness: 0.1, side: THREE.DoubleSide,
        }), 1.0),
        metal: register(new THREE.MeshStandardMaterial({
            color: 0x9a9ea7, metalness: 1, roughness: 0.3,
        }), 1.1),
        chrome: register(new THREE.MeshStandardMaterial({
            color: 0xdadde4, metalness: 1, roughness: 0.12,
        }), 1.2),
        leather: register(new THREE.MeshPhysicalMaterial({
            color: 0x0d0d10, metalness: 0, roughness: 0.52,
            clearcoat: 0.25, clearcoatRoughness: 0.45,
        }), 0.9),
        fabric: register(new THREE.MeshStandardMaterial({
            color: 0x050506, metalness: 0, roughness: 0.92, side: THREE.DoubleSide,
        }), 0.5),
        gloss: register(new THREE.MeshPhysicalMaterial({
            color: 0x08090c, metalness: 0.6, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05,
        }), 1.2),
    };

    /* ---------- Placeholder headphone (procedural) ---------- */
    function mesh(geo, mat) {
        const m = new THREE.Mesh(geo, mat);
        m.castShadow = true;
        m.receiveShadow = true;
        return m;
    }

    function buildCup(side) {
        const root = new THREE.Group();
        root.position.set(side * 1.0, -0.35, 0);
        if (side < 0) root.rotation.y = Math.PI;
        const body = new THREE.Group();          // oval ear-cup proportions
        body.scale.set(1, 1.12, 0.92);
        root.add(body);

        // Axis of the cup = +X (outside). Lathe axis is Y, so rotate z by -90°.
        const profile = new THREE.SplineCurve([
            new THREE.Vector2(0.0, -0.06), new THREE.Vector2(0.45, -0.06),
            new THREE.Vector2(0.60, 0.0), new THREE.Vector2(0.635, 0.14),
            new THREE.Vector2(0.58, 0.27), new THREE.Vector2(0.45, 0.33),
            new THREE.Vector2(0.22, 0.355), new THREE.Vector2(0.0, 0.36),
        ]).getPoints(48);
        const shell = mesh(new THREE.LatheGeometry(profile, 96), mats.shell);
        shell.rotation.z = -Math.PI / 2;
        body.add(shell);

        const plate = mesh(new THREE.CylinderGeometry(0.33, 0.355, 0.04, 80), mats.metal);
        plate.rotation.z = -Math.PI / 2;
        plate.position.x = 0.375;
        body.add(plate);

        const logo = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 48), mats.gloss);
        logo.rotation.z = -Math.PI / 2;
        logo.position.x = 0.4;
        body.add(logo);

        const ring = mesh(new THREE.TorusGeometry(0.372, 0.014, 16, 120), mats.chrome);
        ring.rotation.y = Math.PI / 2;
        ring.position.x = 0.36;
        body.add(ring);

        const cushion = mesh(new THREE.TorusGeometry(0.47, 0.17, 36, 110), mats.leather);
        cushion.rotation.y = Math.PI / 2;
        cushion.position.x = -0.13;
        body.add(cushion);

        const inner = mesh(new THREE.CircleGeometry(0.34, 64), mats.fabric);
        inner.rotation.y = -Math.PI / 2;
        inner.position.x = -0.05;
        body.add(inner);

        // Fork / yoke that carries the cup up to the headband
        const yoke = mesh(new THREE.TorusGeometry(0.68, 0.032, 18, 80, Math.PI), mats.metal);
        yoke.rotation.y = Math.PI / 2;
        yoke.position.x = 0.14;
        body.add(yoke);
        [-1, 1].forEach((s) => {
            const pin = mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.12, 24), mats.chrome);
            pin.rotation.x = Math.PI / 2;
            pin.position.set(0.14, 0, s * 0.64);
            body.add(pin);
        });
        const hub = mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.2, 32), mats.chrome);
        hub.rotation.x = Math.PI / 2;
        hub.position.set(0.14, 0.76, 0);
        body.add(hub);

        return root;
    }

    function buildHeadband() {
        const g = new THREE.Group();
        const a = 1.14, b = 1.0, cy = 0.41;
        const arc = (ra, rb, t0, t1, n) => {
            const pts = [];
            for (let i = 0; i <= n; i++) {
                const t = t0 + (t1 - t0) * (i / n);
                pts.push(new THREE.Vector3(ra * Math.cos(t), cy + rb * Math.sin(t), 0));
            }
            return new THREE.CatmullRomCurve3(pts);
        };
        const band = mesh(new THREE.TubeGeometry(arc(a, b, 0, Math.PI, 120), 160, 0.06, 24, false), mats.metal);
        band.scale.z = 2.3;
        g.add(band);

        const pad = mesh(new THREE.TubeGeometry(
            arc(a - 0.1, b - 0.1, Math.PI * 0.2, Math.PI * 0.8, 80), 120, 0.085, 24, false), mats.leather);
        pad.scale.z = 2.0;
        g.add(pad);
        return g;
    }

    function buildPlaceholderHeadphone() {
        const hp = new THREE.Group();
        hp.add(buildHeadband(), buildCup(1), buildCup(-1));
        return hp;
    }

    /* ---------- Model slot: centre on own pivot + fit ---------- */
    let currentModel = null;
    function mountModel(obj) {
        obj.traverse((o) => {
            if (!o.isMesh) return;
            o.castShadow = true;
            o.receiveShadow = true;
            [].concat(o.material).forEach((m) => {
                if (m && !envMaterials.includes(m)) register(m, m.envMapIntensity || 1);
            });
        });
        obj.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(obj);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const k = CONFIG.modelHeight / (size.y || 1);

        const fit = new THREE.Group();
        fit.scale.setScalar(k);
        fit.position.copy(center).multiplyScalar(-k); // pivot = visual centre
        fit.add(obj);

        if (currentModel) modelHolder.remove(currentModel);
        currentModel = fit;
        modelHolder.add(fit);

        hitMesh.scale.set(
            Math.max(size.x * k * 0.56, 0.8),
            Math.max(size.y * k * 0.56, 0.8),
            Math.max(size.z * k * 0.6, 0.8)
        );
    }

    function loadGLB(url) {
        return new Promise((resolve, reject) => {
            const go = () => new THREE.GLTFLoader().load(url, (gltf) => resolve(gltf.scene), undefined, reject);
            if (THREE.GLTFLoader) return go();
            const s = document.createElement("script");
            s.src = CONFIG.gltfLoaderUrl;
            s.onload = go;
            s.onerror = reject;
            document.head.appendChild(s);
        });
    }

    mountModel(buildPlaceholderHeadphone());
    if (CONFIG.modelUrl) {
        loadGLB(CONFIG.modelUrl).then(mountModel).catch(() => { /* keep placeholder */ });
    }

    /* ---------- Interaction state ---------- */
    const state = { spin: 0, lift: 0, boost: 0 };
    const tilt = { tx: 0, ty: 0, x: 0, y: 0 };
    let spinning = false;
    let hovering = false;

    function play() {
        if (spinning || reduceMotion) return; // let a running turn finish
        spinning = true;
        const d = CONFIG.spinDuration;
        gsap.timeline()
            .to(state, { spin: Math.PI * 2, duration: d, ease: CONFIG.spinEase }, 0)
            .to(state, { lift: 1, duration: d * 0.45, ease: "sine.out" }, 0)
            .to(state, { lift: 0, duration: d * 0.55, ease: "sine.inOut" }, d * 0.45)
            .to(state, { boost: 1, duration: 0.6, ease: "power2.out" }, 0)
            .to(state, { boost: 0, duration: 1.6, ease: "sine.inOut" }, d - 0.7)
            .call(() => { state.spin = 0; spinning = false; }, null, d);
    }

    function setHover(over) {
        if (over === hovering) return;
        hovering = over;
        hotspot.style.cursor = over ? "pointer" : "default";
        if (over) play();
    }

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    function updatePointer(e) {
        const r = hotspot.getBoundingClientRect();
        ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
        tilt.tx = ndc.x;
        tilt.ty = ndc.y;
        raycaster.setFromCamera(ndc, camera);
        return raycaster.intersectObject(hitMesh, false).length > 0;
    }
    hotspot.addEventListener("pointermove", (e) => setHover(updatePointer(e)));
    hotspot.addEventListener("pointerdown", (e) => { if (updatePointer(e)) { hovering = true; play(); } });
    hotspot.addEventListener("pointerleave", () => {
        hovering = false;
        hotspot.style.cursor = "default";
        tilt.tx = 0;
        tilt.ty = 0;
    });
    // Keyboard activation (Enter / Space fire click with detail === 0)
    hotspot.addEventListener("click", (e) => { if (e.detail === 0) play(); });

    /* ---------- Frame update ---------- */
    function update(dt, time) {
        const k = 1 - Math.exp(-dt * 4.5);
        tilt.x += (tilt.tx - tilt.x) * k;
        tilt.y += (tilt.ty - tilt.y) * k;

        const motion = reduceMotion ? 0 : 1;
        const bob = Math.sin(time * 0.9) * CONFIG.bobAmplitude * motion;
        const sway = Math.sin(time * 0.45) * CONFIG.swayAmplitude * motion;

        tiltGroup.rotation.x = -tilt.y * CONFIG.tiltX;
        tiltGroup.rotation.z = -tilt.x * CONFIG.tiltZ;
        floatGroup.position.y = bob + state.lift * 0.16;
        spinGroup.rotation.y = CONFIG.yawBase + sway + tilt.x * CONFIG.tiltYaw + state.spin;

        const b = state.boost;
        key.intensity = 1.5 + 0.35 * b;
        rimCool.intensity = 1.2 + 0.6 * b;
        rimWarm.intensity = 0.9 + 0.4 * b;
        renderer.toneMappingExposure = 1.05 + 0.05 * b;
        const envK = CONFIG.envBase + CONFIG.envBoost * b;
        for (const m of envMaterials) m.envMapIntensity = (m.userData.baseEnv || 1) * envK;

        const lifted = state.lift;
        shadowBlob.material.opacity = 0.8 - 0.3 * lifted - bob * 1.2;
        const s = 1 - 0.1 * lifted - bob * 0.3;
        shadowBlob.scale.set(s, 0.7 * s, 1);
        stage.style.setProperty("--anc-glow", (0.16 + 0.12 * b).toFixed(3));
    }

    /* ---------- Sizing & loop ---------- */
    function resize() {
        const w = stage.clientWidth || 1;
        const h = stage.clientHeight || 1;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    }
    resize();
    if ("ResizeObserver" in window) new ResizeObserver(resize).observe(stage);
    else window.addEventListener("resize", resize);

    let running = false;
    let last = performance.now();
    function frame(now) {
        if (!running) return;
        requestAnimationFrame(frame);
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        update(dt, now / 1000);
        renderer.render(scene, camera);
        if (!canvas.classList.contains("is-ready")) canvas.classList.add("is-ready");
    }
    function start() {
        if (running) return;
        running = true;
        last = performance.now();
        requestAnimationFrame(frame);
    }
    if ("IntersectionObserver" in window) {
        new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) start();
            else running = false; // don't render while off-screen
        }, { rootMargin: "120px" }).observe(stage);
    } else {
        start();
    }
})();
