Hooks.once("setup", () => {
  const babele = game.babele ?? (typeof Babele !== "undefined" ? Babele.get() : null);
  if (babele) {
    babele.register({
      module: "PF2e-KR",
      lang: "ko",
      dir: "compendium"
    });
  }
});
