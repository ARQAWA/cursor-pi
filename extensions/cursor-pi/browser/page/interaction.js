// Page-side actions. Each returns plain data, and the node side turns it into text and sends the trusted input events.
// Helpers used by hover.js (validateForInteraction, ensureInView, expectHit, sleep, pageState) are defined here too.

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

function pageState() {
  return { url: location.href, title: document.title };
}

function describeElement(el) {
  var tag = el.tagName ? el.tagName.toLowerCase() : "element";
  var role = attrOf(el, "role") || implicitRole(el) || tag;
  var name = accessibleName(el, role);
  return name ? role + ' "' + name + '"' : role;
}

function isEditable(el) {
  if (el.isContentEditable) return true;
  var tag = el.tagName.toLowerCase();
  if (tag === "textarea") return true;
  if (tag !== "input") return false;
  var type = (attrOf(el, "type") || "text").toLowerCase();
  return ["text", "search", "email", "url", "tel", "password", "number", ""].indexOf(type) >= 0;
}

// Throws the message the model sees when the element cannot take this action.
function validateForInteraction(el, ref, action) {
  if (!el || !el.isConnected) throw new Error("Element not found: " + ref + ". Take a snapshot to get updated refs.");
  if (hiddenForAria(el) || el.getClientRects().length === 0) throw new Error("Element is not visible: " + describeElement(el));
  if (action !== "hover" && ((el.matches && el.matches(":disabled")) || el.disabled)) {
    throw new Error("Element is disabled: " + describeElement(el));
  }
  if (action === "type" || action === "fill") {
    if (!isEditable(el)) throw new Error("Element is not a text input: " + describeElement(el));
    if (el.readOnly) throw new Error("Element is read-only: " + describeElement(el));
  }
  if (action === "select" && el.tagName !== "SELECT") throw new Error("Element is not a select element: " + describeElement(el));
}

function centerOf(el) {
  var r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}

function inViewport(point) {
  return point.x >= 0 && point.y >= 0 && point.x <= innerWidth && point.y <= innerHeight;
}

// Scrolls the element's center into the viewport, at most attempts times.
async function ensureInView(el, attempts) {
  var tries = 0;
  while (!inViewport(centerOf(el)) && tries < attempts) {
    el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    tries++;
    await sleep(50);
  }
  return { success: inViewport(centerOf(el)), attempts: tries };
}

// Checks that a click at point would reach el or one of its descendants.
function expectHit(point, el) {
  var hit = deepElementFromPoint(document, point.x, point.y);
  if (!hit) {
    return { hit: false, error: "Click target is outside the viewport.", suggestion: "Scroll the element into view and take a new snapshot." };
  }
  if (composedContains(el, hit)) return { hit: true };
  return {
    hit: false,
    error: "Click target intercepted by " + describeElement(hit) + ".",
    suggestion: "Close the element covering the target, or take a new snapshot and use a different ref.",
  };
}

async function clickAction(a) {
  var el = findByRef(a.ref).element;
  try {
    validateForInteraction(el, a.ref, "click");
  } catch (e) {
    return { success: false, error: e.message };
  }
  var scroll = await ensureInView(el, 5);
  if (!scroll.success) {
    return {
      success: false,
      error: "Element could not be scrolled into view: " + describeElement(el) + ".",
      suggestion: "Scroll the page toward the element, or take a new snapshot.",
      scrollAttempts: scroll.attempts,
    };
  }
  var c = centerOf(el);
  var point = { x: c.x + (a.offsetX || 0), y: c.y + (a.offsetY || 0) };
  var hit = expectHit(point, el);
  if (!hit.hit) return { success: false, error: hit.error, suggestion: hit.suggestion, scrollAttempts: scroll.attempts };
  return { success: true, x: point.x, y: point.y, scrollAttempts: scroll.attempts, element: describeElement(el) };
}

// Writes a value the way typing does: the native setter, then input and change events.
function setValue(el, value) {
  if (el.isContentEditable) {
    el.textContent = value;
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    return;
  }
  var proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function currentValue(el) {
  return el.isContentEditable ? el.textContent : el.value;
}

async function typeAction(a) {
  var el = findByRef(a.ref).element;
  try {
    validateForInteraction(el, a.ref, "type");
  } catch (e) {
    return { success: false, error: e.message };
  }
  var scroll = await ensureInView(el, 5);
  el.focus();
  var before = currentValue(el) || "";
  var base = a.clear ? "" : before;
  if (a.clear) setValue(el, "");
  // Slow mode leaves the text to the node side, which sends one character at a time.
  if (!a.slowly) setValue(el, base + a.text);
  return { success: true, before: before, expected: base + a.text, cleared: a.clear === true, scrollAttempts: scroll.attempts };
}

function valueAction(a) {
  var el = findByRef(a.ref).element;
  return { value: el ? currentValue(el) || "" : "" };
}

async function fillAction(a) {
  var el = findByRef(a.ref).element;
  try {
    validateForInteraction(el, a.ref, "fill");
  } catch (e) {
    return { success: false, error: e.message };
  }
  await ensureInView(el, 5);
  el.focus();
  setValue(el, a.value);
  return { success: true, value: currentValue(el) || "" };
}

function selectAction(a) {
  var el = findByRef(a.ref).element;
  try {
    validateForInteraction(el, a.ref, "select");
  } catch (e) {
    return { success: false, error: e.message };
  }
  var options = Array.from(el.options);
  var labelOf = function (o) {
    return (o.textContent || "").trim();
  };
  var available = options.map(function (o) {
    return labelOf(o) + " (value: " + o.value + ")";
  }).join(", ");
  if (!el.multiple && a.values.length > 1) {
    return { success: false, error: "Select element accepts a single value, but " + a.values.length + " were given." };
  }
  var chosen = [];
  for (var i = 0; i < a.values.length; i++) {
    var wanted = a.values[i];
    var how = "value";
    var option = options.find(function (o) {
      return o.value === wanted;
    });
    if (!option) {
      how = "label";
      option = options.find(function (o) {
        return labelOf(o) === wanted;
      });
    }
    if (!option) {
      how = "partial label";
      var lower = wanted.toLowerCase();
      option = options.find(function (o) {
        return labelOf(o).toLowerCase().indexOf(lower) >= 0;
      });
    }
    if (!option) {
      return {
        success: false,
        error: 'Option "' + wanted + '" not found in select element' + (el.multiple ? "" : " (single-select)") + ". Available options: " + available,
        suggestion: "Use one of the available option values or labels.",
      };
    }
    chosen.push({ option: option, how: how });
  }
  options.forEach(function (o) {
    o.selected = false;
  });
  chosen.forEach(function (c) {
    c.option.selected = true;
  });
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return {
    success: true,
    multiple: el.multiple,
    selected: chosen.map(function (c) {
      return { value: c.option.value, label: labelOf(c.option), how: c.how };
    }),
  };
}

function nearestScrollable(el) {
  var cur = el;
  while (cur && cur !== document.body && cur !== document.documentElement) {
    var style = getComputedStyle(cur);
    if (/(auto|scroll)/.test(style.overflowY + style.overflowX) && (cur.scrollHeight > cur.clientHeight || cur.scrollWidth > cur.clientWidth)) {
      return cur;
    }
    cur = parentAcrossShadow(cur);
  }
  return window;
}

function scrollPosition(target) {
  return target === window ? { x: scrollX, y: scrollY } : { x: target.scrollLeft, y: target.scrollTop };
}

function scrollAction(a) {
  var target = window;
  var message = "Scrolled page";
  if (a.ref) {
    var el = findByRef(a.ref).element;
    if (!el) return { success: false, error: "Element not found: " + a.ref + ". Take a snapshot to get updated refs." };
    if (a.scrollIntoView) {
      el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      return { success: true, message: "Scrolled element into view", actual: { dx: 0, dy: 0 }, boundary: false };
    }
    target = nearestScrollable(el);
    if (target !== window) message = "Scrolled element container";
  }
  var dx = a.deltaX;
  var dy = a.deltaY;
  if (dx === undefined && dy === undefined) {
    var amount = a.amount || 300;
    dx = a.direction === "left" ? -amount : a.direction === "right" ? amount : 0;
    dy = a.direction === "up" ? -amount : a.direction === "down" ? amount : 0;
  }
  dx = dx || 0;
  dy = dy || 0;
  var before = scrollPosition(target);
  target.scrollBy({ left: dx, top: dy, behavior: "instant" });
  var after = scrollPosition(target);
  var actual = { dx: after.x - before.x, dy: after.y - before.y };
  return {
    success: true,
    message: message,
    actual: actual,
    boundary: (dx !== 0 && actual.dx === 0) || (dy !== 0 && actual.dy === 0),
  };
}

async function dragAction(a) {
  var src = findByRef(a.sourceRef).element;
  if (!src) return { success: false, error: "Element not found: " + a.sourceRef + ". Take a snapshot to get updated refs." };
  try {
    validateForInteraction(src, a.sourceRef, "click");
  } catch (e) {
    return { success: false, error: e.message };
  }
  var to;
  var toDescription;
  if (a.targetRef) {
    var target = findByRef(a.targetRef).element;
    if (!target) return { success: false, error: "Element not found: " + a.targetRef + ". Take a snapshot to get updated refs." };
    await ensureInView(target, 5);
    to = centerOf(target);
    toDescription = describeElement(target);
  } else if (typeof a.targetX === "number" && typeof a.targetY === "number") {
    to = { x: a.targetX, y: a.targetY };
    toDescription = "(" + a.targetX + ", " + a.targetY + ")";
  } else {
    return {
      success: false,
      error: "Either targetRef or both targetX and targetY must be provided for drag operation.",
      suggestion: "Pass a targetRef from browser_snapshot, or both targetX and targetY.",
    };
  }
  await ensureInView(src, 5);
  var from = centerOf(src);
  var hit = expectHit(from, src);
  if (!hit.hit) return { success: false, error: hit.error, suggestion: hit.suggestion };
  return { success: true, from: from, to: to, sourceDescription: describeElement(src), targetDescription: toDescription };
}

async function boundingBoxAction(a) {
  var el = findByRef(a.ref).element;
  if (!el) return { success: false, error: "Element not found: " + a.ref + ". Take a snapshot to get updated refs." };
  if (a.scroll) await ensureInView(el, 5);
  var r = el.getBoundingClientRect();
  return {
    success: true,
    box: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
    description: describeElement(el),
  };
}

function highlightAction(a) {
  var el = findByRef(a.ref).element;
  if (!el) return { success: false, error: "Element not found: " + a.ref + ". Take a snapshot to get updated refs." };
  var r = el.getBoundingClientRect();
  var duration = a.durationMs || 2000;
  var box = document.createElement("div");
  box.setAttribute("data-cursor-highlight", "1");
  box.style.cssText =
    "position:fixed;pointer-events:none;z-index:2147483647;outline:3px solid #ff3b30;background:rgba(255,59,48,0.12);" +
    "left:" + r.left + "px;top:" + r.top + "px;width:" + r.width + "px;height:" + r.height + "px;";
  document.documentElement.appendChild(box);
  setTimeout(function () {
    box.remove();
  }, duration);
  return { success: true, description: describeElement(el), durationMs: duration };
}
