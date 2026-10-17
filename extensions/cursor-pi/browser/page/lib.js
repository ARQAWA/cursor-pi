// Page-side helpers and the snapshot builder. Every tool call evaluates this file, then one action, inside a single function.
// The builder marks elements with data-cursor-ref and returns a flat tree: interactive elements first, then content.

var REF_ATTR = "data-cursor-ref";
var REF_PATTERN = /^e\d+$/;
var INTERACTIVE_ROLES = ["button", "link", "textbox", "checkbox", "radio", "combobox", "listbox", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "slider", "spinbutton", "switch", "tab", "treeitem", "searchbox"];
var INTERACTIVE_SELECTOR = ["input", "textarea", "select", "button", "a[href]", '[role="button"]', '[role="link"]', '[role="textbox"]', '[role="checkbox"]', '[role="radio"]', '[role="combobox"]', '[role="listbox"]', '[role="menuitem"]', '[role="menuitemcheckbox"]', '[role="menuitemradio"]', '[role="option"]', '[role="slider"]', '[role="spinbutton"]', '[role="switch"]', '[role="tab"]', '[role="treeitem"]', '[role="searchbox"]', '[contenteditable="true"]', "summary", '[tabindex]:not([tabindex="-1"])'].join(", ");
var CONTENT_SELECTOR = ["h1", "h2", "h3", "h4", "h5", "h6", "label", '[role="heading"]', "p", "li", "article", "nav", "main", "header", "footer", "section", '[role="article"]', '[role="region"]', '[role="main"]', '[role="navigation"]', '[role="cell"]', '[role="gridcell"]', '[role="columnheader"]', '[role="rowheader"]', '[role="listitem"]'].join(", ");
var NAMED_BY_TEXT_ROLES = ["button", "link", "menuitem", "option", "tab", "checkbox", "radio", "switch", "combobox", "textbox", "listbox", "slider", "spinbutton", "cell", "gridcell", "row", "columnheader", "rowheader"];
var NAMED_BY_TEXT_TAGS = ["button", "a", "summary", "label", "option", "textarea", "select", "time"];
var HIDDEN_TAGS = ["STYLE", "SCRIPT", "NOSCRIPT", "TEMPLATE"];

function attrOf(el, name) {
  return el && el.getAttribute ? el.getAttribute(name) : null;
}

function parentAcrossShadow(el) {
  if (!el) return null;
  if (el.parentElement) return el.parentElement;
  var root = el.getRootNode ? el.getRootNode() : null;
  if (root && root.host && root.host.nodeType === Node.ELEMENT_NODE) return root.host;
  return null;
}

// Visits every element under root, going into open shadow roots. Stops when visit returns true.
function walkComposed(root, visit) {
  function visitContainer(container) {
    var kids = container && container.children ? Array.from(container.children) : [];
    for (var i = 0; i < kids.length; i++) {
      if (visitElement(kids[i])) return true;
    }
    return false;
  }
  function visitElement(el) {
    if (visit(el)) return true;
    if (el.shadowRoot && el.shadowRoot.mode === "open" && visitContainer(el.shadowRoot)) return true;
    return visitContainer(el);
  }
  return visitContainer(root);
}

function queryAllComposed(selector) {
  var matches = [];
  walkComposed(document, function (el) {
    try {
      if (el.matches && el.matches(selector)) matches.push(el);
    } catch (e) {}
    return false;
  });
  return matches;
}

function findByRef(ref) {
  var found = null;
  walkComposed(document, function (el) {
    if (attrOf(el, REF_ATTR) === ref) {
      found = el;
      return true;
    }
    return false;
  });
  return { element: found };
}

function composedContains(ancestor, node) {
  var cur = node;
  while (cur) {
    if (cur === ancestor) return true;
    cur = parentAcrossShadow(cur);
  }
  return false;
}

function deepElementFromPoint(root, x, y) {
  if (!root || typeof root.elementFromPoint !== "function") return null;
  var el = root.elementFromPoint(x, y);
  while (el && el.shadowRoot && el.shadowRoot.mode === "open" && typeof el.shadowRoot.elementFromPoint === "function") {
    var nested = el.shadowRoot.elementFromPoint(x, y);
    if (!nested || nested === el) break;
    el = nested;
  }
  return el;
}

function implicitRole(el) {
  var tag = el.tagName ? el.tagName.toLowerCase() : "";
  switch (tag) {
    case "a":
    case "area":
      return el.hasAttribute("href") ? "link" : null;
    case "article":
      return "article";
    case "aside":
      return "complementary";
    case "button":
    case "summary":
      return "button";
    case "datalist":
      return "listbox";
    case "details":
      return "group";
    case "dialog":
      return "dialog";
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return "heading";
    case "hr":
      return "separator";
    case "img":
      return el.getAttribute("alt") === "" && !el.getAttribute("title") ? null : "img";
    case "input":
      return inputRole(el);
    case "li":
      return "listitem";
    case "main":
      return "main";
    case "menu":
    case "ol":
    case "ul":
      return "list";
    case "meter":
      return "meter";
    case "nav":
      return "navigation";
    case "optgroup":
      return "group";
    case "option":
      return "option";
    case "output":
      return "status";
    case "progress":
      return "progressbar";
    case "search":
      return "search";
    case "select":
      return el.hasAttribute("multiple") || el.size > 1 ? "listbox" : "combobox";
    case "table":
      return "table";
    case "tbody":
    case "tfoot":
    case "thead":
      return "rowgroup";
    case "td":
      return "cell";
    case "textarea":
      return "textbox";
    case "th":
      return "columnheader";
    case "tr":
      return "row";
    case "section":
      return el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby") ? "region" : null;
    case "form":
      return el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby") ? "form" : null;
    case "header":
      return "banner";
    case "footer":
      return "contentinfo";
    case "svg":
      return "img";
    default:
      return null;
  }
}

function inputRole(el) {
  var type = (el.getAttribute("type") || "text").toLowerCase();
  if (type === "button" || type === "submit" || type === "reset" || type === "image") return "button";
  if (type === "checkbox") return "checkbox";
  if (type === "radio") return "radio";
  if (type === "range") return "slider";
  if (type === "number") return "spinbutton";
  if (type === "search") return el.hasAttribute("list") ? "combobox" : "searchbox";
  if (type === "hidden") return null;
  var list = el.getAttribute("list");
  if (list) {
    var datalist = document.getElementById(list);
    if (datalist && datalist.tagName === "DATALIST") return "combobox";
  }
  return "textbox";
}

function hiddenForAria(el) {
  if (!el) return true;
  var tag = el.tagName ? el.tagName.toUpperCase() : "";
  if (HIDDEN_TAGS.indexOf(tag) >= 0) return true;
  if (attrOf(el, "aria-hidden") === "true") return true;
  var style = window.getComputedStyle(el);
  if (style.visibility === "hidden" || style.visibility === "collapse" || style.display === "none") return true;
  var p = parentAcrossShadow(el);
  while (p && p !== document.body) {
    if (attrOf(p, "aria-hidden") === "true") return true;
    if (window.getComputedStyle(p).display === "none") return true;
    p = parentAcrossShadow(p);
  }
  return false;
}

// The text a reader would see in el, collapsed to one line and capped at 200 characters.
function visibleText(el) {
  try {
    var parts = [];
    var budget = 240;
    function collect(node) {
      if (!node || budget < 0) return;
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.parentElement && hiddenForAria(node.parentElement)) return;
        var clean = (node.textContent || "").replace(/\s+/g, " ").trim();
        if (clean) {
          parts.push(clean);
          budget -= clean.length + 1;
        }
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
      if (node.nodeType === Node.ELEMENT_NODE && hiddenForAria(node)) return;
      var kids = Array.from(node.childNodes || []);
      for (var i = 0; i < kids.length; i++) {
        collect(kids[i]);
        if (budget < 0) break;
      }
    }
    collect(el);
    var text = parts.length ? parts.join(" ") : el.innerText || el.textContent || "";
    return text.replace(/\s+/g, " ").trim().substring(0, 200);
  } catch (e) {
    return "";
  }
}

function textFromIds(ids) {
  if (!ids) return "";
  var parts = [];
  ids.split(/\s+/).forEach(function (id) {
    var el = id ? document.getElementById(id) : null;
    if (el) {
      var t = (el.innerText || el.textContent || "").trim();
      if (t) parts.push(t);
    }
  });
  return parts.join(" ").trim();
}

function labelsText(el) {
  var labels = el.labels ? Array.from(el.labels) : [];
  if (!labels.length) return "";
  return labels
    .map(function (label) {
      return visibleText(label) || (label.textContent || "").trim();
    })
    .filter(Boolean)
    .join(" ")
    .trim()
    .substring(0, 200);
}

// The accessible name: aria-labelledby, aria-label, placeholder, label text, then the element's own text.
function accessibleName(el, role) {
  try {
    if (!el || attrOf(el, "aria-hidden") === "true") return "";
    var byIds = textFromIds(attrOf(el, "aria-labelledby"));
    if (byIds) return byIds.substring(0, 200);
    var label = (attrOf(el, "aria-label") || "").trim();
    if (label) return label.substring(0, 200);
    var ariaPlaceholder = (attrOf(el, "aria-placeholder") || "").trim();
    if (ariaPlaceholder) return ariaPlaceholder.substring(0, 200);
    var fromLabels = labelsText(el);
    if (fromLabels) return fromLabels;
    var tag = el.tagName ? el.tagName.toLowerCase() : "";
    if (tag === "img") {
      var alt = (attrOf(el, "alt") || "").trim();
      if (alt) return alt.substring(0, 200);
    }
    if (tag === "input") {
      var type = (attrOf(el, "type") || "text").toLowerCase();
      var value = el.value || attrOf(el, "value") || "";
      var placeholder = (attrOf(el, "placeholder") || "").trim();
      if ((type === "button" || type === "submit" || type === "reset") && value) return String(value).substring(0, 200);
      if (placeholder) return placeholder.substring(0, 200);
      if (value && type !== "password") return String(value).substring(0, 200);
    }
    if (tag === "textarea") {
      var taPlaceholder = (attrOf(el, "placeholder") || "").trim();
      if (taPlaceholder) return taPlaceholder.substring(0, 200);
      if (el.value) return String(el.value).substring(0, 200);
    }
    if (tag === "select") {
      var chosen = Array.from(el.selectedOptions || [])
        .map(function (option) {
          return visibleText(option) || (option.textContent || "").trim();
        })
        .filter(Boolean)
        .join(", ")
        .trim();
      if (chosen) return chosen.substring(0, 200);
    }
    var roleLower = (role || "").toLowerCase();
    if (NAMED_BY_TEXT_ROLES.indexOf(roleLower) >= 0 || NAMED_BY_TEXT_TAGS.indexOf(tag) >= 0 || /^h[1-6]$/.test(tag)) {
      var own = visibleText(el);
      if (own) return own.substring(0, 200);
    }
    if (tag === "p" || tag === "li" || roleLower === "heading") {
      var para = visibleText(el);
      if (para) return para.substring(0, 200);
    }
    var title = (attrOf(el, "title") || "").trim();
    if (title) return title.substring(0, 200);
    return "";
  } catch (e) {
    return "";
  }
}

function elementStates(el) {
  var states = [];
  try {
    if (document.activeElement === el) {
      states.push("active");
      states.push("focused");
    }
    if (el.matches && el.matches(":checked")) states.push("checked");
    var checked = attrOf(el, "aria-checked");
    if (checked === "true") states.push("checked");
    if (checked === "mixed") states.push("indeterminate");
    if ((el.matches && el.matches(":disabled")) || el.disabled) states.push("disabled");
    var p = parentAcrossShadow(el);
    while (p) {
      if (p.tagName === "FIELDSET" && p.disabled) {
        states.push("disabled");
        break;
      }
      p = parentAcrossShadow(p);
    }
    if (el.matches && el.matches(":required")) states.push("required");
    if (el.readOnly) states.push("readonly");
    if (el.selected) states.push("selected");
    if (attrOf(el, "aria-selected") === "true") states.push("selected");
    var expanded = attrOf(el, "aria-expanded");
    if (expanded === "true") states.push("expanded");
    if (expanded === "false") states.push("collapsed");
    var pressed = attrOf(el, "aria-pressed");
    if (pressed === "true") states.push("pressed");
    if (pressed === "false") states.push("released");
    if (attrOf(el, "aria-current")) states.push("current");
    if (attrOf(el, "aria-invalid") === "true") states.push("invalid");
    if (attrOf(el, "aria-busy") === "true") states.push("busy");
  } catch (e) {}
  return Array.from(new Set(states));
}

function elementDetails(el) {
  var details = {};
  try {
    var tag = el.tagName ? el.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "textarea") {
      var type = (attrOf(el, "type") || "text").toLowerCase();
      var value = el.value || attrOf(el, "value") || "";
      if (value && (tag !== "input" || type !== "password")) details.value = String(value).substring(0, 200);
      var placeholder = (attrOf(el, "placeholder") || "").trim();
      if (placeholder) details.placeholder = placeholder.substring(0, 200);
    }
    if (tag === "select") {
      var chosen = Array.from(el.selectedOptions || [])
        .map(function (option) {
          return visibleText(option) || (option.textContent || "").trim();
        })
        .filter(Boolean);
      if (chosen.length) details.value = chosen.join(", ").substring(0, 200);
      var all = Array.from(el.options || []);
      if (all.length > 0 && all.length <= 20) {
        details.options = all
          .map(function (opt) {
            var label = (opt.textContent || "").trim();
            var text = label;
            if (opt.value && opt.value !== label) text += " (value: " + opt.value + ")";
            if (opt.disabled) text += " [disabled]";
            return text;
          })
          .join(", ");
      } else if (all.length > 20) {
        details.options = all.slice(0, 10).map(function (opt) {
          return (opt.textContent || "").trim();
        }).join(", ") + "... (" + all.length + " total options)";
      }
    }
  } catch (e) {}
  return details;
}

function collectInteractive(refState) {
  var interactiveSet = new Set();
  var nodes = [];
  var roleCounts = {};
  var roleRefs = {};
  queryAllComposed(INTERACTIVE_SELECTOR).forEach(function (el) {
    if (attrOf(el, "aria-hidden") === "true") return;
    var style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return;
    var rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    interactiveSet.add(el);
    var role = attrOf(el, "role") || implicitRole(el) || "generic";
    if (INTERACTIVE_ROLES.indexOf(role) < 0 && role !== "generic") return;
    var name = accessibleName(el, role);
    var ref = refState.assign(el);
    var key = role + "::" + name;
    var nth = roleCounts[key] || 0;
    roleCounts[key] = nth + 1;
    (roleRefs[key] = roleRefs[key] || []).push(ref);
    var node = { ref: ref, role: role, name: name, tag: el.tagName.toLowerCase() };
    var states = elementStates(el);
    if (states.length) node.states = states;
    var details = elementDetails(el);
    Object.keys(details).forEach(function (k) {
      node[k] = details[k];
    });
    nodes.push({ node: node, key: key, nth: nth });
  });
  nodes.forEach(function (entry) {
    if (roleRefs[entry.key].length > 1 && entry.nth > 0) entry.node.nth = entry.nth;
  });
  return { nodes: nodes.map(function (entry) { return entry.node; }), interactiveSet: interactiveSet };
}

function collectContent(refState, interactiveSet) {
  var nodes = [];
  queryAllComposed(CONTENT_SELECTOR).forEach(function (el) {
    if (attrOf(el, "aria-hidden") === "true") return;
    if (interactiveSet.has(el)) return;
    var style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return;
    var tag = el.tagName.toLowerCase();
    var role = attrOf(el, "role") || implicitRole(el);
    var name = accessibleName(el, role);
    if (!name) return;
    var node = { ref: refState.assign(el), role: role, name: name, tag: tag };
    if (role === "heading") {
      var ariaLevel = parseInt(attrOf(el, "aria-level") || "", 10);
      var tagMatch = /^h([1-6])$/.exec(tag);
      var level = !isNaN(ariaLevel) ? ariaLevel : tagMatch ? parseInt(tagMatch[1], 10) : undefined;
      if (level) node.level = level;
    }
    nodes.push(node);
  });
  return nodes;
}

// The snapshot builder. Refs e0, e1, ... continue after the highest ref already in the page; refs that are not in this
// snapshot are removed from the elements. The options are interactive (only interactive elements) and maxDepth (kept in the stats).
function buildPageSnapshot(options) {
  options = options || {};
  var maxIndex = -1;
  queryAllComposed("[" + REF_ATTR + "]").forEach(function (el) {
    var ref = attrOf(el, REF_ATTR);
    if (REF_PATTERN.test(ref)) maxIndex = Math.max(maxIndex, parseInt(ref.substring(1), 10));
  });
  var refCounter = maxIndex + 1;
  var usedRefs = new Set();
  var refState = {
    assign: function (el) {
      var existing = attrOf(el, REF_ATTR);
      var ref = REF_PATTERN.test(existing || "") && !usedRefs.has(existing) ? existing : "e" + refCounter++;
      el.setAttribute(REF_ATTR, ref);
      usedRefs.add(ref);
      return ref;
    },
  };
  var interactive = collectInteractive(refState);
  var content = options.interactive ? [] : collectContent(refState, interactive.interactiveSet);
  queryAllComposed("[" + REF_ATTR + "]").forEach(function (el) {
    var ref = attrOf(el, REF_ATTR);
    if (!REF_PATTERN.test(ref) || !usedRefs.has(ref)) el.removeAttribute(REF_ATTR);
  });
  var all = interactive.nodes.concat(content);
  return {
    tree: { role: "document", ref: "root", name: document.title || "", children: all },
    stats: { totalRefs: all.length, interactiveRefs: interactive.nodes.length, maxDepth: options.maxDepth || 30 },
  };
}
