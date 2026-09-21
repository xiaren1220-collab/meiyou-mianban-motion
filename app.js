export const clamp = (value, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));

export function geometry(progress) {
  const p = clamp(progress);
  return {
    panelTop: 602 - 184 * p,
    panelHeight: 181 + 184 * p,
    contentOffset: -462 - 184 * p,
  };
}

export function targetContentOffset(
  panelTop,
  latestBottom,
  currentOffset,
  gap = 20,
) {
  return currentOffset + (panelTop - gap - latestBottom);
}

export function targetScrollTop(
  viewportTop,
  contentHeight,
  panelTop,
  gap = 20,
) {
  return Math.max(0, viewportTop + contentHeight - (panelTop - gap));
}

export function requiredScrollPadding(
  viewportTop,
  contentHeight,
  viewportHeight,
  panelTop,
  gap = 20,
) {
  const target = targetScrollTop(
    viewportTop,
    contentHeight,
    panelTop,
    gap,
  );
  const nativeMaximum = Math.max(0, contentHeight - viewportHeight);
  return Math.max(0, target - nativeMaximum);
}

export function settleTarget(progress, velocity, direction) {
  if (direction === "collapse") {
    if (velocity > 0.55) return 0;
    return progress <= 0.75 ? 0 : 1;
  }
  if (velocity < -0.55) return 1;
  return progress >= 0.25 ? 1 : 0;
}

export function dragProgress(startProgress, logicalDeltaY) {
  return clamp(startProgress - logicalDeltaY / 184);
}

export function dragScrollTop(startScroll, deltaY, maximum) {
  return clamp(startScroll - deltaY, 0, maximum);
}

function initDemo() {
  const app = document.querySelector("#app");
  const stage = document.querySelector("#stage");
  const panelHandle = document.querySelector("#panelHandle");
  const toolPanel = document.querySelector("#toolPanel");
  const contentBlocker = document.querySelector("#contentBlocker");
  const recordViewport = document.querySelector("#recordViewport");
  const recordContent = document.querySelector("#recordContent");
  const recordTail = document.querySelector("#recordTail");

  let progress = 0;
  let state = "collapsed";
  let animationFrame = 0;
  let dragFrame = 0;
  let drag = null;
  let contentScrollDrag = null;
  let contentMotion = null;

  function updateScale() {
    const availableWidth = window.innerWidth;
    const availableHeight = window.innerHeight;
    const scale = Math.min(1, availableWidth / 402, availableHeight / 874);
    stage.style.setProperty("--app-scale", String(scale));
  }

  function contentTarget(panelTop) {
    const contentHeight = recordContent.offsetHeight || 1044;
    const tailSpace = requiredScrollPadding(
      106,
      contentHeight,
      783 - 106,
      panelTop,
      20,
    );
    recordTail.style.height = `${tailSpace}px`;
    return targetScrollTop(106, contentHeight, panelTop, 20);
  }

  function render(nextProgress) {
    progress = clamp(nextProgress);
    const { panelTop } = geometry(progress);
    app.style.setProperty("--progress", progress.toFixed(6));
    if (contentMotion) {
      const span = contentMotion.targetProgress - contentMotion.startProgress;
      const ratio = span === 0
        ? 1
        : clamp((progress - contentMotion.startProgress) / span);
      recordViewport.scrollTop =
        contentMotion.startScroll +
        (contentMotion.targetScroll - contentMotion.startScroll) * ratio;
    } else {
      recordViewport.scrollTop = contentTarget(panelTop);
    }
  }

  function prepareContentMotion(targetProgress) {
    const targetPanelTop = geometry(targetProgress).panelTop;
    contentMotion = {
      startProgress: progress,
      targetProgress,
      startScroll: recordViewport.scrollTop,
      targetScroll: contentTarget(targetPanelTop),
    };
  }

  function animateTo(target, duration) {
    cancelAnimationFrame(animationFrame);
    prepareContentMotion(target);
    const from = progress;
    const distance = target - from;
    const startedAt = performance.now();
    state = target === 1 ? "expanding" : "collapsing";
    app.dataset.mode = state;

    const tick = (now) => {
      const elapsed = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - elapsed, 3);
      render(from + distance * eased);
      if (elapsed < 1) {
        animationFrame = requestAnimationFrame(tick);
        return;
      }
      progress = target;
      state = target === 1 ? "expanded" : "collapsed";
      app.dataset.mode = state;
      panelHandle.setAttribute(
        "aria-label",
        target === 1 ? "收起工具面板" : "展开工具面板",
      );
      render(target);
      contentMotion = null;
    };

    animationFrame = requestAnimationFrame(tick);
  }

  function appScale() {
    return app.getBoundingClientRect().width / 402 || 1;
  }

  function beginDrag(event, source) {
    if (event.button !== undefined && event.button !== 0) return;
    if (source === "content" && progress < 0.98) return;

    cancelAnimationFrame(animationFrame);
    cancelAnimationFrame(dragFrame);
    prepareContentMotion(source === "content" || progress >= 0.5 ? 0 : 1);
    const scale = appScale();
    drag = {
      pointerId: event.pointerId,
      source,
      startY: event.clientY,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      velocity: 0,
      moved: false,
      startProgress: progress,
      scale,
      nextProgress: progress,
    };
    state = source === "content" ? "dragging-content" : "dragging-panel";
    app.dataset.mode = state;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function moveDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const logicalDelta = (event.clientY - drag.startY) / drag.scale;
    const stepTime = Math.max(1, event.timeStamp - drag.lastTime);
    drag.velocity = ((event.clientY - drag.lastY) / drag.scale) / stepTime;
    drag.lastY = event.clientY;
    drag.lastTime = event.timeStamp;
    drag.moved ||= Math.abs(logicalDelta) >= 6;
    drag.nextProgress = dragProgress(drag.startProgress, logicalDelta);
    cancelAnimationFrame(dragFrame);
    dragFrame = requestAnimationFrame(() => {
      if (drag) render(drag.nextProgress);
    });
    event.preventDefault();
  }

  function endDrag(event, cancelled = false) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    cancelAnimationFrame(dragFrame);
    render(drag.nextProgress);
    event.currentTarget.releasePointerCapture?.(event.pointerId);

    const completedDrag = drag;
    drag = null;
    event.preventDefault();
    event.stopPropagation();

    if (!completedDrag.moved && !cancelled) {
      if (completedDrag.source === "content") {
        animateTo(0, 280);
      } else if (completedDrag.startProgress < 0.5) {
        animateTo(1, 330);
      } else {
        animateTo(1, 180);
      }
      return;
    }

    const direction = completedDrag.source === "content"
      ? "collapse"
      : completedDrag.lastY < completedDrag.startY
        ? "expand"
        : "collapse";
    const target = settleTarget(progress, completedDrag.velocity, direction);
    animateTo(target, target === 1 ? 330 : 280);
  }

  function bindDragSurface(element, source) {
    element.addEventListener("pointerdown", (event) => beginDrag(event, source));
    element.addEventListener("pointermove", moveDrag);
    element.addEventListener("pointerup", (event) => endDrag(event));
    element.addEventListener("pointercancel", (event) => endDrag(event, true));
  }

  bindDragSurface(toolPanel, "panel");
  bindDragSurface(contentBlocker, "content");

  recordViewport.addEventListener("pointerdown", (event) => {
    if (state !== "collapsed" || event.pointerType !== "mouse" || event.button !== 0) return;
    contentScrollDrag = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startScroll: recordViewport.scrollTop,
    };
    recordViewport.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });

  recordViewport.addEventListener("pointermove", (event) => {
    if (!contentScrollDrag || event.pointerId !== contentScrollDrag.pointerId) return;
    const deltaY = (event.clientY - contentScrollDrag.startY) / appScale();
    const maximum = recordViewport.scrollHeight - recordViewport.clientHeight;
    recordViewport.scrollTop = dragScrollTop(
      contentScrollDrag.startScroll,
      deltaY,
      maximum,
    );
    event.preventDefault();
  });

  const endContentScroll = (event) => {
    if (!contentScrollDrag || event.pointerId !== contentScrollDrag.pointerId) return;
    recordViewport.releasePointerCapture?.(event.pointerId);
    contentScrollDrag = null;
    event.preventDefault();
  };

  recordViewport.addEventListener("pointerup", endContentScroll);
  recordViewport.addEventListener("pointercancel", endContentScroll);

  contentBlocker.addEventListener(
    "wheel",
    (event) => {
      if (progress > 0.98) event.preventDefault();
    },
    { passive: false },
  );

  window.addEventListener("resize", () => {
    updateScale();
    contentMotion = null;
    render(progress);
  });

  updateScale();
  app.dataset.mode = state;
  Promise.allSettled([
    recordContent.decode?.(),
    document.fonts?.ready,
  ]).then(() => render(progress));

  window.toolPanelDemo = {
    get progress() {
      return progress;
    },
    get state() {
      return state;
    },
    animateTo,
    render,
  };
}

if (typeof document !== "undefined") initDemo();
