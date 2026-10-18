/**
 * interaction.js —— 鼠标 / 键盘交互
 *
 * 绑定：
 *   - 左键拖拽 → 轨道旋转
 *   - 右键拖拽 → 平移
 *   - 滚轮 → 缩放
 *   - 鼠标移动 → CPU 射线拾取（按帧节流）
 *   - 单击 → 选中节点
 *   - 键盘 1/2/3 → 切换层级视图
 *
 * 顶栏按钮不再直接查 DOM，而是由 Vue 组件调用 globalView / focusFault / togglePause。
 */

import { pickNode } from './picking.js';

export class Interaction {
  /**
   * @param {object} opts
   *   canvas, camera, scene, nodes, sceneScale, homeDistance, targetY,
   *   onSelect(node|null), onHover(node|null), onPauseToggle(paused)
   */
  constructor(opts) {
    Object.assign(this, opts);
    this.paused = false;
    this.dragging = false;
    this.panning = false;
    this.downOnCanvas = false;
    this.lastX = 0;
    this.lastY = 0;
    this.moved = false;
    this.lastHoverAt = 0;
    this._bindEvents();
  }

  _bindEvents() {
    const c = this.canvas;

    c.addEventListener('mousedown', (e) => this._onDown(e));
    window.addEventListener('mouseup', (e) => this._onUp(e));
    window.addEventListener('mousemove', (e) => this._onMove(e));
    c.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this._onKey(e));
  }

  _onDown(e) {
    this.downOnCanvas = true;
    if (e.button === 0) this.dragging = true;
    if (e.button === 2) this.panning = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.moved = false;
  }

  _onUp(e) {
    const wasDrag = this.moved;
    const downOnCanvas = this.downOnCanvas;
    this.dragging = false;
    this.panning = false;
    this.downOnCanvas = false;
    if (e.button === 0 && !wasDrag && downOnCanvas) {
      this._handleClick(e);
    }
  }

  _onMove(e) {
    if (this.dragging) {
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.camera.rotate(dx * 0.005, dy * 0.005);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.moved = true;
    } else if (this.panning) {
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.camera.pan(dx, dy);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.moved = true;
    } else {
      // hover 拾取：CPU 射线，约每 16ms 一次（足够跟手，且不阻塞渲染）
      const now = performance.now();
      if (now - this.lastHoverAt < 16) return;
      this.lastHoverAt = now;
      this._handleHover(e);
    }
  }

  _onWheel(e) {
    e.preventDefault();
    this.camera.zoom(e.deltaY);
  }

  _onKey(e) {
    if (e.key === '1') this.globalViewLayer(1);
    if (e.key === '2') this.globalViewLayer(2);
    if (e.key === '3') this.globalViewLayer(3);
  }

  /** 鼠标坐标转 canvas 像素坐标 */
  _getPixel(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) * (this.canvas.width / rect.width));
    const y = Math.floor((e.clientY - rect.top) * (this.canvas.height / rect.height));
    return { x, y };
  }

  _handleClick(e) {
    const { x, y } = this._getPixel(e);
    const idx = pickNode(this.camera, this.nodes, x, y, this.canvas.width, this.canvas.height);
    const node = idx >= 0 ? this.nodes[idx] : null;
    this.scene.setSelected(idx);
    this.onSelect?.(node, idx);
    if (node) this.camera.tweenTo(node.position);
  }

  _handleHover(e) {
    const { x, y } = this._getPixel(e);
    const idx = pickNode(this.camera, this.nodes, x, y, this.canvas.width, this.canvas.height);
    const node = idx >= 0 ? this.nodes[idx] : null;
    this.scene.setHovered(idx);
    this.onHover?.(node, e.clientX, e.clientY);
  }

  /** 全局视图：重置相机（供 Vue 顶栏按钮调用） */
  globalView() {
    this.camera.target[0] = 0;
    this.camera.target[1] = this.targetY;
    this.camera.target[2] = 0;
    this.camera.distance = this.homeDistance;
    this.camera.theta = Math.PI * 0.25;
    this.camera.phi = Math.PI * 0.4;
    this.camera.tween = null;
    this.scene.setSelected(-1);
    this.onSelect?.(null, -1);
  }

  /** 聚焦到首个故障节点（供 Vue 顶栏按钮调用） */
  focusFault() {
    const fault = this.nodes.find((n) => n.status === 2);
    if (fault) {
      const idx = this.nodes.indexOf(fault);
      this.scene.setSelected(idx);
      this.camera.tweenTo(fault.position);
      this.onSelect?.(fault, idx);
    }
  }

  /** 切换暂停（供 Vue 顶栏按钮调用），返回切换后的暂停状态 */
  togglePause() {
    this.paused = !this.paused;
    this.onPauseToggle?.(this.paused);
    return this.paused;
  }

  /** 切换层级视图：把相机 target 移到该层所有节点的中心 */
  globalViewLayer(layer) {
    const layerNodes = this.nodes.filter((n) => n.layer === layer);
    if (layerNodes.length === 0) return;
    let cx = 0, cy = 0, cz = 0;
    for (const n of layerNodes) {
      cx += n.position[0];
      cy += n.position[1];
      cz += n.position[2];
    }
    const inv = 1 / layerNodes.length;
    const k = this.sceneScale;
    const distance = (layer === 1 ? 14 : layer === 2 ? 20 : 26) * k;
    this.camera.tweenTo([cx * inv, cy * inv, cz * inv], distance);
  }
}
