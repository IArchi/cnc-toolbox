const pageButtons = [...document.querySelectorAll("[data-page]")];
function showPage(name) {
  if (!pageButtons.some((button) => button.dataset.page === name)) name = "converter";
  for (const button of pageButtons) {
    const active = button.dataset.page === name;
    document.getElementById(`${button.dataset.page}-page`).hidden = !active;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  if (name === "simulator") {
    const frame = document.getElementById(`${name}-frame`);
    if (!frame.hasAttribute("src")) frame.src = frame.dataset.src;
  }
}
for (const [index, button] of pageButtons.entries()) {
  button.addEventListener("click", () => {
    location.hash = button.dataset.page;
    showPage(button.dataset.page);
  });
  button.addEventListener("keydown", (event) => {
    let next;
    if (event.key === "ArrowRight") next = (index + 1) % pageButtons.length;
    else if (event.key === "ArrowLeft") next = (index + pageButtons.length - 1) % pageButtons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = pageButtons.length - 1;
    else return;
    event.preventDefault();
    pageButtons[next].focus();
    pageButtons[next].click();
  });
}
window.addEventListener("hashchange", () => showPage(location.hash.slice(1)));
if (!window.isGcodeSimulator) showPage(location.hash.slice(1));
