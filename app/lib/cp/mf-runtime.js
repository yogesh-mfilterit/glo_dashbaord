// Mirrors the logic of views/sid-he.ejs for any CP-designed page
(function () {
  var form = document.getElementById("verificationForm");
  var overlay = document.getElementById("mf-overlay");
  var products = JSON.parse(document.getElementById("mf-products").textContent);
  var meta = JSON.parse(document.getElementById("mf-meta").textContent);
  var selected = products[0] || {};
  var ready = false;
  var busy = false;

  document.getElementById("cjsInput").value = navigator.userAgent || "NA";

  /* ---------- CTA + decoy buttons (same ids as sid-he.ejs) ---------- */
  var cta = document.querySelector("[data-mf-cta]") ||
    Array.prototype.find.call(document.querySelectorAll("button, a, input[type=submit]"),
      function (n) { return /subscribe|continue/i.test(n.textContent || n.value || ""); });
  var nativeSubmit = !!cta && (cta.tagName === "BUTTON" || cta.tagName === "INPUT");

  function decoy(id) {
    var b = document.createElement("button");
    b.type = "submit"; b.className = "subscribe-btn"; b.id = id;
    b.style.display = "none"; b.setAttribute("tabindex", "-1");
    form.appendChild(b);
  }
  var n = Number(meta.randomBtnNumber) || 0;
  var i;
  for (i = 0; i < n; i++) decoy("btn-" + meta.testId + i);
  if (cta) {
    cta.classList.add("subscribe-btn");
    cta.id = "btn-" + meta.testId;
    if (nativeSubmit) { cta.setAttribute("type", "submit"); cta.setAttribute("form", "verificationForm"); }
  }
  for (i = 0; i < n; i++) decoy("btn-" + meta.testId + i + i);

  function lockCta(locked) {
    if (!cta) return;
    if (nativeSubmit) cta.disabled = locked;
    cta.style.pointerEvents = locked ? "none" : "";
    cta.style.opacity = locked ? "0.6" : "";
  }
  lockCta(true);

  /* ---------- optional plan cards: data-mf-product="<id>" ---------- */
  document.querySelectorAll("[data-mf-product]").forEach(function (el) {
    el.addEventListener("click", function () {
      selected = products.find(function (p) {
        return p.subscriptionId_subscriptionDescription === el.dataset.mfProduct;
      }) || selected;
    });
  });

  /* ---------- fingerprint events ---------- */
  function unlock() {
    ready = true;
    if (overlay) overlay.remove();
    lockCta(false);
  }
  document.addEventListener("mfilter:dataCollected", function (event) {
    var d = event && event.detail;
    if (d && d.data && d.data.fp && d.data.fp.errorMessage === "DOMContentLoaded handler failed")
      document.getElementById("fpDataError").value = JSON.stringify(d);
    document.getElementById("fpData").value = d && d.fpDataCollected;
    unlock();
  });
  document.addEventListener("mfilter:fpNotCollected", function (event) {
    unlock();
    document.getElementById("fpDataError").value = JSON.stringify(event && event.detail);
  });
  document.addEventListener("bot-analysis", function (event) {
    document.getElementById("clickData").value =
      typeof (event && event.detail) === "object" ? JSON.stringify(event.detail) : event.detail;
  });

  async function getTiltVariationData() {
    var detail = {};
    document.dispatchEvent(new CustomEvent("mfilter:getTiltVariationSet", { detail: detail }));
    while (!detail.ready) await new Promise(function (r) { setTimeout(r, 10); });
    var el = document.getElementById("variation");
    if (el) el.value = JSON.stringify(detail.variationData);
  }

  function addHidden(name, value) {
    var inp = document.createElement("input");
    inp.type = "hidden"; inp.name = name; inp.value = value;
    form.appendChild(inp);
  }

  /* ---------- submit (same fields as sid-he.ejs) ---------- */
  async function proceed(submitterId, trusted) {
    document.getElementById("test").value = submitterId || "unclicked";
    document.getElementById("trust").value = submitterId ? String(trusted) : "false";
    if (submitterId) {
      var sed = document.getElementById("sed");
      sed.value = sed.value.split("|").concat(Date.now()).join("|");
    }
    var lbl = (meta.labels || {})[selected.subscriptionId_subscriptionDescription] || {};
    addHidden("selectedProduct", JSON.stringify(selected));
    addHidden("subscriptionId", selected.subscriptionId_subscriptionDescription || "");
    addHidden("subscriptionDescription", selected.subscriptionDescription || "");
    addHidden("selectedPlan", lbl.plan || "");
    addHidden("selectedPrice", lbl.price || "");
    await getTiltVariationData();
    HTMLFormElement.prototype.submit.call(form);
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!ready || busy) return;
    busy = true; lockCta(true);
    proceed(e.submitter && e.submitter.id, e.isTrusted);
  });
  // CTA that is not a <button>/<input> (e.g. an <a>): handle the click directly
  if (cta && !nativeSubmit) cta.addEventListener("click", function (e) {
    e.preventDefault();
    if (!ready || busy) return;
    busy = true; lockCta(true);
    proceed(cta.id, e.isTrusted);
  }, true);

  /* ---------- button id + sed counter rotation (same as sid-he.ejs) ---------- */
  function xorshift32(x) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return x >>> 0; }
  function btnIdToSeed(id) { return parseInt(id.replace("btn-", ""), 36) >>> 0; }
  setInterval(function () {
    var sedInput = document.getElementById("sed");
    if (sedInput && sedInput.value.startsWith("xor|")) {
      var parts = sedInput.value.split("|");
      var counter = (parseInt(parts[1], 10) || 0) + 1;
      if (parts.length < 4) sedInput.value = "xor|" + counter + "|" + parts.slice(2).join("|");
    }
    document.querySelectorAll(".subscribe-btn").forEach(function (btn) {
      if (!btn.id.startsWith("btn-")) return;
      btn.id = "btn-" + xorshift32(btnIdToSeed(btn.id)).toString(36);
    });
  }, 500);
})();