/**
 * camera.js —— 轨道相机（Orbit Camera）
 *
 * 支持万级场景的缩放：距离范围、近远裁剪面、注视点高度均可由外部按场景尺度配置。
 */

import { mat4, vec3 } from 'gl-matrix';

export class OrbitCamera {
  /**
   * @param {number} aspect
   * @param {object} [opts]
   *   distance / minDistance / maxDistance / near / far / fov / targetY
   */
  constructor(aspect, opts = {}) {
    this.fov = opts.fov ?? 50;
    this.near = opts.near ?? 0.5;
    this.far = opts.far ?? 2400;
    this.minDistance = opts.minDistance ?? 2;
    this.maxDistance = opts.maxDistance ?? 600;

    this.target = vec3.fromValues(0, opts.targetY ?? 3, 0);
    this.distance = opts.distance ?? 22;
    this.theta = Math.PI * 0.25;
    this.phi = Math.PI * 0.4;

    // 平滑过渡目标（用于聚焦节点时的动画）
    this.tween = null;

    this.viewProj = mat4.create();
    this.view = mat4.create();
    this.proj = mat4.create();
    this.cameraPos = vec3.create();
    this.cameraRight = vec3.create();
    this.cameraUp = vec3.create();

    this.updateMatrices(aspect);
  }

  /** 重新计算 view / proj / viewProj 以及相机基向量 */
  updateMatrices(aspect) {
    const sinPhi = Math.sin(this.phi);
    const cosPhi = Math.cos(this.phi);
    const sinTheta = Math.sin(this.theta);
    const cosTheta = Math.cos(this.theta);

    const offset = vec3.fromValues(
      this.distance * sinPhi * cosTheta,
      this.distance * cosPhi,
      this.distance * sinPhi * sinTheta
    );
    vec3.add(this.cameraPos, this.target, offset);

    mat4.lookAt(this.view, this.cameraPos, this.target, [0, 1, 0]);
    // WebGPU 的裁剪空间深度为 [0, 1]，必须用 perspectiveZO（GL 默认是 [-1, 1]，
    // 直接使用会把深度精度压缩到后半段，万级场景下更容易出现深度冲突）
    mat4.perspectiveZO(this.proj, (this.fov * Math.PI) / 180, aspect, this.near, this.far);
    mat4.multiply(this.viewProj, this.proj, this.view);

    const forward = vec3.create();
    vec3.subtract(forward, this.target, this.cameraPos);
    vec3.normalize(forward, forward);
    const worldUp = vec3.fromValues(0, 1, 0);
    vec3.cross(this.cameraRight, forward, worldUp);
    vec3.normalize(this.cameraRight, this.cameraRight);
    vec3.cross(this.cameraUp, this.cameraRight, forward);
    vec3.normalize(this.cameraUp, this.cameraUp);
  }

  /** 水平/垂直旋转（弧度增量） */
  rotate(dTheta, dPhi) {
    this.theta -= dTheta;
    this.phi -= dPhi;
    this.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.phi));
  }

  /** 平移 target（屏幕空间 -> 世界空间，近似按距离缩放） */
  pan(dx, dy) {
    const right = vec3.clone(this.cameraRight);
    const up = vec3.clone(this.cameraUp);
    const factor = this.distance * 0.0015;
    vec3.scale(right, right, -dx * factor);
    vec3.scale(up, up, dy * factor);
    vec3.add(this.target, this.target, right);
    vec3.add(this.target, this.target, up);
  }

  /** 缩放（修改 distance） */
  zoom(delta) {
    this.distance += delta * 0.01 * Math.max(1, this.distance * 0.02);
    this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance));
  }

  /**
   * 平滑过渡到目标观察点
   * @param {number[]} targetPos
   * @param {number} [distance]
   */
  tweenTo(targetPos, distance) {
    this.tween = {
      fromTarget: vec3.clone(this.target),
      toTarget: vec3.fromValues(targetPos[0], targetPos[1], targetPos[2]),
      fromDist: this.distance,
      toDist: distance ?? Math.max(this.minDistance * 4, this.distance * 0.5),
      t: 0,
      duration: 800,
    };
  }

  /** 每帧推进 tween（dt 毫秒） */
  stepTween(dt) {
    if (!this.tween) return;
    this.tween.t += dt;
    const k = Math.min(1, this.tween.t / this.tween.duration);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    vec3.lerp(this.target, this.tween.fromTarget, this.tween.toTarget, e);
    this.distance = this.tween.fromDist + (this.tween.toDist - this.tween.fromDist) * e;
    if (k >= 1) this.tween = null;
  }
}
