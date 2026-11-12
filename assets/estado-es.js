/*
 * Client-side additions for the NueveOnce status page, loaded through the
 * "scripts" key of .upptimerc.yml:
 *  - marks the document as Spanish;
 *  - shows a banner when the monitoring data may be stale, based on the last
 *    successful "Uptime CI" run on master (it never claims the data is fresh);
 *  - restores the "degraded" class on incidents whose Spanish title says
 *    "rendimiento degradado" (the site only looks for the English word);
 *  - translates the one label that @upptime/status-page 1.17.0 hardcodes in
 *    English instead of reading it from i18n.
 * Plain ES5 with no dependencies. The only network call goes to api.github.com.
 */
(function () {
  "use strict";

  // Svelte may insert the <svelte:head> scripts again while hydrating: run once.
  if (window.__nueveonceStatusAddons) {
    return;
  }
  window.__nueveonceStatusAddons = true;

  document.documentElement.setAttribute("lang", "es");

  // Minutes since the last successful monitoring run before the banner shows.
  // Keep it equal to the threshold of the external freshness watchdog.
  var STALE_AFTER_MINUTES = 45;

  var RUNS_URL =
    "https://api.github.com/repos/Grupo-Nuevo-Once/status/actions/workflows/uptime.yml/runs" +
    "?branch=master&status=success&per_page=1";
  var CACHE_KEY = "estado-es-vigencia";
  var MINUTE_MS = 60 * 1000;
  var SUCCESS_TTL_MS = 10 * MINUTE_MS;
  var ERROR_TTL_MS = MINUTE_MS;
  var RECHECK_MS = 5 * MINUTE_MS;
  var REQUEST_TIMEOUT_MS = 15 * 1000;

  var BANNER_ID = "aviso-vigencia";
  var TEXT_UNVERIFIED = "No fue posible verificar la vigencia de los datos.";
  var TEXT_STALE =
    "Los datos de esta página podrían estar desactualizados: " +
    "la última verificación automática fue hace ";

  var DEGRADED_TITLE = "rendimiento degradado";
  // English labels hardcoded in the site markup (past maintenance cards).
  var LITERALS = { Completed: "Completado" };

  var banner = null;
  var requestPending = false;

  function now() {
    return new Date().getTime();
  }

  function plural(count, one, many) {
    return count + " " + (count === 1 ? one : many);
  }

  function describeAge(minutes) {
    if (minutes < 120) {
      return plural(minutes, "minuto", "minutos");
    }
    var hours = Math.floor(minutes / 60);
    if (hours < 48) {
      return plural(hours, "hora", "horas");
    }
    return plural(Math.floor(hours / 24), "día", "días");
  }

  function setBannerText(text) {
    if (banner && banner.textContent !== text) {
      banner.textContent = text;
    }
  }

  // An empty banner is hidden by the stylesheet. Fresh data shows nothing:
  // the page never states that the data is up to date.
  function render(result) {
    var updatedAt = result.ok ? Date.parse(result.updatedAt) : NaN;
    if (isNaN(updatedAt)) {
      setBannerText(TEXT_UNVERIFIED);
      return;
    }
    // Client clock minus updated_at; a client clock running behind gives 0.
    var ageMs = Math.max(0, now() - updatedAt);
    if (ageMs > STALE_AFTER_MINUTES * MINUTE_MS) {
      setBannerText(TEXT_STALE + describeAge(Math.floor(ageMs / MINUTE_MS)) + ".");
    } else {
      setBannerText("");
    }
  }

  function readCache() {
    try {
      var entry = JSON.parse(window.localStorage.getItem(CACHE_KEY));
      if (!entry || typeof entry.checkedAt !== "number") {
        return null;
      }
      var elapsed = now() - entry.checkedAt;
      var ttl = entry.ok === true ? SUCCESS_TTL_MS : ERROR_TTL_MS;
      // A negative elapsed time means the clock moved backwards: fetch again.
      return elapsed >= 0 && elapsed < ttl ? entry : null;
    } catch (error) {
      return null;
    }
  }

  function writeCache(result) {
    try {
      window.localStorage.setItem(CACHE_KEY, JSON.stringify(result));
    } catch (error) {
      // Storage may be blocked or full; the banner works without the cache.
    }
  }

  function failure() {
    return { ok: false, checkedAt: now() };
  }

  function parseResponse(xhr) {
    // 403 and 429 are rate limits; nothing but a 200 can be trusted.
    if (xhr.status !== 200) {
      return failure();
    }
    try {
      var runs = JSON.parse(xhr.responseText).workflow_runs;
      var updatedAt = runs && runs.length ? runs[0].updated_at : null;
      if (typeof updatedAt !== "string" || isNaN(Date.parse(updatedAt))) {
        return failure();
      }
      return { ok: true, checkedAt: now(), updatedAt: updatedAt };
    } catch (error) {
      return failure();
    }
  }

  function fetchLastRun(done) {
    var finished = false;
    var xhr;

    function finish(result) {
      if (!finished) {
        finished = true;
        done(result);
      }
    }

    try {
      xhr = new XMLHttpRequest();
      xhr.open("GET", RUNS_URL, true);
      xhr.setRequestHeader("Accept", "application/vnd.github+json");
      xhr.timeout = REQUEST_TIMEOUT_MS;
      xhr.onreadystatechange = function () {
        if (xhr.readyState === 4) {
          finish(parseResponse(xhr));
        }
      };
      xhr.ontimeout = function () {
        finish(failure());
      };
      xhr.onerror = function () {
        finish(failure());
      };
      xhr.send();
    } catch (error) {
      finish(failure());
    }
  }

  function checkFreshness() {
    if (requestPending) {
      return;
    }
    var cached = readCache();
    if (cached) {
      render(cached);
      return;
    }
    requestPending = true;
    fetchLastRun(function (result) {
      requestPending = false;
      writeCache(result);
      render(result);
    });
  }

  function checkWhenVisible() {
    if (!document.hidden) {
      checkFreshness();
    }
  }

  function insertBanner() {
    banner = document.getElementById(BANNER_ID);
    if (!banner) {
      banner = document.createElement("div");
      banner.id = BANNER_ID;
      banner.setAttribute("role", "status");
      // Outside #sapper, so hydration and client navigation leave it alone.
      document.body.insertBefore(banner, document.body.firstChild);
    }
  }

  function markDegradedIncidents() {
    var cards = document.querySelectorAll("article.down");
    for (var i = 0; i < cards.length; i++) {
      var heading = cards[i].querySelector("h4");
      if (
        heading &&
        !cards[i].classList.contains("degraded") &&
        heading.textContent.toLowerCase().indexOf(DEGRADED_TITLE) !== -1
      ) {
        cards[i].classList.add("degraded");
      }
    }
  }

  function translateLiterals() {
    var nodes = document.querySelectorAll("article.degraded div");
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].children.length === 0) {
        var text = nodes[i].textContent.trim();
        if (Object.prototype.hasOwnProperty.call(LITERALS, text)) {
          nodes[i].textContent = LITERALS[text];
        }
      }
    }
  }

  function fixCards() {
    markDegradedIncidents();
    translateLiterals();
  }

  function watchCards() {
    fixCards();
    if (!window.MutationObserver) {
      return;
    }
    // The cards are rendered client-side after the GitHub API answers.
    new MutationObserver(fixCards).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class"]
    });
  }

  function start() {
    insertBanner();
    checkFreshness();
    window.setInterval(checkWhenVisible, RECHECK_MS);
    document.addEventListener("visibilitychange", checkWhenVisible);
    watchCards();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
