// Header menus: the mobile menu button and the three dropdowns.
(function () {
  var menuButton = document.querySelector(".menu-button");
  var nav = document.getElementById("site-nav");
  var toggles = Array.prototype.slice.call(document.querySelectorAll(".nav-toggle"));

  function closeAll(except) {
    toggles.forEach(function (t) {
      if (t !== except) t.setAttribute("aria-expanded", "false");
    });
  }

  toggles.forEach(function (toggle) {
    toggle.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = toggle.getAttribute("aria-expanded") === "true";
      closeAll(toggle);
      toggle.setAttribute("aria-expanded", String(!open));
    });
  });

  if (menuButton) {
    menuButton.addEventListener("click", function () {
      var open = menuButton.getAttribute("aria-expanded") === "true";
      menuButton.setAttribute("aria-expanded", String(!open));
      nav.classList.toggle("is-open", !open);
      if (open) closeAll();
    });
  }

  document.addEventListener("click", function (e) {
    if (!nav.contains(e.target)) closeAll();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    var open = toggles.filter(function (t) {
      return t.getAttribute("aria-expanded") === "true";
    })[0];
    closeAll();
    if (open) open.focus();
  });
})();
