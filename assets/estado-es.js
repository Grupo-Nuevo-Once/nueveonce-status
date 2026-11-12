/*
 * Client-side additions for the NueveOnce status page, loaded through the
 * "scripts" key of .upptimerc.yml:
 *  - marks the document as Spanish;
 *  - shows a banner when the monitoring data may be stale, based on the last
 *    successful "Uptime CI" run on master (it never claims the data is fresh);
 *  - restores the "degraded" class on incidents whose Spanish title says
 *    "rendimiento degradado" (the site only looks for the English word);
 *  - translates the one label that @upptime/status-page 1.17.0 hardcodes in
 *    English instead of reading it from i18n;
 *  - drops the emoji in front of the summary banner, which the stylesheet
 *    replaces with an icon;
 *  - adds to each component card one bar per day for the last 90 days, the
 *    availability over that period and the state as text. The bars come from
 *    dailyMinutesDown in history/summary.json; the days before a component
 *    was first checked (startTime in its history file) show as "sin datos",
 *    never as available. Without that data the card keeps Upptime's content.
 * Plain ES5 with no dependencies. Network calls go only to api.github.com and
 * to this repository's files on raw.githubusercontent.com.
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
    "https://api.github.com/repos/Grupo-Nuevo-Once/nueveonce-status/actions/workflows/uptime.yml/runs" +
    "?branch=master&status=success&per_page=1";
  var CACHE_KEY = "estado-es-vigencia";
  var MINUTE_MS = 60 * 1000;
  var DAY_MS = 24 * 60 * MINUTE_MS;
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

  // The same files the site reads, from the same place, so the browser can
  // reuse its cached copy of summary.json.
  var HISTORY_BASE_URL =
    "https://raw.githubusercontent.com/Grupo-Nuevo-Once/nueveonce-status/master/history/";
  var DAYS_SHOWN = 90;
  // The first day any component was checked: until its history file answers,
  // a component counts as checked from this day on.
  var MONITORING_SINCE_MS = Date.parse("2026-11-12T00:00:00Z");
  // Minutes without service in a UTC day from which a bar turns orange, and
  // then red. Any minute at all turns it yellow.
  var PARTIAL_FROM_MINUTES = 30;
  var MAJOR_FROM_MINUTES = 120;
  var STATE_TEXT = {
    up: "Operativo",
    degraded: "Rendimiento degradado",
    down: "No disponible"
  };
  var DATE_FORMAT = { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" };
  // Anything in front of the first letter or digit of the summary banner.
  var LEADING_SYMBOLS = /^[^0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/;
  var COMPONENT_LINK = /\/history\/([a-z0-9-]+)\/?$/;
  var HISTORY_START = /^startTime:[ \t]*(\S+)[ \t]*$/m;
  var EXTRA_CLASS = "nn-extra";
  var ENHANCED_CLASS = "nn-mejorada";

  var banner = null;
  var requestPending = false;
  // Filled once summary.json answers: dailyMinutesDown and the first check of
  // each component, by slug.
  var minutesDownBySlug = null;
  var startBySlug = {};

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

  // --- Days, availability and their texts (pure; unit-tested) --------------

  function startOfDay(ms) {
    return Math.floor(ms / DAY_MS) * DAY_MS;
  }

  // The UTC day, as in the keys of dailyMinutesDown.
  function dayKey(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  }

  function minutesOn(minutesByDay, key) {
    if (!minutesByDay || !Object.prototype.hasOwnProperty.call(minutesByDay, key)) {
      return 0;
    }
    var minutes = Number(minutesByDay[key]);
    return minutes > 0 ? minutes : 0;
  }

  function stateFor(minutes) {
    if (minutes >= MAJOR_FROM_MINUTES) {
      return "mayor";
    }
    if (minutes >= PARTIAL_FROM_MINUTES) {
      return "parcial";
    }
    return minutes > 0 ? "menor" : "ok";
  }

  // The last DAYS_SHOWN UTC days, oldest first. A day before the first check
  // has no data unless an outage was recorded on it anyway.
  function buildDays(nowMs, sinceMs, minutesByDay) {
    var days = [];
    var today = startOfDay(nowMs);
    var firstDay = startOfDay(sinceMs);
    for (var back = DAYS_SHOWN - 1; back >= 0; back--) {
      var dayMs = today - back * DAY_MS;
      var key = dayKey(dayMs);
      var minutes = minutesOn(minutesByDay, key);
      days.push({
        key: key,
        ms: dayMs,
        minutes: minutes,
        state: dayMs < firstDay && minutes === 0 ? "sin-datos" : stateFor(minutes)
      });
    }
    return days;
  }

  // Share of the monitored time inside the window with service, from 0 to 1,
  // or null before the first check.
  function availability(nowMs, sinceMs, minutesByDay) {
    var windowStart = startOfDay(nowMs) - (DAYS_SHOWN - 1) * DAY_MS;
    var monitored = (nowMs - Math.max(windowStart, sinceMs)) / MINUTE_MS;
    if (!(monitored > 0)) {
      return null;
    }
    var down = 0;
    for (var key in minutesByDay) {
      if (Object.prototype.hasOwnProperty.call(minutesByDay, key)) {
        var dayMs = Date.parse(key + "T00:00:00Z");
        if (dayMs >= windowStart && dayMs <= nowMs) {
          down += minutesOn(minutesByDay, key);
        }
      }
    }
    return Math.max(0, Math.min(1, 1 - down / monitored));
  }

  // Truncated, never rounded: 99.996 % shows as 99,99 %, not as 100 %.
  function formatPercent(fraction) {
    if (fraction === null) {
      return null;
    }
    if (fraction >= 1) {
      return "100 %";
    }
    var hundredths = Math.floor(fraction * 10000 + 1e-6) / 100;
    return hundredths.toFixed(2).replace(".", ",") + " %";
  }

  function formatDay(ms) {
    try {
      return new Date(ms).toLocaleDateString("es", DATE_FORMAT);
    } catch (error) {
      return dayKey(ms);
    }
  }

  function describeDay(day) {
    var date = formatDay(day.ms);
    if (day.state === "sin-datos") {
      return date + ": sin datos";
    }
    if (day.minutes > 0) {
      return date + ": " + plural(Math.round(day.minutes), "minuto", "minutos") + " sin servicio";
    }
    return date + ": sin interrupciones registradas";
  }

  function describePeriod(days, fraction) {
    if (fraction === null) {
      return "Sin datos de disponibilidad en los últimos " + DAYS_SHOWN + " días.";
    }
    var withOutage = 0;
    for (var i = 0; i < days.length; i++) {
      if (days[i].minutes > 0) {
        withOutage++;
      }
    }
    return (
      "Disponibilidad en los últimos " + DAYS_SHOWN + " días: " + formatPercent(fraction) + ". " +
      (withOutage === 0 ? "Ningún día" : plural(withOutage, "día", "días")) +
      " con interrupciones."
    );
  }

  function startFromHistory(text) {
    var match = typeof text === "string" ? HISTORY_START.exec(text) : null;
    return match ? Date.parse(match[1]) : NaN;
  }

  function slugFromLink(href) {
    var match = typeof href === "string" ? COMPONENT_LINK.exec(href) : null;
    return match ? match[1] : null;
  }

  function stripLeadingSymbols(text) {
    return text.replace(LEADING_SYMBOLS, "");
  }

  // --- Freshness banner ----------------------------------------------------

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

  // Calls done(xhr) once, with null on a network error or a timeout.
  function get(url, accept, done) {
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
      xhr.open("GET", url, true);
      if (accept) {
        xhr.setRequestHeader("Accept", accept);
      }
      xhr.timeout = REQUEST_TIMEOUT_MS;
      xhr.onreadystatechange = function () {
        if (xhr.readyState === 4) {
          finish(xhr.status ? xhr : null);
        }
      };
      xhr.ontimeout = function () {
        finish(null);
      };
      xhr.onerror = function () {
        finish(null);
      };
      xhr.send();
    } catch (error) {
      finish(null);
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
    get(RUNS_URL, "application/vnd.github+json", function (xhr) {
      var result = xhr ? parseResponse(xhr) : failure();
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

  // --- Incident cards ------------------------------------------------------

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

  // --- Summary banner ------------------------------------------------------

  // Edits the site's own text nodes in place, never replaces them: Svelte keeps
  // a reference to each one, and a later update of it comes back through the
  // observer.
  function fixSummaryBanner() {
    var summary = document.querySelector("main > article");
    if (!summary) {
      return;
    }
    for (var node = summary.firstChild; node; node = node.nextSibling) {
      if (node.nodeType !== 3) {
        return;
      }
      var stripped = stripLeadingSymbols(node.data);
      if (stripped !== node.data) {
        node.data = stripped;
      }
      if (stripped !== "") {
        return;
      }
    }
  }

  // --- Component cards -----------------------------------------------------

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text) {
      node.textContent = text;
    }
    return node;
  }

  function cardState(card) {
    var states = ["down", "degraded", "up"];
    for (var i = 0; i < states.length; i++) {
      if (card.classList.contains(states[i])) {
        return states[i];
      }
    }
    return null;
  }

  function buildExtra(slug, state) {
    var sinceMs = Object.prototype.hasOwnProperty.call(startBySlug, slug)
      ? startBySlug[slug]
      : MONITORING_SINCE_MS;
    var minutesByDay = minutesDownBySlug[slug] || {};
    var nowMs = now();
    var days = buildDays(nowMs, sinceMs, minutesByDay);
    var fraction = availability(nowMs, sinceMs, minutesByDay);
    var extra = element("div", EXTRA_CLASS);
    extra.setAttribute("data-slug", slug);

    var icon = element("span", "nn-icono nn-icono-" + state);
    icon.setAttribute("aria-hidden", "true");
    extra.appendChild(icon);

    // The bars only repeat the summary below, which screen readers get.
    var bars = element("div", "nn-barras");
    bars.setAttribute("aria-hidden", "true");
    for (var i = 0; i < days.length; i++) {
      var bar = element("span", "nn-barra nn-barra-" + days[i].state);
      bar.title = describeDay(days[i]);
      bars.appendChild(bar);
    }
    extra.appendChild(bars);

    var legend = element("div", "nn-leyenda");
    legend.setAttribute("aria-hidden", "true");
    legend.appendChild(element("span", null, "Hace " + DAYS_SHOWN + " días"));
    legend.appendChild(element("span", "nn-linea"));
    legend.appendChild(
      element("span", "nn-porcentaje", fraction === null ? "Sin datos" : formatPercent(fraction) + " de disponibilidad")
    );
    legend.appendChild(element("span", "nn-linea"));
    legend.appendChild(element("span", null, "Hoy"));
    extra.appendChild(legend);

    extra.appendChild(element("p", "nn-sr", describePeriod(days, fraction)));
    extra.appendChild(element("p", "nn-estado", STATE_TEXT[state]));
    return extra;
  }

  function enhanceCards() {
    if (!minutesDownBySlug) {
      return;
    }
    var cards = document.querySelectorAll(".live-status > article");
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var link = card.querySelector("h4 a");
      var slug = slugFromLink(link && link.getAttribute("href"));
      var state = cardState(card);
      var current = card.querySelector("." + EXTRA_CLASS);
      if (!slug || !state || !Object.prototype.hasOwnProperty.call(minutesDownBySlug, slug)) {
        continue;
      }
      // Rebuilt when Svelte reuses the card for another component or another state.
      if (current && (current.getAttribute("data-slug") !== slug || !current.querySelector(".nn-icono-" + state))) {
        card.removeChild(current);
        current = null;
      }
      if (!current) {
        card.appendChild(buildExtra(slug, state));
      }
      if (!card.classList.contains(ENHANCED_CLASS)) {
        card.classList.add(ENHANCED_CLASS);
      }
    }
    var main = document.querySelector("main");
    if (main && document.querySelector("." + ENHANCED_CLASS) && !main.classList.contains("nn-con-barras")) {
      main.classList.add("nn-con-barras");
    }
  }

  function addPeriodNote() {
    var header = document.querySelector("main > .f");
    if (header && minutesDownBySlug && !header.querySelector(".nn-periodo")) {
      header.appendChild(element("p", "nn-periodo", "Disponibilidad de los últimos " + DAYS_SHOWN + " días."));
    }
  }

  function readJson(xhr) {
    if (!xhr || xhr.status !== 200) {
      return null;
    }
    try {
      return JSON.parse(xhr.responseText);
    } catch (error) {
      return null;
    }
  }

  // summary.json first; each component's history file only refines its first
  // day, so the bars show as soon as the summary arrives.
  function loadDailyData() {
    get(HISTORY_BASE_URL + "summary.json", null, function (xhr) {
      var summary = readJson(xhr);
      if (!summary || typeof summary.length !== "number") {
        return;
      }
      var bySlug = {};
      for (var i = 0; i < summary.length; i++) {
        var site = summary[i];
        if (site && typeof site.slug === "string" && COMPONENT_LINK.test("/history/" + site.slug)) {
          bySlug[site.slug] =
            site.dailyMinutesDown && typeof site.dailyMinutesDown === "object" ? site.dailyMinutesDown : {};
          loadStart(site.slug);
        }
      }
      minutesDownBySlug = bySlug;
      fixPage();
    });
  }

  function loadStart(slug) {
    get(HISTORY_BASE_URL + encodeURIComponent(slug) + ".yml", null, function (xhr) {
      var startMs = xhr && xhr.status === 200 ? startFromHistory(xhr.responseText) : NaN;
      if (!isNaN(startMs) && startMs !== startBySlug[slug]) {
        startBySlug[slug] = startMs;
        var stale = document.querySelector('.' + EXTRA_CLASS + '[data-slug="' + slug + '"]');
        if (stale) {
          stale.parentNode.removeChild(stale);
        }
        fixPage();
      }
    });
  }

  // --- Wiring --------------------------------------------------------------

  function fixPage() {
    markDegradedIncidents();
    translateLiterals();
    fixSummaryBanner();
    enhanceCards();
    addPeriodNote();
  }

  function watchPage() {
    fixPage();
    if (!window.MutationObserver) {
      return;
    }
    // The cards are rendered client-side after the GitHub API answers.
    new MutationObserver(fixPage).observe(document.body, {
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
    loadDailyData();
    watchPage();
  }

  // Unit tests load this file with this flag set and get the pure functions
  // back instead of a running page.
  if (window.__nueveonceEstadoPruebas) {
    window.__nueveonceEstadoPruebas.funciones = {
      dayKey: dayKey,
      buildDays: buildDays,
      availability: availability,
      formatPercent: formatPercent,
      describeDay: describeDay,
      describePeriod: describePeriod,
      startFromHistory: startFromHistory,
      slugFromLink: slugFromLink,
      stripLeadingSymbols: stripLeadingSymbols
    };
    return;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
