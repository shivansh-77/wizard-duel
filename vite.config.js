// Vite's settings. `npm run dev` doesn't need any; this is for `npm run build`, which makes the
// game's files for a website (in dist/).
export default {
  // Relative paths ("./assets/...") instead of starting at the top of the site ("/assets/..."): the
  // built game then works from any folder, like itch.io's (it puts each game in its own folder) or
  // GitHub Pages' (https://you.github.io/wizard-duel/).
  base: "./",
};
