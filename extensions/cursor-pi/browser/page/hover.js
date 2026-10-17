// Internal hover helper. No browser tool exposes it; it stays here for the page-side tests and for later use.

async function hoverAction(a) {
  var element = findByRef(a.ref).element;
  if (!element) return { success: false, error: "Element not found: " + a.ref + ". Take a snapshot to get updated refs." };
  try {
    validateForInteraction(element, a.ref, "hover", a.expectedDescription);
  } catch (e) {
    return { success: false, error: e.message };
  }
  var scroll = await ensureInView(element, 3);
  if (!scroll.success) return { success: false, error: "Could not scroll element into view." };
  var rect = element.getBoundingClientRect();
  var x = Math.round(rect.left + rect.width / 2);
  var y = Math.round(rect.top + rect.height / 2);
  var hit = expectHit({ x: x, y: y }, element);
  if (!hit.hit) return { success: false, hitTargetFailed: true, error: hit.error || "Hover would not reach the intended element.", suggestion: hit.suggestion };
  var init = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, pointerId: 1, pointerType: "mouse", isPrimary: true };
  element.dispatchEvent(new PointerEvent("pointerover", init));
  element.dispatchEvent(new PointerEvent("pointerenter", Object.assign({}, init, { bubbles: false })));
  element.dispatchEvent(new MouseEvent("mouseover", init));
  element.dispatchEvent(new MouseEvent("mouseenter", Object.assign({}, init, { bubbles: false })));
  element.dispatchEvent(new PointerEvent("pointermove", init));
  element.dispatchEvent(new MouseEvent("mousemove", init));
  var waited = 0;
  var found = false;
  var started = Date.now();
  while (waited < (a.maxWaitMs || 3000)) {
    if (a.waitForSelector && document.querySelector(a.waitForSelector)) {
      found = true;
      break;
    }
    if (a.waitForText && (document.body.innerText || "").indexOf(a.waitForText) >= 0) {
      found = true;
      break;
    }
    if (!a.waitForSelector && !a.waitForText) break;
    await sleep(a.pollIntervalMs || 200);
    waited = Date.now() - started;
  }
  if (!a.waitForSelector && !a.waitForText) found = true;
  return { success: true, waitedMs: waited, foundTarget: found, pageState: pageState() };
}
