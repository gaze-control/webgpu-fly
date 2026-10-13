
import * as THREE from "three";
import type { Physics } from "./physics";

type Host = { scene: THREE.Scene; camera: THREE.Camera; renderer: THREE.WebGLRenderer; setDrive: (f: number, t: number) => void };
type XYZ = [number, number, number];
declare global { interface Window { __mantisStage1?: () => void; } }

export function addMantis(room: Host, p: Physics) {
  const readPose = () => p.data.qpos as Float64Array;
  window.__mantisStage1?.();
  const title = document.querySelector("#side h1");
  if (!title) throw new Error("Mantis needs the science-view sidebar.");
  const mantis = new THREE.Group();
  mantis.name = "Mantis_stage1_visual_only";
  mantis.scale.setScalar(1.8);
  const sphere = new THREE.SphereGeometry(1, 12, 8);
  const cylinder = new THREE.CylinderGeometry(0.7, 1, 1, 8);
  const green = new THREE.MeshStandardMaterial({ color: 0x789c4b, roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x354e26, roughness: 0.8 });
  function oval(p: XYZ, s: XYZ, material = green) {
    const mesh = new THREE.Mesh(sphere, material);
    mesh.position.set(...p); mesh.scale.set(...s); mantis.add(mesh);
  }
  function limb(a: XYZ, b: XYZ, radius: number, parent: THREE.Object3D = mantis) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const d = end.clone().sub(start);
    const mesh = new THREE.Mesh(cylinder, green);
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.scale.set(radius, d.length(), radius);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    parent.add(mesh);
    return mesh;
  }
  oval([-0.85, 0.61, 0], [0.77, 0.19, 0.31]);
  limb([-0.25, 0.63, 0], [0.61, 1.12, 0], 0.10);
  const head = new THREE.BufferGeometry();
  head.setAttribute("position", new THREE.Float32BufferAttribute([
    0.69,1.27,-0.32, 0.69,1.27,0.32, 0.69,0.91,0,
    0.86,1.27,-0.32, 0.86,1.27,0.32, 0.94,0.91,0,
  ], 3));
  head.setIndex([0,2,1, 3,4,5, 0,1,4, 0,4,3, 1,2,5, 1,5,4, 2,0,3, 2,3,5]);
  head.computeVertexNormals(); mantis.add(new THREE.Mesh(head, green));
  const legs: THREE.Group[] = [];
  const arms: { side: number; parts: THREE.Mesh[] }[] = [];
  for (const side of [-1, 1]) {
    oval([-0.88,0.76,side*0.11], [0.76,0.055,0.16], dark);
    oval([0.83,1.25,side*0.31], [0.15,0.15,0.14], dark);
    limb([0.79,1.32,side*0.12], [1.22,1.77,side*0.28], 0.012);
    limb([1.22,1.77,side*0.28], [1.66,1.96,side*0.43], 0.008);
    for (const rear of [false, true]) {
      const leg = new THREE.Group();
      leg.position.set(rear ? -0.66 : -0.21, 0.56, side*0.16);
      mantis.add(leg); legs.push(leg);
      const knee: XYZ = [rear ? -0.63 : 0.10, -0.06, side*0.54];
      const ankle: XYZ = [rear ? -0.83 : -0.20, -0.53, side*0.94];
      limb([0,0,0], knee, 0.044, leg);
      limb(knee, ankle, 0.028, leg);
      limb(ankle, [ankle[0]+0.17,-0.54,side*1.04], 0.013, leg);
    }
    arms.push({side, parts: [
      limb([0.41,0.95,side*0.14], [0.81,0.82,side*0.40], 0.05),
      limb([0.81,0.82,side*0.40], [1.14,0.33,side*0.39], 0.075),
      limb([1.14,0.33,side*0.39], [0.77,0.64,side*0.35], 0.04),
    ]});
  }
  // MANTIS_FOLDED_GRIP_V1: visual clamps and prescribed carrying pose.
  const toothGeometry = new THREE.ConeGeometry(1, 1, 5);
  const teeth = arms.map(() => Array.from({length:12}, () => {
    const mesh = new THREE.Mesh(toothGeometry, dark);
    mantis.add(mesh); return mesh;
  }));
  // Display only: excluded from the original retinal camera's layer 0.
  const oldLayers = room.camera.layers.mask;
  mantis.traverse(o => o.layers.set(1));
  room.camera.layers.enable(1); room.scene.add(mantis);
  const panel = document.createElement("section");
  panel.style.cssText = "padding:10px;border:1px solid #536443;border-radius:5px;background:#101a15;flex-shrink:0";
  panel.innerHTML = `<h2 style="margin:0 0 8px;font-size:12px;color:#bacd9b">MANTIS - FOLDED GRIP</h2>
    <div style="display:flex;gap:6px"><button type="button" class="stim-btn">Approach</button>
    <button type="button" class="stim-btn">Reset scene</button></div>
    <p style="font-size:11px;color:#bacd9b" aria-live="polite"></p>
    <small style="color:#8a958c">Scripted grip. Experimental head-loss rule below.</small>`;
  title.after(panel);
  const buttons = panel.querySelectorAll("button"), status = panel.querySelector("p")!;
  const fly = new THREE.Vector3(), direction = new THREE.Vector3();
  let moving = false, alive = true, raf = 0, last = performance.now(), elapsed = 0;
  function pose() {
    const q = readPose();
    if (q.length < 7) return null;
    for (let i = 0; i < 7; i++) if (!Number.isFinite(q[i])) return null;
    fly.set(q[0]*6, 0, -q[1]*6);
    return q;
  }
  function face() {
    direction.copy(fly).sub(mantis.position); direction.y = 0;
    if (direction.lengthSq() > 0.00001) mantis.rotation.y = Math.atan2(-direction.z, direction.x);
  }
  function reset() {
    releaseHold(false);
    const q = pose();
    if (!q) { status.textContent = "Waiting for fly position. Click Reset mantis shortly."; return; }
    direction.set(1-2*(q[5]*q[5]+q[6]*q[6]), 0, -2*(q[4]*q[5]+q[3]*q[6]));
    if (direction.lengthSq() < 0.00001) direction.set(1,0,0);
    direction.normalize(); mantis.position.copy(fly).addScaledVector(direction,5.4);
    mantis.position.x += direction.z*0.7; mantis.position.z -= direction.x*0.7;
    mantis.position.y = p.floorZ*6;
    moving = false; elapsed = 0; face();
    buttons[0].textContent = "Approach"; status.textContent = "Ready. Click Approach.";
  }
  buttons[0].onclick = () => {
    moving = !moving;
    buttons[0].textContent = moving ? "Pause mantis" : "Approach";
    status.textContent = moving ? "Approaching." : "Mantis paused.";
  };
  buttons[1].onclick = () => {
    const link = document.querySelector<HTMLButtonElement>("#mantis-brain-panel button");
    if (link && link.textContent !== "Connect brain") {
      status.textContent = "Disconnect brain first, then click Reset scene again.";
      return;
    }
    room.setDrive(0, 0); p.reset(); reset();
  };

  // MANTIS_STAGE3: prescribed restraint, not a contact-force or injury model.
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:6px;margin-top:10px";
  const strike = document.createElement("button"), release = document.createElement("button");
  for (const button of [strike, release]) {
    button.type = "button"; button.className = "stim-btn"; row.appendChild(button);
  }
  strike.textContent = "Strike & hold"; release.textContent = "Release fly";
  release.disabled = true; panel.appendChild(row);
  let held: Float64Array | null = null, striking = false, strikeTime = 0;
  const aim = new THREE.Vector3(), launch = new THREE.Vector3(), destination = new THREE.Vector3();
  const localAim = new THREE.Vector3(), currentFly = new THREE.Vector3();
  function flyWorld() {
    const q = readPose();
    return currentFly.set(q[0]*6, q[2]*6, -q[1]*6);
  }
  function setBone(mesh: THREE.Mesh, a: THREE.Vector3, z: THREE.Vector3, r: number) {
    const d = z.clone().sub(a);
    mesh.position.copy(a).add(z).multiplyScalar(0.5);
    mesh.scale.set(r, Math.max(0.001,d.length()), r);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), d.normalize());
  }

  let carryTime = 0;
  const carryStart = new THREE.Vector3();
  const carryFrom = new THREE.Quaternion(), carryTo = new THREE.Quaternion();
  function armPose(amount: number) {
    mantis.updateWorldMatrix(true, false);
    localAim.copy(aim); mantis.worldToLocal(localAim);
    const q = readPose();
    const orientation = new THREE.Quaternion(q[4], q[6], -q[5], q[3]).normalize();
    const inverse = mantis.quaternion.clone().invert();
    const along = new THREE.Vector3(1,0,0).applyQuaternion(orientation).applyQuaternion(inverse);
    const across = new THREE.Vector3(0,-1,0).applyQuaternion(orientation).applyQuaternion(inverse);
    arms.forEach(({side:s, parts}, index) => {
      const center = localAim.clone().add(new THREE.Vector3(0,0,s*0.12));
      const shoulder = new THREE.Vector3(0.41,0.95,s*0.14);
      const upper = center.clone().addScaledVector(along,-0.34).addScaledVector(across,0.37);
      const hinge = center.clone().addScaledVector(along,0.52).addScaledVector(across,-0.02);
      const foldedTip = center.clone().addScaledVector(along,-0.32).addScaledVector(across,-0.34);
      const elbow = new THREE.Vector3(0.81,0.82,s*0.40).lerp(upper,amount);
      const knee = new THREE.Vector3(1.14,0.33,s*0.39).lerp(hinge,amount);
      const tip = new THREE.Vector3(0.77,0.64,s*0.35).lerp(foldedTip,amount);
      setBone(parts[0],shoulder,elbow,0.05);
      setBone(parts[1],elbow,knee,0.075);
      setBone(parts[2],knee,tip,0.04);
      // Opposing rows of spines on each individual folded foreleg.
      for (let k=0; k<6; k++) {
        const t=0.18+k*0.12;
        const a=elbow.clone().lerp(knee,t), b=tip.clone().lerp(knee,t);
        const inward=b.clone().sub(a).normalize();
        setBone(teeth[index][k],a.clone().addScaledVector(inward,0.065),a.clone().addScaledVector(inward,0.105),0.014);
        setBone(teeth[index][k+6],b.clone().addScaledVector(inward,-0.035),b.clone().addScaledVector(inward,-0.085),0.012);
      }
    });
  }
  function beginCarry() {
    if (!held) return;
    carryTime=0; carryStart.copy(flyWorld());
    carryFrom.set(held[4],held[6],-held[5],held[3]).normalize();
    const nose=new THREE.Vector3(-0.30,0.954,0).normalize();
    const back=new THREE.Vector3(nose.y,-nose.x,0);
    const side=nose.clone().cross(back);
    const basis=new THREE.Matrix4().makeBasis(nose,back,side);
    carryTo.copy(mantis.quaternion).multiply(new THREE.Quaternion().setFromRotationMatrix(basis)).normalize();
  }
  function carryFly(dt: number) {
    if (!held || carryTime>=2) return;
    carryTime=Math.min(2,carryTime+dt);
    const t=carryTime/2, u=t*t*(3-2*t);
    mantis.updateWorldMatrix(true,false);
    const destination=mantis.localToWorld(new THREE.Vector3(1.14,0.65,0));
    aim.lerpVectors(carryStart,destination,u);
    const q=carryFrom.clone().slerp(carryTo,u).normalize();
    held.set([aim.x/6,-aim.z/6,aim.y/6,q.w,q.x,-q.z,q.y]);
    pinBody(); p.mujoco.mj_forward(p.model,p.data); armPose(1);
    if (carryTime===2) status.textContent="HELD - folded forelegs, raised to mouth (scripted).";
  }
  function releaseHold(report = true) {
    clearEating();
    held = null; striking = false; moving = false;
    strike.disabled = false; release.disabled = true; buttons[0].disabled = false;
    buttons[0].textContent = "Approach"; armPose(0);
    if (report) status.textContent = "Released. Brain Link is unchanged.";
  }
  function pinBody() {
    if (!held) return;
    (p.data.qpos as Float64Array).set(held, 0);
    (p.data.qvel as Float64Array).fill(0, 0, 6);
  }
  // Preserve normal actuator/limb stepping. Only the held root pose is imposed.
  const oldStep = p.step, oldReset = p.reset;
  function stepWithHold(n = 1) {
    if (held) pinBody();
    oldStep.call(p, n);
    if (held) { pinBody(); p.mujoco.mj_forward(p.model, p.data); }
  }
  function resetWithRelease() { releaseHold(false); oldReset.call(p); }
  p.step = stepWithHold; p.reset = resetWithRelease;
  release.onclick = () => releaseHold();
  strike.onclick = () => {
    if (held || striking || !pose()) return;
    aim.copy(flyWorld());
    const height = aim.y - p.floorZ*6;
    const distance = Math.hypot(aim.x-mantis.position.x, aim.z-mantis.position.z);
    if (distance > 4.2 || distance < 1.8 || height > 2.2 || height < 0) {
      status.textContent = "Out of reach. Disconnect brain, Reset scene, then Approach.";
      return;
    }
    moving = false; buttons[0].textContent = "Approach"; face();
    launch.copy(mantis.position);
    direction.copy(aim).sub(launch); direction.y = 0; direction.normalize();
    destination.copy(aim).addScaledVector(direction, -2.1);
    destination.y = p.floorZ*6;
    striking = true; strikeTime = 0;
    strike.disabled = true; release.disabled = false; buttons[0].disabled = true;
    status.textContent = "Striking (scripted animation)...";
  };
  function advanceCapture(dt: number) {
    carryFly(dt);
    if (striking) {
      strikeTime += dt;
      const t = Math.min(1, strikeTime/0.65), u = t*t*(3-2*t);
      mantis.position.lerpVectors(launch, destination, u); armPose(u);
      if (t === 1) {
        striking = false;
        if (!pose() || flyWorld().distanceTo(aim) > 0.55) {
          releaseHold(false); status.textContent = "Missed: fly moved beyond the scripted catch zone.";
          return;
        }
        held = new Float64Array(readPose().slice(0,7));
        beginCarry();
        aim.copy(flyWorld()); armPose(1); pinBody();
        p.mujoco.mj_forward(p.model, p.data);
        status.textContent = "HELD - folding forelegs and raising fly (scripted).";
      }
    }
  }
  function removeCapture() {
    held = null; striking = false;
    if (p.step === stepWithHold) p.step = oldStep;
    if (p.reset === resetWithRelease) p.reset = oldReset;
  }


  // MANTIS_EATING_V1:
  // MANTIS_EATING_VISUAL_V3: bite-step movement + synchronized jaws. mesh clipping plus an experimental whole-brain head-loss switch.
  const eatingPanel = document.createElement("section");
  eatingPanel.style.cssText = panel.style.cssText;
  eatingPanel.innerHTML = `<h2 style="margin:0 0 8px;font-size:12px;color:#bacd9b">MANTIS - EATING</h2>
    <div style="display:flex;gap:6px"><button class="stim-btn" type="button">Begin eating</button>
    <button class="stim-btn" type="button">Reset eating</button></div>
    <progress max="100" value="0" style="width:100%;margin-top:8px"></progress>
    <p style="font-size:11px;color:#bacd9b">Catch the fly and finish the lift first.</p>
    <small style="color:#8a958c">Experimental all-or-none head-loss rule. No gradual damage or pain model.</small>`;
  panel.after(eatingPanel);
  const eatButton = eatingPanel.querySelectorAll("button")[0];
  const rewindButton = eatingPanel.querySelectorAll("button")[1];
  const eatStatus = eatingPanel.querySelector("p")!;
  const progress = eatingPanel.querySelector("progress")!;
  const headStatus = document.createElement("p");
  headStatus.style.cssText = "font-size:12px;color:#bacd9b";
  eatingPanel.appendChild(headStatus);
  let headBack = Infinity, headLost = false;
  function setHeadLoss(value: boolean) {
    headLost = value;
    window.dispatchEvent(new CustomEvent("mantis-head-loss", {detail:value}));
    headStatus.textContent = value
      ? "Brain: DISABLED by experimental head-loss rule."
      : "Brain: enabled. Head-loss rule waiting.";
  }
  setHeadLoss(false);
  type SavedMesh = { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[];
    visible: boolean; copies: THREE.Material[] };
  let savedMeshes: SavedMesh[] = [], eating = false, eatTime = 0;
  let eatingPose: Float64Array | null = null, clippingBefore = false;
  let front = 0, back = 0, mouthLevel = 0;
  const cut = new THREE.Plane(), feedAxis = new THREE.Vector3(), feedOrigin = new THREE.Vector3();
  const mouth = new THREE.Vector3(), vertex = new THREE.Vector3();
  const jaws = [-1,1].map(s => {
    const jaw = new THREE.Group(); jaw.position.set(0.94,0.9,s*0.085); mantis.add(jaw);
    limb([0,0,0],[0.08,-0.04,s*0.07],0.025,jaw);
    limb([0.08,-0.04,s*0.07],[0.16,-0.05,-s*0.05],0.018,jaw);
    jaw.traverse(o => o.layers.set(1)); return jaw;
  });
  function clearEating() {
    setHeadLoss(false); headBack = Infinity;
    eating = false; eatTime = 0;
    const hadMeshes = savedMeshes.length > 0;
    for (const s of savedMeshes) {
      s.mesh.material = s.material; s.mesh.visible = s.visible;
      s.copies.forEach(m => m.dispose());
    }
    savedMeshes = [];
    if (hadMeshes) room.renderer.localClippingEnabled = clippingBefore;
    if (eatingPose && held) {
      held.set(eatingPose); pinBody(); p.mujoco.mj_forward(p.model,p.data);
      aim.copy(flyWorld()); armPose(1);
    }
    eatingPose = null; jaws.forEach(j => {
      j.rotation.y = 0;
      j.rotation.z = 0;
    });
    progress.value = 0; eatButton.disabled = false; eatButton.textContent = "Begin eating";
    release.disabled = !held;
    eatStatus.textContent = "Ready. Catch and lift the fly, then Begin eating.";
  }
  rewindButton.onclick = clearEating;
  eatButton.onclick = () => {
    if (eatingPose) {
      eating = !eating; eatButton.textContent = eating ? "Pause eating" : "Resume eating";
      eatStatus.textContent = eating ? "Eating (visual only)." : "Eating paused. Brain control is separate.";
      return;
    }
    if (!held || striking || carryTime < 2) {
      eatStatus.textContent = "Use Strike & hold and wait for the lift to finish first."; return;
    }
    try {
      const rootId = p.mujoco.mj_name2id(p.model,p.mujoco.mjtObj.mjOBJ_BODY.value,"thorax");
      const parents = p.model.body_parentid as Int32Array;
      if (rootId < 1 || !parents?.length) throw new Error("Fly body lookup unavailable.");
      const meshes: THREE.Mesh[] = [];
      room.scene.traverse(o => {
        const match = /^body_(\d+)$/.exec(o.name); if (!match) return;
        let id = Number(match[1]);
        for (let n=0; n<parents.length && id>0; n++) {
          if (id === rootId) { o.traverse(child => { if (child instanceof THREE.Mesh) meshes.push(child); }); break; }
          id = parents[id];
        }
      });
      if (!meshes.length) throw new Error("No fly meshes found.");
      eatingPose = held.slice();
      feedOrigin.copy(flyWorld());

      room.scene.updateMatrixWorld(true);
      mouth.set(1.03,0.86,0);
      mantis.localToWorld(mouth);

      // Pull the prey toward the actual mouth position.
      feedAxis.copy(mouth).sub(feedOrigin);
      if (feedAxis.lengthSq() < 0.000001) {
        throw new Error("Mouth direction unavailable.");
      }
      feedAxis.normalize();

      mouthLevel = feedAxis.dot(mouth); front = -Infinity; back = Infinity;
      for (const mesh of meshes) {
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        const box = mesh.geometry.boundingBox; if (!box || box.isEmpty()) continue;
        for (let i=0; i<8; i++) {
          vertex.set(i&1 ? box.max.x : box.min.x, i&2 ? box.max.y : box.min.y, i&4 ? box.max.z : box.min.z);
          const level = feedAxis.dot(vertex.applyMatrix4(mesh.matrixWorld));
          front = Math.max(front,level); back = Math.min(back,level);
        }
      }
      if (!Number.isFinite(front-back) || front <= back) throw new Error("Invalid fly bounds.");
      front += 0.02; back -= 0.08;
      // Approximate head extent, not positions of individual neurons.
      const headId = p.mujoco.mj_name2id(
        p.model,p.mujoco.mjtObj.mjOBJ_BODY.value,"head");
      const headGroup = room.scene.getObjectByName(`body_${headId}`);
      if (headId < 1 || !headGroup) throw new Error("Head mesh not found.");
      headBack = Infinity;
      headGroup.traverse(o => {
        if (!(o instanceof THREE.Mesh) || !o.visible) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        const box = o.geometry.boundingBox;
        if (!box || box.isEmpty()) return;
        for (let k=0; k<8; k++) {
          vertex.set(k&1 ? box.max.x : box.min.x,
                     k&2 ? box.max.y : box.min.y,
                     k&4 ? box.max.z : box.min.z);
          headBack = Math.min(headBack,
            feedAxis.dot(vertex.applyMatrix4(o.matrixWorld)));
        }
      });
      if (!Number.isFinite(headBack) || headBack <= back || headBack >= front) {
        throw new Error("Head extent could not be matched to eating direction.");
      }
      cut.normal.copy(feedAxis).negate(); cut.constant = front;
      clippingBefore = room.renderer.localClippingEnabled;
      for (const mesh of meshes) {
        const old = mesh.material;
        const record: SavedMesh = {mesh, material:old, visible:mesh.visible, copies:[]};
        savedMeshes.push(record);
        for (const m of (Array.isArray(old) ? old : [old])) {
          const copy = m.clone(); record.copies.push(copy);
          copy.clippingPlanes = [cut]; copy.clipShadows = true; copy.needsUpdate = true;
        }
        mesh.material = Array.isArray(old) ? record.copies : record.copies[0];
      }
      room.renderer.localClippingEnabled = true;
      eating = true; eatTime = 0; release.disabled = true;
      eatButton.textContent = "Pause eating";
      eatStatus.textContent = "Moving to mouth, then 24 visual bites.";
    } catch (error) {
      clearEating(); eatStatus.textContent = "Eating setup stopped: " + String(error);
    }
  };
  function advanceEating(dt: number) {
    if (!eating || !held || !eatingPose) return;
    eatTime = Math.min(38,eatTime+dt);
    const settle = Math.min(1,eatTime/2), smooth = settle*settle*(3-2*settle);
    const biteClock = Math.max(0,eatTime-2)/1.5;
    const wholeBites = Math.floor(biteClock);
    const bitePhase = biteClock-wholeBites;

    // Each bite pulls quickly, then pauses before the next bite.
    const pullPhase = Math.min(1,bitePhase/0.30);
    const pullEase = pullPhase*pullPhase*(3-2*pullPhase);

    const bites = Math.min(24,wholeBites+pullEase);
    const amount = (front-back)*bites/24;
    if (!headLost && front-amount < headBack) setHeadLoss(true);
    const shift = (mouthLevel-front)*smooth + amount;
    vertex.copy(feedOrigin).addScaledVector(feedAxis,shift);
    held[0]=vertex.x/6; held[1]=-vertex.z/6; held[2]=vertex.y/6;
    pinBody(); p.mujoco.mj_forward(p.model,p.data);
    cut.constant = front+(mouthLevel-front)*smooth;
    // Keep the approved foreleg pose; feed the fly through the grip.
    // Close once during the beginning of each bite, then reopen.
    let jawClose = 0;
    if (bitePhase < 0.18) {
      jawClose = bitePhase/0.18;
    } else if (bitePhase < 0.42) {
      jawClose = 1-(bitePhase-0.18)/0.24;
    }

    jawClose = Math.max(0,Math.min(1,jawClose));

    jaws.forEach((j,i) => {
      const side = i===0 ? -1 : 1;
      j.rotation.y = side*(0.06+0.20*jawClose);
      j.rotation.z = side*(0.05*jawClose);
    });

    progress.value = Math.round(bites/24*100);
    eatStatus.textContent = `Visual eating: ${progress.value}% | ${eatTime.toFixed(1)} s. Head-loss rule enabled.`;
    if (eatTime >= 38) {
      eating=false; savedMeshes.forEach(s => { s.mesh.visible=false; });
      jaws.forEach(j => { j.rotation.y=0; });
      eatButton.disabled=true; eatButton.textContent="Sequence finished"; progress.value=100;
      eatStatus.textContent="Visual sequence finished. Reset eating restores the fly. Head-loss switch active. Disconnect brain before Reset eating.";
    }
  }

  function tick(now: number) {
    if (!alive) return;
    raf = requestAnimationFrame(tick);
    const dt = Math.max(0, Math.min(0.05, (now-last)/1000)); last = now;
    if (document.hidden) return;
    elapsed += dt;
    if (moving && pose()) {
      direction.copy(fly).sub(mantis.position); direction.y = 0;
      const distance = direction.length();
      if (distance <= 3.51) {
        moving = false; buttons[0].textContent = "Approach";
        status.textContent = "In position. Click Strike & hold.";
      } else mantis.position.addScaledVector(direction.normalize(), Math.min(distance-3.5,dt*0.55));
      face();
    }
    advanceCapture(dt);
    advanceEating(dt);
    legs.forEach((leg,i) => { leg.rotation.y = moving ? Math.sin(elapsed*7+i*Math.PI)*0.09 : 0; });
  }
  function dispose() {
    if (!alive) return;
    clearEating(); eatingPanel.remove();
    removeCapture();
    alive = false; cancelAnimationFrame(raf); mantis.removeFromParent(); panel.remove();
    [sphere,cylinder,head,toothGeometry].forEach(g => g.dispose()); [green,dark].forEach(m => m.dispose());
    if (!(oldLayers & 2)) room.camera.layers.disable(1);
    window.removeEventListener("pagehide", onHide);
    if (window.__mantisStage1 === dispose) delete window.__mantisStage1;
  }
  function onHide(event: PageTransitionEvent) { if (!event.persisted) dispose(); }
  window.__mantisStage1 = dispose; window.addEventListener("pagehide", onHide);
  reset(); raf = requestAnimationFrame(tick);
}
