// "Join a friend's game": a small HTML form over the canvas for typing a friend's code (4 characters for
// a Quick duel, 5 for a Room: net/online.js tells them apart by length). Plain
// HTML (an <input>) rather than Babylon GUI, because the browser then handles typing, pasting and a
// phone's keyboard for us. On itch.io the game runs inside a frame on itch's page, and a ?join=CODE
// link never reaches it, so typing the code is how a friend joins there.
// onJoin(code) gets the code in capitals. show(visible) shows or hides the form.
export function createJoinBox(onJoin) {
  const form = document.createElement("form");
  form.style.cssText = "position:absolute; top:18px; left:50%; transform:translateX(-50%); display:flex; gap:8px; font:16px sans-serif;";

  const input = document.createElement("input");
  input.maxLength = 5;
  input.placeholder = "CODE";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", "Your friend's game code");
  input.style.cssText = "width:96px; padding:8px; border-radius:6px; border:2px solid #ffd75e; background:#000c; color:#fff; font:bold 18px monospace; letter-spacing:4px; text-transform:uppercase; text-align:center;";

  const button = document.createElement("button");
  button.type = "submit";
  button.textContent = "Join a friend's game";
  button.style.cssText = "padding:8px 14px; border-radius:6px; border:2px solid #ffd75e; background:#000c; color:#ffd75e; font:16px sans-serif; cursor:pointer;";

  form.append(input, button);
  form.addEventListener("submit", (event) => {
    event.preventDefault(); // a form would reload the page otherwise
    const code = input.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,5}$/.test(code)) {
      input.focus();
      return;
    }
    input.blur(); // give the keys back to the game
    onJoin(code);
  });
  document.body.appendChild(form);

  let shown = true;
  return {
    show(visible) {
      if (visible === shown) return;
      shown = visible;
      form.style.display = visible ? "flex" : "none";
      if (!visible) input.blur();
    },
  };
}
